// Encrypts connector secrets (API keys, tokens) before they're stored in the
// database. Requires CREDENTIAL_ENCRYPTION_KEY — a 32-byte key, base64-encoded
// (generate one with `openssl rand -base64 32`). This is the one secret that
// stays in a Railway variable; everything it protects lives in Postgres.

const crypto = require('crypto');

function getKey() {
  const b64 = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!b64) throw new Error('CREDENTIAL_ENCRYPTION_KEY is not set — cannot read or write connector secrets.');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return key;
}

// Returns "iv.authTag.ciphertext", each base64 — safe to store as plain TEXT.
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12); // GCM standard IV size
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map(b => b.toString('base64')).join('.');
}

function decrypt(encoded) {
  const [ivB64, authTagB64, ciphertextB64] = String(encoded).split('.');
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error('Malformed encrypted value.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

function isConfigured() {
  return !!process.env.CREDENTIAL_ENCRYPTION_KEY;
}

module.exports = { encrypt, decrypt, isConfigured };
