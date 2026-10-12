# API reference

> Generated from the add-on's action registry (v0.1.0). Do not edit by hand — run `npm run build`.

Every action is called the same way — from the CLI, from the MCP server (tool name = action name with `.` → `_`), or as a raw URL:

```bash
mnab call note.get '{"noteId":"…"}'
```

Legend: ✏️ writes data (one undo step) · 🔓 no token needed · 🧪 experimental

## Contents

- **System & pairing**: [`ping`](#ping) · [`pair`](#pair) · [`auth.clients`](#authclients) · [`auth.revoke`](#authrevoke) · [`capabilities`](#capabilities) · [`bridge.log`](#bridgelog)
- **Context**: [`context.get`](#contextget)
- **UI & commands**: [`ui.openNotebook`](#uiopenNotebook) · [`ui.focusNote`](#uifocusNote) · [`ui.hud`](#uihud) · [`ui.queryCommand`](#uiqueryCommand) · [`ui.command`](#uicommand) · [`ui.undo`](#uiundo) · [`ui.redo`](#uiredo)
- **Notebooks**: [`notebook.list`](#notebooklist) · [`notebook.get`](#notebookget) · [`notebook.rename`](#notebookrename) · [`notebook.backup`](#notebookbackup) · [`notebook.backups`](#notebookbackups) · [`notebook.restoreBackup`](#notebookrestoreBackup)
- **Documents**: [`document.list`](#documentlist) · [`document.get`](#documentget) · [`document.pageText`](#documentpageText)
- **Notes (cards)**: [`note.get`](#noteget) · [`note.batchGet`](#notebatchGet) · [`note.tree`](#notetree) · [`note.search`](#notesearch) · [`note.image`](#noteimage) · [`note.create`](#notecreate) · [`note.update`](#noteupdate) · [`note.delete`](#notedelete) · [`note.move`](#notemove) · [`note.clone`](#noteclone) · [`note.link`](#notelink) · [`note.importMarkdown`](#noteimportMarkdown)
- **Tags**: [`tag.list`](#taglist) · [`tag.add`](#tagadd) · [`tag.remove`](#tagremove)
- **Review**: [`review.status`](#reviewstatus)
- **Comments**: [`comment.add`](#commentadd) · [`comment.remove`](#commentremove) · [`comment.update`](#commentupdate) · [`comment.reorder`](#commentreorder)
- **Batch**: [`batch`](#batch)

## System & pairing

### `ping` 🔓

Check that the bridge is alive and whether the given token is valid. No token required.

_No parameters._

**Returns:** `{ bridgeVersion, protocol, appVersion, os, paired }`

### `pair` 🔓

Request a token. MarginNote shows an Allow/Deny alert; the token is returned only if the user taps Allow.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `client` | string | yes |  | Human-readable client name shown in the alert, e.g. "Claude Code". |

**Returns:** `{ token, client }`

### `auth.clients`

List paired clients (token hints only).

_No parameters._

**Returns:** `[{ client, createdAt, lastUsed, tokenHint }]`

### `auth.revoke`

Revoke the calling token (default) or every token.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `all` | boolean |  | `false` | Revoke every paired client, not only the caller. |

**Returns:** `{ revoked }`

### `capabilities`

Self-description: every action with its parameters, so agents can discover the API at runtime.

_No parameters._

**Returns:** `{ bridgeVersion, protocol, actions: [{ name, group, summary, write, params, returns }] }`

### `bridge.log`

Recent requests handled by the bridge (newest last).

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer |  | `30` |  |

**Returns:** `[{ at, id, action, client, ok, code, ms }]`

## Context

### `context.get`

What the user is looking at: open notebook, focused and selected notes, current document and page, text selection.

_No parameters._

**Returns:** `{ studyMode, notebook, focusNote, selectedNotes, document, page, selectionText }`

## UI & commands

### `ui.openNotebook`

Open a notebook (and optionally a document) in the current window.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `notebookId` | string | yes |  |  |
| `docMd5` | string |  |  | Document to open alongside the notebook. |

**Returns:** `{ opened }`

### `ui.focusNote`

Scroll to and highlight a note in the mind map, the document, or the floating mind map. isFocusNote tells whether MarginNote also made it the focus note (usually it does not; selection stays with the user).

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `target` | string (mindmap \| document \| float) |  | `"mindmap"` |  |

**Returns:** `{ focused, isFocusNote }`

### `ui.hud`

Show a short toast message inside MarginNote.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `message` | string | yes |  |  |
| `seconds` | number |  | `2` |  |

**Returns:** `{ shown }`

### `ui.queryCommand`

Check whether a built-in MarginNote command is available right now (see docs/COMMANDS.md).

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `command` | string | yes |  |  |
| `keyFlags` | integer |  | `0` |  |

**Returns:** `{ command, disabled, checked }`

### `ui.command` ✏️

Run any built-in MarginNote command (menu item / shortcut) in the current window, e.g. ZoomToFit, ViewExpandAll, ToggleMindMap. Card commands act on the card the user has selected; some commands open dialogs that need the user.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `command` | string | yes |  |  |
| `keyFlags` | integer |  | `0` |  |

**Returns:** `{ command, ran }`

### `ui.undo` ✏️

Undo the last change in MarginNote (every bridge write is one undo step named "Agent: <action>").

_No parameters._

**Returns:** `{ undone }`

### `ui.redo` ✏️

Redo the last undone change.

_No parameters._

**Returns:** `{ redone }`

## Notebooks

### `notebook.list`

List all study sets / notebooks.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `type` | string (mindmap \| cardDeck \| document \| all) |  | `"all"` |  |

**Returns:** `[{ id, title, type, lastVisit, documentCount, url }]`

### `notebook.get`

Notebook details with its documents and root notes.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `notebookId` | string | yes |  |  |

**Returns:** `{ ...notebook, documents: [...], roots: [noteSummary] }`

### `notebook.rename` ✏️

Rename a notebook.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `notebookId` | string | yes |  |  |
| `title` | string | yes |  |  |

**Returns:** `notebook summary`

### `notebook.backup` 🧪

Export a full copy of a notebook into MarginNote's own storage (Documents/AgentBridgeBackups). Take one before large edits.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `notebookId` | string | yes |  |  |

**Returns:** `{ file, path }`

### `notebook.backups` 🧪

List backups created by notebook.backup.

_No parameters._

**Returns:** `[{ file }]`

### `notebook.restoreBackup` ✏️ 🧪

Import a backup made by notebook.backup back into MarginNote (MarginNote decides whether it merges or adds a copy).

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `file` | string | yes |  | File name from notebook.backups. |
| `merge` | boolean |  | `false` |  |

**Returns:** `{ imported }`

## Documents

### `document.list`

List documents (PDF/EPUB…), optionally only those attached to one notebook.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `notebookId` | string |  |  | Only documents of this notebook. |

**Returns:** `[{ docMd5, title, pageCount, path, lastVisit }]`

### `document.get`

Document details including its table of contents.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `docMd5` | string | yes |  |  |

**Returns:** `{ ...document, toc }`

### `document.pageText` 🧪

Extract the text of one page of a document (needs a text layer; scanned pages return little or nothing).

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `docMd5` | string | yes |  |  |
| `page` | integer | yes |  | 1-based page number. |
| `raw` | boolean |  | `false` | Also return the raw native structure (for debugging). |

**Returns:** `{ docMd5, page, text }`

## Notes (cards)

### `note.get`

Full details of one note: title, excerpt, comments, tags, parent/children, source page, dates.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |

**Returns:** `note detail`

### `note.batchGet`

Details of several notes at once. Missing ids are reported instead of failing.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteIds` | array<string> | yes |  |  |

**Returns:** `{ notes: [detail], missing: [id] }`

### `note.tree`

A subtree (from a note) or a whole mind map (from a notebook) as JSON, Markdown or an indented outline.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string |  |  | Root of the subtree. Give noteId or notebookId. |
| `notebookId` | string |  |  | Dump every root of this notebook. |
| `depth` | integer |  | `3` | Levels below the root to include (max 50). |
| `format` | string (json \| markdown \| outline) |  | `"json"` |  |
| `headingLevels` | integer |  | `3` | markdown: levels rendered as # headings before switching to bullets. |
| `includeComments` | boolean |  | `false` | markdown: include text comments as quotes. |

**Returns:** `json: { roots: [tree] } | markdown/outline: { text }`

### `note.search`

Search notes by text or regex in titles, excerpts and comments, in one notebook or all notebooks.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | yes |  |  |
| `notebookId` | string |  |  | Limit to one notebook (recommended). |
| `regex` | boolean |  | `false` |  |
| `caseSensitive` | boolean |  | `false` |  |
| `fields` | array<string> |  | `["title","excerpt","comments"]` | Any of title, excerpt, comments. |
| `limit` | integer |  | `50` |  |

**Returns:** `{ results: [{ ...noteSummary, notebookId, matchedIn, path }], scanned, truncated }`

### `note.image`

The image of an image excerpt, or of a handwriting/image comment, as base64.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `commentIndex` | integer |  |  | Index of a PaintNote comment; omit for the excerpt image. |

**Returns:** `{ mime, base64, bytes }`

### `note.create` ✏️

Create a card as a child of parentId (or as a root of notebookId), with optional excerpt, comments, tags and color.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `parentId` | string |  |  | Parent note. Either parentId or notebookId is required. |
| `notebookId` | string |  |  | Create a root note in this notebook. |
| `beforeId` | string |  |  | Insert before this sibling instead of appending. |
| `comments` | array |  |  | Comments to append: "markdown text" or {text, markdown} or {linkTo: noteId} or {html, text}. |
| `tags` | array<string> |  |  | Hashtags without "#". |
| `title` | string |  |  | Card title (plain text, not rendered as Markdown). |
| `excerpt` | string |  |  | Card body / excerpt text. Rendered as Markdown + LaTeX when markdown=true. |
| `markdown` | boolean |  |  | Render the excerpt as Markdown (default true when excerpt is given on create). |
| `color` | integer |  |  | Color index 0-15. |
| `fill` | integer |  |  | Fill style index. |

**Returns:** `note detail of the new card`

### `note.update` ✏️

Change title, excerpt, Markdown flag, color or fill of a card. Omitted fields stay unchanged.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `title` | string |  |  | Card title (plain text, not rendered as Markdown). |
| `excerpt` | string |  |  | Card body / excerpt text. Rendered as Markdown + LaTeX when markdown=true. |
| `markdown` | boolean |  |  | Render the excerpt as Markdown (default true when excerpt is given on create). |
| `color` | integer |  |  | Color index 0-15. |
| `fill` | integer |  |  | Fill style index. |

**Returns:** `note detail`

### `note.delete` ✏️

Delete a card. Refuses when it has children unless recursive=true.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `recursive` | boolean |  | `false` | Also delete all descendants. |

**Returns:** `{ deleted, descendants }`

### `note.move` ✏️

Move a card (with its subtree) under another parent, before a sibling, or out to the notebook root.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `parentId` | string |  |  | New parent. Omit with toRoot=true to detach to the root. |
| `beforeId` | string |  |  | Place before this child of the new parent. |
| `toRoot` | boolean |  | `false` |  |

**Returns:** `note detail`

### `note.clone` ✏️

Copy a card (MarginNote clone) into a notebook, optionally under a parent.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `notebookId` | string |  |  | Target notebook (default: same notebook). |
| `parentId` | string |  |  | Place the copy under this note. |

**Returns:** `note detail of the copy`

### `note.link` ✏️

Add a note link (marginnote4app://note/…) from one card to another, optionally both ways.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `targetId` | string | yes |  |  |
| `bidirectional` | boolean |  | `false` |  |

**Returns:** `{ linked }`

### `note.importMarkdown` ✏️

Turn a Markdown outline (# headings and nested lists) into a card tree under parentId or at the notebook root.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `markdown` | string | yes |  |  |
| `parentId` | string |  |  |  |
| `notebookId` | string |  |  |  |
| `mode` | string (title \| excerpt \| comment) |  | `"title"` | title: heading→title, body→excerpt. excerpt: heading+body→excerpt (no title). comment: heading→title, body→Markdown comment. |
| `renderMarkdown` | boolean |  | `true` | Render bodies as Markdown/LaTeX. |
| `color` | integer |  |  | Color index for every created card. |

**Returns:** `{ created: count, tree: [{ id, title, children }] }`

## Tags

### `tag.list`

All #tags used in a notebook with counts.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `notebookId` | string | yes |  |  |

**Returns:** `[{ tag, count }]`

### `tag.add` ✏️

Add #tags to a card (stored the MarginNote way, as a "#a #b" comment).

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `tags` | array<string> | yes |  |  |

**Returns:** `note detail`

### `tag.remove` ✏️

Remove #tags from a card.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `tags` | array<string> | yes |  |  |

**Returns:** `note detail`

## Review

### `review.status`

Whether a note is currently in a review deck.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |

**Returns:** `{ noteId, inReview }`

## Comments

### `comment.add` ✏️

Append a comment: Markdown (default, supports LaTeX), plain text, HTML, or a link to another note.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `text` | string |  |  | Comment text. |
| `markdown` | boolean |  | `true` |  |
| `html` | string |  |  | HTML comment instead of text. |
| `linkTo` | string |  |  | Note id to link instead of text. |

**Returns:** `note detail`

### `comment.remove` ✏️

Remove the comment at an index (see note.get for indices).

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `index` | integer | yes |  |  |

**Returns:** `note detail`

### `comment.update` ✏️

Replace the text of a text/Markdown comment, keeping its position.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `index` | integer | yes |  |  |
| `text` | string | yes |  |  |
| `markdown` | boolean |  | `true` |  |

**Returns:** `note detail`

### `comment.reorder` ✏️

Reorder comments. order lists current indices in the new order, e.g. [2,0,1].

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `noteId` | string | yes |  |  |
| `order` | array<integer> | yes |  |  |

**Returns:** `note detail`

## Batch

### `batch` ✏️

Run many actions in one round trip and ONE undo step. Later ops can reference earlier results with "$<index>.<field>", e.g. {"parentId": "$0.id"}. With atomic=true (default) a failure rolls everything back.

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `notebookId` | string | yes |  | Notebook that receives the single undo step. |
| `ops` | array | yes |  | [{ "action": "note.create", "params": {...} }, ...] (max 500). |
| `atomic` | boolean |  | `true` |  |

**Returns:** `{ results: [data], completed } or error with details.failedIndex`
