// ---------------------------------------------------------------------------
// Authentication, pairing, replay protection and the request log.
//
// Any app or web page can open a marginnote4app:// URL, so every action except
// `ping` and `pair` requires a token. Tokens are only issued after the user taps
// "Allow" in a MarginNote alert, and responses only ever go to the
// mnagentbridge:// receiver (or the clipboard), never to a caller-chosen URL.
// ---------------------------------------------------------------------------

var STORE_KEY = 'io.github.jacky1n7.agentbridge.v1';
var SEEN_IDS = {};
var SEEN_ORDER = [];
var REQUEST_LOG = [];
var PAIRING = { pending: null };

function loadStore() {
  try {
    var raw = NSUserDefaults.standardUserDefaults().objectForKey(STORE_KEY);
    var s = raw ? JSON.parse(String(raw)) : null;
    if (s && s.tokens) return s;
  } catch (e) {}
  return { tokens: [], readOnly: false };
}

function saveStore(s) {
  NSUserDefaults.standardUserDefaults().setObjectForKey(JSON.stringify(s), STORE_KEY);
}

function initAuthState() {
  WRITE_STATE.readOnly = !!loadStore().readOnly;
}

function setReadOnly(on) {
  var s = loadStore();
  s.readOnly = !!on;
  saveStore(s);
  WRITE_STATE.readOnly = !!on;
}

function newToken() {
  return 'mnab_' + (newId() + newId()).replace(/-/g, '').toLowerCase();
}

function findClient(token) {
  if (!token) return null;
  var s = loadStore();
  for (var i = 0; i < s.tokens.length; i++) if (s.tokens[i].token === token) return s.tokens[i];
  return null;
}

function touchClient(token) {
  var s = loadStore();
  for (var i = 0; i < s.tokens.length; i++) {
    if (s.tokens[i].token === token) {
      s.tokens[i].lastUsed = new Date().toISOString();
      saveStore(s);
      return;
    }
  }
}

function revokeTokens(token) {
  var s = loadStore();
  var before = s.tokens.length;
  s.tokens = token ? s.tokens.filter(function (t) { return t.token !== token; }) : [];
  saveStore(s);
  return before - s.tokens.length;
}

function listClients() {
  return loadStore().tokens.map(function (t) {
    return { client: t.client, createdAt: t.created, lastUsed: t.lastUsed || null, tokenHint: t.token.slice(0, 9) + '…' };
  });
}

// Remember request ids so a replayed URL cannot run twice. This also makes sure
// only one add-on instance handles a request when several windows are open.
function claimRequestId(id) {
  if (SEEN_IDS[id]) return false;
  SEEN_IDS[id] = true;
  SEEN_ORDER.push(id);
  if (SEEN_ORDER.length > 500) delete SEEN_IDS[SEEN_ORDER.shift()];
  return true;
}

function logRequest(entry) {
  REQUEST_LOG.push(entry);
  if (REQUEST_LOG.length > 100) REQUEST_LOG.shift();
}

// Which button was tapped, by title. Button indices differ between platforms
// (macOS reports cancel as 0 and the first other button as 1), titles do not.
function tappedTitle(alert, buttonIndex, cancelTitle, otherTitles) {
  try {
    if (alert && typeof alert.buttonTitleAtIndex === 'function') {
      var t = alert.buttonTitleAtIndex(buttonIndex);
      if (t !== undefined && t !== null) return String(t);
    }
  } catch (e) {}
  var cancelIndex = -1;
  try {
    if (alert && alert.cancelButtonIndex !== undefined) cancelIndex = Number(alert.cancelButtonIndex);
  } catch (e) {}
  if (buttonIndex === cancelIndex || buttonIndex < 0) return cancelTitle;
  var offset = cancelIndex === 0 ? 1 : 0;
  return otherTitles[buttonIndex - offset] || cancelTitle;
}

// Ask the user to approve a new client. `done(token|null)` is called once.
function requestPairing(clientName, done) {
  if (PAIRING.pending) {
    done(null, 'Another pairing request is already waiting for the user');
    return;
  }
  PAIRING.pending = clientName;
  var title = 'MN Agent Bridge';
  var message = '「' + clientName + '」请求访问你的 MarginNote（读取和修改笔记）。\n\n'
    + 'Allow "' + clientName + '" to read and edit your MarginNote notes?\n\n'
    + '只在你本人刚刚发起配对时允许。Only allow if you just started pairing.';
  var DENY = '拒绝 Deny';
  var ALLOW = '允许 Allow';
  UIAlertView.showWithTitleMessageStyleCancelButtonTitleOtherButtonTitlesTapBlock(
    title, message, 0, DENY, [ALLOW],
    function (alert, buttonIndex) {
      PAIRING.pending = null;
      if (tappedTitle(alert, buttonIndex, DENY, [ALLOW]) !== ALLOW) {
        done(null, 'The user denied the pairing request');
        return;
      }
      var token = newToken();
      var s = loadStore();
      s.tokens.push({ token: token, client: clientName, created: new Date().toISOString() });
      saveStore(s);
      done(token, null);
    }
  );
}
