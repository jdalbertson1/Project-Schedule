// Resolves connector config (BigTime, Dropbox, storage/R2) from the database
// first, falling back to the legacy Railway environment variables field-by-
// field when no DB value is set — lets this ship before the one-time
// migration script runs, and keeps working even if a DB field is cleared.

const { query } = require('../db');
const secretBox = require('./crypto');

const SCHEMAS = {
  bigtime: {
    fields: ['apiKey', 'firmId', 'projectName'],
    secretFields: ['apiKey'],
    requiredFields: ['apiKey', 'firmId'],
    envFallback: { apiKey: 'BIGTIME_API_KEY', firmId: 'BIGTIME_FIRM_ID', projectName: 'BIGTIME_PROJECT_NAME' },
  },
  dropbox: {
    fields: ['appKey', 'appSecret', 'refreshToken', 'folder'],
    secretFields: ['appSecret', 'refreshToken'],
    requiredFields: ['appKey', 'appSecret', 'refreshToken'],
    envFallback: { appKey: 'DROPBOX_APP_KEY', appSecret: 'DROPBOX_APP_SECRET', refreshToken: 'DROPBOX_REFRESH_TOKEN', folder: 'DROPBOX_FOLDER' },
  },
  storage: {
    fields: ['endpoint', 'accessKeyId', 'secretAccessKey', 'bucket', 'region'],
    secretFields: ['accessKeyId', 'secretAccessKey'],
    requiredFields: ['endpoint', 'accessKeyId', 'secretAccessKey', 'bucket'],
    envFallback: { endpoint: 'S3_ENDPOINT', accessKeyId: 'S3_ACCESS_KEY_ID', secretAccessKey: 'S3_SECRET_ACCESS_KEY', bucket: 'S3_BUCKET', region: 'S3_REGION' },
  },
};

function schemaFor(type) {
  const schema = SCHEMAS[type];
  if (!schema) throw new Error(`Unknown connector type "${type}".`);
  return schema;
}

async function loadRow(type) {
  const rows = await query('SELECT * FROM connector_configs WHERE connector_type = ?', [type]);
  if (!rows.length) return null;
  return JSON.parse(rows[0].config_json);
}

// Full plain-value config for actually making API calls — DB value per
// field if set, else the legacy env var, else undefined.
async function getConfig(type) {
  const schema = schemaFor(type);
  const stored = await loadRow(type); // { field: plainValue | encryptedSecretString }
  const out = {};
  for (const field of schema.fields) {
    let value = stored ? stored[field] : undefined;
    if (value != null && schema.secretFields.includes(field)) value = secretBox.decrypt(value);
    if (value == null || value === '') value = process.env[schema.envFallback[field]] || undefined;
    out[field] = value;
  }
  return out;
}

async function isConnectorConfigured(type) {
  const schema = schemaFor(type);
  const config = await getConfig(type);
  return schema.requiredFields.every(f => !!config[f]);
}

// Frontend-safe status: non-secret values shown as-is, secret fields reduced
// to a boolean ("set" or not) — never the actual value.
async function getStatus(type) {
  const schema = schemaFor(type);
  const config = await getConfig(type);
  const fields = {};
  for (const field of schema.fields) {
    fields[field] = schema.secretFields.includes(field) ? { set: !!config[field] } : (config[field] || null);
  }
  return { configured: schema.requiredFields.every(f => !!config[f]), fields };
}

// Partial update — fields omitted from `updates` keep their existing stored
// value (so re-saving the folder path doesn't wipe an already-set secret).
async function setConfig(type, updates) {
  const schema = schemaFor(type);
  const existing = (await loadRow(type)) || {};
  const next = { ...existing };
  for (const field of schema.fields) {
    if (!(field in updates)) continue;
    const value = updates[field];
    if (value == null || value === '') { delete next[field]; continue; }
    next[field] = schema.secretFields.includes(field) ? secretBox.encrypt(value) : value;
  }
  const now = new Date().toISOString();
  const json = JSON.stringify(next);
  const current = await query('SELECT id FROM connector_configs WHERE connector_type = ?', [type]);
  if (current.length) {
    await query('UPDATE connector_configs SET config_json = ?, updated_at = ? WHERE connector_type = ?', [json, now, type]);
  } else {
    await query('INSERT INTO connector_configs (connector_type, config_json, updated_at) VALUES (?, ?, ?)', [type, json, now]);
  }
}

module.exports = { SCHEMAS, getConfig, isConnectorConfigured, getStatus, setConfig };
