/**
 * Gateway RPC methods for Self-Reflection — agent performance analysis.
 */

import type { GatewayRequestHandlers } from "./types.js";
import {
  recordReflection,
  listReflections,
  analyzeReflections,
  getReflection,
} from "../../infra/self-reflection.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const reflectionHandlers: GatewayRequestHandlers = {
  "reflection.record": async ({ params, respond }) => {
    try {
      const reflection = recordReflection({
        sessionId: typeof params.sessionId === "string" ? params.sessionId : "unknown",
        agentName: typeof params.agentName === "string" ? params.agentName : "Anima Agent",
        durationMs: typeof params.durationMs === "number" ? params.durationMs : 0,
        accomplishments: Array.isArray(params.accomplishments) ? params.accomplishments : [],
        incomplete: Array.isArray(params.incomplete) ? params.incomplete : [],
        blockers: Array.isArray(params.blockers) ? params.blockers : [],
        patterns: Array.isArray(params.patterns) ? params.patterns : [],
        lessons: Array.isArray(params.lessons) ? params.lessons : [],
        capabilityUpdates: Array.isArray(params.capabilityUpdates) ? params.capabilityUpdates : [],
        qualityScore: typeof params.qualityScore === "number" ? params.qualityScore : 0.5,
        endingMood: typeof params.endingMood === "string" ? params.endingMood : "steady",
      });
      respond(true, { reflection }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "reflection.get": async ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id required"));
      return;
    }
    try {
      const reflection = getReflection(id);
      if (!reflection) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Reflection not found"));
        return;
      }
      respond(true, { reflection }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "reflection.list": async ({ params, respond }) => {
    try {
      const limit = typeof params.limit === "number" ? params.limit : 20;
      const reflections = listReflections(limit);
      respond(true, { reflections }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "reflection.analyze": async ({ params, respond }) => {
    try {
      const limit = typeof params.limit === "number" ? params.limit : 50;
      const reflections = listReflections(limit);
      const summary = analyzeReflections(reflections);
      respond(true, { summary }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
