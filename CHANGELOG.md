# Changelog

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
