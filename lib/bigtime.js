// BigTime integration — firm-level API key auth, exchanged for a session
// token used on subsequent calls. Requires BIGTIME_API_KEY and
// BIGTIME_FIRM_ID env vars. See https://iq.bigtime.net/BigtimeData/api/v2/Help
// for reference; several field names below are unconfirmed against a live
// account and may need adjusting once real data is available (see the
// /api/bigtime/debug route in server.js).

const BASE = 'https://iq.bigtime.net/BigtimeData/api/v2';
const REQUIRED_VARS = ['BIGTIME_API_KEY', 'BIGTIME_FIRM_ID'];

function missingVars() {
  return REQUIRED_VARS.filter(v => !process.env[v]);
}

function isConfigured() {
  return missingVars().length === 0;
}

// Firm-level sessions are long-lived but not truly permanent — refresh well
// before the documented 7-day expiry rather than tracking the exact instant.
let session = null; // { token, firm, expiresAt }

async function getSession() {
  if (session && session.expiresAt > Date.now()) return session;
  if (!isConfigured()) throw new Error('BigTime is not configured on the server yet.');
  const res = await fetch(`${BASE}/session/firm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: process.env.BIGTIME_API_KEY, firm: process.env.BIGTIME_FIRM_ID }),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    // BigTime's error responses are sometimes a full HTML error page — strip
    // tags so the actual message text is readable instead of buried in markup.
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    throw new Error(`BigTime session exchange failed (${res.status}): ${text.slice(0, 800)}`);
  }
  const data = await res.json();
  if (!data.token || !data.firm) {
    throw new Error(`BigTime session response missing token/firm: ${JSON.stringify(data).slice(0, 500)}`);
  }
  session = { token: data.token, firm: data.firm, expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000 };
  return session;
}

async function bigtimeGet(path) {
  const s = await getSession();
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Auth-ApiToken': s.token, 'X-Auth-Realm': s.firm },
  });
  if (res.status === 401) {
    session = null; // force re-auth on the next call
    throw new Error(`BigTime session expired or invalid (401) on ${path}`);
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    throw new Error(`BigTime API error (${res.status}) on ${path}: ${text.slice(0, 800)}`);
  }
  return res.json();
}

// The exact field holding a project's display name is unconfirmed, so check
// every plausible candidate rather than assuming one.
function projectDisplayName(p) {
  return p.DisplayName || p.Name || p.ProjectName || p.Nm || '';
}

async function findProjectByName(name) {
  const list = await bigtimeGet('/project');
  const target = name.trim().toLowerCase();
  return list.find(p => projectDisplayName(p).trim().toLowerCase() === target)
    || list.find(p => projectDisplayName(p).trim().toLowerCase().includes(target))
    || null;
}

// The project's id field name is also unconfirmed (candidates seen across
// BigTime's docs: SystemId, Sid, ProjectSid, Id) — try each until one works.
const PROJECT_ID_FIELDS = ['SystemId', 'Sid', 'ProjectSid', 'Id', 'id'];

async function getTaskBudgetStatus(project) {
  const errors = [];
  for (const field of PROJECT_ID_FIELDS) {
    const value = project[field];
    if (value === undefined || value === null) continue;
    try {
      const data = await bigtimeGet(`/task/BudgetStatusByProject/${value}`);
      return { data, idField: field, idValue: value };
    } catch (e) {
      errors.push(`${field}=${value}: ${e.message}`);
    }
  }
  throw new Error(`Could not fetch BudgetStatusByProject with any candidate id field. Tried: ${errors.join(' | ') || 'no candidate fields present on project object'}`);
}

function stripHtml(raw) {
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// BigTime's docs were inconsistent about the exact firm-key exchange shape.
// Rather than guess once and iterate over slow redeploys, try every
// plausible strategy in one shot and report each result — used only by the
// temporary /api/bigtime/debug route.
async function tryAuthStrategies() {
  const key = process.env.BIGTIME_API_KEY;
  const firm = process.env.BIGTIME_FIRM_ID;
  const results = [];

  async function record(name, fn) {
    try {
      const { status, ok, body } = await fn();
      const text = typeof body === 'string' ? stripHtml(body) : JSON.stringify(body);
      results.push({ name, status, ok, body: text.slice(0, 400) });
    } catch (e) {
      results.push({ name, error: e.message });
    }
  }

  async function rawFetch(path, opts) {
    const res = await fetch(`${BASE}${path}`, opts);
    let body;
    try { body = await res.clone().json(); } catch { body = await res.text().catch(() => ''); }
    return { status: res.status, ok: res.ok, body };
  }

  // A: use the firm API key directly as X-Auth-ApiToken, no exchange step —
  // plausible since firm keys are described as permanent (unlike session tokens).
  await record('direct-header-get-project', () =>
    rawFetch('/project', { headers: { 'X-Auth-ApiToken': key, 'X-Auth-Realm': firm } }));

  // B-E: various plausible POST /session/firm body shapes.
  await record('session-firm-lowercase', () =>
    rawFetch('/session/firm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: key, firm }),
    }));
  await record('session-firm-pascalcase', () =>
    rawFetch('/session/firm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Token: key, Firm: firm }),
    }));
  await record('session-firm-apitoken', () =>
    rawFetch('/session/firm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ApiToken: key, Firm: firm }),
    }));
  await record('session-firm-header-based', () =>
    rawFetch('/session/firm', {
      method: 'POST', headers: { 'X-Auth-ApiToken': key, 'X-Auth-Realm': firm },
    }));

  return results;
}

module.exports = { isConfigured, missingVars, getSession, bigtimeGet, findProjectByName, getTaskBudgetStatus, projectDisplayName, tryAuthStrategies };
