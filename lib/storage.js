// Generic S3-compatible object storage for meeting recordings.
// Works against Cloudflare R2 (recommended — zero egress fees) or real AWS S3
// by pointing S3_ENDPOINT at whichever one you're using.
// Requires S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET.

const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REQUIRED_VARS = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET'];

function missingVars() {
  return REQUIRED_VARS.filter(v => !process.env[v]);
}

function isConfigured() {
  return missingVars().length === 0;
}

let client = null;
function getClient() {
  if (!isConfigured()) throw new Error('Recording storage is not configured on the server yet.');
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

// Random, non-sequential key so recordings can't be enumerated by guessing.
function newKey(originalFilename) {
  const safe = String(originalFilename || 'recording').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `recordings/${crypto.randomBytes(16).toString('hex')}-${safe}`;
}

// Presigned PUT so the browser uploads the (potentially multi-GB) file
// directly to the bucket — the Railway server never sees the bytes.
async function presignUpload(key, contentType) {
  const cmd = new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(getClient(), cmd, { expiresIn: 15 * 60 }); // 15 min to complete the upload
}

// Short-lived GET — regenerated fresh on every visit to the permanent /r/:token
// link, so the link itself never expires even though each underlying URL does.
async function presignDownload(key, filename) {
  const cmd = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ResponseContentDisposition: filename ? `inline; filename="${filename.replace(/"/g, '')}"` : undefined,
  });
  return getSignedUrl(getClient(), cmd, { expiresIn: 60 * 60 }); // 1 hour
}

async function deleteObject(key) {
  await getClient().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
}

module.exports = { isConfigured, missingVars, newKey, presignUpload, presignDownload, deleteObject };
