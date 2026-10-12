// ---------------------------------------------------------------------------
// Read-only note actions.
// ---------------------------------------------------------------------------

defineAction({
  name: 'note.get', group: 'notes',
  summary: 'Full details of one note: title, excerpt, comments, tags, parent/children, source page, dates.',
  params: { noteId: { type: 'string', required: true } },
  returns: 'note detail',
  run: function (p) {
    var note = requireNote(p.noteId);
    var out = noteDetail(note);
    out.path = ancestorsOf(note);
    return out;
  }
});

defineAction({
  name: 'note.batchGet', group: 'notes',
  summary: 'Details of several notes at once. Missing ids are reported instead of failing.',
  params: { noteIds: { type: 'array', required: true, items: 'string' } },
  returns: '{ notes: [detail], missing: [id] }',
  run: function (p) {
    var notes = [];
    var missing = [];
    p.noteIds.slice(0, 500).forEach(function (id) {
      var n = db().getNoteById(String(id));
      if (n) notes.push(noteDetail(n));
      else missing.push(id);
    });
    return { notes: notes, missing: missing };
  }
});

defineAction({
  name: 'note.tree', group: 'notes',
  summary: 'A subtree (from a note) or a whole mind map (from a notebook) as JSON, Markdown or an indented outline.',
  params: {
    noteId: { type: 'string', desc: 'Root of the subtree. Give noteId or notebookId.' },
    notebookId: { type: 'string', desc: 'Dump every root of this notebook.' },
    depth: { type: 'integer', default: 3, desc: 'Levels below the root to include (max 50).' },
    format: { type: 'string', enum: ['json', 'markdown', 'outline'], default: 'json' },
    headingLevels: { type: 'integer', default: 3, desc: 'markdown: levels rendered as # headings before switching to bullets.' },
    includeComments: { type: 'boolean', default: false, desc: 'markdown: include text comments as quotes.' }
  },
  returns: 'json: { roots: [tree] } | markdown/outline: { text }',
  run: function (p) {
    var depth = Math.max(0, Math.min(50, p.depth));
    var roots;
    if (p.noteId) roots = [requireNote(p.noteId)];
    else if (p.notebookId) roots = rootsOf(requireNotebook(p.notebookId));
    else fail('BAD_REQUEST', 'Give noteId or notebookId');

    if (p.format === 'json') return { roots: roots.map(function (r) { return noteTree(r, depth); }) };
    if (p.format === 'outline') {
      var lines = [];
      (function walk(nodes, level) {
        nodes.forEach(function (n) {
          var label = str(n.noteTitle) || str(n.excerptText).split('\n')[0] || '(untitled)';
          lines.push(new Array(level + 1).join('  ') + '- ' + label + '  [' + str(n.noteId) + ']');
          if (level < depth) walk(childrenOf(n), level + 1);
        });
      })(roots, 0);
      return { text: lines.join('\n') };
    }
    var md = [];
    var opts = { headingLevels: Math.max(0, Math.min(6, p.headingLevels)), maxDepth: depth + 1, includeComments: p.includeComments };
    roots.forEach(function (r) { noteToMarkdown(r, 1, opts, md); });
    return { text: md.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
  }
});

function noteMatches(note, re, fields) {
  if (fields.title && re.test(str(note.noteTitle))) return 'title';
  if (fields.excerpt && re.test(str(note.excerptText))) return 'excerpt';
  if (fields.comments) {
    var cs = arr(note.comments);
    for (var i = 0; i < cs.length; i++) {
      if (re.test(str(cs[i].text)) || re.test(str(cs[i].q_htext))) return 'comment';
    }
  }
  return null;
}

defineAction({
  name: 'note.search', group: 'notes',
  summary: 'Search notes by text or regex in titles, excerpts and comments, in one notebook or all notebooks.',
  params: {
    query: { type: 'string', required: true },
    notebookId: { type: 'string', desc: 'Limit to one notebook (recommended).' },
    regex: { type: 'boolean', default: false },
    caseSensitive: { type: 'boolean', default: false },
    fields: { type: 'array', items: 'string', default: ['title', 'excerpt', 'comments'], desc: 'Any of title, excerpt, comments.' },
    limit: { type: 'integer', default: 50 }
  },
  returns: '{ results: [{ ...noteSummary, notebookId, matchedIn, path }], scanned, truncated }',
  run: function (p) {
    var source = p.regex ? p.query : p.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re;
    try {
      re = new RegExp(source, p.caseSensitive ? '' : 'i');
    } catch (e) {
      fail('BAD_REQUEST', 'Invalid regex: ' + e.message);
    }
    var fields = {};
    arr(p.fields).forEach(function (f) { fields[f] = true; });
    var notebooks = p.notebookId ? [requireNotebook(p.notebookId)] : arr(db().allNotebooks());
    var results = [];
    var scanned = 0;
    var limit = Math.max(1, Math.min(1000, p.limit));
    var budget = 200000;
    for (var b = 0; b < notebooks.length && results.length < limit && scanned < budget; b++) {
      var stack = rootsOf(notebooks[b]).slice().reverse();
      while (stack.length && results.length < limit && scanned < budget) {
        var n = stack.pop();
        scanned++;
        var where = noteMatches(n, re, fields);
        if (where) {
          var s = noteSummary(n);
          s.notebookId = str(notebooks[b].topicId);
          s.matchedIn = where;
          s.path = ancestorsOf(n);
          results.push(s);
        }
        var kids = childrenOf(n);
        for (var k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
      }
    }
    return { results: results, scanned: scanned, truncated: results.length >= limit || scanned >= budget };
  }
});

defineAction({
  name: 'tag.list', group: 'tags',
  summary: 'All #tags used in a notebook with counts.',
  params: { notebookId: { type: 'string', required: true } },
  returns: '[{ tag, count }]',
  run: function (p) {
    var counts = {};
    var stack = rootsOf(requireNotebook(p.notebookId)).slice();
    while (stack.length) {
      var n = stack.pop();
      tagsOf(n).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      stack.push.apply(stack, childrenOf(n));
    }
    return Object.keys(counts).sort().map(function (t) { return { tag: t, count: counts[t] }; });
  }
});

function imageOut(hash) {
  var data = hash ? db().getMediaByHash(hash) : null;
  if (!data) fail('NOT_FOUND', 'No image data');
  var b64 = str(data.base64Encoding());
  var mime = b64.indexOf('iVBOR') === 0 ? 'image/png' : b64.indexOf('/9j/') === 0 ? 'image/jpeg' : 'application/octet-stream';
  return { mime: mime, base64: b64, bytes: dataLength(data) };
}

defineAction({
  name: 'note.image', group: 'notes',
  summary: 'The image of an image excerpt, or of a handwriting/image comment, as base64.',
  params: {
    noteId: { type: 'string', required: true },
    commentIndex: { type: 'integer', desc: 'Index of a PaintNote comment; omit for the excerpt image.' }
  },
  returns: '{ mime, base64, bytes }',
  run: function (p) {
    var note = requireNote(p.noteId);
    if (p.commentIndex === undefined) {
      var hash = excerptImageHash(note);
      if (!hash) fail('NOT_FOUND', 'This note has no excerpt image');
      return imageOut(hash);
    }
    var c = arr(note.comments)[p.commentIndex];
    if (!c || c.type !== 'PaintNote') fail('NOT_FOUND', 'Comment ' + p.commentIndex + ' is not an image/handwriting comment');
    return imageOut(str(c.paint));
  }
});

defineAction({
  name: 'review.status', group: 'review',
  summary: 'Whether a note is currently in a review deck.',
  params: { noteId: { type: 'string', required: true } },
  returns: '{ noteId, inReview }',
  run: function (p, ctx) {
    requireNote(p.noteId);
    var sc = studyCtl(ctx, true);
    return { noteId: p.noteId, inReview: !!sc.isNoteInReview(p.noteId) };
  }
});
