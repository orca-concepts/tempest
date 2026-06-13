const pool = require('../config/database');
const crypto = require('crypto');
const { fetchOgTitle } = require('../utils/ogTitleFetcher');
const safeBrowsing = require('../utils/safeBrowsing');
const { parseMentions } = require('../utils/parseMentions');
const { orcidForDisplay } = require('../utils/orcidValidator');

// Insert mention rows parsed from comment/addendum text.
// Uses the provided queryable (pool or transaction client).
async function insertMentions(queryable, sourceType, sourceId, text) {
  const mentions = parseMentions(text);
  for (const m of mentions) {
    await queryable.query(
      `INSERT INTO comment_mentions (source_type, source_id, target_type, target_id, target_path)
       VALUES ($1, $2, $3, $4, $5)`,
      [sourceType, sourceId, m.targetType, m.targetId, m.targetPath]
    );
  }
}

const votesController = {
  // Save a concept — creates votes on every edge along the full path.
  addVote: async (req, res) => {
    const { edgeId, path } = req.body;

    try {
      // Validate input
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const userId = req.user.userId;

      // path should be an array of concept IDs from root to the current concept
      // e.g. [1, 2, 3] means Root(1) → Child(2) → Child(3)
      // For root concepts, path will be empty [] or not provided
      const conceptPath = Array.isArray(path) ? path : [];

      // Check if the target edge exists (read can use pool)
      const edgeResult = await pool.query(
        'SELECT * FROM edges WHERE id = $1',
        [edgeId]
      );

      if (edgeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }

      if (edgeResult.rows[0].is_hidden) {
        return res.status(400).json({ error: 'Cannot save a hidden concept' });
      }

      // Find all edges along the path from root to this concept
      const edgeIdsToSave = [];

      if (conceptPath.length >= 1) {
        // Step 1: Find the root edge (parent_id IS NULL, child_id = first concept in path)
        const rootEdgeResult = await pool.query(
          'SELECT id FROM edges WHERE parent_id IS NULL AND child_id = $1 AND graph_path = $2',
          [conceptPath[0], '{}']
        );
        if (rootEdgeResult.rows.length > 0) {
          edgeIdsToSave.push(rootEdgeResult.rows[0].id);
        }

        // Step 2: Find each intermediate edge along the path
        for (let i = 0; i < conceptPath.length - 1; i++) {
          const parentId = conceptPath[i];
          const childId = conceptPath[i + 1];
          const graphPath = conceptPath.slice(0, i + 1);

          const edgeResult = await pool.query(
            'SELECT id FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3',
            [parentId, childId, graphPath]
          );
          if (edgeResult.rows.length > 0) {
            edgeIdsToSave.push(edgeResult.rows[0].id);
          }
        }
      }

      // Step 3: Always include the target edge itself
      if (!edgeIdsToSave.includes(edgeId)) {
        edgeIdsToSave.push(edgeId);
      }

      // All writes wrapped in a transaction
      const client = await pool.connect();
      let newVotesCount = 0;
      try {
        await client.query('BEGIN');

        // Phase 20c: Mutual exclusivity — remove any swap vote for this edge before saving
        await client.query(
          'DELETE FROM replace_votes WHERE user_id = $1 AND edge_id = $2',
          [userId, edgeId]
        );

        // Insert votes for all edges the user hasn't already voted on
        for (let i = 0; i < edgeIdsToSave.length; i++) {
          const eid = edgeIdsToSave[i];
          const insertResult = await client.query(
            `INSERT INTO votes (user_id, edge_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, edge_id) DO NOTHING
             RETURNING id`,
            [userId, eid]
          );
          if (insertResult.rows.length > 0) {
            newVotesCount++;
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      // Get updated vote count for the target edge (the one the user clicked)
      const voteCountResult = await pool.query(
        `SELECT COUNT(*) as vote_count FROM votes WHERE edge_id = $1`,
        [edgeId]
      );

      res.status(201).json({
        message: 'Save applied to full path',
        savedEdgeCount: edgeIdsToSave.length,
        newVotesCreated: newVotesCount,
        voteCount: parseInt(voteCountResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error saving:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Unsave a concept — removes vote on this edge AND all descendant edges
  removeVote: async (req, res) => {
    const { edgeId } = req.body;

    try {
      // Validate input
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const userId = req.user.userId;

      // Check if the user has a vote on this edge
      const existingVote = await pool.query(
        'SELECT * FROM votes WHERE user_id = $1 AND edge_id = $2',
        [userId, edgeId]
      );

      if (existingVote.rows.length === 0) {
        return res.status(404).json({ error: 'Vote not found' });
      }

      // Get the edge details so we can find descendants
      const edgeResult = await pool.query(
        'SELECT * FROM edges WHERE id = $1',
        [edgeId]
      );

      if (edgeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }

      const edge = edgeResult.rows[0];

      // Build the path that descendants would have as a prefix in their graph_path
      const childId = edge.child_id;
      
      let descendantPathPrefix;
      if (edge.parent_id === null) {
        // Root edge: children of this root have graph_path starting with [childId]
        descendantPathPrefix = [childId];
      } else {
        // Non-root edge: children have graph_path starting with [...graph_path, childId]
        descendantPathPrefix = [...edge.graph_path, childId];
      }

      // Find all descendant edges whose graph_path starts with our prefix
      const prefixLen = descendantPathPrefix.length;
      const descendantEdges = await pool.query(
        `SELECT e.id FROM edges e
         WHERE e.graph_path[1:$1] = $2::integer[]
         AND array_length(e.graph_path, 1) >= $1`,
        [prefixLen, descendantPathPrefix]
      );

      const descendantEdgeIds = descendantEdges.rows.map(r => r.id);

      // Collect all edge IDs to unsave: the target edge + all descendants
      const allEdgeIds = [edgeId, ...descendantEdgeIds];

      // Remove all votes for this user on these edges
      // vote_tab_links will be automatically removed via ON DELETE CASCADE on votes
      const deleteResult = await pool.query(
        'DELETE FROM votes WHERE user_id = $1 AND edge_id = ANY($2::integer[]) RETURNING edge_id',
        [userId, allEdgeIds]
      );

      if (deleteResult.rows.length > 0) {
        const removedEdgeIds = deleteResult.rows.map(r => r.edge_id);

      }

      // Get updated vote count for the target edge
      const voteCountResult = await pool.query(
        `SELECT COUNT(*) as vote_count FROM votes WHERE edge_id = $1`,
        [edgeId]
      );

      res.json({
        message: 'Unsave cascaded to descendants',
        removedVoteCount: deleteResult.rows.length,
        voteCount: parseInt(voteCountResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error unsaving:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Unsave from a specific tab only — removes the vote-tab link, but keeps
  // the vote itself if it's linked to other tabs. If it's the last tab link,
  // the vote itself is also deleted (full unsave with cascade).
  removeVoteFromTab: async (req, res) => {
    const { edgeId, tabId } = req.body;

    try {
      if (!edgeId || !tabId) {
        return res.status(400).json({ error: 'edgeId and tabId are required' });
      }

      const userId = req.user.userId;

      // Verify tab belongs to user
      const tabCheck = await pool.query(
        'SELECT id FROM saved_tabs WHERE id = $1 AND user_id = $2',
        [tabId, userId]
      );
      if (tabCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid tab' });
      }

      // Get the vote for this edge
      const voteResult = await pool.query(
        'SELECT id FROM votes WHERE user_id = $1 AND edge_id = $2',
        [userId, edgeId]
      );
      if (voteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Vote not found' });
      }
      const voteId = voteResult.rows[0].id;

      // Get the edge details for descendant lookup
      const edgeResult = await pool.query('SELECT * FROM edges WHERE id = $1', [edgeId]);
      if (edgeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }
      const edge = edgeResult.rows[0];

      // Find all descendant edges
      const childId = edge.child_id;
      let descendantPathPrefix;
      if (edge.parent_id === null) {
        descendantPathPrefix = [childId];
      } else {
        descendantPathPrefix = [...edge.graph_path, childId];
      }

      const prefixLen = descendantPathPrefix.length;
      const descendantEdges = await pool.query(
        `SELECT e.id FROM edges e
         WHERE e.graph_path[1:$1] = $2::integer[]
         AND array_length(e.graph_path, 1) >= $1`,
        [prefixLen, descendantPathPrefix]
      );
      const descendantEdgeIds = descendantEdges.rows.map(r => r.id);
      const allEdgeIds = [edgeId, ...descendantEdgeIds];

      // Get all vote IDs for these edges
      const votesResult = await pool.query(
        'SELECT id, edge_id FROM votes WHERE user_id = $1 AND edge_id = ANY($2::integer[])',
        [userId, allEdgeIds]
      );

      let removedLinkCount = 0;
      let removedVoteCount = 0;

      for (const voteRow of votesResult.rows) {
        // Remove the tab link
        const delLink = await pool.query(
          'DELETE FROM vote_tab_links WHERE vote_id = $1 AND saved_tab_id = $2 RETURNING id',
          [voteRow.id, tabId]
        );
        if (delLink.rows.length > 0) removedLinkCount++;

        // Check if the vote still has any tab links remaining
        const remainingLinks = await pool.query(
          'SELECT COUNT(*) as cnt FROM vote_tab_links WHERE vote_id = $1',
          [voteRow.id]
        );

        if (parseInt(remainingLinks.rows[0].cnt) === 0) {
          // No more tab links — delete the vote entirely
          await pool.query('DELETE FROM votes WHERE id = $1', [voteRow.id]);
          removedVoteCount++;
        }
      }

      // Get updated vote count for the target edge
      const voteCountResult = await pool.query(
        `SELECT COUNT(*) as vote_count FROM votes WHERE edge_id = $1`,
        [edgeId]
      );

      res.json({
        message: 'Removed from tab (cascaded to descendants)',
        removedLinkCount,
        removedVoteCount,
        voteCount: parseInt(voteCountResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error removing vote from tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all edges the current user has saved for a specific tab (or all tabs)
  // Returns edges with full path info, concept names, attributes, move/swap counts
  getUserSaves: async (req, res) => {
    try {
      const userId = req.user.userId;
      const tabId = req.query.tabId || null;

      let query;
      let params;

      if (tabId) {
        // Filter to a specific tab via vote_tab_links
        query = `
          SELECT 
            e.id AS edge_id,
            e.parent_id,
            e.child_id,
            e.graph_path,
            e.created_at AS edge_created_at,
            c.name AS child_name,
            a.id AS attribute_id,
            a.name AS attribute_name,
            COUNT(DISTINCT all_v.user_id) AS vote_count,
            (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) AS swap_count
          FROM votes v
          JOIN vote_tab_links vtl ON vtl.vote_id = v.id AND vtl.saved_tab_id = $2
          JOIN edges e ON v.edge_id = e.id
          JOIN concepts c ON e.child_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes all_v ON all_v.edge_id = e.id
          WHERE v.user_id = $1
          GROUP BY e.id, e.parent_id, e.child_id, e.graph_path, e.created_at,
                   c.name, a.id, a.name
          ORDER BY e.graph_path, c.name`;
        params = [userId, tabId];
      } else {
        // No tab filter — return all saves (backwards compatible)
        query = `
          SELECT 
            e.id AS edge_id,
            e.parent_id,
            e.child_id,
            e.graph_path,
            e.created_at AS edge_created_at,
            c.name AS child_name,
            a.id AS attribute_id,
            a.name AS attribute_name,
            COUNT(DISTINCT all_v.user_id) AS vote_count,
            (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) AS swap_count
          FROM votes v
          JOIN edges e ON v.edge_id = e.id
          JOIN concepts c ON e.child_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes all_v ON all_v.edge_id = e.id
          WHERE v.user_id = $1
          GROUP BY e.id, e.parent_id, e.child_id, e.graph_path, e.created_at,
                   c.name, a.id, a.name
          ORDER BY e.graph_path, c.name`;
        params = [userId];
      }

      const result = await pool.query(query, params);

      // Collect all unique concept IDs we need names for (parents in paths)
      const conceptIds = new Set();
      result.rows.forEach(row => {
        if (row.graph_path) {
          row.graph_path.forEach(id => conceptIds.add(id));
        }
        if (row.parent_id) conceptIds.add(row.parent_id);
        conceptIds.add(row.child_id);
      });

      // Fetch all concept names in one query
      let conceptNames = {};
      if (conceptIds.size > 0) {
        const namesResult = await pool.query(
          'SELECT id, name FROM concepts WHERE id = ANY($1::integer[])',
          [Array.from(conceptIds)]
        );
        namesResult.rows.forEach(row => {
          conceptNames[row.id] = row.name;
        });
      }

      // Build the edges array with all info the frontend needs
      const edges = result.rows.map(row => ({
        edgeId: row.edge_id,
        parentId: row.parent_id,
        childId: row.child_id,
        childName: row.child_name,
        graphPath: row.graph_path || [],
        attributeId: row.attribute_id,
        attributeName: row.attribute_name,
        voteCount: parseInt(row.vote_count),
        swapCount: parseInt(row.swap_count),
        edgeCreatedAt: row.edge_created_at,
      }));

      res.json({ edges, conceptNames });
    } catch (error) {
      console.error('Error fetching user saves:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Saved Tabs CRUD
  // ============================================================

  // Get all saved tabs for the current user
  getUserTabs: async (req, res) => {
    try {
      const userId = req.user.userId;

      const result = await pool.query(
        'SELECT id, name, display_order, group_id, created_at FROM saved_tabs WHERE user_id = $1 ORDER BY display_order ASC, created_at ASC',
        [userId]
      );

      res.json({ tabs: result.rows });
    } catch (error) {
      console.error('Error fetching user tabs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a new saved tab
  createTab: async (req, res) => {
    const { name } = req.body;

    try {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Tab name is required' });
      }

      const userId = req.user.userId;
      const trimmedName = name.trim();

      if (trimmedName.length > 255) {
        return res.status(400).json({ error: 'Tab name must be 255 characters or fewer' });
      }

      // Get the next display order
      const orderResult = await pool.query(
        'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM saved_tabs WHERE user_id = $1',
        [userId]
      );
      const nextOrder = orderResult.rows[0].next_order;

      const result = await pool.query(
        'INSERT INTO saved_tabs (user_id, name, display_order) VALUES ($1, $2, $3) RETURNING id, name, display_order, created_at',
        [userId, trimmedName, nextOrder]
      );

      res.status(201).json({ tab: result.rows[0] });
    } catch (error) {
      console.error('Error creating tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Rename a saved tab
  renameTab: async (req, res) => {
    const { tabId, name } = req.body;

    try {
      if (!tabId || !name || !name.trim()) {
        return res.status(400).json({ error: 'Tab ID and name are required' });
      }

      const userId = req.user.userId;
      const trimmedName = name.trim();

      if (trimmedName.length > 255) {
        return res.status(400).json({ error: 'Tab name must be 255 characters or fewer' });
      }

      const result = await pool.query(
        'UPDATE saved_tabs SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name, display_order, created_at',
        [trimmedName, tabId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }

      res.json({ tab: result.rows[0] });
    } catch (error) {
      console.error('Error renaming tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Delete a saved tab (only if user has more than one tab)
  deleteTab: async (req, res) => {
    const { tabId } = req.body;

    try {
      if (!tabId) {
        return res.status(400).json({ error: 'Tab ID is required' });
      }

      const userId = req.user.userId;

      // Verify tab belongs to user
      const tabCheck = await pool.query(
        'SELECT id FROM saved_tabs WHERE id = $1 AND user_id = $2',
        [tabId, userId]
      );
      if (tabCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }

      // Ensure user has more than one tab (can't delete the last tab)
      const countResult = await pool.query(
        'SELECT COUNT(*) as cnt FROM saved_tabs WHERE user_id = $1',
        [userId]
      );
      if (parseInt(countResult.rows[0].cnt) <= 1) {
        return res.status(400).json({ error: 'Cannot delete your last tab' });
      }

      // Delete the tab — vote_tab_links cascade automatically.
      // Votes that lose their last tab link are orphaned but still count
      // as endorsements. We clean them up: delete votes with no remaining links.
      // First, find votes that are ONLY linked to this tab
      const orphanVotes = await pool.query(
        `SELECT vtl.vote_id FROM vote_tab_links vtl
         WHERE vtl.saved_tab_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM vote_tab_links other
           WHERE other.vote_id = vtl.vote_id AND other.saved_tab_id != $1
         )`,
        [tabId]
      );
      const orphanVoteIds = orphanVotes.rows.map(r => r.vote_id);

      // Delete the tab (cascades vote_tab_links)
      await pool.query('DELETE FROM saved_tabs WHERE id = $1', [tabId]);

      // Delete orphaned votes (votes that were only in this tab)
      if (orphanVoteIds.length > 0) {
        await pool.query(
          'DELETE FROM votes WHERE id = ANY($1::integer[])',
          [orphanVoteIds]
        );
      }

      res.json({
        message: 'Tab deleted',
        orphanedVotesRemoved: orphanVoteIds.length
      });
    } catch (error) {
      console.error('Error deleting tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Add a link vote (similarity vote) in contextual Flip View
  addLinkVote: async (req, res) => {
    const { originEdgeId, similarEdgeId } = req.body;

    try {
      if (!originEdgeId || !similarEdgeId) {
        return res.status(400).json({ error: 'originEdgeId and similarEdgeId are required' });
      }

      if (originEdgeId === similarEdgeId) {
        return res.status(400).json({ error: 'Cannot link an edge to itself' });
      }

      const userId = req.user.userId;

      // Verify both edges exist
      const edgeCheck = await pool.query(
        'SELECT id FROM edges WHERE id = ANY($1::integer[])',
        [[originEdgeId, similarEdgeId]]
      );

      if (edgeCheck.rows.length < 2) {
        return res.status(404).json({ error: 'One or both edges not found' });
      }

      // Insert link vote (ON CONFLICT = already voted, just return current count)
      const insertResult = await pool.query(
        `INSERT INTO similarity_votes (user_id, origin_edge_id, similar_edge_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, origin_edge_id, similar_edge_id) DO NOTHING
         RETURNING id`,
        [userId, originEdgeId, similarEdgeId]
      );

      // Get updated link vote count for this similar_edge from this origin
      const countResult = await pool.query(
        'SELECT COUNT(*) as link_count FROM similarity_votes WHERE origin_edge_id = $1 AND similar_edge_id = $2',
        [originEdgeId, similarEdgeId]
      );

      res.status(201).json({
        message: insertResult.rows.length > 0 ? 'Link vote added' : 'Already linked',
        linkCount: parseInt(countResult.rows[0].link_count)
      });
    } catch (error) {
      console.error('Error adding link vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove a link vote
  removeLinkVote: async (req, res) => {
    const { originEdgeId, similarEdgeId } = req.body;

    try {
      if (!originEdgeId || !similarEdgeId) {
        return res.status(400).json({ error: 'originEdgeId and similarEdgeId are required' });
      }

      const userId = req.user.userId;

      const deleteResult = await pool.query(
        `DELETE FROM similarity_votes 
         WHERE user_id = $1 AND origin_edge_id = $2 AND similar_edge_id = $3
         RETURNING id`,
        [userId, originEdgeId, similarEdgeId]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Link vote not found' });
      }

      // Get updated link vote count
      const countResult = await pool.query(
        'SELECT COUNT(*) as link_count FROM similarity_votes WHERE origin_edge_id = $1 AND similar_edge_id = $2',
        [originEdgeId, similarEdgeId]
      );

      res.json({
        message: 'Link vote removed',
        linkCount: parseInt(countResult.rows[0].link_count)
      });
    } catch (error) {
      console.error('Error removing link vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all swap votes for a specific edge (for the swap modal)
  // Phase 44: Returns two lists — existingSwaps (siblings with swap votes) and otherSiblings (siblings without)
  getSwapVotes: async (req, res) => {
    const { edgeId } = req.params;

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      const userId = req.user ? req.user.userId : -1;

      // Fetch the source edge to determine sibling context
      const sourceResult = await pool.query(
        'SELECT id, parent_id, graph_path, attribute_id FROM edges WHERE id = $1',
        [edgeId]
      );
      if (sourceResult.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }
      const sourceEdge = sourceResult.rows[0];

      // Query 1: existingSwaps — siblings that already have swap votes from this edge
      const existingSwapsResult = await pool.query(
        `SELECT
          rv.replacement_edge_id,
          e.child_id AS replacement_child_id,
          c.name AS replacement_name,
          COUNT(DISTINCT rv.user_id)::int AS vote_count,
          BOOL_OR(rv.user_id = $2) AS user_voted,
          COALESCE((SELECT COUNT(*)::int FROM votes v WHERE v.edge_id = rv.replacement_edge_id), 0) AS save_count
        FROM replace_votes rv
        JOIN edges e ON e.id = rv.replacement_edge_id
        JOIN concepts c ON c.id = e.child_id
        WHERE rv.edge_id = $1
        GROUP BY rv.replacement_edge_id, e.child_id, c.name
        ORDER BY vote_count DESC, c.name ASC`,
        [edgeId, userId]
      );

      // Query 2: otherSiblings — sibling edges with NO swap votes from this edge
      let otherSiblingsResult;
      if (sourceEdge.parent_id === null) {
        // Root siblings: same attribute, parent_id IS NULL
        otherSiblingsResult = await pool.query(
          `SELECT
            e.id AS edge_id,
            e.child_id,
            c.name AS child_name,
            COALESCE((SELECT COUNT(*)::int FROM votes v WHERE v.edge_id = e.id), 0) AS save_count
          FROM edges e
          JOIN concepts c ON c.id = e.child_id
          WHERE e.parent_id IS NULL
            AND e.attribute_id = $1
            AND e.id != $2
            AND e.is_hidden = false
            AND NOT EXISTS (
              SELECT 1 FROM replace_votes rv
              WHERE rv.edge_id = $2 AND rv.replacement_edge_id = e.id
            )
          ORDER BY save_count DESC, c.name ASC`,
          [sourceEdge.attribute_id, edgeId]
        );
      } else {
        // Non-root siblings: same parent_id and graph_path
        otherSiblingsResult = await pool.query(
          `SELECT
            e.id AS edge_id,
            e.child_id,
            c.name AS child_name,
            COALESCE((SELECT COUNT(*)::int FROM votes v WHERE v.edge_id = e.id), 0) AS save_count
          FROM edges e
          JOIN concepts c ON c.id = e.child_id
          WHERE e.parent_id = $1
            AND e.graph_path = $2
            AND e.id != $3
            AND e.is_hidden = false
            AND NOT EXISTS (
              SELECT 1 FROM replace_votes rv
              WHERE rv.edge_id = $3 AND rv.replacement_edge_id = e.id
            )
          ORDER BY save_count DESC, c.name ASC`,
          [sourceEdge.parent_id, sourceEdge.graph_path, edgeId]
        );
      }

      const existingSwaps = existingSwapsResult.rows.map(row => ({
        replacementEdgeId: row.replacement_edge_id,
        replacementChildId: row.replacement_child_id,
        replacementName: row.replacement_name,
        voteCount: row.vote_count,
        userVoted: row.user_voted,
        saveCount: row.save_count
      }));

      const otherSiblings = otherSiblingsResult.rows.map(row => ({
        edgeId: row.edge_id,
        childId: row.child_id,
        childName: row.child_name,
        saveCount: row.save_count
      }));

      res.json({
        existingSwaps,
        otherSiblings,
        totalSwapVotes: existingSwaps.reduce((sum, s) => sum + s.voteCount, 0)
      });
    } catch (error) {
      console.error('Error getting swap votes:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Add a swap vote
  // Phase 44: Sibling-only validation restored, auto-save destination, transaction-wrapped
  addSwapVote: async (req, res) => {
    const { edgeId, replacementEdgeId } = req.body;

    try {
      if (!edgeId || !replacementEdgeId) {
        return res.status(400).json({ error: 'edgeId and replacementEdgeId are required' });
      }

      if (parseInt(edgeId) === parseInt(replacementEdgeId)) {
        return res.status(400).json({ error: 'Cannot swap an edge with itself' });
      }

      const userId = req.user.userId;

      // Fetch both edges with details for sibling validation
      const edgeCheck = await pool.query(
        'SELECT id, parent_id, graph_path, attribute_id, child_id, is_hidden FROM edges WHERE id = ANY($1::integer[])',
        [[edgeId, replacementEdgeId]]
      );

      if (edgeCheck.rows.length < 2) {
        return res.status(404).json({ error: 'One or both edges not found' });
      }

      const sourceEdge = edgeCheck.rows.find(e => e.id === parseInt(edgeId));
      const replacementEdge = edgeCheck.rows.find(e => e.id === parseInt(replacementEdgeId));

      // Phase 44: Sibling validation (Architecture Decision #256)
      const sourceIsRoot = sourceEdge.parent_id === null;
      const replacementIsRoot = replacementEdge.parent_id === null;

      let isSibling = false;
      if (sourceIsRoot && replacementIsRoot) {
        // Both root: must share attribute
        isSibling = sourceEdge.attribute_id === replacementEdge.attribute_id;
      } else if (!sourceIsRoot && !replacementIsRoot) {
        // Both non-root: must share parent_id and graph_path
        // PostgreSQL arrays returned by pg driver are JS arrays — compare via JSON
        isSibling = sourceEdge.parent_id === replacementEdge.parent_id
          && JSON.stringify(sourceEdge.graph_path) === JSON.stringify(replacementEdge.graph_path);
      }
      // If one is root and the other isn't, isSibling stays false

      if (!isSibling) {
        return res.status(400).json({ error: 'Replacement must be a sibling' });
      }

      // Use a transaction for the swap insert + auto-save
      const client = await pool.connect();
      let autoSaved = false;
      try {
        await client.query('BEGIN');

        // Phase 20c: Mutual exclusivity — remove any save vote for this edge before swapping.
        // This mirrors the cascade logic in removeVote: delete the direct vote + all descendant votes.
        const existingSaveForEdge = await client.query(
          'SELECT id FROM votes WHERE user_id = $1 AND edge_id = $2',
          [userId, edgeId]
        );

        if (existingSaveForEdge.rows.length > 0) {
          const swapChildId = sourceEdge.child_id;
          let descendantPathPrefix;
          if (sourceEdge.parent_id === null) {
            descendantPathPrefix = [swapChildId];
          } else {
            descendantPathPrefix = [...sourceEdge.graph_path, swapChildId];
          }
          const prefixLen = descendantPathPrefix.length;
          const descendantEdges = await client.query(
            `SELECT e.id FROM edges e
             WHERE e.graph_path[1:$1] = $2::integer[]
             AND array_length(e.graph_path, 1) >= $1`,
            [prefixLen, descendantPathPrefix]
          );
          const descendantEdgeIds = descendantEdges.rows.map(r => r.id);
          const allEdgeIdsToUnsave = [parseInt(edgeId), ...descendantEdgeIds];

          await client.query(
            'DELETE FROM votes WHERE user_id = $1 AND edge_id = ANY($2::integer[]) RETURNING edge_id',
            [userId, allEdgeIdsToUnsave]
          );
        }

        // Insert swap vote
        const insertResult = await client.query(
          `INSERT INTO replace_votes (user_id, edge_id, replacement_edge_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, edge_id, replacement_edge_id) DO NOTHING
           RETURNING id`,
          [userId, edgeId, replacementEdgeId]
        );

        // Phase 44: Auto-save the destination edge if the user hasn't already saved it
        // (Architecture Decision #257)
        const existingSaveOnDest = await client.query(
          'SELECT 1 FROM votes WHERE user_id = $1 AND edge_id = $2',
          [userId, replacementEdgeId]
        );

        if (existingSaveOnDest.rows.length === 0) {
          // Phase 20c cascade: if user had a swap vote on the destination, remove it
          await client.query(
            'DELETE FROM replace_votes WHERE user_id = $1 AND edge_id = $2',
            [userId, replacementEdgeId]
          );

          // Insert the auto-save vote on the destination
          await client.query(
            `INSERT INTO votes (user_id, edge_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, edge_id) DO NOTHING`,
            [userId, replacementEdgeId]
          );

          autoSaved = true;
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Get total swap vote count for this edge (distinct users)
      const totalResult = await pool.query(
        'SELECT COUNT(DISTINCT user_id) AS total_swappers FROM replace_votes WHERE edge_id = $1',
        [edgeId]
      );

      // Get vote count for this specific replacement
      const replCountResult = await pool.query(
        'SELECT COUNT(*) AS repl_count FROM replace_votes WHERE edge_id = $1 AND replacement_edge_id = $2',
        [edgeId, replacementEdgeId]
      );

      res.status(201).json({
        message: 'Swap vote added',
        totalSwapVotes: parseInt(totalResult.rows[0].total_swappers),
        replacementVoteCount: parseInt(replCountResult.rows[0].repl_count),
        autoSaved
      });
    } catch (error) {
      console.error('Error adding swap vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove a swap vote
  removeSwapVote: async (req, res) => {
    const { edgeId, replacementEdgeId } = req.body;

    try {
      if (!edgeId || !replacementEdgeId) {
        return res.status(400).json({ error: 'edgeId and replacementEdgeId are required' });
      }

      const userId = req.user.userId;

      const deleteResult = await pool.query(
        `DELETE FROM replace_votes 
         WHERE user_id = $1 AND edge_id = $2 AND replacement_edge_id = $3
         RETURNING id`,
        [userId, edgeId, replacementEdgeId]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Swap vote not found' });
      }

      // Get updated total swap vote count
      const totalResult = await pool.query(
        'SELECT COUNT(DISTINCT user_id) AS total_swappers FROM replace_votes WHERE edge_id = $1',
        [edgeId]
      );

      // Get updated count for this specific replacement
      const replCountResult = await pool.query(
        'SELECT COUNT(*) AS repl_count FROM replace_votes WHERE edge_id = $1 AND replacement_edge_id = $2',
        [edgeId, replacementEdgeId]
      );

      res.json({
        message: 'Swap vote removed',
        totalSwapVotes: parseInt(totalResult.rows[0].total_swappers),
        replacementVoteCount: parseInt(replCountResult.rows[0].repl_count)
      });
    } catch (error) {
      console.error('Error removing swap vote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Graph Tabs CRUD (Phase 5c)
  // Persistent in-app navigation tabs for exploring the graph.
  // ============================================================

  // Get all graph tabs for the current user
  getGraphTabs: async (req, res) => {
    try {
      const userId = req.user.userId;

      const result = await pool.query(
        `SELECT id, tab_type, concept_id, path, view_mode, display_order, label, group_id, created_at, updated_at
         FROM graph_tabs 
         WHERE user_id = $1 
         ORDER BY display_order ASC, created_at ASC`,
        [userId]
      );

      res.json({ graphTabs: result.rows });
    } catch (error) {
      console.error('Error fetching graph tabs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a new graph tab (e.g. clicking "+" or opening from Saved tree)
  createGraphTab: async (req, res) => {
    const { tabType, conceptId, path, viewMode, label } = req.body;

    try {
      const userId = req.user.userId;
      const type = tabType || 'root';
      const tabPath = Array.isArray(path) ? path : [];
      const mode = viewMode || 'children';
      const tabLabel = (label || 'Root').substring(0, 255);

      // Get next display order
      const orderResult = await pool.query(
        'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM graph_tabs WHERE user_id = $1',
        [userId]
      );
      const nextOrder = orderResult.rows[0].next_order;

      const result = await pool.query(
        `INSERT INTO graph_tabs (user_id, tab_type, concept_id, path, view_mode, display_order, label)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tab_type, concept_id, path, view_mode, display_order, label, group_id, created_at, updated_at`,
        [userId, type, conceptId || null, tabPath, mode, nextOrder, tabLabel]
      );

      const newTab = result.rows[0];

      // Add to sidebar_items (at end of list)
      await pool.query(
        `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
         VALUES ($1, 'graph_tab', $2,
                 COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 20000) + 10)
         ON CONFLICT DO NOTHING`,
        [userId, newTab.id]
      );

      res.status(201).json({ graphTab: newTab });
    } catch (error) {
      console.error('Error creating graph tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Update a graph tab's navigation state (concept, path, viewMode, label)
  updateGraphTab: async (req, res) => {
    const { tabId, tabType, conceptId, path, viewMode, label } = req.body;

    try {
      if (!tabId) {
        return res.status(400).json({ error: 'tabId is required' });
      }

      const userId = req.user.userId;

      // Build the SET clause dynamically based on what was provided
      const updates = [];
      const values = [userId, tabId];
      let paramIndex = 3;

      if (tabType !== undefined) {
        updates.push(`tab_type = $${paramIndex++}`);
        values.push(tabType);
      }
      if (conceptId !== undefined) {
        updates.push(`concept_id = $${paramIndex++}`);
        values.push(conceptId);
      }
      if (path !== undefined) {
        updates.push(`path = $${paramIndex++}`);
        values.push(Array.isArray(path) ? path : []);
      }
      if (viewMode !== undefined) {
        updates.push(`view_mode = $${paramIndex++}`);
        values.push(viewMode);
      }
      if (label !== undefined) {
        updates.push(`label = $${paramIndex++}`);
        values.push(String(label).substring(0, 255));
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');

      const result = await pool.query(
        `UPDATE graph_tabs SET ${updates.join(', ')} 
         WHERE id = $2 AND user_id = $1
         RETURNING id, tab_type, concept_id, path, view_mode, display_order, label, group_id, created_at, updated_at`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Graph tab not found' });
      }

      res.json({ graphTab: result.rows[0] });
    } catch (error) {
      console.error('Error updating graph tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ─── Tab Groups (Phase 5d) ──────────────────────────────

  // Get all tab groups for the current user
  getTabGroups: async (req, res) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query(
        `SELECT id, name, display_order, is_expanded, created_at
         FROM tab_groups
         WHERE user_id = $1
         ORDER BY display_order ASC, created_at ASC`,
        [userId]
      );
      res.json({ tabGroups: result.rows });
    } catch (error) {
      console.error('Error fetching tab groups:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Create a new tab group
  createTabGroup: async (req, res) => {
    const { name } = req.body;
    try {
      const userId = req.user.userId;
      const groupName = (name || 'Group').substring(0, 255);

      const orderResult = await pool.query(
        'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM tab_groups WHERE user_id = $1',
        [userId]
      );
      const nextOrder = orderResult.rows[0].next_order;

      const result = await pool.query(
        `INSERT INTO tab_groups (user_id, name, display_order)
         VALUES ($1, $2, $3)
         RETURNING id, name, display_order, is_expanded, created_at`,
        [userId, groupName, nextOrder]
      );

      const newGroup = result.rows[0];

      // Add to sidebar_items (at end of list)
      await pool.query(
        `INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
         VALUES ($1, 'group', $2,
                 COALESCE((SELECT MAX(display_order) FROM sidebar_items WHERE user_id = $1), 10000) + 10)
         ON CONFLICT DO NOTHING`,
        [userId, newGroup.id]
      );

      res.status(201).json({ tabGroup: newGroup });
    } catch (error) {
      console.error('Error creating tab group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Rename a tab group
  renameTabGroup: async (req, res) => {
    const { groupId, name } = req.body;
    try {
      if (!groupId || !name?.trim()) {
        return res.status(400).json({ error: 'groupId and name are required' });
      }
      const userId = req.user.userId;
      const result = await pool.query(
        `UPDATE tab_groups SET name = $1 WHERE id = $2 AND user_id = $3
         RETURNING id, name, display_order, is_expanded, created_at`,
        [name.trim().substring(0, 255), groupId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab group not found' });
      }
      res.json({ tabGroup: result.rows[0] });
    } catch (error) {
      console.error('Error renaming tab group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Delete a tab group (tabs inside become ungrouped — NOT deleted)
  deleteTabGroup: async (req, res) => {
    const { groupId } = req.body;
    try {
      if (!groupId) {
        return res.status(400).json({ error: 'groupId is required' });
      }
      const userId = req.user.userId;

      // ON DELETE SET NULL on FK handles ungrouping, but let's be explicit
      await pool.query(
        'UPDATE saved_tabs SET group_id = NULL WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      await pool.query(
        'UPDATE graph_tabs SET group_id = NULL WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      // Note: corpus_subscriptions.group_id was dropped in Phase 19d — no update needed

      const result = await pool.query(
        'DELETE FROM tab_groups WHERE id = $1 AND user_id = $2 RETURNING id',
        [groupId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab group not found' });
      }

      // Remove from sidebar_items
      await pool.query(
        `DELETE FROM sidebar_items WHERE user_id = $1 AND item_type = 'group' AND item_id = $2`,
        [userId, groupId]
      );

      res.json({ message: 'Tab group deleted', ungroupedTabs: true });
    } catch (error) {
      console.error('Error deleting tab group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Toggle a tab group's expanded/collapsed state
  toggleTabGroup: async (req, res) => {
    const { groupId, isExpanded } = req.body;
    try {
      if (!groupId) {
        return res.status(400).json({ error: 'groupId is required' });
      }
      const userId = req.user.userId;
      const result = await pool.query(
        `UPDATE tab_groups SET is_expanded = $1 WHERE id = $2 AND user_id = $3
         RETURNING id, name, display_order, is_expanded, created_at`,
        [isExpanded !== undefined ? isExpanded : true, groupId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab group not found' });
      }
      res.json({ tabGroup: result.rows[0] });
    } catch (error) {
      console.error('Error toggling tab group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Add a tab (saved or graph) to a group
  addTabToGroup: async (req, res) => {
    const { tabType, tabId, groupId } = req.body;
    try {
      if (!tabType || !tabId || !groupId) {
        return res.status(400).json({ error: 'tabType, tabId, and groupId are required' });
      }
      const userId = req.user.userId;

      // Verify the group belongs to this user
      const groupCheck = await pool.query(
        'SELECT id FROM tab_groups WHERE id = $1 AND user_id = $2',
        [groupId, userId]
      );
      if (groupCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tab group not found' });
      }

      if (tabType === 'corpus') {
        return res.status(400).json({ error: 'Corpus tabs cannot be added to groups' });
      }
      let table;
      let idColumn = 'id';
      if (tabType === 'saved') { table = 'saved_tabs'; }
      else if (tabType === 'combo') { table = 'combo_subscriptions'; idColumn = 'combo_id'; }
      else { table = 'graph_tabs'; }
      const whereClause = tabType === 'combo'
        ? `WHERE combo_id = $2 AND user_id = $3`
        : `WHERE id = $2 AND user_id = $3`;
      const result = await pool.query(
        `UPDATE ${table} SET group_id = $1 ${whereClause} RETURNING ${idColumn} as id, group_id`,
        [groupId, tabId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }
      res.json({ message: 'Tab added to group', tab: result.rows[0] });
    } catch (error) {
      console.error('Error adding tab to group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove a tab from its group (make it ungrouped)
  removeTabFromGroup: async (req, res) => {
    const { tabType, tabId } = req.body;
    try {
      if (!tabType || !tabId) {
        return res.status(400).json({ error: 'tabType and tabId are required' });
      }
      const userId = req.user.userId;

      if (tabType === 'corpus') {
        return res.status(400).json({ error: 'Corpus tabs cannot be in groups' });
      }
      let table;
      let idColumn = 'id';
      if (tabType === 'saved') { table = 'saved_tabs'; }
      else if (tabType === 'combo') { table = 'combo_subscriptions'; idColumn = 'combo_id'; }
      else { table = 'graph_tabs'; }
      const whereClause = tabType === 'combo'
        ? `WHERE combo_id = $1 AND user_id = $2`
        : `WHERE id = $1 AND user_id = $2`;
      const result = await pool.query(
        `UPDATE ${table} SET group_id = NULL ${whereClause} RETURNING ${idColumn} as id, group_id`,
        [tabId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }
      res.json({ message: 'Tab removed from group', tab: result.rows[0] });
    } catch (error) {
      console.error('Error removing tab from group:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Saved Tree Order (Phase 5e)
  // Persists the display order of root-level graph trees within
  // each Saved tab. Trees without an explicit order record fall
  // to the bottom, sorted by save count.
  // ============================================================

  // Get tree order for a specific saved tab
  getTreeOrder: async (req, res) => {
    try {
      const userId = req.user.userId;
      const tabId = req.query.tabId;

      if (!tabId) {
        return res.status(400).json({ error: 'tabId query parameter is required' });
      }

      // Verify tab belongs to user
      const tabCheck = await pool.query(
        'SELECT id FROM saved_tabs WHERE id = $1 AND user_id = $2',
        [tabId, userId]
      );
      if (tabCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }

      const result = await pool.query(
        `SELECT root_concept_id, display_order
         FROM saved_tree_order
         WHERE user_id = $1 AND saved_tab_id = $2
         ORDER BY display_order ASC`,
        [userId, tabId]
      );

      res.json({ treeOrder: result.rows });
    } catch (error) {
      console.error('Error fetching tree order:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Update tree order for a specific saved tab
  // Expects { tabId, order: [{ rootConceptId, displayOrder }, ...] }
  updateTreeOrder: async (req, res) => {
    const { tabId, order } = req.body;

    try {
      if (!tabId || !Array.isArray(order)) {
        return res.status(400).json({ error: 'tabId and order array are required' });
      }

      const userId = req.user.userId;

      // Verify tab belongs to user
      const tabCheck = await pool.query(
        'SELECT id FROM saved_tabs WHERE id = $1 AND user_id = $2',
        [tabId, userId]
      );
      if (tabCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tab not found' });
      }

      // Upsert each tree order entry
      for (const item of order) {
        if (item.rootConceptId == null || item.displayOrder == null) continue;

        await pool.query(
          `INSERT INTO saved_tree_order (user_id, saved_tab_id, root_concept_id, display_order, updated_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, saved_tab_id, root_concept_id)
           DO UPDATE SET display_order = $4, updated_at = CURRENT_TIMESTAMP`,
          [userId, tabId, item.rootConceptId, item.displayOrder]
        );
      }

      res.json({ message: 'Tree order updated' });
    } catch (error) {
      console.error('Error updating tree order:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Child Rankings (Phase 5f)
  // Per-user numeric rankings of children when filtering to a
  // single identical vote set. Only the user's own vote set
  // can be ranked; other vote sets show aggregated read-only.
  // ============================================================

  // Get rankings for a specific parent edge + vote set key
  // Returns both the current user's rankings and the aggregated
  // rankings from all users in that vote set.
  // Child Rankings (Phase 5f) — removed in Phase 28b
  getChildRankings: async (req, res) => {
    res.status(410).json({ error: 'Child rankings feature has been removed' });
  },
  updateChildRanking: async (req, res) => {
    res.status(410).json({ error: 'Child rankings feature has been removed' });
  },
  removeChildRanking: async (req, res) => {
    res.status(410).json({ error: 'Child rankings feature has been removed' });
  },

  // ============================================================
  // Web Links (Phase 6)
  // External URLs attached to concepts in specific contexts.
  // Simple upvote system (one vote per user per link).
  // ============================================================

  // Get all web links for an edge (with vote counts and user's vote status)
  getWebLinks: async (req, res) => {
    const { edgeId } = req.params;
    const { sort } = req.query; // 'new' or default ('top')

    try {
      if (!edgeId) {
        return res.status(400).json({ error: 'Edge ID is required' });
      }

      // req.user may be null for guests (optionalAuth)
      const userId = req.user ? req.user.userId : -1;

      const orderClause = sort === 'new'
        ? 'ORDER BY cl.created_at DESC'
        : 'ORDER BY COUNT(clv.id) DESC, cl.created_at DESC';

      const result = await pool.query(
        `SELECT
          cl.id,
          cl.edge_id,
          cl.url,
          cl.title,
          cl.added_by,
          u.username AS added_by_username,
          u.orcid_id AS author_orcid_id,
          cl.created_at,
          cl.comment,
          cl.updated_at,
          COUNT(clv.id) AS vote_count,
          BOOL_OR(clv.user_id = $2) AS user_voted,
          array_agg(DISTINCT clv.user_id) FILTER (WHERE clv.user_id IS NOT NULL) AS voter_user_ids,
          -- IMPORTANT: This visibility filter must match the one in mentionsController.js.
          -- Both filter out mentions whose source's parent link/tunnel is hidden or legal-held.
          -- If you change one, change all four. See Phase 65b-2-fix for the bug that motivated this.
          (SELECT COUNT(*)
           FROM comment_mentions cm
           LEFT JOIN concept_links cl_c2 ON cm.source_type = 'concept_link_comment' AND cm.source_id = cl_c2.id
           LEFT JOIN concept_link_addenda cla_c2 ON cm.source_type = 'concept_link_addendum' AND cm.source_id = cla_c2.id
           LEFT JOIN concept_links cl_p2 ON cl_p2.id = COALESCE(cl_c2.id, cla_c2.concept_link_id)
           LEFT JOIN tunnel_links tl_c2 ON cm.source_type = 'tunnel_link_comment' AND cm.source_id = tl_c2.id
           LEFT JOIN tunnel_link_addenda tla_c2 ON cm.source_type = 'tunnel_link_addendum' AND cm.source_id = tla_c2.id
           LEFT JOIN tunnel_links tl_p2 ON tl_p2.id = COALESCE(tl_c2.id, tla_c2.tunnel_link_id)
           WHERE cm.target_type = 'link' AND cm.target_id = cl.id
             AND (
               (cm.source_type IN ('concept_link_comment', 'concept_link_addendum') AND cl_p2.id IS NOT NULL AND cl_p2.legal_hold = false
                 AND EXISTS (SELECT 1 FROM edges e WHERE e.id = cl_p2.edge_id AND e.is_hidden = false AND e.legal_hold = false))
               OR
               (cm.source_type IN ('tunnel_link_comment', 'tunnel_link_addendum') AND tl_p2.id IS NOT NULL
                 AND EXISTS (SELECT 1 FROM edges e WHERE e.id = tl_p2.origin_edge_id AND e.is_hidden = false AND e.legal_hold = false))
             )
          ) AS mention_count
        FROM concept_links cl
        LEFT JOIN concept_link_votes clv ON clv.concept_link_id = cl.id
        LEFT JOIN users u ON u.id = cl.added_by
        WHERE cl.edge_id = $1
        GROUP BY cl.id, cl.edge_id, cl.url, cl.title, cl.added_by, u.username, u.orcid_id, cl.created_at, cl.comment, cl.updated_at
        ${orderClause}`,
        [edgeId, userId]
      );

      // Fetch addenda for all returned links in one query
      const linkIds = result.rows.map(r => r.id);
      let addendaMap = {};
      if (linkIds.length > 0) {
        const addendaResult = await pool.query(
          `SELECT id, concept_link_id, body, created_at
           FROM concept_link_addenda
           WHERE concept_link_id = ANY($1::integer[])
           ORDER BY created_at ASC`,
          [linkIds]
        );
        for (const row of addendaResult.rows) {
          if (!addendaMap[row.concept_link_id]) addendaMap[row.concept_link_id] = [];
          addendaMap[row.concept_link_id].push({ id: row.id, body: row.body, createdAt: row.created_at });
        }
      }

      res.json({
        webLinks: result.rows.map(row => ({
          id: row.id,
          edgeId: row.edge_id,
          url: row.url,
          title: row.title,
          addedBy: row.added_by,
          addedByUsername: row.added_by_username,
          authorOrcidId: orcidForDisplay(row.author_orcid_id),
          createdAt: row.created_at,
          comment: row.comment,
          updatedAt: row.updated_at,
          voteCount: parseInt(row.vote_count),
          userVoted: row.user_voted || false,
          voterUserIds: row.voter_user_ids || [],
          addenda: addendaMap[row.id] || [],
          mentionCount: parseInt(row.mention_count || 0),
        }))
      });
    } catch (error) {
      console.error('Error fetching web links:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Add a new web link to an edge
  addWebLink: async (req, res) => {
    const { edgeId, url, title, comment } = req.body;

    try {
      if (!edgeId || !url) {
        return res.status(400).json({ error: 'edgeId and url are required' });
      }

      // Basic URL validation
      const trimmedUrl = url.trim();
      if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
        return res.status(400).json({ error: 'URL must start with http:// or https://' });
      }

      if (trimmedUrl.length > 2048) {
        return res.status(400).json({ error: 'URL is too long (max 2048 characters)' });
      }

      const userId = req.user.userId;

      // Verify the edge exists and is not hidden
      const edgeCheck = await pool.query(
        'SELECT id, is_hidden FROM edges WHERE id = $1',
        [edgeId]
      );
      if (edgeCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Edge not found' });
      }
      if (edgeCheck.rows[0].is_hidden) {
        return res.status(400).json({ error: 'Cannot add web links to a hidden concept' });
      }

      // Google Safe Browsing check
      const sbResult = await safeBrowsing.checkUrl(trimmedUrl);
      if (!sbResult.safe) {
        const urlHash = crypto.createHash('sha256').update(trimmedUrl.toLowerCase()).digest('hex');
        await pool.query(
          `INSERT INTO safe_browsing_rejections (attempted_by_user_id, url_hash, threat_types, source)
           VALUES ($1, $2, $3, $4)`,
          [userId, urlHash, sbResult.threats, 'add']
        );
        return res.status(403).json({ error: 'This URL was flagged by Google Safe Browsing and cannot be posted.', code: 'unsafe_url' });
      }

      // If user didn't supply a title, auto-fetch from OG metadata (up to 5s)
      let resolvedTitle = title ? title.trim().substring(0, 255) : null;
      if (!resolvedTitle) {
        const ogTitle = await fetchOgTitle(trimmedUrl);
        resolvedTitle = ogTitle || trimmedUrl.substring(0, 255);
      }
      const trimmedComment = comment ? comment.trim() : null;

      const result = await pool.query(
        `INSERT INTO concept_links (edge_id, url, title, added_by, comment)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, edge_id, url, title, added_by, created_at, comment, updated_at`,
        [edgeId, trimmedUrl, resolvedTitle, userId, trimmedComment]
      );

      // Auto-upvote the link by the person who added it
      await pool.query(
        `INSERT INTO concept_link_votes (user_id, concept_link_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, result.rows[0].id]
      );

      // Parse and store mentions from the comment
      if (trimmedComment) {
        await insertMentions(pool, 'concept_link_comment', result.rows[0].id, trimmedComment);
      }

      res.status(201).json({
        message: 'Web link added',
        webLink: {
          id: result.rows[0].id,
          edgeId: result.rows[0].edge_id,
          url: result.rows[0].url,
          title: result.rows[0].title,
          addedBy: result.rows[0].added_by,
          createdAt: result.rows[0].created_at,
          comment: result.rows[0].comment,
          updatedAt: result.rows[0].updated_at,
          voteCount: 1,
          userVoted: true,
        }
      });
    } catch (error) {
      console.error('Error adding web link:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  copyWebLink: async (req, res) => {
    const { sourceLinkId, destEdgeId } = req.body;

    try {
      if (!sourceLinkId || !destEdgeId) {
        return res.status(400).json({ error: 'sourceLinkId and destEdgeId are required' });
      }

      const userId = req.user.userId;

      // Load source link
      const sourceResult = await pool.query(
        'SELECT id, edge_id, url, title, comment, added_by FROM concept_links WHERE id = $1',
        [sourceLinkId]
      );
      if (sourceResult.rows.length === 0) {
        return res.status(404).json({ error: 'Source link not found' });
      }
      const source = sourceResult.rows[0];

      // Verify ownership
      if (source.added_by !== userId) {
        return res.status(403).json({ error: 'You can only copy links you added' });
      }

      // Load source edge to get its child_id and graph_path[0] (root graph)
      const sourceEdgeResult = await pool.query(
        'SELECT child_id, graph_path FROM edges WHERE id = $1',
        [source.edge_id]
      );
      if (sourceEdgeResult.rows.length === 0) {
        return res.status(404).json({ error: 'Source edge not found' });
      }
      const sourceEdge = sourceEdgeResult.rows[0];

      // Load dest edge and verify it's a descendant in the same graph
      const destEdgeResult = await pool.query(
        'SELECT id, child_id, graph_path FROM edges WHERE id = $1 AND is_hidden = false',
        [destEdgeId]
      );
      if (destEdgeResult.rows.length === 0) {
        return res.status(400).json({ error: 'Destination edge not found or hidden' });
      }
      const destEdge = destEdgeResult.rows[0];

      // Descendant check: dest's graph_path must contain source's child_id
      const destPath = destEdge.graph_path || [];
      if (!destPath.includes(sourceEdge.child_id)) {
        return res.status(400).json({ error: 'Destination must be a descendant of the source concept' });
      }

      // Same root graph check
      const sourceRoot = (sourceEdge.graph_path || []).length > 0 ? sourceEdge.graph_path[0] : sourceEdge.child_id;
      const destRoot = destPath.length > 0 ? destPath[0] : destEdge.child_id;
      if (sourceRoot !== destRoot) {
        return res.status(400).json({ error: 'Destination must be in the same root graph' });
      }

      // Insert the copy
      const result = await pool.query(
        `INSERT INTO concept_links (edge_id, url, title, comment, added_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, edge_id, url, title, comment, added_by, created_at, updated_at`,
        [destEdgeId, source.url, source.title, source.comment, userId]
      );

      // Auto-upvote
      await pool.query(
        `INSERT INTO concept_link_votes (user_id, concept_link_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, result.rows[0].id]
      );

      res.status(201).json({
        message: 'Link copied',
        link: result.rows[0],
      });
    } catch (error) {
      console.error('Error copying web link:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Upvote a web link
  upvoteWebLink: async (req, res) => {
    const { linkId } = req.body;

    try {
      if (!linkId) {
        return res.status(400).json({ error: 'linkId is required' });
      }

      const userId = req.user.userId;

      // Verify the link exists
      const linkCheck = await pool.query(
        'SELECT id FROM concept_links WHERE id = $1',
        [linkId]
      );
      if (linkCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Web link not found' });
      }

      // Insert upvote (ON CONFLICT = already voted)
      const insertResult = await pool.query(
        `INSERT INTO concept_link_votes (user_id, concept_link_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, concept_link_id) DO NOTHING
         RETURNING id`,
        [userId, linkId]
      );

      // Get updated vote count
      const countResult = await pool.query(
        'SELECT COUNT(*) AS vote_count FROM concept_link_votes WHERE concept_link_id = $1',
        [linkId]
      );

      res.json({
        message: insertResult.rows.length > 0 ? 'Upvote added' : 'Already upvoted',
        voteCount: parseInt(countResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error upvoting web link:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all web links for a concept across ALL parent contexts
  // Groups links by parent edge, with parent name/path info
  getAllWebLinksForConcept: async (req, res) => {
    const { conceptId } = req.params;
    const { path: pathParam } = req.query;

    try {
      if (!conceptId) {
        return res.status(400).json({ error: 'Concept ID is required' });
      }

      const userId = req.user ? req.user.userId : -1;

      // Find all edges where this concept is the child (i.e., all parent contexts)
      // For each edge, get its web links with vote counts
      const query = `
        SELECT
          e.id AS edge_id,
          e.parent_id,
          e.graph_path,
          e.attribute_id,
          a.name AS attribute_name,
          cp.name AS parent_name,
          cl.id AS link_id,
          cl.url,
          cl.title,
          cl.added_by,
          u.username AS added_by_username,
          u.orcid_id AS author_orcid_id,
          cl.created_at AS link_created_at,
          cl.comment,
          cl.updated_at AS link_updated_at,
          COUNT(clv.id) AS vote_count,
          BOOL_OR(clv.user_id = $2) AS user_voted
        FROM edges e
        JOIN attributes a ON e.attribute_id = a.id
        LEFT JOIN concepts cp ON e.parent_id = cp.id
        LEFT JOIN concept_links cl ON cl.edge_id = e.id
        LEFT JOIN concept_link_votes clv ON clv.concept_link_id = cl.id
        LEFT JOIN users u ON u.id = cl.added_by
        WHERE e.child_id = $1
        GROUP BY e.id, e.parent_id, e.graph_path, e.attribute_id, a.name,
                 cp.name, cl.id, cl.url, cl.title, cl.added_by, u.username, u.orcid_id, cl.created_at,
                 cl.comment, cl.updated_at
        ORDER BY e.id, COUNT(clv.id) DESC, cl.created_at DESC
      `;

      const result = await pool.query(query, [conceptId, userId]);

      // Group by edge_id
      const edgeMap = {};
      const edgeOrder = [];

      for (const row of result.rows) {
        if (!edgeMap[row.edge_id]) {
          edgeMap[row.edge_id] = {
            edgeId: row.edge_id,
            parentId: row.parent_id,
            parentName: row.parent_name || '(root)',
            graphPath: row.graph_path || [],
            attributeId: row.attribute_id,
            attributeName: row.attribute_name,
            links: [],
          };
          edgeOrder.push(row.edge_id);
        }
        // Only add a link entry if there's actually a link (cl.id is not null)
        if (row.link_id) {
          edgeMap[row.edge_id].links.push({
            id: row.link_id,
            url: row.url,
            title: row.title,
            addedBy: row.added_by,
            addedByUsername: row.added_by_username,
            authorOrcidId: orcidForDisplay(row.author_orcid_id),
            createdAt: row.link_created_at,
            comment: row.comment,
            updatedAt: row.link_updated_at,
            voteCount: parseInt(row.vote_count),
            userVoted: row.user_voted || false,
          });
        }
      }

      // Batch-fetch addenda for all link IDs across all edges
      const allLinkIds = [];
      for (const eid of edgeOrder) {
        for (const link of edgeMap[eid].links) {
          allLinkIds.push(link.id);
        }
      }
      if (allLinkIds.length > 0) {
        const addendaResult = await pool.query(
          `SELECT id, concept_link_id, body, created_at
           FROM concept_link_addenda
           WHERE concept_link_id = ANY($1::integer[])
           ORDER BY created_at ASC`,
          [allLinkIds]
        );
        const addendaMap = {};
        for (const row of addendaResult.rows) {
          if (!addendaMap[row.concept_link_id]) addendaMap[row.concept_link_id] = [];
          addendaMap[row.concept_link_id].push({ id: row.id, body: row.body, createdAt: row.created_at });
        }
        for (const eid of edgeOrder) {
          for (const link of edgeMap[eid].links) {
            link.addenda = addendaMap[link.id] || [];
          }
        }
      }

      // Determine which edge is the "current context" based on the path param
      let currentEdgeId = null;
      if (pathParam) {
        const pathArray = pathParam.split(',').map(Number).filter(Boolean);
        // The current edge connects the last concept in the path to conceptId
        if (pathArray.length > 0) {
          const parentId = pathArray[pathArray.length - 1];
          // Find matching edge
          for (const eid of edgeOrder) {
            const e = edgeMap[eid];
            if (e.parentId === parentId && 
                JSON.stringify(e.graphPath) === JSON.stringify(pathArray)) {
              currentEdgeId = eid;
              break;
            }
          }
        } else {
          // Root concept: find edge with parent_id IS NULL
          for (const eid of edgeOrder) {
            const e = edgeMap[eid];
            if (e.parentId === null) {
              currentEdgeId = eid;
              break;
            }
          }
        }
      }

      // Build response: current context first, then others sorted by total link votes desc
      const groups = edgeOrder.map(eid => edgeMap[eid]);
      
      // Sort: current context first, then by total link count desc
      groups.sort((a, b) => {
        if (a.edgeId === currentEdgeId) return -1;
        if (b.edgeId === currentEdgeId) return 1;
        const aTotal = a.links.reduce((sum, l) => sum + l.voteCount, 0);
        const bTotal = b.links.reduce((sum, l) => sum + l.voteCount, 0);
        if (bTotal !== aTotal) return bTotal - aTotal;
        return b.links.length - a.links.length;
      });

      // Collect concept IDs from graph paths for name resolution
      const pathConceptIds = new Set();
      groups.forEach(g => {
        (g.graphPath || []).forEach(id => pathConceptIds.add(id));
        if (g.parentId) pathConceptIds.add(g.parentId);
      });

      let conceptNames = {};
      if (pathConceptIds.size > 0) {
        const namesResult = await pool.query(
          'SELECT id, name FROM concepts WHERE id = ANY($1::integer[])',
          [Array.from(pathConceptIds)]
        );
        namesResult.rows.forEach(row => {
          conceptNames[row.id] = row.name;
        });
      }

      res.json({
        groups,
        currentEdgeId,
        conceptNames,
      });
    } catch (error) {
      console.error('Error fetching all web links for concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove upvote from a web link
  removeWebLinkVote: async (req, res) => {
    const { linkId } = req.body;

    try {
      if (!linkId) {
        return res.status(400).json({ error: 'linkId is required' });
      }

      const userId = req.user.userId;

      const deleteResult = await pool.query(
        `DELETE FROM concept_link_votes 
         WHERE user_id = $1 AND concept_link_id = $2
         RETURNING id`,
        [userId, linkId]
      );

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Upvote not found' });
      }

      // Get updated vote count
      const countResult = await pool.query(
        'SELECT COUNT(*) AS vote_count FROM concept_link_votes WHERE concept_link_id = $1',
        [linkId]
      );

      res.json({
        message: 'Upvote removed',
        voteCount: parseInt(countResult.rows[0].vote_count)
      });
    } catch (error) {
      console.error('Error removing web link upvote:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Update comment on a web link (creator only)
  // POST /api/votes/web-links/:linkId/addenda — add an addendum to a concept link
  addConceptLinkAddendum: async (req, res) => {
    const { linkId } = req.params;
    const { body } = req.body;

    try {
      if (!linkId) {
        return res.status(400).json({ error: 'linkId is required' });
      }

      const trimmedBody = body ? String(body).trim() : '';
      if (!trimmedBody) {
        return res.status(400).json({ error: 'body is required' });
      }
      if (trimmedBody.length > 2000) {
        return res.status(400).json({ error: 'Addendum body must be 2000 characters or fewer' });
      }

      const userId = req.user.userId;

      // Atomic permission check: added_by must match and legal_hold must be false
      const linkCheck = await pool.query(
        'SELECT id, added_by, legal_hold FROM concept_links WHERE id = $1',
        [linkId]
      );
      if (linkCheck.rows.length === 0 || linkCheck.rows[0].added_by !== userId || linkCheck.rows[0].legal_hold) {
        return res.status(403).json({ error: 'Cannot add an addendum to this link.' });
      }

      const result = await pool.query(
        `INSERT INTO concept_link_addenda (concept_link_id, author_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, body, created_at, author_id`,
        [linkId, userId, trimmedBody]
      );

      // Parse and store mentions from the addendum body
      await insertMentions(pool, 'concept_link_addendum', result.rows[0].id, trimmedBody);

      res.json({ addendum: result.rows[0] });
    } catch (error) {
      console.error('Error adding concept link addendum:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Search concept_links by URL across the entire graph (Phase 58b-2)
  // Returns all links matching the given URL with concept/edge context for navigation
  getWebLinksByUrl: async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || !url.trim()) {
        return res.status(400).json({ error: 'url query parameter is required' });
      }

      const trimmedUrl = url.trim();
      if (!/^https?:\/\/.+/i.test(trimmedUrl)) {
        return res.status(400).json({ error: 'URL must start with http:// or https://' });
      }
      if (trimmedUrl.length > 2048) {
        return res.status(400).json({ error: 'URL is too long (max 2048 characters)' });
      }

      const result = await pool.query(
        `SELECT
          cl.id,
          cl.edge_id,
          e.child_id AS concept_id,
          child_c.name AS concept_name,
          e.parent_id AS parent_concept_id,
          parent_c.name AS parent_concept_name,
          e.graph_path,
          a.name AS attribute_name,
          cl.title,
          cl.comment,
          cl.added_by,
          u.username AS added_by_username,
          cl.created_at,
          COUNT(clv.id)::int AS vote_count
        FROM concept_links cl
        JOIN edges e ON e.id = cl.edge_id
        JOIN concepts child_c ON child_c.id = e.child_id
        LEFT JOIN concepts parent_c ON parent_c.id = e.parent_id
        JOIN attributes a ON a.id = e.attribute_id
        LEFT JOIN users u ON u.id = cl.added_by
        LEFT JOIN concept_link_votes clv ON clv.concept_link_id = cl.id
        WHERE cl.url = $1
          AND e.is_hidden = false
        GROUP BY cl.id, cl.edge_id, e.child_id, child_c.name,
                 e.parent_id, parent_c.name, e.graph_path, a.name,
                 cl.title, cl.comment, cl.added_by, u.username, cl.created_at
        ORDER BY COUNT(clv.id) DESC, cl.created_at DESC
        LIMIT 200`,
        [trimmedUrl]
      );

      // Resolve graph_path concept names for path display
      const allPathIds = new Set();
      result.rows.forEach(r => {
        if (r.graph_path) r.graph_path.forEach(id => allPathIds.add(id));
      });
      let pathNames = {};
      if (allPathIds.size > 0) {
        const namesRes = await pool.query(
          'SELECT id, name FROM concepts WHERE id = ANY($1::integer[])',
          [Array.from(allPathIds)]
        );
        namesRes.rows.forEach(r => { pathNames[r.id] = r.name; });
      }

      res.json({ links: result.rows, pathNames });
    } catch (error) {
      console.error('Error fetching web links by URL:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 58d-2: Get all concept_links the authenticated user has upvoted
  getMyLinkVotes: async (req, res) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query(
        `SELECT
          cl.id, cl.edge_id, cl.url, cl.title, cl.comment,
          cl.added_by, u.username AS added_by_username,
          cl.created_at,
          e.child_id AS concept_id, child_c.name AS concept_name,
          e.parent_id AS parent_concept_id, parent_c.name AS parent_concept_name,
          e.graph_path, a.name AS attribute_name,
          COUNT(clv_all.id)::int AS vote_count,
          clv_user.created_at AS voted_at
        FROM concept_link_votes clv_user
        JOIN concept_links cl ON cl.id = clv_user.concept_link_id
        JOIN edges e ON e.id = cl.edge_id
        JOIN concepts child_c ON child_c.id = e.child_id
        LEFT JOIN concepts parent_c ON parent_c.id = e.parent_id
        JOIN attributes a ON a.id = e.attribute_id
        LEFT JOIN users u ON u.id = cl.added_by
        LEFT JOIN concept_link_votes clv_all ON clv_all.concept_link_id = cl.id
        WHERE clv_user.user_id = $1
          AND e.is_hidden = false
        GROUP BY cl.id, cl.edge_id, cl.url, cl.title, cl.comment,
                 cl.added_by, u.username, cl.created_at,
                 e.child_id, child_c.name, e.parent_id, parent_c.name,
                 e.graph_path, a.name, clv_user.created_at
        ORDER BY clv_user.created_at DESC
        LIMIT 500`,
        [userId]
      );

      // Resolve graph_path names
      const allPathIds = new Set();
      result.rows.forEach(r => { if (r.graph_path) r.graph_path.forEach(id => allPathIds.add(id)); });
      let pathNames = {};
      if (allPathIds.size > 0) {
        const namesRes = await pool.query('SELECT id, name FROM concepts WHERE id = ANY($1::integer[])', [Array.from(allPathIds)]);
        namesRes.rows.forEach(r => { pathNames[r.id] = r.name; });
      }

      res.json({ links: result.rows, pathNames });
    } catch (error) {
      console.error('Error fetching user link votes:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Close (delete) a graph tab
  closeGraphTab: async (req, res) => {
    const { tabId } = req.body;

    try {
      if (!tabId) {
        return res.status(400).json({ error: 'tabId is required' });
      }

      const userId = req.user.userId;

      const result = await pool.query(
        'DELETE FROM graph_tabs WHERE id = $1 AND user_id = $2 RETURNING id',
        [tabId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Graph tab not found' });
      }

      // Remove from sidebar_items
      await pool.query(
        `DELETE FROM sidebar_items WHERE user_id = $1 AND item_type = 'graph_tab' AND item_id = $2`,
        [userId, tabId]
      );

      res.json({ message: 'Graph tab closed' });
    } catch (error) {
      console.error('Error closing graph tab:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 8 (retired): Tab activity / dormancy endpoints return 410 Gone
  recordTabActivity: async (req, res) => {
    res.status(410).json({ error: 'Dormancy tracking has been retired' });
  },

  getTabActivity: async (req, res) => {
    res.status(410).json({ error: 'Dormancy tracking has been retired' });
  },

  reviveTabActivity: async (req, res) => {
    res.status(410).json({ error: 'Dormancy tracking has been retired' });
  },

  // ============================================================
  // Phase 19b: Unified Sidebar Items
  // ============================================================

  // Get the ordered sidebar items for the current user.
  // Returns the unified list of corpus, group, and graph_tab entries
  // sorted by display_order. The frontend joins these IDs against its
  // already-loaded corpusTabs, tabGroups, and graphTabs state.
  getSidebarItems: async (req, res) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query(
        `SELECT id, item_type, item_id, display_order
         FROM sidebar_items
         WHERE user_id = $1
         ORDER BY display_order ASC`,
        [userId]
      );
      res.json({ items: result.rows });
    } catch (error) {
      console.error('Error getting sidebar items:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Reorder sidebar items by updating their display_order values.
  // Body: { items: [{ id, display_order }, ...] }
  reorderSidebarItems: async (req, res) => {
    const { items } = req.body;
    try {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items array is required' });
      }
      const userId = req.user.userId;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const item of items) {
          if (!item.id || item.display_order === undefined) continue;
          await client.query(
            'UPDATE sidebar_items SET display_order = $1 WHERE id = $2 AND user_id = $3',
            [item.display_order, item.id, userId]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      res.json({ message: 'Sidebar reordered' });
    } catch (error) {
      console.error('Error reordering sidebar items:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 23b (retired): Vote set drift returns 410 Gone
  getVoteSetDrift: async (req, res) => {
    res.status(410).json({ error: 'Vote set drift has been retired' });
  },

  // Phase 59b: Unified votes endpoint — savedEdges + linkVotes + contextEdges + ancestorEdges
  // AD: Votes pages are display-only. No remove affordance. Click-to-navigate only.
  // AD: Link-voted edges without a save vote appear with full ancestry as context rows.
  getAllVotes: async (req, res) => {
    try {
      const userId = req.user.userId;

      // 1. Saved edges (same query as getUserSaves, no tab filter)
      const savedResult = await pool.query(
        `SELECT
          e.id AS edge_id, e.parent_id, e.child_id, e.graph_path,
          e.created_at AS edge_created_at,
          c.name AS child_name, a.id AS attribute_id, a.name AS attribute_name,
          COUNT(DISTINCT all_v.user_id) AS vote_count,
          (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) AS swap_count
        FROM votes v
        JOIN edges e ON v.edge_id = e.id
        JOIN concepts c ON e.child_id = c.id
        JOIN attributes a ON e.attribute_id = a.id
        LEFT JOIN votes all_v ON all_v.edge_id = e.id
        WHERE v.user_id = $1
        GROUP BY e.id, e.parent_id, e.child_id, e.graph_path, e.created_at,
                 c.name, a.id, a.name
        ORDER BY e.graph_path, c.name`,
        [userId]
      );

      const savedEdges = savedResult.rows.map(row => ({
        edgeId: row.edge_id,
        parentId: row.parent_id,
        childId: row.child_id,
        childName: row.child_name,
        graphPath: row.graph_path || [],
        attributeId: row.attribute_id,
        attributeName: row.attribute_name,
        voteCount: parseInt(row.vote_count),
        swapCount: parseInt(row.swap_count),
        isContextOnly: false,
      }));

      // 2. Link votes (same query as getMyLinkVotes)
      const linkResult = await pool.query(
        `SELECT
          cl.id AS concept_link_id, cl.edge_id, cl.url, cl.title, cl.comment,
          cl.added_by, u.username AS added_by_username, cl.created_at,
          e.child_id AS concept_id, child_c.name AS concept_name,
          e.parent_id, e.graph_path, e.attribute_id,
          a.name AS attribute_name,
          COUNT(clv_all.id)::int AS vote_count
        FROM concept_link_votes clv_user
        JOIN concept_links cl ON cl.id = clv_user.concept_link_id
        JOIN edges e ON e.id = cl.edge_id
        JOIN concepts child_c ON child_c.id = e.child_id
        JOIN attributes a ON a.id = e.attribute_id
        LEFT JOIN users u ON u.id = cl.added_by
        LEFT JOIN concept_link_votes clv_all ON clv_all.concept_link_id = cl.id
        WHERE clv_user.user_id = $1 AND e.is_hidden = false
        GROUP BY cl.id, cl.edge_id, cl.url, cl.title, cl.comment,
                 cl.added_by, u.username, cl.created_at,
                 e.child_id, child_c.name, e.parent_id, e.graph_path,
                 e.attribute_id, a.name
        ORDER BY cl.created_at DESC
        LIMIT 500`,
        [userId]
      );

      const linkVotes = linkResult.rows.map(row => ({
        conceptLinkId: row.concept_link_id,
        edgeId: row.edge_id,
        url: row.url,
        title: row.title,
        comment: row.comment,
        addedBy: row.added_by,
        addedByUsername: row.added_by_username,
        createdAt: row.created_at,
        edgeConceptId: row.concept_id,
        edgeConceptName: row.concept_name,
        edgePath: row.graph_path || [],
        edgeParentId: row.parent_id,
        edgeAttributeId: row.attribute_id,
        edgeAttributeName: row.attribute_name,
        voteCount: row.vote_count,
      }));

      // 3. Context edges — edges referenced by linkVotes not in savedEdges
      const savedEdgeIds = new Set(savedEdges.map(e => e.edgeId));
      const contextEdgeIds = new Set();
      for (const lv of linkVotes) {
        if (!savedEdgeIds.has(lv.edgeId)) contextEdgeIds.add(lv.edgeId);
      }

      let contextEdges = [];
      if (contextEdgeIds.size > 0) {
        const ctxResult = await pool.query(
          `SELECT
            e.id AS edge_id, e.parent_id, e.child_id, e.graph_path,
            e.created_at AS edge_created_at,
            c.name AS child_name, a.id AS attribute_id, a.name AS attribute_name,
            COUNT(DISTINCT all_v.user_id) AS vote_count,
            (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) AS swap_count
          FROM edges e
          JOIN concepts c ON e.child_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes all_v ON all_v.edge_id = e.id
          WHERE e.id = ANY($1::integer[])
          GROUP BY e.id, e.parent_id, e.child_id, e.graph_path, e.created_at,
                   c.name, a.id, a.name`,
          [Array.from(contextEdgeIds)]
        );
        contextEdges = ctxResult.rows.map(row => ({
          edgeId: row.edge_id,
          parentId: row.parent_id,
          childId: row.child_id,
          childName: row.child_name,
          graphPath: row.graph_path || [],
          attributeId: row.attribute_id,
          attributeName: row.attribute_name,
          voteCount: parseInt(row.vote_count),
          swapCount: parseInt(row.swap_count),
          isContextOnly: true,
        }));
      }

      // 4. Ancestor edges — walk up the graph_path of all saved + context edges
      //    to fill in tree scaffolding the user doesn't directly have.
      //    Use a single batch query: collect all (parent_id, child_id, graph_path)
      //    combos from graph_path arrays and fetch them in one query.
      const allEdges = [...savedEdges, ...contextEdges];
      const allEdgeKeys = new Set(allEdges.map(e =>
        `${e.parentId}|${e.childId}|${JSON.stringify(e.graphPath)}`
      ));

      // For each edge, its graph_path = [root, ..., parent].
      // The ancestor chain is: root edge (parent_id=NULL, graph_path='{}'),
      // then each subsequent child with graph_path = prefix up to that point.
      // We need edges where child_id = graph_path[i] and graph_path = graph_path.slice(0, i)
      // with parent_id = graph_path[i-1] (or NULL for root).
      // Collect the needed ancestor concept IDs from all graph paths.
      const neededAncestorLookups = []; // [{childId, parentId, graphPath}]
      for (const edge of allEdges) {
        const gp = edge.graphPath;
        for (let i = 0; i < gp.length; i++) {
          const ancestorChildId = gp[i];
          const ancestorParentId = i === 0 ? null : gp[i - 1];
          const ancestorGraphPath = gp.slice(0, i);
          const key = `${ancestorParentId}|${ancestorChildId}|${JSON.stringify(ancestorGraphPath)}`;
          if (!allEdgeKeys.has(key)) {
            allEdgeKeys.add(key);
            neededAncestorLookups.push({ childId: ancestorChildId, parentId: ancestorParentId, graphPath: ancestorGraphPath });
          }
        }
      }

      let ancestorEdges = [];
      if (neededAncestorLookups.length > 0) {
        // Batch fetch: find edges matching any of these (child_id, parent_id, graph_path) combos
        // Build a WHERE clause with OR conditions grouped by graph_path length for efficiency
        const ancestorChildIds = [...new Set(neededAncestorLookups.map(a => a.childId))];
        const ancestorResult = await pool.query(
          `SELECT
            e.id AS edge_id, e.parent_id, e.child_id, e.graph_path,
            e.created_at AS edge_created_at,
            c.name AS child_name, a.id AS attribute_id, a.name AS attribute_name,
            COUNT(DISTINCT all_v.user_id) AS vote_count,
            (SELECT COUNT(DISTINCT rv.user_id) FROM replace_votes rv WHERE rv.edge_id = e.id) AS swap_count
          FROM edges e
          JOIN concepts c ON e.child_id = c.id
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes all_v ON all_v.edge_id = e.id
          WHERE e.child_id = ANY($1::integer[]) AND e.is_hidden = false
          GROUP BY e.id, e.parent_id, e.child_id, e.graph_path, e.created_at,
                   c.name, a.id, a.name`,
          [ancestorChildIds]
        );

        // Filter to only the specific (child_id, parent_id, graph_path) combos we need
        const lookupKeys = new Set(neededAncestorLookups.map(a =>
          `${a.parentId}|${a.childId}|${JSON.stringify(a.graphPath)}`
        ));
        ancestorEdges = ancestorResult.rows
          .filter(row => {
            const key = `${row.parent_id}|${row.child_id}|${JSON.stringify(row.graph_path || [])}`;
            return lookupKeys.has(key);
          })
          .map(row => ({
            edgeId: row.edge_id,
            parentId: row.parent_id,
            childId: row.child_id,
            childName: row.child_name,
            graphPath: row.graph_path || [],
            attributeId: row.attribute_id,
            attributeName: row.attribute_name,
            voteCount: parseInt(row.vote_count),
            swapCount: parseInt(row.swap_count),
            isContextOnly: true,
          }));
      }

      // 5. Concept names for path display
      const conceptIds = new Set();
      for (const e of [...savedEdges, ...contextEdges, ...ancestorEdges]) {
        (e.graphPath || []).forEach(id => conceptIds.add(id));
        if (e.parentId) conceptIds.add(e.parentId);
        conceptIds.add(e.childId);
      }
      let conceptNames = {};
      if (conceptIds.size > 0) {
        const namesResult = await pool.query(
          'SELECT id, name FROM concepts WHERE id = ANY($1::integer[])',
          [Array.from(conceptIds)]
        );
        namesResult.rows.forEach(row => { conceptNames[row.id] = row.name; });
      }

      res.json({ savedEdges, linkVotes, contextEdges, ancestorEdges, conceptNames });
    } catch (error) {
      console.error('Error fetching all votes:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 60a: Hard delete a self-authored link
  removeWebLink: async (req, res) => {
    const { linkId } = req.body;
    const userId = req.user.userId;

    if (!linkId) {
      return res.status(400).json({ error: 'linkId is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Clean up mention rows for this link's comment and addenda
      // (no FK cascade since comment_mentions has no FK by design)
      await client.query(
        `DELETE FROM comment_mentions
         WHERE (source_type = 'concept_link_comment' AND source_id = $1)
            OR (source_type = 'concept_link_addendum' AND source_id IN
                (SELECT id FROM concept_link_addenda WHERE concept_link_id = $1))`,
        [linkId]
      );

      const result = await client.query(
        `DELETE FROM concept_links
         WHERE id = $1 AND added_by = $2 AND legal_hold = false
         RETURNING id, edge_id, url, added_by`,
        [linkId, userId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Cannot remove this link' });
      }

      const deleted = result.rows[0];
      const urlHash = crypto.createHash('sha256').update(deleted.url.toLowerCase()).digest('hex');

      await client.query(
        `INSERT INTO link_removal_log (removed_link_id, removed_by_user_id, original_edge_id, original_url_hash)
         VALUES ($1, $2, $3, $4)`,
        [deleted.id, userId, deleted.edge_id, urlHash]
      );

      await client.query('COMMIT');

      res.json({ success: true, removedLinkId: deleted.id });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error removing web link:', error);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  },

  // Phase 60a: Preview OG title for a URL
  previewTitle: async (req, res) => {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'url query parameter is required' });
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'URL must use http or https protocol' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Google Safe Browsing check
    const sbResult = await safeBrowsing.checkUrl(url);
    if (!sbResult.safe) {
      const urlHash = crypto.createHash('sha256').update(url.toLowerCase()).digest('hex');
      await pool.query(
        `INSERT INTO safe_browsing_rejections (attempted_by_user_id, url_hash, threat_types, source)
         VALUES ($1, $2, $3, $4)`,
        [req.user.userId, urlHash, sbResult.threats, 'preview']
      );
      return res.status(403).json({ error: 'This URL was flagged by Google Safe Browsing and cannot be posted.', code: 'unsafe_url' });
    }

    try {
      const title = await fetchOgTitle(url);
      res.json({ title: title || '' });
    } catch {
      res.status(502).json({ error: 'fetch_failed' });
    }
  },

  // GET /api/votes/web-links/:linkId/location — resolve a link ID to its concept + path
  getWebLinkLocation: async (req, res) => {
    const linkId = parseInt(req.params.linkId, 10);
    if (!Number.isFinite(linkId)) return res.status(404).json({ error: 'Not found' });

    try {
      const result = await pool.query(
        `SELECT cl.id AS link_id, cl.edge_id, e.child_id AS concept_id, e.graph_path
         FROM concept_links cl
         JOIN edges e ON cl.edge_id = e.id
         WHERE cl.id = $1
           AND cl.legal_hold = false
           AND e.legal_hold = false
           AND e.is_hidden = false`,
        [linkId]
      );

      if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });

      const row = result.rows[0];
      return res.json({
        linkId: row.link_id,
        edgeId: row.edge_id,
        conceptId: row.concept_id,
        parentPath: row.graph_path
      });
    } catch (err) {
      console.error('getWebLinkLocation error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },

};

module.exports = votesController;
