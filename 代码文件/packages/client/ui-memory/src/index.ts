/**
 * Memory plugin, node half. Pure UI plugin: the empty apply exists so the
 * package appears as an ordinary Loader row; the browser half in
 * `src/client/` owns every contribution and is discovered through the
 * package.json `dsh.client` declaration.
 * @module @deepseek-ai/dsh-client-ui-memory
 */

/** Host plugin body — this surface plugin has no host-side behavior. */
export function apply(): void {}
