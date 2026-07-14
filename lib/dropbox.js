// Uploads files into a dedicated Dropbox app folder using a long-lived refresh
// token (short-lived access tokens are exchanged for on every call — Dropbox
// no longer issues non-expiring tokens to new apps).
// Requires DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN env vars.

function isConfigured() {
  return !!(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN);
}

async function getAccessToken() {
  const { DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN } = process.env;
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: DROPBOX_REFRESH_TOKEN,
    client_id: DROPBOX_APP_KEY,
    client_secret: DROPBOX_APP_SECRET,
  });
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: params });
  if (!res.ok) throw new Error(`Dropbox token refresh failed (${res.status})`);
  const data = await res.json();
  return data.access_token;
}

async function uploadToDropbox(filename, buffer) {
  if (!isConfigured()) throw new Error('Dropbox is not configured on the server yet.');
  const token = await getAccessToken();
  const folder = (process.env.DROPBOX_FOLDER || '/Meetings').replace(/\/+$/, '');
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
