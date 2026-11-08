// Phase 72e-1: reader feedback for curated communities.
//
// A feedback item is a public suggestion attached to one question card (edge):
// reword the question, change an answer, or just a free-text note (plus branch
// suggestions, new_child). Items are visible immediately; owners
// can hide items or replies and set a status (open / incorporated / declined).
// Readers reply and upvote. Every item snapshots the text it was written against
// so the thread stays legible after the owner edits the question.
//
// House conventions: optionalAuth on GET (guests read), authenticateToken on all
// writes; req.user.userId for identity; LEFT JOIN users through the SET NULL
// author columns; communityAccess helpers for the curated/owner boundary; the
// Safe Browsing util for suggested answer URLs. Never throw to the client.

const pool = require('../config/database');
const crypto = require('crypto');
const communityAccess = require('../utils/communityAccess');
const safeBrowsing = require('../utils/safeBrowsing');

const KINDS = new Set([
  'edit_question', 'edit_answer', 'new_child', 'general',
]);
const STATUSES = new Set(['open', 'incorporated', 'declined']);
const MAX_COMMENT = 2000;

function isSiteAdmin(userId) {
  const adminUserId = parseInt(process.env.ADMIN_USER_ID || '0', 10);
  return !!adminUserId && userId === adminUserId;
}

// Mirrors votesController.validatePublishedOn (strict YYYY-MM-DD calendar date,
// not more than a year ahead). Kept local to avoid coupling the two controllers.
function validatePublishedOn(raw) {
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false, error: 'Publication date must be in YYYY-MM-DD format.' };
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return { ok: false, error: 'Publication date is not a valid calendar date.' };
  }
  const oneYearAhead = new Date();
  oneYearAhead.setUTCFullYear(oneYearAhead.getUTCFullYear() + 1);
  if (d.getTime() > oneYearAhead.getTime()) {
    return { ok: false, error: 'Publication date cannot be more than a year in the future.' };
  }
  return { ok: true, value: s };
}

// One edge lookup with its community + concept name (the edge's community is its
// child concept's). deleted_at drives the archived rule; is_hidden excludes
// moderated edges from being feedback targets.
async function loadEdge(edgeId) {
  const r = await pool.query(
    `SELECT e.id, e.parent_id, e.graph_path, e.child_id, e.deleted_at, e.is_hidden,
            c.community_id, c.name AS concept_name, comm.mode
       FROM edges e
       JOIN concepts c ON c.id = e.child_id
       JOIN communities comm ON comm.id = c.community_id
      WHERE e.id = $1`,
    [edgeId]
  );
  return r.rows[0] || null;
}

// Validate + normalize the kind-specific proposal (edit_question, edit_answer).
// Other kinds carry no proposal. Async because a suggested answer URL is checked
// against Safe Browsing. Returns { ok, proposal } or { ok:false, status, code, error }.
async function buildProposal(kind, proposalInput, userId) {
  const src = proposalInput || {};
  if (kind === 'edit_question') {
    const name = (src.name == null ? '' : String(src.name)).trim();
    if (!name) return { ok: false, status: 400, code: 'name_required', error: 'A proposed question is required.' };
    if (name.length > 255) return { ok: false, status: 400, code: 'name_too_long', error: 'Proposed question is too long (max 255 characters).' };
    return { ok: true, proposal: { name } };
  }
  if (kind === 'edit_answer') {
    const p = {};
    let any = false;
    if (src.url !== undefined && String(src.url).trim() !== '') {
      const url = String(src.url).trim();
      if (!/^https?:\/\/.+/i.test(url)) return { ok: false, status: 400, code: 'invalid_url', error: 'URL must start with http:// or https://' };
      if (url.length > 2048) return { ok: false, status: 400, code: 'invalid_url', error: 'URL is too long (max 2048 characters).' };
      const sb = await safeBrowsing.checkUrl(url);
      if (!sb.safe) {
        const urlHash = crypto.createHash('sha256').update(url.toLowerCase()).digest('hex');
        await pool.query(
          `INSERT INTO safe_browsing_rejections (attempted_by_user_id, url_hash, threat_types, source)
           VALUES ($1, $2, $3, $4)`,
          [userId, urlHash, sb.threats, 'feedback']
        );
        return { ok: false, status: 403, code: 'unsafe_url', error: 'This URL was flagged by Google Safe Browsing and cannot be posted.' };
      }
      p.url = url; any = true;
    }
    if (src.title !== undefined && String(src.title).trim() !== '') {
      p.title = String(src.title).trim().substring(0, 255); any = true;
    }
    if (src.comment !== undefined) {
      p.comment = String(src.comment).trim().substring(0, MAX_COMMENT); any = true;
    }
    if (src.publishedOn !== undefined && String(src.publishedOn).trim() !== '') {
      const v = validatePublishedOn(String(src.publishedOn).trim());
      if (!v.ok) return { ok: false, status: 400, code: 'invalid_published_on', error: v.error };
      p.publishedOn = v.value; any = true;
    }
    if (!any) return { ok: false, status: 400, code: 'empty_proposal', error: 'Suggest at least one change to the answer.' };
    return { ok: true, proposal: p };
  }
  return { ok: true, proposal: null };
}

function authorOf(row) {
  if (!row.author_id) return null;
  return { id: row.author_id, username: row.author_username || null, orcidId: row.author_orcid_id || null };
}

// Phase 72e-2: load a community row by id (for root-list new_child suggestions,
// which have no edge to resolve the community from).
async function loadCommunity(communityId) {
  const r = await pool.query('SELECT id, mode FROM communities WHERE id = $1', [communityId]);
  return r.rows[0] || null;
}

// Phase 72e-2: validate a nested branch-suggestion tree (new_child). Enforces at
// least one node, a 50-node cap, non-empty names ≤255, and — per node — an
// optional answer whose URL (when present) is http(s), length-capped, Safe
// Browsing-clean, with a valid publication date. Async because of Safe Browsing.
// Returns { ok, count } or { ok:false, status, code, error }.
async function validateSuggestedNodes(nodes, userId) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ok: false, status: 400, code: 'nodes_required', error: 'Suggest at least one question.' };
  }
  let count = 0;
  const walk = async (list) => {
    if (!Array.isArray(list)) return { ok: true };
    for (const node of list) {
      count += 1;
      if (count > 50) return { ok: false, status: 400, code: 'too_many_nodes', error: 'A suggestion can have at most 50 questions.' };
      const name = (node && node.name != null ? String(node.name) : '').trim();
      if (!name) return { ok: false, status: 400, code: 'name_required', error: 'Every suggested question needs text.' };
      if (name.length > 255) return { ok: false, status: 400, code: 'name_too_long', error: 'A suggested question is too long (max 255 characters).' };
      const ans = node && node.answer;
      if (ans && ans.url != null && String(ans.url).trim() !== '') {
        const url = String(ans.url).trim();
        if (!/^https?:\/\/.+/i.test(url)) return { ok: false, status: 400, code: 'invalid_url', error: 'Answer URL must start with http:// or https://' };
        if (url.length > 2048) return { ok: false, status: 400, code: 'invalid_url', error: 'Answer URL is too long (max 2048 characters).' };
        const sb = await safeBrowsing.checkUrl(url);
        if (!sb.safe) {
          const urlHash = crypto.createHash('sha256').update(url.toLowerCase()).digest('hex');
          await pool.query(
            `INSERT INTO safe_browsing_rejections (attempted_by_user_id, url_hash, threat_types, source)
             VALUES ($1, $2, $3, $4)`,
            [userId, urlHash, sb.threats, 'feedback']
          );
          return { ok: false, status: 403, code: 'unsafe_url', error: 'An answer URL was flagged by Google Safe Browsing and cannot be posted.' };
        }
        if (ans.publishedOn != null && String(ans.publishedOn).trim() !== '') {
          const v = validatePublishedOn(String(ans.publishedOn).trim());
          if (!v.ok) return { ok: false, status: 400, code: 'invalid_published_on', error: v.error };
        }
        if (ans.comment != null && String(ans.comment).length > MAX_COMMENT) {
          return { ok: false, status: 400, code: 'comment_too_long', error: `An answer comment is too long (max ${MAX_COMMENT} characters).` };
        }
        if (ans.title != null && String(ans.title).length > 255) {
          return { ok: false, status: 400, code: 'title_too_long', error: 'An answer title is too long (max 255 characters).' };
        }
      }
      const r = await walk(node.children);
      if (!r.ok) return r;
    }
    return { ok: true };
  };
  const res = await walk(nodes);
  if (!res.ok) return res;
  return { ok: true, count };
}

// Insert a validated branch-suggestion tree under one feedback item, in order.
// Runs inside a transaction (pass the connected client).
async function insertSuggestedNodes(client, feedbackId, nodes, parentNodeId) {
  if (!Array.isArray(nodes)) return;
  let position = 0;
  for (const node of nodes) {
    const name = String(node.name).trim();
    const ans = node && node.answer;
    const hasUrl = ans && ans.url != null && String(ans.url).trim() !== '';
    const url = hasUrl ? String(ans.url).trim() : null;
    const title = hasUrl && ans.title != null && String(ans.title).trim() !== '' ? String(ans.title).trim().substring(0, 255) : null;
    const publishedOn = hasUrl && ans.publishedOn != null && String(ans.publishedOn).trim() !== '' ? String(ans.publishedOn).trim() : null;
    const comment = hasUrl && ans.comment != null && String(ans.comment).trim() !== '' ? String(ans.comment).trim().substring(0, MAX_COMMENT) : null;
    const inserted = await client.query(
      `INSERT INTO feedback_suggested_nodes
         (feedback_id, parent_node_id, name, answer_url, answer_title, answer_published_on, answer_comment, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [feedbackId, parentNodeId, name, url, title, publishedOn, comment, position]
    );
    position += 1;
    await insertSuggestedNodes(client, feedbackId, node.children, inserted.rows[0].id);
  }
}

// Load the suggested-node trees for a set of new_child items. One query; returns
// Map feedbackId → nested nodes [{ id, name, answer?, children: [...] }].
async function loadSuggestedNodesByItem(itemIds) {
  const byItem = new Map();
  if (!itemIds || itemIds.length === 0) return byItem;
  const r = await pool.query(
    `SELECT id, feedback_id, parent_node_id, name, answer_url, answer_title,
            to_char(answer_published_on, 'YYYY-MM-DD') AS answer_published_on,
            answer_comment, position
       FROM feedback_suggested_nodes
      WHERE feedback_id = ANY($1::int[])
      ORDER BY position ASC, id ASC`,
    [itemIds]
  );
  // Group rows by item, then assemble each item's forest from its flat rows.
  const rowsByItem = new Map();
  for (const row of r.rows) {
    if (!rowsByItem.has(row.feedback_id)) rowsByItem.set(row.feedback_id, []);
    rowsByItem.get(row.feedback_id).push(row);
  }
  for (const [fid, rows] of rowsByItem.entries()) {
    const nodeById = new Map();
    for (const row of rows) {
      nodeById.set(row.id, {
        id: row.id,
        name: row.name,
        answer: row.answer_url
          ? { url: row.answer_url, title: row.answer_title, publishedOn: row.answer_published_on, comment: row.answer_comment }
          : null,
        children: [],
      });
    }
    const roots = [];
    for (const row of rows) {
      const node = nodeById.get(row.id);
      if (row.parent_node_id != null && nodeById.has(row.parent_node_id)) {
        nodeById.get(row.parent_node_id).children.push(node);
      } else {
        roots.push(node);
      }
    }
    byItem.set(fid, roots);
  }
  return byItem;
}

// Load not-hidden-aware replies for a set of items. Returns Map itemId → rows.
async function loadRepliesByItem(itemIds) {
  const byItem = new Map();
  if (!itemIds || itemIds.length === 0) return byItem;
  const repliesResult = await pool.query(
    `SELECT fr.id, fr.feedback_id, fr.body, fr.is_owner_reply, fr.is_hidden,
            fr.author_id, fr.created_at, fr.updated_at,
            u.username AS author_username, u.orcid_id AS author_orcid_id
       FROM feedback_replies fr
       LEFT JOIN users u ON u.id = fr.author_id
      WHERE fr.feedback_id = ANY($1::int[])
      ORDER BY fr.created_at ASC`,
    [itemIds]
  );
  for (const r of repliesResult.rows) {
    if (!byItem.has(r.feedback_id)) byItem.set(r.feedback_id, []);
    byItem.get(r.feedback_id).push(r);
  }
  return byItem;
}

// Shape item rows into the client view (lock rule, replies, votes, canEdit, and
// — for new_child — nested nodes). Shared by the per-card and per-page reads.
// Sorted open-first, then votes desc, then newest.
function shapeItems(itemRows, { repliesByItem, nodesByItem, userId, canModerate, archived }) {
  const items = itemRows.map((row) => {
    const allReplies = repliesByItem.get(row.id) || [];
    const hasOwnerReply = allReplies.some((r) => r.is_owner_reply);
    const itemLocked = row.status !== 'open' || hasOwnerReply;
    const isAuthor = userId !== -1 && row.author_id === userId;
    const visibleReplies = allReplies
      .filter((r) => canModerate || !r.is_hidden)
      .map((r) => {
        const ownerReplyAfter = allReplies.some((o) => o.is_owner_reply && o.created_at > r.created_at);
        const replyLocked = row.status !== 'open' || ownerReplyAfter;
        return {
          id: r.id,
          body: r.body,
          isOwnerReply: r.is_owner_reply,
          author: authorOf(r),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          canEdit: userId !== -1 && r.author_id === userId && !replyLocked && !archived,
          ...(canModerate ? { isHidden: r.is_hidden } : {}),
        };
      });
    return {
      id: row.id,
      kind: row.kind,
      targetLinkId: row.target_link_id,
      targetEdgeId: row.target_edge_id,
      proposal: row.proposal,
      snapshot: row.snapshot,
      comment: row.comment,
      status: row.status,
      author: authorOf(row),
      voteCount: row.vote_count,
      userVoted: !!row.user_voted,
      locked: itemLocked,
      canEdit: isAuthor && !itemLocked && !archived,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(nodesByItem ? { nodes: nodesByItem.get(row.id) || [] } : {}),
      ...(canModerate ? { isHidden: row.is_hidden } : {}),
      replies: visibleReplies,
    };
  });
  items.sort((a, b) => {
    const ao = a.status === 'open' ? 0 : 1;
    const bo = b.status === 'open' ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (a.voteCount !== b.voteCount) return b.voteCount - a.voteCount;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return items;
}

const feedbackController = {
  // GET /api/feedback/edge/:edgeId — live feedback for one card (guest-readable).
  getFeedbackForEdge: async (req, res) => {
    try {
      const eid = parseInt(req.params.edgeId, 10);
      if (!eid || isNaN(eid)) return res.status(400).json({ error: 'Invalid edge id' });

      const edge = await loadEdge(eid);
      if (!edge) return res.status(404).json({ error: 'Question not found' });

      const userId = req.user ? req.user.userId : -1;
      const canModerate = req.user
        ? (isSiteAdmin(userId) || await communityAccess.isOwner(edge.community_id, userId))
        : false;
      const archived = !!edge.deleted_at;

      // Card feedback excludes new_child (branch) suggestions — those live on the
      // page-level panel (GET /page), not on the card whose edge they share.
      const itemsResult = await pool.query(
        `SELECT fi.id, fi.kind, fi.target_link_id, fi.target_edge_id, fi.proposal, fi.snapshot,
                fi.comment, fi.status, fi.is_hidden, fi.author_id, fi.created_at, fi.updated_at,
                u.username AS author_username, u.orcid_id AS author_orcid_id,
                (SELECT COUNT(*) FROM feedback_votes fv WHERE fv.feedback_id = fi.id)::int AS vote_count,
                ($2 <> -1 AND EXISTS (SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = fi.id AND fv.user_id = $2)) AS user_voted
           FROM feedback_items fi
           LEFT JOIN users u ON u.id = fi.author_id
          WHERE fi.edge_id = $1 AND fi.kind <> 'new_child' ${canModerate ? '' : 'AND fi.is_hidden = false'}`,
        [eid, userId]
      );

      const itemIds = itemsResult.rows.map((r) => r.id);
      const repliesByItem = await loadRepliesByItem(itemIds);
      const items = shapeItems(itemsResult.rows, { repliesByItem, userId, canModerate, archived });

      res.json({
        edgeId: eid,
        communityMode: edge.mode,
        archived,
        canModerate,
        questionText: edge.concept_name,
        items,
      });
    } catch (error) {
      console.error('Error fetching feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback — create a feedback item on a card. Any logged-in user, in
  // a curated community, on a live (non-archived) target.
  createFeedback: async (req, res) => {
    try {
      const { edgeId, kind, targetLinkId, proposal, comment } = req.body;
      const userId = req.user.userId;

      if (!KINDS.has(kind)) return res.status(400).json({ error: 'Unknown feedback kind', code: 'invalid_kind' });
      // Phase 72e-2: new_child (branch) suggestions carry a nested node tree and
      // may target a page's parent edge or the community root list (edgeId null).
      if (kind === 'new_child') return feedbackController._createNewChild(req, res);

      const eid = parseInt(edgeId, 10);
      if (!eid || isNaN(eid)) return res.status(400).json({ error: 'edgeId is required' });

      const edge = await loadEdge(eid);
      if (!edge) return res.status(404).json({ error: 'Question not found' });
      if (edge.mode !== 'curated') {
        return res.status(403).json({ error: 'Feedback is only available in curated communities.', code: 'curated_only' });
      }
      if (edge.deleted_at) {
        return res.status(409).json({ error: 'This question has been removed; its feedback is archived.', code: 'archived' });
      }
      if (edge.is_hidden) {
        return res.status(400).json({ error: 'Cannot add feedback to a hidden question.' });
      }

      const rawComment = comment != null ? String(comment).trim() : '';
      if (rawComment.length > MAX_COMMENT) {
        return res.status(400).json({ error: `Comment is too long (max ${MAX_COMMENT} characters).`, code: 'comment_too_long' });
      }
      if (kind === 'general' && !rawComment) {
        return res.status(400).json({ error: 'A comment is required.', code: 'comment_required' });
      }

      const snapshot = { questionText: edge.concept_name };
      let resolvedLinkId = null;
      let resolvedTargetEdgeId = null;

      if (kind === 'edit_answer') {
        const lid = parseInt(targetLinkId, 10);
        if (!lid || isNaN(lid)) return res.status(400).json({ error: 'targetLinkId is required', code: 'target_required' });
        const linkRow = await pool.query(
          `SELECT id, url, title, comment, to_char(published_on, 'YYYY-MM-DD') AS published_on
             FROM concept_links WHERE id = $1 AND edge_id = $2 AND legal_hold = false`,
          [lid, eid]
        );
        if (linkRow.rows.length === 0) {
          return res.status(400).json({ error: 'That answer is not on this question.', code: 'link_not_on_edge' });
        }
        const link = linkRow.rows[0];
        snapshot.answer = { title: link.title, url: link.url, comment: link.comment, publishedOn: link.published_on };
        resolvedLinkId = lid;
      }

      const prop = await buildProposal(kind, proposal, userId);
      if (!prop.ok) return res.status(prop.status).json({ error: prop.error, code: prop.code });

      const inserted = await pool.query(
        `INSERT INTO feedback_items
           (community_id, edge_id, kind, target_link_id, target_edge_id, proposal, snapshot, comment, author_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          edge.community_id, eid, kind, resolvedLinkId, resolvedTargetEdgeId,
          prop.proposal ? JSON.stringify(prop.proposal) : null,
          JSON.stringify(snapshot),
          rawComment || null,
          userId,
        ]
      );
      res.status(201).json({ message: 'Feedback posted', id: inserted.rows[0].id });
    } catch (error) {
      console.error('Error creating feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback (kind = new_child) — a branch suggestion: one or more
  // suggested questions (each optionally with an answer), nested to any depth
  // (cap 50 nodes), attached to a page's parent edge or the community root list.
  _createNewChild: async (req, res) => {
    try {
      const { edgeId, communityId, nodes, comment } = req.body;
      const userId = req.user.userId;

      let targetCommunityId;
      let parentEdgeId = null;
      let snapshot;

      const hasEdge = edgeId !== undefined && edgeId !== null && edgeId !== '';
      if (hasEdge) {
        const eid = parseInt(edgeId, 10);
        if (!eid || isNaN(eid)) return res.status(400).json({ error: 'Invalid edgeId' });
        const edge = await loadEdge(eid);
        if (!edge) return res.status(404).json({ error: 'Question not found' });
        if (edge.mode !== 'curated') {
          return res.status(403).json({ error: 'Feedback is only available in curated communities.', code: 'curated_only' });
        }
        if (edge.deleted_at) {
          return res.status(409).json({ error: 'This question has been removed; its feedback is archived.', code: 'archived' });
        }
        if (edge.is_hidden) {
          return res.status(400).json({ error: 'Cannot add feedback to a hidden question.' });
        }
        targetCommunityId = edge.community_id;
        parentEdgeId = eid;
        snapshot = { questionText: edge.concept_name };
      } else {
        const cid = parseInt(communityId, 10);
        if (!cid || isNaN(cid)) return res.status(400).json({ error: 'communityId is required' });
        const comm = await loadCommunity(cid);
        if (!comm) return res.status(404).json({ error: 'Community not found' });
        if (comm.mode !== 'curated') {
          return res.status(403).json({ error: 'Feedback is only available in curated communities.', code: 'curated_only' });
        }
        targetCommunityId = cid;
        parentEdgeId = null;
        snapshot = { questionText: 'community root' };
      }

      const rawComment = comment != null ? String(comment).trim() : '';
      if (rawComment.length > MAX_COMMENT) {
        return res.status(400).json({ error: `Comment is too long (max ${MAX_COMMENT} characters).`, code: 'comment_too_long' });
      }

      const valid = await validateSuggestedNodes(nodes, userId);
      if (!valid.ok) return res.status(valid.status).json({ error: valid.error, code: valid.code });

      const client = await pool.connect();
      let newId;
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO feedback_items (community_id, edge_id, kind, snapshot, comment, author_id)
           VALUES ($1, $2, 'new_child', $3, $4, $5) RETURNING id`,
          [targetCommunityId, parentEdgeId, JSON.stringify(snapshot), rawComment || null, userId]
        );
        newId = inserted.rows[0].id;
        await insertSuggestedNodes(client, newId, nodes, null);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }
      res.status(201).json({ message: 'Suggestion posted', id: newId });
    } catch (error) {
      console.error('Error creating branch suggestion:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // GET /api/feedback/page?communityId=&parentEdgeId= — new_child (branch)
  // suggestions for one page (a question's own edge) or the community root list
  // (parentEdgeId omitted). Guest-readable. Same shape/sort as the card read,
  // plus each item's nested nodes.
  getPageFeedback: async (req, res) => {
    try {
      const cid = parseInt(req.query.communityId, 10);
      if (!cid || isNaN(cid)) return res.status(400).json({ error: 'communityId is required' });
      const comm = await loadCommunity(cid);
      if (!comm) return res.status(404).json({ error: 'Community not found' });

      const hasParent = req.query.parentEdgeId !== undefined && req.query.parentEdgeId !== '' && req.query.parentEdgeId !== 'null';
      let parentEdgeId = null;
      let archived = false;
      if (hasParent) {
        parentEdgeId = parseInt(req.query.parentEdgeId, 10);
        if (!parentEdgeId || isNaN(parentEdgeId)) return res.status(400).json({ error: 'Invalid parentEdgeId' });
        const edge = await loadEdge(parentEdgeId);
        if (!edge) return res.status(404).json({ error: 'Question not found' });
        archived = !!edge.deleted_at;
      }

      const userId = req.user ? req.user.userId : -1;
      const canModerate = req.user
        ? (isSiteAdmin(userId) || await communityAccess.isOwner(cid, userId))
        : false;

      // $1 = userId, $2 = communityId, $3 = parentEdgeId (only bound when present,
      // so Postgres never has to type an unused NULL parameter on the root list).
      const where = hasParent
        ? 'fi.edge_id = $3 AND fi.community_id = $2'
        : 'fi.edge_id IS NULL AND fi.community_id = $2';
      const params = hasParent ? [userId, cid, parentEdgeId] : [userId, cid];
      const itemsResult = await pool.query(
        `SELECT fi.id, fi.kind, fi.target_link_id, fi.target_edge_id, fi.proposal, fi.snapshot,
                fi.comment, fi.status, fi.is_hidden, fi.author_id, fi.created_at, fi.updated_at,
                u.username AS author_username, u.orcid_id AS author_orcid_id,
                (SELECT COUNT(*) FROM feedback_votes fv WHERE fv.feedback_id = fi.id)::int AS vote_count,
                ($1 <> -1 AND EXISTS (SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = fi.id AND fv.user_id = $1)) AS user_voted
           FROM feedback_items fi
           LEFT JOIN users u ON u.id = fi.author_id
          WHERE ${where} AND fi.kind = 'new_child' ${canModerate ? '' : 'AND fi.is_hidden = false'}`,
        params
      );

      const itemIds = itemsResult.rows.map((r) => r.id);
      const repliesByItem = await loadRepliesByItem(itemIds);
      const nodesByItem = await loadSuggestedNodesByItem(itemIds);
      const items = shapeItems(itemsResult.rows, { repliesByItem, nodesByItem, userId, canModerate, archived });

      res.json({
        communityId: cid,
        communityMode: comm.mode,
        parentEdgeId: hasParent ? parentEdgeId : null,
        archived,
        canModerate,
        items,
      });
    } catch (error) {
      console.error('Error fetching page feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // GET /api/feedback/inbox?communityId=&status= — owners only. Every feedback
  // item in the community (all kinds), newest first, with per-status counts and a
  // navigation target so the overlay can open the item's card/page panel. The
  // status filter accepts open/incorporated/declined/archived; archived is
  // computed from the target edge's deleted_at, not stored.
  getInbox: async (req, res) => {
    try {
      const cid = parseInt(req.query.communityId, 10);
      if (!cid || isNaN(cid)) return res.status(400).json({ error: 'communityId is required' });
      const userId = req.user.userId;
      if (!(await communityAccess.isOwner(cid, userId))) {
        return res.status(403).json({ error: 'Only community owners can view the feedback inbox.', code: 'curated_owner_only' });
      }

      const statusFilter = req.query.status;
      const result = await pool.query(
        `SELECT fi.id, fi.kind, fi.edge_id, fi.snapshot, fi.comment, fi.status, fi.is_hidden,
                fi.author_id, fi.created_at, fi.updated_at,
                u.username AS author_username, u.orcid_id AS author_orcid_id,
                e.graph_path, e.child_id, e.deleted_at,
                (SELECT COUNT(*) FROM feedback_votes fv WHERE fv.feedback_id = fi.id)::int AS vote_count
           FROM feedback_items fi
           LEFT JOIN users u ON u.id = fi.author_id
           LEFT JOIN edges e ON e.id = fi.edge_id
          WHERE fi.community_id = $1
          ORDER BY fi.created_at DESC`,
        [cid]
      );

      const counts = { open: 0, incorporated: 0, declined: 0, archived: 0, total: 0 };
      const all = result.rows.map((row) => {
        const archived = !!row.deleted_at; // root-list items (edge_id null) are never archived
        const bucket = archived ? 'archived' : row.status;
        if (counts[bucket] !== undefined) counts[bucket] += 1;
        counts.total += 1;

        // Navigation target: card items open their parent page's card panel; new_child
        // items open the page panel (the question's own page, or the root list).
        const gp = Array.isArray(row.graph_path) ? row.graph_path : [];
        let nav;
        if (row.kind === 'new_child') {
          if (row.edge_id == null) {
            nav = { kind: 'page', conceptId: null, path: [], parentEdgeId: null };
          } else {
            nav = { kind: 'page', conceptId: row.child_id, path: gp, parentEdgeId: row.edge_id };
          }
        } else if (row.edge_id == null) {
          nav = null;
        } else if (gp.length === 0) {
          nav = { kind: 'card', conceptId: null, path: [], cardEdgeId: row.edge_id };
        } else {
          nav = { kind: 'card', conceptId: gp[gp.length - 1], path: gp.slice(0, -1), cardEdgeId: row.edge_id };
        }

        return {
          id: row.id,
          kind: row.kind,
          snapshot: row.snapshot,
          comment: row.comment,
          status: row.status,
          archived,
          isHidden: row.is_hidden,
          author: authorOf(row),
          voteCount: row.vote_count,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          nav,
        };
      });

      let items = all;
      if (statusFilter === 'archived') items = all.filter((i) => i.archived);
      else if (STATUSES.has(statusFilter)) items = all.filter((i) => !i.archived && i.status === statusFilter);

      res.json({ communityId: cid, counts, items });
    } catch (error) {
      console.error('Error fetching feedback inbox:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback/:id/edit — author edits their own item while unlocked.
  editFeedback: async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const { comment, proposal, nodes } = req.body;

      const r = await pool.query('SELECT * FROM feedback_items WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
      const item = r.rows[0];
      if (item.author_id !== userId) return res.status(403).json({ error: 'Only the author can edit this.' });

      const gate = await feedbackController._itemEditGuards(item);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });

      // Phase 72e-2: editing a new_child suggestion may replace its node tree and
      // comment together (one transaction: delete old nodes, re-insert).
      if (item.kind === 'new_child' && nodes !== undefined) {
        const valid = await validateSuggestedNodes(nodes, userId);
        if (!valid.ok) return res.status(valid.status).json({ error: valid.error, code: valid.code });
        let newComment;
        if (comment !== undefined) {
          const c = String(comment).trim();
          if (c.length > MAX_COMMENT) return res.status(400).json({ error: `Comment is too long (max ${MAX_COMMENT} characters).`, code: 'comment_too_long' });
          newComment = c || null;
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('DELETE FROM feedback_suggested_nodes WHERE feedback_id = $1', [id]);
          await insertSuggestedNodes(client, id, nodes, null);
          if (comment !== undefined) {
            await client.query('UPDATE feedback_items SET comment = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newComment, id]);
          } else {
            await client.query('UPDATE feedback_items SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
          }
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw txErr;
        } finally {
          client.release();
        }
        return res.json({ message: 'Feedback updated' });
      }

      const sets = [];
      const vals = [];
      let i = 1;
      if (comment !== undefined) {
        const c = String(comment).trim();
        if (c.length > MAX_COMMENT) return res.status(400).json({ error: `Comment is too long (max ${MAX_COMMENT} characters).`, code: 'comment_too_long' });
        if (item.kind === 'general' && !c) return res.status(400).json({ error: 'A comment is required.', code: 'comment_required' });
        sets.push(`comment = $${i++}`); vals.push(c || null);
      }
      if (proposal !== undefined && (item.kind === 'edit_question' || item.kind === 'edit_answer')) {
        const prop = await buildProposal(item.kind, proposal, userId);
        if (!prop.ok) return res.status(prop.status).json({ error: prop.error, code: prop.code });
        sets.push(`proposal = $${i++}`); vals.push(prop.proposal ? JSON.stringify(prop.proposal) : null);
      }
      if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(id);
      await pool.query(`UPDATE feedback_items SET ${sets.join(', ')} WHERE id = $${i}`, vals);
      res.json({ message: 'Feedback updated' });
    } catch (error) {
      console.error('Error editing feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback/:id/delete — author hard-deletes their own item (self
  // authored) while unlocked. Replies and votes cascade.
  deleteFeedback: async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const r = await pool.query('SELECT * FROM feedback_items WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
      const item = r.rows[0];
      if (item.author_id !== userId) return res.status(403).json({ error: 'Only the author can delete this.' });
      const gate = await feedbackController._itemEditGuards(item);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });
      await pool.query('DELETE FROM feedback_items WHERE id = $1', [id]);
      res.json({ message: 'Feedback deleted' });
    } catch (error) {
      console.error('Error deleting feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback/:id/replies — any logged-in user. is_owner_reply is set
  // server-side from the author's ownership at post time.
  addReply: async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const body = req.body.body != null ? String(req.body.body).trim() : '';
      if (!body) return res.status(400).json({ error: 'A reply is required.', code: 'body_required' });
      if (body.length > MAX_COMMENT) return res.status(400).json({ error: `Reply is too long (max ${MAX_COMMENT} characters).`, code: 'body_too_long' });

      const r = await pool.query('SELECT id, community_id, edge_id FROM feedback_items WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
      const item = r.rows[0];

      // Archived (target edge deleted) blocks replies too.
      const gate = await feedbackController._writeGuards(item);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });

      const isOwnerReply = await communityAccess.isOwner(item.community_id, userId);
      const inserted = await pool.query(
        `INSERT INTO feedback_replies (feedback_id, author_id, is_owner_reply, body)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [id, userId, isOwnerReply, body]
      );
      res.status(201).json({ message: 'Reply posted', id: inserted.rows[0].id });
    } catch (error) {
      console.error('Error adding reply:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback/replies/:replyId/edit — author edits their reply while
  // unlocked (no later owner reply, item still open, not archived).
  editReply: async (req, res) => {
    try {
      const replyId = parseInt(req.params.replyId, 10);
      if (!replyId || isNaN(replyId)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const body = req.body.body != null ? String(req.body.body).trim() : '';
      if (!body) return res.status(400).json({ error: 'A reply is required.', code: 'body_required' });
      if (body.length > MAX_COMMENT) return res.status(400).json({ error: `Reply is too long (max ${MAX_COMMENT} characters).`, code: 'body_too_long' });

      const r = await pool.query('SELECT * FROM feedback_replies WHERE id = $1', [replyId]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Reply not found' });
      const reply = r.rows[0];
      if (reply.author_id !== userId) return res.status(403).json({ error: 'Only the author can edit this.' });

      const itemRow = await pool.query('SELECT * FROM feedback_items WHERE id = $1', [reply.feedback_id]);
      const item = itemRow.rows[0];
      const gate = await feedbackController._replyWriteGuards(item, reply);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });

      await pool.query('UPDATE feedback_replies SET body = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [body, replyId]);
      res.json({ message: 'Reply updated' });
    } catch (error) {
      console.error('Error editing reply:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback/replies/:replyId/delete — author deletes their reply while unlocked.
  deleteReply: async (req, res) => {
    try {
      const replyId = parseInt(req.params.replyId, 10);
      if (!replyId || isNaN(replyId)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const r = await pool.query('SELECT * FROM feedback_replies WHERE id = $1', [replyId]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Reply not found' });
      const reply = r.rows[0];
      if (reply.author_id !== userId) return res.status(403).json({ error: 'Only the author can delete this.' });
      const itemRow = await pool.query('SELECT * FROM feedback_items WHERE id = $1', [reply.feedback_id]);
      const item = itemRow.rows[0];
      const gate = await feedbackController._replyWriteGuards(item, reply);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });
      await pool.query('DELETE FROM feedback_replies WHERE id = $1', [replyId]);
      res.json({ message: 'Reply deleted' });
    } catch (error) {
      console.error('Error deleting reply:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback/:id/vote — toggle one upvote per user per item.
  voteFeedback: async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const r = await pool.query('SELECT id, edge_id FROM feedback_items WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });

      const gate = await feedbackController._writeGuards(r.rows[0]);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });

      const existing = await pool.query('SELECT 1 FROM feedback_votes WHERE feedback_id = $1 AND user_id = $2', [id, userId]);
      let voted;
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM feedback_votes WHERE feedback_id = $1 AND user_id = $2', [id, userId]);
        voted = false;
      } else {
        await pool.query('INSERT INTO feedback_votes (feedback_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, userId]);
        voted = true;
      }
      const count = await pool.query('SELECT COUNT(*)::int AS c FROM feedback_votes WHERE feedback_id = $1', [id]);
      res.json({ voted, voteCount: count.rows[0].c });
    } catch (error) {
      console.error('Error voting on feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback/:id/status — owners only. Optional reply posted as an owner
  // reply in the same transaction.
  setStatus: async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const { status, reply } = req.body;
      if (!STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status', code: 'invalid_status' });

      const r = await pool.query('SELECT id, community_id, edge_id FROM feedback_items WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
      const item = r.rows[0];
      if (!(await communityAccess.isOwner(item.community_id, userId))) {
        return res.status(403).json({ error: 'Only community owners can set a status.', code: 'curated_owner_only' });
      }
      const gate = await feedbackController._writeGuards(item);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });

      const replyBody = reply != null ? String(reply).trim() : '';
      if (replyBody.length > MAX_COMMENT) return res.status(400).json({ error: `Reply is too long (max ${MAX_COMMENT} characters).`, code: 'body_too_long' });

      // Connect the client only for the transaction, after all guards have passed,
      // so the early returns above never touch (and double-release) a pooled client.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE feedback_items SET status = $1, status_by = $2, status_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [status, userId, id]
        );
        if (replyBody) {
          await client.query(
            'INSERT INTO feedback_replies (feedback_id, author_id, is_owner_reply, body) VALUES ($1, $2, true, $3)',
            [id, userId, replyBody]
          );
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }
      res.json({ message: 'Status updated' });
    } catch (error) {
      console.error('Error setting feedback status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback/:id/hide — owners (and the site admin) hide/unhide an item.
  hideFeedback: async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const hidden = req.body.hidden === true || req.body.hidden === 'true';
      const r = await pool.query('SELECT id, community_id, edge_id FROM feedback_items WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
      const item = r.rows[0];
      if (!isSiteAdmin(userId) && !(await communityAccess.isOwner(item.community_id, userId))) {
        return res.status(403).json({ error: 'Only community owners can hide feedback.', code: 'curated_owner_only' });
      }
      const gate = await feedbackController._writeGuards(item);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });
      await pool.query('UPDATE feedback_items SET is_hidden = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hidden, id]);
      res.json({ message: hidden ? 'Feedback hidden' : 'Feedback shown' });
    } catch (error) {
      console.error('Error hiding feedback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/feedback/replies/:replyId/hide — owners (and site admin) hide/unhide a reply.
  hideReply: async (req, res) => {
    try {
      const replyId = parseInt(req.params.replyId, 10);
      if (!replyId || isNaN(replyId)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const hidden = req.body.hidden === true || req.body.hidden === 'true';
      const r = await pool.query('SELECT * FROM feedback_replies WHERE id = $1', [replyId]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Reply not found' });
      const reply = r.rows[0];
      const itemRow = await pool.query('SELECT id, community_id, edge_id FROM feedback_items WHERE id = $1', [reply.feedback_id]);
      const item = itemRow.rows[0];
      if (!isSiteAdmin(userId) && !(await communityAccess.isOwner(item.community_id, userId))) {
        return res.status(403).json({ error: 'Only community owners can hide feedback.', code: 'curated_owner_only' });
      }
      const gate = await feedbackController._writeGuards(item);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });
      await pool.query('UPDATE feedback_replies SET is_hidden = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hidden, replyId]);
      res.json({ message: hidden ? 'Reply hidden' : 'Reply shown' });
    } catch (error) {
      console.error('Error hiding reply:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Archived guard: reject when the target edge has been soft-deleted. Used by the
  // writes that stay allowed while a thread is locked (reply, vote, status, hide).
  // Returns { ok } or { ok:false, status, code, error }.
  _writeGuards: async (item) => {
    if (item.edge_id == null) return { ok: true };
    const e = await pool.query('SELECT deleted_at FROM edges WHERE id = $1', [item.edge_id]);
    if (e.rows.length > 0 && e.rows[0].deleted_at) {
      return { ok: false, status: 409, code: 'archived', error: 'This question has been removed; its feedback is archived.' };
    }
    return { ok: true };
  },

  // Item edit/delete guard: archived, then the lock rule — the status is no longer
  // open, or an owner reply exists in the thread.
  _itemEditGuards: async (item) => {
    const archived = await feedbackController._writeGuards(item);
    if (!archived.ok) return archived;
    if (item.status !== 'open') {
      return { ok: false, status: 409, code: 'locked', error: 'This thread is locked.' };
    }
    const ownerReply = await pool.query(
      'SELECT 1 FROM feedback_replies WHERE feedback_id = $1 AND is_owner_reply = true LIMIT 1',
      [item.id]
    );
    if (ownerReply.rows.length > 0) {
      return { ok: false, status: 409, code: 'locked', error: 'This thread is locked.' };
    }
    return { ok: true };
  },

  // Reply edit/delete guard: archived, then the lock rule — the status is no longer
  // open, or an owner reply was posted after this reply.
  _replyWriteGuards: async (item, reply) => {
    const archived = await feedbackController._writeGuards(item);
    if (!archived.ok) return archived;
    if (item.status !== 'open') {
      return { ok: false, status: 409, code: 'locked', error: 'This thread is locked.' };
    }
    const later = await pool.query(
      'SELECT 1 FROM feedback_replies WHERE feedback_id = $1 AND is_owner_reply = true AND created_at > $2 LIMIT 1',
      [reply.feedback_id, reply.created_at]
    );
    if (later.rows.length > 0) {
      return { ok: false, status: 409, code: 'locked', error: 'This reply can no longer be edited.' };
    }
    return { ok: true };
  },
};

module.exports = feedbackController;
