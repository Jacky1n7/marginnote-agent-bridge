// Zero-dependency MCP server (stdio transport, newline-delimited JSON-RPC 2.0).
// Every bridge action becomes one tool; the tool name is the action name with "." replaced by "_".
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { call, BridgeError } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(here, 'actions.json'), 'utf8'));
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Pairing needs a human at the Mac, so it stays a CLI-only step (`mnab pair`).
const HIDDEN = new Set(['pair']);

const INSTRUCTIONS = `MarginNote 4 bridge. Cards ("notes") live in notebooks (study sets) and form mind-map trees.
- Start with context_get (what the user is looking at) or notebook_list, then note_tree / note_search to find ids.
- Every write is one undo step in MarginNote ("Agent: <action>"); ui_undo reverts the last one.
- Use batch for multi-step edits: one round trip, one undo step, rolls back on failure. Reference earlier results as "$<index>.id".
- Excerpts and comments render Markdown with LaTeX ($...$, $$...$$). Keep each inline formula short; MarginNote does not wrap inside a formula.
- note_importMarkdown turns a Markdown outline (# headings, nested lists) into a card tree in one call.
- Before large or destructive edits, consider notebook_backup.`;

function toolName(action) {
  return action.replace(/\./g, '_');
}

function jsonSchemaFor(spec) {
  const s = {};
  if (spec.type === 'integer' || spec.type === 'number' || spec.type === 'string' || spec.type === 'boolean') s.type = spec.type;
  else if (spec.type === 'array') {
    s.type = 'array';
    s.items = spec.items ? { type: spec.items } : {};
  } else if (spec.type === 'object') s.type = 'object';
  if (spec.enum) s.enum = spec.enum;
  if (spec.desc) s.description = spec.desc;
  if (spec.default !== undefined) s.default = spec.default;
  return s;
}

function toolsList() {
  return registry.actions
    .filter((a) => !HIDDEN.has(a.name))
    .map((a) => {
      const properties = {};
      const required = [];
      for (const [k, spec] of Object.entries(a.params)) {
        properties[k] = jsonSchemaFor(spec);
        if (spec.required) required.push(k);
      }
      const tool = {
        name: toolName(a.name),
        title: a.name,
        description: a.summary + (a.returns ? ` Returns ${a.returns}.` : '') + (a.experimental ? ' (experimental)' : ''),
        inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
        annotations: {
          readOnlyHint: !a.write,
          destructiveHint: /delete|restore|revoke/.test(a.name),
          idempotentHint: !a.write,
          openWorldHint: false,
        },
      };
      return tool;
    });
}

const byTool = new Map(registry.actions.map((a) => [toolName(a.name), a]));

async function callTool(name, args) {
  const action = byTool.get(name);
  if (!action || HIDDEN.has(action.name)) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}` }] };
  }
  try {
    const data = await call(action.name, args || {}, { timeoutMs: 60000 });
    if (action.name === 'note.image' && data && data.base64) {
      return { content: [{ type: 'image', data: data.base64, mimeType: data.mime }] };
    }
    const text = data && typeof data.text === 'string' && Object.keys(data).length === 1 ? data.text : JSON.stringify(data, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    const err = e instanceof BridgeError ? e : new BridgeError('INTERNAL', String(e?.message || e));
    const hint =
      err.code === 'UNAUTHORIZED'
        ? '\nAsk the user to run `mnab pair` in a terminal and approve the request in MarginNote.'
        : err.code === 'SETUP_REQUIRED' || err.code === 'TIMEOUT'
          ? '\nAsk the user to run `mnab doctor`.'
          : '';
    return {
      isError: true,
      content: [{ type: 'text', text: `${err.code}: ${err.message}${err.details ? '\n' + JSON.stringify(err.details) : ''}${hint}` }],
    };
  }
}

export function startMcpServer() {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    const reply = (result) => isRequest && send({ jsonrpc: '2.0', id, result });
    const error = (code, message) => isRequest && send({ jsonrpc: '2.0', id, error: { code, message } });

    try {
      switch (method) {
        case 'initialize': {
          const asked = params?.protocolVersion;
          reply({
            protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'marginnote-agent-bridge', title: 'MN Agent Bridge', version: registry.version },
            instructions: INSTRUCTIONS,
          });
          break;
        }
        case 'ping':
          reply({});
          break;
        case 'tools/list':
          reply({ tools: toolsList() });
          break;
        case 'tools/call':
          reply(await callTool(params?.name, params?.arguments));
          break;
        default:
          if (method?.startsWith('notifications/')) break;
          error(-32601, `Method not found: ${method}`);
      }
    } catch (e) {
      error(-32603, String(e?.message || e));
    }
  });
}
