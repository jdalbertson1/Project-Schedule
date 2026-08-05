// BigTime integration — firm-level API key auth. Confirmed live (2026-08):
// the firm API key is used directly as the X-Auth-ApiToken header value,
// alongside X-Auth-Realm for the firm id — no separate session-exchange call
// needed at all (it's a permanent credential, unlike a per-user session
// token). Requires BIGTIME_API_KEY and BIGTIME_FIRM_ID env vars.

const BASE = 'https://iq.bigtime.net/BigtimeData/api/v2';
const REQUIRED_VARS = ['BIGTIME_API_KEY', 'BIGTIME_FIRM_ID'];

function missingVars() {
  return REQUIRED_VARS.filter(v => !process.env[v]);
}

function isConfigured() {
  return missingVars().length === 0;
}

async function bigtimeGet(path) {
  if (!isConfigured()) throw new Error('BigTime is not configured on the server yet.');
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Auth-ApiToken': process.env.BIGTIME_API_KEY, 'X-Auth-Realm': process.env.BIGTIME_FIRM_ID },
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    // BigTime's error responses are sometimes a full HTML error page — strip
    // tags so the actual message text is readable instead of buried in markup.
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

module.exports = { isConfigured, missingVars, bigtimeGet, findProjectByName, getTaskBudgetStatus, projectDisplayName };
