const ExcelJS = require('exceljs');
const { monthRange } = require('./monthRange');

const PHASE_COLORS = { '1': '2c5f8a', '2': '0e8a74', '3': '7a4fbf', '4': 'd97a00', '5': '2e7d32' };
const phaseColor = wbs => PHASE_COLORS[String(wbs).split('.')[0]] || '51606e';

const STATUS_FILL = { 'Not Started': 'E8ECEF', 'In Progress': 'FDF1DC', 'Complete': 'E2F2E3' };
const STATUS_FONT = { 'Not Started': '51606E', 'In Progress': '9A5B00', 'Complete': '1E6B23' };
const WEIGHT_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' };
const WEIGHT_FILL = { 1: 'E8ECEF', 2: 'E4ECF3', 3: 'FDF1DC' };
const WEIGHT_FONT = { 1: '51606E', 2: '2C5F8A', 3: '9A5B00' };

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function lighten(hex, amount) {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = c => Math.round(c + (255 - c) * amount);
  return [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function buildScheduleWorkbook(rows) {
  const months = monthRange(rows);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NEORide EZData Schedule';
  wb.created = new Date(rows._generatedAt || Date.now());

  const ws = wb.addWorksheet('Schedule', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });

  const fixedCols = [
    { header: 'Phase', key: 'phase', width: 16 },
    { header: 'WBS', key: 'wbs', width: 10 },
    { header: 'Task / Subtask', key: 'title', width: 42 },
    { header: 'Lead', key: 'lead', width: 16 },
    { header: 'Start', key: 'start', width: 12 },
    { header: 'Deadline', key: 'deadline', width: 12 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Weight', key: 'weight', width: 10 },
    { header: '% Complete', key: 'pct', width: 11 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  const monthCols = months.map(mo => {
    const [y, m] = mo.split('-');
    return { header: `${MONTH_NAMES[+m - 1]} ${y.slice(2)}`, key: `m_${mo}`, width: 7 };
  });
  ws.columns = [...fixedCols, ...monthCols];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 10, color: { argb: 'FF51606E' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 28;
  headerRow.eachCell(cell => {
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFD8DEE4' } } };
  });
  ws.getCell(1, 3).alignment = { vertical: 'middle', horizontal: 'left' };

  for (const r of rows) {
    const level = r.wbs.split('.').length;
    const rowData = {
      phase: r.phase, wbs: r.wbs, title: r.title, lead: r.lead || '',
      start: r.start_date || '', deadline: r.deadline || '',
      status: r.status || '', weight: r.is_leaf ? (WEIGHT_LABELS[r.weight] || '') : '',
      pct: r.pct == null ? null : r.pct, notes: r.notes || '',
    };
    const row = ws.addRow(rowData);
    row.alignment = { vertical: 'middle', indent: Math.max(0, Math.min(level - 1, 4)) };
    row.getCell('title').alignment = { vertical: 'middle', indent: Math.max(0, Math.min(level - 1, 4)), wrapText: true };
    row.getCell('notes').alignment = { vertical: 'middle', wrapText: true };
    row.getCell('pct').numFmt = '0%';

    const isParent = !r.is_leaf;
    const isTop = level === 1;
    const rowFill = isTop ? 'FFEFF3F6' : isParent ? 'FFF7F9FA' : null;
    if (rowFill) {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFill } };
      });
      row.font = { bold: true };
    }

    if (r.status) {
      const cell = row.getCell('status');
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (STATUS_FILL[r.status] || 'E8ECEF') } };
      cell.font = { color: { argb: 'FF' + (STATUS_FONT[r.status] || '51606E') }, bold: true, size: 10 };
    }
    if (r.is_leaf && r.weight) {
      const cell = row.getCell('weight');
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (WEIGHT_FILL[r.weight] || 'E8ECEF') } };
      cell.font = { color: { argb: 'FF' + (WEIGHT_FONT[r.weight] || '51606E') }, bold: true, size: 10 };
    }

    // Gantt bar: fill the month columns the task spans with its phase color.
    const startMo = r.start_date ? r.start_date.slice(0, 7) : null;
    const endMo = r.deadline ? r.deadline.slice(0, 7) : null;
    if (startMo && endMo) {
      const color = phaseColor(r.wbs);
      const fillHex = isParent ? lighten(color, 0.55) : color;
      months.forEach(mo => {
        if (mo >= startMo && mo <= endMo) {
          row.getCell(`m_${mo}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + fillHex } };
        }
      });
    }
  }

  months.forEach((mo, i) => {
    if (mo.endsWith('-01')) {
      const colIdx = fixedCols.length + i + 1;
      ws.getColumn(colIdx).eachCell({ includeEmpty: true }, cell => {
        cell.border = { ...(cell.border || {}), left: { style: 'thin', color: { argb: 'FFD8DEE4' } } };
      });
    }
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fixedCols.length } };

  const legend = wb.addWorksheet('Legend');
  legend.columns = [{ header: 'Phase', key: 'k', width: 22 }, { header: 'Color', key: 'v', width: 14 }];
  legend.getRow(1).font = { bold: true };
  const phaseNames = { '1': 'Program Management', '2': 'Planning', '3': 'Design', '4': 'Implementation', '5': 'Final Reporting' };
  Object.entries(PHASE_COLORS).forEach(([num, hex]) => {
    const row = legend.addRow({ k: phaseNames[num], v: '' });
    row.getCell('v').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } };
  });

  return wb.xlsx.writeBuffer();
}

module.exports = { buildScheduleWorkbook };
