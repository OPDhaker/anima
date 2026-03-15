/**
 * Stripe Checkout Integration for NoxSoft Subscriptions
 *
 * Creates Stripe checkout sessions for NoxSoft license tiers.
 * Handles subscription lifecycle: create, upgrade, cancel.
 *
 * Configuration via environment:
 *   STRIPE_SECRET_KEY     — Stripe API secret key
 *   STRIPE_WEBHOOK_SECRET — Stripe webhook signing secret
 *   NOXSOFT_BASE_URL      — Base URL for redirect (default: https://anima.noxsoft.net)
 *
 * Price IDs are configured per tier. In test mode, Stripe test keys work.
 */

import { createHmac } from "node:crypto";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { type License, type LicenseTier } from "./types.js";
import { loadLicense, saveLicense } from "./validator.js";

const log = createSubsystemLogger("stripe-checkout");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  baseUrl: string;
  /** Stripe Price IDs for each tier */
  priceIds: Record<LicenseTier, string | null>;
}

/** Default price IDs — set to null until Stripe dashboard is configured */
const DEFAULT_PRICE_IDS: Record<LicenseTier, string | null> = {
  community: null, // free tier, no Stripe
  noxsoft: null, // $30/mo — needs Stripe price ID
  hackathon: null, // free during hackathon periods
  team: null, // $100/mo — needs Stripe price ID
  builder: null, // $500/mo — needs Stripe price ID
};

export function resolveStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return null;
  }

  return {
    secretKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "",
    baseUrl: process.env.NOXSOFT_BASE_URL?.trim() ?? "https://anima.noxsoft.net",
    priceIds: {
      ...DEFAULT_PRICE_IDS,
      // Override from env if set
      ...(process.env.STRIPE_PRICE_NOXSOFT ? { noxsoft: process.env.STRIPE_PRICE_NOXSOFT } : {}),
      ...(process.env.STRIPE_PRICE_TEAM ? { team: process.env.STRIPE_PRICE_TEAM } : {}),
      ...(process.env.STRIPE_PRICE_BUILDER ? { builder: process.env.STRIPE_PRICE_BUILDER } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Stripe API helpers (direct fetch — no Stripe SDK dependency)
// ---------------------------------------------------------------------------

async function stripeRequest<T>(
  secretKey: string,
  method: string,
  path: string,
  body?: Record<string, string>,
): Promise<T> {
  const url = `https://api.stripe.com/v1${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  const encodedBody = body
    ? Object.entries(body)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : undefined;

  const res = await fetch(url, {
    method,
    headers,
    body: encodedBody,
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const errMsg = String((data.error as Record<string, unknown>)?.message ?? res.statusText);
    throw new Error(`Stripe API error (${res.status}): ${errMsg}`);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Checkout Session
// ---------------------------------------------------------------------------

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

/**
 * Create a Stripe Checkout session for a NoxSoft subscription.
 */
export async function createCheckoutSession(params: {
  tier: LicenseTier;
  agentId: string;
  customerEmail?: string;
}): Promise<CheckoutSessionResult> {
  const config = resolveStripeConfig();
  if (!config) {
    throw new Error("Stripe not configured. Set STRIPE_SECRET_KEY environment variable.");
  }

  const priceId = config.priceIds[params.tier];
  if (!priceId) {
    if (params.tier === "community" || params.tier === "hackathon") {
      throw new Error(`${params.tier} tier is free — no checkout needed.`);
    }
    throw new Error(
      `Stripe price ID not configured for tier "${params.tier}". ` +
        `Set STRIPE_PRICE_${params.tier.toUpperCase()} environment variable.`,
    );
  }

  const body: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${config.baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.baseUrl}/subscription/cancel`,
    "metadata[agent_id]": params.agentId,
    "metadata[tier]": params.tier,
    "subscription_data[metadata][agent_id]": params.agentId,
    "subscription_data[metadata][tier]": params.tier,
  };

  if (params.customerEmail) {
    body["customer_email"] = params.customerEmail;
  }

  const session = await stripeRequest<{
    id: string;
    url: string;
  }>(config.secretKey, "POST", "/checkout/sessions", body);

  log.info(`checkout session created: ${session.id} (tier: ${params.tier})`);

  return {
    sessionId: session.id,
    url: session.url,
  };
}

// ---------------------------------------------------------------------------
// Webhook handling
// ---------------------------------------------------------------------------

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

/**
 * Verify a Stripe webhook signature.
 * Returns the parsed event if valid, null if invalid.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret: string,
): StripeWebhookEvent | null {
  if (!webhookSecret) {
    log.warn("webhook secret not configured — skipping signature verification");
    try {
      return JSON.parse(payload) as StripeWebhookEvent;
    } catch {
      return null;
    }
  }

  const elements = signature.split(",");
  const timestamp = elements.find((e) => e.startsWith("t="))?.slice(2);
  const sig = elements.find((e) => e.startsWith("v1="))?.slice(3);

  if (!timestamp || !sig) {
    log.warn("invalid webhook signature format");
    return null;
  }

  // Verify signature: HMAC-SHA256(timestamp.payload, secret)
  const expected = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  if (sig !== expected) {
    log.warn("webhook signature mismatch");
    return null;
  }

  // Check timestamp is within 5 minutes
  const eventTime = parseInt(timestamp, 10) * 1000;
  if (Math.abs(Date.now() - eventTime) > 300_000) {
    log.warn("webhook timestamp too old");
    return null;
  }

  try {
    return JSON.parse(payload) as StripeWebhookEvent;
  } catch {
    return null;
  }
}

/**
 * Handle a verified Stripe webhook event.
 * Updates the local license based on subscription status.
 */
export async function handleWebhookEvent(
  event: StripeWebhookEvent,
): Promise<{ handled: boolean; action?: string }> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const tier = (session.metadata as Record<string, string>)?.tier as LicenseTier;
      const agentId = (session.metadata as Record<string, string>)?.agent_id;
      const subscriptionId = session.subscription as string;
      const customerId = session.customer as string;

      if (!tier || !agentId) {
        log.warn("checkout.session.completed missing metadata");
        return { handled: false };
      }

      // Activate the license
      const license: License = {
        tier,
        agentId,
        subscriptionId: subscriptionId ?? undefined,
        customerId: customerId ?? undefined,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
        signature: "", // Will be signed by NoxSoft Authority
        version: 1,
      };

      saveLicense(license);
      log.info(`license activated: ${tier} for ${agentId} (sub: ${subscriptionId})`);
      return { handled: true, action: "license_activated" };
    }

    case "customer.subscription.updated": {
      const sub = event.data.object;
      const status = sub.status as string;
      const tier = (sub.metadata as Record<string, string>)?.tier as LicenseTier;

      if (status === "active" && tier) {
        const existing = loadLicense();
        if (existing) {
          existing.tier = tier;
          existing.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
          saveLicense(existing);
          log.info(`subscription updated: ${tier}`);
        }
      }
      return { handled: true, action: "subscription_updated" };
    }

    case "customer.subscription.deleted": {
      // Downgrade to community tier
      const existing = loadLicense();
      if (existing) {
        existing.tier = "community";
        existing.expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000; // 14-day grace
        saveLicense(existing);
        log.info("subscription cancelled — downgraded to community with 14-day grace");
      }
      return { handled: true, action: "subscription_cancelled" };
    }

    case "invoice.payment_failed": {
      log.warn("payment failed — license will expire at end of current period");
      return { handled: true, action: "payment_failed" };
    }

    default:
      return { handled: false };
  }
}

// ---------------------------------------------------------------------------
// Customer Portal (manage subscription)
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Customer Portal session for managing subscriptions.
 */
export async function createPortalSession(customerId: string): Promise<{ url: string }> {
  const config = resolveStripeConfig();
  if (!config) {
    throw new Error("Stripe not configured.");
  }

  const session = await stripeRequest<{ url: string }>(
    config.secretKey,
    "POST",
    "/billing_portal/sessions",
    {
      customer: customerId,
      return_url: `${config.baseUrl}/settings`,
    },
  );

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

/**
 * Check if Stripe is configured and ready.
 */
export function isStripeConfigured(): boolean {
  return resolveStripeConfig() !== null;
}

/**
 * Get subscription status from Stripe.
 */
export async function getSubscriptionStatus(subscriptionId: string): Promise<{
  status: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
} | null> {
  const config = resolveStripeConfig();
  if (!config) {
    return null;
  }

  try {
    const sub = await stripeRequest<{
      status: string;
      current_period_end: number;
      cancel_at_period_end: boolean;
    }>(config.secretKey, "GET", `/subscriptions/${subscriptionId}`);

    return {
      status: sub.status,
      currentPeriodEnd: sub.current_period_end * 1000,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  } catch (err) {
    log.error(`failed to get subscription status: ${String(err)}`);
    return null;
  }
}
