// Generic S3-compatible object storage for meeting recordings.
// Works against Cloudflare R2 (recommended — zero egress fees) or real AWS S3
// by pointing the endpoint at whichever one you're using. Config now comes
// from lib/connectors.js (DB-first, falling back to the legacy
// S3_ENDPOINT/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_BUCKET/S3_REGION env
// vars) so it can be set from the Connectors settings screen instead of a
// Railway variable.

const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const connectors = require('./connectors');

async function isConfigured() {
  return connectors.isConnectorConfigured('storage');
}

// Builds a fresh client per call rather than memoizing one — config can now
// change at runtime via the Connectors UI, and a cached client with stale
// credentials would silently keep using them until a restart. Constructing
// an S3Client is cheap (no network call), so this costs nothing meaningful.
async function getClient() {
  const config = await connectors.getConfig('storage');
  if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
    throw new Error('Recording storage is not configured on the server yet.');
  }
  const client = new S3Client({
    region: config.region || 'auto',
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return { client, bucket: config.bucket };
}

// Random, non-sequential key so recordings can't be enumerated by guessing.
function newKey(originalFilename) {
  const safe = String(originalFilename || 'recording').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `recordings/${crypto.randomBytes(16).toString('hex')}-${safe}`;
}

// Presigned PUT so the browser uploads the (potentially multi-GB) file
// directly to the bucket — the server never sees the bytes.
async function presignUpload(key, contentType) {
  const { client, bucket } = await getClient();
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(client, cmd, { expiresIn: 15 * 60 }); // 15 min to complete the upload
}

// Short-lived GET — regenerated fresh on every visit to the permanent /r/:token
// link, so the link itself never expires even though each underlying URL does.
async function presignDownload(key, filename) {
  const { client, bucket } = await getClient();
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: filename ? `inline; filename="${filename.replace(/"/g, '')}"` : undefined,
  });
  return getSignedUrl(client, cmd, { expiresIn: 60 * 60 }); // 1 hour
}

async function deleteObject(key) {
  const { client, bucket } = await getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

module.exports = { isConfigured, newKey, presignUpload, presignDownload, deleteObject };
