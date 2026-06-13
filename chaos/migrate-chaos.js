#!/usr/bin/env node

/**
 * Chaos — support-schema migration (Stage 4). LOCAL DEV ONLY.
 *
 * Adds the tables Chaos needs to model papers over time (flagged as gaps in
 * chaos/SCHEMA_NOTES.md §2) plus the dedicated seed account for attributing
 * seeded content. It is ADDITIVE and IDEMPOTENT — every statement is
 * CREATE/ALTER ... IF NOT EXISTS or an ON CONFLICT upsert, so re-running is safe.
 *
 * WHY a standalone script and not backend/src/config/migrate.js:
 *   The app's deploy path runs `node backend/src/config/migrate.js` on every
 *   Railway start (see backend package.json "start"). Putting this DDL there would
 *   apply it to PRODUCTION on the next deploy. This migration is dev-seeding
 *   infrastructure, so it lives in chaos/ alongside the other manually-run chaos
 *   scripts (snapshot.js, source.js, reason.js) and is invoked by hand:
 *       node chaos/migrate-chaos.js
 *   It follows migrate.js's conventions verbatim (single transaction, IF NOT
 *   EXISTS guards, DO-block-free idempotent ALTERs) but never touches the deploy
 *   path, so production stays untouched until someone deliberately promotes it.
 *
 * Connection: reuses the backend's pg pool + env exactly like chaos/snapshot.js.
 */

const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');
require(require.resolve('dotenv', { paths: [backendDir] })).config({
  path: path.join(backendDir, '.env'),
});
const pool = require(path.join(backendDir, 'src', 'config', 'database'));

// Seed-account identity. ORCID is NOT NULL on users (ORCID-first platform), so the
// system account gets a clearly-synthetic sentinel ORCID that cannot collide with a
// real one. Login is disabled by a non-bcrypt password_hash (bcrypt.compare can
// never match a string that isn't a $2 hash), since the schema has no is_active flag.
const SEED_USERNAME = 'chaos-seed';
const SEED_EMAIL = 'chaos-seed@orcaconcepts.org';
// orcid_id is VARCHAR(19) (a real ORCID iD is exactly 19 chars). This sentinel is
// ≤19 chars and starts with letters, so it can never collide with a real all-digit
// ORCID and is obviously the system account.
const SEED_ORCID = 'CHAOS-SEED-ACCOUNT';
const SEED_PASSWORD_HASH = 'CHAOS_SEED_LOGIN_DISABLED'; // not a bcrypt hash → no login

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ========================================================================
    // 1. papers — one row per sourced paper (SCHEMA_NOTES §2a). Shaped from
    //    chaos/papers/index.json. openalex_id is the hard identity; doi, arxiv_id,
    //    and a normalized OA url are the secondary dedupe keys.
    // ========================================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS papers (
        id SERIAL PRIMARY KEY,
        openalex_id TEXT UNIQUE NOT NULL,
        doi TEXT,
        arxiv_id TEXT,
        url_normalized TEXT,
        title TEXT,
        publication_year INTEGER,
        host_venue TEXT,
        authors TEXT[],
        abstract TEXT,
        discipline_tags TEXT[],
        full_text_available BOOLEAN NOT NULL DEFAULT false,
        referenced_works_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Secondary-identity dedupe keys: DOI and arXiv id are globally unique when
    // present, so enforce uniqueness only over non-null values. The normalized URL
    // is a lookup aid (publisher landing pages can legitimately repeat), so it is
    // indexed but not unique.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_doi
        ON papers (doi) WHERE doi IS NOT NULL;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_arxiv
        ON papers (arxiv_id) WHERE arxiv_id IS NOT NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_papers_url_normalized
        ON papers (url_normalized);
    `);

    // ========================================================================
    // 2. paper_citations — within-corpus (citing → cited) edges (SCHEMA_NOTES
    //    §2b), derived at apply time from each paper's referenced_works. Composite
    //    PK; both ends FK → papers. Self-citation is disallowed.
    // ========================================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS paper_citations (
        citing_paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        cited_paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (citing_paper_id, cited_paper_id),
        CHECK (citing_paper_id <> cited_paper_id)
      );
    `);
    // PK indexes (citing, cited); add the reverse index for "who cites paper X".
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_paper_citations_cited
        ON paper_citations (cited_paper_id);
    `);

    // ========================================================================
    // 3. concept_links gains a NULLABLE paper_id FK → papers (SCHEMA_NOTES §2a).
    //    User-pasted links keep NULL; Chaos-applied links point at their paper.
    //    ON DELETE SET NULL so removing a paper never deletes a user's link. Any
    //    query joining users/papers through this column must LEFT JOIN (the
    //    LEFT JOIN convention — links can be NULL on either provenance FK).
    // ========================================================================
    await client.query(`
      ALTER TABLE concept_links
        ADD COLUMN IF NOT EXISTS paper_id INTEGER REFERENCES papers(id) ON DELETE SET NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concept_links_paper
        ON concept_links (paper_id);
    `);

    // ========================================================================
    // 4. Prediction ledger (chaos.md P14, §8 learning model; SCHEMA_NOTES §2c).
    //
    //    chaos_predictions  — the standing prediction TEXT each concept/situation
    //      makes (chaos.md §10). ONE per target, so it lives in its own table with
    //      UNIQUE(target_type, target_id), upsertable when the prediction is
    //      refined. Putting the text on the event log instead would duplicate it
    //      across every observation and conflate "the prediction" with "an
    //      observation of it".
    //
    //    chaos_prediction_events — APPEND-ONLY observation log. One row per
    //      (run, target, observation). Confirmed / expected-but-absent /
    //      appeared-elsewhere are recorded as events; the COUNTS chaos.md derives
    //      from them (P13 recurrence, P14 decay) are computed by query at read
    //      time, never stored. No updated_at — appends only.
    //
    //    Both use a polymorphic (target_type, target_id) with NO FK on target_id
    //    (concept targets are edges/concepts, situation targets are combos —
    //    different tables), matching Orca's existing comment_mentions /
    //    sidebar_items polymorphic-no-FK convention. CHECK constraints pin the
    //    enumerations. run_id is a free-form run label (the episodic run store is
    //    not built yet — chaos.md §8).
    // ========================================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS chaos_predictions (
        id SERIAL PRIMARY KEY,
        target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('concept', 'situation')),
        target_id INTEGER NOT NULL,
        prediction TEXT NOT NULL,
        run_id VARCHAR(64),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (target_type, target_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chaos_prediction_events (
        id SERIAL PRIMARY KEY,
        target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('concept', 'situation')),
        target_id INTEGER NOT NULL,
        run_id VARCHAR(64),
        event VARCHAR(24) NOT NULL
          CHECK (event IN ('confirmed', 'expected_absent', 'appeared_elsewhere')),
        paper_id INTEGER REFERENCES papers(id) ON DELETE SET NULL,
        noted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chaos_pred_events_target
        ON chaos_prediction_events (target_type, target_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chaos_pred_events_run
        ON chaos_prediction_events (run_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chaos_pred_events_paper
        ON chaos_prediction_events (paper_id);
    `);

    // ========================================================================
    // 4b. chaos_situation_meta — the situation metadata that the combos schema has
    //     no room for (chaos.md §5; Stage-5 feedback). A situation (= combo) is a
    //     cost/benefit MOMENT: it carries a lifecycle phase, an intersection
    //     reading list, and a core-spine / toggleable split. combos holds only
    //     name + description, so this side table extends it 1:1.
    //
    //     Types: combo_id is the PK *and* FK → combos ON DELETE CASCADE, so the
    //     metadata is owned by exactly one combo and dies with it. The three lists
    //     are flat arrays of short scalars — reading_list = openalex work ids;
    //     core_spine / toggleable = canonical concept names — so TEXT[] is the
    //     natural fit (queryable with array operators, matches the existing
    //     papers.authors / papers.discipline_tags TEXT[] convention). JSONB would
    //     be overkill: there is no nesting or key/value structure to preserve.
    //     lifecycle_phase is a single short label → VARCHAR(64).
    // ========================================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS chaos_situation_meta (
        combo_id INTEGER PRIMARY KEY REFERENCES combos(id) ON DELETE CASCADE,
        lifecycle_phase VARCHAR(64),
        reading_list TEXT[],
        core_spine TEXT[],
        toggleable TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ------------------------------------------------------------------------
    // chaos.md v0.9/v0.10 situation fields (Stage-5 revision). Added as separate
    // idempotent ADD COLUMN IF NOT EXISTS so an existing dev DB only gains the
    // new columns (the base table above is untouched on re-run).
    //
    //   ideal_anchor        §5 ideal-anchored spine: the single most-central
    //                       member (the "ideal"). A scalar concept name → TEXT,
    //                       nullable (a fresh proposal may not designate one yet).
    //   entrenchment_status §5 ad-hoc→established lifecycle. A small closed set,
    //                       so a CHECK enum (matches the Phase-65b house style),
    //                       NOT NULL DEFAULT 'ad-hoc' (every fresh situation
    //                       starts ad-hoc; the default also back-fills any row
    //                       that predates this column).
    //   recurrence_count    P13/P16 situations carry their OWN validation track,
    //                       distinct from per-concept ledgers. A derived counter
    //                       snapshot → INTEGER DEFAULT 0.
    //   precision           P16 sharpness of the situation's standing prediction.
    //                       NUMERIC, nullable (no track yet on a fresh proposal).
    //   domain_balance      §5 the four-column spread PLUS an `under_budgeted`
    //                       flag. This one IS a structured object (keyed counts +
    //                       a boolean), so JSONB is the right fit — unlike the
    //                       flat scalar arrays above (reading_list/core_spine/
    //                       toggleable = TEXT[]). JSONB preserves the keys without
    //                       inventing five more columns.
    // ------------------------------------------------------------------------
    await client.query(`ALTER TABLE chaos_situation_meta ADD COLUMN IF NOT EXISTS ideal_anchor TEXT;`);
    await client.query(`
      ALTER TABLE chaos_situation_meta
        ADD COLUMN IF NOT EXISTS entrenchment_status TEXT NOT NULL DEFAULT 'ad-hoc'
          CHECK (entrenchment_status IN ('ad-hoc', 'established'));
    `);
    await client.query(`ALTER TABLE chaos_situation_meta ADD COLUMN IF NOT EXISTS recurrence_count INTEGER NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE chaos_situation_meta ADD COLUMN IF NOT EXISTS precision NUMERIC;`);
    await client.query(`ALTER TABLE chaos_situation_meta ADD COLUMN IF NOT EXISTS domain_balance JSONB;`);

    // ========================================================================
    // 5. Chaos seed account (chaos.md §8 "Operational notes"; SCHEMA_NOTES §2d).
    //    A dedicated, login-disabled system user that owns every Chaos-applied
    //    contribution (created_by / added_by), for clean provenance and a clean
    //    handoff when real users arrive. Idempotent via ON CONFLICT on username.
    // ========================================================================
    await client.query(
      `INSERT INTO users (username, email, password_hash, orcid_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (username) DO NOTHING`,
      [SEED_USERNAME, SEED_EMAIL, SEED_PASSWORD_HASH, SEED_ORCID]
    );
    const seed = await client.query('SELECT id FROM users WHERE username = $1', [SEED_USERNAME]);
    const seedId = seed.rows[0] && seed.rows[0].id;

    await client.query('COMMIT');

    console.log('Chaos Stage-4 migration applied (local dev, additive + idempotent).');
    console.log('  + papers');
    console.log('  + paper_citations');
    console.log('  + concept_links.paper_id (nullable FK → papers, ON DELETE SET NULL)');
    console.log('  + chaos_predictions');
    console.log('  + chaos_prediction_events (append-only)');
    console.log('  + chaos_situation_meta (+ v0.9/v0.10 cols: ideal_anchor, entrenchment_status, recurrence_count, precision, domain_balance)');
    console.log(`  + seed user "${SEED_USERNAME}" (login disabled) — id = ${seedId}`);
    return seedId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

migrate()
  .then(() => pool.end())
  .then(() => {
    console.log('\nDone. Connection closed.');
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error('Chaos migration failed:', err.message);
    pool.end().finally(() => {
      process.exitCode = 1;
    });
  });
