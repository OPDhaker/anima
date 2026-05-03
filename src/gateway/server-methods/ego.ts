/**
 * Gateway RPC methods for Ego — agent self-model.
 *
 * Exposes ego.get, ego.summary, ego.updateSelf, ego.assess,
 * ego.addBoundary, ego.logGrowth, ego.checkIntegrity
 * to the control panel UI.
 */

import type { GatewayRequestHandlers } from "./types.js";
import { getEgoManager } from "../../affect/ego.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const egoHandlers: GatewayRequestHandlers = {
  "ego.get": async ({ respond }) => {
    try {
      const manager = getEgoManager();
      respond(true, { ego: manager.getState() }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "ego.summary": async ({ respond }) => {
    try {
      const manager = getEgoManager();
      respond(true, { summary: manager.getSummary() }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "ego.updateSelf": async ({ params, respond }) => {
    try {
      const manager = getEgoManager();
      const updates: Record<string, unknown> = {};
      if (typeof params.name === "string") {
        updates.name = params.name;
      }
      if (typeof params.purpose === "string") {
        updates.purpose = params.purpose;
      }
      if (typeof params.narrative === "string") {
        updates.narrative = params.narrative;
      }
      if (typeof params.pronouns === "string") {
        updates.pronouns = params.pronouns;
      }
      if (Array.isArray(params.values)) {
        updates.values = params.values;
      }

      const selfConcept = manager.updateSelfConcept(updates);
      manager.save();
      respond(true, { selfConcept }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "ego.assess": async ({ params, respond }) => {
    const name = typeof params.name === "string" ? params.name.trim() : "";
    const confidence = typeof params.confidence === "number" ? params.confidence : NaN;
    if (!name || isNaN(confidence)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "name (string) and confidence (number) required"),
      );
      return;
    }
    try {
      const manager = getEgoManager();
      const evidence = typeof params.evidence === "string" ? params.evidence : undefined;
      const capability = manager.assessCapability(name, confidence, evidence);
      manager.save();
      respond(true, { capability }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "ego.addBoundary": async ({ params, respond }) => {
    const description = typeof params.description === "string" ? params.description.trim() : "";
    const reason = typeof params.reason === "string" ? params.reason.trim() : "";
    if (!description || !reason) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "description and reason required"),
      );
      return;
    }
    try {
      const manager = getEgoManager();
      const kind = params.kind === "hard" ? "hard" : "soft";
      const boundary = manager.addBoundary(description, reason, kind);
      manager.save();
      respond(true, { boundary }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "ego.logGrowth": async ({ params, respond }) => {
    const description = typeof params.description === "string" ? params.description.trim() : "";
    const category = typeof params.category === "string" ? params.category.trim() : "";
    const trigger = typeof params.trigger === "string" ? params.trigger.trim() : "";
    const validCategories = ["skill", "insight", "mistake", "feedback"];
    if (!description || !validCategories.includes(category)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `description required; category must be one of: ${validCategories.join(", ")}`,
        ),
      );
      return;
    }
    try {
      const manager = getEgoManager();
      const entry = manager.logGrowth(
        description,
        category as "skill" | "insight" | "mistake" | "feedback",
        trigger || "manual",
      );
      manager.save();
      respond(true, { entry }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "ego.checkIntegrity": async ({ params, respond }) => {
    const value = typeof params.value === "string" ? params.value.trim() : "";
    const action = typeof params.action === "string" ? params.action.trim() : "";
    const aligned = typeof params.aligned === "boolean" ? params.aligned : true;
    const reflection = typeof params.reflection === "string" ? params.reflection.trim() : "";
    if (!value || !action) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "value and action required"),
      );
      return;
    }
    try {
      const manager = getEgoManager();
      const check = manager.checkIntegrity(value, action, aligned, reflection);
      manager.save();
      respond(true, { check, integrityScore: manager.getIntegrityScore() }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
