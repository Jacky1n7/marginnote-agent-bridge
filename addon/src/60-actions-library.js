// ---------------------------------------------------------------------------
// Notebooks (study sets), documents and backups.
// ---------------------------------------------------------------------------

// Convert native values (NSDictionary/NSArray trees) into plain JSON.
function plain(x, depth) {
  if (depth > 8 || x === undefined || x === null) return null;
  var t = typeof x;
  if (t === 'string' || t === 'number' || t === 'boolean') return x;
  if (x instanceof Date) return iso(x);
  if (Array.isArray(x)) return x.map(function (v) { return plain(v, depth + 1); });
  if (t === 'object') {
    var out = {};
    var keys = [];
    try {
      keys = Object.keys(x);
    } catch (e) {}
    keys.forEach(function (k) {
      var v = plain(x[k], depth + 1);
      if (v !== null && typeof v !== 'function') out[k] = v;
    });
    return out;
  }
  return String(x);
}

// textContentsForPageNo() returns lines, each an array of glyphs { char: <UTF-16 code>, rect }.
// Fall back to any string fields for other shapes.
function pageText(contents) {
  var lines = [];
  arr(contents).forEach(function (line) {
    var glyphs = arr(line);
    var s = '';
    for (var i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      if (g && typeof g.char === 'number') s += String.fromCharCode(g.char);
      else if (g && typeof g.text === 'string') s += g.text;
      else if (typeof g === 'string') s += g;
    }
    lines.push(s);
  });
  return lines.join('\n');
}

defineAction({
  name: 'notebook.list', group: 'notebooks',
  summary: 'List all study sets / notebooks.',
  params: { type: { type: 'string', enum: ['mindmap', 'cardDeck', 'document', 'all'], default: 'all' } },
  returns: '[{ id, title, type, lastVisit, documentCount, url }]',
  run: function (p) {
    return arr(db().allNotebooks()).map(notebookSummary).filter(function (n) {
      return p.type === 'all' || n.type === p.type;
    });
  }
});

defineAction({
  name: 'notebook.get', group: 'notebooks',
  summary: 'Notebook details with its documents and root notes.',
  params: { notebookId: { type: 'string', required: true } },
  returns: '{ ...notebook, documents: [...], roots: [noteSummary] }',
  run: function (p) {
    var nb = requireNotebook(p.notebookId);
    var out = notebookSummary(nb);
    out.mainDocMd5 = str(nb.mainDocMd5) || null;
    out.hashtags = str(nb.hashtags) || null;
    out.documents = arr(nb.documents).map(documentSummary);
    out.roots = rootsOf(nb).map(noteSummary);
    return out;
  }
});

defineAction({
  name: 'notebook.rename', group: 'notebooks', write: true,
  summary: 'Rename a notebook.',
  params: { notebookId: { type: 'string', required: true }, title: { type: 'string', required: true } },
  returns: 'notebook summary',
  run: function (p) {
    var nb = requireNotebook(p.notebookId);
    writeTx(nb.topicId, 'rename notebook', function () {
      nb.title = p.title;
    });
    return notebookSummary(nb);
  }
});

defineAction({
  name: 'document.list', group: 'documents',
  summary: 'List documents (PDF/EPUB…), optionally only those attached to one notebook.',
  params: { notebookId: { type: 'string', desc: 'Only documents of this notebook.' } },
  returns: '[{ docMd5, title, pageCount, path, lastVisit }]',
  run: function (p) {
    var docs = p.notebookId ? arr(requireNotebook(p.notebookId).documents) : arr(db().allDocuments());
    return docs.map(documentSummary);
  }
});

defineAction({
  name: 'document.get', group: 'documents',
  summary: 'Document details including its table of contents.',
  params: { docMd5: { type: 'string', required: true } },
  returns: '{ ...document, toc }',
  run: function (p) {
    var doc = requireDocument(p.docMd5);
    var out = documentSummary(doc);
    try {
      out.toc = plain(doc.tocAll(), 0);
    } catch (e) {
      out.toc = null;
    }
    return out;
  }
});

defineAction({
  name: 'document.pageText', group: 'documents', experimental: true,
  summary: 'Extract the text of one page of a document (needs a text layer; scanned pages return little or nothing).',
  params: {
    docMd5: { type: 'string', required: true },
    page: { type: 'integer', required: true, desc: '1-based page number.' },
    raw: { type: 'boolean', default: false, desc: 'Also return the raw native structure (for debugging).' }
  },
  returns: '{ docMd5, page, text }',
  run: function (p) {
    var doc = requireDocument(p.docMd5);
    if (p.page < 1 || p.page > num(doc.pageCount, 0)) fail('BAD_REQUEST', 'page out of range', { pageCount: num(doc.pageCount, 0) });
    var contents = doc.textContentsForPageNo(p.page);
    var out = { docMd5: p.docMd5, page: p.page, text: pageText(contents) };
    if (p.raw) out.raw = plain(contents, 0);
    return out;
  }
});

function backupDir() {
  var dir = str(app().documentPath) + '/AgentBridgeBackups';
  var fm = NSFileManager.defaultManager();
  if (!fm.fileExistsAtPath(dir)) fm.createDirectoryAtPathWithIntermediateDirectoriesAttributes(dir, true, null);
  return dir;
}

defineAction({
  name: 'notebook.backup', group: 'notebooks', experimental: true,
  summary: 'Export a full copy of a notebook into MarginNote\'s own storage (Documents/AgentBridgeBackups). Take one before large edits.',
  params: { notebookId: { type: 'string', required: true } },
  returns: '{ file, path }',
  run: function (p) {
    var nb = requireNotebook(p.notebookId);
    var stamp = new Date().toISOString().replace(/[:.]/g, '-');
    var safe = str(nb.title).replace(/[\/\\:*?"<>|]/g, '_').slice(0, 60);
    var file = safe + '__' + str(nb.topicId).slice(0, 8) + '__' + stamp + '.marginpkg';
    var path = backupDir() + '/' + file;
    if (!db().exportNotebookStorePath(nb.topicId, path)) fail('INTERNAL', 'MarginNote could not export the notebook');
    return { file: file, path: path };
  }
});

defineAction({
  name: 'notebook.backups', group: 'notebooks', experimental: true,
  summary: 'List backups created by notebook.backup.',
  returns: '[{ file }]',
  run: function () {
    return arr(NSFileManager.defaultManager().contentsOfDirectoryAtPath(backupDir()))
      .map(String)
      .filter(function (f) { return /\.marginpkg$/.test(f); })
      .sort()
      .map(function (f) { return { file: f }; });
  }
});

defineAction({
  name: 'notebook.restoreBackup', group: 'notebooks', write: true, experimental: true,
  summary: 'Import a backup made by notebook.backup back into MarginNote (MarginNote decides whether it merges or adds a copy).',
  params: {
    file: { type: 'string', required: true, desc: 'File name from notebook.backups.' },
    merge: { type: 'boolean', default: false }
  },
  returns: '{ imported }',
  run: function (p) {
    if (/[\/\\]/.test(p.file)) fail('BAD_REQUEST', 'file must be a bare file name');
    var path = backupDir() + '/' + p.file;
    if (!NSFileManager.defaultManager().fileExistsAtPath(path)) fail('NOT_FOUND', 'Backup not found', { file: p.file });
    var r = db().importNotebookFromStorePathMerge(path, p.merge);
    return { imported: !!r, notebookId: r && r.topicId ? str(r.topicId) : null };
  }
});
