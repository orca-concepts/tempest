const pool = require('../config/database');
const communityAccess = require('../utils/communityAccess');
const { orcidForDisplay } = require('../utils/orcidValidator');

// ============================================================
// Phase 72b: curated answers + recency sorting (shared helpers)
// ============================================================

// Fetch all non-legal-held answers on the given edges and return a Map of
// edge_id → answers[], each list newest publication date first (ties: newest
// created_at). One query, no N+1. Dates are returned as 'YYYY-MM-DD' strings
// (lexicographically == chronologically comparable).
async function loadAnswersByEdge(edgeIds) {
  const byEdge = new Map();
  if (!edgeIds || edgeIds.length === 0) return byEdge;
  const result = await pool.query(
    `SELECT cl.id, cl.edge_id, cl.url, cl.title, cl.comment,
            to_char(cl.published_on, 'YYYY-MM-DD') AS published_on, cl.publisher,
            cl.created_at, cl.added_by
       FROM concept_links cl
      WHERE cl.edge_id = ANY($1::int[]) AND cl.legal_hold = false
      ORDER BY cl.published_on DESC NULLS LAST, cl.created_at DESC`,
    [edgeIds]
  );
  for (const row of result.rows) {
    if (!byEdge.has(row.edge_id)) byEdge.set(row.edge_id, []);
    byEdge.get(row.edge_id).push({
      id: row.id,
      edgeId: row.edge_id,
      url: row.url,
      title: row.title,
      comment: row.comment,
      publishedOn: row.published_on,
      publisher: row.publisher,
      createdAt: row.created_at,
      addedBy: row.added_by,
    });
  }
  return byEdge;
}

// Order rows by the curated recency rule, in two groups:
//   a. Open questions FIRST — no answer on the row's own edge and none on any
//      descendant edge (recency == null). Ordered by edge created_at DESC.
//   b. Answered questions NEXT — ordered by recency date (own newest answer,
//      else newest descendant answer) DESC, then edge created_at DESC.
// recencyOf(row) → 'YYYY-MM-DD' | null; createdAtOf(row) → timestamp value.
// Mutates and returns the array.
function sortByRecency(rows, recencyOf, createdAtOf) {
  return rows.sort((a, b) => {
    const ra = recencyOf(a);
    const rb = recencyOf(b);
    const aOpen = !ra;
    const bOpen = !rb;
    if (aOpen !== bOpen) return aOpen ? -1 : 1; // open questions first
    if (!aOpen && !bOpen && ra !== rb) return ra < rb ? 1 : -1; // answered: date desc
    const ca = createdAtOf(a);
    const cb = createdAtOf(b);
    if (ca < cb) return 1;
    if (ca > cb) return -1;
    return 0;
  });
}

// Phase 72e-1: open-feedback count per edge for curated cards. One grouped query;
// counts only live (status = 'open'), not-hidden items. Returns Map edgeId → int.
async function loadOpenFeedbackCountByEdge(edgeIds) {
  const byEdge = new Map();
  if (!edgeIds || edgeIds.length === 0) return byEdge;
  const result = await pool.query(
    `SELECT edge_id, COUNT(*)::int AS cnt
       FROM feedback_items
      WHERE edge_id = ANY($1::int[]) AND is_hidden = false AND status = 'open'
        AND kind <> 'new_child'
      GROUP BY edge_id`,
    [edgeIds]
  );
  for (const row of result.rows) byEdge.set(row.edge_id, row.cnt);
  return byEdge;
}

// Phase 72f: top link per edge for OPEN-community cards and root rows — the
// highest-voted link (ties: newest created_at), legal-held excluded. One query
// with DISTINCT ON, no N+1. Returns Map edgeId → topLink | (absent). Shape mirrors
// the GET /votes/web-links/:edgeId link shape the frontend already renders.
async function loadTopLinkByEdge(edgeIds, userId) {
  const byEdge = new Map();
  if (!edgeIds || edgeIds.length === 0) return byEdge;
  const result = await pool.query(
    `SELECT DISTINCT ON (cl.edge_id)
            cl.id, cl.edge_id, cl.url, cl.title, cl.comment, cl.created_at,
            cl.added_by, u.username AS added_by_username, u.orcid_id AS author_orcid_id,
            COALESCE(vc.cnt, 0) AS vote_count,
            EXISTS (SELECT 1 FROM concept_link_votes clv
                     WHERE clv.concept_link_id = cl.id AND clv.user_id = $2) AS user_voted
       FROM concept_links cl
       LEFT JOIN users u ON u.id = cl.added_by
       LEFT JOIN (SELECT concept_link_id, COUNT(*) AS cnt
                    FROM concept_link_votes GROUP BY concept_link_id) vc
         ON vc.concept_link_id = cl.id
      WHERE cl.edge_id = ANY($1::int[]) AND cl.legal_hold = false
      ORDER BY cl.edge_id, COALESCE(vc.cnt, 0) DESC, cl.created_at DESC`,
    [edgeIds, userId]
  );
  for (const row of result.rows) {
    byEdge.set(row.edge_id, {
      id: row.id,
      edgeId: row.edge_id,
      url: row.url,
      title: row.title,
      comment: row.comment,
      voteCount: parseInt(row.vote_count, 10),
      userVoted: row.user_voted || false,
      addedBy: row.added_by,
      addedByUsername: row.added_by_username,
      authorOrcidId: orcidForDisplay(row.author_orcid_id),
      createdAt: row.created_at,
    });
  }
  return byEdge;
}

// ============================================================
// Phase 73: restructuring curated graphs (group / move / ungroup)
// Shared path-rewrite helpers. These run INSIDE the caller's transaction on a
// client that has already issued BEGIN. Edge ids are never changed — only
// graph_path and parent_id are rewritten (keeping answers and feedback attached),
// plus every user's graph_tabs path for tabs inside a
// moved subtree. Path-scoped matching only (graph_path prefix), never by concept
// id alone (CLAUDE.md). graph_path is root-to-parent inclusive; graph_tabs store
// `path` = the viewed edge's graph_path (the parent prefix) and `concept_id` =
// the viewed child, so the full node path is `path || concept_id`.
// ============================================================

const RESTRUCTURE_EDGE_CAP = 1000;

// Lock (FOR UPDATE) the "moved set" for a group/move: the selected top edges plus
// every path-scoped descendant, INCLUDING soft-deleted ones (so restore-by-re-add
// keeps working at the new location). G = the shared graph_path of the selected
// siblings; selectedChildIds = their child concepts. A descendant of a selected
// concept C_i has graph_path[1:L] = G and graph_path[L+1] = C_i.
async function lockMovedSet(client, selectedEdgeIds, G, selectedChildIds) {
  const L = G.length;
  const gLiteral = '{' + G.join(',') + '}';
  const result = await client.query(
    `SELECT id, child_id, graph_path, attribute_id, legal_hold, deleted_at
       FROM edges e
      WHERE e.id = ANY($1::int[])
         OR (e.graph_path[1:$2] = $3::integer[] AND e.graph_path[$4] = ANY($5::int[]))
      ORDER BY COALESCE(array_length(e.graph_path, 1), 0)
      FOR UPDATE`,
    [selectedEdgeIds, L, gLiteral, L + 1, selectedChildIds]
  );
  return result.rows;
}

// Any legal hold on the given edges or their links blocks a restructure.
async function anyLegalHoldInSet(client, edgeIds) {
  if (!edgeIds.length) return false;
  const e = await client.query(
    'SELECT 1 FROM edges WHERE id = ANY($1::int[]) AND legal_hold = true LIMIT 1', [edgeIds]
  );
  if (e.rows.length) return true;
  const l = await client.query(
    'SELECT 1 FROM concept_links WHERE edge_id = ANY($1::int[]) AND legal_hold = true LIMIT 1', [edgeIds]
  );
  return l.rows.length > 0;
}

// Rewrite graph_path + parent_id for a set of edges (ids kept) and the matching
// graph_tabs rows. computeNewPath(oldPathArr) -> newPathArr. Throws a tagged error
// (err.restructureCode = 'conflict', err.conflictNames) if a rewritten identity
// would collide with an edge outside the set (visible OR soft-deleted). New paths
// are disjoint from every edge's old path in a valid move (the inserted/removed
// element differs), so sequential per-edge UPDATEs never transiently violate the
// (parent_id, child_id, graph_path, attribute_id) unique constraint.
async function applyPathRewrite(client, movedRows, computeNewPath) {
  const idArr = movedRows.map((r) => r.id);
  for (const r of movedRows) {
    const newPath = computeNewPath(r.graph_path || []);
    const literal = '{' + newPath.join(',') + '}';
    const clash = await client.query(
      `SELECT c.name
         FROM edges e JOIN concepts c ON c.id = e.child_id
        WHERE e.child_id = $1 AND e.graph_path = $2::integer[] AND e.id <> ALL($3::int[])
        LIMIT 1`,
      [r.child_id, literal, idArr]
    );
    if (clash.rows.length) {
      const err = new Error('conflict');
      err.restructureCode = 'conflict';
      err.conflictNames = [clash.rows[0].name];
      throw err;
    }
  }
  for (const r of movedRows) {
    const oldPath = r.graph_path || [];
    const newPath = computeNewPath(oldPath);
    const newParent = newPath.length ? newPath[newPath.length - 1] : null;
    const newLiteral = '{' + newPath.join(',') + '}';
    const oldLiteral = '{' + oldPath.join(',') + '}';
    await client.query(
      'UPDATE edges SET graph_path = $1::integer[], parent_id = $2 WHERE id = $3',
      [newLiteral, newParent, r.id]
    );
    // Rewrite tabs pointing at this edge's OLD identity (path + concept_id) so no
    // tab inside a moved subtree goes blank.
    await client.query(
      'UPDATE graph_tabs SET path = $1::integer[], updated_at = CURRENT_TIMESTAMP WHERE concept_id = $2 AND path = $3::integer[]',
      [newLiteral, r.child_id, oldLiteral]
    );
  }
}

// Validate + lock the selected sibling edges for a group/move. They must all
// exist, be visible (not hidden), not soft-deleted, and share parent_id,
// graph_path and attribute. At the root level (parent_id NULL, graph_path '{}')
// they must also share a community. Returns either { ok, rows, G, selectedChildIds,
// attributeId, communityId, parentForLevel } or { ok:false, status, code, error }.
async function validateSelectedSiblings(client, selectedEdgeIds) {
  if (!selectedEdgeIds.length) {
    return { ok: false, status: 400, code: 'not_siblings', error: 'Select at least one question.' };
  }
  const sel = await client.query(
    `SELECT e.id, e.parent_id, e.graph_path, e.child_id, e.attribute_id,
            e.is_hidden, e.deleted_at, c.community_id
       FROM edges e JOIN concepts c ON c.id = e.child_id
      WHERE e.id = ANY($1::int[])
      FOR UPDATE`,
    [selectedEdgeIds]
  );
  if (sel.rows.length !== selectedEdgeIds.length) {
    return { ok: false, status: 400, code: 'not_siblings', error: 'Some selected questions no longer exist.' };
  }
  if (sel.rows.some((r) => r.deleted_at)) {
    return { ok: false, status: 409, code: 'edge_deleted', error: 'One of the selected questions has been deleted.' };
  }
  if (sel.rows.some((r) => r.is_hidden)) {
    return { ok: false, status: 400, code: 'not_siblings', error: 'One of the selected questions is hidden.' };
  }
  const first = sel.rows[0];
  const samePath = (a) => (a.graph_path || []).join(',') === (first.graph_path || []).join(',');
  const sameParent = (a) => (a.parent_id === null ? first.parent_id === null : a.parent_id === first.parent_id);
  if (!sel.rows.every((r) => samePath(r) && sameParent(r))) {
    return { ok: false, status: 400, code: 'not_siblings', error: 'The selected questions are not all siblings.' };
  }
  if (new Set(sel.rows.map((r) => r.attribute_id)).size > 1) {
    return { ok: false, status: 400, code: 'not_siblings', error: 'The selected questions do not share the same attribute.' };
  }
  const isRoot = first.parent_id === null;
  if (isRoot && new Set(sel.rows.map((r) => r.community_id)).size > 1) {
    return { ok: false, status: 400, code: 'not_siblings', error: 'The selected questions must be in the same community.' };
  }
  const G = first.graph_path || [];
  return {
    ok: true,
    rows: sel.rows,
    G,
    selectedChildIds: sel.rows.map((r) => r.child_id),
    attributeId: first.attribute_id,
    communityId: first.community_id,
    parentForLevel: G.length ? G[G.length - 1] : null,
  };
}

const conceptsController = {
  // Get all root concepts (concepts with no parents)
  getRootConcepts: async (req, res) => {
    try {
      const { sort, communityId } = req.query; // 'new' or default (saves)

      // Phase 71: roots are scoped to a community.
      const cid = parseInt(communityId, 10);
      if (!cid || isNaN(cid)) {
        return res.status(400).json({ error: 'communityId is required' });
      }

      const orderClause = sort === 'new'
        ? 'ORDER BY root_e.created_at DESC, c.name'
        : 'ORDER BY vote_count DESC, c.name';

      const query = `
        SELECT DISTINCT c.id, c.name, c.created_at,
          COALESCE(COUNT(DISTINCT child_e.id), 0) as child_count,
          root_e.id as edge_id,
          root_e.created_at as edge_created_at,
          a.id as attribute_id,
          a.name as attribute_name,
          COALESCE(COUNT(DISTINCT v.id), 0) as vote_count,
          BOOL_OR(v.user_id = $1) as user_voted,
          (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = root_e.id) as swap_count,
          (SELECT COUNT(*) > 0 FROM replace_votes rv WHERE rv.edge_id = root_e.id AND rv.user_id = $1) as user_swapped,
          (SELECT COUNT(*) FROM concept_flags cf WHERE cf.edge_id = root_e.id) as flag_count,
          (SELECT COUNT(*) > 0 FROM concept_flags cf WHERE cf.edge_id = root_e.id AND cf.user_id = $1) as user_flagged,
          (SELECT COUNT(*) FROM concept_links cl
           WHERE cl.edge_id = root_e.id AND cl.legal_hold = false) as link_count
        FROM concepts c
        LEFT JOIN edges child_e ON c.id = child_e.parent_id AND child_e.graph_path = ARRAY[c.id] AND child_e.is_hidden = false
        LEFT JOIN edges root_e ON root_e.child_id = c.id AND root_e.parent_id IS NULL AND root_e.graph_path = '{}' AND root_e.is_hidden = false
        LEFT JOIN attributes a ON root_e.attribute_id = a.id
        LEFT JOIN votes v ON root_e.id = v.edge_id
        WHERE root_e.id IS NOT NULL AND c.community_id = $2
        GROUP BY c.id, c.name, c.created_at, root_e.id, root_e.created_at, a.id, a.name
        ${orderClause};
      `;

      const result = await pool.query(query, [req.user ? req.user.userId : -1, cid]);

      // Phase 72b: in curated communities, attach per-root answers[] and sortDate
      // and re-order by the recency rule (sort param ignored). Open communities
      // return exactly what they returned before (no new fields, SQL order kept).
      const modeRow = await pool.query('SELECT mode FROM communities WHERE id = $1', [cid]);
      if (modeRow.rows[0]?.mode === 'curated' && result.rows.length > 0) {
        const rootEdgeIds = result.rows.map((r) => r.edge_id);
        const rootConceptIds = result.rows.map((r) => r.id);

        const answersByEdge = await loadAnswersByEdge(rootEdgeIds);

        // Newest answer date on any descendant edge of each root. A root's
        // descendants have graph_path starting with [rootConceptId].
        const descResult = await pool.query(
          `SELECT e.graph_path[1] AS root_id,
                  to_char(MAX(cl.published_on), 'YYYY-MM-DD') AS max_date
             FROM edges e
             JOIN concept_links cl ON cl.edge_id = e.id AND cl.legal_hold = false
            WHERE e.graph_path[1] = ANY($1::int[])
              AND array_length(e.graph_path, 1) >= 1
              AND e.is_hidden = false
            GROUP BY e.graph_path[1]`,
          [rootConceptIds]
        );
        const descDateByRoot = new Map();
        for (const row of descResult.rows) descDateByRoot.set(row.root_id, row.max_date);

        for (const root of result.rows) {
          const answers = answersByEdge.get(root.edge_id) || [];
          root.answers = answers;
          const ownDate = answers.length > 0 ? answers[0].publishedOn : null;
          const recency = ownDate || descDateByRoot.get(root.id) || null;
          // Open questions (no own or descendant answer) have a null sortDate —
          // they are not ranked by date but sorted first by created_at (see
          // sortByRecency). Do not fall back to created_at in the returned field.
          root.sortDate = recency;
          root._recency = recency;
        }
        sortByRecency(
          result.rows,
          (r) => r._recency,
          (r) => r.edge_created_at
        );
        for (const root of result.rows) delete root._recency;

        // Phase 72e-1: open-feedback count per curated card.
        const feedbackByEdge = await loadOpenFeedbackCountByEdge(rootEdgeIds);
        for (const root of result.rows) {
          root.openFeedbackCount = feedbackByEdge.get(root.edge_id) || 0;
        }
      } else if (modeRow.rows[0]?.mode !== 'curated' && result.rows.length > 0) {
        // Phase 72f: open communities attach the top link per root row for the
        // in-card link preview. link_count is already selected above.
        const rootEdgeIds = result.rows.map((r) => r.edge_id);
        const topLinkByEdge = await loadTopLinkByEdge(rootEdgeIds, req.user ? req.user.userId : -1);
        for (const root of result.rows) {
          root.topLink = topLinkByEdge.get(root.edge_id) || null;
        }
      }

      const userCountResult = await pool.query('SELECT COUNT(*) as total_users FROM users');
      const totalUsers = parseInt(userCountResult.rows[0].total_users);

      res.json({ concepts: result.rows, totalUsers });
    } catch (error) {
      console.error('Error fetching root concepts:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get a concept by ID with its children in a specific context
  getConceptWithChildren: async (req, res) => {
    const { id } = req.params;
    const { path, sort } = req.query;

    try {
      const conceptResult = await pool.query(
        'SELECT * FROM concepts WHERE id = $1',
        [id]
      );

      if (conceptResult.rows.length === 0) {
        return res.status(404).json({ error: 'Concept not found' });
      }

      const concept = conceptResult.rows[0];
      const graphPath = path ? path.split(',').map(Number) : [];
      graphPath.push(parseInt(id));

      const orderClause = sort === 'new'
        ? 'ORDER BY e.created_at DESC, c.name'
        : 'ORDER BY vote_count DESC, c.name';

      const childrenQuery = `
        SELECT
          c.id,
          c.name,
          e.id as edge_id,
          e.graph_path,
          e.created_at as edge_created_at,
          a.id as attribute_id,
          a.name as attribute_name,
          COUNT(DISTINCT v.id) as vote_count,
          BOOL_OR(v.user_id = $2) as user_voted,
          COUNT(DISTINCT child_edges.id) as child_count,
          (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) as swap_count,
          (SELECT COUNT(*) > 0 FROM replace_votes rv WHERE rv.edge_id = e.id AND rv.user_id = $2) as user_swapped,
          (SELECT COUNT(*) FROM concept_flags cf WHERE cf.edge_id = e.id) as flag_count,
          (SELECT COUNT(*) > 0 FROM concept_flags cf WHERE cf.edge_id = e.id AND cf.user_id = $2) as user_flagged,
          (SELECT COUNT(*) FROM concept_links cl
           WHERE cl.edge_id = e.id AND cl.legal_hold = false) as link_count
        FROM edges e
        JOIN concepts c ON e.child_id = c.id
        JOIN attributes a ON e.attribute_id = a.id
        LEFT JOIN votes v ON e.id = v.edge_id
        LEFT JOIN edges child_edges ON child_edges.parent_id = c.id AND child_edges.graph_path = e.graph_path || c.id AND child_edges.is_hidden = false
        WHERE e.parent_id = $1 AND e.graph_path = $3 AND e.is_hidden = false
        GROUP BY c.id, c.name, e.id, e.graph_path, e.created_at, a.id, a.name
        ${orderClause};
      `;

      const childrenResult = await pool.query(childrenQuery, [
        id,
        req.user ? req.user.userId : -1,
        graphPath
      ]);

      // Feature (Phase 69): cross-sibling-descendant flag. For each direct child,
      // find any occurrence of that same concept DEEPER in this concept's subtree
      // (a longer graph_path sharing this concept's full path as a prefix). Within
      // this subtree a deeper occurrence can only sit under a sibling (cycles are
      // prevented), so this is exactly "also a descendant of one of its siblings".
      // graphPath here IS the children's graph_path (root-to-this-concept inclusive).
      const childIds = childrenResult.rows.map((r) => r.id);
      if (childIds.length > 0) {
        const nestedResult = await pool.query(
          `SELECT e.child_id, e.id AS edge_id, e.graph_path, pc.name AS parent_name
           FROM edges e
           JOIN concepts pc ON pc.id = e.parent_id
           WHERE e.graph_path[1:$1] = $2::int[]
             AND array_length(e.graph_path, 1) > $1
             AND e.is_hidden = false
             AND e.child_id = ANY($3::int[])`,
          [graphPath.length, graphPath, childIds]
        );
        const nestedByChild = new Map();
        for (const row of nestedResult.rows) {
          if (!nestedByChild.has(row.child_id)) nestedByChild.set(row.child_id, []);
          nestedByChild.get(row.child_id).push({
            edgeId: row.edge_id,
            graphPath: row.graph_path,
            parentName: row.parent_name,
          });
        }
        for (const child of childrenResult.rows) {
          child.nestedLocations = nestedByChild.get(child.id) || [];
        }
      }

      let currentEdgeVoteCount = null;
      let currentAttribute = null;
      let currentEdgeId = null;
      // Phase 73 follow-up: whether the current edge is soft-deleted. The edge
      // lookups below carry no is_hidden/deleted_at filter, so they still resolve a
      // deleted edge (e.g. a question opened from an old sidebar tab); the frontend
      // uses this to show a "removed" notice instead of empty content.
      let currentEdgeDeleted = false;
      if (graphPath.length >= 2) {
        const parentId = graphPath[graphPath.length - 2];
        const parentPath = graphPath.slice(0, -1);

        const edgeVoteQuery = `
          SELECT e.id as edge_id, e.deleted_at, COUNT(DISTINCT v.id) as vote_count, a.id as attribute_id, a.name as attribute_name
          FROM edges e
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id
          WHERE e.parent_id = $1 AND e.child_id = $2 AND e.graph_path = $3
          GROUP BY e.id, e.deleted_at, a.id, a.name
        `;

        const edgeVoteResult = await pool.query(edgeVoteQuery, [parentId, id, parentPath]);
        if (edgeVoteResult.rows.length > 0) {
          currentEdgeId = edgeVoteResult.rows[0].edge_id;
          currentEdgeDeleted = !!edgeVoteResult.rows[0].deleted_at;
          currentEdgeVoteCount = parseInt(edgeVoteResult.rows[0].vote_count || 0);
          currentAttribute = {
            id: edgeVoteResult.rows[0].attribute_id,
            name: edgeVoteResult.rows[0].attribute_name
          };
        }
      } else if (graphPath.length === 1) {
        const edgeVoteQuery = `
          SELECT e.id as edge_id, e.deleted_at, COUNT(DISTINCT v.id) as vote_count, a.id as attribute_id, a.name as attribute_name
          FROM edges e
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id
          WHERE e.parent_id IS NULL AND e.child_id = $1 AND e.graph_path = '{}'
          GROUP BY e.id, e.deleted_at, a.id, a.name
        `;

        const edgeVoteResult = await pool.query(edgeVoteQuery, [id]);
        if (edgeVoteResult.rows.length > 0) {
          currentEdgeId = edgeVoteResult.rows[0].edge_id;
          currentEdgeDeleted = !!edgeVoteResult.rows[0].deleted_at;
          currentEdgeVoteCount = parseInt(edgeVoteResult.rows[0].vote_count || 0);
          currentAttribute = {
            id: edgeVoteResult.rows[0].attribute_id,
            name: edgeVoteResult.rows[0].attribute_name
          };
        }
      }

      // Feature (Phase 69): altParentCount backs the edit-mode "also appears under
      // N" note; tunnelLinkCount backs the (retired) tunnel view.
      // altParentCount = other non-root parent contexts for this concept (matches
      // getConceptParents, which JOINs the parent concept and so excludes root
      // edges), minus the current context if it is itself a non-root parent.
      const altParentResult = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM edges e
         WHERE e.child_id = $1 AND e.parent_id IS NOT NULL AND e.is_hidden = false`,
        [id]
      );
      const altParentCount = Math.max(
        0,
        (altParentResult.rows[0].cnt || 0) - (graphPath.length >= 2 ? 1 : 0)
      );

      let tunnelLinkCount = 0;
      if (currentEdgeId) {
        const tunnelCountResult = await pool.query(
          'SELECT COUNT(*)::int AS cnt FROM tunnel_links WHERE origin_edge_id = $1',
          [currentEdgeId]
        );
        tunnelLinkCount = tunnelCountResult.rows[0].cnt || 0;
      }

      // Phase 72a: surface the owning community's mode + the caller's ownership
      // so the frontend can gate write/vote affordances on the concept page.
      let communityMode = null;
      let isCommunityOwner = false;
      if (concept.community_id) {
        const commRow = await pool.query(
          'SELECT mode FROM communities WHERE id = $1',
          [concept.community_id]
        );
        communityMode = commRow.rows[0]?.mode || null;
        if (req.user) {
          isCommunityOwner = await communityAccess.isOwner(concept.community_id, req.user.userId);
        }
      }

      // Phase 72b: in curated communities, attach per-child answers[] and sortDate
      // and re-order by the recency rule. The sort param is ignored here. Open
      // communities return exactly what they returned before (no new fields).
      if (communityMode === 'curated' && childrenResult.rows.length > 0) {
        const childEdgeIds = childrenResult.rows.map((r) => r.edge_id);
        const childIds = childrenResult.rows.map((r) => r.id);

        const answersByEdge = await loadAnswersByEdge(childEdgeIds);

        // Newest answer date on any descendant edge, keyed by which direct child's
        // subtree it falls in. A descendant's graph_path extends the children's
        // graph_path (length L) by the child's id at position L+1, then deeper ids.
        const L = graphPath.length;
        const marker = L + 1;
        const descResult = await pool.query(
          `SELECT e.graph_path[${marker}] AS child_id,
                  to_char(MAX(cl.published_on), 'YYYY-MM-DD') AS max_date
             FROM edges e
             JOIN concept_links cl ON cl.edge_id = e.id AND cl.legal_hold = false
            WHERE e.graph_path[1:${L}] = $1::int[]
              AND array_length(e.graph_path, 1) > ${L}
              AND e.is_hidden = false
              AND e.graph_path[${marker}] = ANY($2::int[])
            GROUP BY e.graph_path[${marker}]`,
          [graphPath, childIds]
        );
        const descDateByChild = new Map();
        for (const row of descResult.rows) descDateByChild.set(row.child_id, row.max_date);

        for (const child of childrenResult.rows) {
          const answers = answersByEdge.get(child.edge_id) || [];
          child.answers = answers;
          const ownDate = answers.length > 0 ? answers[0].publishedOn : null;
          const recency = ownDate || descDateByChild.get(child.id) || null;
          // Open questions (no own or descendant answer) have a null sortDate —
          // they are not ranked by date but sorted first by created_at (see
          // sortByRecency). Do not fall back to created_at in the returned field.
          child.sortDate = recency;
          child._recency = recency;
        }
        sortByRecency(
          childrenResult.rows,
          (r) => r._recency,
          (r) => r.edge_created_at
        );
        for (const child of childrenResult.rows) delete child._recency;

        // Phase 72e-1: open-feedback count per curated card.
        const feedbackByEdge = await loadOpenFeedbackCountByEdge(childEdgeIds);
        for (const child of childrenResult.rows) {
          child.openFeedbackCount = feedbackByEdge.get(child.edge_id) || 0;
        }
      } else if (communityMode !== 'curated' && childrenResult.rows.length > 0) {
        // Phase 72f: open communities attach the top link per child row for the
        // in-card link preview. link_count is already selected above.
        const childEdgeIds = childrenResult.rows.map((r) => r.edge_id);
        const topLinkByEdge = await loadTopLinkByEdge(childEdgeIds, req.user ? req.user.userId : -1);
        for (const child of childrenResult.rows) {
          child.topLink = topLinkByEdge.get(child.edge_id) || null;
        }
      }

      // Phase 72f: curated own-page section shows the current question's OWN
      // answers under its title (leaf questions have no child rows). One small
      // indexed query; same shape as the children answers[].
      let currentAnswers = null;
      if (communityMode === 'curated' && currentEdgeId) {
        const m = await loadAnswersByEdge([currentEdgeId]);
        currentAnswers = m.get(currentEdgeId) || [];
      }

      res.json({
        concept,
        path: graphPath,
        children: childrenResult.rows,
        currentEdgeVoteCount,
        currentAttribute,
        currentEdgeId,
        currentEdgeDeleted,
        currentAnswers,
        altParentCount,
        tunnelLinkCount,
        communityId: concept.community_id,
        communityMode,
        isCommunityOwner,
      });
    } catch (error) {
      console.error('Error fetching concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all parent contexts for a concept (used by the Diff modal; also backs the
  // "also asked in" bridge target resolution).
  getConceptParents: async (req, res) => {
    const { id } = req.params;
    const { originPath } = req.query;

    try {
      const conceptResult = await pool.query(
        'SELECT * FROM concepts WHERE id = $1',
        [id]
      );

      if (conceptResult.rows.length === 0) {
        return res.status(404).json({ error: 'Concept not found' });
      }

      const concept = conceptResult.rows[0];

      let originEdgeId = null;
      let originParentId = null;
      let originGraphPath = null;
      if (originPath) {
        const pathArray = originPath.split(',').map(Number);

        if (pathArray.length > 0) {
          originParentId = pathArray[pathArray.length - 1];
          originGraphPath = pathArray;

          const originEdgeResult = await pool.query(
            'SELECT id FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3',
            [originParentId, id, originGraphPath]
          );

          if (originEdgeResult.rows.length > 0) {
            originEdgeId = originEdgeResult.rows[0].id;
          }
        }
      }

      let parentsQuery;
      let parentsParams;

      if (originEdgeId) {
        parentsQuery = `
          SELECT
            c.id,
            c.name,
            e.id as edge_id,
            e.graph_path,
            a.id as attribute_id,
            a.name as attribute_name,
            COUNT(DISTINCT v.id) as vote_count,
            BOOL_OR(v.user_id = $2) as user_voted,
            COUNT(DISTINCT sv.id) as link_count,
            BOOL_OR(sv.user_id = $2) as user_linked
          FROM edges e
          JOIN concepts c ON e.parent_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id
          LEFT JOIN similarity_votes sv ON sv.origin_edge_id = $3 AND sv.similar_edge_id = e.id
          WHERE e.child_id = $1 AND e.is_hidden = false
          GROUP BY c.id, c.name, e.id, e.graph_path, a.id, a.name
          ORDER BY link_count DESC, vote_count DESC, c.name;
        `;
        parentsParams = [id, req.user ? req.user.userId : -1, originEdgeId];
      } else {
        parentsQuery = `
          SELECT
            c.id,
            c.name,
            e.id as edge_id,
            e.graph_path,
            a.id as attribute_id,
            a.name as attribute_name,
            COUNT(DISTINCT v.id) as vote_count,
            BOOL_OR(v.user_id = $2) as user_voted,
            0 as link_count,
            false as user_linked
          FROM edges e
          JOIN concepts c ON e.parent_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id
          WHERE e.child_id = $1 AND e.is_hidden = false
          GROUP BY c.id, c.name, e.id, e.graph_path, a.id, a.name
          ORDER BY vote_count DESC, c.name;
        `;
        parentsParams = [id, req.user ? req.user.userId : -1];
      }

      const parentsResult = await pool.query(parentsQuery, parentsParams);

      let parentsWithSimilarity = parentsResult.rows;

      if (originEdgeId && originParentId && originGraphPath) {
        const originChildPath = [...originGraphPath, parseInt(id)];

        const originChildrenResult = await pool.query(
          'SELECT DISTINCT child_id FROM edges WHERE parent_id = $1 AND graph_path = $2 AND is_hidden = false',
          [id, originChildPath]
        );
        const originChildIds = new Set(originChildrenResult.rows.map(r => r.child_id));

        parentsWithSimilarity = await Promise.all(
          parentsResult.rows.map(async (parent) => {
            const altChildPath = [...parent.graph_path, parseInt(id)];

            const altChildrenResult = await pool.query(
              'SELECT DISTINCT child_id FROM edges WHERE parent_id = $1 AND graph_path = $2 AND is_hidden = false',
              [id, altChildPath]
            );
            const altChildIds = new Set(altChildrenResult.rows.map(r => r.child_id));

            let similarity = null;
            const unionSize = new Set([...originChildIds, ...altChildIds]).size;
            if (unionSize > 0) {
              let intersectionCount = 0;
              for (const childId of originChildIds) {
                if (altChildIds.has(childId)) {
                  intersectionCount++;
                }
              }
              similarity = Math.round((intersectionCount / unionSize) * 100);
            }

            return {
              ...parent,
              similarity_percentage: similarity
            };
          })
        );
      }

      res.json({
        concept,
        parents: parentsWithSimilarity,
        originPath: originPath || null,
        originEdgeId: originEdgeId
      });
    } catch (error) {
      console.error('Error fetching concept parents:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Search concepts by name (text matching + trigram similarity)
  searchConcepts: async (req, res) => {
    const { q, parentId, path, attributeId, communityId } = req.query;

    try {
      if (!q || q.trim().length === 0) {
        return res.json({ results: [] });
      }

      const searchTerm = q.trim();

      // Phase 71: search is scoped to a community.
      const cid = parseInt(communityId, 10);
      if (!cid || isNaN(cid)) {
        return res.status(400).json({ error: 'communityId is required' });
      }

      const attrFilter = attributeId
        ? `AND EXISTS (SELECT 1 FROM edges e_attr WHERE e_attr.child_id = c.id AND e_attr.attribute_id = ${parseInt(attributeId)} AND e_attr.is_hidden = false)`
        : '';

      // Phase 72c-1: a concept whose every edge is hidden (moderation or soft
      // delete — deleted edges carry is_hidden = true) has no live placement in
      // the graph, so it should not surface in search.
      const visibleFilter = `AND EXISTS (SELECT 1 FROM edges e_vis WHERE e_vis.child_id = c.id AND e_vis.is_hidden = false)`;

      const searchQuery = `
        WITH exact_matches AS (
          SELECT c.id, c.name, 1 as match_type,
            CASE
              WHEN LOWER(c.name) = LOWER($1) THEN 1.0
              ELSE 0.9
            END as relevance
          FROM concepts c
          WHERE LOWER(c.name) LIKE LOWER($1) || '%'
            AND c.community_id = $2
          ${visibleFilter}
          ${attrFilter}
          LIMIT 10
        ),
        similar_matches AS (
          SELECT c.id, c.name, 2 as match_type,
            similarity(c.name, $1) as relevance
          FROM concepts c
          WHERE similarity(c.name, $1) > 0.15
            AND c.community_id = $2
            AND c.id NOT IN (SELECT id FROM exact_matches)
          ${visibleFilter}
          ${attrFilter}
          ORDER BY similarity(c.name, $1) DESC
          LIMIT 10
        ),
        combined AS (
          SELECT * FROM exact_matches
          UNION ALL
          SELECT * FROM similar_matches
        )
        SELECT c.id, c.name, c.match_type, c.relevance
        FROM combined c
        ORDER BY c.match_type, c.relevance DESC
        LIMIT 20;
      `;

      const result = await pool.query(searchQuery, [searchTerm, cid]);

      // If we have a parentId and path, check which results are already children
      let childInfo = {};
      if (parentId && path !== undefined) {
        const graphPath = path ? path.split(',').map(Number) : [];
        graphPath.push(parseInt(parentId));

        const childCheckQuery = `
          SELECT e.child_id, a.name as attribute_name
          FROM edges e
          JOIN attributes a ON e.attribute_id = a.id
          WHERE e.parent_id = $1 AND e.graph_path = $2 AND e.is_hidden = false
        `;

        const childResult = await pool.query(childCheckQuery, [parentId, graphPath]);
        for (const row of childResult.rows) {
          if (!childInfo[row.child_id]) {
            childInfo[row.child_id] = [];
          }
          childInfo[row.child_id].push(row.attribute_name);
        }
      }

      // If user is logged in, check which results appear in their saved tabs
      let savedTabInfo = {};
      if (req.user && result.rows.length > 0) {
        const conceptIds = result.rows.map(r => r.id);
        // Check if user has voted on any edge where child_id matches
        const savedQuery = `
          SELECT DISTINCT e.child_id AS concept_id
          FROM votes v
          JOIN edges e ON v.edge_id = e.id
          WHERE v.user_id = $1 AND e.child_id = ANY($2::integer[])
        `;
        const savedResult = await pool.query(savedQuery, [req.user.userId, conceptIds]);
        for (const row of savedResult.rows) {
          savedTabInfo[row.concept_id] = [{ tabId: 0, tabName: 'Voted' }];
        }
      }

      const results = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        matchType: row.match_type === 1 ? 'exact' : 'similar',
        isChild: !!childInfo[row.id],
        childAttributes: childInfo[row.id] || [],
        savedTabs: savedTabInfo[row.id] || [],
      }));

      // Sort: results with saved votes first
      results.sort((a, b) => {
        const aHasContext = a.savedTabs.length > 0 ? 0 : 1;
        const bHasContext = b.savedTabs.length > 0 ? 0 : 1;
        if (aHasContext !== bHasContext) return aHasContext - bHasContext;
        return 0;
      });

      const exactMatch = result.rows.some(
        r => r.name.toLowerCase() === searchTerm.toLowerCase()
      );

      let exactMatchRootAttributes = [];
      if (exactMatch) {
        const exactRow = result.rows.find(r => r.name.toLowerCase() === searchTerm.toLowerCase());
        if (exactRow) {
          const rootEdgeCheck = await pool.query(
            `SELECT a.id as attribute_id, a.name as attribute_name
             FROM edges e JOIN attributes a ON e.attribute_id = a.id
             WHERE e.child_id = $1 AND e.parent_id IS NULL AND e.graph_path = '{}'`,
            [exactRow.id]
          );
          exactMatchRootAttributes = rootEdgeCheck.rows.map(r => r.attribute_name);
        }
      }

      res.json({ results, exactMatch, exactMatchRootAttributes });
    } catch (error) {
      console.error('Error searching concepts:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all available attributes
  getAttributes: async (req, res) => {
    try {
      const enabled = process.env.ENABLED_ATTRIBUTES;
      let result;
      if (enabled) {
        const names = enabled.split(',').map(n => n.trim()).filter(Boolean);
        result = await pool.query(
          'SELECT id, name FROM attributes WHERE name = ANY($1) ORDER BY id',
          [names]
        );
      } else {
        result = await pool.query(
          'SELECT id, name FROM attributes ORDER BY id'
        );
      }
      res.json({ attributes: result.rows });
    } catch (error) {
      console.error('Error fetching attributes:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a new concept as a child of a parent in a specific context
  createChildConcept: async (req, res) => {
    const { name, parentId, path } = req.body;

    try {
      if (!name || !parentId) {
        return res.status(400).json({ error: 'Name and parentId are required' });
      }

      if (name.length > 255) {
        return res.status(400).json({ error: 'Concept name must be 255 characters or fewer' });
      }

      const graphPath = path ? path.split(',').map(Number) : [];
      graphPath.push(parseInt(parentId));

      const rootConceptId = graphPath[0];
      const rootEdgeResult = await pool.query(
        'SELECT attribute_id FROM edges WHERE parent_id IS NULL AND child_id = $1',
        [rootConceptId]
      );
      if (rootEdgeResult.rows.length === 0) {
        return res.status(400).json({ error: 'Could not find root edge to determine attribute' });
      }
      const attributeId = rootEdgeResult.rows[0].attribute_id;

      // Phase 71: a child concept belongs to the same community as its root graph.
      const rootConceptRow = await pool.query(
        'SELECT community_id FROM concepts WHERE id = $1',
        [rootConceptId]
      );
      if (rootConceptRow.rows.length === 0) {
        return res.status(400).json({ error: 'Could not determine community for this graph' });
      }
      const communityId = rootConceptRow.rows[0].community_id;

      // Phase 72a: curated communities are owner-write-only.
      const commModeRow = await pool.query('SELECT id, mode FROM communities WHERE id = $1', [communityId]);
      const writeCheck = await communityAccess.assertCanWriteStructure(commModeRow.rows[0] || null, req.user.userId);
      if (!writeCheck.ok) {
        return res.status(writeCheck.status).json({ error: writeCheck.error, code: writeCheck.code });
      }

      const attrResult = await pool.query('SELECT id FROM attributes WHERE id = $1', [attributeId]);
      if (attrResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid attribute on root edge' });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        let conceptResult = await client.query(
          'SELECT * FROM concepts WHERE LOWER(name) = LOWER($1) AND community_id = $2',
          [name, communityId]
        );

        let conceptId;
        if (conceptResult.rows.length > 0) {
          conceptId = conceptResult.rows[0].id;
          if (graphPath.includes(conceptId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: 'Cannot add concept: would create a cycle in the graph'
            });
          }
        } else {
          conceptResult = await client.query(
            'INSERT INTO concepts (name, created_by, community_id) VALUES ($1, $2, $3) RETURNING *',
            [name, req.user.userId, communityId]
          );
          conceptId = conceptResult.rows[0].id;
        }

        const existingEdge = await client.query(
          'SELECT * FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3 AND attribute_id = $4',
          [parentId, conceptId, graphPath, attributeId]
        );

        if (existingEdge.rows.length > 0) {
          // Phase 72c-1: re-adding a soft-deleted question under the same
          // parent+path restores just that one edge (not its former subtree),
          // rather than colliding with the unique constraint.
          if (existingEdge.rows[0].deleted_at) {
            const restored = await client.query(
              `UPDATE edges
                  SET deleted_at = NULL, deleted_by = NULL, delete_batch_id = NULL, is_hidden = false
                WHERE id = $1
                RETURNING *`,
              [existingEdge.rows[0].id]
            );
            await client.query('COMMIT');
            const attrName = (await pool.query('SELECT name FROM attributes WHERE id = $1', [attributeId])).rows[0].name;
            return res.status(201).json({
              message: 'Child concept restored',
              concept: conceptResult.rows[0],
              edge: restored.rows[0],
              attribute: { id: parseInt(attributeId), name: attrName },
              restored: true,
            });
          }
          if (existingEdge.rows[0].is_hidden) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              error: 'This concept exists but has been hidden by the community'
            });
          }
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'This concept with this attribute is already a child in this context'
          });
        }

        const edgeResult = await client.query(
          'INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [parentId, conceptId, graphPath, attributeId, req.user.userId]
        );

        await client.query('COMMIT');

        const attrName = (await pool.query('SELECT name FROM attributes WHERE id = $1', [attributeId])).rows[0].name;

        res.status(201).json({
          message: 'Child concept added successfully',
          concept: conceptResult.rows[0],
          edge: edgeResult.rows[0],
          attribute: { id: parseInt(attributeId), name: attrName }
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating child concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get concept names by IDs (for breadcrumbs)
  getConceptNames: async (req, res) => {
    const { ids } = req.query;

    try {
      if (!ids) {
        return res.json({ concepts: [] });
      }

      const idArray = ids.split(',').map(Number).filter(id => !isNaN(id));

      if (idArray.length === 0) {
        return res.json({ concepts: [] });
      }

      const result = await pool.query(
        'SELECT id, name FROM concepts WHERE id = ANY($1)',
        [idArray]
      );

      const conceptMap = {};
      result.rows.forEach(row => {
        conceptMap[row.id] = row.name;
      });

      const orderedConcepts = idArray.map(id => ({
        id,
        name: conceptMap[id] || `Concept ${id}`
      }));

      res.json({ concepts: orderedConcepts });
    } catch (error) {
      console.error('Error fetching concept names:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a root concept
  createRootConcept: async (req, res) => {
    const { name, attributeId, communityId } = req.body;

    try {
      if (!name || !attributeId) {
        return res.status(400).json({ error: 'Name and attributeId are required' });
      }

      if (name.length > 255) {
        return res.status(400).json({ error: 'Concept name must be 255 characters or fewer' });
      }

      // Phase 71: a root concept is created inside a community.
      const cid = parseInt(communityId, 10);
      if (!cid || isNaN(cid)) {
        return res.status(400).json({ error: 'communityId is required' });
      }
      const communityCheck = await pool.query('SELECT id, mode FROM communities WHERE id = $1', [cid]);
      if (communityCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid community' });
      }

      // Phase 72a: curated communities are owner-write-only.
      const writeCheck = await communityAccess.assertCanWriteStructure(communityCheck.rows[0], req.user.userId);
      if (!writeCheck.ok) {
        return res.status(writeCheck.status).json({ error: writeCheck.error, code: writeCheck.code });
      }

      const attrResult = await pool.query('SELECT id FROM attributes WHERE id = $1', [attributeId]);
      if (attrResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid attribute' });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const existingConcept = await client.query(
          'SELECT id, name FROM concepts WHERE LOWER(name) = LOWER($1) AND community_id = $2',
          [name, cid]
        );

        let conceptId;
        let conceptRow;

        if (existingConcept.rows.length > 0) {
          conceptId = existingConcept.rows[0].id;
          conceptRow = existingConcept.rows[0];

          const existingRootEdge = await client.query(
            'SELECT id, deleted_at FROM edges WHERE parent_id IS NULL AND child_id = $1 AND attribute_id = $2',
            [conceptId, attributeId]
          );
          if (existingRootEdge.rows.length > 0) {
            // Phase 72c-1: re-adding a soft-deleted root question restores that
            // single root edge instead of colliding with the unique constraint.
            if (existingRootEdge.rows[0].deleted_at) {
              await client.query(
                `UPDATE edges
                    SET deleted_at = NULL, deleted_by = NULL, delete_batch_id = NULL, is_hidden = false
                  WHERE id = $1`,
                [existingRootEdge.rows[0].id]
              );
              await client.query('COMMIT');
              const attrName = (await pool.query('SELECT name FROM attributes WHERE id = $1', [attributeId])).rows[0].name;
              return res.status(201).json({
                message: 'Root concept restored',
                concept: conceptRow,
                attribute: { id: parseInt(attributeId), name: attrName },
                restored: true,
              });
            }
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: 'A root concept with this name and attribute already exists'
            });
          }
        } else {
          const result = await client.query(
            'INSERT INTO concepts (name, created_by, community_id) VALUES ($1, $2, $3) RETURNING *',
            [name, req.user.userId, cid]
          );
          conceptId = result.rows[0].id;
          conceptRow = result.rows[0];
        }

        await client.query(
          'INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by) VALUES (NULL, $1, $2, $3, $4)',
          [conceptId, '{}', attributeId, req.user.userId]
        );

        await client.query('COMMIT');

        const attrName = (await pool.query('SELECT name FROM attributes WHERE id = $1', [attributeId])).rows[0].name;

        res.status(201).json({
          message: 'Root concept created successfully',
          concept: conceptRow,
          attribute: { id: parseInt(attributeId), name: attrName }
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating root concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get identical vote sets for children of a concept in a specific context
  getVoteSets: async (req, res) => {
    const { id } = req.params;
    const { path } = req.query;

    try {
      const graphPath = path ? path.split(',').map(Number) : [];
      graphPath.push(parseInt(id));

      const voteSetsQuery = `
        WITH user_saved_children AS (
          SELECT
            v.user_id,
            array_agg(e.id ORDER BY e.id) as saved_edge_ids,
            array_agg(e.child_id ORDER BY e.id) as saved_child_ids
          FROM votes v
          JOIN edges e ON v.edge_id = e.id
          WHERE e.parent_id = $1 AND e.graph_path = $2 AND e.is_hidden = false
          GROUP BY v.user_id
        ),
        vote_set_groups AS (
          SELECT
            saved_edge_ids,
            saved_child_ids,
            array_agg(user_id ORDER BY user_id) as user_ids,
            COUNT(*) as user_count
          FROM user_saved_children
          GROUP BY saved_edge_ids, saved_child_ids
        )
        SELECT
          saved_edge_ids,
          saved_child_ids,
          user_ids,
          user_count
        FROM vote_set_groups
        ORDER BY user_count DESC;
      `;

      const result = await pool.query(voteSetsQuery, [id, graphPath]);

      let parentEdgeId = null;
      if (graphPath.length >= 2) {
        const parentId = graphPath[graphPath.length - 2];
        const parentPath = graphPath.slice(0, -1);
        const peResult = await pool.query(
          'SELECT id FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3 LIMIT 1',
          [parentId, id, parentPath]
        );
        if (peResult.rows.length > 0) parentEdgeId = peResult.rows[0].id;
      } else if (graphPath.length === 1) {
        const peResult = await pool.query(
          "SELECT id FROM edges WHERE parent_id IS NULL AND child_id = $1 AND graph_path = '{}' LIMIT 1",
          [id]
        );
        if (peResult.rows.length > 0) parentEdgeId = peResult.rows[0].id;
      }

      const VOTE_SET_THRESHOLD = 2;
      const rawSets = result.rows.map((row) => ({
        edgeIds: row.saved_edge_ids,
        childIds: row.saved_child_ids,
        userCount: parseInt(row.user_count),
        userIds: row.user_ids,
        voteSetKey: [...row.saved_edge_ids].sort((a, b) => a - b).join(','),
      }));

      const voteSets = rawSets
        .filter(set => set.userCount >= VOTE_SET_THRESHOLD)
        .map((set, index) => ({ ...set, setIndex: index }));

      const edgeToSets = {};
      voteSets.forEach((set) => {
        set.edgeIds.forEach((edgeId) => {
          if (!edgeToSets[edgeId]) {
            edgeToSets[edgeId] = [];
          }
          edgeToSets[edgeId].push(set.setIndex);
        });
      });

      const currentUserId = req.user ? req.user.userId : null;
      let userSetIndex = null;
      if (currentUserId !== null) {
        for (const set of voteSets) {
          if (set.userIds.some(uid => uid == currentUserId)) {
            userSetIndex = set.setIndex;
            break;
          }
        }
      }

      res.json({ voteSets, edgeToSets, userSetIndex, parentEdgeId });
    } catch (error) {
      console.error('Error fetching vote sets:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 14a: Get children (with grandchildren names) for multiple concepts in batch
  getBatchChildrenForDiff: async (req, res) => {
    try {
      const { panes } = req.body;

      if (!panes || !Array.isArray(panes) || panes.length === 0) {
        return res.status(400).json({ error: 'panes array is required' });
      }

      if (panes.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 panes allowed' });
      }

      const results = [];

      for (const pane of panes) {
        const { conceptId, path } = pane;

        if (!conceptId || path === undefined || path === null) {
          results.push({ conceptId, path, children: [], error: 'Missing conceptId or path' });
          continue;
        }

        const pathArray = typeof path === 'string' ? path.split(',').filter(Boolean).map(Number) : path;
        const graphPath = [...pathArray, parseInt(conceptId)];

        const childrenResult = await pool.query(
          `SELECT e.id as edge_id, e.child_id, c.name as child_name,
                  a.name as child_attribute,
                  COUNT(DISTINCT v.user_id) as save_count
           FROM edges e
           JOIN concepts c ON e.child_id = c.id
           JOIN attributes a ON e.attribute_id = a.id
           LEFT JOIN votes v ON v.edge_id = e.id
           WHERE e.parent_id = $1
             AND e.graph_path = $2
             AND e.is_hidden = false
           GROUP BY e.id, e.child_id, c.name, a.name
           ORDER BY save_count DESC, c.name`,
          [conceptId, `{${graphPath.join(',')}}`]
        );

        const children = [];
        for (const child of childrenResult.rows) {
          const grandchildPath = [...graphPath, child.child_id];
          const grandchildrenResult = await pool.query(
            `SELECT c.name, a.name as attribute_name
             FROM edges e
             JOIN concepts c ON e.child_id = c.id
             JOIN attributes a ON e.attribute_id = a.id
             WHERE e.parent_id = $1
               AND e.graph_path = $2
               AND e.is_hidden = false`,
            [child.child_id, `{${grandchildPath.join(',')}}`]
          );

          children.push({
            edgeId: child.edge_id,
            childId: child.child_id,
            name: child.child_name,
            attribute: child.child_attribute,
            saveCount: parseInt(child.save_count),
            grandchildren: grandchildrenResult.rows.map(gc => `${gc.name} [${gc.attribute_name}]`)
          });
        }

        results.push({
          conceptId: parseInt(conceptId),
          path: pathArray,
          children
        });
      }

      res.json({ results });
    } catch (error) {
      console.error('Error in getBatchChildrenForDiff:', error);
      res.status(500).json({ error: 'Failed to get batch children for diff' });
    }
  },

  getSubtree: async (req, res) => {
    const { id } = req.params;
    const { path } = req.query;
    const SUBTREE_LIMIT = 500;

    try {
      if (!id) return res.status(400).json({ error: 'Concept ID is required' });

      // Build the graph_path context for direct children of this concept.
      // Children's edges have graph_path = [...parentPath, conceptId].
      const pathIds = path ? path.split(',').filter(Boolean).map(Number) : [];
      const childGraphPath = [...pathIds, parseInt(id)];
      const childGraphPathLiteral = '{' + childGraphPath.join(',') + '}';

      const result = await pool.query(
        `WITH RECURSIVE subtree AS (
          SELECT e.id AS edge_id, e.child_id, e.parent_id, e.graph_path, e.attribute_id,
                 c.name AS concept_name, a.name AS attribute_name, 1 AS depth
          FROM edges e
          JOIN concepts c ON c.id = e.child_id
          LEFT JOIN attributes a ON a.id = e.attribute_id
          WHERE e.parent_id = $1
            AND e.graph_path = $3::integer[]
            AND e.is_hidden = false
          UNION ALL
          SELECT e.id, e.child_id, e.parent_id, e.graph_path, e.attribute_id,
                 c.name, a.name, st.depth + 1
          FROM edges e
          JOIN concepts c ON c.id = e.child_id
          LEFT JOIN attributes a ON a.id = e.attribute_id
          JOIN subtree st ON e.parent_id = st.child_id
            AND e.graph_path = st.graph_path || st.child_id
          WHERE e.is_hidden = false
            AND st.depth < 50
        )
        SELECT edge_id, child_id, parent_id, concept_name, graph_path, attribute_name, depth
        FROM subtree
        ORDER BY depth, concept_name
        LIMIT $2`,
        [id, SUBTREE_LIMIT + 1, childGraphPathLiteral]
      );

      const truncated = result.rows.length > SUBTREE_LIMIT;
      const edges = (truncated ? result.rows.slice(0, SUBTREE_LIMIT) : result.rows).map(row => ({
        edge_id: row.edge_id,
        child_id: row.child_id,
        parent_id: row.parent_id,
        concept_name: row.concept_name,
        graph_path: row.graph_path,
        attribute_name: row.attribute_name,
        depth: row.depth,
      }));

      res.json({ edges, truncated });
    } catch (error) {
      console.error('Error fetching subtree:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Copy one or more sibling questions' full subtrees (descendant edges + links)
  // under another sibling question ("nest under sibling"). Additive copy — originals
  // are untouched. Copied edges/links preserve their original author.
  nestUnderSibling: async (req, res) => {
    const NEST_EDGE_CAP = 1000;
    let { parentConceptId, path, selectedEdgeIds, targetEdgeId } = req.body;

    try {
      parentConceptId = parseInt(parentConceptId);
      targetEdgeId = parseInt(targetEdgeId);
      // P = graph_path of the sibling edges on the page (root-to-parent inclusive).
      // Empty P => the root-list page: siblings are root edges (parent_id NULL, graph_path '{}').
      const P = Array.isArray(path)
        ? path.map(Number)
        : (path ? String(path).split(',').filter(Boolean).map(Number) : []);
      const rootMode = P.length === 0;
      const selectedIds = Array.isArray(selectedEdgeIds)
        ? [...new Set(selectedEdgeIds.map(Number).filter((n) => !isNaN(n)))]
        : [];

      if (!rootMode && (!parentConceptId || isNaN(parentConceptId))) {
        return res.status(400).json({ error: 'parentConceptId is required' });
      }
      if (!targetEdgeId || isNaN(targetEdgeId)) {
        return res.status(400).json({ error: 'targetEdgeId is required' });
      }
      if (selectedIds.length === 0) {
        return res.status(400).json({ error: 'Select at least one question to nest' });
      }
      if (selectedIds.includes(targetEdgeId)) {
        return res.status(400).json({ error: 'The target cannot be one of the selected questions' });
      }
      if (P.some((n) => isNaN(n))) {
        return res.status(400).json({ error: 'Invalid path' });
      }

      const pLiteral = '{' + P.join(',') + '}';

      // All selected edges + the target edge must be real siblings on this page.
      // Root-list page: parent_id IS NULL, graph_path '{}'. Concept page: parent_id = C,
      // graph_path = P. (not hidden either way)
      const allEdgeIds = [...selectedIds, targetEdgeId];
      const siblingResult = rootMode
        ? await pool.query(
            `SELECT id, child_id, attribute_id
               FROM edges
              WHERE id = ANY($1::int[])
                AND parent_id IS NULL
                AND graph_path = '{}'::integer[]
                AND is_hidden = false`,
            [allEdgeIds]
          )
        : await pool.query(
            `SELECT id, child_id, attribute_id
               FROM edges
              WHERE id = ANY($1::int[])
                AND parent_id = $2
                AND graph_path = $3::integer[]
                AND is_hidden = false`,
            [allEdgeIds, parentConceptId, pLiteral]
          );
      if (siblingResult.rows.length !== allEdgeIds.length) {
        return res.status(400).json({ error: 'Selected questions and target must all be siblings on this page' });
      }

      // Preserve the single-attribute-graph invariant: everything must share one attribute.
      // (Always true within one concept graph; the real guard is on the root-list page,
      // where different roots could belong to different attributes.)
      const attributeIds = new Set(siblingResult.rows.map((r) => r.attribute_id));
      if (attributeIds.size > 1) {
        return res.status(400).json({ error: 'Selected questions and target must share the same attribute' });
      }

      // Phase 72a: everything must be in the same community. Matters on the
      // root-list page (rootMode), where root edges from different communities
      // pass the sibling check (both parent_id NULL, graph_path '{}') but a
      // graph_path must never cross communities.
      const childConceptIds = siblingResult.rows.map((r) => r.child_id);
      const communityRows = await pool.query(
        'SELECT DISTINCT community_id FROM concepts WHERE id = ANY($1::int[])',
        [childConceptIds]
      );
      if (communityRows.rows.length > 1) {
        return res.status(400).json({ error: 'Selected questions and target must be in the same community' });
      }

      const targetRow = siblingResult.rows.find((r) => r.id === targetEdgeId);
      const T = targetRow.child_id;
      const targetName = (await pool.query('SELECT name FROM concepts WHERE id = $1', [T])).rows[0]?.name || null;

      // Phase 73: nest-under-sibling (a copy) is open-communities only. In curated
      // communities "Move into…" (a true move) replaces it, so refuse here for
      // everyone, owners included.
      const nestCommunity = await communityAccess.getCommunityForEdge(targetEdgeId);
      if (nestCommunity && nestCommunity.mode === 'curated') {
        return res.status(403).json({
          error: 'Nest under sibling is only available in open communities. Use “Move into…” to restructure a curated graph.',
          code: 'open_only',
        });
      }
      // Phase 72a: open communities still require a logged-in writer.
      const nestWriteCheck = await communityAccess.assertCanWriteStructure(nestCommunity, req.user.userId);
      if (!nestWriteCheck.ok) {
        return res.status(nestWriteCheck.status).json({ error: nestWriteCheck.error, code: nestWriteCheck.code });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        let copiedEdges = 0;
        let copiedLinks = 0;
        let totalSourceEdges = 0;

        for (const sel of siblingResult.rows) {
          if (sel.id === targetEdgeId) continue;
          const X = sel.child_id;
          const N = P.length + 1;
          const prefixWithX = '{' + [...P, X].join(',') + '}';

          // Source edges = the selected (X) edge itself + all its descendants in this context.
          const srcResult = await client.query(
            `SELECT id AS edge_id, parent_id, child_id, graph_path, attribute_id, created_by
               FROM edges
              WHERE is_hidden = false
                AND (id = $1 OR graph_path[1:$2] = $3::integer[])
              ORDER BY array_length(graph_path, 1) NULLS FIRST`,
            [sel.id, N, prefixWithX]
          );

          totalSourceEdges += srcResult.rows.length;
          if (totalSourceEdges > NEST_EDGE_CAP) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Too many questions to copy (limit ${NEST_EDGE_CAP})` });
          }

          // oldEdgeId -> { newEdgeId, isNew }. Links are copied only for newly-created
          // edges so a repeated nest is fully idempotent (no duplicate links).
          const edgeIdMap = new Map();

          for (const src of srcResult.rows) {
            const gp = src.graph_path || [];
            // Splice T in at position P.length: newPath = P + [T] + gp.slice(P.length)
            const newPath = [...P, T, ...gp.slice(P.length)];
            const newParent = newPath[newPath.length - 1];

            // Cycle guard: a concept cannot appear in its own ancestor path.
            if (newPath.includes(src.child_id)) {
              await client.query('ROLLBACK');
              return res.status(400).json({ error: 'Cannot nest: would create a cycle in the graph' });
            }

            const newPathLiteral = '{' + newPath.join(',') + '}';
            const insertResult = await client.query(
              `INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by)
               VALUES ($1, $2, $3::integer[], $4, $5)
               ON CONFLICT (parent_id, child_id, graph_path, attribute_id) DO NOTHING
               RETURNING id`,
              [newParent, src.child_id, newPathLiteral, src.attribute_id, src.created_by]
            );

            let newEdgeId;
            let isNew;
            if (insertResult.rows.length > 0) {
              newEdgeId = insertResult.rows[0].id;
              isNew = true;
              copiedEdges += 1;
            } else {
              const existing = await client.query(
                `SELECT id FROM edges
                  WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3::integer[] AND attribute_id = $4`,
                [newParent, src.child_id, newPathLiteral, src.attribute_id]
              );
              newEdgeId = existing.rows[0].id;
              isNew = false;
            }
            edgeIdMap.set(src.edge_id, { newEdgeId, isNew });
          }

          // Copy links from each source edge to its mapped new edge (preserve original
          // author), but only for edges we just created — keeps re-nesting idempotent.
          for (const [oldEdgeId, { newEdgeId, isNew }] of edgeIdMap.entries()) {
            if (!isNew) continue;
            const linkResult = await client.query(
              `INSERT INTO concept_links (edge_id, url, title, comment, added_by)
               SELECT $1, url, title, comment, added_by
                 FROM concept_links
                WHERE edge_id = $2 AND legal_hold = false
               RETURNING id`,
              [newEdgeId, oldEdgeId]
            );
            copiedLinks += linkResult.rows.length;
          }
        }

        await client.query('COMMIT');

        res.status(201).json({
          message: 'Nested under sibling',
          copiedEdges,
          copiedLinks,
          target: { edgeId: targetEdgeId, name: targetName },
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error nesting under sibling:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 73: group selected sibling questions under a NEW parent question.
  // Curated-owner-only. Inserts a goal question at this level and moves the
  // selection (with their subtrees) under it. Supports dryRun (every check, no
  // writes). Body: { selectedEdgeIds, name, dryRun? }.
  groupUnderNewParent: async (req, res) => {
    const selectedEdgeIds = Array.isArray(req.body.selectedEdgeIds)
      ? [...new Set(req.body.selectedEdgeIds.map(Number).filter((n) => !isNaN(n)))]
      : [];
    const dryRun = !!req.body.dryRun;
    const rawName = typeof req.body.name === 'string' ? req.body.name : '';
    const trimmed = rawName.trim();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const v = await validateSelectedSiblings(client, selectedEdgeIds);
      if (!v.ok) { await client.query('ROLLBACK'); return res.status(v.status).json({ error: v.error, code: v.code }); }

      // Curated-owner gating (open → curated_only, non-owner → curated_owner_only).
      const community = await communityAccess.getCommunityForConcept(v.selectedChildIds[0]);
      const gate = await communityAccess.assertCuratedOwner(community, req.user.userId);
      if (!gate.ok) { await client.query('ROLLBACK'); return res.status(gate.status).json({ error: gate.error, code: gate.code }); }

      if (!trimmed) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'A name is required.', code: 'empty_name' }); }
      if (trimmed.length > 255) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The name must be 255 characters or fewer.', code: 'name_too_long' }); }

      const movedRows = await lockMovedSet(client, selectedEdgeIds, v.G, v.selectedChildIds);
      if (movedRows.length > RESTRUCTURE_EDGE_CAP) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Too many questions to move (limit ${RESTRUCTURE_EDGE_CAP}).`, code: 'too_large' });
      }
      if (await anyLegalHoldInSet(client, movedRows.map((r) => r.id))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'One of these questions (or its links) is held for legal reasons.', code: 'legal_hold' });
      }

      const gLiteral = '{' + v.G.join(',') + '}';
      const parentForLevel = v.parentForLevel;

      // Resolve the new parent concept N (reuse an existing same-name concept, as
      // /child does; otherwise create it).
      let N = null;
      let newEdgeId = null;
      const existingConcept = await client.query(
        'SELECT id, legal_hold FROM concepts WHERE community_id = $1 AND LOWER(name) = LOWER($2)',
        [v.communityId, trimmed]
      );
      if (existingConcept.rows.length) {
        N = existingConcept.rows[0].id;
        if (existingConcept.rows[0].legal_hold) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'A question with that name is held for legal reasons.', code: 'legal_hold' });
        }
        const existingEdge = await client.query(
          'SELECT id, deleted_at FROM edges WHERE child_id = $1 AND graph_path = $2::integer[] AND (parent_id IS NOT DISTINCT FROM $3)',
          [N, gLiteral, parentForLevel]
        );
        if (existingEdge.rows.length) {
          if (!existingEdge.rows[0].deleted_at) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              error: 'A question with that name is already here. Use “Move into…” to group the selection under it.',
              code: 'sibling_exists',
              edgeId: existingEdge.rows[0].id,
            });
          }
          // Restore the soft-deleted edge as the new parent edge.
          newEdgeId = existingEdge.rows[0].id;
        }
      }

      // Cycle: N must not be an ancestor (in G) nor appear inside any moved subtree.
      const forbidden = new Set(v.G);
      for (const r of movedRows) { forbidden.add(r.child_id); for (const g of (r.graph_path || [])) forbidden.add(g); }
      if (N !== null && forbidden.has(N)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'That would place a question inside itself.', code: 'cycle' });
      }

      // Create or restore N's edge at this level.
      if (N === null) {
        const created = await client.query(
          'INSERT INTO concepts (name, created_by, community_id) VALUES ($1, $2, $3) RETURNING id',
          [trimmed, req.user.userId, v.communityId]
        );
        N = created.rows[0].id;
      }
      if (newEdgeId === null) {
        const ce = await client.query(
          'INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by) VALUES ($1, $2, $3::integer[], $4, $5) RETURNING id',
          [parentForLevel, N, gLiteral, v.attributeId, req.user.userId]
        );
        newEdgeId = ce.rows[0].id;
      } else {
        await client.query(
          'UPDATE edges SET deleted_at = NULL, deleted_by = NULL, delete_batch_id = NULL, is_hidden = false WHERE id = $1',
          [newEdgeId]
        );
      }

      // Rewrite: insert N right after the shared prefix G for every moved edge.
      const L = v.G.length;
      const insertN = (oldPath) => [...oldPath.slice(0, L), N, ...oldPath.slice(L)];
      try {
        await applyPathRewrite(client, movedRows, insertN);
      } catch (e) {
        if (e.restructureCode === 'conflict') {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'A question with the same name already exists at the destination.', code: 'conflict', names: e.conflictNames });
        }
        throw e;
      }

      const movedCount = selectedEdgeIds.length;
      const descendantCount = movedRows.length - movedCount;

      if (dryRun) {
        await client.query('ROLLBACK');
        return res.json({ dryRun: true, movedCount, descendantCount, answersRemoved: 0 });
      }
      await client.query('COMMIT');
      return res.status(201).json({
        message: 'Grouped under a new question',
        newEdgeId, newConceptId: N, movedCount, descendantCount,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in groupUnderNewParent:', error);
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  },

  // Phase 73: move selected sibling questions INTO an existing sibling (the
  // target becomes their new parent). Curated-owner-only. Supports dryRun.
  // Body: { selectedEdgeIds, targetEdgeId, dryRun? }.
  moveIntoSibling: async (req, res) => {
    const selectedEdgeIds = Array.isArray(req.body.selectedEdgeIds)
      ? [...new Set(req.body.selectedEdgeIds.map(Number).filter((n) => !isNaN(n)))]
      : [];
    const targetEdgeId = parseInt(req.body.targetEdgeId, 10);
    const dryRun = !!req.body.dryRun;

    if (!targetEdgeId || isNaN(targetEdgeId)) {
      return res.status(400).json({ error: 'A target question is required.', code: 'not_siblings' });
    }
    if (selectedEdgeIds.includes(targetEdgeId)) {
      return res.status(400).json({ error: 'The target cannot be one of the selected questions.', code: 'target_selected' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const v = await validateSelectedSiblings(client, selectedEdgeIds);
      if (!v.ok) { await client.query('ROLLBACK'); return res.status(v.status).json({ error: v.error, code: v.code }); }

      const community = await communityAccess.getCommunityForConcept(v.selectedChildIds[0]);
      const gate = await communityAccess.assertCuratedOwner(community, req.user.userId);
      if (!gate.ok) { await client.query('ROLLBACK'); return res.status(gate.status).json({ error: gate.error, code: gate.code }); }

      // The target must be a visible, non-deleted sibling on the same level.
      const tRes = await client.query(
        `SELECT id, parent_id, graph_path, child_id, is_hidden, deleted_at
           FROM edges WHERE id = $1 FOR UPDATE`,
        [targetEdgeId]
      );
      if (tRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The target question no longer exists.', code: 'not_siblings' }); }
      const target = tRes.rows[0];
      const targetSamePath = (target.graph_path || []).join(',') === v.G.join(',');
      const targetSameParent = (target.parent_id === null ? v.parentForLevel === null : target.parent_id === v.parentForLevel);
      if (target.deleted_at || target.is_hidden || !targetSamePath || !targetSameParent) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'The target must be a sibling of the selected questions.', code: 'not_siblings' });
      }
      const N = target.child_id;

      const movedRows = await lockMovedSet(client, selectedEdgeIds, v.G, v.selectedChildIds);
      if (movedRows.length > RESTRUCTURE_EDGE_CAP) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Too many questions to move (limit ${RESTRUCTURE_EDGE_CAP}).`, code: 'too_large' });
      }
      if (await anyLegalHoldInSet(client, movedRows.map((r) => r.id))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'One of these questions (or its links) is held for legal reasons.', code: 'legal_hold' });
      }

      // Cycle: the target concept must not appear inside any moved subtree.
      const forbidden = new Set(v.G);
      for (const r of movedRows) { forbidden.add(r.child_id); for (const g of (r.graph_path || [])) forbidden.add(g); }
      if (forbidden.has(N)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'That would place a question inside itself.', code: 'cycle' });
      }

      const L = v.G.length;
      const insertN = (oldPath) => [...oldPath.slice(0, L), N, ...oldPath.slice(L)];
      try {
        await applyPathRewrite(client, movedRows, insertN);
      } catch (e) {
        if (e.restructureCode === 'conflict') {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'A question with the same name already exists under the target.', code: 'conflict', names: e.conflictNames });
        }
        throw e;
      }

      const movedCount = selectedEdgeIds.length;
      const descendantCount = movedRows.length - movedCount;

      if (dryRun) {
        await client.query('ROLLBACK');
        return res.json({ dryRun: true, movedCount, descendantCount, answersRemoved: 0 });
      }
      await client.query('COMMIT');
      return res.status(200).json({
        message: 'Moved into the target question',
        targetEdgeId, movedCount, descendantCount,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in moveIntoSibling:', error);
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  },

  // Phase 73: ungroup a question — move its children up one level and soft-delete
  // it. Curated-owner-only. Supports dryRun. Body: { dryRun? }.
  ungroupEdge: async (req, res) => {
    const edgeId = parseInt(req.params.edgeId, 10);
    const dryRun = !!req.body.dryRun;
    if (!edgeId || isNaN(edgeId)) {
      return res.status(400).json({ error: 'Invalid edge id' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const qRes = await client.query(
        'SELECT id, parent_id, graph_path, child_id, deleted_at FROM edges WHERE id = $1 FOR UPDATE',
        [edgeId]
      );
      if (qRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Question not found' }); }
      const Qe = qRes.rows[0];
      if (Qe.deleted_at) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This question has been deleted.', code: 'edge_deleted' }); }

      const community = await communityAccess.getCommunityForEdge(edgeId);
      const gate = await communityAccess.assertCuratedOwner(community, req.user.userId);
      if (!gate.ok) { await client.query('ROLLBACK'); return res.status(gate.status).json({ error: gate.error, code: gate.code }); }

      const G = Qe.graph_path || [];           // root-to-parent of Q
      const Q = Qe.child_id;
      const fullQ = [...G, Q];                   // children live at graph_path = fullQ
      const LQ = fullQ.length;                   // = G.length + 1
      const fullQLiteral = '{' + fullQ.join(',') + '}';

      // Lock the whole subtree under Q (children + deeper, including soft-deleted).
      const movedRows = (await client.query(
        `SELECT id, child_id, graph_path, legal_hold, deleted_at
           FROM edges e
          WHERE e.graph_path[1:$1] = $2::integer[]
          ORDER BY COALESCE(array_length(e.graph_path, 1), 0)
          FOR UPDATE`,
        [LQ, fullQLiteral]
      )).rows;

      // At least one VISIBLE direct child is required.
      const directChildren = movedRows.filter((r) => (r.graph_path || []).length === LQ && !r.deleted_at);
      const visibleDirect = (await client.query(
        `SELECT 1 FROM edges WHERE graph_path = $1::integer[] AND is_hidden = false AND deleted_at IS NULL LIMIT 1`,
        [fullQLiteral]
      )).rows;
      if (visibleDirect.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'This question has no children to ungroup.', code: 'no_children' });
      }

      if (movedRows.length + 1 > RESTRUCTURE_EDGE_CAP) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Too many questions to move (limit ${RESTRUCTURE_EDGE_CAP}).`, code: 'too_large' });
      }
      if (await anyLegalHoldInSet(client, [Qe.id, ...movedRows.map((r) => r.id)])) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This question (or part of its subtree, or a link) is held for legal reasons.', code: 'legal_hold' });
      }

      // Rewrite: drop the Q element at position LQ (0-indexed = G.length) for every
      // edge under Q, so children move up to level G.
      const Lg = G.length;
      const removeQ = (oldPath) => [...oldPath.slice(0, Lg), ...oldPath.slice(Lg + 1)];
      try {
        await applyPathRewrite(client, movedRows, removeQ);
      } catch (e) {
        if (e.restructureCode === 'conflict') {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'A question with the same name already exists at the upper level.', code: 'conflict', names: e.conflictNames });
        }
        throw e;
      }

      // Soft-delete Q's edge (its answers hide with it).
      await client.query(
        `WITH b AS (SELECT gen_random_uuid() AS batch_id)
         UPDATE edges SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $2,
                          delete_batch_id = (SELECT batch_id FROM b), is_hidden = true
          WHERE id = $1`,
        [Qe.id, req.user.userId]
      );

      const answersRemoved = parseInt((await client.query(
        'SELECT COUNT(*)::int AS c FROM concept_links WHERE edge_id = $1', [Qe.id]
      )).rows[0].c, 10);
      // Q's feedback becomes archived (computed from its deleted_at) when Q is
      // soft-deleted. Count the non-hidden items on Q's edge (any status, any kind).
      const feedbackArchived = parseInt((await client.query(
        'SELECT COUNT(*)::int AS c FROM feedback_items WHERE edge_id = $1 AND is_hidden = false', [Qe.id]
      )).rows[0].c, 10);

      const movedCount = directChildren.length;
      const descendantCount = movedRows.length - directChildren.length;

      if (dryRun) {
        await client.query('ROLLBACK');
        return res.json({ dryRun: true, movedCount, descendantCount, answersRemoved, feedbackArchived });
      }
      await client.query('COMMIT');
      return res.status(200).json({
        message: 'Ungrouped',
        movedCount, descendantCount, deletedEdgeId: Qe.id,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in ungroupEdge:', error);
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  },

  // Phase 72c-1: rename a question. Concept identity is community-scoped, so a
  // rename changes the name everywhere the concept appears in that community.
  // Curated-owner-only. A collision with another name in the community is 409
  // name_taken (with the clashing concept id); a legal-held concept is refused.
  renameConcept: async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;

    try {
      const conceptId = parseInt(id, 10);
      if (!conceptId || isNaN(conceptId)) {
        return res.status(400).json({ error: 'Invalid concept id' });
      }
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (!trimmed) {
        return res.status(400).json({ error: 'A name is required' });
      }
      if (trimmed.length > 255) {
        return res.status(400).json({ error: 'Concept name must be 255 characters or fewer' });
      }

      const conceptRow = await pool.query(
        'SELECT id, name, community_id, legal_hold FROM concepts WHERE id = $1',
        [conceptId]
      );
      if (conceptRow.rows.length === 0) {
        return res.status(404).json({ error: 'Concept not found' });
      }
      const concept = conceptRow.rows[0];

      // Curated-owner gating (open → curated_only, non-owner → curated_owner_only).
      const community = await communityAccess.getCommunityForConcept(conceptId);
      const gate = await communityAccess.assertCuratedOwner(community, req.user.userId);
      if (!gate.ok) {
        return res.status(gate.status).json({ error: gate.error, code: gate.code });
      }

      if (concept.legal_hold) {
        return res.status(403).json({ error: 'This question has been held for legal reasons and cannot be renamed.', code: 'legal_hold' });
      }

      // No-op rename (same text) short-circuits — avoids a self-collision on the
      // case-insensitive unique index.
      if (concept.name.toLowerCase() !== trimmed.toLowerCase()) {
        const clash = await pool.query(
          'SELECT id FROM concepts WHERE community_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3',
          [concept.community_id, trimmed, conceptId]
        );
        if (clash.rows.length > 0) {
          return res.status(409).json({
            error: 'Another question in this community already has this name.',
            code: 'name_taken',
            conceptId: clash.rows[0].id,
          });
        }
      }

      const updated = await pool.query(
        'UPDATE concepts SET name = $1 WHERE id = $2 RETURNING id, name',
        [trimmed, conceptId]
      );

      res.json({ message: 'Question renamed', concept: updated.rows[0] });
    } catch (error) {
      console.error('Error renaming concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 72c-1: soft-delete an edge and its path-scoped subtree in a curated
  // community. Curated-owner-only. All affected edges (this edge + every edge
  // whose graph_path starts with this edge's full path) are stamped with one
  // delete_batch_id, get deleted_at/deleted_by set, and are hidden. Refused with
  // 409 legal_hold if any affected edge or link is held. One transaction.
  softDeleteEdge: async (req, res) => {
    const { edgeId } = req.params;

    try {
      const eid = parseInt(edgeId, 10);
      if (!eid || isNaN(eid)) {
        return res.status(400).json({ error: 'Invalid edge id' });
      }

      const edgeRow = await pool.query(
        'SELECT id, child_id, graph_path, deleted_at FROM edges WHERE id = $1',
        [eid]
      );
      if (edgeRow.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }
      const edge = edgeRow.rows[0];
      if (edge.deleted_at) {
        return res.status(400).json({ error: 'This question is already deleted' });
      }

      // Curated-owner gating.
      const community = await communityAccess.getCommunityForEdge(eid);
      const gate = await communityAccess.assertCuratedOwner(community, req.user.userId);
      if (!gate.ok) {
        return res.status(gate.status).json({ error: gate.error, code: gate.code });
      }

      // The affected set = this edge + every edge whose graph_path begins with
      // this edge's FULL path (root-to-this-concept inclusive). Path-scoped per
      // the recursive-descendant AD: a prefix match on graph_path never leaks
      // across sibling contexts.
      const fullPath = [...(edge.graph_path || []), edge.child_id];
      const N = fullPath.length;
      const fullPathLiteral = '{' + fullPath.join(',') + '}';
      // Match-either predicate reused for the legal-hold scan and the update.
      const affectedPredicate = '(e.id = $1 OR e.graph_path[1:$2] = $3::integer[])';

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Refuse if any affected edge is legally held.
        const heldEdge = await client.query(
          `SELECT 1 FROM edges e WHERE ${affectedPredicate} AND e.legal_hold = true LIMIT 1`,
          [eid, N, fullPathLiteral]
        );
        if (heldEdge.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'This question (or part of its subtree) is held for legal reasons and cannot be deleted.', code: 'legal_hold' });
        }

        // Refuse if any link on any affected edge is legally held.
        const heldLink = await client.query(
          `SELECT 1 FROM concept_links cl
             JOIN edges e ON e.id = cl.edge_id
            WHERE ${affectedPredicate} AND cl.legal_hold = true LIMIT 1`,
          [eid, N, fullPathLiteral]
        );
        if (heldLink.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'A link on this question (or its subtree) is held for legal reasons, so it cannot be deleted.', code: 'legal_hold' });
        }

        // One shared batch id for the whole delete action.
        const updateResult = await client.query(
          `WITH b AS (SELECT gen_random_uuid() AS batch_id)
           UPDATE edges e
              SET deleted_at = CURRENT_TIMESTAMP,
                  deleted_by = $4,
                  delete_batch_id = (SELECT batch_id FROM b),
                  is_hidden = true
            WHERE ${affectedPredicate} AND e.deleted_at IS NULL
           RETURNING e.id, e.delete_batch_id`,
          [eid, N, fullPathLiteral, req.user.userId]
        );

        await client.query('COMMIT');

        res.json({
          message: 'Question deleted',
          deletedCount: updateResult.rows.length,
          batchId: updateResult.rows[0]?.delete_batch_id || null,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error deleting edge:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 72d: the whole graph (collapsible tree) for the graph-view overlay.
  // Guest-accessible. Scope is either ONE root's graph (rootConceptId given:
  // the root edge + every descendant, matched by graph_path prefix) or the
  // WHOLE community (every root and descendant). Deleted and hidden edges, and
  // legal-held links, never appear. A small, fixed number of queries regardless
  // of graph size (no per-node queries): one community-mode lookup, an optional
  // root-validation lookup, one edges query (with correlated count subqueries),
  // and — in curated — one answers query. parentEdgeId and sortDate are derived
  // in JS. Capped at 2000 edges (truncated: true if hit).
  getGraph: async (req, res) => {
    const GRAPH_EDGE_CAP = 2000;
    try {
      const cid = parseInt(req.query.communityId, 10);
      if (!cid || isNaN(cid)) {
        return res.status(400).json({ error: 'communityId is required' });
      }

      const commRow = await pool.query('SELECT mode FROM communities WHERE id = $1', [cid]);
      if (commRow.rows.length === 0) {
        return res.status(404).json({ error: 'Community not found' });
      }
      const mode = commRow.rows[0].mode;
      const curated = mode === 'curated';

      // rootConceptId is optional. When present it must be a live root of THIS
      // community (a non-hidden, non-deleted root edge).
      let rootConceptId = null;
      const ridRaw = req.query.rootConceptId;
      if (ridRaw !== undefined && ridRaw !== null && String(ridRaw).trim().length > 0) {
        rootConceptId = parseInt(ridRaw, 10);
        if (!rootConceptId || isNaN(rootConceptId)) {
          return res.status(400).json({ error: 'Invalid rootConceptId' });
        }
        const rootCheck = await pool.query(
          `SELECT 1 FROM edges e
             JOIN concepts c ON c.id = e.child_id
            WHERE e.parent_id IS NULL AND e.child_id = $1
              AND e.is_hidden = false AND e.deleted_at IS NULL
              AND c.community_id = $2`,
          [rootConceptId, cid]
        );
        if (rootCheck.rows.length === 0) {
          return res.status(404).json({ error: 'Root question not found in this community' });
        }
      }

      // One edges query. The per-edge counts are correlated subqueries (one SQL
      // statement — not a JS loop). Ordered shallow-to-deep so, if we hit the
      // cap, the dropped rows are the deepest leaves and a kept child always has
      // its parent kept (no orphans above a missing parent).
      const selectCols = `
        e.id AS edge_id, e.parent_id, e.child_id, e.graph_path, e.created_at,
        c.name,
        (SELECT COUNT(*) FROM concept_links cl WHERE cl.edge_id = e.id AND cl.legal_hold = false)::int AS link_count,
        (SELECT COUNT(*) FROM votes v WHERE v.edge_id = e.id)::int AS save_count,
        (SELECT COUNT(*) FROM edges ce
           WHERE ce.parent_id = e.child_id
             AND ce.graph_path = e.graph_path || e.child_id
             AND ce.is_hidden = false)::int AS child_count`;

      let edgeResult;
      if (rootConceptId) {
        // Root edge (graph_path '{}') OR any edge whose graph_path starts with
        // this root concept. A graph_path never crosses communities, so this is
        // automatically community-safe.
        edgeResult = await pool.query(
          `SELECT ${selectCols}
             FROM edges e
             JOIN concepts c ON c.id = e.child_id
            WHERE ((e.parent_id IS NULL AND e.child_id = $1) OR e.graph_path[1] = $1)
              AND e.is_hidden = false AND e.deleted_at IS NULL
            ORDER BY array_length(e.graph_path, 1) NULLS FIRST, e.id
            LIMIT $2`,
          [rootConceptId, GRAPH_EDGE_CAP + 1]
        );
      } else {
        edgeResult = await pool.query(
          `SELECT ${selectCols}
             FROM edges e
             JOIN concepts c ON c.id = e.child_id
            WHERE c.community_id = $1
              AND e.is_hidden = false AND e.deleted_at IS NULL
            ORDER BY array_length(e.graph_path, 1) NULLS FIRST, e.id
            LIMIT $2`,
          [cid, GRAPH_EDGE_CAP + 1]
        );
      }

      const truncated = edgeResult.rows.length > GRAPH_EDGE_CAP;
      const rows = truncated ? edgeResult.rows.slice(0, GRAPH_EDGE_CAP) : edgeResult.rows;

      // Derive parentEdgeId from graph_path (AD #137): the parent edge is the
      // one whose child is graph_path[last] with path graph_path[0..last-1].
      const edgeByChildPath = new Map();
      for (const r of rows) {
        edgeByChildPath.set(`${r.child_id}|${(r.graph_path || []).join(',')}`, r.edge_id);
      }
      const parentEdgeIdOf = (r) => {
        const gp = r.graph_path || [];
        if (r.parent_id === null || gp.length === 0) return null;
        const parentChild = gp[gp.length - 1];
        const parentPath = gp.slice(0, -1);
        const found = edgeByChildPath.get(`${parentChild}|${parentPath.join(',')}`);
        return found === undefined ? null : found;
      };

      const nodes = rows.map((r) => {
        const node = {
          edgeId: r.edge_id,
          parentEdgeId: parentEdgeIdOf(r),
          conceptId: r.child_id,
          name: r.name,
          graphPath: r.graph_path || [],
          childCount: r.child_count,
          linkCount: r.link_count,
          createdAt: r.created_at,
        };
        if (!curated) node.saveCount = r.save_count;
        return node;
      });

      if (curated) {
        const edgeIds = rows.map((r) => r.edge_id);
        const answersByEdge = await loadAnswersByEdge(edgeIds);
        const nodeByEdge = new Map(nodes.map((n) => [n.edgeId, n]));

        for (const n of nodes) {
          const answers = answersByEdge.get(n.edgeId) || [];
          n.answers = answers;
          n._ownDate = answers.length > 0 ? answers[0].publishedOn : null;
        }

        // children keyed by parentEdgeId, for a subtree-date aggregation pass.
        const childrenByParent = new Map();
        for (const n of nodes) {
          if (n.parentEdgeId != null) {
            if (!childrenByParent.has(n.parentEdgeId)) childrenByParent.set(n.parentEdgeId, []);
            childrenByParent.get(n.parentEdgeId).push(n.edgeId);
          }
        }

        // Dates are 'YYYY-MM-DD' strings — lexicographic max == chronological max.
        const maxDate = (a, b) => (!a ? (b || null) : (!b ? a : (a >= b ? a : b)));
        const computeSubtree = (edgeId) => {
          const n = nodeByEdge.get(edgeId);
          let descMax = null;
          for (const k of (childrenByParent.get(edgeId) || [])) {
            descMax = maxDate(descMax, computeSubtree(k));
          }
          n._descMax = descMax;
          return maxDate(n._ownDate, descMax);
        };
        // Forest roots: no parent in the fetched set.
        for (const n of nodes) {
          if (n.parentEdgeId == null || !nodeByEdge.has(n.parentEdgeId)) {
            computeSubtree(n.edgeId);
          }
        }
        for (const n of nodes) {
          // Phase 72b recency rule: own newest answer date, else newest
          // descendant answer date; null when the question (and its whole
          // subtree) has no answers.
          n.sortDate = n._ownDate || n._descMax || null;
          delete n._ownDate;
          delete n._descMax;
        }
      }

      res.json({ mode, truncated, nodes });
    } catch (error) {
      console.error('Error fetching graph:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 71: cross-community exact-name bridge. For the concept being viewed,
  // find same-normalized-name concepts in OTHER communities. `viewMode` is a legacy
  // field (Flip View is retired): the frontend now opens every bridge target in the
  // normal children view, so the value is informational only.
  getConceptBridges: async (req, res) => {
    const { id } = req.params;

    try {
      const conceptResult = await pool.query(
        'SELECT id, community_id, normalized_name FROM concepts WHERE id = $1',
        [id]
      );
      if (conceptResult.rows.length === 0) {
        return res.status(404).json({ error: 'Concept not found' });
      }
      const { community_id, normalized_name } = conceptResult.rows[0];

      const bridgesResult = await pool.query(
        `SELECT c.id AS concept_id,
                c.community_id,
                comm.name AS community_name,
                comm.slug AS community_slug,
                EXISTS (
                  SELECT 1 FROM edges e
                  WHERE e.child_id = c.id AND e.parent_id IS NOT NULL AND e.is_hidden = false
                ) AS has_nonroot_placement
         FROM concepts c
         JOIN communities comm ON comm.id = c.community_id
         WHERE c.normalized_name = $1 AND c.community_id <> $2
         ORDER BY comm.name`,
        [normalized_name, community_id]
      );

      const bridges = bridgesResult.rows.map((row) => ({
        conceptId: row.concept_id,
        communityId: row.community_id,
        communityName: row.community_name,
        communitySlug: row.community_slug,
        viewMode: row.has_nonroot_placement ? 'flip' : 'root',
      }));

      res.json({ bridges });
    } catch (error) {
      console.error('Error fetching concept bridges:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};

module.exports = conceptsController;
