# Working on this repository

Instructions for coding agents (and humans) changing MN Agent Bridge.

- `addon/src/*.js` runs inside MarginNote's JavaScriptCore: no `fetch`, timers, DOM or modules. Files are concatenated in name order into one scope by `scripts/build.mjs`.
- Top-level code in `addon/src` must not call native objects (`Database`, `Application`, `NSUserDefaults`…): the build evaluates the files in Node to extract the action registry.
- Check every native API against the [MarginNote add-on docs](https://mn-docs.museday.top) before using it, and verify it in MarginNote — several documented details differ in practice (see the comments on `sortCommentsByNewIndices` and `tappedTitle`).
- New capability = one `defineAction({...})` with complete `params` metadata. Writes must go through `writeTx` so they become one undo step and respect read-only mode.
- Never send responses anywhere except `sendReply` (receiver scheme or clipboard). Never add an action that runs caller-supplied code.
- After changing the add-on: `npm run build`, import `dist/*.mnaddon` in MarginNote (replace → restart), then `node scripts/e2e.mjs <test notebookId> --undo`. Do not run the e2e suite against a notebook the user is editing.
- `docs/API.md` and `cli/lib/actions.json` are generated; edit the registry instead.
