// ---------------------------------------------------------------------------
// Markdown outline parser used by `note.importMarkdown`.
//
// Structure comes from ATX headings (# .. ######) and list items (-, *, +, 1.)
// nested by indentation. Every other line is body text of the closest node above
// it. Fenced code blocks and $$ math blocks are kept verbatim as body text.
// ---------------------------------------------------------------------------

function parseMarkdownOutline(md) {
  var lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  var root = { title: '', body: [], children: [], level: 0 };
  var headingStack = [root];
  var listStack = []; // { indent, node }
  var current = root;
  var fence = null; // '```', '~~~' or '$$' while inside a block

  function headingParent(level) {
    while (headingStack.length > 1 && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
    return headingStack[headingStack.length - 1];
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (fence) {
      current.body.push(line);
      if (fence === '$$' ? /\$\$\s*$/.test(line) : line.trim().indexOf(fence) === 0) fence = null;
      continue;
    }
    var trimmed = line.trim();
    var fenceMatch = trimmed.match(/^(```|~~~|\$\$)/);
    if (fenceMatch && !(fenceMatch[1] === '$$' && trimmed.length > 2 && /\$\$$/.test(trimmed.slice(2)))) {
      fence = fenceMatch[1];
      current.body.push(line);
      continue;
    }

    var h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      var node = { title: h[2], body: [], children: [], level: h[1].length };
      headingParent(node.level).children.push(node);
      headingStack.push(node);
      listStack = [];
      current = node;
      continue;
    }

    var li = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      var indent = li[1].replace(/\t/g, '    ').length;
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
      var parent = listStack.length ? listStack[listStack.length - 1].node : headingStack[headingStack.length - 1];
      var item = { title: li[2], body: [], children: [], level: 99 };
      parent.children.push(item);
      listStack.push({ indent: indent, node: item });
      current = item;
      continue;
    }

    // Continuation lines of a list item are indented; strip that indentation.
    if (listStack.length && /^\s+\S/.test(line)) {
      current.body.push(line.replace(/^\s+/, ''));
      continue;
    }
    if (trimmed === '' && listStack.length) {
      current.body.push('');
      continue;
    }
    if (listStack.length && trimmed !== '') {
      // Unindented paragraph after a list belongs to the enclosing heading.
      listStack = [];
      current = headingStack[headingStack.length - 1];
    }
    current.body.push(line);
  }
  return root;
}

function outlineBody(node) {
  return node.body.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
}

function countOutline(nodes) {
  var n = 0;
  nodes.forEach(function (x) { n += 1 + countOutline(x.children); });
  return n;
}
