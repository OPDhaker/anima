/**
 * Tests for Device Identity — Ed25519 key generation, signing, verification.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tmpDir: string;

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tmpDir,
}));

import {
  loadOrCreateDeviceIdentity,
  signDevicePayload,
  verifyDeviceSignature,
  deriveDeviceIdFromPublicKey,
  normalizeDevicePublicKeyBase64Url,
  publicKeyRawBase64UrlFromPem,
} from "./device-identity.js";

describe("Device Identity", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anima-deviceid-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadOrCreateDeviceIdentity", () => {
    it("generates a new identity on first call", () => {
      const idFile = path.join(tmpDir, "device.json");
      const identity = loadOrCreateDeviceIdentity(idFile);

      expect(identity.deviceId).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
      expect(identity.publicKeyPem).toContain("BEGIN PUBLIC KEY");
      expect(identity.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    });

    it("persists identity to disk", () => {
      const idFile = path.join(tmpDir, "device.json");
      loadOrCreateDeviceIdentity(idFile);
      expect(fs.existsSync(idFile)).toBe(true);
    });

    it("reloads same identity on subsequent calls", () => {
      const idFile = path.join(tmpDir, "device.json");
      const first = loadOrCreateDeviceIdentity(idFile);
      const second = loadOrCreateDeviceIdentity(idFile);

      expect(first.deviceId).toBe(second.deviceId);
      expect(first.publicKeyPem).toBe(second.publicKeyPem);
    });

    it("regenerates on corrupt file", () => {
      const idFile = path.join(tmpDir, "device.json");
      fs.mkdirSync(path.dirname(idFile), { recursive: true });
      fs.writeFileSync(idFile, "not json");

      const identity = loadOrCreateDeviceIdentity(idFile);
      expect(identity.deviceId).toMatch(/^[a-f0-9]{64}$/);
    });

    it("sets restrictive file permissions", () => {
      const idFile = path.join(tmpDir, "device.json");
      loadOrCreateDeviceIdentity(idFile);

      const stats = fs.statSync(idFile);
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe("signDevicePayload + verifyDeviceSignature", () => {
    it("signs and verifies a payload", () => {
      const idFile = path.join(tmpDir, "device.json");
      const identity = loadOrCreateDeviceIdentity(idFile);

      const payload = "hello world";
      const signature = signDevicePayload(identity.privateKeyPem, payload);

      expect(signature).toBeTruthy();
      expect(typeof signature).toBe("string");

      const valid = verifyDeviceSignature(identity.publicKeyPem, payload, signature);
      expect(valid).toBe(true);
    });

    it("rejects tampered payload", () => {
      const idFile = path.join(tmpDir, "device.json");
      const identity = loadOrCreateDeviceIdentity(idFile);

      const signature = signDevicePayload(identity.privateKeyPem, "original");
      const valid = verifyDeviceSignature(identity.publicKeyPem, "tampered", signature);
      expect(valid).toBe(false);
    });

    it("rejects wrong public key", () => {
      const id1 = loadOrCreateDeviceIdentity(path.join(tmpDir, "dev1.json"));
      const id2 = loadOrCreateDeviceIdentity(path.join(tmpDir, "dev2.json"));

      const signature = signDevicePayload(id1.privateKeyPem, "test");
      const valid = verifyDeviceSignature(id2.publicKeyPem, "test", signature);
      expect(valid).toBe(false);
    });

    it("handles invalid signature gracefully", () => {
      const idFile = path.join(tmpDir, "device.json");
      const identity = loadOrCreateDeviceIdentity(idFile);

      expect(verifyDeviceSignature(identity.publicKeyPem, "test", "invalid-sig")).toBe(false);
    });
  });

  describe("deriveDeviceIdFromPublicKey", () => {
    it("derives device ID from PEM public key", () => {
      const idFile = path.join(tmpDir, "device.json");
      const identity = loadOrCreateDeviceIdentity(idFile);

      const derivedId = deriveDeviceIdFromPublicKey(identity.publicKeyPem);
      expect(derivedId).toBe(identity.deviceId);
    });

    it("derives from base64url key too", () => {
      const idFile = path.join(tmpDir, "device.json");
      const identity = loadOrCreateDeviceIdentity(idFile);
      const raw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);
      const derived = deriveDeviceIdFromPublicKey(raw);
      expect(derived).toBeTruthy();
      expect(derived).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("normalizeDevicePublicKeyBase64Url", () => {
    it("normalizes PEM to base64url", () => {
      const idFile = path.join(tmpDir, "device.json");
      const identity = loadOrCreateDeviceIdentity(idFile);

      const normalized = normalizeDevicePublicKeyBase64Url(identity.publicKeyPem);
      expect(normalized).toBeTruthy();
      expect(normalized).not.toContain("+");
      expect(normalized).not.toContain("/");
      expect(normalized).not.toContain("=");
    });

    it("handles non-PEM base64url input", () => {
      // Non-PEM input gets base64-decoded and re-encoded (round-trip)
      const result = normalizeDevicePublicKeyBase64Url("AAAA");
      expect(result).toBeTruthy();
    });
  });

  describe("publicKeyRawBase64UrlFromPem", () => {
    it("extracts raw public key bytes as base64url", () => {
      const idFile = path.join(tmpDir, "device.json");
      const identity = loadOrCreateDeviceIdentity(idFile);

      const raw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);
      expect(raw).toBeTruthy();
      expect(raw.length).toBe(43); // 32 bytes → 43 base64url chars
    });
  });

  describe("cross-format verification", () => {
    it("verifies with base64url public key", () => {
      const idFile = path.join(tmpDir, "device.json");
      const identity = loadOrCreateDeviceIdentity(idFile);

      const raw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);
      const payload = "cross-format test";
      const sig = signDevicePayload(identity.privateKeyPem, payload);

      const valid = verifyDeviceSignature(raw, payload, sig);
      expect(valid).toBe(true);
    });
  });
});
