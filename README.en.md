# dsh-web-split

[中文](README.md) | **English**

**Free split screen for DeepSeek Harness Web.** Open a split view beside your normal work and keep two, three or four Sessions visible at once — each pane renders that Session's real conversation, input box included.

![split view](screenshots/split-panes.png)

## Features

- **Sidebar entry** — a `分屏 / Split` button in the sidebar opens the split view as a main panel.
- **Free layout** — split right or down, drag a pane onto another to swap them, drag onto a pane's edge to move it there, drag the divider to resize, double-click the divider to flip the orientation and reset to 50/50.
- **Fill panes from anywhere** — drag a Session row from the sidebar into a pane, or use the row's own "放入分屏窗格 / Load into split pane" action, or the pane's context menu.
- **Real conversations** — every pane mounts the official `conversation.content` slot for its Session, so streaming, tools, attachments and the composer all behave exactly as they do in the normal view.
- **Unread dots** — the sidebar's unread indicator is mirrored onto the pane title, so you can see which pane is talking.
- **Import running Sessions** — one menu action arranges every running Session into panes (up to the pane cap) without closing anything. Sessions from a scheduler workspace are skipped (last cwd segment `cron-jobs`; see `SCHEDULED_WORKSPACE` in `client.js`).
- **Persisted layout** — the whole tree (panes, ratios, assignment) is kept in `localStorage` and restored on reload.
- **Bilingual UI** — Chinese and English strings ship with the plugin.
- **No host-side behaviour** — the host half only announces the client bundle; nothing in the Session domain is touched.

## Install

The plugin is a bundle with a loader patch (`cordis.patch.yml`); install it like any other DSH plugin:

```bash
# straight from GitHub
dsh plugin --profile web add github:yuloop/dsh-web-split

# or from a local checkout
dsh plugin --profile web add /path/to/dsh-web-split
```

Restart DSH after installing, then reload the page. The sidebar shows the `分屏` entry.

> `cordis.patch.yml` names the package (`dsh-web-split`). If you vendor the files into a local plugin directory instead, point its patch entry at the absolute path of `index.js` — that is how it runs on the machine it was developed on.

## Known limitation

Clicking a **file link or an image inside a pane** shows an error dialog:

```
无法打开文件 / sidebarRight: no session surface is mounted
```

Reason: file links open the right sidebar through `sidebarRight.require()`, which only works for the Session that the shell currently has *on screen*. A global `main` panel carries no Session context, so the call throws. Panes still render and scroll their content; only the file/image preview is affected — open the file from the normal conversation view instead (click the Session in the sidebar, then use the link there).

This limitation is why the panel-based design is the stable release: a floating variant that keeps the conversation column active is developed separately and is **not** part of this release (it changes where the grid lives and needs the shell's `shell.overlay` seam).

## Requirements

- DeepSeek Harness Web with the official UI packages (`dsh-client-ui-layout`, `-session`, `-conversation`, `dsh-client-locale`, `dsh-api-session-controller`).
- Developed against DSH `0.1.1-rc.2`.

## Layout

```
client.js          the whole web half (panel, pane tree, drag & drop, i18n, CSS)
index.js           host half: announces the bundle, registers nothing else
cordis.patch.yml   loader patch fragment ("insert id: web-split")
package.json       manifest, including the dsh.client declaration
docs/DEVLOG.md     development log, day by day (Chinese, local notes)
```

## License

MIT — see [LICENSE](LICENSE).

## Screenshots

| | |
|---|---|
| ![three panes](screenshots/split-panes.png) | ![pane menu](screenshots/pane-menu.png) |
