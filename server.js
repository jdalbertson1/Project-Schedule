// NEORide EZData Schedule - web app replacement for EZData_Schedule.xlsm
// Replicates the workbook's rollup formulas and the SubmitTask VBA macro as a REST API.

const express = require('express');
const path = require('path');
const { query, init, usePg } = require('./db');

const app = express();
app.use(express.json());

// ---- Optional password protection (set APP_PASSWORD in Railway variables) ----
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
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
    const prefix = r.wbs + '.';
    r.is_leaf = !wbsList.some(w => w.startsWith(prefix));
  }

  for (const r of rows) {
    if (r.is_leaf) {
      if (r.pct === null) r.pct = 0;
      if (!r.status) r.status = statusFromPct(r.pct);
      continue;
    }
    // Parent: roll up from leaf descendants (same as MIN/MAX/SUMPRODUCT formulas)
    const prefix = r.wbs + '.';
    const leaves = rows.filter(x => x.is_leaf && x.wbs.startsWith(prefix));
    if (leaves.length) {
      const starts = leaves.map(l => l.start_date).filter(Boolean).sort();
      const ends = leaves.map(l => l.deadline).filter(Boolean).sort();
      r.start_date = starts[0] || null;
      r.deadline = ends[ends.length - 1] || null;
      r.pct = leaves.reduce((s, l) => s + (l.pct || 0), 0) / leaves.length;
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
    const horizon = addDays(today, 14);

    const dueSoon = leaves.filter(l =>
      l.deadline && l.deadline >= today && l.deadline <= horizon && (l.pct || 0) < 1
    );

    const phases = rows.filter(r => !r.wbs.includes('.')).map(p => ({
      wbs: p.wbs, title: p.title, phase: p.phase,
      start_date: p.start_date, deadline: p.deadline,
      status: p.status, pct: p.pct,
    }));

    res.json({
      today,
      overall_pct: leaves.length ? leaves.reduce((s, l) => s + (l.pct || 0), 0) / leaves.length : 0,
      due_next_14: dueSoon.length,
      in_progress: leaves.filter(l => l.status === 'In Progress').length,
      complete: leaves.filter(l => l.status === 'Complete').length,
      total_leaves: leaves.length,
      phases,
      near_term: dueSoon.sort((a, b) => a.deadline.localeCompare(b.deadline)),
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
    const status = clean(b.status) || statusFromPct(pct);

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

    const start = fields.start_date ?? existing[0].start_date;
    const end = fields.deadline ?? existing[0].deadline;
    if (start && end && end < start) return res.status(400).json({ error: 'Deadline cannot be earlier than start date.' });

    const keys = Object.keys(fields);
    if (!keys.length) return res.json({ ok: true });
    const setSql = keys.map(k => `${k} = ?`).join(', ');
    await query(`UPDATE tasks SET ${setSql} WHERE id = ?`, [...keys.map(k => fields[k]), id]);
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
    res.json({ ok: true, deleted: 1 + children.length });
  } catch (e) { next(e); }
});

// CSV export of the computed schedule
app.get('/api/export.csv', async (req, res, next) => {
  try {
    const rows = await computedTasks();
    const esc = v => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = 'Phase,WBS,Task / Subtask,Lead,Start Date,Deadline,Status,% Complete,Notes';
    const lines = rows.map(r => [
      r.phase, r.wbs, r.title, r.lead, r.start_date, r.deadline, r.status,
      r.pct == null ? '' : Math.round(r.pct * 1000) / 10 + '%', r.notes,
    ].map(esc).join(','));
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename="EZData_Schedule.csv"');
    res.send([header, ...lines].join('\n'));
  } catch (e) { next(e); }
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
