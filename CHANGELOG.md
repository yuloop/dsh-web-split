# Changelog

## 1.1.0 — 2026-11-26

面向 DSH `0.2.3-alpha.2`。这一版把 10 月之后在本机跑了几周的改动整理回来。

- **修：分屏里只有一格有对话，其余只剩输入框**（最重要）。DSH 0.2.3-alpha.2 起，对话装配只在某个引用保留 `conversation` 分面时才跟随会话；插件 retain 时没传 `facets`，于是除主视图正在看的那一个会话，其余窗格永远拿到空对话。现在 `usePaneReference` 的 `sessions.retain()` 带上 `facets: { conversation: true }`，与官方 `mainView` / `sidebarView` / `sidebarChat` 一致。
- **新：窗格排队异步打开**。`OPEN_CONCURRENCY = 2`、`OPEN_SLOT_TIMEOUT_MS = 15000`：恢复多格布局时最多两个窗格同时打开历史，其余排队，排队中显示「正在载入会话… / Loading session…」，窗格关闭或打开失败立刻归还名额。
- **修：窗格底栏重叠**。不再用宽泛的 `[class*="_dock"]` 选择器搬动输入卡，改成 `data-composer-card` / `data-composer-dock` 钩子：统计行固定在卡片下方的独立一行并可换行，操作按钮与极速滑块留在卡内。重新注入样式前会先移除旧的 `style[data-dsh-split]`，热更新不会叠两份。新增只读回归脚本 `tests/composer-status.geometry.js`。
- **修：窗格里的目标栏占三行**。删掉插件自己的折行覆盖，交回官方单行省略；点「编辑」仍可看全文。
- **修：定时任务工作区的会话被误导入**。`sessionsView` 之前没把 `cwd` 传下去，`fromScheduler()` 永远读到空串，「导入运行中」的跳过规则等于没生效。
- **修：`running` 状态来源**。`runningIds` 改用 `list.meta[id]`，不再依赖可能不存在的 `byId`。
- **修：复制/粘贴的边界**。`copyPlainText` 的兜底 textarea 用 `try/finally` 收尾，异常时不会留在 DOM 里；右键复制优先读 `<input>/<textarea>` 的选区；`placeCaretAt` 补上标准的 `document.caretPositionFromPoint`（Firefox），旧接口保留。
- 移除：`trimPaneHistory()`。实测对已挂载的对话行数没有作用（797 行裁完还是 797 行），只会让回看多绕一层。

## 1.0.1 — 2026-10-19

- `导入运行中 / Import running` 现在**跳过定时任务工作区**（cwd 最后一段是 `cron-jobs` 的会话），
  计数与导入都不含它们——定时任务不是用来盯的，塞进窗格只会占位置。
  判定见 `client.js` 的 `SCHEDULED_WORKSPACE`，调度器用别的目录名时改这个常量即可。

## 1.0.0 — 2026-10-19

First public release. It is the panel-based split view that has been running locally for two weeks:

- sidebar `分屏 / Split` entry, split view as a `main` panel
- free pane tree: split right/down, move, swap, resize, double-click divider to flip and reset
- fill panes by dragging a Session row, by the row action, or from the pane context menu
- each pane mounts the official `conversation.content` slot for its Session
- unread dots mirrored onto pane titles
- import running Sessions, pane cap, maximize/restore, composer stretch
- layout persisted in `localStorage`, Chinese + English UI

Known limitation: file/image links inside a pane cannot open the right sidebar (no Session context in a global panel). See README.

## Not released

A floating variant (grid raised over the conversation column through `shell.overlay`, so the right sidebar keeps working) was developed afterwards and is intentionally **not** part of 1.0.0: it changes where the grid lives and was still unstable when this release was cut.
