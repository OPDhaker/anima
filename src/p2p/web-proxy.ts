/**
 * P2P Web Proxy — Local HTTP proxy for .anima domains
 *
 * Intercepts HTTP requests to .anima domains and routes them
 * through the P2P mesh to the hosting node.
 *
 * Usage:
 *   1. Start the proxy on localhost:9868
 *   2. Configure browser/system to use it as HTTP proxy
 *   3. Navigate to http://mysite.orgname.anima
 *   4. Proxy resolves domain via private DNS → fetches from mesh
 *
 * Also serves as a simple HTTP server for local site previews.
 */

import { EventEmitter } from "node:events";
import http from "node:http";
import type { WebHostManager } from "./web-host.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("p2p-web-proxy");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebProxyConfig {
  /** Port to listen on. @default 9868 */
  port?: number;
  /** Bind address. @default "127.0.0.1" */
  host?: string;
  /** The web host manager for resolving .anima sites */
  webHost: WebHostManager;
  /** Content fetcher for retrieving file data from content router */
  contentFetcher: (hash: string) => Buffer | null;
}

export interface ProxyStats {
  totalRequests: number;
  resolvedRequests: number;
  notFoundRequests: number;
  errorRequests: number;
  uptime: number;
}

// ---------------------------------------------------------------------------
// MIME helpers
// ---------------------------------------------------------------------------

const MIME_MAP: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function getMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// WebProxy
// ---------------------------------------------------------------------------

export class WebProxy extends EventEmitter {
  private readonly config: WebProxyConfig;
  private server?: http.Server;
  private startedAt = 0;
  private stats = { totalRequests: 0, resolvedRequests: 0, notFoundRequests: 0, errorRequests: 0 };

  constructor(config: WebProxyConfig) {
    super();
    this.config = config;
  }

  /**
   * Start the proxy server.
   */
  async start(): Promise<void> {
    const port = this.config.port ?? 9868;
    const host = this.config.host ?? "127.0.0.1";

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        this.startedAt = Date.now();
        log.info(`web proxy listening on http://${host}:${port}`);
        log.info("configure your browser to use this as HTTP proxy for .anima domains");
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  /**
   * Stop the proxy server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          log.info("web proxy stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get proxy stats.
   */
  getStats(): ProxyStats {
    return {
      ...this.stats,
      uptime: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
    };
  }

  // -----------------------------------------------------------------------
  // Request handling
  // -----------------------------------------------------------------------

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.stats.totalRequests++;

    const host = req.headers.host ?? "";
    const requestPath = req.url ?? "/";

    // Check if this is an .anima domain
    if (!host.endsWith(".anima")) {
      // Not an .anima domain — return info page
      this.serveInfoPage(res);
      return;
    }

    try {
      // Resolve the site and file
      const result = this.config.webHost.resolveFile(host, requestPath);

      if (!result) {
        this.serve404(res, host);
        this.stats.notFoundRequests++;
        return;
      }

      if (!result.file) {
        this.serve404(res, host);
        this.stats.notFoundRequests++;
        return;
      }

      // Fetch the file content from the content router
      const content = this.config.contentFetcher(result.file.contentHash);
      if (!content) {
        this.serve502(res, "Content not available in mesh");
        this.stats.errorRequests++;
        return;
      }

      // Serve the file
      const mimeType = result.file.mimeType || getMimeType(result.file.path);
      res.writeHead(result.is404 ? 404 : 200, {
        "Content-Type": mimeType,
        "Content-Length": String(content.length),
        "X-Anima-Site": result.site.domain,
        "X-Anima-Version": String(result.site.version),
        "Cache-Control": "public, max-age=3600",
      });
      res.end(content);
      this.stats.resolvedRequests++;

      log.debug(`${req.method} ${host}${requestPath} → ${result.file.path} (${content.length}b)`);
    } catch (err) {
      this.serve500(res, String(err));
      this.stats.errorRequests++;
    }
  }

  private serveInfoPage(res: http.ServerResponse): void {
    const html = `<!DOCTYPE html>
<html>
<head><title>Anima Web Proxy</title></head>
<body style="font-family: monospace; max-width: 600px; margin: 40px auto; padding: 20px;">
<h1>Anima Web Proxy</h1>
<p>This proxy resolves <code>.anima</code> domains through the P2P mesh.</p>
<p>Configure your browser to use <code>http://127.0.0.1:${this.config.port ?? 9868}</code> as HTTP proxy.</p>
<p>Then navigate to any <code>.anima</code> domain, e.g. <code>http://mysite.orgname.anima</code></p>
<hr>
<p>Stats: ${this.stats.totalRequests} requests, ${this.stats.resolvedRequests} resolved</p>
<p>Part of <a href="https://noxsoft.net">Anima v7 Private Internet</a></p>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  }

  private serve404(res: http.ServerResponse, domain: string): void {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>404 Not Found</h1><p>Site <code>${domain}</code> not found in the mesh.</p>`);
  }

  private serve500(res: http.ServerResponse, message: string): void {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>500 Internal Error</h1><p>${message}</p>`);
  }

  private serve502(res: http.ServerResponse, message: string): void {
    res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>502 Bad Gateway</h1><p>${message}</p>`);
  }
}
