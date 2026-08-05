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

// Project's own display name (Nm) vs. the client-prefixed DisplayName
// ("NEORide:NEORide EZData ...") — matching against Nm first covers the name
// as the user actually knows it.
function projectDisplayName(p) {
  return p.Nm || p.DisplayName || '';
}

async function findProjectByName(name) {
  const list = await bigtimeGet('/project');
  const target = name.trim().toLowerCase();
  return list.find(p => projectDisplayName(p).trim().toLowerCase() === target)
    || list.find(p => projectDisplayName(p).trim().toLowerCase().includes(target))
    || null;
}

// Confirmed live against the real account (2026-08): task budget/invoiced
// totals for a project come from /task/BudgetStatusByProject/{SystemId}.
// EstTotal (fee+expense budget) summed across every task under the project
// equals the project's overall budget; InvoicedToDate summed the same way
// gives invoiced-to-date. Verified against known real figures for the
// NEORide EZData project: $798,000 budget / $11,175 invoiced.
async function getProjectBudgetSummary(projectName) {
  const project = await findProjectByName(projectName);
  if (!project) throw new Error(`No BigTime project matching "${projectName}"`);
  const tasks = await bigtimeGet(`/task/BudgetStatusByProject/${project.SystemId}`);
  const budgetTotal = tasks.reduce((sum, t) => sum + (t.EstTotal || 0), 0);
  const invoicedToDate = tasks.reduce((sum, t) => sum + (t.InvoicedToDate || 0), 0);
  return {
    projectName: projectDisplayName(project),
    budgetTotal,
    invoicedToDate,
    pctSpent: budgetTotal ? invoicedToDate / budgetTotal : 0,
  };
}

module.exports = { isConfigured, missingVars, bigtimeGet, findProjectByName, projectDisplayName, getProjectBudgetSummary };
