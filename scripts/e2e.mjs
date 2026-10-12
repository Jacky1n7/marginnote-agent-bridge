#!/usr/bin/env node
// End-to-end test against a running MarginNote with the add-on installed and paired.
// Everything happens under one temporary root note that is deleted at the end.
//
//   node scripts/e2e.mjs <notebookId> [--keep] [--undo]
//
// --undo also exercises ui.undo / batch rollback (they use MarginNote's shared undo stack,
// so do not edit notes in MarginNote while the test runs).
import { call, BridgeError } from '../cli/lib/client.js';

const args = process.argv.slice(2);
const notebookId = args.find((a) => !a.startsWith('--'));
const keep = args.includes('--keep');
const withUndo = args.includes('--undo');
if (!notebookId) {
  console.error('usage: node scripts/e2e.mjs <notebookId> [--keep] [--undo]');
  process.exit(2);
}

const results = [];
let rootId = null;

async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, detail });
    console.log(`✓ ${name} (${Date.now() - t} ms)${detail ? ' — ' + detail : ''}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, detail: `${e.code || ''} ${e.message}` });
    console.log(`✗ ${name}: ${e.code || ''} ${e.message}${e.details ? ' ' + JSON.stringify(e.details) : ''}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('assertion failed: ' + msg);
}

async function expectError(code, fn) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof BridgeError && e.code === code) return;
    throw new Error(`expected ${code}, got ${e.code}: ${e.message}`);
  }
  throw new Error(`expected ${code}, call succeeded`);
}

const ids = {};

await step('ping', async () => {
  const p = await call('ping');
  assert(p.paired, 'token is valid');
  return `bridge ${p.bridgeVersion}, MarginNote ${p.appVersion}`;
});
await step('capabilities', async () => {
  const c = await call('capabilities');
  return `${c.actions.length} actions`;
});
await step('unauthorized call is rejected', () => expectError('UNAUTHORIZED', () => call('notebook.list', {}, { token: 'mnab_wrong' })));
await step('unknown action', () => expectError('UNKNOWN_ACTION', () => call('nope.nope')));
await step('missing parameter', () => expectError('BAD_REQUEST', () => call('note.get', {})));
await step('context.get', async () => {
  const c = await call('context.get');
  return `mode ${c.studyMode}, notebook ${c.notebook ? c.notebook.title : '—'}`;
});
await step('notebook.list', async () => `${(await call('notebook.list')).length} notebooks`);
await step('notebook.get', async () => {
  const nb = await call('notebook.get', { notebookId });
  ids.docs = nb.documents;
  return `${nb.title}: ${nb.roots.length} roots, ${nb.documents.length} docs`;
});
await step('document.list', async () => `${(await call('document.list', { notebookId })).length} docs`);
if (ids.docs && ids.docs.length) {
  const doc = ids.docs[0];
  await step('document.get', async () => {
    const d = await call('document.get', { docMd5: doc.docMd5 });
    return `${d.title} (${d.pageCount} pages, toc ${Array.isArray(d.toc) ? d.toc.length : typeof d.toc})`;
  });
  await step('document.pageText', async () => {
    const t = await call('document.pageText', { docMd5: doc.docMd5, page: 1 });
    return `${t.text.length} chars: ${JSON.stringify(t.text.slice(0, 40))}`;
  });
}

await step('note.create (root, markdown + LaTeX, tags, comment)', async () => {
  const n = await call('note.create', {
    notebookId,
    title: '🧪 MN Agent Bridge e2e',
    excerpt: 'Inline $e^{i\\pi}+1=0$ and display:\n\n$$\\int_0^1 x^2\\,dx=\\frac13$$',
    color: 3,
    tags: ['e2e', 'agent bridge'],
    comments: ['**markdown** comment with $x^2$', { text: 'plain comment', markdown: false }],
  });
  rootId = n.id;
  assert(n.excerptMarkdown, 'excerpt rendered as markdown');
  assert(n.color === 3, 'color');
  assert(n.tags.includes('e2e') && n.tags.includes('agent_bridge'), 'tags ' + n.tags);
  assert(n.comments.length === 3, 'comments ' + n.comments.length);
  return n.id;
});

if (rootId) {
  await step('note.create children A, B and C before B', async () => {
    ids.a = (await call('note.create', { parentId: rootId, title: 'A' })).id;
    ids.b = (await call('note.create', { parentId: rootId, title: 'B' })).id;
    ids.c = (await call('note.create', { parentId: rootId, title: 'C', beforeId: ids.b })).id;
    const root = await call('note.get', { noteId: rootId });
    assert(root.childIds.join() === [ids.a, ids.c, ids.b].join(), 'order A,C,B got ' + root.childIds);
  });
  await step('note.update', async () => {
    const n = await call('note.update', { noteId: ids.a, title: 'A (edited)', excerpt: '**bold**', color: 5 });
    assert(n.title === 'A (edited)' && n.excerpt === '**bold**' && n.color === 5, 'fields');
  });
  await step('comment.add / update / reorder / remove', async () => {
    await call('comment.add', { noteId: ids.a, text: 'first' });
    await call('comment.add', { noteId: ids.a, text: 'second', markdown: false });
    await call('comment.add', { noteId: ids.a, linkTo: ids.b });
    let n = await call('note.get', { noteId: ids.a });
    assert(n.comments.map((c) => c.kind).join() === 'markdown,text,link', 'kinds ' + n.comments.map((c) => c.kind));
    assert(n.comments[2].noteId === ids.b, 'link target');
    n = await call('comment.update', { noteId: ids.a, index: 0, text: 'first (edited)' });
    assert(n.comments[0].text === 'first (edited)' && n.comments[1].text === 'second', 'update keeps position: ' + n.comments.map((c) => c.text));
    n = await call('comment.reorder', { noteId: ids.a, order: [1, 0, 2] });
    assert(n.comments[0].text === 'second' && n.comments[1].text === 'first (edited)', 'reorder: ' + n.comments.map((c) => c.text));
    n = await call('comment.remove', { noteId: ids.a, index: 2 });
    assert(n.comments.length === 2, 'remove');
  });
  await step('tag.add / tag.remove / tag.list', async () => {
    let n = await call('tag.add', { noteId: ids.a, tags: ['#x', 'y', 'z'] });
    assert(['x', 'y', 'z'].every((t) => n.tags.includes(t)), 'added ' + n.tags);
    n = await call('tag.remove', { noteId: ids.a, tags: ['y'] });
    assert(n.tags.includes('x') && n.tags.includes('z') && !n.tags.includes('y'), 'removed ' + n.tags);
    const list = await call('tag.list', { notebookId });
    assert(list.some((t) => t.tag === 'e2e'), 'tag.list');
    return list.map((t) => `#${t.tag}×${t.count}`).join(' ');
  });
  await step('note.move (under A, back before C, refuse cycles)', async () => {
    let b = await call('note.move', { noteId: ids.b, parentId: ids.a });
    assert(b.parentId === ids.a, 'moved under A');
    b = await call('note.move', { noteId: ids.b, parentId: rootId, beforeId: ids.c });
    const root = await call('note.get', { noteId: rootId });
    assert(root.childIds.join() === [ids.a, ids.b, ids.c].join(), 'order A,B,C got ' + root.childIds);
    await expectError('BAD_REQUEST', () => call('note.move', { noteId: rootId, parentId: ids.a }));
  });
  await step('note.clone', async () => {
    const copy = await call('note.clone', { noteId: ids.c, parentId: ids.a });
    assert(copy.id !== ids.c && copy.parentId === ids.a, 'clone placed');
    ids.clone = copy.id;
  });
  await step('note.link (bidirectional)', async () => {
    await call('note.link', { noteId: ids.b, targetId: ids.c, bidirectional: true });
    const c = await call('note.get', { noteId: ids.c });
    assert(c.comments.some((x) => x.kind === 'link' && x.noteId === ids.b), 'back link');
  });
  for (const mode of ['title', 'excerpt', 'comment']) {
    await step(`note.importMarkdown mode=${mode}`, async () => {
      const md = `# Chapter ${mode}\nIntro with $a^2+b^2=c^2$.\n\n## Section 1\n- item 1\n  - item 1.1\n- item 2\n\n## Section 2\n$$\nx = \\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}\n$$\n`;
      const r = await call('note.importMarkdown', { parentId: rootId, markdown: md, mode });
      assert(r.created === 6, 'created ' + r.created);
      const ch = await call('note.get', { noteId: r.tree[0].id });
      if (mode === 'excerpt') assert(ch.title === '' && ch.excerpt.startsWith(`Chapter ${mode}\nIntro`), 'excerpt mode: ' + JSON.stringify(ch.excerpt));
      if (mode === 'title') assert(ch.title === `Chapter ${mode}` && ch.excerpt.startsWith('Intro'), 'title mode');
      if (mode === 'comment') assert(ch.title === `Chapter ${mode}` && ch.comments[0].text.startsWith('Intro'), 'comment mode');
      const s2 = await call('note.get', { noteId: r.tree[0].children[1].id });
      assert(/\\frac\{-b/.test(s2[mode === 'comment' ? 'comments' : 'excerpt']?.[0]?.text ?? s2.excerpt), 'math block kept');
    });
  }
  await step('note.tree json / outline / markdown', async () => {
    const j = await call('note.tree', { noteId: rootId, depth: 5 });
    assert(j.roots[0].children.length >= 6, 'children ' + j.roots[0].children.length);
    const o = await call('note.tree', { noteId: rootId, depth: 1, format: 'outline' });
    assert(o.text.includes('[' + ids.a + ']'), 'outline ids');
    const m = await call('note.tree', { noteId: rootId, depth: 3, format: 'markdown', includeComments: true });
    assert(m.text.startsWith('# 🧪 MN Agent Bridge e2e'), 'markdown heading');
    return `${m.text.split('\n').length} markdown lines`;
  });
  await step('note.tree for a whole notebook', async () => {
    const j = await call('note.tree', { notebookId, depth: 0 });
    assert(j.roots.some((r) => r.id === rootId), 'root listed');
    return `${j.roots.length} roots`;
  });
  await step('note.search (text, regex, scoped)', async () => {
    const r = await call('note.search', { query: 'A (edited)', notebookId });
    assert(r.results.some((x) => x.id === ids.a), 'found A');
    const rx = await call('note.search', { query: 'Chapter (title|excerpt)', regex: true, notebookId });
    assert(rx.results.length >= 2, 'regex hits ' + rx.results.length);
    assert(rx.results[0].path.length >= 1, 'path');
    return `scanned ${r.scanned}`;
  });
  await step('note.batchGet', async () => {
    const r = await call('note.batchGet', { noteIds: [ids.a, ids.b, 'missing-id'] });
    assert(r.notes.length === 2 && r.missing[0] === 'missing-id', 'batchGet');
  });
  await step('batch with $refs (one undo step)', async () => {
    const r = await call('batch', {
      notebookId,
      ops: [
        { action: 'note.create', params: { parentId: rootId, title: 'batch parent' } },
        { action: 'note.create', params: { parentId: '$0.id', title: 'batch child', excerpt: 'from $0' } },
        { action: 'tag.add', params: { noteId: '$1.id', tags: ['batch'] } },
        { action: 'note.get', params: { noteId: '$1.id' } },
      ],
    });
    assert(r.completed === 4 && r.results[3].parentId === r.results[0].id && r.results[3].tags.includes('batch'), 'refs');
    ids.batchParent = r.results[0].id;
  });
  await step('review.status', async () => `inReview=${(await call('review.status', { noteId: ids.a })).inReview}`);
  await step('ui.queryCommand / ui.hud', async () => {
    const q = await call('ui.queryCommand', { command: 'ZoomToFit' });
    await call('ui.hud', { message: 'MN Agent Bridge e2e ✓', seconds: 1 });
    return `ZoomToFit disabled=${q.disabled}`;
  });
  await step('note.image on a note without image → NOT_FOUND', () => expectError('NOT_FOUND', () => call('note.image', { noteId: ids.a })));
  await step('note.delete refuses non-empty without recursive', () => expectError('CONFLICT', () => call('note.delete', { noteId: ids.a })));

  if (withUndo) {
    await step('ui.undo removes the last created note', async () => {
      const n = await call('note.create', { parentId: rootId, title: 'to be undone' });
      await call('ui.undo');
      const r = await call('note.batchGet', { noteIds: [n.id] });
      const gone = r.missing.length === 1 || r.notes[0].parentId !== rootId;
      assert(gone, 'note still present after undo');
    });
    await step('batch atomic rollback on failure', async () => {
      try {
        await call('batch', {
          notebookId,
          ops: [
            { action: 'note.create', params: { parentId: rootId, title: 'rollback me' } },
            { action: 'note.get', params: { noteId: 'does-not-exist' } },
          ],
        });
        throw new Error('batch should fail');
      } catch (e) {
        assert(e.code === 'NOT_FOUND' && e.details && e.details.failedIndex === 1, 'failure details ' + JSON.stringify(e.details));
        assert(e.details.rolledBack, 'rolledBack flag');
      }
      const r = await call('note.search', { query: 'rollback me', notebookId });
      assert(r.results.length === 0, 'created note was rolled back');
    });
  }

  await step('notebook.backup + notebook.backups', async () => {
    const b = await call('notebook.backup', { notebookId });
    const list = await call('notebook.backups');
    assert(list.some((x) => x.file === b.file), 'listed');
    return b.file;
  });

  if (!keep) {
    await step('cleanup: note.delete recursive', async () => {
      const r = await call('note.delete', { noteId: rootId, recursive: true });
      const left = await call('note.batchGet', { noteIds: [rootId, ids.a, ids.clone] });
      assert(left.notes.length === 0, 'everything deleted, left ' + left.notes.map((n) => n.id));
      return `${r.descendants} descendants`;
    });
  }
}

await step('auth.clients / bridge.log', async () => {
  const c = await call('auth.clients');
  const log = await call('bridge.log', { limit: 5 });
  return `${c.length} client(s), last action ${log[log.length - 1].action}`;
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
