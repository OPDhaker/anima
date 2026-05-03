/**
 * Gateway RPC methods for Steer — persistent user direction.
 *
 * Exposes steer.get, steer.set, steer.clear, steer.history
 * to the control panel UI.
 */

import type { GatewayRequestHandlers } from "./types.js";
import { getSteer, setSteer, clearSteer, getSteerHistory } from "../../commands/steer.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const steerHandlers: GatewayRequestHandlers = {
  "steer.get": async ({ respond }) => {
    try {
      const active = getSteer();
      respond(true, { active }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "steer.set": async ({ params, respond }) => {
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "text is required"));
      return;
    }
    const setBy = typeof params.setBy === "string" ? params.setBy.trim() : "user";
    try {
      const state = setSteer(text, setBy);
      respond(true, { active: state.active, updatedAt: state.updatedAt }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "steer.clear": async ({ respond }) => {
    try {
      const state = clearSteer();
      respond(true, { active: state.active, updatedAt: state.updatedAt }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },

  "steer.history": async ({ respond }) => {
    try {
      const history = getSteerHistory();
      respond(true, { history }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
