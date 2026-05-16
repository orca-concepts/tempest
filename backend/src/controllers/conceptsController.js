const pool = require('../config/database');

const conceptsController = {
  // Get all root concepts (concepts with no parents)
  getRootConcepts: async (req, res) => {
    try {
      const { sort } = req.query; // 'new' or default (saves)

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
          (SELECT COUNT(*) > 0 FROM concept_flags cf WHERE cf.edge_id = root_e.id AND cf.user_id = $1) as user_flagged
        FROM concepts c
        LEFT JOIN edges child_e ON c.id = child_e.parent_id AND child_e.is_hidden = false
        LEFT JOIN edges root_e ON root_e.child_id = c.id AND root_e.parent_id IS NULL AND root_e.graph_path = '{}' AND root_e.is_hidden = false
        LEFT JOIN attributes a ON root_e.attribute_id = a.id
        LEFT JOIN votes v ON root_e.id = v.edge_id
        WHERE root_e.id IS NOT NULL
        GROUP BY c.id, c.name, c.created_at, root_e.id, root_e.created_at, a.id, a.name
        ${orderClause};
      `;

      const result = await pool.query(query, [req.user ? req.user.userId : -1]);

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
          (SELECT COUNT(*) > 0 FROM concept_flags cf WHERE cf.edge_id = e.id AND cf.user_id = $2) as user_flagged
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

      let currentEdgeVoteCount = null;
      let currentAttribute = null;
      if (graphPath.length >= 2) {
        const parentId = graphPath[graphPath.length - 2];
        const parentPath = graphPath.slice(0, -1);

        const edgeVoteQuery = `
          SELECT COUNT(DISTINCT v.id) as vote_count, a.id as attribute_id, a.name as attribute_name
          FROM edges e
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id
          WHERE e.parent_id = $1 AND e.child_id = $2 AND e.graph_path = $3
          GROUP BY a.id, a.name
        `;

        const edgeVoteResult = await pool.query(edgeVoteQuery, [parentId, id, parentPath]);
        if (edgeVoteResult.rows.length > 0) {
          currentEdgeVoteCount = parseInt(edgeVoteResult.rows[0].vote_count || 0);
          currentAttribute = {
            id: edgeVoteResult.rows[0].attribute_id,
            name: edgeVoteResult.rows[0].attribute_name
          };
        }
      } else if (graphPath.length === 1) {
        const edgeVoteQuery = `
          SELECT COUNT(DISTINCT v.id) as vote_count, a.id as attribute_id, a.name as attribute_name
          FROM edges e
          JOIN attributes a ON e.attribute_id = a.id
          LEFT JOIN votes v ON e.id = v.edge_id
          WHERE e.parent_id IS NULL AND e.child_id = $1 AND e.graph_path = '{}'
          GROUP BY a.id, a.name
        `;

        const edgeVoteResult = await pool.query(edgeVoteQuery, [id]);
        if (edgeVoteResult.rows.length > 0) {
          currentEdgeVoteCount = parseInt(edgeVoteResult.rows[0].vote_count || 0);
          currentAttribute = {
            id: edgeVoteResult.rows[0].attribute_id,
            name: edgeVoteResult.rows[0].attribute_name
          };
        }
      }

      res.json({
        concept,
        path: graphPath,
        children: childrenResult.rows,
        currentEdgeVoteCount,
        currentAttribute
      });
    } catch (error) {
      console.error('Error fetching concept:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all parent contexts for a concept (for flip view)
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
    const { q, parentId, path, attributeId } = req.query;

    try {
      if (!q || q.trim().length === 0) {
        return res.json({ results: [] });
      }

      const searchTerm = q.trim();

      const attrFilter = attributeId
        ? `AND EXISTS (SELECT 1 FROM edges e_attr WHERE e_attr.child_id = c.id AND e_attr.attribute_id = ${parseInt(attributeId)} AND e_attr.is_hidden = false)`
        : '';

      const searchQuery = `
        WITH exact_matches AS (
          SELECT c.id, c.name, 1 as match_type,
            CASE
              WHEN LOWER(c.name) = LOWER($1) THEN 1.0
              ELSE 0.9
            END as relevance
          FROM concepts c
          WHERE LOWER(c.name) LIKE LOWER($1) || '%'
          ${attrFilter}
          LIMIT 10
        ),
        similar_matches AS (
          SELECT c.id, c.name, 2 as match_type,
            similarity(c.name, $1) as relevance
          FROM concepts c
          WHERE similarity(c.name, $1) > 0.15
            AND c.id NOT IN (SELECT id FROM exact_matches)
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

      const result = await pool.query(searchQuery, [searchTerm]);

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

      const attrResult = await pool.query('SELECT id FROM attributes WHERE id = $1', [attributeId]);
      if (attrResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid attribute on root edge' });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        let conceptResult = await client.query(
          'SELECT * FROM concepts WHERE LOWER(name) = LOWER($1)',
          [name]
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
            'INSERT INTO concepts (name, created_by) VALUES ($1, $2) RETURNING *',
            [name, req.user.userId]
          );
          conceptId = conceptResult.rows[0].id;
        }

        const existingEdge = await client.query(
          'SELECT * FROM edges WHERE parent_id = $1 AND child_id = $2 AND graph_path = $3 AND attribute_id = $4',
          [parentId, conceptId, graphPath, attributeId]
        );

        if (existingEdge.rows.length > 0) {
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
    const { name, attributeId } = req.body;

    try {
      if (!name || !attributeId) {
        return res.status(400).json({ error: 'Name and attributeId are required' });
      }

      if (name.length > 255) {
        return res.status(400).json({ error: 'Concept name must be 255 characters or fewer' });
      }

      const attrResult = await pool.query('SELECT id FROM attributes WHERE id = $1', [attributeId]);
      if (attrResult.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid attribute' });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const existingConcept = await client.query(
          'SELECT id, name FROM concepts WHERE LOWER(name) = LOWER($1)',
          [name]
        );

        let conceptId;
        let conceptRow;

        if (existingConcept.rows.length > 0) {
          conceptId = existingConcept.rows[0].id;
          conceptRow = existingConcept.rows[0];

          const existingRootEdge = await client.query(
            'SELECT id FROM edges WHERE parent_id IS NULL AND child_id = $1 AND attribute_id = $2',
            [conceptId, attributeId]
          );
          if (existingRootEdge.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: 'A root concept with this name and attribute already exists'
            });
          }
        } else {
          const result = await client.query(
            'INSERT INTO concepts (name, created_by) VALUES ($1, $2) RETURNING *',
            [name, req.user.userId]
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

      const VOTE_SET_THRESHOLD = 10;
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
};

module.exports = conceptsController;
