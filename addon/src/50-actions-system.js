// ---------------------------------------------------------------------------
// System, pairing, context and UI actions.
// ---------------------------------------------------------------------------

function currentWindow(ctx) {
  var w = null;
  try {
    w = app().focusWindow;
  } catch (e) {}
  return w || (ctx && ctx.addon ? ctx.addon.window : null);
}

function studyCtl(ctx, required) {
  var sc = null;
  try {
    sc = app().studyController(currentWindow(ctx));
  } catch (e) {}
  if (!sc && required) fail('NO_WINDOW', 'No MarginNote study window is available');
  return sc;
}

defineAction({
  name: 'ping', group: 'system', public: true,
  summary: 'Check that the bridge is alive and whether the given token is valid. No token required.',
  returns: '{ bridgeVersion, protocol, appVersion, os, paired }',
  run: function (p, ctx) {
    var a = app();
    return {
      bridgeVersion: BRIDGE_VERSION,
      protocol: BRIDGE_PROTOCOL,
      appVersion: str(a.appVersion),
      build: str(a.build),
      os: ['iPadOS', 'iPhoneOS', 'macOS'][num(a.osType, 2)] || 'unknown',
      paired: !!findClient(ctx.token),
      readOnly: WRITE_STATE.readOnly
    };
  }
});

defineAction({
  name: 'pair', group: 'system', public: true, async: true,
  summary: 'Request a token. MarginNote shows an Allow/Deny alert; the token is returned only if the user taps Allow.',
  params: { client: { type: 'string', required: true, desc: 'Human-readable client name shown in the alert, e.g. "Claude Code".' } },
  returns: '{ token, client }',
  run: function (p, ctx, done) {
    requestPairing(p.client.slice(0, 60), function (token, reason) {
      if (!token) done(null, new BridgeError('PAIRING_DENIED', reason));
      else done({ token: token, client: p.client }, null);
    });
  }
});

defineAction({
  name: 'auth.clients', group: 'system',
  summary: 'List paired clients (token hints only).',
  returns: '[{ client, createdAt, lastUsed, tokenHint }]',
  run: function () {
    return listClients();
  }
});

defineAction({
  name: 'auth.revoke', group: 'system',
  summary: 'Revoke the calling token (default) or every token.',
  params: { all: { type: 'boolean', default: false, desc: 'Revoke every paired client, not only the caller.' } },
  returns: '{ revoked }',
  run: function (p, ctx) {
    return { revoked: revokeTokens(p.all ? null : ctx.token) };
  }
});

defineAction({
  name: 'capabilities', group: 'system',
  summary: 'Self-description: every action with its parameters, so agents can discover the API at runtime.',
  returns: '{ bridgeVersion, protocol, actions: [{ name, group, summary, write, params, returns }] }',
  run: function () {
    return {
      bridgeVersion: BRIDGE_VERSION,
      protocol: BRIDGE_PROTOCOL,
      actions: ACTION_ORDER.map(function (n) {
        var d = ACTIONS[n];
        return { name: d.name, group: d.group, summary: d.summary, write: d.write, experimental: !!d.experimental, params: d.params, returns: d.returns || null };
      })
    };
  }
});

defineAction({
  name: 'bridge.log', group: 'system',
  summary: 'Recent requests handled by the bridge (newest last).',
  params: { limit: { type: 'integer', default: 30 } },
  returns: '[{ at, id, action, client, ok, code, ms }]',
  run: function (p) {
    return REQUEST_LOG.slice(-Math.max(1, p.limit));
  }
});

defineAction({
  name: 'context.get', group: 'context',
  summary: 'What the user is looking at: open notebook, focused and selected notes, current document and page, text selection.',
  returns: '{ studyMode, notebook, focusNote, selectedNotes, document, page, selectionText }',
  run: function (p, ctx) {
    var sc = studyCtl(ctx, false);
    var out = {
      appVersion: str(app().appVersion), theme: str(app().currentTheme),
      studyMode: null, notebook: null, focusNote: null, selectedNotes: [], document: null, page: null, selectionText: null
    };
    if (!sc) return out;
    out.studyMode = ['document', 'document', 'study', 'review'][num(sc.studyMode, 2)] || String(sc.studyMode);
    var nc = sc.notebookController;
    if (nc && nc.notebookId) {
      var nb = db().getNotebookById(nc.notebookId);
      if (nb) out.notebook = notebookSummary(nb);
      if (nc.focusNote) out.focusNote = noteSummary(nc.focusNote);
      var sel = nc.mindmapView ? arr(nc.mindmapView.selViewLst) : [];
      out.selectedNotes = sel.map(function (v) {
        return v && v.note && v.note.note ? noteSummary(v.note.note) : null;
      }).filter(Boolean);
    }
    var rc = sc.readerController;
    var dc = rc ? rc.currentDocumentController : null;
    if (dc && dc.document) {
      out.document = documentSummary(dc.document);
      out.page = num(dc.currPageNo, null);
      out.selectionText = dc.isSelectionText ? str(dc.selectionText) : null;
    }
    return out;
  }
});

// Scroll to a note and make it the mind map's focus note, so built-in commands act on it.
function focusNote(ctx, note, target) {
  var sc = studyCtl(ctx, true);
  var id = str(note.noteId);
  if (target === 'document') sc.focusNoteInDocumentById(id);
  else if (target === 'float') sc.focusNoteInFloatMindMapById(id);
  else sc.focusNoteInMindMapById(id);
  var nc = sc.notebookController;
  try {
    if (nc && target !== 'document') nc.changeFocusToNote(note);
  } catch (e) {}
  var now = nc && nc.focusNote ? str(nc.focusNote.noteId) : null;
  return { focused: id, isFocusNote: now === id };
}

defineAction({
  name: 'ui.openNotebook', group: 'ui', write: false,
  summary: 'Open a notebook (and optionally a document) in the current window.',
  params: {
    notebookId: { type: 'string', required: true },
    docMd5: { type: 'string', desc: 'Document to open alongside the notebook.' }
  },
  returns: '{ opened }',
  run: function (p, ctx) {
    requireNotebook(p.notebookId);
    var sc = studyCtl(ctx, false);
    if (sc && p.docMd5) sc.openNotebookAndDocument(p.notebookId, p.docMd5);
    else app().openURL(NSURL.URLWithString('marginnote4app://notebook/' + p.notebookId));
    return { opened: p.notebookId };
  }
});

defineAction({
  name: 'ui.focusNote', group: 'ui',
  summary: 'Scroll to and highlight a note in the mind map, the document, or the floating mind map. isFocusNote tells whether MarginNote also made it the focus note (usually it does not; selection stays with the user).',
  params: {
    noteId: { type: 'string', required: true },
    target: { type: 'string', enum: ['mindmap', 'document', 'float'], default: 'mindmap' }
  },
  returns: '{ focused, isFocusNote }',
  run: function (p, ctx) {
    return focusNote(ctx, requireNote(p.noteId), p.target);
  }
});

defineAction({
  name: 'ui.hud', group: 'ui',
  summary: 'Show a short toast message inside MarginNote.',
  params: { message: { type: 'string', required: true }, seconds: { type: 'number', default: 2 } },
  returns: '{ shown }',
  run: function (p, ctx) {
    app().showHUD(p.message, currentWindow(ctx), p.seconds);
    return { shown: true };
  }
});

defineAction({
  name: 'ui.queryCommand', group: 'ui',
  summary: 'Check whether a built-in MarginNote command is available right now (see docs/COMMANDS.md).',
  params: { command: { type: 'string', required: true }, keyFlags: { type: 'integer', default: 0 } },
  returns: '{ command, disabled, checked }',
  run: function (p, ctx) {
    var r = app().queryCommandWithKeyFlagsInWindow(p.command, p.keyFlags, currentWindow(ctx)) || {};
    return { command: p.command, disabled: !!r.disabled, checked: !!r.checked };
  }
});

defineAction({
  name: 'ui.command', group: 'ui', write: true,
  summary: 'Run any built-in MarginNote command (menu item / shortcut) in the current window, e.g. ZoomToFit, ViewExpandAll, ToggleMindMap. Card commands act on the card the user has selected; some commands open dialogs that need the user.',
  params: { command: { type: 'string', required: true }, keyFlags: { type: 'integer', default: 0 } },
  returns: '{ command, ran }',
  run: function (p, ctx) {
    var w = currentWindow(ctx);
    var r = app().queryCommandWithKeyFlagsInWindow(p.command, p.keyFlags, w) || {};
    if (r.disabled) fail('CONFLICT', 'Command "' + p.command + '" is not available in the current context', { command: p.command });
    app().processCommandWithKeyFlagsInWindow(p.command, p.keyFlags, w);
    return { command: p.command, ran: true };
  }
});

defineAction({
  name: 'ui.undo', group: 'ui', write: true,
  summary: 'Undo the last change in MarginNote (every bridge write is one undo step named "Agent: <action>").',
  returns: '{ undone }',
  run: function () {
    var um = UndoManager.sharedInstance();
    if (!um.canUndo()) fail('CONFLICT', 'Nothing to undo');
    um.undo();
    return { undone: true };
  }
});

defineAction({
  name: 'ui.redo', group: 'ui', write: true,
  summary: 'Redo the last undone change.',
  returns: '{ redone }',
  run: function () {
    var um = UndoManager.sharedInstance();
    if (!um.canRedo()) fail('CONFLICT', 'Nothing to redo');
    um.redo();
    return { redone: true };
  }
});
