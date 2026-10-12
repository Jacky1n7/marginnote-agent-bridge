// ---------------------------------------------------------------------------
// Add-on class: lifecycle, URL broadcast observer and the toolbar menu.
// ---------------------------------------------------------------------------

var OBSERVERS = [];

function ensureObserver(addon) {
  if (OBSERVERS.indexOf(addon) >= 0) return;
  NSNotificationCenter.defaultCenter().addObserverSelectorName(addon, 'onAddonBroadcast:', 'AddonBroadcast');
  OBSERVERS.push(addon);
}

function dropObserver(addon) {
  NSNotificationCenter.defaultCenter().removeObserverName(addon, 'AddonBroadcast');
  var i = OBSERVERS.indexOf(addon);
  if (i >= 0) OBSERVERS.splice(i, 1);
}

function showPanel(addon) {
  var clients = listClients();
  var last = REQUEST_LOG.length ? REQUEST_LOG[REQUEST_LOG.length - 1] : null;
  var lines = [
    '版本 Version ' + BRIDGE_VERSION,
    '已授权客户端 Paired clients: ' + (clients.length ? clients.map(function (c) { return c.client; }).join(', ') : '无 none'),
    '只读模式 Read-only: ' + (WRITE_STATE.readOnly ? '开 ON' : '关 OFF'),
    '最近请求 Last request: ' + (last ? last.action + (last.ok ? ' ✓' : ' ✗ ' + last.code) + ' · ' + last.at.slice(11, 19) : '—')
  ];
  var CLOSE = '关闭 Close';
  var TOGGLE = WRITE_STATE.readOnly ? '关闭只读 Allow writes' : '开启只读 Read-only';
  var REVOKE = '撤销全部授权 Revoke all';
  UIAlertView.showWithTitleMessageStyleCancelButtonTitleOtherButtonTitlesTapBlock(
    'MN Agent Bridge', lines.join('\n'), 0, CLOSE, [TOGGLE, REVOKE],
    function (alert, idx) {
      var choice = tappedTitle(alert, idx, CLOSE, [TOGGLE, REVOKE]);
      if (choice === TOGGLE) {
        setReadOnly(!WRITE_STATE.readOnly);
        app().showHUD(WRITE_STATE.readOnly ? 'Agent Bridge：只读模式已开启' : 'Agent Bridge：已允许写入', addon.window, 2);
      } else if (choice === REVOKE) {
        var n = revokeTokens(null);
        app().showHUD('Agent Bridge：已撤销 ' + n + ' 个授权', addon.window, 2);
      }
    }
  );
}

function defineAddonClass() {
  initAuthState();
  return JSB.defineClass('MNAgentBridge : JSExtension', {
    sceneWillConnect: function () {
      try { ensureObserver(self); } catch (e) {}
    },
    sceneDidDisconnect: function () {
      try { dropObserver(self); } catch (e) {}
    },
    notebookWillOpen: function (topicid) {
      try { ensureObserver(self); } catch (e) {}
    },
    queryAddonCommandStatus: function () {
      try { ensureObserver(self); } catch (e) {}
      return { image: 'logo.png', object: self, selector: 'openPanel:', checked: WRITE_STATE.readOnly };
    },
    openPanel: function (sender) {
      try {
        showPanel(self);
      } catch (e) {
        app().showHUD('Agent Bridge: ' + str(e && e.message), self.window, 3);
      }
    },
    onAddonBroadcast: function (sender) {
      var message = sender && sender.userInfo ? sender.userInfo.message : '';
      try {
        handleBroadcast(self, message);
      } catch (e) {}
    }
  }, {});
}
