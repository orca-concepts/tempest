const pool = require('../config/database');

// Derive a URL-safe slug from a community name. Uniqueness is enforced by the
// caller (append -2, -3, ... on collision).
function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 255) || 'community'
  );
}

const communitiesController = {
  // List all communities (guest-accessible) with concept + root counts.
  // Phase 72a: returns `mode`, and `is_owner` for the logged-in user.
  listCommunities: async (req, res) => {
    try {
      const userId = req.user ? req.user.userId : null;
      const result = await pool.query(
        `SELECT comm.id, comm.name, comm.slug, comm.description, comm.mode, comm.created_at,
                u.username AS created_by_username,
                (SELECT COUNT(*) FROM concepts c WHERE c.community_id = comm.id) AS concept_count,
                (SELECT COUNT(*) FROM edges e
                   JOIN concepts c ON c.id = e.child_id
                  WHERE c.community_id = comm.id
                    AND e.parent_id IS NULL AND e.graph_path = '{}' AND e.is_hidden = false
                ) AS root_count,
                EXISTS (
                  SELECT 1 FROM community_owners co
                  WHERE co.community_id = comm.id AND co.user_id = $1
                ) AS is_owner
         FROM communities comm
         LEFT JOIN users u ON u.id = comm.created_by
         ORDER BY comm.name`,
        [userId]
      );
      res.json({ communities: result.rows });
    } catch (error) {
      console.error('Error listing communities:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Resolve a slug to a community (guest-accessible). Frontend uses the id to
  // scope root/search/create calls. Phase 72a: returns `mode`, `is_owner`,
  // and the full `owners` list.
  getCommunityBySlug: async (req, res) => {
    const { slug } = req.params;
    try {
      const userId = req.user ? req.user.userId : null;
      const result = await pool.query(
        `SELECT comm.id, comm.name, comm.slug, comm.description, comm.mode, comm.created_at,
                u.username AS created_by_username,
                EXISTS (
                  SELECT 1 FROM community_owners co
                  WHERE co.community_id = comm.id AND co.user_id = $2
                ) AS is_owner
         FROM communities comm
         LEFT JOIN users u ON u.id = comm.created_by
         WHERE LOWER(comm.slug) = LOWER($1)`,
        [slug, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Community not found' });
      }
      const community = result.rows[0];

      // LEFT JOIN users through the SET NULL added_by/user_id provenance.
      const owners = await pool.query(
        `SELECT co.user_id, u.username, u.orcid_id
           FROM community_owners co
           LEFT JOIN users u ON u.id = co.user_id
          WHERE co.community_id = $1
          ORDER BY u.username`,
        [community.id]
      );
      community.owners = owners.rows.map((o) => ({
        userId: o.user_id,
        username: o.username,
        orcidId: o.orcid_id,
      }));

      res.json({ community });
    } catch (error) {
      console.error('Error fetching community:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a community (requires login). Phase 72a: `mode` is chosen here and
  // fixed; the creator becomes the first owner in the same transaction.
  createCommunity: async (req, res) => {
    const { name, description, mode } = req.body;
    try {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (name.length > 255) {
        return res.status(400).json({ error: 'Community name must be 255 characters or fewer' });
      }
      const communityMode = mode === undefined || mode === null ? 'open' : mode;
      if (communityMode !== 'open' && communityMode !== 'curated') {
        return res.status(400).json({ error: "mode must be 'open' or 'curated'" });
      }
      const trimmedName = name.trim();
      const baseSlug = slugify(trimmedName);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const nameClash = await client.query(
          'SELECT id FROM communities WHERE LOWER(name) = LOWER($1)',
          [trimmedName]
        );
        if (nameClash.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'A community with this name already exists' });
        }

        // Ensure a unique slug (append -2, -3, ... on collision).
        let slug = baseSlug;
        let suffix = 2;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const slugClash = await client.query(
            'SELECT id FROM communities WHERE LOWER(slug) = LOWER($1)',
            [slug]
          );
          if (slugClash.rows.length === 0) break;
          slug = `${baseSlug}-${suffix++}`;
        }

        const insert = await client.query(
          `INSERT INTO communities (name, slug, description, mode, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, slug, description, mode, created_at`,
          [trimmedName, slug, description ? description.trim() : null, communityMode, req.user.userId]
        );

        // The creator is the first owner (in both modes).
        await client.query(
          `INSERT INTO community_owners (community_id, user_id, added_by)
           VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`,
          [insert.rows[0].id, req.user.userId]
        );

        await client.query('COMMIT');
        const community = insert.rows[0];
        community.is_owner = true;
        res.status(201).json({ community });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating community:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 72a: add another owner by username (owner-only; idempotent).
  addOwner: async (req, res) => {
    const communityId = parseInt(req.params.id, 10);
    const { username } = req.body;
    try {
      if (!communityId || isNaN(communityId)) {
        return res.status(400).json({ error: 'Invalid community id' });
      }
      if (!username || !username.trim()) {
        return res.status(400).json({ error: 'username is required' });
      }

      const commCheck = await pool.query('SELECT id FROM communities WHERE id = $1', [communityId]);
      if (commCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Community not found' });
      }

      // Caller must be an owner.
      const callerOwner = await pool.query(
        'SELECT 1 FROM community_owners WHERE community_id = $1 AND user_id = $2',
        [communityId, req.user.userId]
      );
      if (callerOwner.rows.length === 0) {
        return res.status(403).json({ error: 'Only owners can add owners', code: 'owner_only' });
      }

      const userRow = await pool.query(
        'SELECT id, username FROM users WHERE LOWER(username) = LOWER($1)',
        [username.trim()]
      );
      if (userRow.rows.length === 0) {
        return res.status(404).json({ error: 'No user with that username' });
      }
      const newOwnerId = userRow.rows[0].id;

      await pool.query(
        `INSERT INTO community_owners (community_id, user_id, added_by)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [communityId, newOwnerId, req.user.userId]
      );

      res.status(201).json({ message: 'Owner added', owner: { userId: newOwnerId, username: userRow.rows[0].username } });
    } catch (error) {
      console.error('Error adding community owner:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 72a: remove an owner (owner-only). The last remaining owner cannot be
  // removed. An owner may remove themselves if another owner remains.
  removeOwner: async (req, res) => {
    const communityId = parseInt(req.params.id, 10);
    const { userId } = req.body;
    try {
      if (!communityId || isNaN(communityId)) {
        return res.status(400).json({ error: 'Invalid community id' });
      }
      const targetUserId = parseInt(userId, 10);
      if (!targetUserId || isNaN(targetUserId)) {
        return res.status(400).json({ error: 'userId is required' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Caller must be an owner.
        const callerOwner = await client.query(
          'SELECT 1 FROM community_owners WHERE community_id = $1 AND user_id = $2',
          [communityId, req.user.userId]
        );
        if (callerOwner.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Only owners can remove owners', code: 'owner_only' });
        }

        // Lock this community's owner rows so two concurrent removals cannot
        // both pass the last-owner check and leave the community ownerless.
        const lockedOwners = await client.query(
          'SELECT user_id FROM community_owners WHERE community_id = $1 FOR UPDATE',
          [communityId]
        );
        if (lockedOwners.rows.length <= 1) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'A community must keep at least one owner', code: 'last_owner' });
        }

        const del = await client.query(
          'DELETE FROM community_owners WHERE community_id = $1 AND user_id = $2 RETURNING user_id',
          [communityId, targetUserId]
        );
        if (del.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'That user is not an owner' });
        }

        await client.query('COMMIT');
        res.json({ message: 'Owner removed', userId: targetUserId });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error removing community owner:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};

module.exports = communitiesController;
