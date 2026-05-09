const pool = require('./database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const createTables = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ============================================================
    // Phase 58a: Drop retired tables (Phase 58 link-based pivot)
    // Documents, corpuses, annotations, messages, citations, and
    // related infrastructure are all retired. concept_links and
    // concept_link_votes are the new home for references.
    // ============================================================

    // Clean up sidebar_items rows that polymorphically reference
    // corpus subscriptions (no FK, so won't cascade)
    await client.query(`
      DELETE FROM sidebar_items WHERE item_type = 'corpus';
    `);

    // Drop retired tables — order handles FK dependencies, CASCADE covers the rest
    await client.query(`DROP TABLE IF EXISTS message_read_status CASCADE`);
    await client.query(`DROP TABLE IF EXISTS messages CASCADE`);
    await client.query(`DROP TABLE IF EXISTS message_threads CASCADE`);
    await client.query(`DROP TABLE IF EXISTS combo_annotation_votes CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_citation_links CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_external_links CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_concept_links_cache CASCADE`);
    await client.query(`DROP TABLE IF EXISTS annotation_color_set_votes CASCADE`);
    await client.query(`DROP TABLE IF EXISTS annotation_votes CASCADE`);
    await client.query(`DROP TABLE IF EXISTS annotation_removal_log CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_annotations CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_favorites CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_invite_tokens CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_authors CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_tag_links CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_tags CASCADE`);
    await client.query(`DROP TABLE IF EXISTS user_corpus_tab_placements CASCADE`);
    await client.query(`DROP TABLE IF EXISTS saved_page_tab_activity CASCADE`);
    await client.query(`DROP TABLE IF EXISTS saved_tree_order_v2 CASCADE`);
    await client.query(`DROP TABLE IF EXISTS corpus_invite_tokens CASCADE`);
    await client.query(`DROP TABLE IF EXISTS corpus_allowed_users CASCADE`);
    await client.query(`DROP TABLE IF EXISTS corpus_subscriptions CASCADE`);
    await client.query(`DROP TABLE IF EXISTS corpus_documents CASCADE`);
    await client.query(`DROP TABLE IF EXISTS documents CASCADE`);
    await client.query(`DROP TABLE IF EXISTS corpuses CASCADE`);
    await client.query(`DROP TABLE IF EXISTS document_subscriptions CASCADE`);
    await client.query(`DROP TABLE IF EXISTS copyright_counter_notices CASCADE`);
    await client.query(`DROP TABLE IF EXISTS copyright_infringement_notices CASCADE`);
    // Legacy retired tables (already non-functional)
    await client.query(`DROP TABLE IF EXISTS saved_tree_order CASCADE`);
    await client.query(`DROP TABLE IF EXISTS vote_tab_links CASCADE`);
    await client.query(`DROP TABLE IF EXISTS saved_tabs CASCADE`);

    // Drop hide_annotation_warning column (annotation feature retired)
    await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS hide_annotation_warning`);

    console.log('Phase 58a: Dropped retired tables and columns');

    // ============================================================
    // Core schema — tables that survive the Phase 58 pivot
    // ============================================================

    // Enable pg_trgm extension for fuzzy text search (concept name search
    // in conceptsController.searchConcepts). Must run before any index that
    // uses gin_trgm_ops — idx_concepts_name_trgm below.
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Concepts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS concepts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Trigram and lowercase indexes on concepts.name — used by
    // conceptsController.searchConcepts for fuzzy and exact-prefix matching.
    // Requires the pg_trgm extension enabled above.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concepts_name_trgm
        ON concepts USING GIN (name gin_trgm_ops);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concepts_name_lower
        ON concepts (LOWER(name));
    `);

    // Attributes table - stores reusable attribute tags (action, tool, value)
    await client.query(`
      CREATE TABLE IF NOT EXISTS attributes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default attributes (action, tool, value, question) if they don't exist
    await client.query(`
      INSERT INTO attributes (name) VALUES ('action'), ('tool'), ('value'), ('question')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Edges table - represents parent-child relationships in specific graph contexts
    await client.query(`
      CREATE TABLE IF NOT EXISTS edges (
        id SERIAL PRIMARY KEY,
        parent_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
        child_id INTEGER REFERENCES concepts(id) ON DELETE CASCADE,
        graph_path INTEGER[] NOT NULL,
        attribute_id INTEGER REFERENCES attributes(id),
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // If edges table already existed without attribute_id, add the column
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'edges' AND column_name = 'attribute_id'
        ) THEN
          ALTER TABLE edges ADD COLUMN attribute_id INTEGER REFERENCES attributes(id);
        END IF;
      END $$;
    `);

    // Backfill: assign all existing edges without an attribute to 'action'
    await client.query(`
      UPDATE edges
      SET attribute_id = (SELECT id FROM attributes WHERE name = 'action')
      WHERE attribute_id IS NULL;
    `);

    // Now enforce NOT NULL on attribute_id
    await client.query(`
      ALTER TABLE edges ALTER COLUMN attribute_id SET NOT NULL;
    `);

    // Drop old unique constraint if it exists (without attribute_id)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'edges_parent_id_child_id_graph_path_key'
          AND table_name = 'edges'
        ) THEN
          ALTER TABLE edges DROP CONSTRAINT edges_parent_id_child_id_graph_path_key;
        END IF;
      END $$;
    `);

    // Add new unique constraint that includes attribute_id
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'edges_parent_child_path_attribute_key'
          AND table_name = 'edges'
        ) THEN
          ALTER TABLE edges ADD CONSTRAINT edges_parent_child_path_attribute_key
            UNIQUE(parent_id, child_id, graph_path, attribute_id);
        END IF;
      END $$;
    `);

    // Indexes for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_edges_parent ON edges(parent_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_edges_child ON edges(child_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_edges_attribute ON edges(attribute_id);
    `);

    // Votes table (saves)
    await client.query(`
      CREATE TABLE IF NOT EXISTS votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edge_id)
      );
    `);

    // Similarity votes table (link votes — Flip View only)
    // origin_edge_id = the edge the user came from (their current context)
    // similar_edge_id = the alt parent edge they're voting as helpful/linked
    await client.query(`
      CREATE TABLE IF NOT EXISTS similarity_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        origin_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        similar_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, origin_edge_id, similar_edge_id)
      );
    `);

    // Indexes for similarity_votes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_similarity_votes_origin ON similarity_votes(origin_edge_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_similarity_votes_similar ON similarity_votes(similar_edge_id);
    `);

    // Replace votes table (swap votes)
    // edge_id = the edge being flagged as replaceable
    // replacement_edge_id = the sibling edge that should replace it
    await client.query(`
      CREATE TABLE IF NOT EXISTS replace_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        replacement_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edge_id, replacement_edge_id)
      );
    `);

    // Indexes for replace_votes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_replace_votes_edge ON replace_votes(edge_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_replace_votes_replacement ON replace_votes(replacement_edge_id);
    `);

    // ============================================================
    // Graph Tabs table (Phase 5c)
    // Persistent in-app navigation tabs. Each graph tab tracks
    // where the user is in the concept graph (concept_id + path).
    // tab_type: 'root' (at root page) or 'concept' (at a concept)
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS graph_tabs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        tab_type VARCHAR(20) NOT NULL DEFAULT 'root',
        concept_id INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
        path INTEGER[] NOT NULL DEFAULT '{}',
        view_mode VARCHAR(20) NOT NULL DEFAULT 'children',
        display_order INTEGER NOT NULL DEFAULT 0,
        label VARCHAR(255) NOT NULL DEFAULT 'Root',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_graph_tabs_user ON graph_tabs(user_id);
    `);

    // ============================================================
    // Tab Groups table (Phase 5d)
    // Named groups that can contain graph tabs.
    // Flat grouping only — no groups within groups.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS tab_groups (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL DEFAULT 'Group',
        display_order INTEGER NOT NULL DEFAULT 0,
        is_expanded BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tab_groups_user ON tab_groups(user_id);
    `);

    // Add group_id column to graph_tabs (nullable — null means ungrouped)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'graph_tabs' AND column_name = 'group_id'
        ) THEN
          ALTER TABLE graph_tabs ADD COLUMN group_id INTEGER REFERENCES tab_groups(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // ============================================================
    // Child Rankings table (Phase 5f) — dormant but retained
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS child_rankings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        parent_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        child_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        vote_set_key TEXT NOT NULL,
        rank_position INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, parent_edge_id, child_edge_id, vote_set_key)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_child_rankings_parent_set
        ON child_rankings(parent_edge_id, vote_set_key);
    `);

    // ============================================================
    // Concept Links table (Phase 6)
    // External URLs attached to concepts in specific contexts.
    // Links are tied to edges (context-specific), not concepts
    // globally. Same concept can have different links in different
    // parent contexts. THIS IS THE FOUNDATION OF THE NEW SYSTEM.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_links (
        id SERIAL PRIMARY KEY,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        title VARCHAR(255),
        added_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concept_links_edge ON concept_links(edge_id);
    `);

    // Phase 29a: Add comment and updated_at columns to concept_links (idempotent)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'concept_links' AND column_name = 'comment'
        ) THEN
          ALTER TABLE concept_links ADD COLUMN comment TEXT;
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'concept_links' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE concept_links ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
      END $$;
    `);

    // ============================================================
    // Concept Link Votes table (Phase 6)
    // Simple upvote system for web links. One vote per user per
    // link — not the four-type vote system used for edges.
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_link_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        concept_link_id INTEGER REFERENCES concept_links(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, concept_link_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concept_link_votes_link ON concept_link_votes(concept_link_id);
    `);

    // ============================================================
    // Phase 16a: Moderation / Spam Flagging
    // ============================================================

    // Add is_hidden column to edges table
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'edges' AND column_name = 'is_hidden'
        ) THEN
          ALTER TABLE edges ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END $$;
    `);

    // concept_flags — one flag per user per edge
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_flags (
        id SERIAL PRIMARY KEY,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reason VARCHAR(50) NOT NULL DEFAULT 'spam',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edge_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concept_flags_edge ON concept_flags(edge_id);
    `);

    // concept_flag_votes — community votes to keep hidden or restore
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_flag_votes (
        id SERIAL PRIMARY KEY,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        vote_type VARCHAR(10) NOT NULL CHECK (vote_type IN ('hide', 'show')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, edge_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_concept_flag_votes_edge ON concept_flag_votes(edge_id);
    `);

    // moderation_comments — discussion on hidden concepts (no unique constraint)
    await client.query(`
      CREATE TABLE IF NOT EXISTS moderation_comments (
        id SERIAL PRIMARY KEY,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_moderation_comments_edge ON moderation_comments(edge_id);
    `);

    // ============================================================
    // Phase 19b: Unified sidebar ordering — sidebar_items table
    // item_type: 'group' | 'graph_tab' | 'combo'
    // item_id: tab_groups.id, graph_tabs.id, or combo_subscriptions.id
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS sidebar_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        item_type VARCHAR(20) NOT NULL,
        item_id INTEGER NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, item_type, item_id)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sidebar_items_user
        ON sidebar_items(user_id, display_order);
    `);

    // Backfill: tab groups
    await client.query(`
      INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
      SELECT user_id, 'group', id,
             10000 + (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY display_order, id)) * 10
      FROM tab_groups
      ON CONFLICT DO NOTHING;
    `);

    // Backfill: graph tabs
    await client.query(`
      INSERT INTO sidebar_items (user_id, item_type, item_id, display_order)
      SELECT user_id, 'graph_tab', id,
             20000 + (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY display_order, id)) * 10
      FROM graph_tabs
      ON CONFLICT DO NOTHING;
    `);

    // Phase 49a: Postgres-backed rate limit counters
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_counters (
        key TEXT NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        count INT NOT NULL DEFAULT 0,
        PRIMARY KEY (key, window_start)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rlc_window ON rate_limit_counters(window_start);
    `);

    // ============================================================
    // Phase 52a: Data Export Request Audit Log
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_export_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_data_export_requests_user_time
        ON data_export_requests(user_id, requested_at);
    `);

    // ============================================================
    // Legal Removals audit table (Phase 53b)
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS legal_removals (
        id SERIAL PRIMARY KEY,
        target_type VARCHAR(32) NOT NULL,
        target_id INTEGER NOT NULL,
        affected_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        removal_reason VARCHAR(32) NOT NULL,
        notice_reference VARCHAR(255),
        internal_notes TEXT,
        removed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        removed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_notified_at TIMESTAMP,
        restored_at TIMESTAMP,
        restored_reason VARCHAR(255)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_removals_user ON legal_removals(affected_user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_removals_reason ON legal_removals(removal_reason, removed_at);
    `);

    // ============================================================
    // legal_hold flag on hideable tables (Phase 53b)
    // ============================================================
    await client.query(`
      ALTER TABLE concepts ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE edges ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT false;
    `);
    await client.query(`
      ALTER TABLE concept_links ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT false;
    `);

    // ============================================================
    // DMCA strikes table (Phase 53c)
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS dmca_strikes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        legal_removal_id INTEGER REFERENCES legal_removals(id) ON DELETE CASCADE,
        struck_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cleared_at TIMESTAMP,
        cleared_reason VARCHAR(255)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_dmca_strikes_user_active ON dmca_strikes(user_id) WHERE cleared_at IS NULL;
    `);

    await client.query('COMMIT');

    // ============================================================
    // Post-transaction migrations (outside the main transaction)
    // ============================================================

    // Phase 20b: Drop side_votes (move votes) table
    await client.query(`
      DROP TABLE IF EXISTS side_votes CASCADE;
    `);

    // ============================================================
    // Phase 23a: Vote Set Drift Event Log
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS vote_set_changes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        parent_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        child_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        action VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vote_set_changes_parent_user_time
        ON vote_set_changes(parent_edge_id, user_id, created_at);
    `);

    // ── Phase 27a: Retire links/fliplinks view modes from graph_tabs ──
    await client.query(`
      UPDATE graph_tabs SET view_mode = 'children'
      WHERE view_mode IN ('links', 'fliplinks')
    `);

    // Phase 28g: Widen concept name column from VARCHAR(40) to VARCHAR(255)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'concepts' AND column_name = 'name'
            AND character_maximum_length < 255
        ) THEN
          ALTER TABLE concepts ALTER COLUMN name TYPE VARCHAR(255);
        END IF;
      END $$;
    `);

    // Phase 30g: Informational page comments and comment votes
    await client.query(`
      CREATE TABLE IF NOT EXISTS page_comments (
        id SERIAL PRIMARY KEY,
        page_slug VARCHAR(50) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_page_comments_page ON page_comments(page_slug);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS page_comment_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        comment_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, comment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_page_comment_votes_comment ON page_comment_votes(comment_id);
    `);

    // Phase 30g-2: Add parent_comment_id for 1-level nested replies
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'page_comments' AND column_name = 'parent_comment_id'
        ) THEN
          ALTER TABLE page_comments ADD COLUMN parent_comment_id INTEGER REFERENCES page_comments(id) ON DELETE CASCADE;
          CREATE INDEX idx_page_comments_parent ON page_comments(parent_comment_id);
        END IF;
      END $$;
    `);

    // ── Phase 32a: Phone OTP Authentication — add phone_hash to users ──
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash VARCHAR(255);
    `);

    // ── Phase 32b: Make email/password_hash nullable, add token_issued_after ──
    await client.query(`
      ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
    `);
    await client.query(`
      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_issued_after TIMESTAMP;
    `);

    // ── Phase 32d: Assign phone hashes to existing test users ──
    const testUsers = [
      { username: 'alice', phone: '+15005550001' },
      { username: 'bob', phone: '+15005550002' },
      { username: 'carol', phone: '+15005550003' },
      { username: 'dave', phone: '+15005550004' },
      { username: 'eve', phone: '+15005550005' },
      { username: 'frank', phone: '+15005550006' },
    ];
    for (const { username, phone } of testUsers) {
      try {
        const exists = await client.query(
          'SELECT id FROM users WHERE username = $1 AND phone_hash IS NULL',
          [username]
        );
        if (exists.rows.length > 0) {
          const phoneHash = await bcrypt.hash(phone, 10);
          await client.query(
            'UPDATE users SET phone_hash = $1 WHERE username = $2',
            [phoneHash, username]
          );
          console.log(`  Assigned phone hash to ${username}`);
        }
      } catch (err) {
        console.error(`  Failed to assign phone hash to ${username}:`, err.message);
      }
    }

    // ── Phase 33e: O(1) phone lookup via HMAC-SHA256 ──
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_lookup VARCHAR(64);
    `);
    // Add UNIQUE constraint if not already present
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'users'
            AND constraint_type = 'UNIQUE'
            AND constraint_name = 'users_phone_lookup_key'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_phone_lookup_key UNIQUE (phone_lookup);
        END IF;
      END $$;
    `);
    // Backfill phone_lookup for the 6 test users (we know their plain phone numbers)
    if (process.env.PHONE_LOOKUP_KEY) {
      const testPhones = [
        { username: 'alice', phone: '+15005550001' },
        { username: 'bob', phone: '+15005550002' },
        { username: 'carol', phone: '+15005550003' },
        { username: 'dave', phone: '+15005550004' },
        { username: 'eve', phone: '+15005550005' },
        { username: 'frank', phone: '+15005550006' },
      ];
      for (const { username, phone } of testPhones) {
        try {
          const lookup = crypto.createHmac('sha256', process.env.PHONE_LOOKUP_KEY)
            .update(phone).digest('hex');
          const updated = await client.query(
            'UPDATE users SET phone_lookup = $1 WHERE username = $2 AND phone_lookup IS NULL',
            [lookup, username]
          );
          if (updated.rowCount > 0) {
            console.log(`  Assigned phone_lookup to ${username}`);
          }
        } catch (err) {
          console.error(`  Failed to assign phone_lookup to ${username}:`, err.message);
        }
      }
    }

    // ============================================================
    // Phase 35c: Fix Foreign Key Constraints for Account Deletion
    // Only fix FKs on tables that still exist after Phase 58a.
    // ============================================================
    try {
      const fksToFix = [
        { table: 'concepts',             column: 'created_by', constraint: 'concepts_created_by_fkey' },
        { table: 'attributes',           column: 'created_by', constraint: 'attributes_created_by_fkey' },
        { table: 'edges',                column: 'created_by', constraint: 'edges_created_by_fkey' },
        { table: 'concept_links',        column: 'added_by',   constraint: 'concept_links_added_by_fkey' },
      ];

      for (const { table, column, constraint } of fksToFix) {
        await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
        await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES users(id) ON DELETE SET NULL`);
      }
      console.log('Phase 35c: Fixed foreign key constraints to ON DELETE SET NULL');
    } catch (phase35cErr) {
      console.error('Phase 35c: FK migration error:', phase35cErr.message);
    }

    // ============================================================
    // Phase 36a: Legal Compliance — Age Verification
    // ============================================================
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'age_verified_at'
        ) THEN
          ALTER TABLE users ADD COLUMN age_verified_at TIMESTAMP;
        END IF;
      END $$;
    `);

    // Backfill test users with fake emails (only where email IS NULL)
    const testEmails = [
      { username: 'alice', email: 'alice@test.com' },
      { username: 'bob', email: 'bob@test.com' },
      { username: 'carol', email: 'carol@test.com' },
      { username: 'dave', email: 'dave@test.com' },
      { username: 'eve', email: 'eve@test.com' },
      { username: 'frank', email: 'frank@test.com' },
    ];
    for (const { username, email } of testEmails) {
      await client.query(
        'UPDATE users SET email = $1 WHERE username = $2 AND email IS NULL',
        [email, username]
      );
    }

    // Set age_verified_at for all test users where it's NULL
    await client.query(`
      UPDATE users SET age_verified_at = NOW()
      WHERE username IN ('alice', 'bob', 'carol', 'dave', 'eve', 'frank')
        AND age_verified_at IS NULL
    `);

    // ── Phase 39a: Combo Infrastructure ──
    // Combos are user-created collections of edges (concepts-in-context).

    await client.query(`
      CREATE TABLE IF NOT EXISTS combos (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_combos_name_lower ON combos (LOWER(name));
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combos_created_by ON combos(created_by);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS combo_edges (
        id SERIAL PRIMARY KEY,
        combo_id INTEGER REFERENCES combos(id) ON DELETE CASCADE,
        edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(combo_id, edge_id)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combo_edges_combo ON combo_edges(combo_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combo_edges_edge ON combo_edges(edge_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS combo_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        combo_id INTEGER REFERENCES combos(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, combo_id)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combo_subscriptions_user ON combo_subscriptions(user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_combo_subscriptions_combo ON combo_subscriptions(combo_id);
    `);

    // Phase 39e: Add group_id to combo_subscriptions for tab group support
    await client.query(`
      ALTER TABLE combo_subscriptions ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES tab_groups(id) ON DELETE SET NULL;
    `);

    // Phase 39e: Change combos.created_by to ON DELETE SET NULL for existing databases
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'combos' AND constraint_type = 'FOREIGN KEY'
          AND constraint_name = (
            SELECT constraint_name FROM information_schema.key_column_usage
            WHERE table_name = 'combos' AND column_name = 'created_by'
          )
        ) THEN
          ALTER TABLE combos DROP CONSTRAINT IF EXISTS combos_created_by_fkey;
          ALTER TABLE combos ADD CONSTRAINT combos_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Phase 40b: Set password_hash for test users (alice-frank) to known test password
    const testPasswordHash = await bcrypt.hash('testpass123!', 10);
    await client.query(`
      UPDATE users
      SET password_hash = $1
      WHERE username IN ('alice', 'bob', 'carol', 'dave', 'eve', 'frank')
    `, [testPasswordHash]);

    // ============================================================
    // Phase 41a: ORCID Integration — add orcid_id column to users
    // ============================================================
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'orcid_id'
        ) THEN
          ALTER TABLE users ADD COLUMN orcid_id VARCHAR(19);
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_orcid
        ON users(orcid_id) WHERE orcid_id IS NOT NULL
    `);

    // ============================================================
    // Phase 43a: Tunnel Links table
    // ============================================================
    await client.query(`
      CREATE TABLE IF NOT EXISTS tunnel_links (
        id SERIAL PRIMARY KEY,
        origin_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        linked_edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(origin_edge_id, linked_edge_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tunnel_links_origin ON tunnel_links(origin_edge_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tunnel_links_linked ON tunnel_links(linked_edge_id)
    `);

    // Phase 43a: Tunnel Votes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tunnel_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        tunnel_link_id INTEGER REFERENCES tunnel_links(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, tunnel_link_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tunnel_votes_link ON tunnel_votes(tunnel_link_id)
    `);

    // ============================================================
    // Phase 44: Cleanup cross-context swap votes
    // ============================================================
    const crossContextSwaps = await client.query(`
      DELETE FROM replace_votes rv
      USING edges src, edges rep
      WHERE rv.edge_id = src.id
        AND rv.replacement_edge_id = rep.id
        AND (
          src.parent_id IS DISTINCT FROM rep.parent_id
          OR src.graph_path IS DISTINCT FROM rep.graph_path
          OR (src.parent_id IS NULL AND rep.parent_id IS NULL AND src.attribute_id != rep.attribute_id)
        )
    `);
    if (crossContextSwaps.rowCount > 0) {
      console.log(`Phase 44: Deleted ${crossContextSwaps.rowCount} cross-context swap votes`);
    }

    // ── Phase 51a: Click-wrap consent columns ──
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'tos_accepted_at'
        ) THEN
          ALTER TABLE users ADD COLUMN tos_accepted_at TIMESTAMP;
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'tos_version_accepted'
        ) THEN
          ALTER TABLE users ADD COLUMN tos_version_accepted VARCHAR(32);
        END IF;
      END $$;
    `);

    // Phase 56a — Hard-delete of page_comments rows for retired pages
    await client.query(
      `DELETE FROM page_comments WHERE page_slug IN ('constitution', 'donate')`
    );

    console.log('Database tables created/migrated successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating tables:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run migration
createTables()
  .then(() => {
    console.log('Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
