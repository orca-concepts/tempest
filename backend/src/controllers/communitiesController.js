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
  listCommunities: async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT comm.id, comm.name, comm.slug, comm.description, comm.created_at,
                u.username AS created_by_username,
                (SELECT COUNT(*) FROM concepts c WHERE c.community_id = comm.id) AS concept_count,
                (SELECT COUNT(*) FROM edges e
                   JOIN concepts c ON c.id = e.child_id
                  WHERE c.community_id = comm.id
                    AND e.parent_id IS NULL AND e.graph_path = '{}' AND e.is_hidden = false
                ) AS root_count
         FROM communities comm
         LEFT JOIN users u ON u.id = comm.created_by
         ORDER BY comm.name`
      );
      res.json({ communities: result.rows });
    } catch (error) {
      console.error('Error listing communities:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Resolve a slug to a community (guest-accessible). Frontend uses the id to
  // scope root/search/create calls.
  getCommunityBySlug: async (req, res) => {
    const { slug } = req.params;
    try {
      const result = await pool.query(
        `SELECT comm.id, comm.name, comm.slug, comm.description, comm.created_at,
                u.username AS created_by_username
         FROM communities comm
         LEFT JOIN users u ON u.id = comm.created_by
         WHERE LOWER(comm.slug) = LOWER($1)`,
        [slug]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Community not found' });
      }
      res.json({ community: result.rows[0] });
    } catch (error) {
      console.error('Error fetching community:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a community (requires login; no owner-gating on later use).
  createCommunity: async (req, res) => {
    const { name, description } = req.body;
    try {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (name.length > 255) {
        return res.status(400).json({ error: 'Community name must be 255 characters or fewer' });
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
          `INSERT INTO communities (name, slug, description, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, slug, description, created_at`,
          [trimmedName, slug, description ? description.trim() : null, req.user.userId]
        );

        await client.query('COMMIT');
        res.status(201).json({ community: insert.rows[0] });
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
};

module.exports = communitiesController;
