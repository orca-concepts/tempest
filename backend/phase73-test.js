// Phase 73 scripted API tests. Runs against a backend on PORT 5050 and a shared
// dev database. Creates throwaway communities + users, exercises every endpoint,
// verifies via SQL, then cleans up. Writes results to test-results-section-73.md.
require('dotenv').config();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const fs = require('fs');

const BASE = 'http://localhost:5050/api';
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});

const results = [];
let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; results.push(`- [x] ${name}`); }
  else { failed++; results.push(`- [ ] FAIL: ${name}${detail ? ' — ' + detail : ''}`); console.error('FAIL:', name, detail || ''); }
}

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

const created = { communities: [], users: [] };
let attrId;

let commCounter = 0;
async function mkCommunity(name, mode) {
  const uniq = Date.now() + '-' + (commCounter++) + '-' + Math.floor(Math.random() * 100000);
  const fullName = `${name} ${uniq}`;
  const r = await pool.query(
    `INSERT INTO communities (name, slug, mode, created_by) VALUES ($1, $2, $3, NULL) RETURNING id`,
    [fullName, 'p73-' + uniq, mode]
  );
  created.communities.push(r.rows[0].id);
  return r.rows[0].id;
}
async function mkUser(username) {
  const r = await pool.query(
    `INSERT INTO users (username, email, password_hash, orcid_id) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [username + Date.now(), username + Date.now() + '@test.local', '0000-0000-0000-' + String(Math.floor(1000 + Math.random() * 8999))]
  );
  created.users.push(r.rows[0].id);
  return r.rows[0].id;
}
function tokenFor(userId) { return jwt.sign({ userId }, process.env.JWT_SECRET); }
async function addOwner(communityId, userId) {
  await pool.query(`INSERT INTO community_owners (community_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [communityId, userId]);
}
async function mkConcept(name, communityId) {
  const r = await pool.query(`INSERT INTO concepts (name, community_id, created_by) VALUES ($1, $2, NULL) RETURNING id`, [name, communityId]);
  return r.rows[0].id;
}
async function mkEdge(parentId, childId, graphPath, opts = {}) {
  const lit = '{' + graphPath.join(',') + '}';
  const r = await pool.query(
    `INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by, is_hidden, deleted_at, delete_batch_id)
     VALUES ($1, $2, $3::int[], $4, NULL, $5, $6, $7) RETURNING id`,
    [parentId, childId, lit, attrId, !!opts.deleted, opts.deleted ? new Date() : null, opts.deleted ? '11111111-1111-1111-1111-111111111111' : null]
  );
  return r.rows[0].id;
}
async function mkSeq(fromEdge, toEdge) {
  const r = await pool.query(`INSERT INTO question_sequence_links (from_edge_id, to_edge_id, created_by) VALUES ($1,$2,NULL) RETURNING id`, [fromEdge, toEdge]);
  return r.rows[0].id;
}
async function mkAnswer(edgeId) {
  const r = await pool.query(`INSERT INTO concept_links (edge_id, url, title, published_on, added_by) VALUES ($1,'http://ex.com','T','2024-01-01',NULL) RETURNING id`, [edgeId]);
  return r.rows[0].id;
}
async function mkFeedback(communityId, edgeId) {
  const r = await pool.query(
    `INSERT INTO feedback_items (community_id, edge_id, kind, snapshot, comment, status) VALUES ($1,$2,'general','{}'::jsonb,'c','open') RETURNING id`,
    [communityId, edgeId]
  );
  return r.rows[0].id;
}
async function mkTab(userId, conceptId, graphPath) {
  const r = await pool.query(`INSERT INTO graph_tabs (user_id, tab_type, concept_id, path) VALUES ($1,'child',$2,$3::int[]) RETURNING id`, [userId, conceptId, '{' + graphPath.join(',') + '}']);
  return r.rows[0].id;
}
async function edgePath(id) {
  const r = await pool.query('SELECT graph_path, parent_id, deleted_at FROM edges WHERE id=$1', [id]);
  return r.rows[0] ? { path: r.rows[0].graph_path, parent: r.rows[0].parent_id, deleted: !!r.rows[0].deleted_at } : null;
}
function pathEq(a, b) { return (a || []).join(',') === b.join(','); }
async function tabPath(id) { const r = await pool.query('SELECT path FROM graph_tabs WHERE id=$1', [id]); return r.rows[0] ? r.rows[0].path : null; }
async function seqExists(id) { const r = await pool.query('SELECT 1 FROM question_sequence_links WHERE id=$1', [id]); return r.rows.length > 0; }
async function rowCounts() {
  const q = async (t) => parseInt((await pool.query(`SELECT COUNT(*)::int c FROM ${t}`)).rows[0].c, 10);
  return { edges: await q('edges'), concepts: await q('concepts'), seq: await q('question_sequence_links'), links: await q('concept_links') };
}

async function run() {
  attrId = (await pool.query(`SELECT id FROM attributes WHERE name='question'`)).rows[0].id;

  const curated = await mkCommunity('P73 Curated', 'curated');
  const open = await mkCommunity('P73 Open', 'open');
  const ownerId = await mkUser('p73owner');
  const readerId = await mkUser('p73reader');
  await addOwner(curated, ownerId);
  await addOwner(open, ownerId);
  const ownerTok = tokenFor(ownerId);
  const readerTok = tokenFor(readerId);

  // ---- Build a curated graph in a FRESH curated community (so concept names R,A,…
  // never collide across builds): R > {A,B,C}; A > {A1,A2}; A1 > A1x; A2 > Adel(del) ----
  async function buildCurated() {
    const cid = await mkCommunity('P73 C', 'curated');
    await addOwner(cid, ownerId);
    const R = await mkConcept('R', cid);
    const A = await mkConcept('A', cid), B = await mkConcept('B', cid), C = await mkConcept('C', cid);
    const A1 = await mkConcept('A1', cid), A2 = await mkConcept('A2', cid), A1x = await mkConcept('A1x', cid), Adel = await mkConcept('Adel', cid);
    const eR = await mkEdge(null, R, []);
    const eA = await mkEdge(R, A, [R]), eB = await mkEdge(R, B, [R]), eC = await mkEdge(R, C, [R]);
    const eA1 = await mkEdge(A, A1, [R, A]), eA2 = await mkEdge(A, A2, [R, A]);
    const eA1x = await mkEdge(A1, A1x, [R, A, A1]);
    const eAdel = await mkEdge(A2, Adel, [R, A, A2], { deleted: true });
    return { cid, R, A, B, C, A1, A2, A1x, Adel, eR, eA, eB, eC, eA1, eA2, eA1x, eAdel };
  }

  // ===== TEST 1: group several ([A,B]) at a mid level =====
  {
    const g = await buildCurated();
    const seqAB = await mkSeq(g.eA, g.eB);   // both move → kept
    const seqAC = await mkSeq(g.eA, g.eC);   // A moves, C stays → removed
    const seqA1A2 = await mkSeq(g.eA1, g.eA2); // both move → kept
    const ansA = await mkAnswer(g.eA);
    const fbA = await mkFeedback(g.cid, g.eA);
    const tabA1x = await mkTab(ownerId, g.A1x, [g.R, g.A, g.A1]);

    // dry-run makes no writes
    const before = await rowCounts();
    const dry = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [g.eA, g.eB], name: 'Goal', dryRun: true });
    const after = await rowCounts();
    check('group dryRun returns preview', dry.status === 200 && dry.data.movedCount === 2 && dry.data.descendantCount === 4, JSON.stringify(dry.data));
    check('group dryRun lists removed seq links (A->C only)',
      dry.data.removedSequenceLinks && dry.data.removedSequenceLinks.length === 1 && dry.data.removedSequenceLinks[0].linkId === seqAC,
      JSON.stringify(dry.data.removedSequenceLinks));
    check('group dryRun makes no writes', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);

    // real
    const res = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [g.eA, g.eB], name: 'Goal' });
    check('group several succeeds', res.status === 201 && res.data.movedCount === 2 && res.data.descendantCount === 4, JSON.stringify(res.data));
    const N = res.data.newConceptId, newEdge = res.data.newEdgeId;
    // edge ids unchanged, paths rewritten
    check('group: new parent edge at level {R}', pathEq((await edgePath(newEdge)).path, [g.R]));
    check('group: A reparented under Goal (same edge id)', pathEq((await edgePath(g.eA)).path, [g.R, N]) && (await edgePath(g.eA)).parent === N);
    check('group: B reparented under Goal', pathEq((await edgePath(g.eB)).path, [g.R, N]));
    check('group: deep A1 path rewritten', pathEq((await edgePath(g.eA1)).path, [g.R, N, g.A]));
    check('group: deepest A1x (3 levels) path rewritten', pathEq((await edgePath(g.eA1x)).path, [g.R, N, g.A, g.A1]));
    check('group: soft-deleted Adel rewritten + still deleted', pathEq((await edgePath(g.eAdel)).path, [g.R, N, g.A, g.A2]) && (await edgePath(g.eAdel)).deleted);
    check('group: answer still on eA (same edge id)', (await pool.query('SELECT 1 FROM concept_links WHERE id=$1 AND edge_id=$2', [ansA, g.eA])).rows.length === 1);
    check('group: feedback still on eA', (await pool.query('SELECT 1 FROM feedback_items WHERE id=$1 AND edge_id=$2', [fbA, g.eA])).rows.length === 1);
    check('group: kept seq A->B survives', await seqExists(seqAB));
    check('group: kept seq A1->A2 survives', await seqExists(seqA1A2));
    check('group: crossing seq A->C removed (== preview)', !(await seqExists(seqAC)));
    check('group: graph_tab inside moved subtree rewritten', pathEq(await tabPath(tabA1x), [g.R, N, g.A, g.A1]));

    // restore a soft-deleted descendant at the NEW location via createChild
    const restore = await api('POST', '/concepts/child', ownerTok, { name: 'Adel', parentId: g.A2, path: [g.R, N, g.A].join(',') });
    check('group: soft-deleted descendant restorable at new location', restore.status === 201 && restore.data.restored === true, JSON.stringify(restore.data));
  }

  // ===== TEST 2: group ONE question (inserts a level) =====
  {
    const g = await buildCurated();
    const res = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [g.eA], name: 'Solo' });
    check('group ONE succeeds (movedCount 1)', res.status === 201 && res.data.movedCount === 1 && res.data.descendantCount === 4, JSON.stringify(res.data));
    const N = res.data.newConceptId;
    check('group one: A under Solo', pathEq((await edgePath(g.eA)).path, [g.R, N]));
  }

  // ===== TEST 3: group at ROOT level =====
  {
    const r1 = await mkConcept('Root1', curated), r2 = await mkConcept('Root2', curated);
    const er1 = await mkEdge(null, r1, []), er2 = await mkEdge(null, r2, []);
    const child = await mkConcept('RChild', curated);
    const echild = await mkEdge(r1, child, [r1]);
    const res = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [er1, er2], name: 'SuperRoot' });
    check('group at root succeeds', res.status === 201 && res.data.movedCount === 2, JSON.stringify(res.data));
    const N = res.data.newConceptId, ne = res.data.newEdgeId;
    check('group root: new root edge (parent NULL, path {})', (await edgePath(ne)).parent === null && pathEq((await edgePath(ne)).path, []));
    check('group root: Root1 now under SuperRoot {N}', pathEq((await edgePath(er1)).path, [N]) && (await edgePath(er1)).parent === N);
    check('group root: RChild deep path {N,r1}', pathEq((await edgePath(echild)).path, [N, r1]));
  }

  // ===== TEST 4: group error codes =====
  {
    const g = await buildCurated();
    // sibling_exists: new name == an existing visible sibling (C)
    const se = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [g.eA], name: 'C' });
    check('group sibling_exists', se.status === 409 && se.data.code === 'sibling_exists' && se.data.edgeId === g.eC, JSON.stringify(se.data));
    // not_siblings: A and A1 are not siblings
    const ns = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [g.eA, g.eA1], name: 'X' });
    check('group not_siblings', ns.status === 400 && ns.data.code === 'not_siblings', JSON.stringify(ns.data));
    // empty name
    const en = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [g.eA], name: '   ' });
    check('group empty_name', en.status === 400 && en.data.code === 'empty_name', JSON.stringify(en.data));
    // cycle: reuse an existing descendant concept name (A1) as the new parent of A's group
    const cyc = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [g.eA], name: 'A1' });
    check('group cycle', cyc.status === 409 && cyc.data.code === 'cycle', JSON.stringify(cyc.data));
    // curated_owner_only (reader)
    const ro = await api('POST', '/concepts/group-under-new-parent', readerTok, { selectedEdgeIds: [g.eA], name: 'Z' });
    check('group curated_owner_only (reader)', ro.status === 403 && ro.data.code === 'curated_owner_only', JSON.stringify(ro.data));
    // guest 401
    const gu = await api('POST', '/concepts/group-under-new-parent', null, { selectedEdgeIds: [g.eA], name: 'Z' });
    check('group guest 401', gu.status === 401, JSON.stringify(gu.data));
  }

  // ===== TEST 5: group curated_only in OPEN community =====
  {
    const r = await mkConcept('OpenRoot', open), a = await mkConcept('OA', open), b = await mkConcept('OB', open);
    const er = await mkEdge(null, r, []);
    const ea = await mkEdge(r, a, [r]), eb = await mkEdge(r, b, [r]);
    const res = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [ea, eb], name: 'G' });
    check('group curated_only in open community', res.status === 403 && res.data.code === 'curated_only', JSON.stringify(res.data));
  }

  // ===== TEST 6: move-into (target_selected, cycle, conflict, success) =====
  {
    const g = await buildCurated();
    // target_selected
    const ts = await api('POST', '/concepts/move-into-sibling', ownerTok, { selectedEdgeIds: [g.eA, g.eB], targetEdgeId: g.eB });
    check('move target_selected', ts.status === 400 && ts.data.code === 'target_selected', JSON.stringify(ts.data));
    // success: move C into A
    const res = await api('POST', '/concepts/move-into-sibling', ownerTok, { selectedEdgeIds: [g.eC], targetEdgeId: g.eA });
    check('move success', res.status === 200 && res.data.movedCount === 1 && res.data.targetEdgeId === g.eA, JSON.stringify(res.data));
    check('move: C now under A {R,A}', pathEq((await edgePath(g.eC)).path, [g.R, g.A]) && (await edgePath(g.eC)).parent === g.A);
  }
  // move conflict: destination identity already exists
  {
    const g = await buildCurated();
    // Give A a child named C already, then moving sibling C into A conflicts.
    const cDup = await mkConcept('Cdup', curated);
    await mkEdge(g.A, g.C, [g.R, g.A]); // A already has child C (same concept id g.C)
    const res = await api('POST', '/concepts/move-into-sibling', ownerTok, { selectedEdgeIds: [g.eC], targetEdgeId: g.eA });
    check('move conflict', res.status === 409 && res.data.code === 'conflict', JSON.stringify(res.data));
  }
  // move cycle: move A into one of its own descendants' concept? target must be a sibling,
  // so cycle via target being a concept that also appears inside the moved subtree.
  {
    const g = await buildCurated();
    // Make B's concept appear inside A's subtree, then move A into B → cycle.
    await mkEdge(g.A1, g.B, [g.R, g.A, g.A1]); // B now a descendant of A
    const res = await api('POST', '/concepts/move-into-sibling', ownerTok, { selectedEdgeIds: [g.eA], targetEdgeId: g.eB });
    check('move cycle', res.status === 409 && res.data.code === 'cycle', JSON.stringify(res.data));
  }

  // ===== TEST 7: ungroup (children up, soft-delete, re-add restores; conflict; root level) =====
  {
    const g = await buildCurated();
    const ansA = await mkAnswer(g.eA);
    const seqAB = await mkSeq(g.eA, g.eB); // touches A → removed on ungroup
    const dry = await api('POST', `/concepts/edges/${g.eA}/ungroup`, ownerTok, { dryRun: true });
    check('ungroup dryRun preview', dry.status === 200 && dry.data.movedCount === 2 && dry.data.answersRemoved === 1 && dry.data.removedSequenceLinks.length === 1, JSON.stringify(dry.data));
    const res = await api('POST', `/concepts/edges/${g.eA}/ungroup`, ownerTok, {});
    check('ungroup success', res.status === 200 && res.data.deletedEdgeId === g.eA && res.data.movedCount === 2, JSON.stringify(res.data));
    check('ungroup: A1 moved up to {R}', pathEq((await edgePath(g.eA1)).path, [g.R]) && (await edgePath(g.eA1)).parent === g.R);
    check('ungroup: A2 moved up to {R}', pathEq((await edgePath(g.eA2)).path, [g.R]));
    check('ungroup: deep A1x path {R,A1}', pathEq((await edgePath(g.eA1x)).path, [g.R, g.A1]));
    check('ungroup: A soft-deleted', (await edgePath(g.eA)).deleted);
    check('ungroup: seq touching A removed', !(await seqExists(seqAB)));
    // re-add A at this level restores WITHOUT its old children
    const restore = await api('POST', '/concepts/child', ownerTok, { name: 'A', parentId: g.R, path: '' });
    check('ungroup: re-add restores A (restored flag)', restore.status === 201 && restore.data.restored === true, JSON.stringify(restore.data));
    const aChildren = await pool.query('SELECT 1 FROM edges WHERE parent_id=$1 AND graph_path=$2::int[] AND deleted_at IS NULL', [g.A, '{' + [g.R, g.A].join(',') + '}']);
    check('ungroup: restored A has no (live) old children', aChildren.rows.length === 0);
  }
  // ungroup conflict: a child concept already exists at the upper level
  {
    const R = await mkConcept('UR', curated), A = await mkConcept('UA', curated), dupChild = await mkConcept('Dup', curated);
    const eR = await mkEdge(null, R, []);
    const eA = await mkEdge(R, A, [R]);
    const eDupUnderR = await mkEdge(R, dupChild, [R]);        // Dup already a child of R
    const eDupUnderA = await mkEdge(A, dupChild, [R, A]);      // Dup also a child of A
    const res = await api('POST', `/concepts/edges/${eA}/ungroup`, ownerTok, {});
    check('ungroup conflict', res.status === 409 && res.data.code === 'conflict', JSON.stringify(res.data));
  }
  // ungroup at ROOT level: children become roots
  {
    const R = await mkConcept('RR', curated), ch = await mkConcept('RRch', curated);
    const eR = await mkEdge(null, R, []);
    const eCh = await mkEdge(R, ch, [R]);
    const res = await api('POST', `/concepts/edges/${eR}/ungroup`, ownerTok, {});
    check('ungroup root success', res.status === 200, JSON.stringify(res.data));
    check('ungroup root: child became a root (parent NULL, path {})', (await edgePath(eCh)).parent === null && pathEq((await edgePath(eCh)).path, []));
  }
  // ungroup no_children + reader + open
  {
    const R = await mkConcept('LR', curated), leaf = await mkConcept('LLeaf', curated);
    const eR = await mkEdge(null, R, []);
    const eLeaf = await mkEdge(R, leaf, [R]);
    const nc = await api('POST', `/concepts/edges/${eLeaf}/ungroup`, ownerTok, {});
    check('ungroup no_children', nc.status === 400 && nc.data.code === 'no_children', JSON.stringify(nc.data));
    const g = await buildCurated();
    const ro = await api('POST', `/concepts/edges/${g.eA}/ungroup`, readerTok, {});
    check('ungroup curated_owner_only (reader)', ro.status === 403 && ro.data.code === 'curated_owner_only', JSON.stringify(ro.data));
    // open community ungroup
    const oR = await mkConcept('ulOpenR', open), oA = await mkConcept('ulOpenA', open), oA1 = await mkConcept('ulOpenA1', open);
    const eoR = await mkEdge(null, oR, []); const eoA = await mkEdge(oR, oA, [oR]); const eoA1 = await mkEdge(oA, oA1, [oR, oA]);
    const oo = await api('POST', `/concepts/edges/${eoA}/ungroup`, ownerTok, {});
    check('ungroup curated_only in open', oo.status === 403 && oo.data.code === 'curated_only', JSON.stringify(oo.data));
  }

  // ===== TEST 8: legal_hold + too_large =====
  {
    const g = await buildCurated();
    await pool.query('UPDATE edges SET legal_hold = true WHERE id=$1', [g.eA1]); // held descendant
    const res = await api('POST', '/concepts/group-under-new-parent', ownerTok, { selectedEdgeIds: [g.eA], name: 'LH' });
    check('group legal_hold', res.status === 409 && res.data.code === 'legal_hold', JSON.stringify(res.data));
    await pool.query('UPDATE edges SET legal_hold = false WHERE id=$1', [g.eA1]);
  }

  // ===== TEST 9: nest-under-sibling open_only in curated, works in open =====
  {
    const g = await buildCurated();
    const nc = await api('POST', '/concepts/nest-under-sibling', ownerTok, { parentConceptId: g.R, path: [g.R], selectedEdgeIds: [g.eA], targetEdgeId: g.eB });
    check('nest open_only in curated (owner too)', nc.status === 403 && nc.data.code === 'open_only', JSON.stringify(nc.data));
    // open community nest still works
    const r = await mkConcept('nestOpenR', open), a = await mkConcept('nestOpenA', open), b = await mkConcept('nestOpenB', open);
    const er = await mkEdge(null, r, []); const ea = await mkEdge(r, a, [r]); const eb = await mkEdge(r, b, [r]);
    const ok = await api('POST', '/concepts/nest-under-sibling', ownerTok, { parentConceptId: r, path: [r], selectedEdgeIds: [ea], targetEdgeId: eb });
    check('nest works in open community', ok.status === 201 && ok.data.copiedEdges >= 1, JSON.stringify(ok.data));
  }

  // Done
  fs.writeFileSync('test-results-section-73.md', `# Phase 73 API test results\n\nPassed: ${passed} / ${passed + failed}\n\n` + results.join('\n') + '\n');
  console.log(`\nPhase 73: ${passed} passed, ${failed} failed. See test-results-section-73.md`);
}

async function cleanup() {
  // concepts.community_id lacks ON DELETE CASCADE on this DB, so remove dependents
  // first (edges, links, seq, feedback cascade from concepts/edges).
  for (const cid of created.communities) {
    await pool.query('DELETE FROM feedback_items WHERE community_id=$1', [cid]).catch(() => {});
    await pool.query('DELETE FROM concepts WHERE community_id=$1', [cid]).catch((e) => console.error('cleanup concepts', e.message));
    await pool.query('DELETE FROM community_owners WHERE community_id=$1', [cid]).catch(() => {});
    await pool.query('DELETE FROM communities WHERE id=$1', [cid]).catch((e) => console.error('cleanup community', e.message));
  }
  for (const uid of created.users) {
    await pool.query('DELETE FROM graph_tabs WHERE user_id=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id=$1', [uid]).catch((e) => console.error('cleanup user', e.message));
  }
}

run().catch((e) => { console.error(e); results.push('- [ ] FATAL: ' + e.message); fs.writeFileSync('test-results-section-73.md', results.join('\n')); })
  .finally(async () => { await cleanup(); await pool.end(); process.exit(failed > 0 ? 1 : 0); });
