// NEORide EZData Schedule - web app replacement for EZData_Schedule.xlsm
// Replicates the workbook's rollup formulas and the SubmitTask VBA macro as a REST API.

const express = require('express');
const path = require('path');
const { query, init, usePg } = require('./db');
const { buildScheduleWorkbook } = require('./lib/exportXlsx');
const { buildMeetingDocx } = require('./lib/exportDocx');
const { buildMeetingPdf } = require('./lib/exportPdf');
const dropbox = require('./lib/dropbox');
const bigtime = require('./lib/bigtime');
const aiTaskFill = require('./lib/aiTaskFill');
const { computeMove } = require('./lib/taskMove');

const app = express();
app.use(express.json());

// ---- CORS for external API clients (set API_KEY below to actually gate access) ----
// Only relevant to browser-hosted consumers on a different origin — server-to-
// server calls aren't subject to CORS at all. Defaults to open since the real
// access boundary is the API key, not the origin (no cookies/credentials are
// involved, so a permissive origin here doesn't widen what an attacker can do).
// Set CORS_ORIGIN to a comma-separated allowlist to lock it down further.
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '*').split(',').map(o => o.trim());
app.use('/api', (req, res, next) => {
  const origin = req.get('Origin');
  if (CORS_ORIGINS.includes('*')) {
    res.set('Access-Control-Allow-Origin', '*');
  } else if (origin && CORS_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function checkApiKey(req) {
  if (!process.env.API_KEY) return false;
  const header = req.get('Authorization') || '';
  const bearer = header.replace(/^Bearer\s+/i, '');
  const provided = req.get('X-API-Key') || bearer;
  return !!provided && provided === process.env.API_KEY;
}

// ---- Optional password protection for the web UI (set APP_PASSWORD in Railway variables) ----
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    // Programmatic clients can use an API key instead of the browser-oriented
    // Basic Auth prompt — see the API_KEY block below for the case where
    // there's no APP_PASSWORD at all.
    if (req.path.startsWith('/api/') && checkApiKey(req)) return next();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Basic ')
      ? Buffer.from(header.slice(6), 'base64').toString()
      : '';
    const [, pass] = token.split(':');
    if (pass === process.env.APP_PASSWORD) return next();
    res.set('WWW-Authenticate', 'Basic realm="EZData Schedule"');
    return res.status(401).send('Authentication required');
  });
}

// ---- Optional API key protection for programmatic /api/* access ----
// Independent of APP_PASSWORD — lets you require a key for the API even when
// the web UI itself is left open. If APP_PASSWORD is also set, the key is
// already accepted as an alternative in the middleware above; this block only
// runs when there's no APP_PASSWORD, so /api/* still gets gated on its own.
if (process.env.API_KEY && !process.env.APP_PASSWORD) {
  app.use('/api', (req, res, next) => {
    if (checkApiKey(req)) return next();
    res.status(401).json({ error: 'Missing or invalid API key.' });
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Core schedule logic (port of the workbook's hidden helper columns + rollups)
// ---------------------------------------------------------------------------

const STATUSES = ['Not Started', 'In Progress', 'Complete'];

function statusFromPct(pct) {
  if (pct >= 1) return 'Complete';
  if (pct > 0) return 'In Progress';
  return 'Not Started';
}

// Weight = how many days a task spans (inclusive), minimum 1. A 1-day task
// counts for 1 toward its parent's rollup; a 1000-day task counts for 1000 —
// so being 1% through a year-long task moves the needle more than finishing
// a one-off small task does. Purely derived from dates, never stored.
function computeWeight(startDate, deadline) {
  if (!startDate || !deadline) return 1;
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(deadline + 'T00:00:00Z');
  const days = Math.round((end - start) / 86400000) + 1;
  return Math.max(1, days);
}

function wbsLevel(wbs) {
  return wbs.split('.').length;
}

// Returns all tasks (sorted) with computed fields:
// is_leaf, and for parent rows: rolled-up start/deadline/pct/status.
async function computedTasks() {
  const rows = await query('SELECT * FROM tasks ORDER BY sort ASC');
  const wbsList = rows.map(r => r.wbs);

  for (const r of rows) {
    r.pct = r.pct === null || r.pct === undefined ? null : Number(r.pct);
    r.weight = computeWeight(r.start_date, r.deadline);
    const prefix = r.wbs + '.';
    r.is_leaf = !wbsList.some(w => w.startsWith(prefix));
  }

  for (const r of rows) {
    if (r.is_leaf) {
      if (r.pct === null) r.pct = 0;
      if (!r.status) r.status = statusFromPct(r.pct);
      // Complete and 100% always travel together, whichever one was set.
      if (r.status === 'Complete') r.pct = 1;
      if (r.pct >= 1) r.status = 'Complete';
      continue;
    }
    // Parent: roll up from leaf descendants (same as MIN/MAX/SUMPRODUCT formulas),
    // weighted so a recurring/large line item counts for more than a one-off small one.
    const prefix = r.wbs + '.';
    const leaves = rows.filter(x => x.is_leaf && x.wbs.startsWith(prefix));
    if (leaves.length) {
      const starts = leaves.map(l => l.start_date).filter(Boolean).sort();
      const ends = leaves.map(l => l.deadline).filter(Boolean).sort();
      r.start_date = starts[0] || null;
      r.deadline = ends[ends.length - 1] || null;
      const totalWeight = leaves.reduce((s, l) => s + l.weight, 0);
      r.pct = leaves.reduce((s, l) => s + (l.pct || 0) * l.weight, 0) / totalWeight;
      r.status = statusFromPct(r.pct);
    }
  }
  return rows;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Leaf tasks due within 14 days of `asOf` (inclusive) that aren't complete yet.
// This is the strict "due soon" definition — used for the dashboard's "due
// next 14 days" count specifically, so that stat stays literally accurate.
function dueSoonSnapshot(rows, asOf) {
  const horizon = addDays(asOf, 14);
  return rows.filter(r => r.is_leaf)
    .filter(l => l.deadline && l.deadline >= asOf && l.deadline <= horizon && (l.pct || 0) < 1);
}

// Everything worth reviewing as of `asOf`: due-soon items, PLUS any task
// that's actively "In Progress" regardless of its deadline — overdue-but-
// in-progress and far-future-but-in-progress tasks both belong here, since
// whoever owns them can give an update either way, not just when the
// deadline happens to be close. Used by both the dashboard ("Near-term
// actions") and meeting agendas (the "upcoming two weeks" snapshot as of the
// meeting date).
function nearTermSnapshot(rows, asOf) {
  const dueSoon = dueSoonSnapshot(rows, asOf);
  const inProgress = rows.filter(r => r.is_leaf && r.status === 'In Progress' && (r.pct || 0) < 1);
  const seen = new Set();
  const combined = [];
  for (const l of [...dueSoon, ...inProgress]) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    combined.push(l);
  }
  const FAR_FUTURE = '9999-12-31';
  return combined.sort((a, b) => (a.deadline || FAR_FUTURE).localeCompare(b.deadline || FAR_FUTURE));
}

// Dashboard-only: near-term items (due soon + in progress) PLUS anything
// overdue and incomplete, so nothing disappears now that there's no separate
// "Overdue" table — the client marks these rows with a red deadline instead.
// Meeting agendas intentionally keep using nearTermSnapshot() alone (the
// "upcoming two weeks & in-progress" table's own defined scope).
function dashboardActionItems(rows, asOf) {
  const base = nearTermSnapshot(rows, asOf);
  const overdue = rows.filter(r => r.is_leaf && r.deadline && r.deadline < asOf && (r.pct || 0) < 1);
  const seen = new Set(base.map(l => l.id));
  const combined = [...base, ...overdue.filter(l => !seen.has(l.id))];
  const FAR_FUTURE = '9999-12-31';
  return combined.sort((a, b) => (a.deadline || FAR_FUTURE).localeCompare(b.deadline || FAR_FUTURE));
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDateLong(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// The "upcoming two weeks" table alone — same columns as the dashboard's
// near-term-actions table. Split out from buildAgendaHtml so it can also be
// used to refresh just this table inside an already-created meeting's saved
// content_html (see syncFutureMeetingSnapshots below).
function buildSnapshotTable(rows, meetingDate) {
  const snapshot = nearTermSnapshot(rows, meetingDate);
  const tableBody = snapshot.length
    ? snapshot.map(l => `<tr>
        <td>${escHtml(l.wbs)}</td>
        <td>${escHtml(l.title)}</td>
        <td>${escHtml(l.lead || '')}</td>
        <td>${escHtml(fmtDateLong(l.start_date))}</td>
        <td>${escHtml(fmtDateLong(l.deadline))}</td>
        <td>${escHtml(l.status || '')}</td>
        <td>${Math.round((l.pct || 0) * 100)}%</td>
        <td>${escHtml(l.notes || '')}</td>
      </tr>`).join('')
    : '<tr><td colspan="8"><em>Nothing due in the next two weeks.</em></td></tr>';
  return `<table><thead><tr><th>WBS</th><th>Task / Subtask</th><th>Lead</th><th>Start</th><th>Deadline</th><th>Status</th><th>%</th><th>Notes</th></tr></thead><tbody>${tableBody}</tbody></table>`;
}

// The starting document for a new agenda: an EZData section with a snapshot
// of what's due in the next two weeks (as of the chosen meeting date)
// rendered as a table, plus an empty discussion-items list, followed by a
// second section for NEORide Technology On-Call Projects with just a
// discussion placeholder.
function buildAgendaHtml(rows, meetingDate) {
  const table = buildSnapshotTable(rows, meetingDate);
  return `<h2>EZData</h2>`
    + `<h3>Upcoming two weeks & in-progress items (as of ${escHtml(fmtDateLong(meetingDate))})</h3>${table}`
    + `<h3>Discussion items</h3><ul><li><br></li></ul>`
    + `<h2>NEORide Technology On-Call Projects</h2>`
    + `<h3>Discussion items</h3><ul><li><br></li></ul>`;
}

// Refreshes the "upcoming two weeks" table inside every meeting whose date
// hasn't passed yet — called after any schedule change. Meetings in the past
// are historical records and are never touched. Only the first <table> in
// the saved content_html is replaced; everything else the user added
// (discussion items, notes, formatting, the On-Call section) is untouched.
// If the user deleted the table entirely, we leave it deleted rather than
// re-inserting one.
async function syncFutureMeetingSnapshots() {
  const today = todayISO();
  const meetings = await query('SELECT * FROM meetings WHERE meeting_date >= ?', [today]);
  if (!meetings.length) return;
  const rows = await computedTasks();
  const now = new Date().toISOString();
  for (const m of meetings) {
    if (!/<table>/.test(m.content_html || '')) continue;
    const newTable = buildSnapshotTable(rows, m.meeting_date);
    const updated = m.content_html.replace(/<table>[\s\S]*?<\/table>/, newTable);
    if (updated !== m.content_html) {
      await query('UPDATE meetings SET content_html = ?, updated_at = ? WHERE id = ?', [updated, now, m.id]);
    }
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.get('/api/schedule', async (req, res, next) => {
  try {
    res.json(await computedTasks());
  } catch (e) { next(e); }
});

app.get('/api/dashboard', async (req, res, next) => {
  try {
    const rows = await computedTasks();
    const leaves = rows.filter(r => r.is_leaf);
    const today = todayISO();
    const dueSoonCount = dueSoonSnapshot(rows, today).length;
    const nearTerm = dashboardActionItems(rows, today);

    const phases = rows.filter(r => !r.wbs.includes('.')).map(p => ({
      wbs: p.wbs, title: p.title, phase: p.phase,
      start_date: p.start_date, deadline: p.deadline,
      status: p.status, pct: p.pct,
    }));

    const overallWeight = leaves.reduce((s, l) => s + l.weight, 0);
    res.json({
      today,
      overall_pct: overallWeight ? leaves.reduce((s, l) => s + (l.pct || 0) * l.weight, 0) / overallWeight : 0,
      due_next_14: dueSoonCount,
      in_progress: leaves.filter(l => l.status === 'In Progress').length,
      complete: leaves.filter(l => l.status === 'Complete').length,
      total_leaves: leaves.length,
      phases,
      near_term: nearTerm,
      overdue: leaves.filter(l => l.deadline && l.deadline < today && (l.pct || 0) < 1)
        .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    });
  } catch (e) { next(e); }
});

// Dropdown options (replaces the hidden Lists sheet - derived live from the data)
app.get('/api/lists', async (req, res, next) => {
  try {
    const rows = await computedTasks();
    const leads = [...new Set(rows.map(r => r.lead).filter(Boolean))].sort();
    const topLevel = rows.filter(r => wbsLevel(r.wbs) === 1)
      .map(r => ({ wbs: r.wbs, title: r.title }));
    const subtasks = rows.filter(r => wbsLevel(r.wbs) === 2 && !r.is_leaf)
      .map(r => ({ wbs: r.wbs, title: r.title, top: r.wbs.split('.')[0] }));
    res.json({ statuses: STATUSES, leads, topLevel, subtasks });
  } catch (e) { next(e); }
});

app.get('/api/ai/status', (req, res) => {
  res.json({ configured: aiTaskFill.isConfigured() });
});

app.post('/api/ai/parse-task', async (req, res, next) => {
  try {
    const transcript = String((req.body && req.body.transcript) || '').trim();
    if (!transcript) return res.status(400).json({ error: 'Say or type a statement first.' });
    const rows = await computedTasks();
    const topLevel = rows.filter(r => wbsLevel(r.wbs) === 1).map(r => ({ wbs: r.wbs, title: r.title }));
    const subtasks = rows.filter(r => wbsLevel(r.wbs) === 2 && !r.is_leaf).map(r => ({ wbs: r.wbs, title: r.title, top: r.wbs.split('.')[0] }));
    const leads = [...new Set(rows.map(r => r.lead).filter(Boolean))].sort();
    const fields = await aiTaskFill.parseTaskStatement(transcript, { today: todayISO(), topLevel, subtasks, leads });
    res.json(fields);
  } catch (e) { next(e); }
});

// ---- SubmitTask macro, ported ----
// Body: { topLevelWbs, existingSubtaskWbs?, newSubtaskTitle?, title, lead,
//         startDate, deadline, status?, pct?, notes? }
app.post('/api/tasks', async (req, res, next) => {
  try {
    const b = req.body || {};
    const clean = v => (v == null ? '' : String(v).trim());
    const topLevelWbs = clean(b.topLevelWbs);
    const existingWbs = clean(b.existingSubtaskWbs);
    const newSubTitle = clean(b.newSubtaskTitle);
    const title = clean(b.title);
    let lead = clean(b.lead) || 'TBD';
    const notes = clean(b.notes);
    const startDate = clean(b.startDate);
    const deadline = clean(b.deadline);

    if (!topLevelWbs) return res.status(400).json({ error: 'Select a top-level task.' });
    if (!title) return res.status(400).json({ error: 'Enter a task / line item title.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return res.status(400).json({ error: 'Enter a valid start date.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return res.status(400).json({ error: 'Enter a valid deadline.' });
    if (deadline < startDate) return res.status(400).json({ error: 'Deadline cannot be earlier than start date.' });

    let pct = b.pct === '' || b.pct == null ? 0 : Number(b.pct);
    if (Number.isNaN(pct)) pct = 0;
    if (pct > 1) pct = pct / 100;
    pct = Math.min(1, Math.max(0, pct));
    let status = clean(b.status) || statusFromPct(pct);
    // Complete and 100% always travel together, whichever one was set.
    if (status === 'Complete') pct = 1;
    if (pct >= 1) status = 'Complete';

    const rows = await query('SELECT * FROM tasks ORDER BY sort ASC');
    const top = rows.find(r => r.wbs === topLevelWbs);
    if (!top) return res.status(400).json({ error: 'The selected top-level task was not found.' });
    const phase = top.phase;

    // helpers mirroring the VBA functions
    const nextChildNumber = (parentWbs) => {
      const prefix = parentWbs + '.';
      const lvl = wbsLevel(parentWbs) + 1;
      let max = 0;
      for (const r of rows) {
        if (r.wbs.startsWith(prefix) && wbsLevel(r.wbs) === lvl) {
          const num = parseInt(r.wbs.slice(prefix.length).split('.')[0], 10);
          if (!Number.isNaN(num) && num > max) max = num;
        }
      }
      return max + 1;
    };
    // insert position: index just after the contiguous block belonging to blockWbs
    const endOfBlock = (blockWbs) => {
      const startIdx = rows.findIndex(r => r.wbs === blockWbs);
      if (startIdx === -1) return rows.length;
      let end = startIdx;
      const prefix = blockWbs + '.';
      for (let i = startIdx + 1; i < rows.length; i++) {
        if (rows[i].wbs.startsWith(prefix)) end = i; else break;
      }
      return end + 1;
    };

    const inserts = []; // { sortIndex, row }
    let newWbs;

    if (newSubTitle) {
      // Create a new parent subtask under the top-level task, then the line item under it
      const parentWbs = `${topLevelWbs}.${nextChildNumber(topLevelWbs)}`;
      const at = endOfBlock(topLevelWbs);
      inserts.push({ at, row: { phase, wbs: parentWbs, title: newSubTitle, lead, start_date: null, deadline: null, status: null, pct: null, notes: 'User-created subtask.' } });
      newWbs = `${parentWbs}.1`;
      inserts.push({ at: at + 1, row: { phase, wbs: newWbs, title, lead, start_date: startDate, deadline, status, pct, notes } });
    } else if (existingWbs) {
      if (!existingWbs.startsWith(topLevelWbs + '.')) {
        return res.status(400).json({ error: 'The selected existing subtask does not belong to that top-level task.' });
      }
      newWbs = `${existingWbs}.${nextChildNumber(existingWbs)}`;
      inserts.push({ at: endOfBlock(existingWbs), row: { phase, wbs: newWbs, title, lead, start_date: startDate, deadline, status, pct, notes } });
    } else {
      newWbs = `${topLevelWbs}.${nextChildNumber(topLevelWbs)}`;
      inserts.push({ at: endOfBlock(topLevelWbs), row: { phase, wbs: newWbs, title, lead, start_date: startDate, deadline, status, pct, notes } });
    }

    // Apply inserts (shift sort values, then insert)
    for (const ins of inserts) {
      const sortAt = ins.at < rows.length ? rows[ins.at].sort : (rows.length ? rows[rows.length - 1].sort + 1 : 0);
      await query('UPDATE tasks SET sort = sort + 1 WHERE sort >= ?', [sortAt]);
      await query(
        `INSERT INTO tasks (phase, wbs, title, lead, start_date, deadline, status, pct, notes, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ins.row.phase, ins.row.wbs, ins.row.title, ins.row.lead, ins.row.start_date,
         ins.row.deadline, ins.row.status, ins.row.pct, ins.row.notes, sortAt]
      );
      // keep local copy consistent for the second insert
      rows.splice(ins.at, 0, { ...ins.row, sort: sortAt });
      for (let i = ins.at + 1; i < rows.length; i++) rows[i].sort += 1;
    }

    await syncFutureMeetingSnapshots();
    res.status(201).json({ ok: true, wbs: newWbs });
  } catch (e) { next(e); }
});

// Update a task (leaf fields). Status auto-derives from % when not supplied.
app.patch('/api/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await query('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Task not found.' });
    const b = req.body || {};

    const fields = {};
    for (const k of ['title', 'lead', 'notes', 'phase']) {
      if (b[k] !== undefined) fields[k] = String(b[k]).trim();
    }
    for (const k of ['startDate', 'deadline']) {
      if (b[k] !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b[k])) return res.status(400).json({ error: `Invalid ${k}.` });
        fields[k === 'startDate' ? 'start_date' : 'deadline'] = b[k];
      }
    }
    if (b.pct !== undefined) {
      let pct = Number(b.pct);
      if (Number.isNaN(pct)) return res.status(400).json({ error: 'Invalid % complete.' });
      if (pct > 1) pct = pct / 100;
      fields.pct = Math.min(1, Math.max(0, pct));
      if (b.status === undefined) fields.status = statusFromPct(fields.pct);
    }
    if (b.status !== undefined && b.status !== '') {
      if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Invalid status.' });
      fields.status = b.status;
    }

    // Complete and 100% always travel together, whichever one was set — if
    // they conflict (both submitted at once with different values), whichever
    // rule runs last below wins, so 100% always beats a stale non-Complete
    // status submitted alongside it.
    const effectiveStatus = fields.status !== undefined ? fields.status : existing[0].status;
    if (effectiveStatus === 'Complete') fields.pct = 1;
    const finalPct = fields.pct !== undefined ? fields.pct : existing[0].pct;
    if (finalPct >= 1) fields.status = 'Complete';

    const start = fields.start_date ?? existing[0].start_date;
    const end = fields.deadline ?? existing[0].deadline;
    if (start && end && end < start) return res.status(400).json({ error: 'Deadline cannot be earlier than start date.' });

    const keys = Object.keys(fields);
    if (!keys.length) return res.json({ ok: true });
    const setSql = keys.map(k => `${k} = ?`).join(', ');
    await query(`UPDATE tasks SET ${setSql} WHERE id = ?`, [...keys.map(k => fields[k]), id]);
    await syncFutureMeetingSnapshots();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Delete a task; ?cascade=1 also deletes its children.
app.delete('/api/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await query('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Task not found.' });
    const wbs = existing[0].wbs;
    const rows = await query('SELECT * FROM tasks');
    const children = rows.filter(r => r.wbs.startsWith(wbs + '.'));
    if (children.length && req.query.cascade !== '1') {
      return res.status(400).json({ error: `This task has ${children.length} sub-item(s). Delete them first or confirm cascade delete.`, has_children: true });
    }
    for (const c of children) await query('DELETE FROM tasks WHERE id = ?', [c.id]);
    await query('DELETE FROM tasks WHERE id = ?', [id]);
    await syncFutureMeetingSnapshots();
    res.json({ ok: true, deleted: 1 + children.length });
  } catch (e) { next(e); }
});

// Drag-and-drop restructuring: move a task (and its whole subtree, if it has
// one) before, after, or inside another task. WBS numbers, sort order, and
// phase inheritance are fully recomputed — rollups/Gantt position/is_leaf
// status all update for free since those are derived from wbs on every read.
// Body: { targetId, position: 'before' | 'after' | 'into' }
app.post('/api/tasks/:id/move', async (req, res, next) => {
  try {
    const draggedId = Number(req.params.id);
    const targetId = Number(req.body && req.body.targetId);
    const position = req.body && req.body.position;
    if (!targetId) return res.status(400).json({ error: 'Missing drop target.' });

    const rows = await query('SELECT * FROM tasks');
    const result = computeMove(rows, draggedId, targetId, position);
    if (result.error) return res.status(400).json({ error: result.error });

    for (const [id, change] of result.changes) {
      await query('UPDATE tasks SET wbs = ?, sort = ?, phase = ? WHERE id = ?', [change.wbs, change.sort, change.phase, id]);
    }
    await syncFutureMeetingSnapshots();
    res.json({ ok: true, changed: result.changes.size });
  } catch (e) { next(e); }
});

// Quick-add a task directly on the schedule (the "+" between rows). The new
// row's level/WBS is entirely determined by where it's dropped — it becomes
// a sibling of the target row, inserted immediately before/after it — reusing
// the exact same renumbering engine as drag-and-drop by treating the fresh
// row as a "move" of a placeholder into position right after insert.
// Body: { targetId, position: 'before' | 'after', title, lead?, startDate, deadline, notes? }
app.post('/api/tasks/insert', async (req, res, next) => {
  let placeholderId = null;
  try {
    const b = req.body || {};
    const targetId = Number(b.targetId);
    const position = b.position;
    const clean = v => (v == null ? '' : String(v).trim());
    const title = clean(b.title);
    const lead = clean(b.lead);
    const notes = clean(b.notes);
    const startDate = clean(b.startDate);
    const deadline = clean(b.deadline);

    if (!targetId || !['before', 'after'].includes(position)) {
      return res.status(400).json({ error: 'Missing or invalid drop position.' });
    }
    if (!title) return res.status(400).json({ error: 'Enter a task title.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return res.status(400).json({ error: 'Enter a valid start date.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return res.status(400).json({ error: 'Enter a valid deadline.' });
    if (deadline < startDate) return res.status(400).json({ error: 'Deadline cannot be earlier than start date.' });

    // Sentinel wbs guaranteed not to prefix-match any real (numeric) wbs, so
    // computeMove sees this as a fresh leaf with no children of its own.
    // phase/sort are placeholders too — computeMove recomputes both for
    // every row it touches, including this one.
    const inserted = await query(
      `INSERT INTO tasks (phase, wbs, title, lead, start_date, deadline, status, pct, notes, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ${usePg ? 'RETURNING id' : ''}`,
      ['', '__new__', title, lead, startDate, deadline, 'Not Started', 0, notes, -1]
    );
    if (usePg) {
      placeholderId = inserted[0].id;
    } else {
      const latest = await query('SELECT id FROM tasks ORDER BY id DESC LIMIT 1');
      placeholderId = latest[0].id;
    }

    const rows = await query('SELECT * FROM tasks');
    const result = computeMove(rows, placeholderId, targetId, position);
    if (result.error) {
      await query('DELETE FROM tasks WHERE id = ?', [placeholderId]);
      return res.status(400).json({ error: result.error });
    }

    for (const [id, change] of result.changes) {
      await query('UPDATE tasks SET wbs = ?, sort = ?, phase = ? WHERE id = ?', [change.wbs, change.sort, change.phase, id]);
    }
    await syncFutureMeetingSnapshots();
    const finalWbs = result.changes.get(placeholderId)?.wbs;
    res.status(201).json({ ok: true, id: placeholderId, wbs: finalWbs });
  } catch (e) {
    if (placeholderId != null) await query('DELETE FROM tasks WHERE id = ?', [placeholderId]).catch(() => {});
    next(e);
  }
});

// CSV export of the computed schedule
app.get('/api/export.csv', async (req, res, next) => {
  try {
    const rows = await computedTasks();
    const esc = v => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = 'Phase,WBS,Task / Subtask,Lead,Start Date,Deadline,Status,Weight (days),% Complete,Notes';
    const lines = rows.map(r => [
      r.phase, r.wbs, r.title, r.lead, r.start_date, r.deadline, r.status,
      r.is_leaf ? r.weight : '',
      r.pct == null ? '' : Math.round(r.pct * 1000) / 10 + '%', r.notes,
    ].map(esc).join(','));
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="EZData_Schedule.csv"');
    res.send([header, ...lines].join('\n'));
  } catch (e) { next(e); }
});

// Excel export — mirrors the on-screen formatting (row shading, status/weight
// chips, phase colors) and includes the Gantt bars as filled month cells.
app.get('/api/export.xlsx', async (req, res, next) => {
  try {
    const rows = await computedTasks();
    const buf = await buildScheduleWorkbook(rows);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="EZData_Schedule.xlsx"');
    res.send(buf);
  } catch (e) { next(e); }
});

// ---------------------------------------------------------------------------
// Meetings — agendas that turn into minutes
// ---------------------------------------------------------------------------

function slugFilename(meeting, ext) {
  const safe = meeting.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Meeting';
  return `${meeting.meeting_date}_${safe}.${ext}`;
}

app.get('/api/meetings', async (req, res, next) => {
  try {
    const rows = await query('SELECT id, title, meeting_date, created_at, updated_at FROM meetings ORDER BY meeting_date DESC, id DESC');
    res.json(rows);
  } catch (e) { next(e); }
});

app.get('/api/meetings/:id', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM meetings WHERE id = ?', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Meeting not found.' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.post('/api/meetings', async (req, res, next) => {
  try {
    const b = req.body || {};
    const meetingDate = String(b.meetingDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return res.status(400).json({ error: 'Enter a valid meeting date.' });
    const title = String(b.title || '').trim() || `Meeting — ${fmtDateLong(meetingDate)}`;

    const rows = await computedTasks();
    const contentHtml = buildAgendaHtml(rows, meetingDate);
    const now = new Date().toISOString();

    const inserted = await query(
      `INSERT INTO meetings (title, meeting_date, content_html, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) ${usePg ? 'RETURNING id' : ''}`,
      [title, meetingDate, contentHtml, now, now]
    );
    let id;
    if (usePg) {
      id = inserted[0].id;
    } else {
      const latest = await query('SELECT id FROM meetings ORDER BY id DESC LIMIT 1');
      id = latest[0].id;
    }
    const created = await query('SELECT * FROM meetings WHERE id = ?', [id]);
    res.status(201).json(created[0]);
  } catch (e) { next(e); }
});

app.patch('/api/meetings/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await query('SELECT * FROM meetings WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Meeting not found.' });
    const b = req.body || {};
    const fields = {};
    if (b.title !== undefined) fields.title = String(b.title).trim() || existing[0].title;
    if (b.content_html !== undefined) fields.content_html = String(b.content_html);
    if (b.meetingDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.meetingDate)) return res.status(400).json({ error: 'Enter a valid meeting date.' });
      fields.meeting_date = b.meetingDate;
    }
    const keys = Object.keys(fields);
    if (!keys.length) return res.json({ ok: true });
    fields.updated_at = new Date().toISOString();
    const allKeys = [...keys, 'updated_at'];
    const setSql = allKeys.map(k => `${k} = ?`).join(', ');
    await query(`UPDATE meetings SET ${setSql} WHERE id = ?`, [...allKeys.map(k => fields[k]), id]);
    res.json({ ok: true, updated_at: fields.updated_at });
  } catch (e) { next(e); }
});

app.delete('/api/meetings/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await query('SELECT id FROM meetings WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Meeting not found.' });
    await query('DELETE FROM meetings WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

async function loadMeetingOr404(req, res) {
  const rows = await query('SELECT * FROM meetings WHERE id = ?', [Number(req.params.id)]);
  if (!rows.length) { res.status(404).json({ error: 'Meeting not found.' }); return null; }
  return rows[0];
}

app.get('/api/meetings/:id/export.docx', async (req, res, next) => {
  try {
    const meeting = await loadMeetingOr404(req, res);
    if (!meeting) return;
    const buf = await buildMeetingDocx(meeting);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${slugFilename(meeting, 'docx')}"`);
    res.send(buf);
  } catch (e) { next(e); }
});

app.get('/api/meetings/:id/export.pdf', async (req, res, next) => {
  try {
    const meeting = await loadMeetingOr404(req, res);
    if (!meeting) return;
    const buf = await buildMeetingPdf(meeting);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${slugFilename(meeting, 'pdf')}"`);
    res.send(buf);
  } catch (e) { next(e); }
});

app.get('/api/dropbox/status', (req, res) => {
  const missing = dropbox.missingVars();
  res.json({ configured: missing.length === 0, missing });
});

// ---- BigTime (budget vs. invoiced-to-date odometer) ----
const BIGTIME_PROJECT_NAME = process.env.BIGTIME_PROJECT_NAME || 'NEORide EZData (ATTAIN Grant Project)';

app.get('/api/bigtime/status', (req, res) => {
  const missing = bigtime.missingVars();
  res.json({ configured: missing.length === 0, missing, projectName: BIGTIME_PROJECT_NAME });
});

// Temporary diagnostic route — returns BigTime's raw responses so the exact
// field names for project id / invoiced amount (unconfirmed from BigTime's
// docs alone) can be read directly and the real /api/bigtime/budget endpoint
// finalized against them. Remove once that's done.
app.get('/api/bigtime/debug-auth', async (req, res) => {
  try {
    res.json({ results: await bigtime.tryAuthStrategies() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bigtime/debug', async (req, res, next) => {
  try {
    const project = await bigtime.findProjectByName(BIGTIME_PROJECT_NAME);
    if (!project) {
      const all = await bigtime.bigtimeGet('/project');
      res.status(404).json({
        error: `No BigTime project matched "${BIGTIME_PROJECT_NAME}"`,
        allProjectNames: all.map(bigtime.projectDisplayName),
        sampleProject: all[0] || null,
      });
      return;
    }
    let budgetStatus = null;
    let budgetStatusError = null;
    try {
      budgetStatus = await bigtime.getTaskBudgetStatus(project);
    } catch (e) {
      budgetStatusError = e.message;
    }
    res.json({ project, budgetStatus, budgetStatusError });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// The Dropbox Chooser widget only ever needs the public app key (never the
// secret or refresh token) — safe to hand to the browser so it can pop the
// picker and hand back an already-shareable link for the file the user picks.
app.get('/api/dropbox/chooser-config', (req, res) => {
  res.json({ appKey: process.env.DROPBOX_APP_KEY || null });
});

// ---- Key documents (dashboard tiles linking to files already in Dropbox) ----
app.get('/api/documents', async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM documents ORDER BY phase ASC, title ASC');
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/documents', async (req, res, next) => {
  try {
    const { phase, title, url } = req.body || {};
    if (!phase || !title || !url) {
      res.status(400).json({ error: 'phase, title, and url are all required.' });
      return;
    }
    const now = new Date().toISOString();
    const inserted = await query(
      usePg
        ? 'INSERT INTO documents (phase, title, url, created_at) VALUES (?, ?, ?, ?) RETURNING *'
        : 'INSERT INTO documents (phase, title, url, created_at) VALUES (?, ?, ?, ?)',
      [String(phase), String(title), String(url), now]
    );
    if (usePg) { res.status(201).json(inserted[0]); return; }
    const row = await query('SELECT * FROM documents WHERE id = last_insert_rowid()');
    res.status(201).json(row[0]);
  } catch (e) { next(e); }
});

app.delete('/api/documents/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM documents WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/meetings/:id/dropbox', async (req, res, next) => {
  try {
    const meeting = await loadMeetingOr404(req, res);
    if (!meeting) return;
    const format = req.body && req.body.format === 'pdf' ? 'pdf' : 'docx';
    const buf = format === 'pdf' ? await buildMeetingPdf(meeting) : await buildMeetingDocx(meeting);
    const result = await dropbox.uploadToDropbox(slugFilename(meeting, format), buf);
    res.json({ ok: true, path: result.path_display });
  } catch (e) { next(e); }
});

// SPA fallback — lets a shared link like /meetings/5 be opened directly in a
// fresh browser tab; the client-side router then opens that specific meeting.
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error. Check the logs.' });
});

const PORT = process.env.PORT || 3000;
init().then(() => {
  app.listen(PORT, () => {
    console.log(`EZData Schedule running on port ${PORT} (${usePg ? 'Postgres' : 'SQLite'})`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
