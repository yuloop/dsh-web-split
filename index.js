/**
 * Host half of dsh-web-split (free split screen for DSH Web).
 *
 * The feature lives entirely in the browser: `client.js` registers a `main`
 * panel ("split") plus the sidebar entry that opens it, and renders one
 * embedded Conversation occurrence per pane through the official slot seams
 * (`SessionProvider` + `renderFactorySlot("conversation.content")`, the same
 * pair `@deepseek-ai/dsh-client-ui-subagent` uses for its sidebar chat).
 *
 * Nothing here talks to the Session domain, so this half only announces the
 * bundle. Keeping it non-empty is required: the loader patch entry must name a
 * module, and the client roster is generated from the package's `dsh.client`
 * declaration.
 */
export const inject = [];

export const name = "web-split";

export function apply(ctx) {
  ctx.logger?.info?.("web-split: host bundle loaded (the client half registers the split panel)");
}
