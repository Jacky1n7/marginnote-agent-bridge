# Guide

- [How it works](#how-it-works)
- [Install](#install)
- [Connect an agent](#connect-an-agent)
- [Protocol (call it from anything)](#protocol)
- [Security model](#security-model)
- [Limits and known behaviour](#limits-and-known-behaviour)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## How it works

```
 agent / script                     MarginNote 4 (sandboxed)                 macOS
┌──────────────┐  open -g marginnote4app://addon/agentbridge?…   ┌───────────────────────┐
│ mnab CLI     │ ───────────────────────────────────────────────▶ │ MN Agent Bridge add-on │
│ mnab mcp     │                                                  │  auth · dispatch · undo│
│ (Node ≥ 18)  │ ◀── ~/.mn-agent-bridge/inbox/<id>.json ──┐       └──────────┬────────────┘
└──────────────┘                                          │                  │ openURL
                                         ┌────────────────┴───────────┐      │ mnagentbridge://result?…
                                         │ MNAgentBridgeReceiver.app   │ ◀────┘
                                         │ (background, owns the URL)  │
                                         └─────────────────────────────┘
```

MarginNote keeps its database in a sandbox that other programs cannot read, and its add-ons cannot open network ports. What add-ons *can* do is receive `marginnote4app://addon/<name>` URLs and open URLs themselves. MN Agent Bridge uses exactly that:

1. The CLI opens a request URL in the background (`open -g`), so MarginNote does not jump to the front.
2. The add-on checks the token, runs the action against MarginNote's own API (`Database`, `MbBookNote`, `UndoManager`, …) and wraps writes in one undo group.
3. It answers by opening `mnagentbridge://result?…`. A tiny background app owns that scheme and drops the JSON into `~/.mn-agent-bridge/inbox/`, where the CLI picks it up. Answers larger than ~64k characters are split into parts and re-assembled.

A round trip takes about 150–250 ms.

## Install

Requirements: macOS, MarginNote 4 (tested with 4.4.6), Node.js ≥ 18, Xcode Command Line Tools (`xcode-select --install`, used to compile the 60-line receiver app).

```bash
curl -fsSLO https://github.com/Jacky1n7/marginnote-agent-bridge/releases/latest/download/marginnote-agent-bridge.tgz
npm install -g ./marginnote-agent-bridge.tgz   # or: git clone … && cd marginnote-agent-bridge && npm install -g .
mnab setup        # builds + registers the receiver, copies the add-on to ~/Downloads
```

Then in MarginNote:

1. **Settings → Extension → Allow uncertified extensions** (the add-on is not signed by MarginNote yet).
2. **File → Extensions → Import** → pick `~/Downloads/MNAgentBridge.mnaddon` (or the `.mnaddon` from the [release page](https://github.com/Jacky1n7/marginnote-agent-bridge/releases)).
3. Restart MarginNote when it asks.

```bash
mnab pair         # MarginNote shows an Allow/Deny alert — tap Allow
mnab doctor       # every line should be ✓
```

Updating: import the new `.mnaddon` the same way ("replace" → restart). Your token survives updates.

## Connect an agent

**Claude Code**

```bash
claude mcp add marginnote -- mnab mcp
# optional: teach it the workflow
mkdir -p ~/.claude/skills && cp -r "$(npm root -g)/marginnote-agent-bridge/skills/marginnote" ~/.claude/skills/
```

**Codex CLI** (`~/.codex/config.toml`)

```toml
[mcp_servers.marginnote]
command = "mnab"
args = ["mcp"]
```

**Any MCP client** (Cursor, Claude Desktop, Cline, …): command `mnab`, args `["mcp"]`, transport stdio.

**No MCP?** Every agent that can run shell commands can use the CLI: `mnab call note.search '{"query":"三重积分"}'`.

## Protocol

You do not need the CLI — anything that can open a URL and read a file can talk to the bridge.

**Request**

```
marginnote4app://addon/agentbridge
    ?id=<request id>              required, [A-Za-z0-9_-]{1,80}, unique per request
    &action=<action name>         e.g. note.get
    &token=<token>                from pairing (not needed for ping / pair)
    &payload=<url-encoded JSON>   action parameters (optional)
    &payloadFrom=clipboard        instead of payload: read "mnab-req:<id>:<JSON>" from the clipboard (large inputs)
    &reply=clipboard              instead of the receiver: answer as "mnab-res:<id>:<JSON>" on the clipboard
```

**Response** — the add-on opens `mnagentbridge://result?id=<id>&part=<i>&total=<n>&payload=<url-encoded chunk>`; concatenate the parts in order and parse:

```json
{ "ok": true,  "id": "…", "action": "note.get", "data": { … }, "bridge": { "version": "0.1.0", "protocol": 1 }, "ms": 12 }
{ "ok": false, "id": "…", "action": "note.get", "error": { "code": "NOT_FOUND", "message": "…", "details": { … } } }
```

Error codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN` (read-only mode), `NOT_FOUND`, `CONFLICT`, `UNKNOWN_ACTION`, `PAIRING_DENIED`, `NO_WINDOW`, `INTERNAL`; the CLI adds `TIMEOUT`, `SETUP_REQUIRED`, `TRANSPORT`.

The full action list with parameters is in [API.md](API.md), and at runtime from the `capabilities` action.

## Security model

Any app or web page can open a `marginnote4app://` link, so the add-on assumes every request may be hostile:

- **Tokens.** Every action except `ping` and `pair` needs a token. Tokens are two random UUIDs (≈244 bits of randomness), stored in MarginNote's preferences and in `~/.mn-agent-bridge/config.json` (mode 600).
- **Human-approved pairing.** `pair` only returns a token after you tap **Allow** in a MarginNote alert that names the client. Only one pairing prompt can be open at a time.
- **Fixed reply channel.** Answers go only to `mnagentbridge://` (the local receiver) or the clipboard — never to a URL chosen by the caller — so a malicious link cannot exfiltrate notes.
- **Replay guard.** Each request id is accepted once.
- **Read-only switch and revocation.** The add-on's toolbar button shows paired clients and lets you turn on read-only mode or revoke every token. `auth.revoke` does the same from the CLI.
- **Undo.** Every write is one undo step named `Agent: <action>`; `batch` is one step for all its operations and rolls itself back when an operation fails.

The receiver only writes files into `~/.mn-agent-bridge/inbox` and quits after 20 s of inactivity.

## Limits and known behaviour

- **macOS only.** The add-on itself would run on iPad, but nothing there can receive the answers. (MarginNote's own upcoming "MarginNote CLI" in Lab covers iPad over the LAN.)
- **The selection belongs to the user.** `ui.focusNote` scrolls to and highlights a card but MarginNote does not make it the selected card; card commands run through `ui.command` act on what the user selected.
- **Some built-in commands open dialogs** (e.g. adding to review needs a review deck to be bound); avoid them in automation.
- **Notebook-type study sets only list their real roots** — cards hidden from the mind map are not traversed.
- `notebook.backup` writes into MarginNote's own Documents folder (`AgentBridgeBackups`), visible in Finder only through MarginNote. `notebook.restoreBackup` is experimental and has not been exercised by the test suite.
- `document.pageText` needs a text layer; scanned pages return nothing.
- Tutorial notebooks ("Guide – …") open in a special guided UI where add-ons are not loaded; calls time out while one is open.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `SETUP_REQUIRED` | `mnab setup` |
| `TIMEOUT` | MarginNote open? Add-on enabled in File → Extensions? Restarted after installing? A tutorial notebook open? |
| `UNAUTHORIZED` | `mnab pair` (tokens were revoked or the add-on was reinstalled with a fresh store) |
| `FORBIDDEN` | Read-only mode is on — toolbar button → *Allow writes* |
| "Unable to load uncertified extension" | Settings → Extension → *Allow uncertified extensions* |
| Pairing alert never appears | Bring MarginNote to the front; only one pairing alert can be pending |

`mnab call bridge.log` shows the last requests the add-on handled.

## Development

```
addon/src/*.js      add-on sources, concatenated in file-name order
scripts/build.mjs   bundles dist/MNAgentBridge-v*.mnaddon, cli/lib/actions.json and docs/API.md
scripts/e2e.mjs     end-to-end test against a live MarginNote (uses a temporary root card)
receiver/           the Swift receiver app + build script
cli/                mnab CLI, transport client and MCP server (no dependencies)
```

Adding an action is one `defineAction({...})` call in `addon/src`; its metadata drives validation, `capabilities`, the API reference and the MCP tool schema. Then:

```bash
npm run build
# import dist/MNAgentBridge-v*.mnaddon in MarginNote → replace → restart
node scripts/e2e.mjs <notebookId> --undo
```

The add-on runs in JavaScriptCore inside MarginNote — no `fetch`, no timers, no DOM. Top-level code in `addon/src` must not touch native objects because the build evaluates it in Node to read the registry. The community-maintained [MarginNote add-on API docs](https://mn-docs.museday.top) were the reference for every native call.
