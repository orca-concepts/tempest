// Phase 72a: shared community-access helpers.
//
// These resolve the community (id + mode) behind a concept / edge / link and
// answer two permission questions: may this user write structure, and is voting
// allowed at all. Following the house convention, helpers never throw to the
// client — controllers translate the returned result objects into responses
// (the two gating codes are 'curated_owner_only' and 'curated_no_votes', both 403).

const pool = require('../config/database');

// → { id, mode } or null
async function getCommunityForConcept(conceptId) {
  const r = await pool.query(
    `SELECT comm.id, comm.mode
       FROM concepts c
       JOIN communities comm ON comm.id = c.community_id
      WHERE c.id = $1`,
    [conceptId]
  );
  return r.rows[0] || null;
}

// Edges inherit their community from their child concept (true for root and
// non-root edges alike), so this one lookup covers every edge.
async function getCommunityForEdge(edgeId) {
  const r = await pool.query(
    `SELECT comm.id, comm.mode
       FROM edges e
       JOIN concepts c ON c.id = e.child_id
       JOIN communities comm ON comm.id = c.community_id
      WHERE e.id = $1`,
    [edgeId]
  );
  return r.rows[0] || null;
}

async function getCommunityForLink(linkId) {
  const r = await pool.query(
    `SELECT comm.id, comm.mode
       FROM concept_links cl
       JOIN edges e ON e.id = cl.edge_id
       JOIN concepts c ON c.id = e.child_id
       JOIN communities comm ON comm.id = c.community_id
      WHERE cl.id = $1`,
    [linkId]
  );
  return r.rows[0] || null;
}

async function isOwner(communityId, userId) {
  if (!communityId || !userId) return false;
  const r = await pool.query(
    'SELECT 1 FROM community_owners WHERE community_id = $1 AND user_id = $2',
    [communityId, userId]
  );
  return r.rows.length > 0;
}

// Structure writes (create/add question, add/copy link, addendum).
// Open communities: anyone logged in. Curated: owners only.
// Returns { ok: true } or { ok: false, status, code, error }.
async function assertCanWriteStructure(community, userId) {
  if (!community) {
    return { ok: false, status: 404, code: 'community_not_found', error: 'Community not found' };
  }
  if (community.mode !== 'curated') return { ok: true };
  if (await isOwner(community.id, userId)) return { ok: true };
  return {
    ok: false,
    status: 403,
    code: 'curated_owner_only',
    error: 'Only community owners can make changes in a curated community.',
  };
}

// Votes and flags. Rejected outright in curated communities (for everyone,
// owners included). Synchronous — no ownership lookup needed.
function assertVotingAllowed(community) {
  if (!community) {
    return { ok: false, status: 404, code: 'community_not_found', error: 'Community not found' };
  }
  if (community.mode === 'curated') {
    return {
      ok: false,
      status: 403,
      code: 'curated_no_votes',
      error: 'Voting is disabled in curated communities.',
    };
  }
  return { ok: true };
}

module.exports = {
  getCommunityForConcept,
  getCommunityForEdge,
  getCommunityForLink,
  isOwner,
  assertCanWriteStructure,
  assertVotingAllowed,
};
