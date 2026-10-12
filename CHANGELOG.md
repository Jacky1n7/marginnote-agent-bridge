# Changelog

## 0.1.0 — 2026-10-12

First release.

- MarginNote add-on with 44 actions: notebooks, documents (TOC, page text), notes (get, tree as JSON/Markdown/outline, search, create, update, delete, move, clone, link), comments (add, update, reorder, remove), tags, images, Markdown outline import, `batch` with references and automatic rollback, context, UI focus/commands, undo/redo, backups.
- Token auth with in-app Allow/Deny pairing, fixed reply channel, replay guard, read-only switch and revocation from the toolbar.
- `mnab` CLI (setup, doctor, pair, call, shortcuts) and a dependency-free MCP server (`mnab mcp`).
- Background receiver app for `mnagentbridge://` replies, with chunking for large answers and clipboard transport for large inputs.
- End-to-end test suite (36 checks) against a live MarginNote.
