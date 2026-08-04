const { parse } = require('node-html-parser');

// Small, purpose-built HTML -> block model for the meeting doc editor.
// The editor only ever produces h2/h3, ul>li, p/div, and inline b/strong/i/em/
// span[style=color] — this is not a general HTML-to-anything converter.
function parseDoc(html) {
  const root = parse(html || '', { lowerCaseTagName: true });
  const blocks = [];

  // With styleWithCSS enabled (needed so execCommand('foreColor') behaves
  // consistently — see the font/color handling below), the browser also
  // emits bold/italic as inline style ("font-weight: bold" / "font-style:
  // italic") instead of <b>/<i> tags, so these need the same style-attribute
  // fallback as color, not just a tag-name check.
  function styleAttrs(el) {
    const style = el.getAttribute ? el.getAttribute('style') : null;
    if (!style) return {};
    const attrs = {};
    const color = /color:\s*([^;]+)/i.exec(style);
    if (color) attrs.color = color[1].trim();
    if (/font-weight:\s*(bold|[6-9]00)/i.test(style)) attrs.bold = true;
    if (/font-style:\s*italic/i.test(style)) attrs.italic = true;
    return attrs;
  }

  // `node` itself (an <li>/<h2>/<p>/...) can carry formatting directly — e.g.
  // the meeting-mode toggle sets color on the container it creates rather
  // than wrapping a <span> around the text — so seed the walk with node's
  // own style as the base format, not just an empty {}.
  function textRuns(node) {
    const runs = [];
    const baseFmt = styleAttrs(node);
    function walk(n, fmt) {
      if (n.nodeType === 3) {
        const text = n.text; // decoded (rawText leaves entities like &nbsp; un-decoded)
        if (text) runs.push({ text, ...fmt });
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.rawTagName;
      if (tag === 'ul' || tag === 'ol') return; // nested sub-list — collected separately, not merged into this run
      if (tag === 'br') { runs.push({ text: '\n', ...fmt }); return; }
      const nextFmt = { ...fmt };
      if (tag === 'b' || tag === 'strong') nextFmt.bold = true;
      if (tag === 'i' || tag === 'em') nextFmt.italic = true;
      Object.assign(nextFmt, styleAttrs(n));
      // execCommand('foreColor') falls back to legacy <font color="..."> in some browsers/states.
      if (tag === 'font') {
        const colorAttr = n.getAttribute ? n.getAttribute('color') : null;
        if (colorAttr) nextFmt.color = colorAttr.trim();
      }
      (n.childNodes || []).forEach(c => walk(c, nextFmt));
    }
    (node.childNodes || []).forEach(c => walk(c, baseFmt));
    return runs.length ? runs : [{ text: '', ...baseFmt }];
  }

  function cellText(cell) {
    return textRuns(cell).map(r => r.text).join('').replace(/\s+/g, ' ').trim();
  }

  // Walks <li> children of a list, recursing into any nested <ul>/<ol> found
  // inside an <li> (produced by the editor's Tab-to-indent) so each sub-bullet
  // becomes its own item at a deeper level, rather than bleeding into its
  // parent bullet's text.
  function collectListItems(listNode, level, items) {
    const lis = (listNode.childNodes || []).filter(c => c.nodeType === 1 && c.rawTagName === 'li');
    lis.forEach(li => {
      items.push({ runs: textRuns(li), level });
      (li.childNodes || [])
        .filter(c => c.nodeType === 1 && (c.rawTagName === 'ul' || c.rawTagName === 'ol'))
        .forEach(nested => collectListItems(nested, level + 1, items));
    });
  }

  (root.childNodes || []).forEach(node => {
    if (node.nodeType !== 1) return;
    const tag = node.rawTagName;
    if (/^h[1-3]$/.test(tag)) {
      blocks.push({ type: 'heading', level: Number(tag[1]), runs: textRuns(node) });
    } else if (tag === 'ul' || tag === 'ol') {
      const items = [];
      collectListItems(node, 0, items);
      blocks.push({ type: 'list', ordered: tag === 'ol', items });
    } else if (tag === 'table') {
      const theadRow = node.querySelector('thead tr');
      const headers = theadRow ? theadRow.querySelectorAll('th, td').map(cellText) : [];
      const tbodyRows = node.querySelectorAll('tbody tr');
      const bodyRows = tbodyRows.length ? tbodyRows : node.querySelectorAll('tr').filter(tr => tr !== theadRow);
      const rows = bodyRows.map(tr => tr.querySelectorAll('td, th').map(cellText));
      blocks.push({ type: 'table', headers, rows });
    } else if (tag === 'p' || tag === 'div') {
      blocks.push({ type: 'paragraph', runs: textRuns(node) });
    }
  });

  return blocks;
}

module.exports = { parseDoc };
