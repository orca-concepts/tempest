#!/usr/bin/env node

/**
 * Backfill comment_mentions from existing comments and addenda.
 *
 * Usage:
 *   node scripts/backfill-mentions.js            # real run
 *   node scripts/backfill-mentions.js --dry-run   # preview only
 *
 * Idempotent: DELETE-then-INSERT per source row, safe to re-run.
 */

require('dotenv').config();
const pool = require('../src/config/database');
const { parseMentions } = require('../src/utils/parseMentions');

const isDryRun = process.argv.includes('--dry-run');

async function backfillSource(sourceType, query, textColumn) {
  const result = await pool.query(query);
  let mentionCount = 0;

  for (const row of result.rows) {
    const text = row[textColumn];
    if (!text) continue;

    const mentions = parseMentions(text);
    if (mentions.length === 0) continue;

    if (isDryRun) {
      mentionCount += mentions.length;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing mentions for this source (idempotency)
      await client.query(
        'DELETE FROM comment_mentions WHERE source_type = $1 AND source_id = $2',
        [sourceType, row.id]
      );

      for (const m of mentions) {
        await client.query(
          `INSERT INTO comment_mentions (source_type, source_id, target_type, target_id, target_path)
           VALUES ($1, $2, $3, $4, $5)`,
          [sourceType, row.id, m.targetType, m.targetId, m.targetPath]
        );
      }

      await client.query('COMMIT');
      mentionCount += mentions.length;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Error backfilling ${sourceType} id=${row.id}:`, err.message);
    } finally {
      client.release();
    }
  }

  console.log(`  ${sourceType}: scanned ${result.rows.length} rows, ${mentionCount} mention rows ${isDryRun ? 'would be' : ''} produced`);
  return mentionCount;
}

async function main() {
  console.log(isDryRun ? 'DRY RUN — no writes will be performed\n' : 'Backfilling mentions...\n');

  let total = 0;

  total += await backfillSource(
    'concept_link_comment',
    'SELECT id, comment FROM concept_links WHERE comment IS NOT NULL AND comment != \'\'',
    'comment'
  );

  total += await backfillSource(
    'concept_link_addendum',
    'SELECT id, body FROM concept_link_addenda',
    'body'
  );

  total += await backfillSource(
    'tunnel_link_comment',
    'SELECT id, comment FROM tunnel_links WHERE comment IS NOT NULL AND comment != \'\'',
    'comment'
  );

  total += await backfillSource(
    'tunnel_link_addendum',
    'SELECT id, body FROM tunnel_link_addenda',
    'body'
  );

  console.log(`\nTotal: ${total} mention rows ${isDryRun ? 'would be' : ''} produced`);
  process.exit(0);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
