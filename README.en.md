<p align="center">
  <img src="assets/banner.png" alt="MN Agent Bridge — let AI agents read and write your MarginNote mind maps" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-5eead4?style=flat-square"></a>
  <img alt="MarginNote 4" src="https://img.shields.io/badge/MarginNote-4.4%2B-fbbf24?style=flat-square">
  <img alt="macOS" src="https://img.shields.io/badge/platform-macOS-1b2655?style=flat-square">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-ready-5eead4?style=flat-square">
  <img alt="Zero dependencies" src="https://img.shields.io/badge/npm%20deps-0-1b2655?style=flat-square">
</p>

<p align="center"><a href="README.md">简体中文</a> · <b>English</b></p>

---

**MN Agent Bridge** is a MarginNote 4 add-on, a CLI and an MCP server. Once installed, AI agents such as Claude Code, Codex or Cursor can work **directly** in your MarginNote: read mind maps, find cards, create and edit cards, comments and tags, import and export whole trees — and every change is one undoable step inside MarginNote.

> "Put the questions from this photo under *Multiple Integrals*, formatted like the existing cards." "Export chapter 3 as Markdown with my mistakes first." "Tag these 20 cards by topic." — say it, and the agent does it.

## ✨ What it can do

| | |
| --- | --- |
| 🧠 **Read** | notebooks, whole mind maps (JSON / Markdown / outline), card details, comments, tags, images and handwriting, PDF outline and page text, what you have open and selected |
| ✏️ **Write** | create, update, delete, move, clone and link cards; add / edit / reorder / remove comments; tags and colors; **turn a Markdown outline into a card tree** (LaTeX supported) |
| 📦 **Batch** | `batch` runs hundreds of operations in one round trip, later ones can reference earlier results, and **any failure rolls the whole batch back** |
| ↩️ **Undoable** | every write is one "Agent: …" step in MarginNote — ⌘Z reverts it; back up a notebook before big edits |
| 🔐 **Safe** | token auth approved by you in a MarginNote alert; replies only go to a local channel, so malicious links cannot read your notes; one-tap read-only mode and revocation |
| 🧩 **Works everywhere** | MCP (Claude Code / Codex / Cursor / Claude Desktop…), the `mnab` CLI, or anything that can open a URL |

**44 actions** in total — see the [API reference](docs/API.md).

## 🚀 Quick start

**Needs:** macOS · MarginNote 4 (tested on 4.4.6) · Node.js ≥ 18 · Xcode Command Line Tools (`xcode-select --install`)

```bash
# 1. Install the CLI and build the local receiver
curl -fsSLO https://github.com/Jacky1n7/marginnote-agent-bridge/releases/latest/download/marginnote-agent-bridge.tgz
npm install -g ./marginnote-agent-bridge.tgz
mnab setup
```

```text
# 2. Install the add-on in MarginNote (once)
Settings → Extension → enable "Allow uncertified extensions"
File → Extensions → Import → ~/Downloads/MNAgentBridge.mnaddon → restart when asked
```

```bash
# 3. Pair — tap "Allow" in the MarginNote alert
mnab pair
mnab doctor          # all ✓ means you're done

# 4. Connect your agent
claude mcp add marginnote -- mnab mcp
```

Recent npm versions refuse to install straight from GitHub URLs, hence the download step; `git clone` + `npm install -g .` works too. Codex, Cursor and other clients: see the [guide](docs/GUIDE.md#connect-an-agent).

## 💬 What it looks like

In Claude Code:

```text
› What's in the notebook I have open? List the questions under "Multiple Integrals".
› Import the 14 questions in this photo, formatted like the existing cards, formulas in LaTeX.
› Add a comment to question 5: spherical coordinates, answer 4(2√2−1)πR⁵/15.
› Export this chapter as Markdown, mistakes first.
```

Or from a terminal:

```bash
mnab ctx                                   # what is open / selected
mnab tree --notebook <id> --depth 2        # the mind map as an outline (with card ids)
mnab search "triple integral" --notebook <id>
mnab import chapter3.md --parent <noteId> --mode excerpt
mnab call comment.add '{"noteId":"…","text":"Hint: slice by z, $\\int_0^R \\pi z^4\\,dz$"}'
mnab undo
```

## 🛠 How it works

MarginNote's data lives in a sandbox and add-ons cannot open network ports. What add-ons *can* do is **receive** `marginnote4app://` links and **open** other links — so that is the bridge:

```
mnab / MCP ──open -g marginnote4app://addon/agentbridge?…──▶ MarginNote add-on (auth · run · undo group)
     ▲                                                              │
     └── ~/.mn-agent-bridge/inbox ◀── receiver app ◀── mnagentbridge://result?…
```

A round trip takes ~150–250 ms; large answers are chunked and large requests travel through the clipboard (which is restored afterwards). The protocol is documented, so you can call it without the CLI — see [Protocol](docs/GUIDE.md#protocol).

## 📚 Documentation

- [Guide](docs/GUIDE.md): install, connecting agents, protocol, security model, limits, troubleshooting, development
- [API reference](docs/API.md): all 44 actions with parameters and return values (generated from the code)
- [Built-in commands](docs/COMMANDS.md): drive MarginNote's own menu commands with `ui.command`
- [Agent skill](skills/marginnote/SKILL.md): usage rules for Claude Code — copy it into `~/.claude/skills/`

## ⚠️ Known limits

- **macOS only.** The add-on loads on iPad, but nothing there can receive its answers.
- **Not yet signed by MarginNote**, so "Allow uncertified extensions" must be on.
- The selection is yours: agents can locate and highlight cards but not change your selection; use the data actions instead of menu commands that act on "the selected card".
- While a tutorial notebook ("Guide – …") is open, add-ons are not loaded and calls time out.
- MarginNote is building an official "MarginNote CLI" in Lab; this project will align with it when it ships.

More in [Guide · Limits](docs/GUIDE.md#limits-and-known-behaviour).

## 🤝 Contributing

Issues and PRs welcome. Read [AGENTS.md](AGENTS.md) before changing the add-on; run `node scripts/e2e.mjs <test notebookId> --undo` — it works under one temporary root card and deletes it at the end.

## 🙏 Thanks

- [mn-docs](https://mn-docs.museday.top) ([Temsys-Shen/marginnote-addon-docs](https://github.com/Temsys-Shen/marginnote-addon-docs)) — the community MarginNote add-on API docs every native call here was checked against.
- [Url Apis](https://bbs.marginnote.com.cn/t/topic/67874) — the first URL-scheme remote control for MarginNote, which inspired this project (the code here is written independently).
- The MarginNote team and the [MarginNote community](https://bbs.marginnote.com.cn).

## 📄 License

[MIT](LICENSE) © 2026 Xiaoran Li ([@Jacky1n7](https://github.com/Jacky1n7)). MarginNote is a trademark of the MarginNote team; this project is not affiliated with them.
