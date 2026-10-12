// ---------------------------------------------------------------------------
// Core helpers shared by every module.
// All add-on files are concatenated (in file-name order) into one main.js by
// scripts/build.mjs and wrapped inside JSB.newAddon, so they share one scope.
// Top-level code here must not touch native objects: the build also evaluates
// these files in Node to extract the action registry for docs / MCP schemas.
// ---------------------------------------------------------------------------

var BRIDGE_VERSION = '__BRIDGE_VERSION__';
var BRIDGE_PROTOCOL = 1;
var ROUTE = 'agentbridge';
var CALLBACK_SCHEME = 'mnagentbridge';
var CALLBACK_CHUNK = 512 * 1024;

function BridgeError(code, message, details) {
  this.code = code;
  this.message = message;
  this.details = details || null;
}

function fail(code, message, details) {
  throw new BridgeError(code, message, details);
}

function str(x) {
  return x === undefined || x === null ? '' : String(x);
}

function num(x, fallback) {
  var n = Number(x);
  return isFinite(n) ? n : fallback;
}

function bool(x, fallback) {
  if (x === undefined || x === null || x === '') return fallback;
  if (typeof x === 'string') return x === 'true' || x === '1';
  return !!x;
}

// Native collections usually arrive as JS arrays, but be defensive.
function arr(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  var out = [];
  try {
    var n = typeof x.count === 'function' ? x.count() : x.length;
    for (var i = 0; i < n; i++) out.push(typeof x.objectAtIndex === 'function' ? x.objectAtIndex(i) : x[i]);
  } catch (e) {}
  return out;
}

function iso(d) {
  try {
    if (!d) return null;
    var t = d instanceof Date ? d : new Date(d);
    return isNaN(t.getTime()) ? null : t.toISOString();
  } catch (e) {
    return null;
  }
}

function newId() {
  return NSUUID.UUID().UUIDString();
}

function db() {
  return Database.sharedInstance();
}

function app() {
  return Application.sharedInstance();
}

// ---------------------------------------------------------------------------
// Action registry. Each action declares metadata used for validation, the
// `capabilities` action, generated docs and MCP tool schemas.
//
//   defineAction({
//     name: 'note.get', group: 'notes', write: false,
//     summary: '...', params: { noteId: { type: 'string', required: true, desc: '...' } },
//     returns: '...', run: function (p, ctx) { ... }
//   })
// ---------------------------------------------------------------------------

var ACTIONS = {};
var ACTION_ORDER = [];

function defineAction(def) {
  if (ACTIONS[def.name]) throw new Error('duplicate action ' + def.name);
  def.params = def.params || {};
  def.write = !!def.write;
  ACTIONS[def.name] = def;
  ACTION_ORDER.push(def.name);
}

function checkParams(def, p) {
  var out = {};
  var keys = Object.keys(def.params);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var spec = def.params[k];
    var v = p[k];
    if (v === undefined || v === null || v === '') {
      if (spec.required) fail('BAD_REQUEST', 'Missing required parameter "' + k + '"', { param: k });
      if (spec.default !== undefined) out[k] = spec.default;
      continue;
    }
    var t = spec.type;
    if (t === 'string' && typeof v !== 'string') v = String(v);
    else if (t === 'integer' || t === 'number') {
      var n = Number(v);
      if (!isFinite(n)) fail('BAD_REQUEST', 'Parameter "' + k + '" must be a number', { param: k });
      v = t === 'integer' ? Math.round(n) : n;
    } else if (t === 'boolean') v = bool(v, false);
    else if (t === 'array' && !Array.isArray(v)) fail('BAD_REQUEST', 'Parameter "' + k + '" must be an array', { param: k });
    else if (t === 'object' && (typeof v !== 'object' || Array.isArray(v))) {
      fail('BAD_REQUEST', 'Parameter "' + k + '" must be an object', { param: k });
    }
    if (spec.enum && spec.enum.indexOf(v) < 0) {
      fail('BAD_REQUEST', 'Parameter "' + k + '" must be one of ' + spec.enum.join(', '), { param: k });
    }
    out[k] = v;
  }
  return out;
}
