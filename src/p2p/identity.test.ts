/**
 * Tests for P2P Identity — X25519 keypair persistence.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return { createSubsystemLogger: () => logger };
});

import { base64UrlEncode } from "./crypto.js";
import { loadOrCreatePeerKeypair, buildPeerIdentity } from "./identity.js";

describe("P2P Identity", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-identity-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadOrCreatePeerKeypair", () => {
    it("generates a new keypair on first call", () => {
      const keyFile = path.join(tmpDir, "peer-keys.json");
      const keypair = loadOrCreatePeerKeypair(keyFile);

      expect(keypair.publicKey.length).toBe(32); // X25519 = 32 bytes
      expect(keypair.privateKey.length).toBe(32);
    });

    it("persists keypair to disk", () => {
      const keyFile = path.join(tmpDir, "peer-keys.json");
      loadOrCreatePeerKeypair(keyFile);

      expect(fs.existsSync(keyFile)).toBe(true);
      const stored = JSON.parse(fs.readFileSync(keyFile, "utf8"));
      expect(stored.version).toBe(1);
      expect(stored.x25519PublicKey).toBeTruthy();
      expect(stored.x25519PrivateKey).toBeTruthy();
    });

    it("reloads the same keypair on subsequent calls", () => {
      const keyFile = path.join(tmpDir, "peer-keys.json");
      const first = loadOrCreatePeerKeypair(keyFile);
      const second = loadOrCreatePeerKeypair(keyFile);

      expect(Buffer.from(first.publicKey).equals(Buffer.from(second.publicKey))).toBe(true);
      expect(Buffer.from(first.privateKey).equals(Buffer.from(second.privateKey))).toBe(true);
    });

    it("regenerates if file is corrupt", () => {
      const keyFile = path.join(tmpDir, "peer-keys.json");
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(keyFile, "not valid json");

      const keypair = loadOrCreatePeerKeypair(keyFile);
      expect(keypair.publicKey.length).toBe(32);
    });

    it("regenerates if version is wrong", () => {
      const keyFile = path.join(tmpDir, "peer-keys.json");
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(
        keyFile,
        JSON.stringify({ version: 99, x25519PublicKey: "x", x25519PrivateKey: "y" }),
      );

      const keypair = loadOrCreatePeerKeypair(keyFile);
      expect(keypair.publicKey.length).toBe(32);
    });

    it("sets restrictive file permissions (0o600)", () => {
      const keyFile = path.join(tmpDir, "peer-keys.json");
      loadOrCreatePeerKeypair(keyFile);

      const stats = fs.statSync(keyFile);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe("buildPeerIdentity", () => {
    it("combines device identity with peer keypair", () => {
      const keyFile = path.join(tmpDir, "peer-keys.json");
      const keypair = loadOrCreatePeerKeypair(keyFile);

      const identity = buildPeerIdentity(
        {
          deviceId: "test-device-123",
          publicKeyPem: "pem-data",
          privateKeyPem: "private-pem",
        } as any,
        keypair,
      );

      expect(identity.deviceId).toBe("test-device-123");
      expect(identity.ed25519PublicKeyPem).toBe("pem-data");
      expect(identity.x25519PublicKey).toEqual(keypair.publicKey);
      expect(identity.x25519PublicKeyBase64).toBe(base64UrlEncode(keypair.publicKey));
    });
  });
});
