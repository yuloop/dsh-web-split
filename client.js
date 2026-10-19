/**
 * Client half of the dsh WebUI split-screen plugin (split-tree edition).
 *
 * Shape of the feature
 *   - a `main` panel (key `split`) reachable from the sidebar panel list,
 *   - a SPLIT TREE of panes: every divider belongs to its own split node with
 *     its own ratio, so each pane's size is adjustable independently, and the
 *     recursive layout keeps every edge aligned with no gaps,
 *   - no placeholder panes: the panel opens with ONE pane holding the newest
 *     session, and panes only appear when the user splits or drops a session.
 *     Three sessions means three panes, never three panes plus a blank,
 *   - the OFFICIAL sidebar session list is the picker. dsh already makes every
 *     non-blank session row `draggable` and writes the session id into
 *     `dataTransfer` as `text/plain`, so this plugin accepts that drop on its
 *     canvas; and it adds one button to the row's official
 *     `sidebar.workspaces.session.row.action` seat so a click loads the
 *     session into the active pane. No official code is touched and no
 *     duplicate list is rendered,
 *   - per-pane layout persistence in this plugin's own localStorage key.
 *
 * How a second (third, …) conversation is rendered without touching dsh code
 *   The official seams, exactly as `@deepseek-ai/dsh-client-ui-subagent`
 *   renders an embedded conversation in the right sidebar:
 *     - `ctx.sessions.retain(sessionId, { source: "splitPane", signal })`
 *       yields a `SessionReference` for ANY session, not just the selected one,
 *     - `<SessionProvider session={reference}>` publishes that session as the
 *       ambient scope binding for its subtree,
 *     - `renderFactorySlot("conversation.content", { variant: "embedded" })`
 *       renders the shared Conversation factory under that binding.
 *   The pane body is a declared child slot (`split.pane.body`, scope
 *   `session-maybe`) so the kit hands us `SessionProvider`; rendering it
 *   inside the provider makes the factory resolve the pane's session.
 *
 * Uninstall = drop the `- insert:` row from the profile patch and delete this
 * directory. dsh upgrades only invalidate the plugin if the slot seams above
 * change.
 */
window.__ModuleLoader__.load({
  id: "@local/dsh-web-split",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    const NS = "split";
    const PANEL_ID = "split";
    /** Own storage key; the plugin never reads or writes any other key. */
    const STORAGE_KEY = "dsh-split-layout-v3";
    /** Panes whose composer editor is raised to four lines (see the header ⇕). */
    const DOCK_TALL_KEY = "dsh-split-docktall-v1";
    const MAX_PANES = 6;
    /** Smallest share of a split either side may keep. */
    const MIN_RATIO = 0.15;
    /**
     * Share every fresh cut starts with, and the share a double-click restores
     * when it flips a split. 0.5 is the two-column default the "import running"
     * layout uses for every two-way cut; a dragged divider overrides it for that
     * one split only and is never reset by anything else.
     */
    const DEFAULT_RATIO = 0.5;
    /** Pointer travel (px) that turns a press into a drag instead of a click. */
    const DRAG_SLOP = 2;
    /** Retention label reported by `retainInfo`; declaration-merge extensible. */
    const RETAIN_SOURCE = "splitPane";
    /** The label the main tab uses; borrowed for one tick to mark a session read. */
    const MAIN_VIEW_SOURCE = "mainView";
    /** Input types the right-click menu treats as a text field. */
    // `number` and `email` are deliberately absent: neither exposes the selection
    // API, so a caret-aware insert would read `selectionStart`/`setRangeText` on an
    // input that throws (or that the browser refuses to place a caret in).
    const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "password", "tel"]);

    /**
     * One definition of "this is a text field", shared by the paste row
     * (`editableFrom`) and the double-click zoom guard (`textPointAt`): two
     * copies would drift apart the moment one of them learns a new spelling.
     */
    const FIELD_SELECTOR = "textarea, input, [contenteditable='true'], [contenteditable='']";

    /** Captured client context (sessions service) and locale translator. */
    let hostCtx = null;
    let translator = (key) => key;
    /**
     * Bridge from the official session-row button to the mounted panel. The
     * row action is its own slot entry, so it cannot reach the panel's React
     * state directly. A subscribable store keeps hundreds of row buttons cheap:
     * they render nothing until a panel is mounted, and one notification wakes
     * them all when that changes.
     */
    const bridgeStore = {
      value: null,
      listeners: new Set()
    };

    function publishBridge(next) {
      bridgeStore.value = next;
      for (const listener of [...bridgeStore.listeners]) listener();
    }

    function subscribeBridge(listener) {
      bridgeStore.listeners.add(listener);
      return () => bridgeStore.listeners.delete(listener);
    }

    function readBridge() {
      return bridgeStore.value;
    }

    const zh = {
      panel: "分屏",
      hint: "从左侧会话列表拖一行到窗格；拖到已占用的窗格会把它拆成两半；双击分隔线可横竖翻转并回到默认对半分",
      dividerRotate: "双击横竖翻转这一刀，并回到默认对半分",
      hintMove: "拖到窗格边缘=把窗格挪到那边；拖正中间=交换两个窗格的会话",
      paneEmpty: "从左侧会话列表拖一行到这里",
      paneEmptyAlt: "或点该行尾的「放入分屏」按钮",
      paneNew: "新建会话",
      paneClosed: "会话已不存在",
      paneFocusHint: "已选中：新的会话会放进这个窗格",
      paneDragHint: "拖到另一个窗格上松开 = 交换两个窗格的会话",
      paneSplitCol: "左右拆分",
      paneSplitRow: "上下拆分",
      paneMaximize: "最大化",
      paneRestore: "还原",
      paneDockTall: "放大输入框",
      paneDockRestore: "还原输入框",
      paneClose: "关闭窗格",
      reset: "重置分屏",
      rowAction: "放入分屏窗格",
      importRunning: "导入运行中 ({count})",
      importTitle: "把运行中的会话一键分屏（替换当前布局，会话不会关闭）",
      importNone: "没有运行中的会话",
      importDone: "已导入 {count} 个运行中的会话",
      importCapped: "运行中 {count} 个，只导入前 {max} 个",
      previewSession: "虚线框 = 松手后的布局，松手即生效",
      ghostEmpty: "空窗格",
      /* Right-click menu on one pane. */
      ctxCopy: "复制文字",
      ctxCopyNone: "没有选中文字",
      ctxCopyFailed: "复制失败：浏览器拒绝了剪贴板写入",
      ctxPaste: "粘贴",
      ctxPasteBlocked: "浏览器未授权读取剪贴板；按住 Shift 右键可用系统菜单粘贴",
      ctxPasteFailed: "没能写入输入框，请点一下输入框再试",
      ctxMove: "移动现有窗格…",
      ctxSplitRight: "向右分屏",
      ctxSplitDown: "向下分屏",
      ctxZoom: "缩放",
      ctxCapped: "窗格数已达上限",
      ctxSingle: "只有一个窗格"
    };
    const en = {
      panel: "Split",
      hint: "Drag a session from the left onto a pane; dropping on an occupied pane splits it; double-click a divider to flip it and restore the 50/50 default",
      dividerRotate: "Double-click to flip this cut and restore the 50/50 default",
      hintMove: "Drop on a pane edge to move the pane there; drop in the middle to swap sessions",
      paneEmpty: "Drag a session here from the left list",
      paneEmptyAlt: "or use the row's \"into split\" button",
      paneNew: "New session",
      paneClosed: "Session no longer exists",
      paneFocusHint: "Selected: new sessions load into this pane",
      paneDragHint: "Drag onto another pane to swap their sessions",
      paneSplitCol: "Split left/right",
      paneSplitRow: "Split top/bottom",
      paneMaximize: "Maximize",
      paneRestore: "Restore",
      paneDockTall: "Enlarge input",
      paneDockRestore: "Restore input",
      paneClose: "Close pane",
      reset: "Reset split",
      rowAction: "Load into split pane",
      importRunning: "Import running ({count})",
      importTitle: "Split all running sessions at once (replaces the layout; sessions keep running)",
      importNone: "No running sessions",
      importDone: "Imported {count} running sessions",
      importCapped: "{count} running, imported the first {max}",
      previewSession: "Dashed boxes = layout after drop; release to apply",
      ghostEmpty: "Empty pane",
      /* Right-click menu on one pane. */
      ctxCopy: "Copy text",
      ctxCopyNone: "Nothing selected",
      ctxCopyFailed: "Copy failed: the browser refused the clipboard write",
      ctxPaste: "Paste",
      ctxPasteBlocked: "Clipboard read is not allowed here; hold Shift and right-click for the system menu",
      ctxPasteFailed: "Could not write into the field — click it once and try again",
      ctxMove: "Move this pane…",
      ctxSplitRight: "Split right",
      ctxSplitDown: "Split down",
      ctxZoom: "Zoom",
      ctxCapped: "Pane limit reached",
      ctxSingle: "Only one pane"
    };

    /* ------------------------------------------------------------------ *
     * Styles — one injected sheet, removed with the plugin's fiber.
     * Only design tokens the app already publishes are referenced.
     * ------------------------------------------------------------------ */
    const CSS = `
.dshSplit_root{display:flex;height:100%;width:100%;min-height:0;min-width:0;overflow:hidden}
.dshSplit_canvas{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden}
.dshSplit_canvas[data-dragging="1"]{user-select:none}
.dshSplit_hint{position:absolute;inset-inline-start:50%;transform:translateX(-50%);top:8px;z-index:8;pointer-events:none;max-width:min(92%,660px);padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);text-align:center}
.dshSplit_tools{position:absolute;inset-inline-end:10px;bottom:10px;z-index:7;display:flex;align-items:center;gap:6px;pointer-events:none}
.dshSplit_note{font-size:11.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 8px;box-shadow:0 4px 12px rgba(0,0,0,.18)}
.dshSplit_ghost{position:absolute;z-index:5;pointer-events:none;box-sizing:border-box;display:flex;align-items:flex-start;padding:8px 10px;border:2px dashed var(--dsw-alias-border-l2);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 10%,transparent);overflow:hidden}
.dshSplit_ghost[data-new="1"]{border-style:solid;border-color:var(--dsw-alias-button-primary-fill);background:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 20%,transparent)}
.dshSplit_ghostLabel{max-width:100%;font-size:12px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshSplit_pane[data-preview="1"]{opacity:.3;transition:opacity .12s}
.dshSplit_pane{
  position:absolute;display:flex;flex-direction:column;min-width:0;min-height:0;
  border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-1);box-sizing:border-box;
  /* Containment keeps a streaming conversation's reflow/repaint inside its own
     pane. It also makes the pane a containing block and clip box for
     descendants, which matters only for an inline fixed-position popup: the
     official menus are portaled to <body> (verified — the composer's permission
     menu inside a pane renders as position:fixed, outside the pane subtree, not
     clipped; paneoverlay.mjs pins that), and this pane was already a positioned
     clipping box for absolute descendants. */
  contain:layout paint;
}
.dshSplit_pane[data-active="1"]{border-color:var(--dsw-alias-button-primary-fill)}
.dshSplit_pane[data-drop="1"]{border-color:var(--dsw-alias-button-primary-fill)}
.dshSplit_pane[data-swap="1"]{border-color:var(--dsw-alias-button-primary-fill)}
.dshSplit_paneHead{display:flex;align-items:center;gap:6px;flex:none;padding:6px 6px 6px 9px;border-bottom:1px solid var(--dsw-alias-border-l2);cursor:grab;touch-action:none;user-select:none}
.dshSplit_paneTitle{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshSplit_iconBtn{appearance:none;flex:none;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:1;padding:3px 5px;cursor:pointer}
.dshSplit_btnGroup{display:inline-flex;align-items:center;gap:12px;flex:none}
.dshSplit_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshSplit_paneBody{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}
/* The official conversation view has an "embedded" variant for panes and tabs.
   It builds its own widths from two custom properties on that element
   (class ..._embeddedBody), capping the message column at 920px and the
   composer card at 952px — so a pane wider than ~950px shows a wide blank on
   both sides (a pane spanning the canvas left 211px each side). Inside a split
   pane the pane *is* the column, so drop the caps and keep the variant's own
   16px side clearance. Scoped to panes: the normal (non-split) view is
   untouched, and on a narrow pane the official value is already
   calc(100% - 32px), so this is a no-op there. The local class suffix
   (_embeddedBody) is stable; only the hash prefix changes between builds. */
.dshSplit_pane [class*="_embeddedBody"]{
  --dsh-chat-content-width:calc(100% - 32px);
  --dsh-composer-card-max-width:calc(100% - 16px);
}
/* Compact composer dock inside panes. The official composer spends 132px of a
   857px pane: 8px card top padding + a 36px one-line editor + a 12px gap + a
   42px toolbar row, plus a 30px metric row (rounds / tokens / context) in its
   own row *under* the card. Panes keep the editor at one line and trim the
   paddings, and — when the pane is wide enough that the toolbar row has a real
   empty middle — float the metric row into that empty middle instead of
   spending its own 30px. Class suffixes below are CSS-module locals and stay
   stable across builds; everything is scoped to a pane. */
.dshSplit_pane [class*="composerStack"] [class*="_card"]{padding-top:4px;gap:6px}
.dshSplit_pane [class*="composerStack"] [class*="_input"]{min-height:32px;padding:2px 8px 0 14px}
.dshSplit_pane [class*="composerStack"] [class*="_row"]{padding:0 8px 4px}
.dshSplit_pane{container-type:inline-size}
@container (min-width:1100px){
  .dshSplit_pane [class*="composerStack"] [class*="_dock"]{position:absolute;right:250px;bottom:10px;height:auto;max-width:52%}
}
/* The pane header can raise the editor to four lines on demand (the dock stays
   one line by default). The official editor already scrolls internally, so a
   larger min-height is enough; the wrappers around it follow its box. */
.dshSplit_pane[data-docktall="1"] [class*="composerStack"] [class*="_input"]{min-height:112px}
.dshSplit_empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:1.6}
.dshSplit_emptySmall{font-size:11.5px;opacity:.8}
.dshSplit_dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary,#3fb950)}
.dshSplit_dotIdle{background:transparent;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.dshSplit_divider{position:absolute;z-index:6;touch-action:none}
.dshSplit_divider[data-axis="col"]{width:9px;margin-inline-start:-4px;cursor:ew-resize}
.dshSplit_divider[data-axis="row"]{height:9px;margin-top:-4px;cursor:ns-resize}
.dshSplit_divider::after{content:"";position:absolute;background:var(--dsw-alias-border-l2)}
.dshSplit_divider[data-axis="col"]::after{top:0;bottom:0;left:4px;width:1px}
.dshSplit_divider[data-axis="row"]::after{left:0;right:0;top:4px;height:1px}
.dshSplit_divider:hover::after,.dshSplit_divider[data-active="1"]::after{background:var(--dsw-alias-button-primary-fill)}
.dshSplit_dragGhost{position:absolute;z-index:8;pointer-events:none;display:none;background:var(--dsw-alias-button-primary-fill);border-radius:2px;box-shadow:0 0 0 1px var(--dsw-alias-bg-layer-1)}
.dshSplit_textBtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 10px;cursor:pointer}
.dshSplit_textBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshSplit_rowBtn{display:inline-flex;align-items:center;justify-content:center}
.dshSplit_menu{position:absolute;z-index:9;min-width:196px;max-width:min(320px,100%);max-height:calc(100% - 8px);overflow:auto;padding:4px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 28px rgba(0,0,0,.30);display:flex;flex-direction:column;gap:1px}
.dshSplit_menuItem{appearance:none;display:flex;align-items:center;width:100%;box-sizing:border-box;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.4;padding:6px 9px;text-align:start;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshSplit_menuItem:hover:not(:disabled),.dshSplit_menuItem:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
.dshSplit_menuItem:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dshSplit_menuSep{flex:none;height:1px;margin:4px 2px;background:var(--dsw-alias-border-l2)}
`;

    /* ------------------------------------------------------------------ *
     * Split tree — every divider is its own node with its own ratio, so each
     * pane is independently sizable; the recursive layout keeps all edges
     * aligned by construction.
     * ------------------------------------------------------------------ */

    function clamp(value, lo, hi) {
      return value < lo ? lo : value > hi ? hi : value;
    }

    function newId(prefix) {
      return `${prefix}${Math.random().toString(36).slice(2, 8)}`;
    }

    function makePane(sessionId) {
      return { kind: "pane", id: newId("p"), sessionId: sessionId ?? null };
    }

    function makeSplit(dir, a, b, ratio) {
      return { kind: "split", id: newId("s"), dir, ratio: ratio ?? DEFAULT_RATIO, a, b };
    }

    function defaultTree() {
      return makePane(null);
    }

    /** Walk the tree depth-first, root first; `visit(node)` sees every node. */
    function walk(node, visit) {
      if (!node) return;
      visit(node);
      if (node.kind === "split") {
        walk(node.a, visit);
        walk(node.b, visit);
      }
    }

    function findPane(node, paneId) {
      let found = null;
      walk(node, (candidate) => {
        if (candidate.kind === "pane" && candidate.id === paneId) found = candidate;
      });
      return found;
    }

    /**
     * The pane in view when the user never touched one: an unsplit tree has
     * exactly one pane, and that is what they are looking at.
     */
    function lonePane(node) {
      return node && node.kind === "pane" ? node : null;
    }

    function countPanes(node) {
      let count = 0;
      walk(node, (candidate) => {
        if (candidate.kind === "pane") count += 1;
      });
      return count;
    }

    /** Replace one node in the tree, returning a new tree. */
    function replaceNode(node, targetId, factory) {
      if (node.id === targetId) return factory(node);
      if (node.kind !== "split") return node;
      return { ...node, a: replaceNode(node.a, targetId, factory), b: replaceNode(node.b, targetId, factory) };
    }

    /** Turn one pane into a split holding that pane plus a fresh empty one. */
    function splitPaneAt(root, paneId, dir) {
      if (countPanes(root) >= MAX_PANES) return root;
      return replaceNode(root, paneId, (node) => {
        if (node.kind !== "pane") return node;
        return makeSplit(dir, node, makePane(null));
      });
    }

    /**
     * Move one pane beside another: remove it from its parent (collapsing that
     * split) and re-insert it as a new half of the target pane. When the target
     * touches the canvas on that side the split is applied to the ROOT instead,
     * so the moved pane becomes a full-height column / full-width row — that is
     * what turns "two over one" into "one beside two".
     */
    function movePaneBeside(root, sourceId, targetId, side) {
      const source = findPane(root, sourceId);
      if (!source || sourceId === targetId) return root;
      const stripped = closePaneAt(root, sourceId);
      const target = findPane(stripped, targetId);
      if (!target) return root;
      const dir = side === "left" || side === "right" ? "col" : "row";
      const leading = side === "left" || side === "top";
      // Where does the target sit? (normalized against the canvas)
      const box = [];
      layoutTree(stripped, { x: 0, y: 0, w: 1, h: 1 }, box, []);
      const found = box.find((entry) => entry.pane.id === targetId);
      const rect = found ? found.rect : { x: 0, y: 0, w: 1, h: 1 };
      const touchesEdge =
        (side === "left" && rect.x <= 0.002) ||
        (side === "right" && rect.x + rect.w >= 0.998) ||
        (side === "top" && rect.y <= 0.002) ||
        (side === "bottom" && rect.y + rect.h >= 0.998);
      // Reuse the source pane object: same id, same session. The pane stays
      // mounted and the selection keeps pointing at it.
      const fresh = { ...source };
      if (touchesEdge) {
        return leading ? makeSplit(dir, fresh, stripped) : makeSplit(dir, stripped, fresh);
      }
      return replaceNode(stripped, targetId, (node) => {
        if (node.kind !== "pane") return node;
        return leading ? makeSplit(dir, fresh, node) : makeSplit(dir, node, fresh);
      });
    }

    /**
     * Flip one split between columns and rows. Every pane keeps its id and its
     * session — only the direction changes, so 上1下2 becomes 左1右2 without
     * dragging anything apart.
     *
     * The share goes back to DEFAULT_RATIO (the 50/50 a fresh two-column layout
     * gets), so a divider that was dragged to a lopsided position comes back to
     * the default the moment it is flipped. Dragging is unaffected: whatever the
     * user drags stays until they flip that split or drag it again.
     */
    function rotateSplit(root, splitId) {
      return replaceNode(root, splitId, (node) =>
        node.kind === "split"
          ? { ...node, dir: node.dir === "col" ? "row" : "col", ratio: DEFAULT_RATIO }
          : node
      );
    }

    /** Drop a pane; its parent split collapses into the sibling. */
    function closePaneAt(root, paneId) {
      if (root.kind === "pane") {
        // Never leave the panel without a pane: empty the last one instead.
        return root.id === paneId ? makePane(null) : root;
      }
      const collapse = (node) => {
        if (node.kind !== "split") return node;
        if (node.a.kind === "pane" && node.a.id === paneId) return node.b;
        if (node.b.kind === "pane" && node.b.id === paneId) return node.a;
        return { ...node, a: collapse(node.a), b: collapse(node.b) };
      };
      return collapse(root);
    }

    function setRatioAt(root, splitId, ratio) {
      return replaceNode(root, splitId, (node) =>
        node.kind === "split" ? { ...node, ratio: clamp(ratio, MIN_RATIO, 1 - MIN_RATIO) } : node
      );
    }

    function assignSessionAt(root, paneId, sessionId) {
      return replaceNode(root, paneId, (node) =>
        node.kind === "pane" ? { ...node, sessionId: sessionId ?? null } : node
      );
    }

    function swapSessionsAt(root, leftId, rightId) {
      const left = findPane(root, leftId);
      const right = findPane(root, rightId);
      if (!left || !right) return root;
      let next = replaceNode(root, leftId, (node) =>
        node.kind === "pane" ? { ...node, sessionId: right.sessionId } : node
      );
      next = replaceNode(next, rightId, (node) =>
        node.kind === "pane" ? { ...node, sessionId: left.sessionId } : node
      );
      return next;
    }

    /** Recursive layout: panes with rects plus one divider record per split. */
    function layoutTree(node, rect, panes, dividers) {
      if (node.kind === "pane") {
        panes.push({ pane: node, rect });
        return;
      }
      if (node.dir === "col") {
        const width = rect.w * node.ratio;
        layoutTree(node.a, { ...rect, w: width }, panes, dividers);
        layoutTree(node.b, { ...rect, x: rect.x + width, w: rect.w - width }, panes, dividers);
      } else {
        const height = rect.h * node.ratio;
        layoutTree(node.a, { ...rect, h: height }, panes, dividers);
        layoutTree(node.b, { ...rect, y: rect.y + height, h: rect.h - height }, panes, dividers);
      }
      dividers.push({ id: node.id, dir: node.dir, rect, ratio: node.ratio });
    }

    /** Leaf whose cell holds the normalized point, with its rect. */
    function paneAtPoint(root, px, py) {
      const panes = [];
      layoutTree(root, { x: 0, y: 0, w: 1, h: 1 }, panes, []);
      return panes.find(({ rect }) => px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h) ?? null;
    }

    /**
     * Where a drop inside a pane lands: the nearest edge decides direction and
     * side. Columns are the default; rows only when clearly nearer a horizontal
     * edge, so a drop at the centre never flips on sub-pixel rounding.
     */
    function dropChoice(rect, px, py) {
      const relX = (px - rect.x) / Math.max(rect.w, 1e-6);
      const relY = (py - rect.y) / Math.max(rect.h, 1e-6);
      const vertical = Math.min(relX, 1 - relX);
      const horizontal = Math.min(relY, 1 - relY);
      if (horizontal < vertical - 0.08) return { dir: "row", before: relY < 0.5 };
      return { dir: "col", before: relX < 0.5 };
    }

    /** Insert a new pane holding `sessionId` beside the target pane. */
    function insertBeside(root, targetId, choice, sessionId) {
      const fresh = makePane(sessionId);
      return replaceNode(root, targetId, (node) => {
        if (node.kind !== "pane") return node;
        return choice.before ? makeSplit(choice.dir, fresh, node) : makeSplit(choice.dir, node, fresh);
      });
    }

    /**
     * Put a session into a pane. A session shown elsewhere leaves that pane,
     * and a pane emptied that way is closed, so no blank pane is left behind.
     * A null choice replaces the target's session; otherwise the session opens
     * in a new pane split off the target.
     */
    function planSessionDrop(root, sessionId, targetId, choice) {
      const target = findPane(root, targetId);
      if (!target || target.sessionId === sessionId) return root;
      let base = root;
      walk(root, (node) => {
        if (node.kind === "pane" && node.id !== targetId && node.sessionId === sessionId) {
          base = closePaneAt(base, node.id);
        }
      });
      if (!choice || !target.sessionId || countPanes(base) >= MAX_PANES) {
        return assignSessionAt(base, targetId, sessionId);
      }
      return insertBeside(base, targetId, choice, sessionId);
    }

    /** Pane-header drop: swap the two sessions, or move the pane beside another. */
    function planPaneDrop(root, sourceId, targetId, action) {
      if (sourceId === targetId) return root;
      return action.kind === "swap"
        ? swapSessionsAt(root, sourceId, targetId)
        : movePaneBeside(root, sourceId, targetId, action.side);
    }

    /** The single planner: the live preview and the committed drop both call it. */
    function planIntent(root, intent) {
      if (!intent) return root;
      return intent.kind === "session"
        ? planSessionDrop(root, intent.sessionId, intent.targetId, intent.choice)
        : planPaneDrop(root, intent.sourceId, intent.targetId, intent.action);
    }

    /** Intent of a session dragged from the official list to a normalized point. */
    function sessionIntent(root, sessionId, px, py) {
      const hit = paneAtPoint(root, px, py);
      if (!hit || hit.pane.sessionId === sessionId) return null;
      const choice = hit.pane.sessionId ? dropChoice(hit.rect, px, py) : null;
      return { kind: "session", sessionId, targetId: hit.pane.id, choice };
    }

    /** Intent of a pane header dragged to a point: the middle band swaps, an edge moves. */
    function paneIntent(root, sourceId, px, py) {
      const hit = paneAtPoint(root, px, py);
      if (!hit || hit.pane.id === sourceId) return null;
      const relX = (px - hit.rect.x) / Math.max(hit.rect.w, 1e-6);
      const relY = (py - hit.rect.y) / Math.max(hit.rect.h, 1e-6);
      const nearest = [
        { side: "left", value: relX },
        { side: "right", value: 1 - relX },
        { side: "top", value: relY },
        { side: "bottom", value: 1 - relY }
      ].sort((a, b) => a.value - b.value)[0];
      const action = nearest.value <= 0.3 ? { kind: "move", side: nearest.side } : { kind: "swap" };
      return { kind: "pane", sourceId, targetId: hit.pane.id, action };
    }

    /** Stable text key of an intent, so unchanged pointer moves cost no re-render. */
    function intentKey(intent) {
      if (!intent) return "";
      if (intent.kind === "session") {
        const cut = intent.choice ? `${intent.choice.dir}${intent.choice.before ? "<" : ">"}` : "=";
        return `s|${intent.sessionId}|${intent.targetId}|${cut}`;
      }
      const how = intent.action.kind === "swap" ? "x" : intent.action.side;
      return `p|${intent.sourceId}|${intent.targetId}|${how}`;
    }

    /** Fixed arrangement for the import button, by how many sessions it brings in. */
    function arrangeSessions(ids) {
      const leaf = (id) => makePane(id);
      const pair = (dir, a, b) => makeSplit(dir, a, b, DEFAULT_RATIO);
      const top3 = (a, b, c) => makeSplit("col", a, pair("col", b, c), 1 / 3);
      switch (ids.length) {
        case 0:
          return defaultTree();
        case 1:
          return leaf(ids[0]);
        case 2:
          return pair("col", leaf(ids[0]), leaf(ids[1]));
        case 3:
          return pair("col", leaf(ids[0]), pair("row", leaf(ids[1]), leaf(ids[2])));
        case 4:
          return pair("row", pair("col", leaf(ids[0]), leaf(ids[1])), pair("col", leaf(ids[2]), leaf(ids[3])));
        case 5:
          return pair("row", top3(leaf(ids[0]), leaf(ids[1]), leaf(ids[2])), pair("col", leaf(ids[3]), leaf(ids[4])));
        default:
          return pair("row", top3(leaf(ids[0]), leaf(ids[1]), leaf(ids[2])), top3(leaf(ids[3]), leaf(ids[4]), leaf(ids[5])));
      }
    }

    /** Session a new one should sit beside: the focused pane's, else the first occupied pane's. */
    function nearestSession(root, activeId) {
      const focused = findPane(root, activeId);
      if (focused && focused.sessionId) return focused.sessionId;
      let found = null;
      walk(root, (node) => {
        if (found === null && node.kind === "pane" && node.sessionId) found = node.sessionId;
      });
      return found;
    }

    /** Workspace id of a session, read from the official workspace list. */
    function workspaceOfSession(sessionId) {
      if (!sessionId) return undefined;
      const items = hostCtx?.workspaces?.list?.getSnapshot?.()?.items ?? [];
      return items.find((item) => item.sessionIds?.includes(sessionId))?.workspaceId;
    }

    /* ------------------------------------------------------------------ *
     * Persistence — this plugin's own key only, and every read is validated
     * so a corrupt or stale blob can never break the panel.
     * ------------------------------------------------------------------ */

    function readTree() {
      try {
        // Older layouts used keys the current model cannot honour; drop them.
        for (const legacy of ["dsh-split-layout-v1", "dsh-split-layout-v2"]) {
          if (typeof globalThis.localStorage?.getItem(legacy) === "string") {
            globalThis.localStorage?.removeItem(legacy);
          }
        }
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return defaultTree();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") return defaultTree();
        const clean = (node, depth) => {
          if (!node || typeof node !== "object" || depth > 12) return null;
          if (node.kind === "pane") {
            return typeof node.id === "string"
              ? { kind: "pane", id: node.id, sessionId: typeof node.sessionId === "string" ? node.sessionId : null }
              : null;
          }
          if (node.kind === "split") {
            const a = clean(node.a, depth + 1);
            const b = clean(node.b, depth + 1);
            if (!a || !b) return null;
            return {
              kind: "split",
              id: typeof node.id === "string" ? node.id : newId("s"),
              dir: node.dir === "row" ? "row" : "col",
              ratio: clamp(Number(node.ratio) || 0.5, MIN_RATIO, 1 - MIN_RATIO),
              a,
              b
            };
          }
          return null;
        };
        const tree = clean(parsed, 0);
        if (!tree || countPanes(tree) === 0) return defaultTree();
        if (countPanes(tree) > MAX_PANES) return defaultTree();
        return tree;
      } catch {
        return defaultTree();
      }
    }

    function writeTree(tree) {
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(tree));
      } catch {
        // A full or blocked quota must never break the panel.
      }
    }

    /** Pane ids whose editor is raised; a corrupt blob just means none are. */
    function readDockTall() {
      try {
        const raw = globalThis.localStorage?.getItem(DOCK_TALL_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((id) => typeof id === "string"));
      } catch {
        return new Set();
      }
    }

    function writeDockTall(ids) {
      try {
        globalThis.localStorage?.setItem(DOCK_TALL_KEY, JSON.stringify([...ids]));
      } catch {
        // A full or blocked quota must never break the panel.
      }
    }

    /* ------------------------------------------------------------------ *
     * Per-pane Session reference
     * ------------------------------------------------------------------ */

    /**
     * Retain one Session for as long as the pane shows it.
     *
     * The held value carries its own sessionId and is only surfaced while it
     * still matches the pane's session. Without that guard the window between
     * an effect cleanup (which releases the reference) and the state update
     * that follows it would render `SessionProvider` with a released
     * reference, and the sessions service throws on a released `.binding`.
     */
    function usePaneReference(sessionId) {
      const [held, setHeld] = React.useState(null);
      const reference = held !== null && held.sessionId === sessionId ? held.reference : null;
      React.useEffect(() => {
        if (!sessionId) {
          setHeld(null);
          return undefined;
        }
        const sessions = hostCtx?.sessions;
        if (!sessions) return undefined;
        let acquired = null;
        try {
          const controller = new AbortController();
          acquired = sessions.retain(sessionId, {
            source: RETAIN_SOURCE,
            signal: controller.signal
          });
          // A failed open must not surface as an unhandled rejection; the pane
          // simply stays in its empty state because no binding resolves.
          acquired.ready.catch(() => {});
          setHeld({ sessionId, reference: acquired });
          return () => {
            controller.abort();
            acquired.release();
            setHeld(null);
          };
        } catch {
          // Unknown or already disposed id: the pane shows its empty state.
          setHeld(null);
          return undefined;
        }
      }, [sessionId]);
      return reference;
    }

    /**
     * Drop the sidebar's "completed" dot for one session the user has just read.
     *
     * Official rule (`dsh-client-ui-session/lib/client.js`): a session that
     * stops running is flagged unless it is the main one — `observeRunning`
     * (:953) checks `isMain`, `isMain` (:971) is `retainedBy.mainView > 0`, and
     * `reconcileStatus` (:965) clears the flag for anything mainView retains. A
     * pane retains with `splitPane`, so a session the user is watching inside a
     * pane still gets the dot. Borrowing mainView for one synchronous
     * retain/release makes the retention publish
     * (`dsh-api-session-controller/lib/client.js:4078`) re-run
     * `reconcileStatus`, which is exactly what the main tab does by construction.
     *
     * The borrow is never held: `publishMain` (:914) falls back to any session
     * with a mainView reference, so a long-lived borrow would hijack the main
     * binding. Sessions nothing else is holding are skipped — borrowing one
     * would materialize a scope and take the count back to zero on release.
     */
    function acknowledgeSeen(sessionId) {
      const sessions = hostCtx?.sessions;
      if (!sessionId || !sessions) return;
      try {
        if (sessions.retainInfo(sessionId).getSnapshot().referenceCount === 0) return;
        const reference = sessions.retain(sessionId, { source: MAIN_VIEW_SOURCE });
        try {
          // The pane already holds this session, so `ready` is settled work; a
          // failed open must not surface as an unhandled rejection.
          reference.ready.catch(() => {});
        } finally {
          // Releasing is not optional: a leaked mainView reference would keep
          // hijacking the main binding (`publishMain`, :914) for the page's life.
          reference.release();
        }
      } catch {
        // Unknown or already disposed id: the dot simply stays.
      }
    }

    /**
     * What the sidebar row for a session says about the "completed" dot:
     * `clear` (it is showing), `none` (the row is there and is not), or
     * `unknown` (no row rendered to ask). Session ids are `[a-z0-9-]`, so the
     * attribute selector is safe.
     */
    function dotState(sessionId) {
      if (typeof document === "undefined" || !sessionId) return "none";
      try {
        const row = document.querySelector(`[data-row-key="session:${sessionId}"]`);
        if (row === null) return "unknown";
        return row.querySelector('[data-state="done"]') !== null ? "clear" : "none";
      } catch {
        return "unknown";
      }
    }

    /**
     * Contain one pane's failures. A Session removed on the Host while its
     * pane is open makes the embedded conversation throw during render; that
     * must cost the user one pane, not the whole split panel.
     */
    class PaneBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }

      static getDerivedStateFromError() {
        return { failed: true };
      }

      componentDidCatch(error) {
        hostCtx?.logger?.warn?.(`web-split: pane body failed: ${String(error?.message ?? error).slice(0, 160)}`);
      }

      render() {
        if (this.state.failed) {
          return h("div", { className: "dshSplit_empty" }, h("div", null, translator("paneClosed")));
        }
        return this.props.children;
      }
    }

    /* ------------------------------------------------------------------ *
     * Right-click menu plumbing: clipboard, caret placement, field lookup.
     * Browser APIs only — the menu adds no host call and no new dependency.
     * ------------------------------------------------------------------ */

    /** Current document selection as plain text (empty string when none). */
    function selectionText() {
      try {
        return String(window.getSelection?.()?.toString?.() ?? "");
      } catch {
        return "";
      }
    }

    /** Copy through the async clipboard, falling back to a hidden textarea. */
    function copyPlainText(text) {
      const legacy = () => {
        let ok = false;
        try {
          const area = document.createElement("textarea");
          area.value = text;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.top = "-1000px";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          ok = document.execCommand("copy");
          area.remove();
        } catch {
          ok = false;
        }
        return ok;
      };
      const clipboard = navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === "function") {
        return clipboard.writeText(text).then(() => true, legacy);
      }
      return Promise.resolve(legacy());
    }

    /** The text field a right-click landed on, if any; buttons and such are not fields. */
    function editableFrom(node) {
      const element = node instanceof Element ? node : null;
      if (!element) return null;
      if (element.isContentEditable) return element;
      const field = element.closest?.(FIELD_SELECTOR) ?? null;
      if (field === null) return null;
      if (field instanceof HTMLInputElement) {
        const type = (field.getAttribute("type") ?? "text").toLowerCase();
        return TEXT_INPUT_TYPES.has(type) ? field : null;
      }
      return field;
    }

    /**
     * Whether a point sits on real content text, where a double-click means
     * "select the word under the cursor". Asking the live selection instead is
     * wrong: the browser has already selected that word by the time `dblclick`
     * is dispatched, so any pane whose content reaches under the cursor would
     * refuse the zoom gesture while a pane with blank space accepted it — the
     * exact "some panes cannot be zoomed" report. The pane's own chrome (empty
     * state, tool row, header) is never content, and an editable is content
     * even when the caret lands between characters.
     */
    function textPointAt(x, y) {
      const doc = document;
      let node = null;
      let range = null;
      try {
        if (typeof doc.caretRangeFromPoint === "function") {
          // Chrome and Safari: the caret under a point, already as a range.
          range = doc.caretRangeFromPoint(x, y);
          if (range !== null) node = range.startContainer;
        } else if (typeof doc.caretPositionFromPoint === "function") {
          // The standard spelling (Firefox); build the equivalent collapsed range.
          const position = doc.caretPositionFromPoint(x, y);
          if (position !== null) {
            node = position.offsetNode;
            range = doc.createRange();
            range.setStart(node, position.offset);
            range.setEnd(node, position.offset);
          }
        } else {
          // No caret API at all: keep the word-select meaning instead of
          // claiming every point in the pane as blank space.
          return true;
        }
      } catch {
        // A lookup that throws is not the same as "blank space here": fail
        // closed, so a broken caret still never zooms on top of text.
        return true;
      }
      if (node === null) return false;
      const element = node.nodeType === 3 ? node.parentElement : node;
      if (!element || typeof element.closest !== "function") return false;
      // Our own chrome writes text but is not content to select.
      if (element.closest(".dshSplit_paneHead, .dshSplit_empty, .dshSplit_emptySmall, .dshSplit_tools")) return false;
      // A composer or any other field keeps its double-click (word or caret work).
      if (element.isContentEditable === true) return true;
      if (element.closest(FIELD_SELECTOR)) return true;
      if (node.nodeType !== 3) return false;
      if (String(node.nodeValue ?? "").trim() === "") return false;
      const view = doc.defaultView;
      const style = typeof view?.getComputedStyle === "function" ? view.getComputedStyle(element) : null;
      if (style !== null && style.userSelect === "none") return false;
      // Landing in the block that holds text is not enough: the caret resolves
      // to the nearest character even for a point in the gap between two lines
      // or beside a bubble, and those gaps are blank space to the user. Only a
      // point inside the character's own line box counts as "on text".
      const rects = typeof range.getClientRects === "function" ? range.getClientRects() : null;
      if (rects !== null) {
        let onLine = rects.length === 0;
        // Indexed, not iterated: `getClientRects()` returns a DOMRectList, which
        // only Blink makes iterable.
        for (let i = 0; i < rects.length; i += 1) {
          const rect = rects[i];
          if (y >= rect.top - 2 && y <= rect.bottom + 2 && x >= rect.left - 10 && x <= rect.right + 10) {
            onLine = true;
            break;
          }
        }
        if (!onLine) return false;
      }
      return true;
    }

    /** Put the caret where the user right-clicked, inside a rich editor. */
    function placeCaretAt(field, x, y) {
      try {
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return;
        const range = document.caretRangeFromPoint?.(x, y) ?? null;
        if (range === null || !field.contains(range.startContainer)) return;
        const selection = window.getSelection?.();
        if (!selection) return;
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        /* caret placement is best effort; the field keeps its own caret */
      }
    }

    /**
     * Write plain text into a field. Input and textarea get a native range edit;
     * a rich editor gets a synthetic paste event, because the composer runs its
     * own paste pipeline and inserting into its DOM behind that would desync it.
     */
    function insertPlainText(field, text) {
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        // Reads are guarded too: an input type without a selection API throws
        // here rather than returning null, and this runs off a menu click.
        let start;
        let end;
        try {
          start = field.selectionStart ?? field.value.length;
          end = field.selectionEnd ?? start;
        } catch {
          start = field.value.length;
          end = start;
        }
        try {
          field.setRangeText(text, start, end, "end");
        } catch {
          field.value = `${field.value.slice(0, start)}${text}${field.value.slice(end)}`;
        }
        field.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      try {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
        // A handler that cancelled the event consumed the paste.
        if (!field.dispatchEvent(event)) return true;
        if (document.execCommand("insertText", false, text)) return true;
      } catch {
        /* report through the caller's note */
      }
      return false;
    }

    /* ------------------------------------------------------------------ *
     * Components
     * ------------------------------------------------------------------ */

    /** Chat-only view selection for an embedded conversation (no view tabs). */
    function FixedChatView(props) {
      return h(React.Fragment, null, props.renderSlot("conversation.session", { view: "chat" }));
    }

    /** Body of one pane: the shared Conversation factory for the pane's Session. */
    function PaneBody(props) {
      const session = (props.useSession ?? (() => undefined))((value) => value);
      const running = session?.running === true;
      const pending = (session?.pendingSubmissions?.length ?? 0) > 0;
      const blank = session ? session.blank === true : true;
      const phase = running || pending || !blank ? "active" : session?.promptAttempted ? "engaging" : "blank";
      if (typeof props.renderFactorySlot !== "function") return null;
      return props.renderFactorySlot(
        "conversation.content",
        { variant: "embedded", phase, hero: phase === "blank" },
        { slots: { views: FixedChatView } }
      );
    }

    function EmptyPane(props) {
      const t = translator;
      return h(
        "div",
        { className: "dshSplit_empty" },
        h("div", null, props.sessionId ? t("paneClosed") : t("paneEmpty")),
        props.sessionId ? null : h("div", { className: "dshSplit_emptySmall" }, t("paneEmptyAlt")),
        props.sessionId
          ? null
          : h(
              "button",
              {
                type: "button",
                className: "dshSplit_textBtn",
                onClick: (event) => {
                  event.stopPropagation();
                  props.onCreate(props.paneId);
                }
              },
              t("paneNew")
            )
      );
    }

    /**
     * The only slice of the sessions store this panel renders from: the order,
     * the phase, and each session's title and running flag. Subscribing to the
     * whole store instead would re-render every pane — and the whole
     * conversation subtree inside it — on every streamed token.
     */
    function sessionsView(state) {
      const meta = {};
      for (const id of state.ids) {
        const entry = state.byId[id];
        meta[id] = { title: entry?.displayTitle ?? null, running: entry?.running === true };
      }
      return { ids: state.ids, phase: state.phase, meta };
    }

    /** True while two consecutive session views carry the same rendered facts. */
    function sameSessionsView(a, b) {
      if (a === b) return true;
      if (a.phase !== b.phase) return false;
      const ids = a.ids;
      if (ids.length !== b.ids.length) return false;
      for (let index = 0; index < ids.length; index += 1) {
        if (ids[index] !== b.ids[index]) return false;
      }
      for (const id of ids) {
        const left = a.meta[id];
        const right = b.meta[id];
        if (!left || !right) {
          if (left !== right) return false;
          continue;
        }
        if (left.title !== right.title || left.running !== right.running) return false;
      }
      return true;
    }

    /**
     * A pane re-renders only when something it shows changed. The conversation
     * subtree it carries is the expensive part, so the rectangle is compared by
     * value (layoutTree hands out a fresh object every render) and everything
     * else by identity — the panel's handlers are all stable callbacks, but the
     * two host-kit props a pane renders through (`SessionProvider`,
     * `renderSlot`) come from the kit and are compared too, so a new kit
     * identity can never be swallowed by this memo.
     */
    function panePropsEqual(a, b) {
      return a.pane === b.pane
        && a.title === b.title
        && a.running === b.running
        && a.maximized === b.maximized
        && a.active === b.active
        && a.dim === b.dim
        && a.dropPane === b.dropPane
        && a.swapPane === b.swapPane
        && a.dockTall === b.dockTall
        && a.SessionProvider === b.SessionProvider
        && a.renderSlot === b.renderSlot
        && a.rect.x === b.rect.x
        && a.rect.y === b.rect.y
        && a.rect.w === b.rect.w
        && a.rect.h === b.rect.h;
    }

    /** Two presses on the same pane header within this window zoom the pane. */
    const HEAD_DOUBLE_PRESS_MS = 400;
    const HEAD_DOUBLE_PRESS_SLOP = 6;

    function Pane(props) {
      const t = translator;
      const { pane, rect } = props;
      const title = props.title ?? pane.sessionId ?? t("paneEmpty");
      const reference = usePaneReference(pane.sessionId);
      const headPressRef = React.useRef({ id: null, time: 0, x: 0, y: 0 });
      const onHeadPointerDown = (event) => {
        if (event.button !== 0) return;
        if (event.target?.closest?.("button,select,input,textarea")) return;
        // The header strip cancels pointerdown to start a drag, and a cancelled
        // pointerdown is allowed to swallow the compatibility mouse events that
        // would produce a native dblclick. So the header detects its own double
        // press here instead of hoping for one; the content area, where nothing
        // cancels the press, keeps using the native dblclick below.
        const previous = headPressRef.current;
        const repeat = previous.id === pane.id
          && event.timeStamp - previous.time <= HEAD_DOUBLE_PRESS_MS
          && Math.abs(event.clientX - previous.x) <= HEAD_DOUBLE_PRESS_SLOP
          && Math.abs(event.clientY - previous.y) <= HEAD_DOUBLE_PRESS_SLOP;
        headPressRef.current = repeat
          ? { id: null, time: 0, x: 0, y: 0 }
          : { id: pane.id, time: event.timeStamp, x: event.clientX, y: event.clientY };
        event.preventDefault();
        if (repeat) {
          props.onToggleMaximize(pane.id);
          return;
        }
        // A press that becomes a real drag must not leave a double press armed,
        // or "press, drag the pane away, press again" would read as a double
        // click and zoom a pane the user only dragged. The divider gesture
        // disarms its own click the same way, on the same DRAG_SLOP.
        const disarm = () => {
          window.removeEventListener("pointermove", onArmMove);
          window.removeEventListener("pointerup", disarm);
          window.removeEventListener("pointercancel", disarm);
        };
        const onArmMove = (move) => {
          if (Math.abs(move.clientX - event.clientX) <= DRAG_SLOP
            && Math.abs(move.clientY - event.clientY) <= DRAG_SLOP) return;
          headPressRef.current = { id: null, time: 0, x: 0, y: 0 };
          disarm();
        };
        window.addEventListener("pointermove", onArmMove);
        window.addEventListener("pointerup", disarm);
        window.addEventListener("pointercancel", disarm);
        props.onPaneDragStart(pane.id, event.clientX, event.clientY);
      };
      const icon = (label, glyph, handler, extraClass) =>
        h("button", {
          type: "button",
          className: extraClass ? `dshSplit_iconBtn ${extraClass}` : "dshSplit_iconBtn",
          title: label,
          "aria-label": label,
          onClick: handler
        }, glyph);
      // Double-click zooms the pane and zooms it back — anywhere on the pane
      // chrome: the header strip (title and border) or blank space beside the
      // content. Only real content text and controls keep their own meaning:
      // on text the browser has already selected the word under the cursor, and
      // a control does what it does. Everything else — gaps between messages,
      // padding, the empty state, the pane border — zooms.
      const onDoubleClick = (event) => {
        if (event.defaultPrevented === true || event.button !== 0) return;
        const target = event.target;
        if (target?.closest?.("button,a,input,textarea,select,[role='button'],[contenteditable],[data-split-menu]")) return;
        // The header owns its gesture through onHeadPointerDown (see there:
        // the press that starts a drag may swallow the native dblclick), so a
        // dblclick that does arrive on the header is ignored rather than
        // applied twice.
        if (target?.closest?.(".dshSplit_paneHead")) return;
        if (textPointAt(event.clientX, event.clientY)) return;
        event.preventDefault();
        props.onToggleMaximize(pane.id);
      };
      return h(
        "div",
        {
          className: "dshSplit_pane",
          "data-split-pane": pane.id,
          "data-active": props.active ? "1" : undefined,
          "data-drop": props.dropPane === pane.id ? "1" : undefined,
          "data-swap": props.swapPane === pane.id ? "1" : undefined,
          "data-docktall": props.dockTall ? "1" : undefined,
          "data-preview": props.dim ? "1" : undefined,
          style: {
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`
          },
          role: "group",
          "aria-label": title,
          onContextMenu: (event) => props.onPaneMenu(pane.id, event),
          onDoubleClick,
          onPointerDownCapture: () => props.onFocusPane(pane.id)
        },
        h(
          "div",
          { className: "dshSplit_paneHead", onPointerDown: onHeadPointerDown, title: t("paneDragHint") },
          h("span", {
            className: props.running ? "dshSplit_dot" : "dshSplit_dot dshSplit_dotIdle"
          }),
          h("span", { className: "dshSplit_paneTitle" }, title),
          // All four actions sit together at the right end of the header. Close
          // leads the group, two header gaps clear of the split buttons so a
          // mis-click cannot take a pane down; the three layout buttons keep one
          // extra gap between them.
          h(
            "span",
            { className: "dshSplit_btnGroup" },
            icon(t("paneClose"), "✕", () => props.onClosePane(pane.id), "dshSplit_closeBtn"),
            icon(t("paneSplitCol"), "◫", () => props.onSplit(pane.id, "col")),
            icon(t("paneSplitRow"), "⬓", () => props.onSplit(pane.id, "row")),
            icon(props.dockTall ? t("paneDockRestore") : t("paneDockTall"), "⇕",
              () => props.onToggleDockTall(pane.id)),
            icon(props.maximized ? t("paneRestore") : t("paneMaximize"), props.maximized ? "❐" : "⤢",
              () => props.onToggleMaximize(pane.id))
          )
        ),
        h(
          "div",
          { className: "dshSplit_paneBody" },
          reference
            ? h(
                PaneBoundary,
                { key: pane.sessionId },
                h(props.SessionProvider, { session: reference }, props.renderSlot("split.pane.body", {}))
              )
            : h(EmptyPane, { sessionId: pane.sessionId, paneId: pane.id, onCreate: props.onCreateSession })
        )
      );
    }

    /** Memoized pane: see panePropsEqual for what counts as a visible change. */
    const PaneView = React.memo(Pane, panePropsEqual);

    /** Session the current preview carries: the dragged official row, or the dragged pane's own session. */
    function draggedSessionOf(root, intent) {
      if (!intent) return null;
      if (intent.kind === "session") return intent.sessionId;
      return findPane(root, intent.sourceId)?.sessionId ?? null;
    }

    /**
     * The pane right-click menu: clipboard first, then the pane actions the
     * header buttons already offer, then close. A row that cannot act is
     * disabled with its reason as the title instead of hidden, so the menu keeps
     * a stable shape — except Paste, which only means anything over a text field.
     */
    function PaneMenu(props) {
      const t = translator;
      const { menu } = props;
      const row = (label, onClick, options) => {
        const opts = options ?? {};
        const disabled = opts.disabled === true;
        return h(
          "button",
          {
            type: "button",
            role: "menuitem",
            className: "dshSplit_menuItem",
            disabled: disabled ? true : undefined,
            title: disabled ? opts.why : undefined,
            onClick
          },
          label
        );
      };
      return h(
        "div",
        {
          className: "dshSplit_menu",
          role: "menu",
          "data-split-menu": menu.paneId,
          ref: props.menuRef,
          style: { left: `${menu.x}px`, top: `${menu.y}px` },
          // A right-click inside the menu must not open a second one.
          onContextMenu: (event) => event.preventDefault()
        },
        row(t("ctxCopy"), props.onCopy, { disabled: menu.text.trim() === "", why: t("ctxCopyNone") }),
        menu.editable ? row(t("ctxPaste"), props.onPaste) : null,
        h("div", { className: "dshSplit_menuSep", role: "separator" }),
        row(t("ctxMove"), props.onMove),
        row(t("ctxSplitRight"), props.onSplitRight, { disabled: props.capped, why: t("ctxCapped") }),
        row(t("ctxSplitDown"), props.onSplitDown, { disabled: props.capped, why: t("ctxCapped") }),
        row(menu.maximized ? t("paneRestore") : t("ctxZoom"), props.onZoom, { disabled: props.single, why: t("ctxSingle") }),
        h("div", { className: "dshSplit_menuSep", role: "separator" }),
        // Grid-wide actions live here now: their buttons used to float over the
        // bottom-right corner of the canvas and cover the pane underneath.
        row(t("importRunning", { count: String(props.importCount) }), props.onImportRunning, {
          disabled: props.importCount === 0,
          why: t("importTitle")
        }),
        row(t("reset"), props.onReset),
        h("div", { className: "dshSplit_menuSep", role: "separator" }),
        row(t("paneClose"), props.onClose)
      );
    }

    function SplitPanel(props) {
      const t = translator;
      // Only the slice of the store that is actually rendered, with an equality
      // check: a streamed token elsewhere in a session must not re-render this
      // panel (and with it every embedded conversation).
      const list = props.useSessions(sessionsView, sameSessionsView);
      const [tree, setTree] = React.useState(readTree);
      const [drag, setDrag] = React.useState(null);
      const [preview, setPreview] = React.useState(null);
      const [activePane, setActivePane] = React.useState(null);
      const [introOpen, setIntroOpen] = React.useState(true);
      const [note, setNote] = React.useState(null);
      const canvasRef = React.useRef(null);
      /** Open right-click menu: pane id, canvas-local point, selection, target field. */
      const [menu, setMenu] = React.useState(null);
      /** Pane ids whose composer editor is raised to four lines. */
      const [dockTall, setDockTall] = React.useState(readDockTall);
      const menuRef = React.useRef(null);
      /** Selection as of the last mouse-down, used when the click wiped it. */
      const selectionRef = React.useRef("");
      /** Latest tree, readable from the imperative handlers. */
      const treeRef = React.useRef(tree);
      /** Intent of the current preview; a drop or release commits exactly this. */
      const previewRef = React.useRef(null);
      const previewKey = React.useRef("");
      const movedRef = React.useRef(false);
      /** Session id of the official-list row being dragged, if any. */
      const sessionDragRef = React.useRef(null);
      /** Maximized pane id; a ref so drag handlers never see a stale one. */
      const maximizedRef = React.useRef(null);
      const activeRef = React.useRef(null);
      /** Panes with a session request in flight; a second click is ignored. */
      const creatingRef = React.useRef(new Set());
      /** Last divider press, so a second press on the same cut can flip it. */
      const dividerClickRef = React.useRef(null);
      /** Detaches the window listeners of a drag in flight. */
      const dragDetachRef = React.useRef(null);
      /**
       * Newest divider ratio. It is only committed on release: resizing the
       * panes live means re-laying-out every conversation on every frame, which
       * measured at 17.8 fps with four live panes, so the drag moves a ghost
       * line and the layout changes once, when the pointer is up.
       */
      const pendingRatioRef = React.useRef(null);
      /** The ghost line that stands in for the split while a divider is dragged. */
      const ghostRef = React.useRef(null);
      /** Canvas rect at drag start; a drag never re-measures it. */
      const canvasBoxRef = React.useRef(null);
      const noteTimer = React.useRef(null);
      const pendingWrite = React.useRef(null);
      const latest = React.useRef(tree);

      // The intro hint shows once per mount; a preview replaces it while active.
      React.useEffect(() => {
        const timer = setTimeout(() => setIntroOpen(false), 6000);
        return () => clearTimeout(timer);
      }, []);

      // Debounced persistence: dragging a divider fires many updates per
      // second. `pagehide` and unmount flush whatever is still pending.
      React.useEffect(() => {
        latest.current = tree;
        treeRef.current = tree;
        if (pendingWrite.current !== null) clearTimeout(pendingWrite.current);
        pendingWrite.current = setTimeout(() => {
          pendingWrite.current = null;
          writeTree(tree);
        }, 80);
        return () => {
          if (pendingWrite.current !== null) clearTimeout(pendingWrite.current);
        };
      }, [tree]);
      React.useEffect(() => {
        const flush = () => writeTree(latest.current);
        globalThis.addEventListener?.("pagehide", flush);
        return () => {
          globalThis.removeEventListener?.("pagehide", flush);
          flush();
          if (noteTimer.current !== null) clearTimeout(noteTimer.current);
          // A drag still in flight would otherwise keep its window listeners
          // alive past this mount.
          if (dragDetachRef.current !== null) dragDetachRef.current();
          showGhostLine(null);
        };
      }, []);

      // Keep the maximized pane honest after the tree changes, without writing
      // the ref during render.
      React.useEffect(() => {
        if (maximizedRef.current && !findPane(tree, maximizedRef.current)) maximizedRef.current = null;
        // Panes come and go; a raised editor that no longer exists is dropped
        // so the persisted set cannot grow without bound.
        setDockTall((prev) => {
          if (prev.size === 0) return prev;
          const live = new Set();
          walk(tree, (node) => {
            if (node.kind === "pane" && prev.has(node.id)) live.add(node.id);
          });
          if (live.size === prev.size) return prev;
          writeDockTall(live);
          return live;
        });
      }, [tree]);

      // First run only: open with ONE pane holding the newest session, so the
      // panel never shows a blank placeholder beside a used one.
      const seededRef = React.useRef(false);
      React.useEffect(() => {
        if (seededRef.current) return;
        if (list.phase !== "ready") return;
        if (list.ids.length === 0) return;
        const first = list.ids[0];
        seededRef.current = true;
        setTree((prev) => {
          const panes = [];
          walk(prev, (node) => {
            if (node.kind === "pane") panes.push(node);
          });
          if (panes.length !== 1 || panes[0].sessionId) return prev;
          return assignSessionAt(prev, panes[0].id, first);
        });
      }, [list]);

      const titles = React.useMemo(() => {
        const map = {};
        for (const id of list.ids) map[id] = list.meta[id]?.title ?? id;
        return map;
      }, [list]);

      const runningIds = list.ids.filter((id) => list.meta[id]?.running === true);

      /* ---- sidebar "completed" dot ---- */

      /**
       * A session that finishes in the pane the user is working in has been
       * read, so its row loses the dot. Finishing in any *other* pane keeps it:
       * there it is the "that one is done" reminder the user asked for.
       */
      const runningKey = runningIds.join(",");
      const wasRunningRef = React.useRef(new Set());
      React.useEffect(() => {
        const wasRunning = wasRunningRef.current;
        wasRunningRef.current = new Set(runningIds);
        const pane = activeRef.current ? findPane(tree, activeRef.current) : lonePane(tree);
        const sessionId = pane ? pane.sessionId ?? null : null;
        // `list.meta` only holds catalogued sessions, so a stale id in the tree
        // can never make this retain a session nothing else is holding.
        if (sessionId !== null && list.meta[sessionId] && wasRunning.has(sessionId) && runningIds.indexOf(sessionId) < 0) {
          acknowledgeSeen(sessionId);
        }
        // `runningKey` is the render-stable projection of `runningIds`: the
        // transition below can only be observed in the render where it changed.
      }, [tree, runningKey, list]);

      /**
       * Coming back to the panel — remount, tab shown again, or scrolled back
       * into view — reads every pane on screen: whatever finished while the
       * panel was away loses its dot the moment the user can see it again.
       */
      /**
       * Sessions still owed a pass, mapped to how long we have been waiting:
       * their sidebar row was not on screen when we looked (collapsed group,
       * closed panel, list still rendering). The gate below reads the DOM, so
       * without this a skipped pass would leave a stale dot forever.
       */
      const pendingSeenRef = React.useRef(new Map());
      /** Ids we stopped chasing with the timer (row never rendered); a later
       *  mount or return-to-panel pass still gets them if the row shows up. */
      const gaveUpSeenRef = React.useRef(new Set());
      React.useEffect(() => {
        let timer = null;
        // Whether the canvas is on screen, as the observer last reported. The
        // first pass runs before any entry arrives, so it starts optimistically.
        let onScreen = true;
        const stopPolling = () => {
          if (timer !== null) {
            clearInterval(timer);
            timer = null;
          }
        };
        // Armed by whatever sweep last found work, not only by the first one:
        // a row can turn un-renderable (group collapsed) long after mount.
        const armPolling = () => {
          if (timer === null && typeof setInterval === "function") timer = setInterval(sweep, 2000);
        };
        function sweep() {
          // Nothing is read while the user is not looking: the timer is the one
          // trigger nobody gates for us, so it gates itself.
          if (typeof document !== "undefined" && document.hidden === true) return;
          if (onScreen !== true) return;
          const pending = pendingSeenRef.current;
          const gaveUp = gaveUpSeenRef.current;
          const panes = new Set();
          walk(treeRef.current, (node) => {
            if (node.kind === "pane" && node.sessionId) panes.add(node.sessionId);
          });
          // A session that left the panes is nobody's debt any more.
          for (const sessionId of [...pending.keys()]) if (!panes.has(sessionId)) pending.delete(sessionId);
          for (const sessionId of [...gaveUp]) if (!panes.has(sessionId)) gaveUp.delete(sessionId);
          for (const sessionId of panes) {
            const state = dotState(sessionId);
            // `clear`: the dot is up, take it down. `none`: the row says this
            // session is read. `unknown`: no row rendered to ask — wait for it,
            // but remember the give-up so the same hidden row cannot re-arm the
            // timer forever; the next mount or return-to-panel pass retries.
            if (state === "clear") {
              acknowledgeSeen(sessionId);
              pending.delete(sessionId);
              gaveUp.delete(sessionId);
            } else if (state === "none") {
              pending.delete(sessionId);
              gaveUp.delete(sessionId);
            } else if (!gaveUp.has(sessionId)) {
              const waited = (pending.get(sessionId) ?? 0) + 1;
              if (waited >= 15) {
                pending.delete(sessionId);
                gaveUp.add(sessionId);
              } else {
                pending.set(sessionId, waited);
              }
            }
          }
          if (pending.size > 0) armPolling();
          else stopPolling();
        }
        sweep();
        const canvas = canvasRef.current;
        const observer = typeof IntersectionObserver === "function" && canvas
          ? new IntersectionObserver((entries) => {
              for (const entry of entries) onScreen = entry.isIntersecting === true;
              if (onScreen === true) sweep();
            })
          : null;
        if (observer !== null) observer.observe(canvas);
        const onVisibility = () => {
          if (typeof document === "undefined" || document.hidden !== true) sweep();
        };
        globalThis.addEventListener?.("visibilitychange", onVisibility);
        return () => {
          stopPolling();
          if (observer !== null) observer.disconnect();
          globalThis.removeEventListener?.("visibilitychange", onVisibility);
        };
      }, []);

      /* ---- tree mutations ---- */

      const assignSession = React.useCallback((paneId, sessionId) => {
        setTree((prev) => planSessionDrop(prev, sessionId, paneId, null));
      }, []);

      const splitAt = React.useCallback((paneId, dir) => {
        setTree((prev) => splitPaneAt(prev, paneId, dir));
      }, []);

      const closeAt = React.useCallback((paneId) => {
        setTree((prev) => closePaneAt(prev, paneId));
      }, []);

      const rotateAt = React.useCallback((splitId) => {
        setTree((prev) => rotateSplit(prev, splitId));
      }, []);

      const toggleMaximize = React.useCallback((paneId) => {
        maximizedRef.current = maximizedRef.current === paneId ? null : paneId;
        setTree((prev) => ({ ...prev }));
      }, []);

      /** Raise or lower one pane's composer editor (header ⇕). Persisted so a
       *  reload keeps the pane the user widened. */
      const toggleDockTall = React.useCallback((paneId) => {
        setDockTall((prev) => {
          const next = new Set(prev);
          if (next.has(paneId)) next.delete(paneId);
          else next.add(paneId);
          writeDockTall(next);
          return next;
        });
      }, []);

      const resetTree = React.useCallback(() => {
        maximizedRef.current = null;
        const keep = list.ids[0] ?? null;
        setTree(makePane(keep));
      }, [list.ids]);

      // Selection is remembered by pane id. Moves keep the id (movePaneBeside),
      // so the highlight and the official row button target survive a move.
      const focusPane = React.useCallback((paneId) => {
        activeRef.current = paneId;
        setActivePane(paneId);
      }, []);

      /**
       * Load a session into the pane the user last touched, falling back to the
       * first pane. Used by the official row button, which lives outside this
       * component's tree.
       */
      const loadIntoActive = React.useCallback((sessionId) => {
        const target = activeRef.current;
        setTree((prev) => {
          const panes = [];
          walk(prev, (node) => {
            if (node.kind === "pane") panes.push(node);
          });
          const chosen = panes.find((pane) => pane.id === target) ?? panes[0];
          return chosen ? planSessionDrop(prev, sessionId, chosen.id, null) : prev;
        });
      }, []);

      // Publish the bridge while mounted so the official row button appears and
      // works; clearing it on unmount hides the button again.
      React.useEffect(() => {
        const bridge = { loadSession: loadIntoActive };
        publishBridge(bridge);
        return () => {
          if (bridgeStore.value === bridge) publishBridge(null);
        };
      }, [loadIntoActive]);

      // Keep the active pane valid as panes come and go.
      React.useEffect(() => {
        if (activePane && !findPane(tree, activePane)) setActivePane(null);
      }, [tree, activePane]);

      /**
       * New session for an empty pane, in the workspace of the nearest session.
       * The official connectWorkspace reuses a blank session of that workspace,
       * but it does not know which panes already show one, so a reused id that a
       * pane already shows is replaced by a fresh session. Only one creation runs
       * at a time: a click during a pending creation is ignored, so two panes can
       * never be handed the same blank session.
       */
      const createSessionIn = React.useCallback((paneId) => {
        const sessions = hostCtx?.sessions;
        if (!sessions || creatingRef.current.size > 0) return;
        creatingRef.current.add(paneId);
        const workspaceId = workspaceOfSession(nearestSession(treeRef.current, activeRef.current));
        const uiWorkspace = hostCtx?.uiWorkspace;
        const shownSomewhere = (sessionId) => {
          let hit = false;
          walk(treeRef.current, (node) => {
            if (node.kind === "pane" && node.sessionId === sessionId) hit = true;
          });
          return hit;
        };
        const fresh = () => sessions.create(workspaceId ? { workspaceId } : undefined);
        const open = workspaceId && uiWorkspace
          ? () => uiWorkspace.connectWorkspace(workspaceId)
          : fresh;
        Promise.resolve()
          .then(open)
          .then((sessionId) => (shownSomewhere(sessionId) ? fresh() : sessionId))
          .then((sessionId) => assignSession(paneId, sessionId))
          .catch((error) => {
            hostCtx?.logger?.warn?.(`web-split: new session failed: ${String(error?.message ?? error).slice(0, 160)}`);
          })
          .finally(() => {
            // Keep the lock a beat longer so the committed layout renders
            // before the next click reads treeRef.
            setTimeout(() => creatingRef.current.clear(), 250);
          });
      }, [assignSession]);

      const flashNote = (text) => {
        setNote(text);
        if (noteTimer.current !== null) clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => {
          noteTimer.current = null;
          setNote(null);
        }, 4000);
      };

      /** Replace the layout with the running sessions, at most one pane each up to six. Nothing is closed. */
      const importRunning = () => {
        if (runningIds.length === 0) {
          flashNote(t("importNone"));
          return;
        }
        const chosen = runningIds.slice(0, MAX_PANES);
        maximizedRef.current = null;
        activeRef.current = null;
        setActivePane(null);
        setTree(arrangeSessions(chosen));
        flashNote(
          runningIds.length > MAX_PANES
            ? t("importCapped", { count: String(runningIds.length), max: String(MAX_PANES) })
            : t("importDone", { count: String(chosen.length) })
        );
      };

      /* ---- preview: one intent drives the ghost layout and the commit ---- */

      /**
       * The drag ghost: a 2px line where the split would land. It is moved by
       * writing style directly, never through React state — a pointermove must
       * not re-render a pane, because each pane carries a live conversation.
       * Geometry is in canvas fractions (0..1).
       */
      function showGhostLine(geometry) {
        const ghost = ghostRef.current;
        if (!ghost) return;
        if (!geometry) {
          ghost.style.display = "none";
          return;
        }
        ghost.style.display = "block";
        // Both axes are written every time: the node is reused for the next
        // drag, so a stale margin from the other axis would offset the line.
        if (geometry.axis === "col") {
          ghost.style.left = `${geometry.position * 100}%`;
          ghost.style.top = `${geometry.start * 100}%`;
          ghost.style.height = `${geometry.span * 100}%`;
          ghost.style.width = "2px";
          ghost.style.marginLeft = "-1px";
          ghost.style.marginTop = "0px";
        } else {
          ghost.style.top = `${geometry.position * 100}%`;
          ghost.style.left = `${geometry.start * 100}%`;
          ghost.style.width = `${geometry.span * 100}%`;
          ghost.style.height = "2px";
          ghost.style.marginTop = "-1px";
          ghost.style.marginLeft = "0px";
        }
      }

      const pointInCanvas = (x, y) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        // A drag measures the canvas once, at press time: getBoundingClientRect
        // per pointermove showed up as this plugin's largest native cost.
        const box = canvasBoxRef.current ?? canvas.getBoundingClientRect();
        const px = (x - box.left) / Math.max(1, box.width);
        const py = (y - box.top) / Math.max(1, box.height);
        return px < 0 || px > 1 || py < 0 || py > 1 ? null : { x: px, y: py };
      };

      const showPreview = React.useCallback((intent) => {
        const key = intentKey(intent);
        if (key === previewKey.current) return;
        previewKey.current = key;
        previewRef.current = intent;
        setPreview(intent ? { intent } : null);
      }, []);

      /* ---- pointer drags: pane headers (move/swap) and split dividers ----
       * Listeners attach synchronously inside the pointerdown handler, never
       * from an effect: an effect only runs after the commit, so a press+release
       * pair faster than one frame would leave a stale drag behind. */

      const beginDrag = React.useCallback(
        (session) => {
          setDrag(session);
          canvasBoxRef.current = canvasRef.current ? canvasRef.current.getBoundingClientRect() : null;
          const onMove = (event) => {
            // A press that turns into a real resize must disarm the divider
            // double-click; a pointermove that did not actually move the pointer
            // is not a resize, so it leaves the flip armed.
            const moved = Math.abs(event.clientX - session.startX) > DRAG_SLOP
              || Math.abs(event.clientY - session.startY) > DRAG_SLOP;
            if (moved) movedRef.current = true;
            if (session.kind === "divider") {
              if (!moved) return;
              dividerClickRef.current = null;
              const box = canvasBoxRef.current;
              if (!box) return;
              const value = session.axis === "col"
                ? (event.clientX - box.left) / Math.max(1, box.width)
                : (event.clientY - box.top) / Math.max(1, box.height);
              // The divider sits at `start + span * ratio`; solve for ratio.
              const span = session.axis === "col" ? session.rect.w : session.rect.h;
              const origin = session.axis === "col" ? session.rect.x : session.rect.y;
              // Clamped exactly like the commit is (`setRatioAt` keeps ratios in
              // [MIN_RATIO, 1 - MIN_RATIO]): the ghost shows where the divider
              // will actually land, instead of running to the canvas edge and
              // then snapping back on release.
              const ratio = clamp(span > 0 ? (value - origin) / span : 0.5, MIN_RATIO, 1 - MIN_RATIO);
              // Move a ghost line, not the layout: committing a ratio resizes
              // both panes this cut touches, and each resize re-lays-out a whole
              // conversation. Measured with four live panes that is 17.8 fps
              // against 59.4 for the same session while dragging nothing, so the
              // tree is committed once, on release.
              pendingRatioRef.current = { splitId: session.splitId, ratio };
              showGhostLine({
                axis: session.axis,
                start: origin,
                span,
                position: origin + span * ratio
              });
              return;
            }
            const point = pointInCanvas(event.clientX, event.clientY);
            showPreview(point ? paneIntent(treeRef.current, session.paneId, point.x, point.y) : null);
          };
          const onUp = () => {
            detach();
            setDrag(null);
            canvasBoxRef.current = null;
            if (session.kind === "divider") {
              // The ghost stood in for the layout during the drag; turning it
              // into a real ratio is a single commit, and a press that never
              // moved leaves the tree untouched.
              showGhostLine(null);
              const pending = pendingRatioRef.current;
              pendingRatioRef.current = null;
              if (pending && movedRef.current) {
                setTree((prev) => setRatioAt(prev, pending.splitId, pending.ratio));
              }
              return;
            }
            const intent = previewRef.current;
            showPreview(null);
            // A press+release without movement is a click, not a drag.
            if (movedRef.current && intent) setTree((prev) => planIntent(prev, intent));
          };
          // The listeners live on `window` for the whole gesture; detaching is
          // idempotent so the release path and an unmount can both call it.
          const detach = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            if (dragDetachRef.current === detach) dragDetachRef.current = null;
          };
          dragDetachRef.current = detach;
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          window.addEventListener("pointercancel", onUp);
        },
        [showPreview]
      );

      const onPaneDragStart = React.useCallback((paneId, clientX, clientY) => {
        movedRef.current = false;
        beginDrag({ kind: "pane", paneId, startX: clientX, startY: clientY });
      }, [beginDrag]);

      /* ---- right-click menu ----
       * The pane subtree is this plugin's own DOM, so one contextmenu handler
       * per pane claims the gesture without touching anything official. Two
       * escapes stay open by design: an inner handler that already called
       * preventDefault (a tool card's own copy menu) wins outright, and
       * Shift+right-click is never claimed, so the browser's menu — the only
       * place that can offer copy-image / save / inspect — is one key away.
       */

      const onPaneMenu = React.useCallback((paneId, event) => {
        if (event.defaultPrevented === true || event.shiftKey === true) return;
        event.preventDefault();
        const canvas = canvasRef.current;
        const box = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
        const live = selectionText();
        setMenu({
          paneId,
          x: event.clientX - box.left,
          y: event.clientY - box.top,
          clientX: event.clientX,
          clientY: event.clientY,
          text: live.trim() !== "" ? live : selectionRef.current,
          editable: editableFrom(event.target),
          maximized: maximizedRef.current === paneId
        });
      }, []);

      const menuCopy = React.useCallback(() => {
        const text = menu?.text ?? "";
        setMenu(null);
        if (text.trim() === "") return;
        copyPlainText(text).then((ok) => {
          if (!ok) flashNote(t("ctxCopyFailed"));
        });
      }, [menu]);

      /**
       * Run a hit test or caret placement with our own menu out of the way: the
       * menu is still mounted right after `setMenu(null)` and it covers the very
       * point the user clicked, so it would otherwise answer for it.
       */
      const withoutMenuHitTest = React.useCallback((run) => {
        const menuEl = menuRef.current;
        const previous = menuEl ? menuEl.style.pointerEvents : null;
        if (menuEl) menuEl.style.pointerEvents = "none";
        try {
          return run();
        } finally {
          if (menuEl && previous !== null) menuEl.style.pointerEvents = previous;
        }
      }, []);

      const menuPaste = React.useCallback(async () => {
        const field = menu?.editable ?? null;
        const point = menu ? { x: menu.clientX, y: menu.clientY } : null;
        setMenu(null);
        if (!field || !field.isConnected) return;
        try {
          withoutMenuHitTest(() => {
            field.focus?.();
            if (point) placeCaretAt(field, point.x, point.y);
          });
        } catch {
          /* the field keeps its own caret */
        }
        let text = "";
        try {
          text = await navigator.clipboard.readText();
        } catch {
          flashNote(t("ctxPasteBlocked"));
          return;
        }
        if (text === "") return;
        try {
          if (!insertPlainText(field, text)) flashNote(t("ctxPasteFailed"));
        } catch {
          flashNote(t("ctxPasteFailed"));
        }
      }, [menu, withoutMenuHitTest]);

      const menuMove = React.useCallback(() => {
        const current = menu;
        setMenu(null);
        if (current) onPaneDragStart(current.paneId, current.clientX, current.clientY);
      }, [menu, onPaneDragStart]);

      // Dismiss on Escape, on a press anywhere outside, and on resize/blur.
      React.useEffect(() => {
        if (!menu) return undefined;
        const onPointerDown = (event) => {
          const node = menuRef.current;
          const target = event.target instanceof Node ? event.target : null;
          if (node && target && node.contains(target)) return;
          setMenu(null);
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") setMenu(null);
        };
        const onLeave = () => setMenu(null);
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("resize", onLeave);
        window.addEventListener("blur", onLeave);
        return () => {
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
          window.removeEventListener("resize", onLeave);
          window.removeEventListener("blur", onLeave);
        };
      }, [menu]);

      // Keep the menu inside the canvas: clamp against its measured size, so a
      // right-click in the bottom-right pane still shows every row.
      React.useLayoutEffect(() => {
        const node = menuRef.current;
        const canvas = canvasRef.current;
        if (!menu || !node || !canvas) return;
        const box = canvas.getBoundingClientRect();
        const x = Math.max(4, Math.min(menu.x, box.width - node.offsetWidth - 4));
        const y = Math.max(4, Math.min(menu.y, box.height - node.offsetHeight - 4));
        if (x !== menu.x) node.style.left = `${x}px`;
        if (y !== menu.y) node.style.top = `${y}px`;
      }, [menu]);

      /* ---- session drags from the official sidebar list ----
       * dsh makes every non-blank row draggable and writes its id into the
       * transfer, which is unreadable until drop. The row is noted at dragstart
       * instead, so the preview can run during the drag. */

      React.useEffect(() => {
        const onStart = (event) => {
          const node = event.target instanceof Element ? event.target : null;
          const row = node?.closest?.('[data-row-key^="session:"]') ?? null;
          sessionDragRef.current = row ? row.getAttribute("data-row-key").slice("session:".length) : null;
        };
        const onEnd = () => {
          sessionDragRef.current = null;
          showPreview(null);
        };
        document.addEventListener("dragstart", onStart, true);
        document.addEventListener("dragend", onEnd, true);
        return () => {
          document.removeEventListener("dragstart", onStart, true);
          document.removeEventListener("dragend", onEnd, true);
        };
      }, [showPreview]);

      const onDragOver = (event) => {
        const sessionId = sessionDragRef.current;
        if (!sessionId || maximizedRef.current) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        const point = pointInCanvas(event.clientX, event.clientY);
        showPreview(point ? sessionIntent(treeRef.current, sessionId, point.x, point.y) : null);
      };

      const onDragLeave = (event) => {
        const canvas = canvasRef.current;
        if (!canvas || !canvas.contains(event.relatedTarget)) showPreview(null);
      };

      const onDrop = (event) => {
        event.preventDefault();
        const intent = previewRef.current;
        showPreview(null);
        if (intent && intent.kind === "session") setTree((prev) => planIntent(prev, intent));
      };

      /* ---- render: real panes, then the dashed preview of the drop ---- */

      const panes = [];
      const dividers = [];
      layoutTree(tree, { x: 0, y: 0, w: 1, h: 1 }, panes, dividers);
      // A maximized pane that left the tree (closed, or emptied into another
      // pane) must not blank the canvas: fall back to the full layout for this
      // paint; the effect above tidies the ref once the tree has committed.
      const maximizedId = maximizedRef.current && findPane(tree, maximizedRef.current) ? maximizedRef.current : null;
      const visible = maximizedId ? panes.filter((entry) => entry.pane.id === maximizedId) : panes;
      const intent = preview ? preview.intent : null;
      const planned = intent ? planIntent(tree, intent) : tree;
      const showGhosts = planned !== tree && !maximizedId;
      const ghosts = [];
      if (showGhosts) layoutTree(planned, { x: 0, y: 0, w: 1, h: 1 }, ghosts, []);
      const draggedId = draggedSessionOf(tree, intent);
      const targetId = intent ? intent.targetId : null;
      const swapping = intent !== null && intent.kind === "pane" && intent.action.kind === "swap";
      let hintText = introOpen ? t("hint") : null;
      if (intent && intent.kind === "session") hintText = t("previewSession");
      if (intent && intent.kind === "pane") hintText = t("hintMove");

      return h(
        "div",
        { className: "dshSplit_root", "data-split-root": "" },
        h(
          "div",
          {
            className: "dshSplit_canvas",
            "data-split-canvas": "",
            "data-dragging": drag || intent ? "1" : undefined,
            ref: canvasRef,
            // A right-click can collapse the selection before our contextmenu
            // handler runs, so remember what was selected at mouse-down — the
            // user's "select text, then right-click" flow keeps working.
            onMouseDownCapture: () => {
              selectionRef.current = selectionText();
            },
            onDragOver,
            onDragLeave,
            onDrop
          },
          hintText ? h("div", { className: "dshSplit_hint" }, hintText) : null,
          // The divider drag ghost (see showGhostLine): plain DOM, moved by
          // style, so dragging a divider costs no React work at all.
          h("div", { className: "dshSplit_dragGhost", "data-drag-ghost": "", ref: ghostRef }),
          // One divider per split node; each owns its own ratio. Hidden while a
          // preview shows, so the dashed layout is the only thing to read.
          maximizedId || showGhosts
            ? null
            : dividers.map((divider) =>
                h("div", {
                  key: divider.id,
                  className: "dshSplit_divider",
                  "data-axis": divider.dir,
                  "data-active": drag && drag.kind === "divider" && drag.splitId === divider.id ? "1" : undefined,
                  // Each divider covers its own split's band only: a nested
                  // divider that spanned the whole canvas would cross its
                  // ancestors and steal their pointer hits.
                  style: divider.dir === "col"
                    ? {
                        left: `${(divider.rect.x + divider.rect.w * divider.ratio) * 100}%`,
                        top: `${divider.rect.y * 100}%`,
                        height: `${divider.rect.h * 100}%`
                      }
                    : {
                        top: `${(divider.rect.y + divider.rect.h * divider.ratio) * 100}%`,
                        left: `${divider.rect.x * 100}%`,
                        width: `${divider.rect.w * 100}%`
                      },
                  title: t("dividerRotate"),
                  onPointerDown: (event) => {
                    if (event.button !== 0) return;
                    // preventDefault on pointerdown eats mousedown, so the
                    // browser never fires a native dblclick here. Detect the
                    // second press ourselves: two presses on the same cut within
                    // 350ms flip it, and the second press starts no drag.
                    event.preventDefault();
                    const now = Date.now();
                    const last = dividerClickRef.current;
                    if (last && last.id === divider.id && now - last.at < 350) {
                      dividerClickRef.current = null;
                      rotateAt(divider.id);
                      return;
                    }
                    dividerClickRef.current = { id: divider.id, at: now };
                    movedRef.current = false;
                    beginDrag({
                      kind: "divider",
                      splitId: divider.id,
                      axis: divider.dir,
                      rect: divider.rect,
                      startX: event.clientX,
                      startY: event.clientY
                    });
                  }
                })
              ),
          visible.map((entry) =>
            h(PaneView, {
              key: entry.pane.id,
              pane: entry.pane,
              title: entry.pane.sessionId ? titles[entry.pane.sessionId] ?? entry.pane.sessionId : t("paneEmpty"),
              running: entry.pane.sessionId ? list.meta[entry.pane.sessionId]?.running === true : false,
              // A maximized pane covers the whole canvas regardless of its cell.
              rect: maximizedId ? { x: 0, y: 0, w: 1, h: 1 } : entry.rect,
              maximized: maximizedId === entry.pane.id,
              active: activePane === entry.pane.id,
              dim: showGhosts,
              dropPane: !swapping && targetId === entry.pane.id ? targetId : null,
              swapPane: swapping && targetId === entry.pane.id ? targetId : null,
              dockTall: dockTall.has(entry.pane.id),
              SessionProvider: props.SessionProvider,
              renderSlot: props.renderSlot,
              onPaneDragStart,
              onPaneMenu,
              onFocusPane: focusPane,
              onCreateSession: createSessionIn,
              onSplit: splitAt,
              onToggleMaximize: toggleMaximize,
              onToggleDockTall: toggleDockTall,
              onClosePane: closeAt
            })
          ),
          showGhosts
            ? ghosts.map((entry) =>
                h("div", {
                  key: `ghost-${entry.pane.id}`,
                  className: "dshSplit_ghost",
                  "data-new": draggedId !== null && entry.pane.sessionId === draggedId ? "1" : undefined,
                  style: {
                    left: `${entry.rect.x * 100}%`,
                    top: `${entry.rect.y * 100}%`,
                    width: `${entry.rect.w * 100}%`,
                    height: `${entry.rect.h * 100}%`
                  }
                }, h("span", { className: "dshSplit_ghostLabel" },
                  entry.pane.sessionId ? (titles[entry.pane.sessionId] ?? entry.pane.sessionId) : t("ghostEmpty")))
              )
            : null,
          menu
            ? h(PaneMenu, {
                menu,
                menuRef,
                capped: countPanes(tree) >= MAX_PANES,
                single: countPanes(tree) < 2,
                onCopy: menuCopy,
                onPaste: menuPaste,
                onMove: menuMove,
                onSplitRight: () => {
                  const paneId = menu.paneId;
                  setMenu(null);
                  splitAt(paneId, "col");
                },
                onSplitDown: () => {
                  const paneId = menu.paneId;
                  setMenu(null);
                  splitAt(paneId, "row");
                },
                onZoom: () => {
                  const paneId = menu.paneId;
                  setMenu(null);
                  toggleMaximize(paneId);
                },
                onClose: () => {
                  const paneId = menu.paneId;
                  setMenu(null);
                  closeAt(paneId);
                },
                importCount: runningIds.length,
                onImportRunning: () => {
                  setMenu(null);
                  importRunning();
                },
                onReset: () => {
                  setMenu(null);
                  resetTree();
                }
              })
            : null,
          h("div", { className: "dshSplit_tools" }, note ? h("span", { className: "dshSplit_note" }, note) : null)
        )
      );
    }

    /** Sidebar panel-list entry: opens the split panel. */
    function SplitIcon() {
      return h(
        "button",
        {
          type: "button",
          className: "dshSplit_iconBtn",
          title: translator("panel"),
          "aria-label": translator("panel"),
          onClick: () => hostCtx?.layout?.selectPanel(PANEL_ID)
        },
        h(
          "svg",
          { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
          h("rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "currentColor", "stroke-width": 1.3 }),
          h("path", { d: "M8 2.5v11", stroke: "currentColor", "stroke-width": 1.3 })
        )
      );
    }

    /**
     * Official session-row action: load this session into the active split
     * pane. Renders nothing while the split panel is closed, so the official
     * list is untouched for everyone else.
     */
    function SessionRowSplitButton(props) {
      const bridge = React.useSyncExternalStore(subscribeBridge, readBridge);
      if (bridge === null) return null;
      return h(
        "button",
        {
          type: "button",
          className: "dshSplit_rowBtn",
          title: translator("rowAction"),
          "aria-label": translator("rowAction"),
          onClick: (event) => {
            event.stopPropagation();
            bridge.loadSession(props.sessionId);
          }
        },
        h(
          "svg",
          { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
          h("rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, stroke: "currentColor", "stroke-width": 1.3 }),
          h("path", { d: "M8 2.5v11M1.5 8h13", stroke: "currentColor", "stroke-width": 1.3 })
        )
      );
    }

    return {
      inject: ["slots", "layout", "locale", "sessions", "workspaces", "uiWorkspace"],
      apply(ctx) {
        hostCtx = ctx;
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), "web-split: locale dictionaries");
        const t = ctx.locale.bind(NS);
        translator = t;

        // One stylesheet for the whole plugin, removed with the fiber.
        const style = document.createElement("style");
        style.setAttribute("data-dsh-split", "");
        style.textContent = CSS;
        document.head.appendChild(style);
        ctx.effect(() => () => style.remove(), "web-split: stylesheet");

        // The panel entry declares a session-scoped child, which is what puts
        // `SessionProvider` into its kit; the child itself renders the
        // embedded Conversation for whichever session the provider publishes.
        ctx.slots.inject("main", () =>
          ctx.slots.register(
            {
              name: "main",
              key: PANEL_ID,
              locale: NS,
              children: { "split.pane.body": { kind: "single", scope: "session-maybe" } }
            },
            SplitPanel
          )
        );
        ctx.slots.inject("split.pane.body", () =>
          ctx.slots.register({ name: "split.pane.body", locale: NS }, PaneBody)
        );
        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: PANEL_ID,
              order: 50,
              label: () => t("panel"),
              locale: NS
            },
            SplitIcon
          )
        );
        // One button at the end of every official session row: load that
        // session into the active split pane. This is the official row-action
        // seat, so the list itself stays the official one.
        ctx.slots.inject("sidebar.workspaces.session.row.action", () =>
          ctx.slots.register(
            {
              name: "sidebar.workspaces.session.row.action",
              id: "web-split-load",
              order: 300,
              locale: NS
            },
            SessionRowSplitButton
          )
        );
      }
    };
  }
});
