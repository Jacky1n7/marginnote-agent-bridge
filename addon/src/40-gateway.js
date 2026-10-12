// ---------------------------------------------------------------------------
// Request gateway.
//
// Request:  marginnote4app://addon/agentbridge?id=<rid>&action=<name>&token=<t>
//                 [&payload=<url-encoded JSON>] [&payloadFrom=clipboard] [&reply=url|clipboard]
// Response: mnagentbridge://result?id=<rid>&part=<i>&total=<n>&payload=<url-encoded JSON chunk>
//           (or, with reply=clipboard, the pasteboard text "mnab-res:<rid>:<JSON>")
//
// Envelope: { ok, id, action, data | error: {code, message, details}, bridge, ms }
// ---------------------------------------------------------------------------

function parseQuery(qs) {
  var out = {};
  String(qs || '').split('&').forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf('=');
    var k = i < 0 ? kv : kv.slice(0, i);
    var v = i < 0 ? '' : kv.slice(i + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, '%20'));
    } catch (e) {
      out[k] = v;
    }
  });
  return out;
}

function errorOut(e) {
  if (e instanceof BridgeError) return { code: e.code, message: e.message, details: e.details };
  return { code: 'INTERNAL', message: str(e && e.message ? e.message : e), details: null };
}

// Split on character boundaries without breaking surrogate pairs.
function chunkString(s, size) {
  var parts = [];
  var i = 0;
  while (i < s.length) {
    var end = Math.min(i + size, s.length);
    var code = s.charCodeAt(end - 1);
    if (end < s.length && code >= 0xd800 && code <= 0xdbff) end--;
    parts.push(s.slice(i, end));
    i = end;
  }
  return parts.length ? parts : [''];
}

function sendReply(req, envelope) {
  var json = JSON.stringify(envelope);
  if (req.reply === 'clipboard') {
    UIPasteboard.generalPasteboard().string = 'mnab-res:' + req.id + ':' + json;
    return;
  }
  // ~64k chars per part keeps every callback URL well under 1 MB even for CJK text.
  var parts = chunkString(json, CALLBACK_CHUNK / 8);
  for (var i = 0; i < parts.length; i++) {
    var url = CALLBACK_SCHEME + '://result?id=' + encodeURIComponent(req.id)
      + '&part=' + i + '&total=' + parts.length + '&payload=' + encodeURIComponent(parts[i]);
    app().openURL(NSURL.URLWithString(url));
  }
}

// Run one action by name. Used by the gateway and by `batch`.
function runAction(name, payload, ctx, done) {
  var def = ACTIONS[name];
  if (!def) fail('UNKNOWN_ACTION', 'Unknown action "' + name + '". Call "capabilities" for the list.', { action: name });
  if (def.write && WRITE_STATE.readOnly) {
    fail('FORBIDDEN', 'MN Agent Bridge is in read-only mode (toggle it from the add-on toolbar button)');
  }
  var p = checkParams(def, payload || {});
  if (def.async) {
    if (!done) fail('BAD_REQUEST', 'Action "' + name + '" cannot be used here');
    def.run(p, ctx, done);
    return undefined;
  }
  var data = def.run(p, ctx);
  if (done) done(data, null);
  return data;
}

function handleBroadcast(addon, message) {
  message = str(message);
  if (!(message === ROUTE || message.indexOf(ROUTE + '?') === 0)) return;
  var q = parseQuery(message.slice(ROUTE.length + 1));
  var req = {
    id: str(q.id),
    action: str(q.action),
    token: str(q.token),
    reply: q.reply === 'clipboard' ? 'clipboard' : 'url'
  };
  // Without a well-formed id we cannot answer, and the id doubles as replay guard.
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(req.id)) return;
  if (!claimRequestId(req.id)) return;

  var started = Date.now();
  var client = null;
  var finished = false;

  function finish(data, err) {
    if (finished) return;
    finished = true;
    var envelope = {
      ok: !err,
      id: req.id,
      action: req.action,
      bridge: { version: BRIDGE_VERSION, protocol: BRIDGE_PROTOCOL },
      ms: Date.now() - started
    };
    if (err) envelope.error = errorOut(err);
    else envelope.data = data === undefined ? null : data;
    logRequest({
      at: new Date().toISOString(), id: req.id, action: req.action, client: client ? client.client : null,
      ok: !err, code: err ? envelope.error.code : null, ms: envelope.ms
    });
    try {
      sendReply(req, envelope);
    } catch (e) {}
  }

  try {
    var def = ACTIONS[req.action];
    if (!def) fail('UNKNOWN_ACTION', 'Unknown action "' + req.action + '". Call "capabilities" for the list.');
    if (!def.public) {
      client = findClient(req.token);
      if (!client) fail('UNAUTHORIZED', 'Missing or invalid token. Pair first: `mnab pair`.');
      touchClient(req.token);
    }
    var payload = {};
    if (q.payloadFrom === 'clipboard') {
      var clip = str(UIPasteboard.generalPasteboard().string);
      var prefix = 'mnab-req:' + req.id + ':';
      if (clip.indexOf(prefix) !== 0) fail('BAD_REQUEST', 'Clipboard does not hold the payload for this request');
      payload = JSON.parse(clip.slice(prefix.length));
    } else if (q.payload) {
      try {
        payload = JSON.parse(q.payload);
      } catch (e) {
        fail('BAD_REQUEST', 'payload is not valid JSON');
      }
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('BAD_REQUEST', 'payload must be a JSON object');
    var ctx = { addon: addon, requestId: req.id, token: req.token, client: client ? client.client : null };
    runAction(req.action, payload, ctx, finish);
  } catch (e) {
    finish(null, e);
  }
}
