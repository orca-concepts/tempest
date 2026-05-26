const pool = require('../config/database');

const VALID_TARGET_TYPES = ['concept', 'superconcept', 'link', 'tunnel'];

const mentionsController = {
  // GET /api/mentions/:targetType/:targetId?path=...&limit=20&offset=0
  getMentions: async (req, res) => {
    try {
      const { targetType, targetId: targetIdStr } = req.params;

      if (!VALID_TARGET_TYPES.includes(targetType)) {
        return res.status(400).json({ error: 'Invalid targetType. Must be one of: concept, superconcept, link, tunnel' });
      }

      const targetId = parseInt(targetIdStr, 10);
      if (!Number.isFinite(targetId) || targetId <= 0) {
        return res.status(400).json({ error: 'targetId must be a positive integer' });
      }

      // For concept targets, path is required (empty = root concept)
      let targetPath = null;
      if (targetType === 'concept') {
        const pathStr = req.query.path;
        if (pathStr === null || pathStr === undefined) {
          return res.status(400).json({ error: 'path query parameter is required for concept mentions' });
        }
        targetPath = pathStr === '' ? [] : pathStr.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0);
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const pathParam = targetPath ? `{${targetPath.join(',')}}` : null;

      // Count query
      const countResult = await pool.query(
        `SELECT COUNT(*) AS total
         FROM comment_mentions cm
         LEFT JOIN concept_links cl_c ON cm.source_type = 'concept_link_comment' AND cm.source_id = cl_c.id
         LEFT JOIN concept_link_addenda cla_c ON cm.source_type = 'concept_link_addendum' AND cm.source_id = cla_c.id
         LEFT JOIN concept_links cl_p ON cl_p.id = COALESCE(cl_c.id, cla_c.concept_link_id)
         LEFT JOIN tunnel_links tl_c ON cm.source_type = 'tunnel_link_comment' AND cm.source_id = tl_c.id
         LEFT JOIN tunnel_link_addenda tla_c ON cm.source_type = 'tunnel_link_addendum' AND cm.source_id = tla_c.id
         LEFT JOIN tunnel_links tl_p ON tl_p.id = COALESCE(tl_c.id, tla_c.tunnel_link_id)
         WHERE cm.target_type = $1
           AND cm.target_id = $2
           AND ($3::int[] IS NULL OR cm.target_path = $3::int[])
           AND (
             (cm.source_type IN ('concept_link_comment', 'concept_link_addendum') AND cl_p.id IS NOT NULL AND cl_p.legal_hold = false
               AND EXISTS (SELECT 1 FROM edges e WHERE e.id = cl_p.edge_id AND e.is_hidden = false AND e.legal_hold = false))
             OR
             (cm.source_type IN ('tunnel_link_comment', 'tunnel_link_addendum') AND tl_p.id IS NOT NULL
               AND EXISTS (SELECT 1 FROM edges e WHERE e.id = tl_p.origin_edge_id AND e.is_hidden = false AND e.legal_hold = false))
           )`,
        [targetType, targetId, pathParam]
      );

      const totalCount = parseInt(countResult.rows[0].total, 10);

      // Data query
      const dataResult = await pool.query(
        `SELECT
          cm.id AS mention_id,
          cm.source_type,
          cm.source_id,
          cm.created_at AS mention_created_at,
          COALESCE(cl_c.comment, cla_c.body, tl_c.comment, tla_c.body) AS source_text,
          COALESCE(cl_c.added_by, cla_c.author_id, tl_c.created_by, tla_c.author_id) AS source_author_id,
          u.username AS source_author_username,
          u.orcid_id AS source_author_orcid_id,
          COALESCE(cl_c.id, cla_c.concept_link_id, tl_c.id, tla_c.tunnel_link_id) AS source_parent_id,
          COALESCE(cl_p.title, NULL) AS source_parent_title
        FROM comment_mentions cm
        LEFT JOIN concept_links cl_c ON cm.source_type = 'concept_link_comment' AND cm.source_id = cl_c.id
        LEFT JOIN concept_link_addenda cla_c ON cm.source_type = 'concept_link_addendum' AND cm.source_id = cla_c.id
        LEFT JOIN concept_links cl_p ON cl_p.id = COALESCE(cl_c.id, cla_c.concept_link_id)
        LEFT JOIN tunnel_links tl_c ON cm.source_type = 'tunnel_link_comment' AND cm.source_id = tl_c.id
        LEFT JOIN tunnel_link_addenda tla_c ON cm.source_type = 'tunnel_link_addendum' AND cm.source_id = tla_c.id
        LEFT JOIN tunnel_links tl_p ON tl_p.id = COALESCE(tl_c.id, tla_c.tunnel_link_id)
        LEFT JOIN users u ON u.id = COALESCE(cl_c.added_by, cla_c.author_id, tl_c.created_by, tla_c.author_id)
        WHERE cm.target_type = $1
          AND cm.target_id = $2
          AND ($3::int[] IS NULL OR cm.target_path = $3::int[])
          AND (
            (cm.source_type IN ('concept_link_comment', 'concept_link_addendum') AND cl_p.id IS NOT NULL AND cl_p.legal_hold = false
              AND EXISTS (SELECT 1 FROM edges e WHERE e.id = cl_p.edge_id AND e.is_hidden = false AND e.legal_hold = false))
            OR
            (cm.source_type IN ('tunnel_link_comment', 'tunnel_link_addendum') AND tl_p.id IS NOT NULL
              AND EXISTS (SELECT 1 FROM edges e WHERE e.id = tl_p.origin_edge_id AND e.is_hidden = false AND e.legal_hold = false))
          )
        ORDER BY cm.created_at DESC
        LIMIT $4 OFFSET $5`,
        [targetType, targetId, pathParam, limit, offset]
      );

      const mentions = dataResult.rows.map(row => {
        const isLinkSource = row.source_type.startsWith('concept_link');
        return {
          id: row.mention_id,
          sourceType: row.source_type,
          sourceId: row.source_id,
          sourceParentId: row.source_parent_id,
          sourceParentType: isLinkSource ? 'link' : 'tunnel',
          sourceParentTitle: row.source_parent_title,
          sourceText: row.source_text,
          sourceAuthor: {
            id: row.source_author_id,
            username: row.source_author_username,
            orcidId: row.source_author_orcid_id,
          },
          createdAt: row.mention_created_at,
        };
      });

      res.json({
        mentions,
        totalCount,
        hasMore: offset + mentions.length < totalCount,
      });
    } catch (error) {
      console.error('Error getting mentions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
};

module.exports = mentionsController;
