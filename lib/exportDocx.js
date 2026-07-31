const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType } = require('docx');
const { parseDoc } = require('./htmlBlocks');

function normalizeColor(c) {
  if (!c) return undefined;
  const hex = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) return hex[1].toUpperCase();
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(c.trim());
  if (rgb) return rgb.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
}

function runsToTextRuns(runs) {
  return runs.map(r => new TextRun({
    text: r.text,
    bold: !!r.bold,
    italics: !!r.italic,
    color: normalizeColor(r.color),
  }));
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function buildTable(headers, rows) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(h => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: 'EFF3F6' },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
    })),
  });
  const bodyRows = rows.map(cells => new TableRow({
    children: cells.map(c => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: c, size: 18 })] })],
    })),
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] });
}

async function buildMeetingDocx(meeting) {
  const blocks = parseDoc(meeting.content_html);
  const children = [
    new Paragraph({ text: meeting.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: fmtDate(meeting.meeting_date), spacing: { after: 300 } }),
  ];

  const HEADING_LEVELS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  for (const b of blocks) {
    if (b.type === 'heading') {
      children.push(new Paragraph({
        children: runsToTextRuns(b.runs),
        heading: HEADING_LEVELS[b.level] || HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      }));
    } else if (b.type === 'list') {
      b.items.forEach(item => {
        children.push(new Paragraph({ children: runsToTextRuns(item.runs), bullet: { level: item.level || 0 } }));
      });
    } else if (b.type === 'paragraph') {
      if (b.runs.some(r => r.text.trim())) {
        children.push(new Paragraph({ children: runsToTextRuns(b.runs), spacing: { after: 120 } }));
      }
    } else if (b.type === 'table') {
      children.push(buildTable(b.headers, b.rows));
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

module.exports = { buildMeetingDocx };
