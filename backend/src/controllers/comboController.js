const pool = require('../config/database');

// List all combos
const listCombos = async (req, res) => {
  try {
    const userId = req.user?.userId || -1;
    const { search, sort } = req.query;

    let whereClause = '';
    const params = [userId];

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      whereClause = `WHERE c.name ILIKE $${params.length}`;
    }

    const orderBy = sort === 'new' ? 'c.created_at DESC' : 'subscriber_count DESC, c.created_at DESC';

    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_by, c.created_at,
              u.username AS creator_username,
              u.orcid_id AS creator_orcid_id,
              (SELECT COUNT(*) FROM combo_edges ce WHERE ce.combo_id = c.id) AS edge_count,
              (SELECT COUNT(*) FROM combo_subscriptions cs WHERE cs.combo_id = c.id) AS subscriber_count,
              BOOL_OR(cs_user.user_id IS NOT NULL) AS user_subscribed
       FROM combos c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN combo_subscriptions cs_user ON cs_user.combo_id = c.id AND cs_user.user_id = $1
       ${whereClause}
       GROUP BY c.id, u.username, u.orcid_id
       ORDER BY ${orderBy}`,
      params
    );

    res.json({
      combos: result.rows.map(r => ({
        ...r,
        edge_count: Number(r.edge_count),
        subscriber_count: Number(r.subscriber_count),
        user_subscribed: r.user_subscribed || false,
      })),
    });
  } catch (error) {
    console.error('Error listing combos:', error);
    res.status(500).json({ error: 'Failed to list combos' });
  }
};

// Get combo details with member edges
const getCombo = async (req, res) => {
  try {
    const userId = req.user?.userId || -1;
    const comboId = req.params.id;

    const comboResult = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_by, c.created_at,
              u.username AS creator_username,
              u.orcid_id AS creator_orcid_id,
              (SELECT COUNT(*) FROM combo_subscriptions cs WHERE cs.combo_id = c.id) AS subscriber_count,
              BOOL_OR(cs_user.user_id IS NOT NULL) AS user_subscribed
       FROM combos c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN combo_subscriptions cs_user ON cs_user.combo_id = c.id AND cs_user.user_id = $1
       WHERE c.id = $2
       GROUP BY c.id, u.username, u.orcid_id`,
      [userId, comboId]
    );

    if (comboResult.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }

    const combo = comboResult.rows[0];
    combo.subscriber_count = Number(combo.subscriber_count);
    combo.user_subscribed = combo.user_subscribed || false;

    // Get member edges with concept details
    const edgesResult = await pool.query(
      `SELECT ce.edge_id, ce.added_at,
              e.child_id AS concept_id,
              child_c.name AS concept_name,
              e.parent_id,
              parent_c.name AS parent_name,
              e.attribute_id,
              a.name AS attribute_name,
              e.graph_path
       FROM combo_edges ce
       JOIN edges e ON e.id = ce.edge_id
       JOIN concepts child_c ON child_c.id = e.child_id
       LEFT JOIN concepts parent_c ON parent_c.id = e.parent_id
       JOIN attributes a ON a.id = e.attribute_id
       WHERE ce.combo_id = $1
       ORDER BY ce.added_at DESC`,
      [comboId]
    );

    res.json({
      combo,
      edges: edgesResult.rows,
    });
  } catch (error) {
    console.error('Error getting combo:', error);
    res.status(500).json({ error: 'Failed to get combo' });
  }
};

// Create a new combo
const createCombo = async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, description } = req.body;
    const userId = req.user.userId;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Combo name is required' });
    }

    if (name.trim().length > 255) {
      return res.status(400).json({ error: 'Combo name must be 255 characters or less' });
    }

    await client.query('BEGIN');

    const nameCheck = await client.query(
      'SELECT id FROM combos WHERE LOWER(name) = LOWER($1)',
      [name.trim()]
    );
    if (nameCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A combo with this name already exists' });
    }

    const comboResult = await client.query(
      `INSERT INTO combos (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, created_by, created_at`,
      [name.trim(), description?.trim() || null, userId]
    );
    const combo = comboResult.rows[0];

    const subResult = await client.query(
      `INSERT INTO combo_subscriptions (user_id, combo_id)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, combo.id]
    );

    await client.query(
      `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
       VALUES ($1, 'combo', $2,
         COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 0) + 10)
       ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
      [userId, combo.id]
    );

    await client.query('COMMIT');

    res.status(201).json({ combo });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating combo:', error);
    res.status(500).json({ error: 'Failed to create combo' });
  } finally {
    client.release();
  }
};

// Get current user's owned combos
const getMyCombos = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_at,
              (SELECT COUNT(*) FROM combo_edges ce WHERE ce.combo_id = c.id) AS edge_count
       FROM combos c
       WHERE c.created_by = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );

    res.json({
      combos: result.rows.map(r => ({
        ...r,
        edge_count: Number(r.edge_count),
      })),
    });
  } catch (error) {
    console.error('Error getting my combos:', error);
    res.status(500).json({ error: 'Failed to get combos' });
  }
};

// Get current user's combo subscriptions
const getComboSubscriptions = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT cs.id AS subscription_id, cs.created_at AS subscribed_at, cs.group_id,
              c.id, c.name, c.description,
              (SELECT COUNT(*) FROM combo_edges ce WHERE ce.combo_id = c.id) AS edge_count,
              (SELECT COUNT(*) FROM combo_subscriptions cs2 WHERE cs2.combo_id = c.id) AS subscriber_count
       FROM combo_subscriptions cs
       JOIN combos c ON c.id = cs.combo_id
       WHERE cs.user_id = $1
       ORDER BY cs.created_at DESC`,
      [userId]
    );

    res.json({
      subscriptions: result.rows.map(r => ({
        ...r,
        edge_count: Number(r.edge_count),
        subscriber_count: Number(r.subscriber_count),
      })),
    });
  } catch (error) {
    console.error('Error getting combo subscriptions:', error);
    res.status(500).json({ error: 'Failed to get subscriptions' });
  }
};

// Subscribe to a combo
const subscribeToCombo = async (req, res) => {
  try {
    const { comboId } = req.body;
    const userId = req.user.userId;

    if (!comboId) {
      return res.status(400).json({ error: 'comboId is required' });
    }

    const comboCheck = await pool.query('SELECT id, name FROM combos WHERE id = $1', [comboId]);
    if (comboCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }

    const result = await pool.query(
      `INSERT INTO combo_subscriptions (user_id, combo_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, combo_id) DO NOTHING
       RETURNING id, user_id, combo_id, created_at`,
      [userId, comboId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Already subscribed to this combo' });
    }

    await pool.query(
      `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
       VALUES ($1, 'combo', $2,
         COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 0) + 10)
       ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
      [userId, comboId]
    );

    res.status(201).json({ subscription: result.rows[0], combo: comboCheck.rows[0] });
  } catch (error) {
    console.error('Error subscribing to combo:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
};

// Unsubscribe from a combo
const unsubscribeFromCombo = async (req, res) => {
  try {
    const { comboId } = req.body;
    const userId = req.user.userId;

    if (!comboId) {
      return res.status(400).json({ error: 'comboId is required' });
    }

    await pool.query(
      `DELETE FROM sidebar_items WHERE user_id = $1 AND item_type = 'combo' AND item_id = $2`,
      [userId, comboId]
    );

    const delResult = await pool.query(
      'DELETE FROM combo_subscriptions WHERE user_id = $1 AND combo_id = $2',
      [userId, comboId]
    );

    if (delResult.rowCount === 0) {
      return res.status(404).json({ error: 'Not subscribed to this combo' });
    }

    res.json({ message: 'Unsubscribed from combo' });
  } catch (error) {
    console.error('Error unsubscribing from combo:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
};

// Add an edge to a combo (owner only)
const addEdgeToCombo = async (req, res) => {
  try {
    const { edgeId } = req.body;
    const userId = req.user.userId;
    const comboId = req.params.id;

    if (!edgeId) {
      return res.status(400).json({ error: 'edgeId is required' });
    }

    const comboCheck = await pool.query(
      'SELECT id, created_by FROM combos WHERE id = $1',
      [comboId]
    );
    if (comboCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }
    if (comboCheck.rows[0].created_by !== userId) {
      return res.status(403).json({ error: 'Only the combo owner can add edges' });
    }

    const edgeCheck = await pool.query(
      `SELECT e.id, e.child_id, e.parent_id, e.attribute_id, e.graph_path,
              child_c.name AS concept_name,
              parent_c.name AS parent_name,
              a.name AS attribute_name
       FROM edges e
       JOIN concepts child_c ON child_c.id = e.child_id
       LEFT JOIN concepts parent_c ON parent_c.id = e.parent_id
       JOIN attributes a ON a.id = e.attribute_id
       WHERE e.id = $1`,
      [edgeId]
    );
    if (edgeCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Edge not found' });
    }

    const result = await pool.query(
      `INSERT INTO combo_edges (combo_id, edge_id)
       VALUES ($1, $2)
       ON CONFLICT (combo_id, edge_id) DO NOTHING
       RETURNING id, combo_id, edge_id, added_at`,
      [comboId, edgeId]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Edge already in this combo' });
    }

    res.status(201).json({ comboEdge: result.rows[0], edge: edgeCheck.rows[0] });
  } catch (error) {
    console.error('Error adding edge to combo:', error);
    res.status(500).json({ error: 'Failed to add edge to combo' });
  }
};

// Remove an edge from a combo (owner only)
const removeEdgeFromCombo = async (req, res) => {
  try {
    const { edgeId } = req.body;
    const userId = req.user.userId;
    const comboId = req.params.id;

    if (!edgeId) {
      return res.status(400).json({ error: 'edgeId is required' });
    }

    const comboCheck = await pool.query(
      'SELECT id, created_by FROM combos WHERE id = $1',
      [comboId]
    );
    if (comboCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }
    if (comboCheck.rows[0].created_by !== userId) {
      return res.status(403).json({ error: 'Only the combo owner can remove edges' });
    }

    const result = await pool.query(
      'DELETE FROM combo_edges WHERE combo_id = $1 AND edge_id = $2',
      [comboId, edgeId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Edge not found in this combo' });
    }

    res.json({ message: 'Edge removed from combo' });
  } catch (error) {
    console.error('Error removing edge from combo:', error);
    res.status(500).json({ error: 'Failed to remove edge from combo' });
  }
};

// Transfer combo ownership (Phase 42c)
const transferOwnership = async (req, res) => {
  const client = await pool.connect();
  try {
    const comboId = req.params.id;
    const userId = req.user.userId;
    const { newOwnerId } = req.body;

    if (!newOwnerId || isNaN(Number(newOwnerId))) {
      return res.status(400).json({ error: 'newOwnerId is required and must be a number' });
    }

    await client.query('BEGIN');

    const comboCheck = await client.query(
      'SELECT id, name, created_by FROM combos WHERE id = $1',
      [comboId]
    );
    if (comboCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Superconcept not found' });
    }
    if (comboCheck.rows[0].created_by !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the superconcept owner can transfer ownership' });
    }
    if (Number(newOwnerId) === userId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You already own this superconcept' });
    }

    const userCheck = await client.query(
      'SELECT id FROM users WHERE id = $1',
      [newOwnerId]
    );
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    await client.query(
      'UPDATE combos SET created_by = $1 WHERE id = $2',
      [newOwnerId, comboId]
    );

    const subCheck = await client.query(
      'SELECT id FROM combo_subscriptions WHERE user_id = $1 AND combo_id = $2',
      [newOwnerId, comboId]
    );
    if (subCheck.rows.length === 0) {
      await client.query(
        `INSERT INTO combo_subscriptions (user_id, combo_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, combo_id) DO NOTHING`,
        [newOwnerId, comboId]
      );
      await client.query(
        `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
         VALUES ($1, 'combo', $2,
           COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 0) + 10)
         ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
        [newOwnerId, comboId]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error transferring combo ownership:', error);
    res.status(500).json({ error: 'Failed to transfer ownership' });
  } finally {
    client.release();
  }
};

// Get combos containing a specific edge (Phase 47)
const getCombosByEdge = async (req, res) => {
  try {
    const edgeId = parseInt(req.params.edgeId, 10);
    if (!edgeId || edgeId < 1 || isNaN(edgeId)) {
      return res.status(400).json({ error: 'Invalid edgeId' });
    }

    const result = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_by, c.created_at,
              u.username AS created_by_username,
              u.orcid_id AS created_by_orcid_id,
              (SELECT COUNT(*) FROM combo_edges ce WHERE ce.combo_id = c.id) AS edge_count,
              (SELECT COUNT(*) FROM combo_subscriptions cs WHERE cs.combo_id = c.id) AS subscriber_count
       FROM combos c
       JOIN combo_edges ce_filter ON ce_filter.combo_id = c.id AND ce_filter.edge_id = $1
       LEFT JOIN users u ON u.id = c.created_by
       GROUP BY c.id, u.username, u.orcid_id
       ORDER BY subscriber_count DESC, c.name ASC`,
      [edgeId]
    );

    res.json(result.rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      created_by_username: r.created_by_username || null,
      created_by_orcid_id: r.created_by_orcid_id || null,
      edge_count: Number(r.edge_count),
      subscriber_count: Number(r.subscriber_count),
    })));
  } catch (error) {
    console.error('Error getting combos by edge:', error);
    res.status(500).json({ error: 'Failed to get combos for edge' });
  }
};

// Get aggregated concept_links across all member edges of a combo (Phase 58b-2)
const getComboLinks = async (req, res) => {
  try {
    const comboId = req.params.id;
    const { sort } = req.query; // 'new' or default ('top')

    // Verify combo exists
    const comboCheck = await pool.query('SELECT id FROM combos WHERE id = $1', [comboId]);
    if (comboCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Combo not found' });
    }

    const orderClause = sort === 'new'
      ? 'ORDER BY cl.created_at DESC'
      : 'ORDER BY COUNT(clv.id) DESC, cl.created_at DESC';

    const result = await pool.query(
      `SELECT
        cl.id,
        cl.edge_id,
        e.child_id AS concept_id,
        child_c.name AS concept_name,
        e.parent_id AS parent_concept_id,
        parent_c.name AS parent_concept_name,
        a.name AS attribute_name,
        cl.url,
        cl.title,
        cl.comment,
        cl.added_by,
        u.username AS added_by_username,
        cl.created_at,
        COUNT(clv.id)::int AS vote_count
      FROM combo_edges ce
      JOIN edges e ON e.id = ce.edge_id
      JOIN concept_links cl ON cl.edge_id = e.id
      JOIN concepts child_c ON child_c.id = e.child_id
      LEFT JOIN concepts parent_c ON parent_c.id = e.parent_id
      JOIN attributes a ON a.id = e.attribute_id
      LEFT JOIN users u ON u.id = cl.added_by
      LEFT JOIN concept_link_votes clv ON clv.concept_link_id = cl.id
      WHERE ce.combo_id = $1
        AND e.is_hidden = false
      GROUP BY cl.id, cl.edge_id, e.child_id, child_c.name,
               e.parent_id, parent_c.name, a.name,
               cl.url, cl.title, cl.comment, cl.added_by, u.username, cl.created_at
      ${orderClause}
      LIMIT 500`,
      [comboId]
    );

    res.json({ links: result.rows });
  } catch (error) {
    console.error('Error getting combo links:', error);
    res.status(500).json({ error: 'Failed to get combo links' });
  }
};

module.exports = {
  listCombos,
  getCombo,
  getCombosByEdge,
  getComboLinks,
  createCombo,
  getMyCombos,
  getComboSubscriptions,
  subscribeToCombo,
  unsubscribeFromCombo,
  addEdgeToCombo,
  removeEdgeFromCombo,
  transferOwnership,
};
