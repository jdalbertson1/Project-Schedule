const PDFDocument = require('pdfkit');
const { parseDoc } = require('./htmlBlocks');

const INK = '#1b2733';
const INK_SOFT = '#51606e';

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
      doc.moveDown(0.6);
      doc.fontSize(14);
      writeRuns(doc, b.runs.map(r => ({ ...r, bold: true, color: r.color || INK })));
      doc.moveDown(0.3);
    } else if (b.type === 'list') {
      doc.fontSize(11);
      b.items.forEach(runs => {
        doc.font('Helvetica').fillColor(INK).text('•  ', { continued: true, indent: 10 });
        writeRuns(doc, runs);
      });
      doc.moveDown(0.3);
    } else if (b.type === 'paragraph') {
      if (b.runs.some(r => r.text.trim())) {
        doc.fontSize(11);
        writeRuns(doc, b.runs);
        doc.moveDown(0.2);
      }
    }
  }

  doc.end();
  return done;
}

module.exports = { buildMeetingPdf };
