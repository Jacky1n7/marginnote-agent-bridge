#!/usr/bin/env node
// mnab — command line for MN Agent Bridge.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, BridgeError, readConfig, writeConfig, getToken, marginNoteRunning, RECEIVER_APP, HOME_DIR } from '../lib/client.js';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'cli/lib/actions.json'), 'utf8'));

const HELP = `mnab ${pkg.version} — MN Agent Bridge CLI (MarginNote 4 ⇄ AI agents)

Setup
  mnab setup                     Build + register the result receiver app, show how to install the add-on
  mnab doctor                    Check every link in the chain
  mnab pair [--client NAME]      Request a token (approve the alert in MarginNote)
  mnab mcp                       Run the MCP server on stdio (for Claude Code, Codex, Cursor…)

Calling actions
  mnab call <action> [JSON] [--key value …]   Call any action, print JSON
  mnab actions [--json]          List all actions
  mnab help <action>             Parameters of one action

Shortcuts
  mnab ping                      Is the bridge alive?
  mnab ctx                       What is open / focused / selected in MarginNote
  mnab notebooks                 List notebooks
  mnab tree <noteId>|--notebook <id> [--depth N] [--format json|markdown|outline]
  mnab search <query> [--notebook <id>] [--limit N]
  mnab import <file.md|-> (--parent <noteId> | --notebook <id>) [--mode title|excerpt|comment]
  mnab undo                      Undo the last change in MarginNote

Options
  --timeout <sec>   wait longer for MarginNote (default 30)
  --reply clipboard use the clipboard instead of the receiver app
  --compact         one-line JSON output

Docs: https://github.com/Jacky1n7/marginnote-agent-bridge`;

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) opts[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[a.slice(2)] = argv[++i];
      else opts[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

const GLOBAL_OPTS = new Set(['timeout', 'reply', 'compact']);

function coerce(v) {
  if (v === true) return true;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^[[{]/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {}
  }
  return v;
}

function print(data, opts) {
  if (data && typeof data === 'object' && typeof data.text === 'string' && Object.keys(data).length === 1) {
    process.stdout.write(data.text.endsWith('\n') ? data.text : data.text + '\n');
    return;
  }
  process.stdout.write(JSON.stringify(data, null, opts.compact ? 0 : 2) + '\n');
}

function callOpts(opts) {
  return { timeoutMs: opts.timeout ? Number(opts.timeout) * 1000 : undefined, reply: opts.reply };
}

async function run(action, params, opts) {
  const data = await call(action, params, callOpts(opts));
  print(data, opts);
  return data;
}

function findAddonPackage() {
  const dist = path.join(pkgRoot, 'dist');
  try {
    const f = fs.readdirSync(dist).find((x) => x.endsWith('.mnaddon'));
    return f ? path.join(dist, f) : null;
  } catch {
    return null;
  }
}

async function cmdSetup() {
  if (process.platform !== 'darwin') throw new BridgeError('UNSUPPORTED', 'MN Agent Bridge needs macOS (MarginNote 4 for Mac).');
  console.log('1/3 Building the result receiver (needs Xcode Command Line Tools: xcode-select --install)…');
  const r = spawnSync('sh', [path.join(pkgRoot, 'receiver/build.sh')], { stdio: 'inherit' });
  if (r.status !== 0) throw new BridgeError('SETUP_FAILED', 'Receiver build failed');

  let addon = findAddonPackage();
  if (!addon && fs.existsSync(path.join(pkgRoot, 'scripts/build.mjs'))) {
    execFileSync(process.execPath, [path.join(pkgRoot, 'scripts/build.mjs')], { stdio: 'inherit' });
    addon = findAddonPackage();
  }
  const ascii = path.join(os.homedir(), 'Downloads', 'MNAgentBridge.mnaddon');
  if (addon) fs.copyFileSync(addon, ascii);
  console.log(`
2/3 Install the add-on in MarginNote (one time):
    • MarginNote → Settings → Extension → enable "Allow uncertified extensions"
    • File → Extensions → Import → choose ${addon ? ascii : '(download https://github.com/Jacky1n7/marginnote-agent-bridge/releases/latest/download/MNAgentBridge.mnaddon)'}
    • Restart MarginNote when it asks

3/3 Pair:  mnab pair      (then tap "Allow" in MarginNote)
Check:    mnab doctor`);
}

async function cmdDoctor(opts) {
  const ok = (m) => console.log('  ✓ ' + m);
  const bad = (m) => console.log('  ✗ ' + m);
  let healthy = true;
  console.log('MN Agent Bridge doctor');
  if (process.platform === 'darwin') ok('macOS');
  else {
    bad('not macOS');
    healthy = false;
  }
  const mnApp = '/Applications/MarginNote 4.app';
  if (fs.existsSync(mnApp)) {
    let v = '';
    try {
      v = execFileSync('defaults', ['read', path.join(mnApp, 'Contents/Info.plist'), 'CFBundleShortVersionString'], { encoding: 'utf8' }).trim();
    } catch {}
    ok(`MarginNote 4 installed ${v}`);
  } else {
    bad('MarginNote 4 not found in /Applications');
    healthy = false;
  }
  if (fs.existsSync(RECEIVER_APP)) ok('receiver app installed');
  else {
    bad('receiver app missing → mnab setup');
    healthy = false;
  }
  marginNoteRunning() ? ok('MarginNote is running') : console.log('  · MarginNote is not running (it will be launched on the next call)');
  try {
    const p = await call('ping', {}, { ...callOpts(opts), timeoutMs: (Number(opts.timeout) || 20) * 1000 });
    ok(`add-on answered: bridge ${p.bridgeVersion}, MarginNote ${p.appVersion} (${p.os})${p.readOnly ? ', READ-ONLY mode' : ''}`);
    if (p.paired) ok('token valid');
    else {
      bad(getToken() ? 'token rejected → mnab pair' : 'not paired → mnab pair');
      healthy = false;
    }
    if (p.bridgeVersion !== pkg.version) console.log(`  · add-on ${p.bridgeVersion} vs CLI ${pkg.version}: consider reinstalling the matching .mnaddon`);
  } catch (e) {
    bad(`add-on did not answer (${e.code || 'ERROR'}): ${e.message}`);
    console.log('    → Is the add-on installed + enabled (File → Extensions) and MarginNote restarted after installing?');
    healthy = false;
  }
  process.exitCode = healthy ? 0 : 1;
}

async function cmdPair(opts) {
  const client = typeof opts.client === 'string' ? opts.client : `${os.userInfo().username}@${os.hostname().split('.')[0]} (mnab)`;
  console.error('Waiting for you to tap "Allow" in MarginNote…');
  const data = await call('pair', { client }, { ...callOpts(opts), token: '', timeoutMs: (Number(opts.timeout) || 180) * 1000 });
  writeConfig({ ...readConfig(), token: data.token, client: data.client, pairedAt: new Date().toISOString() });
  console.log(`Paired as "${data.client}". Token saved to ${path.join(HOME_DIR, 'config.json')}`);
}

function cmdActions(opts) {
  if (opts.json) return print(registry.actions, opts);
  let group = '';
  for (const a of registry.actions) {
    if (a.group !== group) {
      group = a.group;
      console.log(`\n${group}`);
    }
    const flags = (a.write ? ' ✏️' : '') + (a.experimental ? ' 🧪' : '');
    console.log(`  ${a.name.padEnd(22)} ${a.summary.split('. ')[0]}${flags}`);
  }
}

function cmdHelpAction(name) {
  const a = registry.actions.find((x) => x.name === name);
  if (!a) throw new BridgeError('UNKNOWN_ACTION', `Unknown action ${name}`);
  console.log(`${a.name}${a.write ? '  (writes, one undo step)' : ''}${a.experimental ? '  (experimental)' : ''}\n\n${a.summary}\n`);
  const entries = Object.entries(a.params);
  if (!entries.length) console.log('No parameters.');
  for (const [k, s] of entries) {
    const meta = [s.type + (s.items ? `<${s.items}>` : ''), s.required ? 'required' : null, s.enum ? s.enum.join('|') : null, s.default !== undefined ? 'default ' + JSON.stringify(s.default) : null]
      .filter(Boolean)
      .join(', ');
    console.log(`  --${k}  (${meta})${s.desc ? '\n      ' + s.desc : ''}`);
  }
  if (a.returns) console.log(`\nReturns: ${a.returns}`);
}

function paramsFrom(pos, opts) {
  let params = {};
  if (pos.length) {
    const src = pos[0] === '-' ? fs.readFileSync(0, 'utf8') : pos[0];
    try {
      params = JSON.parse(src);
    } catch {
      throw new BridgeError('BAD_REQUEST', 'Parameters must be a JSON object (or use --key value)');
    }
  }
  for (const [k, v] of Object.entries(opts)) if (!GLOBAL_OPTS.has(k)) params[k] = coerce(v);
  return params;
}

async function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2));
  const cmd = pos.shift() ?? (opts.version ? 'version' : opts.help || opts.h ? '--help' : undefined);
  switch (cmd) {
    case undefined:
    case '-h':
    case '--help':
      console.log(HELP);
      return;
    case 'help':
      return pos[0] ? cmdHelpAction(pos[0]) : console.log(HELP);
    case 'version':
    case '--version':
      console.log(pkg.version);
      return;
    case 'setup':
      return cmdSetup();
    case 'doctor':
      return cmdDoctor(opts);
    case 'pair':
      return cmdPair(opts);
    case 'mcp': {
      const { startMcpServer } = await import('../lib/mcp.js');
      return startMcpServer();
    }
    case 'actions':
      return cmdActions(opts);
    case 'call': {
      const action = pos.shift();
      if (!action) throw new BridgeError('BAD_REQUEST', 'Usage: mnab call <action> [JSON] [--key value]');
      return run(action, paramsFrom(pos, opts), opts);
    }
    case 'ping':
      return run('ping', {}, opts);
    case 'ctx':
    case 'context':
      return run('context.get', {}, opts);
    case 'notebooks':
      return run('notebook.list', {}, opts);
    case 'tree': {
      const params = { depth: opts.depth ? Number(opts.depth) : 3, format: opts.format || 'outline' };
      if (opts.notebook) params.notebookId = opts.notebook;
      else if (pos[0]) params.noteId = pos[0];
      else throw new BridgeError('BAD_REQUEST', 'Usage: mnab tree <noteId> | --notebook <id>');
      return run('note.tree', params, opts);
    }
    case 'search': {
      if (!pos[0]) throw new BridgeError('BAD_REQUEST', 'Usage: mnab search <query> [--notebook id]');
      const params = { query: pos[0], limit: opts.limit ? Number(opts.limit) : 30 };
      if (opts.notebook) params.notebookId = opts.notebook;
      return run('note.search', params, opts);
    }
    case 'import': {
      if (!pos[0]) throw new BridgeError('BAD_REQUEST', 'Usage: mnab import <file.md|-> --parent <noteId> | --notebook <id>');
      const markdown = fs.readFileSync(pos[0] === '-' ? 0 : pos[0], 'utf8');
      const params = { markdown, mode: opts.mode || 'title' };
      if (opts.parent) params.parentId = opts.parent;
      if (opts.notebook) params.notebookId = opts.notebook;
      if (opts.color !== undefined) params.color = Number(opts.color);
      return run('note.importMarkdown', params, opts);
    }
    case 'undo':
      return run('ui.undo', {}, opts);
    default:
      // Allow `mnab note.get --noteId X` as a shorthand for `mnab call note.get …`.
      if (registry.actions.some((a) => a.name === cmd)) return run(cmd, paramsFrom(pos, opts), opts);
      throw new BridgeError('BAD_REQUEST', `Unknown command "${cmd}". Run mnab --help`);
  }
}

main().catch((e) => {
  const code = e instanceof BridgeError ? e.code : 'ERROR';
  console.error(`mnab: ${code}: ${e.message}`);
  if (e.details) console.error(JSON.stringify(e.details, null, 2));
  process.exitCode = 1;
});
