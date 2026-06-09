#!/usr/bin/env node

/**
 * Chaos — read-only database snapshot.
 *
 * Reads the current Orca dev graph (concepts, edges, links, situations/combos,
 * tunnels) into a single structured object and writes it to chaos/snapshot.json.
 *
 * This is the "Snapshot" plumbing stage of the Chaos pipeline (chaos.md §8.1).
 * It is READ-ONLY: every query is a SELECT. It performs no INSERT/UPDATE/DELETE,
 * no migrations, and no external API calls.
 *
 * Connection: reuses the backend's existing pg pool and env vars verbatim
 * (backend/src/config/database.js). We load backend/.env explicitly first so the
 * pool picks up the same DB_HOST/DB_NAME/... (or DATABASE_URL) the API server uses;
 * dotenv does not override already-set vars, so the pool's own dotenv call is a
 * no-op. No new connection configuration is invented here.
 *
 * Usage (from repo root or anywhere):
 *   node chaos/snapshot.js
 */

const path = require('path');
const fs = require('fs');

// Dependencies (dotenv, pg) live in backend/node_modules, not in chaos/. Resolve
// them from the backend so we reuse the exact same installed packages as the API
// server rather than inventing a separate dependency set for chaos/.
const backendDir = path.join(__dirname, '..', 'backend');

// Load the backend's env BEFORE requiring its pool, so the pool reads the same
// configuration the backend uses. Explicit path because cwd may not be backend/.
require(require.resolve('dotenv', { paths: [backendDir] })).config({
  path: path.join(backendDir, '.env'),
});

// The pool module itself resolves pg + dotenv from backend/node_modules (it lives
// inside backend/), so requiring it by absolute path works without extra plumbing.
const pool = require(path.join(backendDir, 'src', 'config', 'database'));

const OUTPUT_PATH = path.join(__dirname, 'snapshot.json');

async function main() {
  console.log('Chaos snapshot — connecting to the Orca dev database (read-only)...');

  // --- Attributes (the four domains: value, action, tool, question) ---
  const attributes = (
    await pool.query(`
      SELECT id, name
      FROM attributes
      ORDER BY id
    `)
  ).rows;

  const attrNameById = new Map(attributes.map((a) => [a.id, a.name]));

  // --- Concepts ---
  const concepts = (
    await pool.query(`
      SELECT id, name, created_by, created_at
      FROM concepts
      ORDER BY id
    `)
  ).rows;

  // --- Edges (grouped by attribute below) ---
  const edges = (
    await pool.query(`
      SELECT id, parent_id, child_id, graph_path, attribute_id, is_hidden,
             created_by, created_at
      FROM edges
      ORDER BY id
    `)
  ).rows;

  // Group edges by attribute name (chaos.md models the graph by domain).
  // Edges whose attribute_id has no match land under "unknown".
  const edgesByAttribute = {};
  for (const a of attributes) edgesByAttribute[a.name] = [];
  for (const e of edges) {
    const attrName = attrNameById.get(e.attribute_id) || 'unknown';
    if (!edgesByAttribute[attrName]) edgesByAttribute[attrName] = [];
    edgesByAttribute[attrName].push(e);
  }

  // --- Concept links (external reference URLs attached to edges) ---
  const conceptLinks = (
    await pool.query(`
      SELECT id, edge_id, url, title, comment, added_by, created_at
      FROM concept_links
      ORDER BY id
    `)
  ).rows;

  // --- Situations (combos) and their member edges ---
  const combos = (
    await pool.query(`
      SELECT id, name, description, created_by, created_at
      FROM combos
      ORDER BY id
    `)
  ).rows;

  const comboEdges = (
    await pool.query(`
      SELECT id, combo_id, edge_id, added_at
      FROM combo_edges
      ORDER BY id
    `)
  ).rows;

  // --- Tunnel links (bidirectional cross-graph connections) ---
  const tunnelLinks = (
    await pool.query(`
      SELECT id, origin_edge_id, linked_edge_id, comment, created_by, created_at
      FROM tunnel_links
      ORDER BY id
    `)
  ).rows;

  const snapshot = {
    meta: {
      generated_at: new Date().toISOString(),
      database: process.env.DB_NAME || '(from DATABASE_URL)',
      read_only: true,
      source: 'chaos/snapshot.js',
    },
    counts: {
      attributes: attributes.length,
      concepts: concepts.length,
      edges: edges.length,
      concept_links: conceptLinks.length,
      combos: combos.length,
      combo_edges: comboEdges.length,
      tunnel_links: tunnelLinks.length,
    },
    attributes,
    concepts,
    edges_by_attribute: edgesByAttribute,
    concept_links: conceptLinks,
    combos,
    combo_edges: comboEdges,
    tunnel_links: tunnelLinks,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');

  console.log(`\nWrote ${OUTPUT_PATH}\n`);
  console.log('Row counts (read from DB):');
  for (const [table, n] of Object.entries(snapshot.counts)) {
    console.log(`  ${table.padEnd(16)} ${n}`);
  }
  console.log('\nEdges by attribute:');
  for (const [attr, list] of Object.entries(edgesByAttribute)) {
    console.log(`  ${attr.padEnd(16)} ${list.length}`);
  }
}

main()
  .then(() => pool.end())
  .then(() => {
    console.log('\nDone. Connection closed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Snapshot failed:', err.message);
    pool.end().finally(() => process.exit(1));
  });
