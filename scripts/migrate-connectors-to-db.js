// One-time migration: copies connector credentials from Railway environment
// variables into the encrypted connector_configs table, so the app can run
// entirely off DB-stored config going forward.
//
// Safe to re-run: skips any connector type that already has a stored row,
// so it never overwrites a config someone has since edited through the
// Connectors settings UI. Never logs secret values.
//
// Usage: railway run node scripts/migrate-connectors-to-db.js
//    or: DATABASE_URL=... node scripts/migrate-connectors-to-db.js

const { init, query } = require('../db');
const { SCHEMAS, setConfig } = require('../lib/connectors');

async function main() {
  await init();

  for (const [type, schema] of Object.entries(SCHEMAS)) {
    const existing = await query('SELECT id FROM connector_configs WHERE connector_type = ?', [type]);
    if (existing.length) {
      console.log(`[${type}] already has a stored config — skipping.`);
      continue;
    }

    const fromEnv = {};
    let anyFound = false;
    for (const field of schema.fields) {
      const envVar = schema.envFallback[field];
      const value = process.env[envVar];
      if (value) { fromEnv[field] = value; anyFound = true; }
    }

    if (!anyFound) {
      console.log(`[${type}] no env vars set — nothing to migrate.`);
      continue;
    }

    await setConfig(type, fromEnv);
    const fieldsSet = Object.keys(fromEnv).join(', ');
    console.log(`[${type}] migrated from env vars (fields: ${fieldsSet}).`);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
