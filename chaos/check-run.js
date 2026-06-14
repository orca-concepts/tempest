#!/usr/bin/env node

/**
 * Chaos — post-run integrity checker (STRICTLY READ-ONLY).
 *
 * Run after every Phase A run to verify the pipeline wrote correct data to the dev DB.
 * Turns the mechanical checks in the first-runs runbook into one command. It performs
 * INTEGRITY CHECKS (PASS/FAIL; the process exits non-zero if any FAIL) and DIAGNOSTICS
 * (printed tables, never fail) used for the cross-run precision/decay watching.
 *
 * SAFETY: only SELECT / COUNT against the dev DB plus filesystem reads of
 * chaos/episodic/. No INSERT/UPDATE/DELETE, no DDL, no migration, no writes anywhere.
 * Reuses the exact connection posture of chaos/check-schema.js (backend pool +
 * backend/.env). Prints database name + host only. Refuses to run if the host looks
 * like the production Railway proxy — we never want diagnostics hitting production,
 * read-only or not.
 *
 * Usage:
 *   node chaos/check-run.js            # standing checks against current DB state
 *   node chaos/check-run.js --run 2    # also reconcile chaos/episodic/run-0002.json vs DB
 */

const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..', 'backend');
require(require.resolve('dotenv', { paths: [backendDir] })).config({
  path: path.join(backendDir, '.env'),
});
const pool = require(path.join(backendDir, 'src', 'config', 'database'));

const EPISODIC_DIR = path.join(__dirname, 'episodic');
const RUN_FILE_RE = /^run-(\d{4})\.json$/;

// --- CLI -------------------------------------------------------------------
function parseRunFlag() {
  const i = process.argv.indexOf('--run');
  if (i === -1) return null;
  const v = parseInt(process.argv[i + 1], 10);
  if (!Number.isInteger(v) || v < 1) {
    console.error('--run requires a positive integer run number (e.g. --run 2).');
    process.exit(2);
  }
  return v;
}
const RUN_N = parseRunFlag();

// --- Production guard (read-only, but never run against production) ---------
const PROD_MARKERS = ['switchback.proxy.rlwy.net', 'rlwy.net', 'railway'];
const looksProd = (s) => PROD_MARKERS.some((m) => String(s || '').toLowerCase().includes(m));

function resolveConn() {
  const o = pool.options || {};
  if (o.connectionString) {
    try {
      const u = new URL(o.connectionString);
      return {
        host: u.hostname || '(unknown)',
        port: u.port || '5432',
        database: decodeURIComponent((u.pathname || '').replace(/^\//, '')) || '(unknown)',
        via: 'DATABASE_URL',
      };
    } catch {
      return { host: '(unparseable connection string)', port: '?', database: '?', via: 'DATABASE_URL' };
    }
  }
  return {
    host: o.host || 'localhost',
    port: String(o.port || 5432),
    database: o.database || 'concept_hierarchy',
    via: 'discrete DB_* vars',
  };
}

// --- Result tracking -------------------------------------------------------
let anyFail = false;
function check(name, passed, detail) {
  const tag = passed ? '[PASS]' : '[FAIL]';
  if (!passed) anyFail = true;
  console.log(`  ${tag} ${name}${detail ? ' — ' + detail : ''}`);
}
function note(name, detail) {
  console.log(`  [ -- ] ${name}${detail ? ' — ' + detail : ''}`);
}

// --- Small query + table helpers -------------------------------------------
const q = (sql, params) => pool.query(sql, params);
const scalar = async (sql, params) => {
  const r = await q(sql, params);
  const row = r.rows[0] || {};
  return row[Object.keys(row)[0]];
};

function printTable(headers, rows) {
  if (rows.length === 0) {
    console.log('    (no rows)');
    return;
  }
  const cols = headers.map((h, i) => {
    const cells = rows.map((r) => String(r[i] == null ? '' : r[i]));
    return Math.max(h.length, ...cells.map((c) => c.length));
  });
  const fmtRow = (cells) =>
    '    ' + cells.map((c, i) => String(c == null ? '' : c).padEnd(cols[i])).join('  ');
  console.log(fmtRow(headers));
  console.log('    ' + cols.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(fmtRow(r));
}

async function columnExists(table, column) {
  const r = await q(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]
  );
  return r.rowCount > 0;
}

// --- Episodic filesystem helpers -------------------------------------------
function listRunFiles() {
  if (!fs.existsSync(EPISODIC_DIR)) return [];
  return fs
    .readdirSync(EPISODIC_DIR)
    .map((name) => {
      const m = RUN_FILE_RE.exec(name);
      return m ? { id: parseInt(m[1], 10), name } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);
}
function readIndex() {
  const p = path.join(EPISODIC_DIR, 'index.json');
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8').trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ===========================================================================
async function main() {
  const conn = resolveConn();
  console.log('======================================================================');
  console.log(' Chaos post-run integrity check  (READ-ONLY — no writes, no DDL)');
  console.log('======================================================================');
  console.log(`Connected database : ${conn.database}`);
  console.log(`Host               : ${conn.host}   (port ${conn.port}, via ${conn.via})`);
  if (RUN_N) console.log(`Reconciling run    : ${String(RUN_N).padStart(4, '0')}`);
  console.log('');

  if (looksProd(conn.host)) {
    console.error('*** GUARD TRIPPED ***');
    console.error(`Resolved host "${conn.host}" looks like the production Railway proxy.`);
    console.error('Refusing to run diagnostics against production. No queries were run.');
    await pool.end();
    process.exit(1);
  }

  // ====================== INTEGRITY CHECKS ==============================
  console.log('--- INTEGRITY CHECKS -------------------------------------------------');

  // 1. Detached links — every concept_link resolves to an existing edge.
  const detached = await q(
    `SELECT cl.id FROM concept_links cl
     LEFT JOIN edges e ON e.id = cl.edge_id
     WHERE e.id IS NULL`
  );
  check('detached links = 0', detached.rowCount === 0,
    detached.rowCount === 0 ? '0 detached' : `${detached.rowCount} link(s): ${detached.rows.map((r) => r.id).join(', ')}`);

  // 2. Orphan concepts — every concept is the child of at least one edge.
  //    Root concepts (child of a parent_id IS NULL edge) are reported for eyeballing.
  const orphanConcepts = await q(
    `SELECT id, name FROM concepts
     WHERE id NOT IN (SELECT child_id FROM edges)
     ORDER BY id`
  );
  check('no orphan concepts', orphanConcepts.rowCount === 0,
    orphanConcepts.rowCount === 0 ? 'all concepts are a child of >=1 edge'
      : `${orphanConcepts.rowCount} orphan(s): ${orphanConcepts.rows.map((r) => `${r.id}:${r.name}`).join(', ')}`);

  const rootConcepts = await q(
    `SELECT DISTINCT c.id, c.name
     FROM edges e JOIN concepts c ON c.id = e.child_id
     WHERE e.parent_id IS NULL
     ORDER BY c.name`
  );
  note(`root concepts (eyeball "no silent roots")`, `${rootConcepts.rowCount} root(s)`);
  if (rootConcepts.rowCount > 0) {
    printTable(['id', 'root concept'], rootConcepts.rows.map((r) => [r.id, r.name]));
  }

  // 3. Orphan edges — every edge's parent (if any) and child concept exist.
  const orphanEdges = await q(
    `SELECT e.id,
            (e.parent_id IS NOT NULL AND pc.id IS NULL) AS bad_parent,
            (cc.id IS NULL) AS bad_child
     FROM edges e
     LEFT JOIN concepts pc ON pc.id = e.parent_id
     LEFT JOIN concepts cc ON cc.id = e.child_id
     WHERE (e.parent_id IS NOT NULL AND pc.id IS NULL) OR cc.id IS NULL`
  );
  check('no orphan edges', orphanEdges.rowCount === 0,
    orphanEdges.rowCount === 0 ? 'all edges resolve parent + child'
      : `${orphanEdges.rowCount} edge(s): ${orphanEdges.rows.map((r) => r.id).join(', ')}`);

  // 4. Ledger fields — FAIL only if columns are ABSENT; report null distribution.
  const ledgerCols = [
    ['chaos_predictions', 'precision'],
    ['chaos_prediction_events', 'provenance'],
    ['chaos_prediction_events', 'severe'],
    ['chaos_prediction_events', 'surprise_level'],
  ];
  let ledgerColsOk = true;
  for (const [t, c] of ledgerCols) {
    const ok = await columnExists(t, c);
    if (!ok) ledgerColsOk = false;
    check(`ledger column ${t}.${c} present`, ok, ok ? 'present' : 'ABSENT');
  }
  if (ledgerColsOk) {
    const pr = await q(
      `SELECT COUNT(*) FILTER (WHERE precision IS NOT NULL)::int AS with_precision,
              COUNT(*) FILTER (WHERE precision IS NULL)::int AS null_precision
       FROM chaos_predictions WHERE target_type='concept'`
    );
    note('chaos_predictions.precision (concept targets)',
      `${pr.rows[0].with_precision} set / ${pr.rows[0].null_precision} null  (null is OK — reported, not failed)`);
    const ev = await q(
      `SELECT
         COUNT(*) FILTER (WHERE provenance='independent')::int AS prov_ind,
         COUNT(*) FILTER (WHERE provenance='targeted')::int    AS prov_tgt,
         COUNT(*) FILTER (WHERE provenance IS NULL)::int        AS prov_null,
         COUNT(*) FILTER (WHERE severe IS TRUE)::int            AS sev_true,
         COUNT(*) FILTER (WHERE severe IS FALSE)::int           AS sev_false,
         COUNT(*) FILTER (WHERE severe IS NULL)::int            AS sev_null,
         COUNT(*) FILTER (WHERE surprise_level='local')::int             AS sur_local,
         COUNT(*) FILTER (WHERE surprise_level='parent_unabsorbed')::int AS sur_parent,
         COUNT(*) FILTER (WHERE surprise_level IS NULL)::int             AS sur_null
       FROM chaos_prediction_events`
    );
    const e = ev.rows[0];
    note('chaos_prediction_events.provenance', `independent ${e.prov_ind} / targeted ${e.prov_tgt} / null ${e.prov_null}`);
    note('chaos_prediction_events.severe', `true ${e.sev_true} / false ${e.sev_false} / null ${e.sev_null}`);
    note('chaos_prediction_events.surprise_level', `local ${e.sur_local} / parent_unabsorbed ${e.sur_parent} / null ${e.sur_null}`);
  }

  // 5. Papers — every concept_link paper reference resolves to a papers row w/ openalex_id.
  const badPaperRefs = await q(
    `SELECT cl.id, cl.paper_id
     FROM concept_links cl
     LEFT JOIN papers p ON p.id = cl.paper_id
     WHERE cl.paper_id IS NOT NULL
       AND (p.id IS NULL OR p.openalex_id IS NULL OR p.openalex_id = '')`
  );
  const linkedPaperRefs = await scalar(`SELECT COUNT(*)::int AS n FROM concept_links WHERE paper_id IS NOT NULL`);
  check('paper references resolve', badPaperRefs.rowCount === 0,
    badPaperRefs.rowCount === 0 ? `${linkedPaperRefs} paper-linked link(s), all resolve to a paper with openalex_id`
      : `${badPaperRefs.rowCount} bad ref(s): ${badPaperRefs.rows.map((r) => `link ${r.id}->paper ${r.paper_id}`).join(', ')}`);

  // 6. Episodic — a run-*.json record exists for run content. PASS when the graph is
  //    empty and no run has happened yet; FAIL only when the DB holds run content but
  //    no episodic record was written (the real integrity violation this guards).
  const runFiles = listRunFiles();
  const highestRun = runFiles.length ? runFiles[runFiles.length - 1].id : null;
  const dbContent = await scalar(
    `SELECT (
       (SELECT COUNT(*) FROM concepts) +
       (SELECT COUNT(*) FROM chaos_predictions) +
       (SELECT COUNT(*) FROM chaos_prediction_events)
     )::int AS n`
  );
  const episodicOk = runFiles.length > 0 || dbContent === 0;
  check('episodic run record present', episodicOk,
    runFiles.length > 0
      ? `highest run found: ${String(highestRun).padStart(4, '0')} (${runFiles.length} file(s))`
      : dbContent === 0
        ? 'no runs recorded yet, and DB has no run content (consistent fresh state)'
        : `DB holds ${dbContent} run rows but NO chaos/episodic/run-*.json exists`);

  // ====================== DIAGNOSTICS (never fail) =====================
  console.log('\n--- DIAGNOSTICS ------------------------------------------------------');

  // Counts. (Single attribute domain post-v0.12, so no by-attribute breakdown.)
  const totals = await q(
    `SELECT
       (SELECT COUNT(*) FROM concepts)::int                  AS concepts,
       (SELECT COUNT(*) FROM edges)::int                     AS edges,
       (SELECT COUNT(*) FROM concept_links)::int             AS links,
       (SELECT COUNT(*) FROM tunnel_links)::int              AS tunnels,
       (SELECT COUNT(*) FROM papers)::int                    AS papers,
       (SELECT COUNT(*) FROM chaos_predictions)::int         AS predictions,
       (SELECT COUNT(*) FROM chaos_prediction_events)::int   AS events`
  );
  const t = totals.rows[0];
  console.log('\n• Totals:');
  printTable(
    ['concepts', 'edges', 'links', 'tunnels', 'papers', 'predictions', 'events'],
    [[t.concepts, t.edges, t.links, t.tunnels, t.papers, t.predictions, t.events]]
  );

  // Precision × recurrence (recurrence = independent confirmed events). Highlight >= 2.
  const precRec = await q(
    `SELECT p.target_id,
            c.name AS concept_name,
            p.precision,
            COALESCE(r.recurrence, 0)::int AS recurrence
     FROM chaos_predictions p
     -- concept events store target_id = the leaf EDGE id, so hop edge -> child concept
     -- for the name (joining concepts directly on target_id is only coincidentally right
     -- while no edge id collides with an unrelated concept id).
     LEFT JOIN edges e ON e.id = p.target_id
     LEFT JOIN concepts c ON c.id = e.child_id
     LEFT JOIN (
       SELECT target_id, COUNT(*) AS recurrence
       FROM chaos_prediction_events
       WHERE target_type='concept' AND event='confirmed'
         AND provenance IS DISTINCT FROM 'targeted'
       GROUP BY target_id
     ) r ON r.target_id = p.target_id
     WHERE p.target_type='concept'
     ORDER BY recurrence DESC, p.precision DESC NULLS LAST`
  );
  console.log('\n• Precision × recurrence (concept targets; recurrence = non-targeted confirmed events):');
  printTable(
    ['target_id', 'concept', 'precision', 'recurrence', 'watch'],
    precRec.rows.map((r) => [
      r.target_id,
      r.concept_name || `(id ${r.target_id})`,
      r.precision == null ? 'null' : r.precision,
      r.recurrence,
      r.recurrence >= 2 ? '<<< recurrence>=2' : '',
    ])
  );
  const watching = precRec.rows.filter((r) => r.recurrence >= 2);
  console.log(`  ${watching.length} concept(s) with recurrence >= 2 — track their precision rising across runs.`);

  // Low-confidence / decayed.
  const lowConf = await q(
    `SELECT p.target_id, c.name AS concept_name, p.precision,
            COALESCE(ea.cnt, 0)::int AS expected_absent
     FROM chaos_predictions p
     -- concept events store target_id = the leaf EDGE id; hop edge -> child concept for the name.
     LEFT JOIN edges e ON e.id = p.target_id
     LEFT JOIN concepts c ON c.id = e.child_id
     LEFT JOIN (
       SELECT target_id, COUNT(*) AS cnt FROM chaos_prediction_events
       WHERE target_type='concept' AND event='expected_absent'
       GROUP BY target_id
     ) ea ON ea.target_id = p.target_id
     WHERE p.target_type='concept'
     ORDER BY p.precision ASC NULLS FIRST, expected_absent DESC
     LIMIT 10`
  );
  console.log('\n• Lowest-precision / decayed concepts (bottom 10; expected_absent = decay signal):');
  printTable(
    ['target_id', 'concept', 'precision', 'expected_absent'],
    lowConf.rows.map((r) => [r.target_id, r.concept_name || `(id ${r.target_id})`, r.precision == null ? 'null' : r.precision, r.expected_absent])
  );

  // Multi-parent concepts (P17 — confirm intended distinct instances, not over-merges).
  const multiParent = await q(
    `SELECT e.child_id, c.name, COUNT(DISTINCT e.parent_id)::int AS parents
     FROM edges e JOIN concepts c ON c.id = e.child_id
     WHERE e.parent_id IS NOT NULL
     GROUP BY e.child_id, c.name
     HAVING COUNT(DISTINCT e.parent_id) > 1
     ORDER BY parents DESC, c.name`
  );
  console.log('\n• Multi-parent concepts (P17 — confirm intended distinct instances):');
  printTable(['child_id', 'concept', 'distinct parents'], multiParent.rows.map((r) => [r.child_id, r.name, r.parents]));

  // Growth since last run. index.json records proposal/accept counts, not DB counts, so
  // a true DB-count delta isn't feasible from it — we print current totals + last run's
  // recorded summary.
  const idx = readIndex();
  console.log('\n• Growth since last run:');
  if (idx.length === 0) {
    console.log('    No prior runs recorded in episodic/index.json — current totals above are the baseline.');
  } else {
    const last = idx[idx.length - 1];
    console.log(`    Last recorded run: ${String(last.run_id).padStart(4, '0')} (rubric ${last.rubric_version})`);
    console.log(`      proposals: ${last.proposal_count}, accepted: ${last.accept_count}`);
    console.log('    (index.json stores proposal/accept counts, not DB row counts — DB-count deltas across runs are not tracked there.)');
  }

  // ====================== --run N RECONCILIATION =======================
  if (RUN_N) {
    console.log('\n--- RUN RECONCILIATION (--run ' + RUN_N + ') ---------------------------------');
    const runPath = path.join(EPISODIC_DIR, `run-${String(RUN_N).padStart(4, '0')}.json`);
    if (!fs.existsSync(runPath)) {
      console.log(`    (no such episodic record: ${path.relative(process.cwd(), runPath)} — skipping reconciliation)`);
    } else {
      let rec;
      try {
        rec = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      } catch (err) {
        rec = null;
        console.log(`    Could not parse ${runPath}: ${err.message}`);
      }
      if (rec) {
        const proposals = Array.isArray(rec.proposals) ? rec.proposals : [];
        const outcomes = Array.isArray(rec.outcomes) ? rec.outcomes : [];
        const acceptedRefs = new Set(outcomes.filter((o) => o && o.decision === 'accept').map((o) => o.proposal_ref));
        // Count accepted proposals by type from the record.
        const byType = {};
        for (const p of proposals) {
          if (!acceptedRefs.has(p.ref)) continue;
          byType[p.type] = (byType[p.type] || 0) + 1;
        }
        console.log('    Accepted proposals in record, by type:');
        const typeRows = Object.keys(byType).sort().map((k) => [k, byType[k]]);
        printTable(['type', 'accepted'], typeRows);

        // DB side keyed on run_id (string match — run_id column is free-form text).
        const runId = String(RUN_N);
        const dbPred = await scalar(`SELECT COUNT(*)::int AS n FROM chaos_predictions WHERE run_id = $1`, [runId]);
        const dbEvents = await scalar(`SELECT COUNT(*)::int AS n FROM chaos_prediction_events WHERE run_id = $1`, [runId]);
        console.log('\n    DB rows tagged with this run_id:');
        printTable(['chaos_predictions', 'chaos_prediction_events'], [[dbPred, dbEvents]]);
        console.log('    (Best-effort reconciliation: concepts/links/edges carry no run_id, so only the');
        console.log('     prediction ledger can be matched by run_id. Counts are for human cross-checking.)');
      }
    }
  }

  // ====================== SUMMARY ======================================
  console.log('\n======================================================================');
  console.log(anyFail ? ' RESULT: FAIL — one or more integrity checks failed (see [FAIL] above).'
    : ' RESULT: PASS — all integrity checks passed.');
  console.log(' (Read-only: no rows were modified, no files were written.)');
  console.log('======================================================================');

  await pool.end();
  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error('\ncheck-run failed:', err.message);
  pool.end().finally(() => process.exit(1));
});
