// Parses a schedule CSV or XLSX file back into task rows, matching the exact
// column shape /api/export.csv and /api/export.xlsx already produce — the
// export IS the template; no separate format to maintain.

const ExcelJS = require('exceljs');

const EXPECTED_HEADERS = ['Phase', 'WBS', 'Task / Subtask', 'Lead', 'Start Date', 'Deadline', 'Status', 'Weight (days)', '% Complete', 'Notes'];
const STATUSES = ['Not Started', 'In Progress', 'Complete'];

// Hand-rolled RFC4180 parser — handles quoted fields containing commas,
// escaped quotes (""), and embedded newlines, matching how /api/export.csv
// escapes fields on the way out.
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // swallow; \r\n handled by the following \n, bare \r treated as a row break
      if (text[i + 1] !== '\n') pushRow();
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) pushRow();
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

function parsePct(raw) {
  if (raw == null || raw === '') return null;
  const n = parseFloat(String(raw).replace('%', '').trim());
  return Number.isNaN(n) ? null : n / 100;
}

function normalizeStatus(raw, pct) {
  const s = String(raw || '').trim();
  if (STATUSES.includes(s)) return s;
  if (pct == null) return 'Not Started';
  if (pct >= 1) return 'Complete';
  if (pct > 0) return 'In Progress';
  return 'Not Started';
}

// headerRow: array of header strings from row 1. Maps by name (trimmed,
// case-insensitive) rather than fixed position, so column order/extra
// columns don't break import. Takes a list of accepted names per field
// since the CSV and XLSX exports don't use identical headers for every
// column (XLSX labels the start-date column "Start", CSV uses "Start Date").
function columnIndex(headerRow, names) {
  const candidates = (Array.isArray(names) ? names : [names]).map(n => n.toLowerCase());
  return headerRow.findIndex(h => candidates.includes(String(h || '').trim().toLowerCase()));
}

function rowsToTasks(headerRow, dataRows) {
  const idx = {
    phase: columnIndex(headerRow, 'Phase'),
    wbs: columnIndex(headerRow, 'WBS'),
    title: columnIndex(headerRow, 'Task / Subtask'),
    lead: columnIndex(headerRow, 'Lead'),
    start: columnIndex(headerRow, ['Start Date', 'Start']),
    deadline: columnIndex(headerRow, 'Deadline'),
    status: columnIndex(headerRow, 'Status'),
    pct: columnIndex(headerRow, '% Complete'),
    notes: columnIndex(headerRow, 'Notes'),
  };
  const missing = ['phase', 'wbs', 'title'].filter(k => idx[k] === -1);
  if (missing.length) {
    throw new Error(`Missing required column(s): ${missing.map(k => ({ phase: 'Phase', wbs: 'WBS', title: 'Task / Subtask' }[k])).join(', ')}. Expected headers: ${EXPECTED_HEADERS.join(', ')}`);
  }

  const get = (row, i) => (i === -1 ? '' : (row[i] == null ? '' : String(row[i]).trim()));

  return dataRows
    .filter(row => row.some(v => v != null && String(v).trim() !== ''))
    .map((row, i) => {
      const phase = get(row, idx.phase);
      const wbs = get(row, idx.wbs);
      const title = get(row, idx.title);
      if (!phase || !wbs || !title) {
        throw new Error(`Row ${i + 2}: Phase, WBS, and Task / Subtask are all required.`);
      }
      const pct = parsePct(get(row, idx.pct));
      return {
        phase, wbs, title,
        lead: get(row, idx.lead) || null,
        start_date: get(row, idx.start) || null,
        deadline: get(row, idx.deadline) || null,
        status: normalizeStatus(get(row, idx.status), pct),
        pct: pct == null ? 0 : pct,
        notes: get(row, idx.notes) || null,
        sort: i,
      };
    });
}

function parseScheduleCsv(text) {
  const rows = parseCsvText(text);
  if (!rows.length) throw new Error('The file is empty.');
  const [headerRow, ...dataRows] = rows;
  return rowsToTasks(headerRow, dataRows);
}

async function parseScheduleXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheets.');
  const rows = [];
  ws.eachRow(row => {
    // .values is 1-indexed with a leading empty slot — drop it.
    rows.push(row.values.slice(1).map(v => (v && v.text !== undefined ? v.text : v)));
  });
  if (!rows.length) throw new Error('The sheet is empty.');
  const [headerRow, ...dataRows] = rows;
  return rowsToTasks(headerRow, dataRows);
}

module.exports = { EXPECTED_HEADERS, parseScheduleCsv, parseScheduleXlsx };
