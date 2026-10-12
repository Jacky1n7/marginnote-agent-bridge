---
name: marginnote
description: Read and edit the user's MarginNote 4 notebooks (mind maps, cards, comments, tags, documents) through MN Agent Bridge. Use when the user mentions MarginNote / MN, their mind map (脑图), cards (卡片), study sets (学习集), or wants notes, questions or outlines put into MarginNote.
---

# MarginNote via MN Agent Bridge

MN Agent Bridge exposes MarginNote 4 on this Mac as tools. Prefer the MCP tools (`note_get`, `note_create`, …) when they are available; otherwise use the CLI: `mnab call <action> '<json>'` (prints JSON). Run `mnab doctor` if anything times out, and ask the user to run `mnab pair` on `UNAUTHORIZED`.

## Mental model

- **Notebook** (study set, `notebookId`) → mind map of **notes** (cards, `noteId`). Every note has `title`, `excerpt` (main body), `comments[]`, `#tags`, `color` (0–15), children.
- Excerpts and comments render **Markdown + LaTeX** (`$…$`, `$$…$$`). A single inline formula never wraps; split long formulas into several `$…$` pieces or use `$$…$$`.
- Every write is **one undo step** in MarginNote named `Agent: <action>`; `ui_undo` reverts the latest.

## Workflow

1. Orient: `context_get` (open notebook, selected cards, current page) or `notebook_list`.
2. Locate: `note_tree` (`format: "outline"` shows ids compactly) or `note_search`.
3. Read before writing: `note_get` / `note_batchGet`. Match the existing style of sibling cards (title vs. excerpt, color, Markdown flag) — inspect two or three siblings first.
4. Write:
   - one card: `note_create` with `parentId`;
   - an outline or many cards: `note_importMarkdown` (`# headings` + nested lists → card tree);
     `mode: "excerpt"` puts heading + body into the excerpt with no title (one-question-per-card style), `mode: "title"` uses the heading as title;
   - several dependent edits: `batch` with `$<index>.<field>` references, e.g. `{"parentId": "$0.id"}` — one round trip, one undo step, rolled back on failure.
5. Verify with `note_get` / `note_tree`, then tell the user what changed and that ⌘Z (or `ui_undo`) reverts it.

## Rules

- Never delete or move the user's cards unless asked; `note_delete` refuses non-empty cards without `recursive: true` — do not add it casually.
- Before large restructurings call `notebook_backup`.
- `ui_*` actions change what the user sees; avoid them while the user is working unless asked.
- Handwriting and image comments are not readable as text; `note_image` returns them as images.
- If a write fails with `FORBIDDEN`, the user switched the bridge to read-only mode — ask, do not work around it.

## Example: add solved questions under a chapter card

```json
{"action": "note.importMarkdown", "params": {
  "parentId": "<chapter noteId>", "mode": "excerpt", "color": 12,
  "markdown": "# 【8】\n设 $L: y=x^2\\ (0\\le x\\le 1)$，求 $\\int_L xy\\,ds$。\n\n# 【9】\n…"
}}
```
