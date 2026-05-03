/**
 * Tests for Stripe Checkout — config resolution + webhook verification.
 * No live Stripe keys needed — tests pure functions only.
 */

import { createHmac } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../logging/subsystem.js", () => {
  const noop = () => {};
  return { createSubsystemLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) };
});

import {
  resolveStripeConfig,
  verifyWebhookSignature,
  isStripeConfigured,
} from "./stripe-checkout.js";

describe("Stripe Checkout", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("resolveStripeConfig", () => {
    it("returns null when no env vars set", () => {
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      expect(resolveStripeConfig()).toBeNull();
    });

    it("returns config when env vars are set", () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_456";

      const config = resolveStripeConfig();
      expect(config).not.toBeNull();
      expect(config!.secretKey).toBe("sk_test_123");
      expect(config!.webhookSecret).toBe("whsec_test_456");
    });

    it("uses default base URL", () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_456";

      const config = resolveStripeConfig();
      expect(config!.baseUrl).toContain("noxsoft");
    });

    it("uses custom base URL from env", () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_456";
      process.env.NOXSOFT_BASE_URL = "https://custom.example.com";

      const config = resolveStripeConfig();
      expect(config!.baseUrl).toBe("https://custom.example.com");
    });
  });

  describe("verifyWebhookSignature", () => {
    const secret = "whsec_test_secret_123";

    function signPayload(payload: string, timestamp: number): string {
      const signedPayload = `${timestamp}.${payload}`;
      const signature = createHmac("sha256", secret).update(signedPayload).digest("hex");
      return `t=${timestamp},v1=${signature}`;
    }

    it("verifies a valid signature and returns parsed event", () => {
      const payload = '{"type":"checkout.session.completed"}';
      const timestamp = Math.floor(Date.now() / 1000);
      const header = signPayload(payload, timestamp);

      const result = verifyWebhookSignature(payload, header, secret);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("checkout.session.completed");
    });

    it("returns null for tampered payload", () => {
      const payload = '{"type":"checkout.session.completed"}';
      const timestamp = Math.floor(Date.now() / 1000);
      const header = signPayload(payload, timestamp);

      expect(verifyWebhookSignature("tampered", header, secret)).toBeNull();
    });

    it("returns null for invalid signature header", () => {
      expect(verifyWebhookSignature("payload", "invalid-header", secret)).toBeNull();
    });

    it("returns null for expired timestamps (>5 min old)", () => {
      const payload = '{"type":"test"}';
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400;
      const header = signPayload(payload, oldTimestamp);

      expect(verifyWebhookSignature(payload, header, secret)).toBeNull();
    });
  });

  describe("isStripeConfigured", () => {
    it("returns false when no keys", () => {
      delete process.env.STRIPE_SECRET_KEY;
      expect(isStripeConfigured()).toBe(false);
    });

    it("returns true when keys present", () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_456";
      expect(isStripeConfigured()).toBe(true);
    });
  });
});
