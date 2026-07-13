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
      <td class="mono"><span class="wbs-dot" style="background:${phaseColor(r.wbs)}"></span>${esc(r.wbs)}</td>
      <td class="title-cell"><span class="indent-${Math.min(level, 4)}">${esc(r.title)}</span></td>
      <td>${esc(r.lead || '')}</td>
      <td class="mono">${fmtDate(r.start_date)}</td>
      <td class="mono">${fmtDate(r.deadline)}</td>
      <td>${statusChip(r.status)}</td>
      <td class="num">${fmtPct(r.pct)}</td>
      <td class="notes-cell">${esc(r.notes || '')}</td>
      <td class="row-actions">${r.is_leaf ? `<button data-act="edit">Edit</button><button data-act="delete">Delete</button>` : ''}</td>
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
    const cells = tr.children;
    cells[1].innerHTML = `<input name="title" value="${esc(r.title)}">`;
    cells[2].innerHTML = `<input name="lead" value="${esc(r.lead || '')}" list="leads-list">`;
    cells[3].innerHTML = `<input type="date" name="startDate" value="${r.start_date || ''}">`;
    cells[4].innerHTML = `<input type="date" name="deadline" value="${r.deadline || ''}">`;
    cells[5].innerHTML = `<select name="status">${statusOpts}</select>`;
    cells[6].innerHTML = `<input type="number" name="pct" min="0" max="100" step="5" value="${Math.round((r.pct || 0) * 100)}" style="max-width:70px">`;
    cells[7].innerHTML = `<input name="notes" value="${esc(r.notes || '')}">`;
    cells[8].innerHTML = `<div class="row-actions"><button data-act="save">Save</button><button data-act="cancel">Cancel</button></div>`;
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

/* ---------------- boot ---------------- */
async function refreshAll() {
  await Promise.all([renderDashboard(), renderSchedule(), renderLists()]);
}
refreshAll().catch(err => toast(err.message));
