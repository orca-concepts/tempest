import React, { useState, useEffect } from 'react';
import { votesAPI } from '../services/api'; // getMyLinkVotes
import { useAuth } from '../contexts/AuthContext';
import LinkCard from './LinkCard';

/**
 * LinkVotesOverlay — shows all concept_links the current user has upvoted.
 *
 * Props:
 *   onBack            — close the overlay
 *   onNavigateToLink  — (conceptId, path, conceptName, attributeName, scrollToLinkId) => void
 */
const LinkVotesOverlay = ({ onBack, onNavigateToLink }) => {
  const { user } = useAuth();
  const [links, setLinks] = useState([]);
  const [pathNames, setPathNames] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await votesAPI.getMyLinkVotes();
        if (cancelled) return;
        setLinks(res.data.links || []);
        setPathNames(res.data.pathNames || {});
      } catch (err) {
        console.error('Failed to load link votes:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCardClick = (link) => {
    if (onNavigateToLink) {
      onNavigateToLink(
        link.concept_id,
        link.graph_path || [],
        link.concept_name,
        link.attribute_name,
        link.id // scrollToLinkId
      );
      onBack();
    }
  };

  const buildBreadcrumb = (link) => {
    const parts = (link.graph_path || []).map(id => pathNames[id] || `#${id}`);
    parts.push(link.concept_name);
    return parts.join(' \u2192 ');
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.headerBar}>
          <button onClick={onBack} style={styles.backButton}>{'\u2190'} Back</button>
          <h2 style={styles.heading}>Link Votes</h2>
        </div>
        <div style={styles.loading}>Loading your link votes...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>{'\u2190'} Back</button>
        <h2 style={styles.heading}>Link Votes</h2>
      </div>

      {links.length === 0 ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>You haven't upvoted any links yet.</p>
          <p style={styles.emptySubtext}>
            Upvote links on concept pages by clicking the {'\u2191'} button on any link card.
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          {links.map((link, idx) => (
            <LinkCard key={link.id}
              link={{ ...link, voteCount: Number(link.vote_count) || 0, userVoted: true, addedBy: link.added_by, addedByUsername: link.added_by_username, createdAt: link.created_at }}
              user={user} isGuest={false} isFirst={idx === 0}
              contextLabel={buildBreadcrumb(link)}
              readOnlyVote={true} clickable={true}
              onCardClick={() => handleCardClick(link)}
              showInstances={false}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: { minHeight: '100%', backgroundColor: '#faf9f7' },
  headerBar: { display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px 0 20px', maxWidth: '1200px', margin: '0 auto' },
  backButton: { padding: '6px 12px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '14px', fontFamily: '"EB Garamond", Georgia, serif', color: '#555' },
  heading: { margin: 0, fontSize: '22px', fontFamily: '"EB Garamond", Georgia, serif', fontWeight: '600', color: '#333' },
  loading: { textAlign: 'center', padding: '60px', fontSize: '15px', color: '#888', fontFamily: '"EB Garamond", Georgia, serif' },
  emptyState: { textAlign: 'center', padding: '80px 20px', maxWidth: '1200px', margin: '0 auto' },
  emptyText: { fontSize: '20px', color: '#666', fontFamily: '"EB Garamond", Georgia, serif', marginBottom: '8px' },
  emptySubtext: { fontSize: '15px', color: '#999', fontFamily: '"EB Garamond", Georgia, serif', maxWidth: '500px', margin: '0 auto', lineHeight: 1.6 },
  list: { maxWidth: '800px', margin: '16px auto 0', padding: '0 20px' },
};

export default LinkVotesOverlay;
