/**
 * Tests for P2P Web Proxy — .anima domain routing via HTTP proxy.
 */

import http from "node:http";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebProxy, type WebProxyConfig } from "./web-proxy.js";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return { createSubsystemLogger: () => logger };
});

// Mock WebHostManager
function createMockWebHost() {
  return {
    resolveFile: vi.fn(),
    isAuthorized: vi.fn().mockReturnValue(true),
  };
}

function createMockContentFetcher() {
  return vi.fn().mockReturnValue(Buffer.from("<html><body>Hello</body></html>"));
}

function makeConfig(overrides?: Partial<WebProxyConfig>): WebProxyConfig {
  return {
    port: 0, // random port
    host: "127.0.0.1",
    webHost: createMockWebHost() as any,
    contentFetcher: createMockContentFetcher(),
    ...overrides,
  };
}

async function getProxyPort(proxy: WebProxy): Promise<number> {
  // Access the underlying server to get the assigned port
  const server = (proxy as any).server as http.Server;
  const addr = server.address();
  if (addr && typeof addr === "object") {
    return addr.port;
  }
  throw new Error("Server not listening");
}

async function fetchFromProxy(
  port: number,
  host: string,
  path: string,
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        headers: { Host: host },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("WebProxy", () => {
  let proxy: WebProxy;

  afterEach(async () => {
    if (proxy) {
      await proxy.stop();
    }
  });

  describe("lifecycle", () => {
    it("starts and stops without errors", async () => {
      proxy = new WebProxy(makeConfig());
      await proxy.start();
      const stats = proxy.getStats();
      expect(stats.totalRequests).toBe(0);
      await proxy.stop();
    });

    it("stop is safe when not started", async () => {
      proxy = new WebProxy(makeConfig());
      await proxy.stop(); // should not throw
    });
  });

  describe(".anima domain handling", () => {
    it("serves resolved .anima site file", async () => {
      const webHost = createMockWebHost();
      const fetcher = createMockContentFetcher();

      webHost.resolveFile.mockReturnValue({
        site: { domain: "test.noxsoft.anima", name: "Test", version: 1 },
        file: { path: "index.html", contentHash: "abc123", mimeType: "text/html", size: 27 },
        is404: false,
      });

      proxy = new WebProxy(makeConfig({ webHost: webHost as any, contentFetcher: fetcher }));
      await proxy.start();
      const port = await getProxyPort(proxy);

      const res = await fetchFromProxy(port, "test.noxsoft.anima", "/");

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["x-anima-site"]).toBe("test.noxsoft.anima");
      expect(res.body).toContain("Hello");
    });

    it("returns 404 for unknown .anima domain", async () => {
      const webHost = createMockWebHost();
      webHost.resolveFile.mockReturnValue(null);

      proxy = new WebProxy(makeConfig({ webHost: webHost as any }));
      await proxy.start();
      const port = await getProxyPort(proxy);

      const res = await fetchFromProxy(port, "unknown.anima", "/");
      expect(res.status).toBe(404);
      expect(res.body).toContain("not found");
    });

    it("returns 502 when content is unavailable", async () => {
      const webHost = createMockWebHost();
      webHost.resolveFile.mockReturnValue({
        site: { domain: "broken.anima", name: "Broken", version: 1 },
        file: { path: "index.html", contentHash: "xxx", mimeType: "text/html", size: 10 },
        is404: false,
      });

      const emptyFetcher = vi.fn().mockReturnValue(null);

      proxy = new WebProxy(makeConfig({ webHost: webHost as any, contentFetcher: emptyFetcher }));
      await proxy.start();
      const port = await getProxyPort(proxy);

      const res = await fetchFromProxy(port, "broken.anima", "/page.html");
      expect(res.status).toBe(502);
    });
  });

  describe("non-.anima requests", () => {
    it("returns info page for non-.anima hosts", async () => {
      proxy = new WebProxy(makeConfig());
      await proxy.start();
      const port = await getProxyPort(proxy);

      const res = await fetchFromProxy(port, "example.com", "/");
      expect(res.status).toBe(200);
      expect(res.body).toContain("Anima Web Proxy");
    });
  });

  describe("stats", () => {
    it("tracks request counts", async () => {
      const webHost = createMockWebHost();
      webHost.resolveFile.mockReturnValue({
        site: { domain: "s.anima", name: "S", version: 1 },
        file: { path: "index.html", contentHash: "h", mimeType: "text/html", size: 5 },
        is404: false,
      });

      proxy = new WebProxy(makeConfig({ webHost: webHost as any }));
      await proxy.start();
      const port = await getProxyPort(proxy);

      await fetchFromProxy(port, "s.anima", "/");
      await fetchFromProxy(port, "example.com", "/");

      const stats = proxy.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.resolvedRequests).toBe(1);
      expect(stats.uptime).toBeGreaterThan(0);
    });
  });
});
