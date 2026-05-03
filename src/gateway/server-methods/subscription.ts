/**
 * Gateway RPC methods for Subscription / Stripe checkout.
 *
 * Exposes subscription.status, subscription.checkout, subscription.portal
 * to the control panel UI.
 */

import type { GatewayRequestHandlers } from "./types.js";
import {
  isStripeConfigured,
  createCheckoutSession,
  createPortalSession,
  getSubscriptionStatus,
} from "../../license/stripe-checkout.js";
import { loadLicense } from "../../license/validator.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const subscriptionHandlers: GatewayRequestHandlers = {
  "subscription.status": async ({ respond }) => {
    try {
      const license = loadLicense();
      const stripeReady = isStripeConfigured();

      if (!license) {
        respond(
          true,
          {
            tier: "community",
            stripeConfigured: stripeReady,
            active: true,
            message: "Running on community (free) tier.",
          },
          undefined,
        );
        return;
      }

      // Check if subscription is still active via Stripe
      let stripeStatus = null;
      if (license.subscriptionId && stripeReady) {
        stripeStatus = await getSubscriptionStatus(license.subscriptionId);
      }

      respond(
        true,
        {
          tier: license.tier,
          active: !license.expiresAt || license.expiresAt > Date.now(),
          expiresAt: license.expiresAt,
          stripeConfigured: stripeReady,
          subscriptionId: license.subscriptionId,
          stripeStatus: stripeStatus?.status,
          cancelAtPeriodEnd: stripeStatus?.cancelAtPeriodEnd,
        },
        undefined,
      );
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "subscription.checkout": async ({ params, respond }) => {
    const tier = typeof params.tier === "string" ? params.tier.trim() : "";
    if (!tier) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tier is required"));
      return;
    }

    try {
      const result = await createCheckoutSession({
        tier: tier as "noxsoft" | "team" | "builder",
        agentId: typeof params.agentId === "string" ? params.agentId : "default",
        customerEmail: typeof params.email === "string" ? params.email : undefined,
      });

      respond(true, { sessionId: result.sessionId, checkoutUrl: result.url }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "subscription.portal": async ({ params, respond }) => {
    try {
      const license = loadLicense();
      const customerId =
        typeof params.customerId === "string"
          ? params.customerId
          : (license as Record<string, unknown>)?.customerId;

      if (!customerId || typeof customerId !== "string") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "No customer ID found. Purchase a subscription first.",
          ),
        );
        return;
      }

      const result = await createPortalSession(customerId);
      respond(true, { portalUrl: result.url }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
