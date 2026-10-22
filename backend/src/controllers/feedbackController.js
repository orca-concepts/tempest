// Phase 72e-1: reader feedback for curated communities.
//
// A feedback item is a public suggestion attached to one question card (edge):
// reword the question, change an answer, add/remove a precedent or subsequent
// sibling link, or just a free-text note. Items are visible immediately; owners
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
  'edit_question', 'edit_answer', 'add_precedent', 'remove_precedent',
  'add_subsequent', 'remove_subsequent', 'new_child', 'general',
]);
const SEQUENCE_KINDS = new Set(['add_precedent', 'remove_precedent', 'add_subsequent', 'remove_subsequent']);
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

// Sibling rule reused from Phase 72c-2 addSequenceLink: same parent + graph_path
// (non-roots), or both root edges in the same community.
function areSiblings(a, b) {
  const samePath = (a.graph_path || []).join(',') === (b.graph_path || []).join(',');
  const bothRoots = a.parent_id === null && b.parent_id === null;
  if (bothRoots) return samePath && a.community_id === b.community_id;
  return a.parent_id !== null && a.parent_id === b.parent_id && samePath;
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

      const itemsResult = await pool.query(
        `SELECT fi.id, fi.kind, fi.target_link_id, fi.target_edge_id, fi.proposal, fi.snapshot,
                fi.comment, fi.status, fi.is_hidden, fi.author_id, fi.created_at, fi.updated_at,
                u.username AS author_username, u.orcid_id AS author_orcid_id,
                (SELECT COUNT(*) FROM feedback_votes fv WHERE fv.feedback_id = fi.id)::int AS vote_count,
                ($2 <> -1 AND EXISTS (SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = fi.id AND fv.user_id = $2)) AS user_voted
           FROM feedback_items fi
           LEFT JOIN users u ON u.id = fi.author_id
          WHERE fi.edge_id = $1 ${canModerate ? '' : 'AND fi.is_hidden = false'}`,
        [eid, userId]
      );

      const itemIds = itemsResult.rows.map((r) => r.id);
      const repliesByItem = new Map();
      if (itemIds.length > 0) {
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
          if (!repliesByItem.has(r.feedback_id)) repliesByItem.set(r.feedback_id, []);
          repliesByItem.get(r.feedback_id).push(r);
        }
      }

      const items = itemsResult.rows.map((row) => {
        const allReplies = repliesByItem.get(row.id) || [];
        // Lock uses ALL replies (hidden owner replies still lock the thread).
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
          ...(canModerate ? { isHidden: row.is_hidden } : {}),
          replies: visibleReplies,
        };
      });

      // Sort: open first, then vote count desc, then newest.
      items.sort((a, b) => {
        const ao = a.status === 'open' ? 0 : 1;
        const bo = b.status === 'open' ? 0 : 1;
        if (ao !== bo) return ao - bo;
        if (a.voteCount !== b.voteCount) return b.voteCount - a.voteCount;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

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
      const { edgeId, kind, targetLinkId, targetEdgeId, proposal, comment } = req.body;
      const userId = req.user.userId;

      if (!KINDS.has(kind)) return res.status(400).json({ error: 'Unknown feedback kind', code: 'invalid_kind' });
      // new_child (branch suggestions) is a Phase 72e-2 feature.
      if (kind === 'new_child') return res.status(400).json({ error: 'New-question suggestions are not available yet.', code: 'unsupported_kind' });

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
      } else if (SEQUENCE_KINDS.has(kind)) {
        const sid = parseInt(targetEdgeId, 10);
        if (!sid || isNaN(sid)) return res.status(400).json({ error: 'targetEdgeId is required', code: 'target_required' });
        const sibling = await loadEdge(sid);
        if (!sibling) return res.status(400).json({ error: 'Sibling question not found', code: 'target_required' });
        if (sibling.deleted_at) return res.status(400).json({ error: 'That question has been removed.', code: 'edge_deleted' });
        if (!areSiblings(edge, sibling)) {
          return res.status(400).json({ error: 'Precedent/subsequent suggestions must target a sibling question.', code: 'not_siblings' });
        }
        // Existence checks mirror the directional semantics of 72c-2
        // (from_edge precedes to_edge).
        const isAdd = kind === 'add_precedent' || kind === 'add_subsequent';
        const fromId = (kind === 'add_precedent' || kind === 'remove_precedent') ? sid : eid;
        const toId = (kind === 'add_precedent' || kind === 'remove_precedent') ? eid : sid;
        const existing = await pool.query(
          'SELECT id FROM question_sequence_links WHERE from_edge_id = $1 AND to_edge_id = $2',
          [fromId, toId]
        );
        if (isAdd && existing.rows.length > 0) {
          return res.status(409).json({ error: 'That link already exists.', code: 'duplicate_link' });
        }
        if (!isAdd && existing.rows.length === 0) {
          return res.status(400).json({ error: 'That link does not currently exist.', code: 'link_not_found' });
        }
        snapshot.siblingName = sibling.concept_name;
        resolvedTargetEdgeId = sid;
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

  // POST /api/feedback/:id/edit — author edits their own item while unlocked.
  editFeedback: async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const userId = req.user.userId;
      const { comment, proposal } = req.body;

      const r = await pool.query('SELECT * FROM feedback_items WHERE id = $1', [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
      const item = r.rows[0];
      if (item.author_id !== userId) return res.status(403).json({ error: 'Only the author can edit this.' });

      const gate = await feedbackController._itemEditGuards(item);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });

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
