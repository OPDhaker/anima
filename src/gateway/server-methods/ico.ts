import type { GatewayRequestHandlers } from "./types.js";
import { buildIcoPublicMetricsFeed } from "../../ico/public-metrics.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const icoHandlers: GatewayRequestHandlers = {
  "ico.metrics.get": async ({ respond }) => {
    try {
      const feed = buildIcoPublicMetricsFeed();
      respond(true, feed, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
