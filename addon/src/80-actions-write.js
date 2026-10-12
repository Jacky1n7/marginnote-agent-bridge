// ---------------------------------------------------------------------------
// Write actions. Every call is one undo step ("Agent: <action>") in MarginNote.
// ---------------------------------------------------------------------------

var NOTE_FIELD_PARAMS = {
  title: { type: 'string', desc: 'Card title (plain text, not rendered as Markdown).' },
  excerpt: { type: 'string', desc: 'Card body / excerpt text. Rendered as Markdown + LaTeX when markdown=true.' },
  markdown: { type: 'boolean', desc: 'Render the excerpt as Markdown (default true when excerpt is given on create).' },
  color: { type: 'integer', desc: 'Color index 0-15.' },
  fill: { type: 'integer', desc: 'Fill style index.' }
};

function withFields(extra) {
  var out = {};
  Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  Object.keys(NOTE_FIELD_PARAMS).forEach(function (k) { if (!out[k]) out[k] = NOTE_FIELD_PARAMS[k]; });
  return out;
}

// Resolve where a new note goes: under parentId, or as a root of notebookId.
function resolveTarget(p) {
  if (p.parentId) {
    var parent = requireNote(p.parentId);
    return { parent: parent, notebookId: str(parent.notebookId) };
  }
  if (p.notebookId) return { parent: null, notebookId: str(requireNotebook(p.notebookId).topicId) };
  fail('BAD_REQUEST', 'Give parentId (to add a child) or notebookId (to add a root note)');
}

defineAction({
  name: 'note.create', group: 'notes', write: true,
  summary: 'Create a card as a child of parentId (or as a root of notebookId), with optional excerpt, comments, tags and color.',
  params: withFields({
    parentId: { type: 'string', desc: 'Parent note. Either parentId or notebookId is required.' },
    notebookId: { type: 'string', desc: 'Create a root note in this notebook.' },
    beforeId: { type: 'string', desc: 'Insert before this sibling instead of appending.' },
    comments: { type: 'array', desc: 'Comments to append: "markdown text" or {text, markdown} or {linkTo: noteId} or {html, text}.' },
    tags: { type: 'array', items: 'string', desc: 'Hashtags without "#".' }
  }),
  returns: 'note detail of the new card',
  run: function (p) {
    var t = resolveTarget(p);
    var note = writeTx(t.notebookId, 'create note', function () {
      var n = createNoteFrom(p, t.notebookId);
      placeNote(n, t.parent, p.beforeId);
      return n;
    });
    return noteDetail(note);
  }
});

defineAction({
  name: 'note.update', group: 'notes', write: true,
  summary: 'Change title, excerpt, Markdown flag, color or fill of a card. Omitted fields stay unchanged.',
  params: withFields({ noteId: { type: 'string', required: true } }),
  returns: 'note detail',
  run: function (p) {
    var note = requireNote(p.noteId);
    writeTx(note.notebookId, 'update note', function () { applyNoteFields(note, p); });
    return noteDetail(note);
  }
});

defineAction({
  name: 'note.delete', group: 'notes', write: true,
  summary: 'Delete a card. Refuses when it has children unless recursive=true.',
  params: {
    noteId: { type: 'string', required: true },
    recursive: { type: 'boolean', default: false, desc: 'Also delete all descendants.' }
  },
  returns: '{ deleted, descendants }',
  run: function (p) {
    var note = requireNote(p.noteId);
    var kids = childrenOf(note).length;
    if (kids && !p.recursive) fail('CONFLICT', 'Note has ' + kids + ' children; pass recursive=true to delete them too', { childCount: kids });
    var count = 0;
    (function walk(n) { childrenOf(n).forEach(function (c) { count++; walk(c); }); })(note);
    writeTx(note.notebookId, 'delete note', function () {
      if (kids) db().deleteBookNoteTree(p.noteId);
      else db().deleteBookNote(p.noteId);
    });
    return { deleted: p.noteId, descendants: count };
  }
});

defineAction({
  name: 'note.move', group: 'notes', write: true,
  summary: 'Move a card (with its subtree) under another parent, before a sibling, or out to the notebook root.',
  params: {
    noteId: { type: 'string', required: true },
    parentId: { type: 'string', desc: 'New parent. Omit with toRoot=true to detach to the root.' },
    beforeId: { type: 'string', desc: 'Place before this child of the new parent.' },
    toRoot: { type: 'boolean', default: false }
  },
  returns: 'note detail',
  run: function (p) {
    var note = requireNote(p.noteId);
    var parent = p.parentId ? requireNote(p.parentId) : null;
    if (!parent && !p.toRoot) fail('BAD_REQUEST', 'Give parentId or toRoot=true');
    if (parent) {
      if (str(parent.notebookId) !== str(note.notebookId)) fail('BAD_REQUEST', 'Cannot move across notebooks; use note.clone');
      if (isAncestor(note, parent)) fail('BAD_REQUEST', 'Cannot move a note into its own subtree');
    }
    writeTx(note.notebookId, 'move note', function () {
      if (note.parentNote) note.removeFromParent();
      placeNote(note, parent, p.beforeId);
    });
    return noteDetail(note);
  }
});

defineAction({
  name: 'note.clone', group: 'notes', write: true,
  summary: 'Copy a card (MarginNote clone) into a notebook, optionally under a parent.',
  params: {
    noteId: { type: 'string', required: true },
    notebookId: { type: 'string', desc: 'Target notebook (default: same notebook).' },
    parentId: { type: 'string', desc: 'Place the copy under this note.' }
  },
  returns: 'note detail of the copy',
  run: function (p) {
    var note = requireNote(p.noteId);
    var parent = p.parentId ? requireNote(p.parentId) : null;
    var target = parent ? str(parent.notebookId) : p.notebookId ? str(requireNotebook(p.notebookId).topicId) : str(note.notebookId);
    var copy = writeTx(target, 'clone note', function () {
      var res = arr(db().cloneNotesToTopic([note], target));
      var c = res.length ? (typeof res[0] === 'string' ? db().getNoteById(res[0]) : res[0]) : null;
      if (!c) fail('INTERNAL', 'MarginNote did not return the cloned note');
      if (parent) parent.addChild(c);
      return c;
    });
    return noteDetail(copy);
  }
});

defineAction({
  name: 'note.link', group: 'notes', write: true,
  summary: 'Add a note link (marginnote4app://note/…) from one card to another, optionally both ways.',
  params: {
    noteId: { type: 'string', required: true },
    targetId: { type: 'string', required: true },
    bidirectional: { type: 'boolean', default: false }
  },
  returns: '{ linked }',
  run: function (p) {
    var a = requireNote(p.noteId);
    var b = requireNote(p.targetId);
    writeTx(a.notebookId, 'link notes', function () {
      a.appendNoteLink(b);
      if (p.bidirectional) b.appendNoteLink(a);
    });
    return { linked: [p.noteId, p.targetId], bidirectional: p.bidirectional };
  }
});

// --- comments ------------------------------------------------------------------

defineAction({
  name: 'comment.add', group: 'comments', write: true,
  summary: 'Append a comment: Markdown (default, supports LaTeX), plain text, HTML, or a link to another note.',
  params: {
    noteId: { type: 'string', required: true },
    text: { type: 'string', desc: 'Comment text.' },
    markdown: { type: 'boolean', default: true },
    html: { type: 'string', desc: 'HTML comment instead of text.' },
    linkTo: { type: 'string', desc: 'Note id to link instead of text.' }
  },
  returns: 'note detail',
  run: function (p) {
    if (p.text === undefined && p.html === undefined && !p.linkTo) fail('BAD_REQUEST', 'Give text, html or linkTo');
    var note = requireNote(p.noteId);
    writeTx(note.notebookId, 'add comment', function () { appendComment(note, p); });
    return noteDetail(note);
  }
});

defineAction({
  name: 'comment.remove', group: 'comments', write: true,
  summary: 'Remove the comment at an index (see note.get for indices).',
  params: { noteId: { type: 'string', required: true }, index: { type: 'integer', required: true } },
  returns: 'note detail',
  run: function (p) {
    var note = requireNote(p.noteId);
    var n = arr(note.comments).length;
    if (p.index < 0 || p.index >= n) fail('BAD_REQUEST', 'index out of range', { count: n });
    writeTx(note.notebookId, 'remove comment', function () { note.removeCommentByIndex(p.index); });
    return noteDetail(note);
  }
});

// sortCommentsByNewIndices(map) expects map[oldIndex] = newIndex. Callers think in
// "list of old indices in the desired order", so invert that here.
function reorderComments(note, order) {
  var map = [];
  for (var j = 0; j < order.length; j++) map[order[j]] = j;
  note.sortCommentsByNewIndices(map);
}

// MarginNote has no in-place comment edit: append the new text, then move it into place.
function moveLastCommentTo(note, index) {
  var n = arr(note.comments).length;
  var order = [];
  for (var i = 0; i < n - 1; i++) {
    if (i === index) order.push(n - 1);
    order.push(i);
  }
  if (index >= n - 1) order.push(n - 1);
  reorderComments(note, order);
}

defineAction({
  name: 'comment.update', group: 'comments', write: true,
  summary: 'Replace the text of a text/Markdown comment, keeping its position.',
  params: {
    noteId: { type: 'string', required: true },
    index: { type: 'integer', required: true },
    text: { type: 'string', required: true },
    markdown: { type: 'boolean', default: true }
  },
  returns: 'note detail',
  run: function (p) {
    var note = requireNote(p.noteId);
    var c = arr(note.comments)[p.index];
    if (!c) fail('BAD_REQUEST', 'index out of range');
    if (c.type === 'PaintNote') fail('BAD_REQUEST', 'Cannot edit an image/handwriting comment');
    writeTx(note.notebookId, 'update comment', function () {
      note.removeCommentByIndex(p.index);
      appendComment(note, { text: p.text, markdown: p.markdown });
      moveLastCommentTo(note, p.index);
    });
    return noteDetail(note);
  }
});

defineAction({
  name: 'comment.reorder', group: 'comments', write: true,
  summary: 'Reorder comments. order lists current indices in the new order, e.g. [2,0,1].',
  params: { noteId: { type: 'string', required: true }, order: { type: 'array', required: true, items: 'integer' } },
  returns: 'note detail',
  run: function (p) {
    var note = requireNote(p.noteId);
    var n = arr(note.comments).length;
    var seen = {};
    var ok = p.order.length === n && p.order.every(function (i) {
      i = Number(i);
      if (!(i >= 0 && i < n) || seen[i]) return false;
      seen[i] = true;
      return true;
    });
    if (!ok) fail('BAD_REQUEST', 'order must be a permutation of 0..' + (n - 1));
    writeTx(note.notebookId, 'reorder comments', function () { reorderComments(note, p.order.map(Number)); });
    return noteDetail(note);
  }
});

// --- tags ------------------------------------------------------------------------

defineAction({
  name: 'tag.add', group: 'tags', write: true,
  summary: 'Add #tags to a card (stored the MarginNote way, as a "#a #b" comment).',
  params: { noteId: { type: 'string', required: true }, tags: { type: 'array', required: true, items: 'string' } },
  returns: 'note detail',
  run: function (p) {
    var note = requireNote(p.noteId);
    var have = tagsOf(note);
    var add = normalizeTags(p.tags).filter(function (t) { return have.indexOf(t) < 0; });
    if (add.length) {
      writeTx(note.notebookId, 'add tags', function () {
        note.appendTextComment(add.map(function (t) { return '#' + t; }).join(' '));
      });
    }
    return noteDetail(note);
  }
});

defineAction({
  name: 'tag.remove', group: 'tags', write: true,
  summary: 'Remove #tags from a card.',
  params: { noteId: { type: 'string', required: true }, tags: { type: 'array', required: true, items: 'string' } },
  returns: 'note detail',
  run: function (p) {
    var note = requireNote(p.noteId);
    var drop = normalizeTags(p.tags);
    writeTx(note.notebookId, 'remove tags', function () {
      var cs = arr(note.comments);
      for (var i = cs.length - 1; i >= 0; i--) {
        var text = str(cs[i].text);
        if (cs[i].type === 'PaintNote' || !/^\s*(#[^\s#]+\s*)+$/.test(text)) continue;
        var tags = (text.match(/#[^\s#]+/g) || []).map(function (t) { return t.slice(1); });
        var keep = tags.filter(function (t) { return drop.indexOf(t) < 0; });
        if (keep.length === tags.length) continue;
        note.removeCommentByIndex(i);
        if (keep.length) {
          note.appendTextComment(keep.map(function (t) { return '#' + t; }).join(' '));
          moveLastCommentTo(note, i);
        }
      }
    });
    return noteDetail(note);
  }
});

// --- Markdown import ------------------------------------------------------------------

function buildOutline(nodes, parent, notebookId, opts, created) {
  nodes.forEach(function (node) {
    var body = outlineBody(node);
    var spec = { color: opts.color };
    if (opts.mode === 'excerpt') {
      spec.title = '';
      spec.excerpt = body ? node.title + '\n' + body : node.title;
      spec.markdown = opts.markdown;
    } else if (opts.mode === 'comment') {
      spec.title = node.title;
      if (body) spec.comments = [{ text: body, markdown: opts.markdown }];
    } else {
      spec.title = node.title;
      if (body) {
        spec.excerpt = body;
        spec.markdown = opts.markdown;
      }
    }
    var note = createNoteFrom(spec, notebookId);
    placeNote(note, parent, null);
    var entry = { id: str(note.noteId), title: node.title, children: [] };
    created.push(entry);
    buildOutline(node.children, note, notebookId, opts, entry.children);
  });
}

defineAction({
  name: 'note.importMarkdown', group: 'notes', write: true,
  summary: 'Turn a Markdown outline (# headings and nested lists) into a card tree under parentId or at the notebook root.',
  params: {
    markdown: { type: 'string', required: true },
    parentId: { type: 'string' },
    notebookId: { type: 'string' },
    mode: {
      type: 'string', enum: ['title', 'excerpt', 'comment'], default: 'title',
      desc: 'title: heading→title, body→excerpt. excerpt: heading+body→excerpt (no title). comment: heading→title, body→Markdown comment.'
    },
    renderMarkdown: { type: 'boolean', default: true, desc: 'Render bodies as Markdown/LaTeX.' },
    color: { type: 'integer', desc: 'Color index for every created card.' }
  },
  returns: '{ created: count, tree: [{ id, title, children }] }',
  run: function (p) {
    var t = resolveTarget(p);
    var outline = parseMarkdownOutline(p.markdown);
    if (!outline.children.length) fail('BAD_REQUEST', 'No headings or list items found in the Markdown');
    var created = [];
    writeTx(t.notebookId, 'import markdown', function () {
      buildOutline(outline.children, t.parent, t.notebookId, { mode: p.mode, markdown: p.renderMarkdown, color: p.color }, created);
    });
    return { created: countOutline(outline.children), tree: created };
  }
});

// --- batch ------------------------------------------------------------------------

function resolveRefs(value, results) {
  if (typeof value === 'string') {
    var m = value.match(/^\$(\d+)((?:\.[A-Za-z0-9_]+)*)$/);
    if (!m) return value;
    var v = results[Number(m[1])];
    var path = m[2] ? m[2].slice(1).split('.') : [];
    for (var i = 0; i < path.length; i++) v = v === undefined || v === null ? undefined : v[path[i]];
    if (v === undefined) fail('BAD_REQUEST', 'Unresolved reference ' + value);
    return v;
  }
  if (Array.isArray(value)) return value.map(function (x) { return resolveRefs(x, results); });
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function (k) { out[k] = resolveRefs(value[k], results); });
    return out;
  }
  return value;
}

defineAction({
  name: 'batch', group: 'batch', write: true,
  summary: 'Run many actions in one round trip and ONE undo step. Later ops can reference earlier results with "$<index>.<field>", e.g. {"parentId": "$0.id"}. With atomic=true (default) a failure rolls everything back.',
  params: {
    notebookId: { type: 'string', required: true, desc: 'Notebook that receives the single undo step.' },
    ops: { type: 'array', required: true, desc: '[{ "action": "note.create", "params": {...} }, ...] (max 500).' },
    atomic: { type: 'boolean', default: true }
  },
  returns: '{ results: [data], completed } or error with details.failedIndex',
  run: function (p, ctx) {
    requireNotebook(p.notebookId);
    if (p.ops.length > 500) fail('BAD_REQUEST', 'At most 500 ops per batch');
    var results = [];
    var wrote = false;
    var failure = null;
    writeTx(p.notebookId, 'batch (' + p.ops.length + ' ops)', function () {
      for (var i = 0; i < p.ops.length; i++) {
        var op = p.ops[i] || {};
        try {
          if (op.action === 'batch' || op.action === 'pair') fail('BAD_REQUEST', op.action + ' cannot be nested in batch');
          var def = ACTIONS[op.action];
          var data = runAction(op.action, resolveRefs(op.params || {}, results), ctx, null);
          if (def && def.write) wrote = true;
          results.push(data);
        } catch (e) {
          failure = { index: i, error: errorOut(e) };
          return;
        }
      }
    });
    if (failure) {
      var rolledBack = false;
      if (p.atomic && wrote) {
        try {
          UndoManager.sharedInstance().undo();
          rolledBack = true;
          app().refreshAfterDBChanged(p.notebookId);
        } catch (e) {}
      }
      fail(failure.error.code, 'Op ' + failure.index + ' failed: ' + failure.error.message, {
        failedIndex: failure.index, error: failure.error, completed: results.length, rolledBack: rolledBack
      });
    }
    return { results: results, completed: results.length };
  }
});
