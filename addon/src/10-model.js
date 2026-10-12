// ---------------------------------------------------------------------------
// Model helpers: lookups, serialization and the undoable write wrapper.
// ---------------------------------------------------------------------------

var NOTEBOOK_TYPES = { 1316242276: 'cardDeck', 1316244846: 'mindmap', 1316242542: 'document', 1316245102: 'null' };

function requireNote(noteId) {
  var note = noteId ? db().getNoteById(String(noteId)) : null;
  if (!note) fail('NOT_FOUND', 'Note not found: ' + noteId, { noteId: noteId });
  return note;
}

function requireNotebook(notebookId) {
  var nb = notebookId ? db().getNotebookById(String(notebookId)) : null;
  if (!nb) fail('NOT_FOUND', 'Notebook not found: ' + notebookId, { notebookId: notebookId });
  return nb;
}

function requireDocument(docMd5) {
  var doc = docMd5 ? db().getDocumentById(String(docMd5)) : null;
  if (!doc) fail('NOT_FOUND', 'Document not found: ' + docMd5, { docMd5: docMd5 });
  return doc;
}

function childrenOf(note) {
  return arr(note.childNotes);
}

function rootsOf(notebook) {
  // MbTopic.notes lists every note of the study set; keep only real roots.
  return arr(notebook.notes).filter(function (n) {
    return !n.parentNote;
  });
}

// --- comments & tags -------------------------------------------------------

var LINK_RE = /^marginnote[34]app:\/\/note\/([0-9A-Za-z-]+)\s*$/;
var TAG_RE = /#([^\s#]+)/g;

function commentOut(c, index) {
  var o = { index: index, type: str(c.type) };
  if (c.type === 'PaintNote') {
    o.kind = 'image';
    o.paint = str(c.paint);
  } else if (c.type === 'HtmlNote') {
    o.kind = 'html';
    o.html = str(c.html);
    o.text = str(c.text);
  } else if (c.type === 'LinkNote') {
    o.kind = 'link';
    o.noteId = str(c.noteid);
    o.text = str(c.q_htext);
  } else {
    var text = str(c.text);
    var m = text.match(LINK_RE);
    if (m) {
      o.kind = 'link';
      o.noteId = m[1];
    } else if (/^\s*(#[^\s#]+\s*)+$/.test(text)) {
      o.kind = 'tags';
    } else {
      o.kind = c.markdown ? 'markdown' : 'text';
    }
    o.text = text;
  }
  return o;
}

function tagsOf(note) {
  var tags = [];
  arr(note.comments).forEach(function (c) {
    if (c.type !== 'TextNote' && c.type !== undefined) return;
    var text = str(c.text);
    if (!/^\s*(#[^\s#]+\s*)+$/.test(text)) return;
    var m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text))) if (tags.indexOf(m[1]) < 0) tags.push(m[1]);
  });
  return tags;
}

// --- serialization -----------------------------------------------------------

function noteSummary(note) {
  return {
    id: str(note.noteId),
    title: str(note.noteTitle),
    excerpt: str(note.excerptText),
    color: num(note.colorIndex, -1),
    childCount: childrenOf(note).length
  };
}

function dataLength(data) {
  if (!data) return 0;
  return num(typeof data.length === 'function' ? data.length() : data.length, 0);
}

// Text excerpts carry a 1×1 placeholder image; only count real pictures.
function excerptImageHash(note) {
  var pic = note.excerptPic;
  var hash = pic && pic.paint ? str(pic.paint) : '';
  if (!hash) return '';
  return dataLength(db().getMediaByHash(hash)) > 512 ? hash : '';
}

function noteDetail(note) {
  var parent = note.parentNote;
  return {
    id: str(note.noteId),
    notebookId: str(note.notebookId),
    title: str(note.noteTitle),
    excerpt: str(note.excerptText),
    excerptMarkdown: !!num(note.excerptTextMarkdown, 0),
    hasImage: !!excerptImageHash(note),
    color: num(note.colorIndex, -1),
    fill: num(note.fillIndex, -1),
    tags: tagsOf(note),
    comments: arr(note.comments).map(commentOut),
    parentId: parent ? str(parent.noteId) : null,
    childIds: childrenOf(note).map(function (c) { return str(c.noteId); }),
    linkedNoteIds: arr(note.linkedNotes).map(function (l) { return str(l.noteid || l.noteId || ''); }).filter(Boolean),
    docMd5: str(note.docMd5) || null,
    startPage: note.startPage === undefined || note.startPage === null ? null : num(note.startPage, null),
    endPage: note.endPage === undefined || note.endPage === null ? null : num(note.endPage, null),
    folded: !!num(note.mindmapBranchClose, 0),
    flagged: !!num(note.flagged, 0),
    createdAt: iso(note.createDate),
    modifiedAt: iso(note.modifiedDate),
    url: 'marginnote4app://note/' + str(note.noteId)
  };
}

function noteTree(note, depth) {
  var o = noteSummary(note);
  o.tags = tagsOf(note);
  var commentTexts = arr(note.comments).map(commentOut).filter(function (c) {
    return c.kind === 'text' || c.kind === 'markdown';
  });
  if (commentTexts.length) o.comments = commentTexts.map(function (c) { return c.text; });
  var kids = childrenOf(note);
  if (depth > 0) o.children = kids.map(function (k) { return noteTree(k, depth - 1); });
  else if (kids.length) o.truncated = true;
  return o;
}

function notebookSummary(nb) {
  return {
    id: str(nb.topicId),
    title: str(nb.title),
    type: NOTEBOOK_TYPES[num(nb.type, 0)] || 'unknown',
    lastVisit: iso(nb.lastVisit),
    documentCount: arr(nb.documents).length,
    url: 'marginnote4app://notebook/' + str(nb.topicId)
  };
}

function documentSummary(doc) {
  return {
    docMd5: str(doc.docMd5),
    title: str(doc.docTitle),
    pageCount: num(doc.pageCount, 0),
    path: str(doc.pathFile),
    lastVisit: iso(doc.lastVisit)
  };
}

function ancestorsOf(note) {
  var path = [];
  var p = note.parentNote;
  var guard = 0;
  while (p && guard++ < 200) {
    path.unshift({ id: str(p.noteId), title: str(p.noteTitle) || str(p.excerptText).slice(0, 40) });
    p = p.parentNote;
  }
  return path;
}

// Markdown export: headings for the first levels, nested bullets below.
function noteToMarkdown(note, level, opts, lines) {
  var title = str(note.noteTitle);
  var excerpt = str(note.excerptText);
  var headline = title || excerpt.split('\n')[0] || '(untitled)';
  var body = title ? excerpt : excerpt.split('\n').slice(1).join('\n');
  var useHeading = level <= opts.headingLevels;
  if (useHeading) {
    lines.push(new Array(level + 1).join('#') + ' ' + headline);
    if (body.trim()) lines.push('', body.trim());
  } else {
    var indent = new Array(level - opts.headingLevels).join('  ');
    lines.push(indent + '- ' + headline.replace(/\n/g, ' '));
    if (body.trim()) lines.push(indent + '  ' + body.trim().replace(/\n/g, '\n' + indent + '  '));
  }
  if (opts.includeComments) {
    arr(note.comments).map(commentOut).forEach(function (c) {
      if (c.kind !== 'text' && c.kind !== 'markdown') return;
      var quote = '> ' + c.text.replace(/\n/g, ' ');
      if (useHeading) lines.push('', quote);
      else lines.push(new Array(level - opts.headingLevels + 1).join('  ') + quote);
    });
  }
  if (useHeading) lines.push('');
  if (level < opts.maxDepth) {
    childrenOf(note).forEach(function (k) {
      noteToMarkdown(k, level + 1, opts, lines);
    });
  }
  return lines;
}

// --- writes ------------------------------------------------------------------

var WRITE_STATE = { depth: 0, readOnly: false };

// Run `fn` as one undoable step in `topicId`. Nested calls (e.g. inside a
// batch) join the outer undo group.
function writeTx(topicId, name, fn) {
  if (WRITE_STATE.readOnly) fail('FORBIDDEN', 'MN Agent Bridge is in read-only mode (toggle it from the add-on toolbar button)');
  if (WRITE_STATE.depth > 0) return fn();
  var result;
  var error = null;
  var ran = false;
  WRITE_STATE.depth++;
  try {
    UndoManager.sharedInstance().undoGrouping('Agent: ' + name, String(topicId), function () {
      ran = true;
      try {
        result = fn();
      } catch (e) {
        error = e;
      }
    });
  } finally {
    WRITE_STATE.depth--;
  }
  try {
    app().refreshAfterDBChanged(String(topicId));
  } catch (e) {}
  if (error) throw error;
  if (!ran) fail('INTERNAL', 'UndoManager did not run the write block');
  return result;
}

function applyNoteFields(note, p) {
  if (p.title !== undefined) note.noteTitle = String(p.title);
  if (p.excerpt !== undefined) note.excerptText = String(p.excerpt);
  if (p.markdown !== undefined) note.excerptTextMarkdown = p.markdown ? 1 : 0;
  if (p.color !== undefined) note.colorIndex = p.color;
  if (p.fill !== undefined) note.fillIndex = p.fill;
}

function appendComment(note, c) {
  if (typeof c === 'string') c = { text: c, markdown: true };
  if (c.linkTo) {
    note.appendNoteLink(requireNote(c.linkTo));
  } else if (c.html !== undefined) {
    note.appendHtmlComment(String(c.html), str(c.text), { width: num(c.width, 400), height: num(c.height, 200) }, str(c.tag) || 'agentbridge');
  } else if (c.markdown === false) {
    note.appendTextComment(str(c.text));
  } else {
    note.appendMarkdownComment(str(c.text));
  }
}

function normalizeTags(tags) {
  return arr(tags).map(function (t) { return String(t).replace(/^#/, '').replace(/\s+/g, '_'); }).filter(Boolean);
}

function placeNote(note, parent, beforeId) {
  if (!parent) return;
  if (beforeId) {
    var before = requireNote(beforeId);
    if (!before.parentNote || str(before.parentNote.noteId) !== str(parent.noteId)) {
      fail('BAD_REQUEST', 'beforeId must be a child of the target parent', { beforeId: beforeId });
    }
    parent.insertChildBefore(note, before);
  } else {
    parent.addChild(note);
  }
}

function isAncestor(maybeAncestor, note) {
  var p = note;
  var guard = 0;
  while (p && guard++ < 500) {
    if (str(p.noteId) === str(maybeAncestor.noteId)) return true;
    p = p.parentNote;
  }
  return false;
}

// Create one note. `spec` is validated by the caller.
function createNoteFrom(spec, notebookId) {
  var note = db().createNoteWithTitleTopicid(str(spec.title), String(notebookId));
  if (!note) fail('INTERNAL', 'MarginNote refused to create the note');
  if (spec.excerpt !== undefined && spec.markdown === undefined) spec.markdown = true;
  applyNoteFields(note, spec);
  arr(spec.comments).forEach(function (c) { appendComment(note, c); });
  var tags = normalizeTags(spec.tags);
  if (tags.length) note.appendTextComment(tags.map(function (t) { return '#' + t; }).join(' '));
  return note;
}
