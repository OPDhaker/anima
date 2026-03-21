/**
 * memory-core — Built-in memory slot plugin.
 *
 * The actual search/indexing is handled by MemoryIndexManager (src/memory/).
 * This plugin exists so the plugin loader's exclusive-slot system recognises
 * that the built-in memory backend is present and active.
 */

import type { AnimaPluginApi } from "../../src/plugins/types.js";

export default {
  id: "memory-core",
  kind: "memory" as const,
  register(_api: AnimaPluginApi) {
    // No-op — MemoryIndexManager is wired directly by the search-manager.
    // This plugin satisfies the "memory" slot so the loader stops warning.
  },
};
