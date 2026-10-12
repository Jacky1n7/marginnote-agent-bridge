// Transport between Node and the MarginNote add-on.
//
//   Node ──open -g marginnote4app://addon/agentbridge?…──▶ MarginNote add-on
//   Node ◀──~/.mn-agent-bridge/inbox/<id>.<i>-of-<n>.json── MNAgentBridgeReceiver.app ◀── mnagentbridge://result?…
import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME_DIR = path.join(os.homedir(), '.mn-agent-bridge');
export const INBOX_DIR = path.join(HOME_DIR, 'inbox');
export const CONFIG_FILE = path.join(HOME_DIR, 'config.json');
export const RECEIVER_APP = path.join(os.homedir(), 'Applications', 'MNAgentBridgeReceiver.app');

// URLs handed to `open` must stay below the kernel's argument limit (~1 MB).
const MAX_URL_PAYLOAD = 400 * 1024;

export class BridgeError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details ?? null;
  }
}

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeConfig(cfg) {
  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

export function getToken() {
  return process.env.MNAB_TOKEN || readConfig().token || '';
}

function sh(cmd, args, input) {
  return execFileSync(cmd, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
}

function openUrl(url) {
  return new Promise((resolve, reject) => {
    execFile('open', ['-g', url], (err) => (err ? reject(new BridgeError('TRANSPORT', `open failed: ${err.message}`)) : resolve()));
  });
}

export function marginNoteRunning() {
  try {
    sh('pgrep', ['-x', 'MarginNote 4']);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForInbox(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const prefix = id + '.';
  while (Date.now() < deadline) {
    let names = [];
    try {
      names = fs.readdirSync(INBOX_DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
    } catch {}
    if (names.length) {
      const total = Number(names[0].match(/-of-(\d+)\.json$/)?.[1] || 1);
      if (names.length >= total) {
        const parts = [];
        for (let i = 0; i < total; i++) {
          const file = path.join(INBOX_DIR, `${id}.${i}-of-${total}.json`);
          parts.push(fs.readFileSync(file, 'utf8'));
        }
        for (const n of names) fs.rmSync(path.join(INBOX_DIR, n), { force: true });
        return parts.join('');
      }
    }
    await sleep(40);
  }
  return null;
}

async function waitForClipboard(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const prefix = `mnab-res:${id}:`;
  while (Date.now() < deadline) {
    const clip = sh('pbpaste', []);
    if (clip.startsWith(prefix)) return clip.slice(prefix.length);
    await sleep(80);
  }
  return null;
}

/**
 * Call one bridge action and resolve with its `data`.
 * @param {string} action e.g. "note.get"
 * @param {object} params action parameters
 * @param {{timeoutMs?: number, reply?: 'url'|'clipboard', token?: string}} opts
 */
export async function call(action, params = {}, opts = {}) {
  const reply = opts.reply || process.env.MNAB_REPLY || 'url';
  if (reply === 'url' && !fs.existsSync(RECEIVER_APP)) {
    throw new BridgeError('SETUP_REQUIRED', 'Receiver app not installed. Run `mnab setup` first.');
  }
  fs.mkdirSync(INBOX_DIR, { recursive: true, mode: 0o700 });

  let timeoutMs = opts.timeoutMs ?? 30000;
  if (!marginNoteRunning()) {
    // `open` will launch MarginNote; give it time to load the add-on.
    timeoutMs += 30000;
  }

  const id = 'r' + Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
  const token = opts.token ?? getToken();
  const json = JSON.stringify(params ?? {});
  const encoded = encodeURIComponent(json);

  let url = `marginnote4app://addon/agentbridge?id=${id}&action=${encodeURIComponent(action)}`;
  if (token) url += `&token=${encodeURIComponent(token)}`;
  if (reply === 'clipboard') url += '&reply=clipboard';

  // Both clipboard modes overwrite the user's clipboard text; put it back afterwards.
  const useClipboardInput = encoded.length > MAX_URL_PAYLOAD;
  const savedClipboard = useClipboardInput || reply === 'clipboard' ? sh('pbpaste', []) : null;
  if (useClipboardInput) {
    sh('pbcopy', [], `mnab-req:${id}:${json}`);
    url += '&payloadFrom=clipboard';
  } else if (json !== '{}') {
    url += `&payload=${encoded}`;
  }

  try {
    await openUrl(url);
    const raw = reply === 'clipboard' ? await waitForClipboard(id, timeoutMs) : await waitForInbox(id, timeoutMs);
    if (raw === null) {
      throw new BridgeError(
        'TIMEOUT',
        `No answer from MarginNote within ${Math.round(timeoutMs / 1000)}s. Is MarginNote open and the MN Agent Bridge add-on enabled? (` +
          '`mnab doctor` checks everything)',
      );
    }
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw new BridgeError('TRANSPORT', 'Malformed response from the add-on');
    }
    if (!envelope.ok) {
      const e = envelope.error || {};
      throw new BridgeError(e.code || 'ERROR', e.message || 'Unknown error', e.details);
    }
    return envelope.data;
  } finally {
    if (savedClipboard !== null) {
      try {
        sh('pbcopy', [], savedClipboard);
      } catch {}
    }
  }
}
