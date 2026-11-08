const pool = require('../config/database');

const VALID_TARGET_TYPES = ['concept', 'edge', 'web_link'];
const VALID_REMOVAL_REASONS = ['dmca', 'illegal_content', 'court_order'];

const adminLegalController = {
  legalRemove: async (req, res) => {
    const { target_type, target_id, removal_reason, notice_reference, internal_notes } = req.body;

    try {
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can perform legal removals' });
      }

      if (!target_type || !target_id || !removal_reason) {
        return res.status(400).json({ error: 'target_type, target_id, and removal_reason are required' });
      }
      if (!VALID_TARGET_TYPES.includes(target_type)) {
        return res.status(400).json({ error: `Invalid target_type. Must be one of: ${VALID_TARGET_TYPES.join(', ')}` });
      }
      const parsedTargetId = parseInt(target_id);
      if (isNaN(parsedTargetId)) {
        return res.status(400).json({ error: 'target_id must be an integer' });
      }
      if (!VALID_REMOVAL_REASONS.includes(removal_reason)) {
        return res.status(400).json({ error: `Invalid removal_reason. Must be one of: ${VALID_REMOVAL_REASONS.join(', ')}` });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        let affectedUserId = null;
        let affectedUserEmail = null;
        let affectedUsername = null;

        if (target_type === 'concept') {
          const conceptResult = await client.query(
            `SELECT c.id, c.created_by, u.email, u.username
             FROM concepts c
             LEFT JOIN users u ON c.created_by = u.id
             WHERE c.id = $1`,
            [parsedTargetId]
          );
          if (conceptResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Concept not found' });
          }
          affectedUserId = conceptResult.rows[0].created_by;
          affectedUserEmail = conceptResult.rows[0].email;
          affectedUsername = conceptResult.rows[0].username;
          await client.query('UPDATE concepts SET legal_hold = true WHERE id = $1', [parsedTargetId]);

        } else if (target_type === 'edge') {
          const edgeResult = await client.query(
            `SELECT e.id, e.created_by, u.email, u.username
             FROM edges e
             LEFT JOIN users u ON e.created_by = u.id
             WHERE e.id = $1`,
            [parsedTargetId]
          );
          if (edgeResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Edge not found' });
          }
          affectedUserId = edgeResult.rows[0].created_by;
          affectedUserEmail = edgeResult.rows[0].email;
          affectedUsername = edgeResult.rows[0].username;
          await client.query('UPDATE edges SET is_hidden = true, legal_hold = true WHERE id = $1', [parsedTargetId]);

        } else if (target_type === 'web_link') {
          const linkResult = await client.query(
            `SELECT cl.id, cl.added_by, u.email, u.username
             FROM concept_links cl
             LEFT JOIN users u ON cl.added_by = u.id
             WHERE cl.id = $1`,
            [parsedTargetId]
          );
          if (linkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Web link not found' });
          }
          affectedUserId = linkResult.rows[0].added_by;
          affectedUserEmail = linkResult.rows[0].email;
          affectedUsername = linkResult.rows[0].username;
          await client.query('UPDATE concept_links SET legal_hold = true WHERE id = $1', [parsedTargetId]);
        }

        const auditResult = await client.query(
          `INSERT INTO legal_removals
             (target_type, target_id, affected_user_id, removal_reason, notice_reference, internal_notes, removed_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [target_type, parsedTargetId, affectedUserId, removal_reason, notice_reference || null, internal_notes || null, req.user.userId]
        );

        if (removal_reason === 'dmca' && affectedUserId) {
          await client.query(
            `INSERT INTO dmca_strikes (user_id, legal_removal_id) VALUES ($1, $2)`,
            [affectedUserId, auditResult.rows[0].id]
          );
        }

        await client.query('COMMIT');

        res.json({
          success: true,
          legal_removal_id: auditResult.rows[0].id,
          affected_user_email: affectedUserEmail || null,
          affected_username: affectedUsername || null
        });

      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

    } catch (error) {
      console.error('Error performing legal removal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // POST /api/admin/legal/removals/:id/restore — reverse a legal removal.
  // Clears legal_hold on the target (concept / edge / web_link). For an edge it
  // also unhides, but only when the edge is not soft-deleted and its current flag
  // count is below the hide threshold; otherwise is_hidden is left as is. DMCA
  // strikes are never touched here (clearing a strike is a separate admin action).
  restoreRemoval: async (req, res) => {
    const FLAG_HIDE_THRESHOLD = 10;
    try {
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can restore legal removals' });
      }

      const removalId = parseInt(req.params.id, 10);
      if (isNaN(removalId)) {
        return res.status(400).json({ error: 'Invalid removal ID' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const removalRes = await client.query(
          'SELECT * FROM legal_removals WHERE id = $1 FOR UPDATE',
          [removalId]
        );
        if (removalRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Legal removal not found' });
        }
        const removal = removalRes.rows[0];
        if (removal.restored_at) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'This removal has already been restored', code: 'already_restored' });
        }

        let effect;

        if (removal.target_type === 'concept') {
          const r = await client.query(
            'UPDATE concepts SET legal_hold = false WHERE id = $1 RETURNING id',
            [removal.target_id]
          );
          effect = r.rows.length === 0
            ? 'Target concept no longer exists; recorded the restore anyway.'
            : 'Cleared legal_hold on the concept.';

        } else if (removal.target_type === 'web_link') {
          const r = await client.query(
            'UPDATE concept_links SET legal_hold = false WHERE id = $1 RETURNING id',
            [removal.target_id]
          );
          effect = r.rows.length === 0
            ? 'Target link no longer exists; recorded the restore anyway.'
            : 'Cleared legal_hold on the link.';

        } else if (removal.target_type === 'edge') {
          const edgeRes = await client.query(
            'SELECT id, deleted_at FROM edges WHERE id = $1',
            [removal.target_id]
          );
          if (edgeRes.rows.length === 0) {
            await client.query(
              'UPDATE edges SET legal_hold = false WHERE id = $1',
              [removal.target_id]
            );
            effect = 'Target edge no longer exists; recorded the restore anyway.';
          } else {
            const edge = edgeRes.rows[0];
            const flagRes = await client.query(
              'SELECT COUNT(*)::int AS count FROM concept_flags WHERE edge_id = $1',
              [removal.target_id]
            );
            const flagCount = flagRes.rows[0].count;
            const softDeleted = edge.deleted_at !== null;
            const atThreshold = flagCount >= FLAG_HIDE_THRESHOLD;

            if (softDeleted || atThreshold) {
              // Clear only the legal hold; leave is_hidden as is.
              await client.query(
                'UPDATE edges SET legal_hold = false WHERE id = $1',
                [removal.target_id]
              );
              effect = softDeleted
                ? 'Cleared legal_hold, but left the edge hidden because it is soft-deleted.'
                : `Cleared legal_hold, but left the edge hidden because it has ${flagCount} community flags (threshold ${FLAG_HIDE_THRESHOLD}).`;
            } else {
              await client.query(
                'UPDATE edges SET legal_hold = false, is_hidden = false WHERE id = $1',
                [removal.target_id]
              );
              effect = 'Cleared legal_hold and unhid the edge.';
            }
          }
        } else {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Unknown target_type: ${removal.target_type}` });
        }

        const updated = await client.query(
          `UPDATE legal_removals
             SET restored_at = NOW(), restored_by = $2
           WHERE id = $1
           RETURNING *`,
          [removalId, req.user.userId]
        );

        await client.query('COMMIT');
        res.json({ removal: updated.rows[0], effect });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error restoring legal removal:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getNotices: async (req, res) => {
    try {
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can view legal notices' });
      }

      const result = await pool.query(
        `SELECT cin.*,
           EXISTS (
             SELECT 1 FROM legal_removals lr
             WHERE lr.notice_reference LIKE 'copyright_infringement_notices.id=' || cin.id || '%'
           ) AS acted_on
         FROM copyright_infringement_notices cin
         ORDER BY cin.created_at DESC`
      );

      res.json({ notices: result.rows });
    } catch (error) {
      console.error('Error fetching infringement notices:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getCounterNotices: async (req, res) => {
    try {
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can view counter-notices' });
      }

      const result = await pool.query(
        `SELECT * FROM copyright_counter_notices ORDER BY created_at DESC`
      );

      res.json({ counterNotices: result.rows });
    } catch (error) {
      console.error('Error fetching counter-notices:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getRemovals: async (req, res) => {
    try {
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can view legal removals' });
      }

      const result = await pool.query(
        `SELECT lr.*, u.username AS affected_username, u.email AS affected_email
         FROM legal_removals lr
         LEFT JOIN users u ON lr.affected_user_id = u.id
         ORDER BY lr.removed_at DESC`
      );

      res.json({ removals: result.rows });
    } catch (error) {
      console.error('Error fetching legal removals:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  markNotified: async (req, res) => {
    try {
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can update legal removals' });
      }

      const removalId = parseInt(req.params.id);
      if (isNaN(removalId)) {
        return res.status(400).json({ error: 'Invalid removal ID' });
      }

      const result = await pool.query(
        `UPDATE legal_removals SET user_notified_at = NOW() WHERE id = $1 RETURNING *`,
        [removalId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Legal removal not found' });
      }

      res.json({ removal: result.rows[0] });
    } catch (error) {
      console.error('Error marking removal as notified:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getRepeatInfringers: async (req, res) => {
    try {
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can view repeat-infringer data' });
      }

      const usersResult = await pool.query(
        `SELECT ds.user_id, u.username, u.email, u.created_at AS account_created_at,
                COUNT(*) AS active_strike_count
         FROM dmca_strikes ds
         JOIN users u ON ds.user_id = u.id
         WHERE ds.cleared_at IS NULL
           AND ds.struck_at > NOW() - INTERVAL '1 year'
         GROUP BY ds.user_id, u.username, u.email, u.created_at
         HAVING COUNT(*) >= 3
         ORDER BY COUNT(*) DESC, u.username ASC`
      );

      const infringers = [];
      for (const row of usersResult.rows) {
        const strikesResult = await pool.query(
          `SELECT ds.id AS strike_id, ds.struck_at, ds.cleared_at, ds.cleared_reason,
                  lr.id AS removal_id, lr.target_type, lr.target_id,
                  lr.removal_reason, lr.notice_reference, lr.internal_notes, lr.removed_at
           FROM dmca_strikes ds
           JOIN legal_removals lr ON ds.legal_removal_id = lr.id
           WHERE ds.user_id = $1
             AND ds.cleared_at IS NULL
             AND ds.struck_at > NOW() - INTERVAL '1 year'
           ORDER BY ds.struck_at DESC`,
          [row.user_id]
        );
        infringers.push({
          user_id: row.user_id,
          username: row.username,
          email: row.email,
          account_created_at: row.account_created_at,
          active_strike_count: parseInt(row.active_strike_count),
          strikes: strikesResult.rows,
        });
      }

      res.json({ infringers });
    } catch (error) {
      console.error('Error fetching repeat infringers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  clearStrike: async (req, res) => {
    try {
      const adminUserId = parseInt(process.env.ADMIN_USER_ID);
      if (!adminUserId || req.user.userId !== adminUserId) {
        return res.status(403).json({ error: 'Only administrators can clear strikes' });
      }

      const strikeId = parseInt(req.params.id);
      if (isNaN(strikeId)) {
        return res.status(400).json({ error: 'Invalid strike ID' });
      }

      const { reason } = req.body;
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'A reason is required to clear a strike' });
      }

      const result = await pool.query(
        `UPDATE dmca_strikes SET cleared_at = NOW(), cleared_reason = $1 WHERE id = $2 AND cleared_at IS NULL RETURNING *`,
        [reason.trim(), strikeId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Strike not found or already cleared' });
      }

      res.json({ strike: result.rows[0] });
    } catch (error) {
      console.error('Error clearing strike:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = adminLegalController;
