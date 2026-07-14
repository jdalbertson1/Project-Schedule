const { parse } = require('node-html-parser');

// Small, purpose-built HTML -> block model for the meeting doc editor.
// The editor only ever produces h2/h3, ul>li, p/div, and inline b/strong/i/em/
// span[style=color] — this is not a general HTML-to-anything converter.
function parseDoc(html) {
  const root = parse(html || '', { lowerCaseTagName: true });
  const blocks = [];

  function textRuns(node) {
    const runs = [];
    function walk(n, fmt) {
      if (n.nodeType === 3) {
        const text = n.rawText;
        if (text) runs.push({ text, ...fmt });
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.rawTagName;
      if (tag === 'br') { runs.push({ text: '\n', ...fmt }); return; }
      const nextFmt = { ...fmt };
      if (tag === 'b' || tag === 'strong') nextFmt.bold = true;
      if (tag === 'i' || tag === 'em') nextFmt.italic = true;
      const style = n.getAttribute ? n.getAttribute('style') : null;
      if (style) {
        const m = /color:\s*([^;]+)/i.exec(style);
        if (m) nextFmt.color = m[1].trim();
      }
      // execCommand('foreColor') falls back to legacy <font color="..."> in some browsers/states.
      if (tag === 'font') {
        const colorAttr = n.getAttribute ? n.getAttribute('color') : null;
        if (colorAttr) nextFmt.color = colorAttr.trim();
      }
      (n.childNodes || []).forEach(c => walk(c, nextFmt));
    }
    (node.childNodes || []).forEach(c => walk(c, {}));
    return runs.length ? runs : [{ text: '' }];
  }

  function cellText(cell) {
    return textRuns(cell).map(r => r.text).join('').replace(/\s+/g, ' ').trim();
  }

  (root.childNodes || []).forEach(node => {
    if (node.nodeType !== 1) return;
    const tag = node.rawTagName;
    if (/^h[1-3]$/.test(tag)) {
      blocks.push({ type: 'heading', level: Number(tag[1]), runs: textRuns(node) });
    } else if (tag === 'ul' || tag === 'ol') {
      const items = (node.childNodes || []).filter(c => c.nodeType === 1 && c.rawTagName === 'li');
      blocks.push({ type: 'list', ordered: tag === 'ol', items: items.map(li => textRuns(li)) });
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
