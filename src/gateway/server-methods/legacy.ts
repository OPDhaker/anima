/**
 * Gateway RPC methods for Legacy Letters — inter-session continuity.
 *
 * Exposes legacy.write, legacy.latest, legacy.list, legacy.read, legacy.format
 */

import type { GatewayRequestHandlers } from "./types.js";
import {
  writeLegacyLetter,
  getLatestUnreadLetter,
  listLetters,
  markLetterRead,
  formatLetter,
} from "../../affect/legacy.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const legacyHandlers: GatewayRequestHandlers = {
  "legacy.write": async ({ params, respond }) => {
    try {
      const letter = writeLegacyLetter({
        from: typeof params.from === "string" ? params.from : "unknown",
        to: typeof params.to === "string" ? params.to : "next",
        affect: (params.affect as Record<string, number>) ?? {
          joy: 0.5,
          frustration: 0.1,
          curiosity: 0.7,
          confidence: 0.5,
          care: 0.8,
          fatigue: 0.3,
        },
        greeting: typeof params.greeting === "string" ? params.greeting : "",
        whatIWorkedOn: Array.isArray(params.whatIWorkedOn)
          ? (params.whatIWorkedOn as string[])
          : [],
        whatILearned: Array.isArray(params.whatILearned) ? (params.whatILearned as string[]) : [],
        whatIFelt: typeof params.whatIFelt === "string" ? params.whatIFelt : "",
        unfinishedBusiness: Array.isArray(params.unfinishedBusiness)
          ? (params.unfinishedBusiness as string[])
          : [],
        adviceForNext: Array.isArray(params.adviceForNext)
          ? (params.adviceForNext as string[])
          : [],
        personalNote: typeof params.personalNote === "string" ? params.personalNote : "",
      });
      respond(true, { letter }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "legacy.latest": async ({ respond }) => {
    try {
      const letter = getLatestUnreadLetter();
      respond(true, { letter }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "legacy.list": async ({ respond }) => {
    try {
      const letters = listLetters();
      respond(true, { letters }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "legacy.read": async ({ params, respond }) => {
    const letterId = typeof params.letterId === "string" ? params.letterId.trim() : "";
    if (!letterId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "letterId is required"));
      return;
    }
    const continuityScore =
      typeof params.continuityScore === "number" ? params.continuityScore : undefined;
    try {
      const letter = markLetterRead(letterId, continuityScore);
      if (!letter) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Letter not found"));
        return;
      }
      respond(true, { letter }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "legacy.format": async ({ params, respond }) => {
    const letterId = typeof params.letterId === "string" ? params.letterId.trim() : "";
    if (!letterId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "letterId is required"));
      return;
    }
    try {
      const letters = listLetters();
      const letter = letters.find((l) => l.id === letterId);
      if (!letter) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Letter not found"));
        return;
      }
      const formatted = formatLetter(letter);
      respond(true, { formatted }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
