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

const WEIGHT_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High' };
function weightChip(w) {
  const v = w == null ? 2 : Number(w);
  return `<span class="weight-chip weight-${v}">${WEIGHT_LABELS[v] || 'Medium'}</span>`;
}

/* ---------------- tabs ---------------- */
$$('.tab[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab[data-view]').forEach(b => b.classList.toggle('active', b === btn));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + btn.dataset.view));
  });
});

/* ---------------- dashboard ---------------- */
async function renderDashboard() {
  const d = await api('/api/dashboard');

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
  nt.innerHTML = d.near_term.map(t => `
    <tr>
      <td class="mono"><span class="wbs-dot" style="background:${phaseColor(t.wbs)}"></span>${esc(t.wbs)}</td>
      <td>${esc(t.title)}</td>
      <td>${esc(t.lead || '')}</td>
      <td class="mono">${fmtDate(t.start_date)}</td>
      <td class="mono">${fmtDate(t.deadline)}</td>
      <td>${statusChip(t.status)}</td>
      <td class="num">${fmtPct(t.pct)}</td>
      <td>${esc(t.notes || '')}</td>
    </tr>`).join('');
  $('#nearterm-empty').hidden = d.near_term.length > 0;
  $('#nearterm-table').hidden = d.near_term.length === 0;

  $('#overdue-panel').hidden = d.overdue.length === 0;
  $('#overdue-table tbody').innerHTML = d.overdue.map(t => `
    <tr>
      <td class="mono">${esc(t.wbs)}</td>
      <td>${esc(t.title)}</td>
      <td>${esc(t.lead || '')}</td>
      <td class="mono">${fmtDate(t.deadline)}</td>
      <td class="num">${fmtPct(t.pct)}</td>
    </tr>`).join('');
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

async function renderSchedule() {
  const rows = await api('/api/schedule');
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
  tbody.innerHTML = rows.map(r => {
    const level = r.wbs.split('.').length;
    const rowCls = [!r.is_leaf ? 'is-parent' : '', level === 1 ? 'is-top' : ''].join(' ');
    const startMo = r.start_date ? r.start_date.slice(0, 7) : null;
    const endMo = r.deadline ? r.deadline.slice(0, 7) : null;
    const gantt = months.map(mo => {
      const on = startMo && endMo && mo >= startMo && mo <= endMo;
      const segCls = on ? `on${mo === startMo ? ' seg-start' : ''}${mo === endMo ? ' seg-end' : ''}` : '';
      return `<td class="gantt-td${mo.endsWith('-01') ? ' year-start' : ''}${mo === thisMonth ? ' is-today' : ''}"><div class="gantt-seg ${segCls}" style="--seg:${phaseColor(r.wbs)}"></div></td>`;
    }).join('');
    return `
    <tr data-id="${r.id}" class="${rowCls}">
      <td class="mono sticky-col"><span class="wbs-dot" style="background:${phaseColor(r.wbs)}"></span>${esc(r.wbs)}</td>
      <td class="title-cell sticky-col-2"><span class="indent-${Math.min(level, 4)}">${esc(r.title)}</span></td>
      <td>${esc(r.lead || '')}</td>
      <td class="mono">${fmtDate(r.start_date)}</td>
      <td class="mono">${fmtDate(r.deadline)}</td>
      <td>${statusChip(r.status)}</td>
      <td>${r.is_leaf ? weightChip(r.weight) : ''}</td>
      <td class="num">${fmtPct(r.pct)}</td>
      <td class="notes-cell">${esc(r.notes || '')}</td>
      <td class="actions-cell">${r.is_leaf ? `<div class="row-actions"><button data-act="edit">Edit</button><button data-act="delete">Delete</button></div>` : ''}</td>
      ${gantt}
    </tr>`;
  }).join('');
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
    const weightVal = r.weight == null ? 2 : Number(r.weight);
    const weightOpts = LISTS.weights.map(w => `<option value="${w.value}" ${w.value === weightVal ? 'selected' : ''}>${w.label}</option>`).join('');
    const cells = tr.children;
    cells[1].innerHTML = `<input name="title" value="${esc(r.title)}">`;
    cells[2].innerHTML = `<input name="lead" value="${esc(r.lead || '')}" list="leads-list">`;
    cells[3].innerHTML = `<input type="date" name="startDate" value="${r.start_date || ''}">`;
    cells[4].innerHTML = `<input type="date" name="deadline" value="${r.deadline || ''}">`;
    cells[5].innerHTML = `<select name="status">${statusOpts}</select>`;
    cells[6].innerHTML = `<select name="weight">${weightOpts}</select>`;
    cells[7].innerHTML = `<input type="number" name="pct" min="0" max="100" step="5" value="${Math.round((r.pct || 0) * 100)}" style="max-width:70px">`;
    cells[8].innerHTML = `<input name="notes" value="${esc(r.notes || '')}">`;
    cells[9].innerHTML = `<div class="row-actions"><button data-act="save">Save</button><button data-act="cancel">Cancel</button></div>`;
    return;
  }

  if (btn.dataset.act === 'cancel') { renderSchedule(); return; }

  if (btn.dataset.act === 'save') {
    const val = name => tr.querySelector(`[name="${name}"]`)?.value;
    try {
      await api(`/api/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: val('title'), lead: val('lead'), startDate: val('startDate'),
          deadline: val('deadline'), status: val('status'), weight: Number(val('weight')),
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
  $('#f-weight').innerHTML = LISTS.weights.map(w => `<option value="${w.value}" ${w.value === 2 ? 'selected' : ''}>${w.label}</option>`).join('');
  updateSubtaskOptions();
}

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
const MEETING_NOTE_COLOR = '#0e8a74'; // teal — visually distinct "written live in the meeting" color
let meetingModeOn = false;
let currentMeetingId = null;

function meetingStatusChip(m) {
  return m.updated_at !== m.created_at
    ? '<span class="status-chip status-InProgress">Edited</span>'
    : '<span class="status-chip status-NotStarted">Agenda only</span>';
}

async function renderMeetingsList() {
  const meetings = await api('/api/meetings');
  const tbody = $('#meetings-table tbody');
  tbody.innerHTML = meetings.map(m => `
    <tr data-id="${m.id}">
      <td class="mono">${fmtDate(m.meeting_date)}</td>
      <td>${esc(m.title)}</td>
      <td>${meetingStatusChip(m)}</td>
      <td class="mono">${new Date(m.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
      <td class="actions-cell"><div class="row-actions"><button data-act="open">Open</button><button data-act="delete-meeting">Delete</button></div></td>
    </tr>`).join('');
  $('#meetings-empty').hidden = meetings.length > 0;
  $('#meetings-table').hidden = meetings.length === 0;
}

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

async function openMeeting(id) {
  const m = await api(`/api/meetings/${id}`);
  currentMeetingId = m.id;
  meetingModeOn = false;
  savedRange = null;
  updateMeetingModeButton();
  $('#meeting-editor-title').textContent = m.title;
  $('#meeting-editor-date').textContent = fmtDate(m.meeting_date);
  $('#meeting-doc').innerHTML = m.content_html || '';
  $('#meeting-dl-docx').href = `/api/meetings/${id}/export.docx`;
  $('#meeting-dl-pdf').href = `/api/meetings/${id}/export.pdf`;
  $('#meeting-msg').textContent = '';
  $('#meetings-list-panel').hidden = true;
  $('#meeting-editor-panel').hidden = false;
  document.execCommand('styleWithCSS', false, true);
}

$('#meeting-back').addEventListener('click', () => {
  $('#meeting-editor-panel').hidden = true;
  $('#meetings-list-panel').hidden = false;
  currentMeetingId = null;
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

$('#meeting-mode-toggle').addEventListener('click', () => {
  meetingModeOn = !meetingModeOn;
  updateMeetingModeButton();
  restoreSelection();
  document.execCommand('foreColor', false, meetingModeOn ? MEETING_NOTE_COLOR : '#1b2733');
});

$('#fmt-bold').addEventListener('click', () => {
  restoreSelection();
  document.execCommand('bold');
});
$('#fmt-italic').addEventListener('click', () => {
  restoreSelection();
  document.execCommand('italic');
});
$('#fmt-color').addEventListener('input', () => {
  restoreSelection();
  document.execCommand('foreColor', false, $('#fmt-color').value);
});

$('#meeting-add-header').addEventListener('click', () => {
  const doc = $('#meeting-doc');
  restoreSelection();
  const h = document.createElement('h2');
  h.textContent = 'New heading';
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
    $('#meeting-msg').textContent = 'Saved ' + new Date().toLocaleTimeString();
    $('#meeting-msg').classList.add('ok');
    await renderMeetingsList();
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
  await Promise.all([renderDashboard(), renderSchedule(), renderLists(), renderMeetingsList()]);
}
$('#nm-date').value = todayISOClient();
refreshAll().catch(err => toast(err.message));
