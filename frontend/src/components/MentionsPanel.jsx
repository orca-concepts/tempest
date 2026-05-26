import React, { useState, useEffect, useRef, useCallback } from 'react';
import { mentionsAPI } from '../services/api';
import LinkifiedText from './LinkifiedText';
import OrcidBadge from './OrcidBadge';

function formatRelativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const PAGE_SIZE = 20;

const MentionsPanel = ({ targetType, targetId, targetPath, emptyStateNoun, expanded }) => {
  const [mentions, setMentions] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetched, setFetched] = useState(false);
  const fetchedKeyRef = useRef(null);

  const cacheKey = `${targetType}:${targetId}:${targetPath ? targetPath.join(',') : ''}`;

  const fetchMentions = useCallback(async (offset = 0, append = false) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const opts = { limit: PAGE_SIZE, offset };
      if (targetType === 'concept') {
        opts.path = targetPath ? targetPath.join(',') : '';
      }
      const res = await mentionsAPI.getMentions(targetType, targetId, opts);
      const data = res.data;
      if (append) {
        setMentions(prev => [...prev, ...data.mentions]);
      } else {
        setMentions(data.mentions);
      }
      setTotalCount(data.totalCount);
      setHasMore(data.hasMore);
      setFetched(true);
      fetchedKeyRef.current = cacheKey;
    } catch (err) {
      console.error('Error fetching mentions:', err);
      if (!append) {
        setMentions([]);
        setTotalCount(0);
        setHasMore(false);
        setFetched(true);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [targetType, targetId, cacheKey]);

  useEffect(() => {
    if (!expanded) return;
    if (fetchedKeyRef.current === cacheKey) return;
    fetchMentions(0);
  }, [expanded, cacheKey, fetchMentions]);

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    fetchMentions(mentions.length, true);
  };

  const openSource = (mention) => {
    const parentType = (mention.sourceType === 'concept_link_comment' || mention.sourceType === 'concept_link_addendum')
      ? 'link' : 'tunnel';
    const url = `${window.location.origin}/${parentType}/${mention.sourceParentId}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!expanded) return null;

  if (loading && !fetched) {
    return <div style={s.loading}>Loading...</div>;
  }

  if (fetched && mentions.length === 0) {
    return (
      <div style={s.emptyState}>
        No mentions yet. When researchers reference this {emptyStateNoun} in their link comments or addenda, those references will appear here.
      </div>
    );
  }

  return (
    <div>
      {mentions.map(m => (
        <div
          key={m.id}
          style={s.mentionRow}
          onClick={(e) => { e.stopPropagation(); openSource(m); }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f5f0e8'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; }}
        >
          <div style={s.mentionMeta}>
            <span style={s.mentionAuthor}>
              {m.sourceAuthor?.username || '[deleted user]'}
              {m.sourceAuthor?.orcidId && <OrcidBadge orcidId={m.sourceAuthor.orcidId} />}
            </span>
            <span style={s.mentionTime}>{formatRelativeTime(m.createdAt)}</span>
          </div>
          {m.sourceParentTitle && (
            <div style={s.mentionContext}>On: {m.sourceParentTitle}</div>
          )}
          {m.sourceText && (
            <LinkifiedText text={m.sourceText} lines={3} style={s.mentionSnippet} />
          )}
        </div>
      ))}
      {hasMore && (
        <div style={s.loadMoreRow}>
          <span
            onClick={(e) => { e.stopPropagation(); handleLoadMore(); }}
            style={loadingMore ? { ...s.loadMoreBtn, opacity: 0.5, cursor: 'default' } : s.loadMoreBtn}
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </span>
        </div>
      )}
    </div>
  );
};

const s = {
  loading: { fontSize: '13px', color: '#999', fontFamily: '"EB Garamond", Georgia, serif', padding: '12px 0' },
  emptyState: { fontSize: '13px', color: '#999', fontFamily: '"EB Garamond", Georgia, serif', padding: '12px 0', lineHeight: 1.5 },
  mentionRow: { padding: '10px 6px', borderBottom: '1px solid #ece6db', cursor: 'pointer', transition: 'background-color 0.15s' },
  mentionMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  mentionAuthor: { fontSize: '12px', color: '#555', fontFamily: '"EB Garamond", Georgia, serif', display: 'flex', alignItems: 'center', gap: '4px' },
  mentionTime: { fontSize: '11px', color: '#aaa', fontFamily: '"EB Garamond", Georgia, serif' },
  mentionContext: { fontSize: '11px', color: '#888', fontFamily: '"EB Garamond", Georgia, serif', marginBottom: '4px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  mentionSnippet: { fontSize: '12px', color: '#555', fontFamily: '"EB Garamond", Georgia, serif', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  loadMoreRow: { padding: '8px 0', textAlign: 'center' },
  loadMoreBtn: { fontSize: '12px', color: '#888', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif', textDecoration: 'underline' },
};

export default MentionsPanel;
