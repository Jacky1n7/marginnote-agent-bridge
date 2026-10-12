# Built-in commands (`ui.command`)

`ui.command` runs one of MarginNote's own menu/shortcut commands in the front window — the same thing as pressing the shortcut. Use it for everything the data API does not cover (view switching, expanding, exporting through MarginNote's dialogs…).

```bash
mnab call ui.queryCommand '{"command":"ViewExpandAll"}'   # → { disabled, checked }
mnab call ui.command      '{"command":"ViewExpandAll"}'
```

Things to know:

- Availability depends on what is on screen. Check with `ui.queryCommand` first; `ui.command` refuses with `CONFLICT` when the command is disabled.
- Card commands (color, merge, clone…) act on the card **the user has selected**. Agents cannot change the selection, so prefer the data actions (`note.update`, `note.clone`, …) for card edits.
- Some commands open dialogs that need the user (review deck binding, export pickers). Don't use them unattended.
- The list changes between MarginNote versions. The complete, community-maintained table lives in the [MarginNote add-on docs](https://mn-docs.museday.top/reference/global/builtin-commands/).

## Useful commands

| Command | What it does |
| --- | --- |
| `ZoomToFit` | Fit the whole mind map in the window |
| `MindMapZoomIn` / `MindMapZoomOut` | Zoom the mind map |
| `ViewExpandAll` / `ViewCollapseAll` | Expand / collapse every branch |
| `ViewExpandLevel0` … `ViewExpandLevel7` | Expand to a given depth |
| `ToggleExpand` | Expand / collapse the selected branch |
| `FocusNote` / `FocusParent` | Center the selected card / its parent |
| `GoStudy` / `GoDocument` | Switch between study mode and document mode |
| `NotebookOutline` / `NotebookOutlineMix` / `NotebookDoc` | Outline view / mixed view / document view |
| `ToggleMindMap` / `ToggleDocument` / `ToggleCards` / `ToggleReview` | Show or hide a panel |
| `ToggleSidebar` / `ToggleTabsBar` | Sidebar / document tabs |
| `TabNextFile` / `TabPrevFile` | Next / previous document tab |
| `BookPageNumber` | Open "go to page" |
| `BookTOC` | Document table of contents |
| `FullTextSearch` / `NoteSearch` | Open MarginNote's search UIs |
| `ExportMapPDF` / `ExportWord` / `ExportAnki` / `ExportMind` | Export through MarginNote's own dialogs |
| `EditColorNoteIndex0` … `EditColorNoteIndex15` | Color the selected card |
| `EditCloneNote` / `EditMergeNotes` / `EditGroupNotes` | Clone / merge / group selected cards |
| `NewChildNote` / `NewSiblingNote` / `NewParentNote` | Add a card around the selection (opens editing) |

Most of these were taken from the community command table; `ZoomToFit` is exercised by the test suite.
