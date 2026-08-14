/* NEORide EZData Schedule — frontend */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const PHASE_COLORS = {
  '1': 'var(--ph-1)', '2': 'var(--ph-2)', '3': 'var(--ph-3)',
  '4': 'var(--ph-4)', '5': 'var(--ph-5)',
};
const phaseColor = wbs => PHASE_COLORS[String(wbs).split('.')[0]] || 'var(--ink-soft)';

const fmtDate = iso => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
const fmtPct = p => p == null ? '—' : Math.round(p * 100) + '%';
const fmtMoney = n => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function statusChip(status) {
  const cls = 'status-' + String(status || '').replace(/\s/g, '');
  return `<span class="status-chip ${cls}">${esc(status || '—')}</span>`;
}

function pctCell(pct) {
  if (pct == null) return '—';
  return `<span class="pct-cell"><span class="pct-bar"><i style="width:${Math.round(pct * 100)}%"></i></span>${fmtPct(pct)}</span>`;
}

/* ---------------- tabs ---------------- */
function activateTab(view) {
  $$('.tab[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
}
$$('.tab[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    activateTab(btn.dataset.view);
    if (btn.dataset.view !== 'meetings' && location.pathname !== '/') history.pushState(null, '', '/');
  });
});

/* ---------------- dashboard ---------------- */
let DASHBOARD_PHASES = [];

async function renderDashboard() {
  const d = await api('/api/dashboard');
  DASHBOARD_PHASES = d.phases;

  $('#overall-pct').textContent = fmtPct(d.overall_pct);
  $('#overall-fill').style.width = Math.round(d.overall_pct * 100) + '%';

  $('#stats').innerHTML = `
    <div class="stat"><div class="n">${d.due_next_14}</div><div class="l">Open items due next 14 days</div></div>
    <div class="stat"><div class="n">${d.in_progress}</div><div class="l">In progress</div></div>
    <div class="stat"><div class="n">${d.complete} <span style="font-size:16px;color:var(--ink-faint)">/ ${d.total_leaves}</span></div><div class="l">Tasks complete</div></div>
    <div class="stat ${d.overdue.length ? 'alert' : ''}"><div class="n">${d.overdue.length}</div><div class="l">Overdue</div></div>`;

  $('#phase-table tbody').innerHTML = d.phases.map(p => `
    <tr>
      <td class="mono"><span class="wbs-dot" style="background:${phaseColor(p.wbs)}"></span>${esc(p.wbs)}</td>
      <td><strong>${esc(p.title)}</strong></td>
      <td class="mono">${fmtDate(p.start_date)}</td>
      <td class="mono">${fmtDate(p.deadline)}</td>
      <td>${statusChip(p.status)}</td>
      <td class="num">${fmtPct(p.pct)}</td>
      <td class="bar-col">${pctCell(p.pct)}</td>
    </tr>`).join('');

  const nt = $('#nearterm-table tbody');
  nt.innerHTML = d.near_term.map(t => {
    const isOverdue = t.deadline && t.deadline < d.today && t.status !== 'Complete';
    return `
    <tr data-id="${t.id}">
      <td class="mono"><span class="wbs-dot" style="background:${phaseColor(t.wbs)}"></span>${esc(t.wbs)}</td>
      <td>${esc(t.title)}</td>
      <td>${esc(t.lead || '')}</td>
      <td class="mono">${fmtDate(t.start_date)}</td>
      <td class="mono${isOverdue ? ' deadline-overdue' : ''}">${fmtDate(t.deadline)}</td>
      <td>${statusChip(t.status)}</td>
      <td class="num">${fmtPct(t.pct)}</td>
      <td>${esc(t.notes || '')}</td>
      <td class="actions-cell"><div class="row-actions"><button data-act="edit">Edit</button><button data-act="delete">Delete</button></div></td>
    </tr>`;
  }).join('');
  $('#nearterm-empty').hidden = d.near_term.length > 0;
  $('#nearterm-table').hidden = d.near_term.length === 0;
}

/* ---------------- project budget gauge (BigTime) ---------------- */
async function renderBudgetGauge() {
  const gauge = $('#budget-gauge');
  const unconfiguredMsg = $('#budget-unconfigured-msg');
  const errorMsg = $('#budget-error-msg');
  gauge.hidden = true;
  unconfiguredMsg.hidden = true;
  errorMsg.hidden = true;

  try {
    const status = await api('/api/bigtime/status');
    if (!status.configured) { unconfiguredMsg.hidden = false; return; }
    const b = await api('/api/bigtime/budget');
    const pct = Math.min(1, Math.max(0, b.pctSpent || 0));
    $('#gauge-fill-path').setAttribute('stroke-dasharray', `${(pct * 100).toFixed(2)} 100`);
    $('#gauge-pct').textContent = fmtPct(pct);
    $('#gauge-spent').textContent = fmtMoney(b.invoicedToDate);
    $('#gauge-total').textContent = fmtMoney(b.budgetTotal);
    gauge.hidden = false;
  } catch (err) {
    errorMsg.textContent = `Couldn't load BigTime budget data: ${err.message}`;
    errorMsg.hidden = false;
  }
}

/* ---------------- key documents (dashboard tiles linking to Dropbox files) ---------------- */
let DROPBOX_CHOOSER_APP_KEY = null;

async function initDropboxChooser() {
  try {
    const { appKey } = await api('/api/dropbox/chooser-config');
    DROPBOX_CHOOSER_APP_KEY = appKey;
    if (!appKey) { $('#doc-unconfigured-msg').hidden = false; return; }
    const script = document.createElement('script');
    script.id = 'dropboxjs';
    script.src = 'https://www.dropbox.com/static/api/2/dropins.js';
    script.dataset.appKey = appKey;
    document.head.appendChild(script);
  } catch { $('#doc-unconfigured-msg').hidden = false; }
}

function phaseOptionsHtml(selected) {
  return DASHBOARD_PHASES.map(p =>
    `<option value="${esc(p.wbs)}"${p.wbs === selected ? ' selected' : ''}>${esc(p.wbs)} — ${esc(p.title)}</option>`
  ).join('');
}

async function renderDocuments() {
  const docs = await api('/api/documents');
  const groups = $('#documents-groups');
  $('#documents-empty').hidden = docs.length > 0;
  if (!docs.length) { groups.innerHTML = ''; return; }

  groups.innerHTML = DASHBOARD_PHASES.map(p => {
    const items = docs.filter(d => d.phase === p.wbs);
    if (!items.length) return '';
    return `
    <div class="doc-group">
      <h3 class="doc-group-title"><span class="wbs-dot" style="background:${phaseColor(p.wbs)}"></span>${esc(p.title)}</h3>
      <div class="doc-tiles">
        ${items.map(doc => `
          <a class="doc-tile" href="${esc(doc.url)}" target="_blank" rel="noopener" title="${esc(doc.title)}" style="--row-accent:${phaseColor(p.wbs)}">
            <span class="doc-tile-title">${esc(doc.title)}</span>
            <button type="button" class="doc-tile-remove" data-id="${doc.id}" title="Remove this link" aria-label="Remove this link">×</button>
          </a>`).join('')}
      </div>
    </div>`;
  }).join('');
}

$('#documents-groups').addEventListener('click', async e => {
  const btn = e.target.closest('.doc-tile-remove');
  if (!btn) return;
  e.preventDefault();
  if (!confirm('Remove this document link? The file itself stays in Dropbox — this only removes the tile.')) return;
  try {
    await api(`/api/documents/${btn.dataset.id}`, { method: 'DELETE' });
    await renderDocuments();
  } catch (err) { toast(err.message); }
});

$('#doc-add-btn').addEventListener('click', () => {
  if (!DROPBOX_CHOOSER_APP_KEY || typeof Dropbox === 'undefined') {
    toast('Dropbox is not connected yet — see the README for setup.');
    return;
  }
  Dropbox.choose({
    success: files => {
      const file = files[0];
      if (file) openDocPhasePrompt(file.name, file.link);
    },
    linkType: 'preview',
    multiselect: false,
  });
});

function openDocPhasePrompt(title, url) {
  const groups = $('#documents-groups');
  const card = document.createElement('div');
  card.className = 'doc-pending';
  card.innerHTML = `
    <span class="doc-pending-title">${esc(title)}</span>
    <select class="doc-pending-phase">${phaseOptionsHtml(DASHBOARD_PHASES[0] && DASHBOARD_PHASES[0].wbs)}</select>
    <button type="button" class="btn btn-primary" data-act="confirm">Add</button>
    <button type="button" class="btn" data-act="cancel">Cancel</button>`;
  groups.prepend(card);
  card.querySelector('[data-act="cancel"]').addEventListener('click', () => card.remove());
  card.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
    const phase = card.querySelector('.doc-pending-phase').value;
    try {
      await api('/api/documents', { method: 'POST', body: JSON.stringify({ phase, title, url }) });
      card.remove();
      toast('Document linked');
      await renderDocuments();
    } catch (err) { toast(err.message); }
  });
}

/* ---------------- schedule + gantt ---------------- */
let LISTS = null;

function monthRange(rows) {
  const dates = rows.flatMap(r => [r.start_date, r.deadline]).filter(Boolean).sort();
  if (!dates.length) return [];
  const first = dates[0].slice(0, 7), last = dates[dates.length - 1].slice(0, 7);
  const months = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

let SCHEDULE_ROWS = [];

async function renderSchedule() {
  const rows = await api('/api/schedule');
  SCHEDULE_ROWS = rows;
  const months = monthRange(rows);
  const thisMonth = new Date().toISOString().slice(0, 7);

  // header
  const head = $('#schedule-head');
  $$('.gantt-th', head).forEach(el => el.remove());
  months.forEach(mo => {
    const th = document.createElement('th');
    th.className = 'gantt-th' + (mo.endsWith('-01') ? ' year-start' : '');
    const [y, m] = mo.split('-');
    th.innerHTML = m === '01' || mo === months[0] ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]}<br>${y.slice(2)}` : ['J','F','M','A','M','J','J','A','S','O','N','D'][+m-1];
    th.title = mo;
    head.appendChild(th);
  });

  const tbody = $('#schedule-table tbody');
  tbody.innerHTML = rows.map((r, idx) => {
    const level = r.wbs.split('.').length;
    const rowCls = [!r.is_leaf ? 'is-parent' : '', level === 1 ? 'is-top' : '', `level-${Math.min(level, 4)}`].join(' ');
    const startMo = r.start_date ? r.start_date.slice(0, 7) : null;
    const endMo = r.deadline ? r.deadline.slice(0, 7) : null;
    const gantt = months.map(mo => {
      const on = startMo && endMo && mo >= startMo && mo <= endMo;
      const segCls = on ? `on${mo === startMo ? ' seg-start' : ''}${mo === endMo ? ' seg-end' : ''}` : '';
      return `<td class="gantt-td${mo.endsWith('-01') ? ' year-start' : ''}${mo === thisMonth ? ' is-today' : ''}"><div class="gantt-seg ${segCls}" style="--seg:${phaseColor(r.wbs)}"></div></td>`;
    }).join('');
    const addAbove = `<button type="button" class="add-row-btn add-row-above" data-target-id="${r.id}" data-position="before" title="Add a task here">+</button>`;
    const addBelow = idx === rows.length - 1
      ? `<button type="button" class="add-row-btn add-row-below" data-target-id="${r.id}" data-position="after" title="Add a task here">+</button>`
      : '';
    return `
    <tr data-id="${r.id}" class="${rowCls}" style="--row-accent:${phaseColor(r.wbs)}">
      <td class="mono sticky-col">${addAbove}${addBelow}<span class="drag-handle" draggable="true" title="Drag to reorder or nest under another task">⋮⋮</span><span class="wbs-dot" style="background:${phaseColor(r.wbs)}"></span>${esc(r.wbs)}</td>
      <td class="title-cell sticky-col-2"><span class="indent-${Math.min(level, 4)}">${esc(r.title)}</span></td>
      <td>${esc(r.lead || '')}</td>
      <td class="mono">${fmtDate(r.start_date)}</td>
      <td class="mono">${fmtDate(r.deadline)}</td>
      <td>${statusChip(r.status)}</td>
      <td class="num">${fmtPct(r.pct)}</td>
      <td class="notes-cell">${esc(r.notes || '')}</td>
      <td class="actions-cell">${r.is_leaf ? `<div class="row-actions"><button data-act="edit">Edit</button><button data-act="delete">Delete</button></div>` : ''}</td>
      ${gantt}
    </tr>`;
  }).join('');
}

/* ---------------- schedule drag-and-drop reorder / reparent ---------------- */
let dragSourceId = null;
const scheduleBody = $('#schedule-table tbody');

function isValidDropTarget(sourceId, targetId) {
  if (sourceId === targetId) return false;
  const source = SCHEDULE_ROWS.find(r => r.id === sourceId);
  const target = SCHEDULE_ROWS.find(r => r.id === targetId);
  if (!source || !target) return false;
  if (target.wbs === source.wbs || target.wbs.startsWith(source.wbs + '.')) return false;
  return true;
}

function clearDropIndicators() {
  $$('tr[data-id]', scheduleBody).forEach(el => {
    el.classList.remove('drop-before', 'drop-after', 'drop-into');
    delete el.dataset.dropZone;
  });
}

scheduleBody.addEventListener('dragstart', e => {
  const handle = e.target.closest('.drag-handle');
  const tr = handle && handle.closest('tr[data-id]');
  if (!tr) { e.preventDefault(); return; }
  dragSourceId = Number(tr.dataset.id);
  tr.classList.add('drag-source');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragSourceId));
  e.dataTransfer.setDragImage(tr, 20, 16);
});

scheduleBody.addEventListener('dragover', e => {
  if (dragSourceId == null) return;
  const tr = e.target.closest('tr[data-id]');
  clearDropIndicators();
  if (!tr) return;
  const targetId = Number(tr.dataset.id);
  if (!isValidDropTarget(dragSourceId, targetId)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = tr.getBoundingClientRect();
  const relY = (e.clientY - rect.top) / rect.height;
  const zone = relY < 0.25 ? 'before' : relY > 0.75 ? 'after' : 'into';
  tr.classList.add(`drop-${zone}`);
  tr.dataset.dropZone = zone;
});

scheduleBody.addEventListener('drop', async e => {
  e.preventDefault();
  const tr = e.target.closest('tr[data-id]');
  const zone = tr && tr.dataset.dropZone;
  const targetId = tr && Number(tr.dataset.id);
  clearDropIndicators();
  const sourceId = dragSourceId;
  dragSourceId = null;
  if (!tr || !zone || sourceId == null || !isValidDropTarget(sourceId, targetId)) return;
  try {
    await api(`/api/tasks/${sourceId}/move`, { method: 'POST', body: JSON.stringify({ targetId, position: zone }) });
    toast('Task moved');
    await refreshAll();
  } catch (err) { toast(err.message); }
});

scheduleBody.addEventListener('dragend', () => {
  clearDropIndicators();
  $$('tr.drag-source', scheduleBody).forEach(el => el.classList.remove('drag-source'));
  dragSourceId = null;
});

/* ---------------- schedule inline add-task (+ between rows) ---------------- */
scheduleBody.addEventListener('click', e => {
  const btn = e.target.closest('.add-row-btn');
  if (!btn) return;
  openNewRowEditor(Number(btn.dataset.targetId), btn.dataset.position);
});

function openNewRowEditor(targetId, position) {
  $$('tr.new-row-editing', scheduleBody).forEach(el => el.remove());
  const targetRow = scheduleBody.querySelector(`tr[data-id="${targetId}"]`);
  if (!targetRow) return;
  const monthCount = $$('.gantt-th', $('#schedule-head')).length;
  const tr = document.createElement('tr');
  tr.className = 'new-row-editing';
  tr.innerHTML = `
    <td class="mono sticky-col">—</td>
    <td class="title-cell sticky-col-2"><input name="title" placeholder="Task title" required></td>
    <td><input name="lead" placeholder="Lead" list="leads-list"></td>
    <td><input type="date" name="startDate" required></td>
    <td><input type="date" name="deadline" required></td>
    <td>—</td>
    <td class="num">—</td>
    <td class="notes-cell"><input name="notes" placeholder="Notes"></td>
    <td class="actions-cell"><div class="row-actions"><button type="button" class="new-row-save">Save</button><button type="button" class="new-row-cancel">Cancel</button></div></td>
    ${'<td class="gantt-td"></td>'.repeat(monthCount)}
  `;
  if (position === 'before') targetRow.before(tr); else targetRow.after(tr);
  tr.querySelector('[name="title"]').focus();

  tr.querySelector('.new-row-cancel').addEventListener('click', () => tr.remove());
  tr.querySelector('.new-row-save').addEventListener('click', async () => {
    const val = name => tr.querySelector(`[name="${name}"]`)?.value.trim();
    const title = val('title'), startDate = val('startDate'), deadline = val('deadline');
    if (!title || !startDate || !deadline) {
      toast('Title, start date, and deadline are required');
      return;
    }
    try {
      await api('/api/tasks/insert', {
        method: 'POST',
        body: JSON.stringify({ targetId, position, title, lead: val('lead'), startDate, deadline, notes: val('notes') }),
      });
      toast('Task added');
      await refreshAll();
    } catch (err) { toast(err.message); }
  });
}

// Complete and 100% always travel together (server enforces this as an
// absolute invariant) — keep a status <select> and % <input> pair in sync
// live in both directions, so the UI never fights the user: picking Complete
// snaps % to 100, and pulling % below 100 releases a stale Complete selection
// back to an auto-derived status (or `autoValue`, e.g. the Add Task form's
// "Auto" option, if one is given) instead of the server silently overriding
// what the user just typed.
function bindCompletePctSync(statusSel, pctInput, autoValue = null) {
  statusSel.addEventListener('change', () => {
    if (statusSel.value === 'Complete') pctInput.value = 100;
  });
  pctInput.addEventListener('input', () => {
    const v = Number(pctInput.value);
    if (v >= 100) {
      statusSel.value = 'Complete';
    } else if (statusSel.value === 'Complete') {
      statusSel.value = autoValue != null ? autoValue : (v > 0 ? 'In Progress' : 'Not Started');
    }
  });
}

// inline edit
document.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const tr = btn.closest('tr[data-id]');
  const id = tr?.dataset.id;
  if (!id) return;

  if (btn.dataset.act === 'delete') {
    if (!confirm('Delete this schedule line?')) return;
    try {
      await api(`/api/tasks/${id}`, { method: 'DELETE' });
      toast('Line deleted');
      await refreshAll();
    } catch (err) { toast(err.message); }
    return;
  }

  if (btn.dataset.act === 'edit') {
    const rows = await api('/api/schedule');
    const r = rows.find(x => String(x.id) === String(id));
    if (!r) return;
    tr.classList.add('editing');
    const statusOpts = LISTS.statuses.map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('');
    const cells = tr.children;
    cells[1].innerHTML = `<input name="title" value="${esc(r.title)}">`;
    cells[2].innerHTML = `<input name="lead" value="${esc(r.lead || '')}" list="leads-list">`;
    cells[3].innerHTML = `<input type="date" name="startDate" value="${r.start_date || ''}">`;
    cells[4].innerHTML = `<input type="date" name="deadline" value="${r.deadline || ''}">`;
    cells[5].innerHTML = `<select name="status">${statusOpts}</select>`;
    cells[6].innerHTML = `<input type="number" name="pct" min="0" max="100" step="5" value="${Math.round((r.pct || 0) * 100)}" style="max-width:70px">`;
    cells[7].innerHTML = `<input name="notes" value="${esc(r.notes || '')}">`;
    cells[8].innerHTML = `<div class="row-actions"><button data-act="save">Save</button><button data-act="cancel">Cancel</button></div>`;
    // Complete and 100% always travel together — keep both fields in sync live,
    // in both directions, so lowering % away from 100 also releases a stale
    // "Complete" selection instead of the server snapping % back to 100.
    bindCompletePctSync(tr.querySelector('[name="status"]'), tr.querySelector('[name="pct"]'));
    return;
  }

  if (btn.dataset.act === 'cancel') {
    if (tr.closest('#nearterm-table')) { renderDashboard(); return; }
    renderSchedule();
    return;
  }

  if (btn.dataset.act === 'save') {
    const val = name => tr.querySelector(`[name="${name}"]`)?.value;
    try {
      await api(`/api/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: val('title'), lead: val('lead'), startDate: val('startDate'),
          deadline: val('deadline'), status: val('status'),
          pct: Number(val('pct')) / 100, notes: val('notes'),
        }),
      });
      toast('Saved');
      await refreshAll();
    } catch (err) { toast(err.message); }
  }
});

/* ---------------- add task form ---------------- */
async function renderLists() {
  LISTS = await api('/api/lists');
  $('#f-top').innerHTML = '<option value="">Select…</option>' +
    LISTS.topLevel.map(t => `<option value="${esc(t.wbs)}">${esc(t.wbs)} — ${esc(t.title)}</option>`).join('');
  $('#leads-list').innerHTML = LISTS.leads.map(l => `<option value="${esc(l)}">`).join('');
  const statusSel = $('#add-form [name="status"]');
  statusSel.innerHTML = '<option value="">Auto (from % complete)</option>' +
    LISTS.statuses.map(s => `<option>${s}</option>`).join('');
  updateSubtaskOptions();
}

bindCompletePctSync($('#f-status'), $('#f-pct'), '');

function updateSubtaskOptions() {
  const top = $('#f-top').value;
  const sel = $('#f-existing');
  const opts = (LISTS?.subtasks || []).filter(s => !top || s.top === top);
  sel.innerHTML = '<option value="">—</option>' +
    opts.map(s => `<option value="${esc(s.wbs)}">${esc(s.wbs)} — ${esc(s.title)}</option>`).join('');
}
$('#f-top').addEventListener('change', updateSubtaskOptions);

$('#add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('#form-msg');
  msg.textContent = ''; msg.classList.remove('ok');
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try {
    const out = await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = `Added as WBS ${out.wbs}.`;
    msg.classList.add('ok');
    e.target.reset();
    toast(`Task added — WBS ${out.wbs}`);
    await refreshAll();
  } catch (err) {
    msg.textContent = err.message;
  }
});

/* ---------------- AI fill (Add Task) ---------------- */
let speechRecognizer = null;
let recognizing = false;

async function initAiFillPanel() {
  let status;
  try { status = await api('/api/ai/status'); } catch { status = { configured: false }; }
  if (!status.configured) return; // stays hidden — no key configured server-side
  $('#ai-fill-panel').hidden = false;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $('#ai-mic-btn').hidden = true;
    $('#ai-status-msg').textContent = "Voice input isn't supported in this browser — type your statement instead.";
    return;
  }
  speechRecognizer = new SpeechRecognition();
  speechRecognizer.continuous = true;
  speechRecognizer.interimResults = true;
  speechRecognizer.lang = 'en-US';
  let baseText = '';
  speechRecognizer.onresult = e => {
    let finalText = baseText;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t + ' ';
      else interim += t;
    }
    $('#ai-transcript').value = finalText;
    baseText = finalText;
    $('#ai-status-msg').textContent = interim ? `Listening… ${interim}` : 'Listening…';
  };
  speechRecognizer.onerror = e => { $('#ai-status-msg').textContent = `Mic error: ${e.error}`; stopListening(); };
  speechRecognizer.onend = () => stopListening();
}

function stopListening() {
  recognizing = false;
  const btn = $('#ai-mic-btn');
  btn.textContent = '🎤 Start speaking';
  btn.classList.remove('mic-active');
}

$('#ai-mic-btn').addEventListener('click', () => {
  if (!speechRecognizer) return;
  if (recognizing) { speechRecognizer.stop(); return; }
  recognizing = true;
  const btn = $('#ai-mic-btn');
  btn.textContent = '⏹ Stop';
  btn.classList.add('mic-active');
  $('#ai-status-msg').textContent = 'Listening…';
  speechRecognizer.start();
});

$('#ai-fill-btn').addEventListener('click', async () => {
  const transcript = $('#ai-transcript').value.trim();
  if (!transcript) { toast('Say or type something first'); return; }
  if (recognizing) speechRecognizer.stop();
  $('#ai-status-msg').textContent = 'Thinking…';
  try {
    const fields = await api('/api/ai/parse-task', { method: 'POST', body: JSON.stringify({ transcript }) });
    applyAiFields(fields);
    $('#ai-status-msg').textContent = 'Filled in below — review before submitting.';
  } catch (err) {
    $('#ai-status-msg').textContent = '';
    toast(err.message);
  }
});

function applyAiFields(f) {
  const form = $('#add-form');
  if (f.topLevelWbs) { form.topLevelWbs.value = f.topLevelWbs; updateSubtaskOptions(); }
  if (f.existingSubtaskWbs) form.existingSubtaskWbs.value = f.existingSubtaskWbs;
  if (f.newSubtaskTitle) form.newSubtaskTitle.value = f.newSubtaskTitle;
  if (f.title) form.title.value = f.title;
  if (f.startDate) form.startDate.value = f.startDate;
  if (f.deadline) form.deadline.value = f.deadline;
  if (f.lead) form.lead.value = f.lead;
  if (f.status) form.status.value = f.status;
  if (f.pct != null && f.pct !== '') form.pct.value = String(f.pct);
  if (f.status === 'Complete') form.pct.value = 100;
  if (f.notes) form.notes.value = f.notes;
}

/* ---------------- export dropdown ---------------- */
const exportToggle = $('#export-toggle');
const exportDropdown = $('#export-dropdown');
exportToggle.addEventListener('click', e => {
  e.stopPropagation();
  const opening = exportDropdown.hidden;
  exportDropdown.hidden = !opening;
  exportToggle.setAttribute('aria-expanded', String(opening));
});
exportDropdown.addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () => {
  exportDropdown.hidden = true;
  exportToggle.setAttribute('aria-expanded', 'false');
});

/* ---------------- meetings ---------------- */
const MEETING_NOTE_COLOR = '#c0392b'; // red — visually distinct "written live in the meeting" color
let meetingModeOn = false;
let currentMeetingId = null;

function meetingStatusChip(m) {
  return m.updated_at !== m.created_at
    ? '<span class="status-chip status-InProgress">Edited</span>'
    : '<span class="status-chip status-NotStarted">Agenda only</span>';
}

let MEETINGS_COUNT = 0;

async function renderMeetingsList() {
  const meetings = await api('/api/meetings');
  MEETINGS_COUNT = meetings.length;
  const tbody = $('#meetings-table tbody');
  tbody.innerHTML = meetings.map(m => `
    <tr data-id="${m.id}">
      <td class="mono">${fmtDate(m.meeting_date)}</td>
      <td>${esc(m.title)}</td>
      <td>${meetingStatusChip(m)}</td>
      <td class="mono">${new Date(m.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
      <td class="actions-cell"><div class="row-actions"><button data-act="open">Open</button><button data-act="delete-meeting">Delete</button></div></td>
    </tr>`).join('');
  if (!$('#meetings-search').value.trim()) {
    $('#meetings-empty').hidden = meetings.length > 0;
    $('#meetings-table').hidden = meetings.length === 0;
  }
}

/* ---------------- meeting notes search ---------------- */
function highlightSnippet(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(text);
  return esc(text.slice(0, idx)) + '<mark>' + esc(text.slice(idx, idx + query.length)) + '</mark>' + esc(text.slice(idx + query.length));
}

function showMeetingsListView() {
  $('#meetings-search-results').hidden = true;
  $('#meetings-search-empty').hidden = true;
  $('#meetings-empty').hidden = MEETINGS_COUNT > 0;
  $('#meetings-table').hidden = MEETINGS_COUNT === 0;
}

async function runMeetingsSearch(query) {
  const results = await api(`/api/meetings/search?q=${encodeURIComponent(query)}`);
  $('#meetings-table').hidden = true;
  $('#meetings-empty').hidden = true;
  $('#meetings-search-empty').hidden = results.length > 0;
  $('#meetings-search-results').hidden = results.length === 0;
  $('#meetings-search-results').innerHTML = results.map(r => `
    <div class="search-result-card" data-id="${r.id}">
      <div class="search-result-head">
        <span class="search-result-title">${esc(r.title)}</span>
        <span class="search-result-date">${fmtDate(r.meetingDate)}</span>
      </div>
      ${r.snippets.map(s => `<p class="search-result-snippet">${highlightSnippet(s, query)}</p>`).join('')}
      ${r.matchCount > r.snippets.length ? `<p class="search-result-more">+ ${r.matchCount - r.snippets.length} more match${r.matchCount - r.snippets.length > 1 ? 'es' : ''} in this meeting</p>` : ''}
    </div>`).join('');
}

let meetingsSearchTimer = null;
$('#meetings-search').addEventListener('input', () => {
  clearTimeout(meetingsSearchTimer);
  const q = $('#meetings-search').value.trim();
  if (!q) { showMeetingsListView(); return; }
  meetingsSearchTimer = setTimeout(() => runMeetingsSearch(q).catch(err => toast(err.message)), 250);
});

$('#meetings-search-results').addEventListener('click', e => {
  const card = e.target.closest('.search-result-card');
  if (!card) return;
  openMeeting(card.dataset.id);
});

$('#meetings-table tbody').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const tr = btn.closest('tr[data-id]');
  const id = tr.dataset.id;
  if (btn.dataset.act === 'open') { openMeeting(id); return; }
  if (btn.dataset.act === 'delete-meeting') {
    if (!confirm('Delete this meeting record? This cannot be undone.')) return;
    try {
      await api(`/api/meetings/${id}`, { method: 'DELETE' });
      toast('Meeting deleted');
      await renderMeetingsList();
    } catch (err) { toast(err.message); }
  }
});

$('#new-meeting-form').addEventListener('submit', async e => {
  e.preventDefault();
  const meetingDate = $('#nm-date').value;
  const title = $('#nm-title').value;
  if (!meetingDate) { toast('Pick a meeting date'); return; }
  try {
    const m = await api('/api/meetings', { method: 'POST', body: JSON.stringify({ meetingDate, title }) });
    e.target.reset();
    $('#nm-date').value = todayISOClient();
    await renderMeetingsList();
    toast('Agenda created');
    openMeeting(m.id);
  } catch (err) { toast(err.message); }
});

function todayISOClient() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function updateMeetingModeButton() {
  const btn = $('#meeting-mode-toggle');
  btn.textContent = meetingModeOn ? '🖊 Meeting mode: ON' : '🖊 Meeting mode: off';
  btn.classList.toggle('meeting-mode-active', meetingModeOn);
}

let currentMeetingTitle = '';
let currentMeetingDate = '';

async function openMeeting(id, opts = {}) {
  const m = await api(`/api/meetings/${id}`);
  currentMeetingId = m.id;
  currentMeetingTitle = m.title;
  currentMeetingDate = m.meeting_date;
  meetingModeOn = false;
  savedRange = null;
  updateMeetingModeButton();
  $('#meeting-editor-title').value = m.title;
  $('#meeting-editor-date').value = m.meeting_date;
  $('#meeting-doc').innerHTML = m.content_html || '';
  $('#meeting-dl-docx').href = `/api/meetings/${id}/export.docx`;
  $('#meeting-dl-pdf').href = `/api/meetings/${id}/export.pdf`;
  $('#meeting-msg').textContent = '';
  $('#meetings-list-panel').hidden = true;
  $('#meeting-editor-panel').hidden = false;
  document.execCommand('styleWithCSS', false, true);
  if (!opts.skipHistory) {
    const url = `/meetings/${id}`;
    if (opts.replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
  }
}

function closeMeetingEditor(opts = {}) {
  $('#meeting-editor-panel').hidden = true;
  $('#meetings-list-panel').hidden = false;
  currentMeetingId = null;
  if (!opts.skipHistory) history.pushState(null, '', '/');
}

$('#meeting-back').addEventListener('click', () => closeMeetingEditor());

window.addEventListener('popstate', () => routeFromLocation({ skipHistory: true }));

function routeFromLocation(opts = {}) {
  const m = /^\/meetings\/(\d+)/.exec(location.pathname);
  if (m) {
    activateTab('meetings');
    openMeeting(m[1], opts).catch(() => closeMeetingEditor(opts));
  } else if (currentMeetingId) {
    closeMeetingEditor(opts);
  }
}

$('#meeting-editor-title').addEventListener('blur', async e => {
  if (!currentMeetingId) return;
  const title = e.target.value.trim();
  if (!title) { e.target.value = currentMeetingTitle; return; }
  if (title === currentMeetingTitle) return;
  try {
    await api(`/api/meetings/${currentMeetingId}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    currentMeetingTitle = title;
    await renderMeetingsList();
  } catch (err) { toast(err.message); e.target.value = currentMeetingTitle; }
});

$('#meeting-editor-date').addEventListener('change', async e => {
  if (!currentMeetingId) return;
  const meetingDate = e.target.value;
  if (!meetingDate || meetingDate === currentMeetingDate) return;
  try {
    await api(`/api/meetings/${currentMeetingId}`, { method: 'PATCH', body: JSON.stringify({ meetingDate }) });
    currentMeetingDate = meetingDate;
    await renderMeetingsList();
    toast('Meeting date updated');
  } catch (err) { toast(err.message); e.target.value = currentMeetingDate; }
});

/* Toolbar buttons steal focus from the contenteditable on click, which loses
   the user's cursor position. We track the last selection made *inside* the
   doc and restore it before acting, so every toolbar action applies at the
   cursor rather than always at the end of the document. `selectionchange` can
   fire asynchronously (after the next task), which loses a race against fast
   focus-stealing controls like the native color picker — mouseup/keyup on the
   doc itself fire synchronously within the same interaction, so we use those
   as the primary capture and selectionchange as a fallback for edge cases
   (e.g. select-all via keyboard shortcut, or selection changed via script). */
let savedRange = null;
function syncSavedRange() {
  const sel = window.getSelection();
  const doc = $('#meeting-doc');
  if (sel.rangeCount && doc.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
}
$('#meeting-doc').addEventListener('mouseup', syncSavedRange);
$('#meeting-doc').addEventListener('keyup', syncSavedRange);
document.addEventListener('selectionchange', syncSavedRange);
function restoreSelection() {
  const doc = $('#meeting-doc');
  doc.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  if (savedRange) sel.addRange(savedRange);
}
function placeCaretInNode(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  savedRange = range.cloneRange();
}
// Native buttons (not the color <input>) shouldn't steal focus at all — this
// keeps the caret exactly where the user left it with zero flicker.
$$('.meeting-toolbar button').forEach(btn => btn.addEventListener('mousedown', e => e.preventDefault()));

function closestLi(doc) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !doc.contains(sel.anchorNode)) return null;
  let node = sel.getRangeAt(0).startContainer;
  node = node.nodeType === 3 ? node.parentElement : node;
  return closestAncestor(node, 'LI', doc);
}

// Nests `li` under its previous sibling, creating a sublist if one doesn't
// already exist there. Returns false (no-op) if this is the first item in
// its list — there's nothing to nest under.
function indentListItem(li) {
  const prevLi = li.previousElementSibling;
  if (!prevLi || prevLi.tagName !== 'LI') return false;
  let nestedList = null;
  for (const child of prevLi.children) {
    if (child.tagName === 'UL' || child.tagName === 'OL') { nestedList = child; break; }
  }
  if (!nestedList) {
    nestedList = document.createElement(li.parentElement.tagName.toLowerCase());
    prevLi.appendChild(nestedList);
  }
  nestedList.appendChild(li);
  return true;
}

// Moves `li` up one nesting level, placing it right after the parent list's
// own containing <li>. Returns false if already at the top level.
function outdentListItem(li) {
  const parentList = li.parentElement;
  const grandLi = parentList.parentElement;
  if (!grandLi || grandLi.tagName !== 'LI') return false;
  grandLi.after(li);
  if (!parentList.children.length) parentList.remove();
  return true;
}

$('#meeting-doc').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const doc = $('#meeting-doc');
  const li = closestLi(doc);
  if (!li) return; // outside a list — let Tab behave normally (focus move)
  e.preventDefault();
  // Capture the same li reference before the DOM move — the live selection
  // can be lost mid-move, so re-deriving "current li" from it afterward
  // would silently fail. Reuse the reference we already have instead.
  const changed = e.shiftKey ? outdentListItem(li) : indentListItem(li);
  if (changed) placeCaretInNode(li);
});

// Elements created via the toolbar (+Header, +Agenda item) are fresh DOM
// nodes with no connection to the browser's "current typing style" — setting
// color directly on the container makes any text typed inside inherit it
// through normal CSS cascade, no execCommand needed.
function applyMeetingModeColor(el) {
  if (meetingModeOn) el.style.color = MEETING_NOTE_COLOR;
}

$('#meeting-mode-toggle').addEventListener('click', () => {
  meetingModeOn = !meetingModeOn;
  updateMeetingModeButton();
  const doc = $('#meeting-doc');
  doc.focus();
  if (!savedRange) {
    // Toggled before ever clicking into the notes area — default the caret to
    // the end of the document so typing works right away instead of no-op'ing.
    const range = document.createRange();
    range.selectNodeContents(doc);
    range.collapse(false);
    savedRange = range.cloneRange();
  }
  restoreSelection();
  document.execCommand('foreColor', false, meetingModeOn ? MEETING_NOTE_COLOR : '#1b2733');
});

// The execCommand above (and applyMeetingModeColor on toolbar-created
// elements) don't cover every way new red-required text can appear — e.g.
// pressing Enter from existing BLACK text creates a new bullet/sub-bullet
// that inherits black, and typing into it stays black even though meeting
// mode is still on. This listener force-colors whatever was JUST typed,
// regardless of what came before it or how the cursor got there, any time
// meeting mode is on — but skips text that's already red so normal typing
// doesn't get re-wrapped in a new span on every single keystroke.
const MEETING_NOTE_COLOR_RGB = (() => {
  const probe = document.createElement('span');
  probe.style.color = MEETING_NOTE_COLOR;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  return rgb;
})();
const MEETING_MODE_INSERT_TYPES = new Set([
  'insertText', 'insertCompositionText', 'insertFromComposition', 'insertReplacementText',
]);
$('#meeting-doc').addEventListener('input', e => {
  if (!meetingModeOn) return;
  if (e.inputType && !MEETING_MODE_INSERT_TYPES.has(e.inputType)) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== 3) return; // only plain text-node insertions
  const doc = $('#meeting-doc');
  const parentEl = node.parentElement;
  if (!parentEl || !doc.contains(parentEl)) return;
  if (getComputedStyle(parentEl).color === MEETING_NOTE_COLOR_RGB) return; // already red

  const insertedLen = e.data != null ? e.data.length : 1;
  const caret = range.startOffset;
  const start = Math.max(0, caret - insertedLen);
  if (start >= caret) return;

  const wrapRange = document.createRange();
  wrapRange.setStart(node, start);
  wrapRange.setEnd(node, caret);
  const span = document.createElement('span');
  span.style.color = MEETING_NOTE_COLOR;
  try {
    wrapRange.surroundContents(span);
  } catch {
    return; // range crosses element boundaries — leave it black rather than risk corrupting structure
  }
  const after = document.createRange();
  after.selectNodeContents(span);
  after.collapse(false);
  sel.removeAllRanges();
  sel.addRange(after);
  savedRange = after.cloneRange();
});

$('#fmt-bold').addEventListener('click', () => {
  restoreSelection();
  document.execCommand('bold');
});
$('#fmt-italic').addEventListener('click', () => {
  restoreSelection();
  document.execCommand('italic');
});

// Applied directly to the saved Range's own DOM nodes rather than through
// execCommand on the live window selection — the native color picker can
// steal focus for an OS-level panel, which is unreliable to race against
// when re-establishing a live selection at exactly the right moment. A
// Range's boundary points stay valid regardless of what has focus, so this
// works whether or not the doc/selection is still "live" when it fires.
function applyColorToRange(range, color) {
  if (!range || range.collapsed) return false;
  const span = document.createElement('span');
  span.style.color = color;
  try {
    range.surroundContents(span);
  } catch {
    // Range crosses element boundaries (e.g. spans two <li>s) — surroundContents
    // requires a range that doesn't partially select a non-text node, so fall
    // back to extracting the whole fragment and re-inserting it wrapped.
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
  return true;
}
// Word-style font color button: the main "A" button always applies whatever
// color its underline swatch currently shows (one click, no picker) — the
// caret opens a small palette to change that quick color, which then also
// applies immediately to the current highlight, same as clicking a swatch
// in Word's font color dropdown.
let quickFontColor = '#1b2733';
function setQuickFontColor(color) {
  quickFontColor = color;
  $('#fmt-color-swatch').style.background = color;
}
setQuickFontColor(quickFontColor);

function applyQuickColor(color) {
  if (applyColorToRange(savedRange, color)) {
    $('#meeting-doc').focus();
  } else {
    toast('Highlight some text first, then pick a color.');
  }
}

$('#fmt-color-apply').addEventListener('click', () => applyQuickColor(quickFontColor));

$('#fmt-color-caret').addEventListener('click', e => {
  e.stopPropagation();
  const opening = $('#fmt-color-popup').hidden;
  $('#fmt-color-popup').hidden = !opening;
  $('#fmt-color-caret').setAttribute('aria-expanded', String(opening));
});
$('#fmt-color-popup').addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () => {
  $('#fmt-color-popup').hidden = true;
  $('#fmt-color-caret').setAttribute('aria-expanded', 'false');
});

$$('.fmt-swatch').forEach(btn => btn.addEventListener('click', () => {
  const color = btn.dataset.color;
  setQuickFontColor(color);
  $('#fmt-color-popup').hidden = true;
  $('#fmt-color-caret').setAttribute('aria-expanded', 'false');
  applyQuickColor(color);
}));

// 'change' (fires once, when the picker closes) rather than 'input' (fires
// continuously while dragging) — applyColorToRange mutates the DOM around
// savedRange, so re-applying on every drag tick against the same range would
// hit stale/already-wrapped nodes on the second tick onward.
$('#fmt-color-native').addEventListener('change', () => {
  const color = $('#fmt-color-native').value;
  setQuickFontColor(color);
  $('#fmt-color-popup').hidden = true;
  $('#fmt-color-caret').setAttribute('aria-expanded', 'false');
  applyQuickColor(color);
});

$('#meeting-add-header').addEventListener('click', () => {
  const doc = $('#meeting-doc');
  restoreSelection();
  const h = document.createElement('h2');
  h.textContent = 'New heading';
  applyMeetingModeColor(h);
  insertBlockAfterCursor(doc, h);
  const range = document.createRange();
  range.selectNodeContents(h);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  savedRange = range.cloneRange();
});

// Walks up from `node` looking for an ancestor with tag `tagName`, stopping
// at (and never matching) `boundary`. Returns null if none is found — the
// caller must treat that as "not found", not fall through to using the
// boundary element itself as if it matched.
function closestAncestor(node, tagName, boundary) {
  let el = node;
  while (el && el !== boundary) {
    if (el.tagName === tagName) return el;
    el = el.parentElement;
  }
  return null;
}

// Finds the top-level block (direct child of `doc`) containing the cursor
// and inserts `el` right after it, so new sections land where the user is
// looking rather than always at the bottom of the document.
function insertBlockAfterCursor(doc, el) {
  const sel = window.getSelection();
  if (sel.rangeCount && doc.contains(sel.anchorNode)) {
    let node = sel.getRangeAt(0).startContainer;
    node = node.nodeType === 3 ? node.parentElement : node;
    while (node && node.parentElement !== doc && node !== doc) node = node.parentElement;
    if (node && node !== doc) { node.after(el); return; }
  }
  doc.appendChild(el);
}

$('#meeting-add-item').addEventListener('click', () => {
  const doc = $('#meeting-doc');
  restoreSelection();
  const sel = window.getSelection();
  let li = null;

  if (sel.rangeCount && doc.contains(sel.anchorNode)) {
    let node = sel.getRangeAt(0).startContainer;
    node = node.nodeType === 3 ? node.parentElement : node;
    const curLi = closestAncestor(node, 'LI', doc);
    if (curLi) {
      li = document.createElement('li');
      li.innerHTML = '<br>';
      curLi.after(li);
    } else {
      const curUl = closestAncestor(node, 'UL', doc);
      if (curUl) {
        li = document.createElement('li');
        li.innerHTML = '<br>';
        curUl.appendChild(li);
      }
    }
  }
  if (!li) {
    let target = doc.querySelector('ul:last-of-type');
    if (!target) {
      doc.insertAdjacentHTML('beforeend', '<h2>Discussion items</h2><ul></ul>');
      target = doc.querySelector('ul:last-of-type');
    }
    li = document.createElement('li');
    li.innerHTML = '<br>';
    target.appendChild(li);
  }
  applyMeetingModeColor(li);
  placeCaretInNode(li);
});

async function saveMeetingNotes() {
  if (!currentMeetingId) return;
  await api(`/api/meetings/${currentMeetingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content_html: $('#meeting-doc').innerHTML }),
  });
}

$('#meeting-save').addEventListener('click', async () => {
  try {
    await saveMeetingNotes();
    await renderMeetingsList();
    toast('Meeting saved');
    closeMeetingEditor();
  } catch (err) { toast(err.message); }
});

$('#meeting-dropbox').addEventListener('click', async () => {
  if (!currentMeetingId) return;
  try {
    const status = await api('/api/dropbox/status');
    if (!status.configured) {
      toast(status.missing?.length ? `Dropbox missing env var(s): ${status.missing.join(', ')}` : 'Dropbox is not connected yet.');
      return;
    }
    await saveMeetingNotes();
    const out = await api(`/api/meetings/${currentMeetingId}/dropbox`, { method: 'POST', body: JSON.stringify({ format: 'docx' }) });
    toast(`Sent to Dropbox: ${out.path}`);
  } catch (err) { toast(err.message); }
});

/* ---------------- boot ---------------- */
async function refreshAll() {
  await Promise.all([renderDashboard(), renderSchedule(), renderLists(), renderMeetingsList(), renderBudgetGauge()]);
  await renderDocuments(); // depends on DASHBOARD_PHASES, set by renderDashboard above
}
$('#nm-date').value = todayISOClient();
refreshAll().catch(err => toast(err.message));
initAiFillPanel().catch(() => {});
initDropboxChooser().catch(() => {});
routeFromLocation({ replace: true });
