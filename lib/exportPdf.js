const PDFDocument = require('pdfkit');
const { parseDoc } = require('./htmlBlocks');

const INK = '#1b2733';
const INK_SOFT = '#51606e';
const LINE = '#d8dee4';
const HEADER_FILL = '#eff3f6';
const TABLE_FONT_SIZE = 8.5;
const CELL_PAD = 4;

// PDFKit has no table primitive — this draws a simple bordered grid,
// auto-sizing columns from content length and paginating when a row
// would overflow the current page.
function drawTable(doc, headers, rows) {
  const startX = doc.page.margins.left;
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const n = headers.length;
  const maxLens = headers.map((h, i) => Math.max(String(h).length, ...rows.map(r => String(r[i] || '').length), 3));
  const total = maxLens.reduce((a, b) => a + b, 0) || n;
  const minWidth = availableWidth * 0.05;
  const rawWidths = maxLens.map(len => Math.max(minWidth, (len / total) * availableWidth));
  const rawSum = rawWidths.reduce((a, b) => a + b, 0);
  const colWidths = rawWidths.map(w => (w * availableWidth) / rawSum);

  function rowHeight(cells) {
    doc.fontSize(TABLE_FONT_SIZE);
    return Math.max(...cells.map((c, i) => doc.heightOfString(String(c ?? ''), { width: colWidths[i] - CELL_PAD * 2 }))) + CELL_PAD * 2;
  }

  function drawRow(cells, isHeader) {
    const h = rowHeight(cells);
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const rowY = doc.y;
    if (isHeader) doc.rect(startX, rowY, availableWidth, h).fill(HEADER_FILL);
    let x = startX;
    cells.forEach((c, i) => {
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(TABLE_FONT_SIZE).fillColor(INK);
      doc.text(String(c ?? ''), x + CELL_PAD, rowY + CELL_PAD, { width: colWidths[i] - CELL_PAD * 2 });
      x += colWidths[i];
    });
    doc.rect(startX, rowY, availableWidth, h).lineWidth(0.5).strokeColor(LINE).stroke();
    let bx = startX;
    for (let i = 0; i < colWidths.length - 1; i++) {
      bx += colWidths[i];
      doc.moveTo(bx, rowY).lineTo(bx, rowY + h).lineWidth(0.5).strokeColor(LINE).stroke();
    }
    doc.y = rowY + h;
  }

  drawRow(headers, true);
  rows.forEach(r => drawRow(r, false));
  doc.moveDown(0.6);
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function writeRuns(doc, runs, firstOpts = {}) {
  const parts = runs.filter(r => r.text != null && r.text !== '');
  if (!parts.length) { doc.text('', firstOpts); return; }
  parts.forEach((r, i) => {
    const isLast = i === parts.length - 1;
    doc.font(r.bold ? 'Helvetica-Bold' : (r.italic ? 'Helvetica-Oblique' : 'Helvetica'));
    doc.fillColor(r.color || INK);
    doc.text(r.text, { continued: !isLast, ...(i === 0 ? firstOpts : {}) });
  });
  doc.fillColor(INK).font('Helvetica');
}

async function buildMeetingPdf(meeting) {
  const blocks = parseDoc(meeting.content_html);
  const doc = new PDFDocument({ margin: 54, autoFirstPage: true });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(20).font('Helvetica-Bold').fillColor(INK).text(meeting.title);
  doc.fontSize(11).font('Helvetica').fillColor(INK_SOFT).text(fmtDate(meeting.meeting_date));
  doc.moveDown(1);

  for (const b of blocks) {
    if (b.type === 'heading') {
      const HEADING_SIZES = { 1: 18, 2: 14, 3: 12 };
      doc.moveDown(b.level <= 2 ? 0.6 : 0.4);
      doc.fontSize(HEADING_SIZES[b.level] || 14);
      writeRuns(doc, b.runs.map(r => ({ ...r, bold: true, color: r.color || INK })));
      doc.moveDown(0.3);
    } else if (b.type === 'list') {
      doc.fontSize(11);
      b.items.forEach(item => {
        const level = item.level || 0;
        // Helvetica's standard WinAnsi encoding only reliably covers '•' and '-' among bullet-like glyphs.
        const bulletChar = level === 0 ? '•' : '-';
        doc.font('Helvetica').fillColor(INK).text(`${bulletChar}  `, { continued: true, indent: 10 + level * 16 });
        writeRuns(doc, item.runs);
      });
      doc.moveDown(0.3);
    } else if (b.type === 'paragraph') {
      if (b.runs.some(r => r.text.trim())) {
        doc.fontSize(11);
        writeRuns(doc, b.runs);
        doc.moveDown(0.2);
      }
    } else if (b.type === 'table') {
      drawTable(doc, b.headers, b.rows);
    }
  }

  doc.end();
  return done;
}

module.exports = { buildMeetingPdf };
