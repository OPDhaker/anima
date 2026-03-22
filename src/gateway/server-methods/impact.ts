import type { GatewayRequestHandlers } from "./types.js";
import { buildImpactFootprintFeed } from "../../impact/footprint.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const impactHandlers: GatewayRequestHandlers = {
  "impact.footprint.get": async ({ respond }) => {
    try {
      const feed = buildImpactFootprintFeed();
      respond(true, feed, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
