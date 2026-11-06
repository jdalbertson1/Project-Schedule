// Uploads files into a Dropbox folder using a long-lived refresh token
// (short-lived access tokens are exchanged for on every call — Dropbox no
// longer issues non-expiring tokens to new apps). Config comes from
// lib/connectors.js (DB-first, falling back to the legacy DROPBOX_APP_KEY/
// DROPBOX_APP_SECRET/DROPBOX_REFRESH_TOKEN/DROPBOX_FOLDER env vars).

const connectors = require('./connectors');

async function isConfigured() {
  return connectors.isConnectorConfigured('dropbox');
}

async function getAccessToken(config) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    client_id: config.appKey,
    client_secret: config.appSecret,
  });
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: params });
  if (!res.ok) throw new Error(`Dropbox token refresh failed (${res.status})`);
  const data = await res.json();
  return data.access_token;
}

async function uploadToDropbox(filename, buffer) {
  const config = await connectors.getConfig('dropbox');
  if (!config.appKey || !config.appSecret || !config.refreshToken) {
    throw new Error('Dropbox is not configured on the server yet.');
  }
  const token = await getAccessToken(config);
  const folder = (config.folder || '/Meetings').replace(/\/+$/, '');
  const dest = `${folder}/${filename}`.replace(/\/{2,}/g, '/');
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: dest, mode: 'overwrite', mute: true }),
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dropbox upload failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

module.exports = { isConfigured, uploadToDropbox };
