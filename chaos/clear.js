#!/usr/bin/env node

/**
 * Chaos — clear the dev graph (DESTRUCTIVE, reusable wipe-and-redo).
 *
 * Empties the Orca dev graph CONTENT so Chaos can build on a clean slate, while
 * keeping all STRUCTURAL tables: the four seeded `attributes`, all `users`, and
 * every schema / config / moderation-infrastructure table.
 *
 * It runs, in a SINGLE TRANSACTION:
 *
 *   TRUNCATE concepts, edges, concept_links, combos, combo_edges, tunnel_links,
 *            comment_mentions
 *   RESTART IDENTITY CASCADE;
 *
 * RESTART IDENTITY resets the SERIAL id sequences so a fresh graph starts at id 1.
 * CASCADE truncates every table with a foreign key into the listed tables (votes,
 * addenda, subscriptions, etc. — printed in the report below).
 *
 * Why comment_mentions is listed explicitly: it is graph content (backreferences to
 * in-orca URLs in comments), but by design it has NO foreign keys (see ORCA_STATUS.md
 * "No FK on comment_mentions"). Because nothing FK-references it AND it FK-references
 * nothing, CASCADE would neither reach it nor be blocked by it — its rows would be
 * left orphaned, pointing at deleted concepts/links. Listing it directly keeps the
 * slate actually clean. It contains no structural data (no attributes, no users).
 *
 * KEEPS (never truncated): attributes, users, and all other tables.
 *
 * Connection: identical to chaos/snapshot.js — reuses the backend pg pool and
 * backend/.env, inventing no new connection config.
 *
 * Usage (BACK UP FIRST — see chaos workflow / backups/):
 *   node chaos/clear.js
 *
 * Safe to re-run; it is idempotent (truncating already-empty tables is a no-op).
 */

const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');

require(require.resolve('dotenv', { paths: [backendDir] })).config({
  path: path.join(backendDir, '.env'),
});

const pool = require(path.join(backendDir, 'src', 'config', 'database'));

// Tables named directly in the TRUNCATE. CASCADE expands this set to dependents.
const EXPLICIT_TRUNCATE = [
  'concepts',
  'edges',
  'concept_links',
  'combos',
  'combo_edges',
  'tunnel_links',
  'comment_mentions',
];

// Hard guard: these must never be emptied by this script.
const PROTECTED = ['attributes', 'users'];

async function tableCounts() {
  // Generic count over every base table in the public schema.
  const { rows } = await pool.query(`
    SELECT c.relname AS table,
           (xpath('/row/c/text()',
             query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                          false, true, '')))[1]::text::int AS rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public'
    ORDER BY c.relname
  `);
  const map = {};
  for (const r of rows) map[r.table] = r.rows;
  return map;
}

async function main() {
  console.log('Chaos clear — DESTRUCTIVE wipe of dev graph content.');
  console.log('Reuses backend pool / backend/.env.\n');

  const before = await tableCounts();

  // Run the truncate in one transaction.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE ${EXPLICIT_TRUNCATE.join(', ')} RESTART IDENTITY CASCADE`
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const after = await tableCounts();

  // Classify every table that changed.
  const explicitSet = new Set(EXPLICIT_TRUNCATE);
  const cascadeTruncated = [];
  const explicitReport = [];
  for (const table of Object.keys(before).sort()) {
    const b = before[table];
    const a = after[table] ?? 0;
    if (explicitSet.has(table)) {
      explicitReport.push({ table, before: b, after: a });
    } else if (b > 0 && a === 0) {
      cascadeTruncated.push({ table, before: b, after: a });
    }
  }

  // Safety assertions — fail loudly if a protected table was touched.
  for (const t of PROTECTED) {
    if ((after[t] ?? 0) !== (before[t] ?? 0)) {
      throw new Error(
        `PROTECTED table "${t}" changed: ${before[t]} -> ${after[t]} (aborting report).`
      );
    }
  }

  console.log('Explicitly truncated (RESTART IDENTITY):');
  for (const r of explicitReport) {
    console.log(`  ${r.table.padEnd(18)} ${r.before} -> ${r.after}`);
  }

  console.log('\nCASCADE also truncated (FK dependents):');
  if (cascadeTruncated.length === 0) {
    console.log('  (none had rows)');
  } else {
    for (const r of cascadeTruncated) {
      console.log(`  ${r.table.padEnd(22)} ${r.before} -> ${r.after}`);
    }
  }

  console.log('\nKept (structural — sample):');
  console.log(`  attributes         ${after.attributes}`);
  console.log(`  users              ${after.users}`);

  // Final sanity: the six content tables + comment_mentions all zero.
  const allZero = EXPLICIT_TRUNCATE.every((t) => (after[t] ?? 0) === 0);
  console.log(`\nAll listed content tables empty: ${allZero ? 'YES' : 'NO'}`);
}

main()
  .then(() => pool.end())
  .then(() => {
    console.log('\nDone. Connection closed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Clear failed:', err.message);
    pool.end().finally(() => process.exit(1));
  });
