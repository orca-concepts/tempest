import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { pagesAPI } from '../services/api';

const PAGE_TITLES = {
  'using-orca': 'What is orca?',
  'thoroughly-conscious-ignorance': 'Thoroughly Conscious Ignorance',
};

// ── What is orca? content (left column) ──────────────────────
const UsingOrcaContent = ({ onImageClick }) => {
  const showImage = (file, alt) => (
    <div style={{ marginBottom: '28px' }}>
      <img
        src={`/images/using-orca/${file}`}
        alt={alt}
        style={usingOrcaStyles.heroImage}
        onClick={() => onImageClick({
          slides: [{ image: `/images/using-orca/${file}`, caption: '' }],
          index: 0,
        })}
      />
    </div>
  );

  return (
    <div>

      <p style={usingOrcaStyles.intro}>
        orca is a tool for exploring research questions. Research questions can range from the broad and
        abstract to the specific and concrete, and the work of answering the former lies in
        answering the latter.
      </p>
      <p style={usingOrcaStyles.intro}>
        Mapping the relationships between these questions in hierarchies of abstract parents and
        concrete children can help us consider and explore the work questions do in science.
        Linking research work to questions provides the final concretion, instantiating questions
        with the research aimed at answering them.
      </p>

      {showImage('children_view_questions.png', 'Children view of research questions')}

      <div style={usingOrcaStyles.sectionTitle}>Flip View</div>
      <p style={usingOrcaStyles.intro}>
        When a question is attached to multiple parents paths, you can explore those using Flip View.
        A question's parent path is a good contextualizing mechanism, so adding and exploring questions 
        that exist in multiple parent paths allows users to compare those different contexts.
      </p>

      {showImage('flip_view_questions.png', 'Flip View of a question with multiple parent paths')}

      <div style={usingOrcaStyles.sectionTitle}>Link Surfacing</div>
      <p style={usingOrcaStyles.intro}>
        Research work that is linked to a child concept is automatically surfaced within the entire
        parent path, so that at any level of abstraction you can explore and vote on the full
        variety of work taking place within. Each question becomes a reading list of the research linked
        to any of its descendant questions.
      </p>

      <div style={usingOrcaStyles.sectionTitle}>Votes</div>
      <p style={usingOrcaStyles.intro}>
        You can view all the questions and links you've voted for on a single page for easy navigation and 
        maintenance of votes.
      </p>

      {showImage('votes_page.png', 'Votes page listing voted questions and links')}

      <div style={usingOrcaStyles.sectionTitle}>Append-only; vote set colors</div>
      <p style={usingOrcaStyles.intro}>
        As users vote on different questions, common patterns of votes will emerge, groups of users who voted 
        for the same set of child questions for a given parent. These groups are visualized by color swatches 
        which can be clicked to filter the page to only that set.
      </p>
      <p style={usingOrcaStyles.intro}>
        This feature is designed to allow the child set of questions for a given parent 
        (or indeed the set of root level questions) to be a dynamic expression of that set of different users’ 
        preferred directions for research. orca is append-only, meaning questions cannot be deleted once they 
        are made, so curating and maintaining ones votes is an important mechanism by which the app can display 
        and weight the different avenues that can emerge from a given question. Viewing and comparing these color 
        sets allows users to explore how that given question can be differentiated, which might help to spark new 
        ideas for differentiation.
      </p>
        {showImage('vote_set.png', 'Children view displaying color vote sets')}


      <p style={usingOrcaStyles.intro}>
        This is a free, open-source project for use by researchers:{' '}
        <a href="https://github.com/orca-concepts/tempest" target="_blank" rel="noopener noreferrer" style={usingOrcaStyles.subtleLink}>https://github.com/orca-concepts/tempest</a>.
        {' '}In general, this app aims to apply the categorical nature of concepts to larger, more
        complex expressions like research questions.
      </p>
    </div>
  );
};

// ── Thoroughly Conscious Ignorance essay (left column) ───────
const ThoroughlyConsciousIgnoranceContent = ({ onImageClick }) => {
  const showImage = (file, alt) => (
    <div style={{ marginBottom: '28px' }}>
      <img
        src={`/images/using-orca/${file}`}
        alt={alt}
        style={usingOrcaStyles.heroImage}
        onClick={() => onImageClick({
          slides: [{ image: `/images/using-orca/${file}`, caption: '' }],
          index: 0,
        })}
      />
    </div>
  );

  return (
    <div>
      <p style={usingOrcaStyles.epigraph}>
        Thoroughly conscious ignorance is the prelude to every real advance in science.
      </p>
      <p style={usingOrcaStyles.epigraphAttribution}>James Clerk Maxwell</p>

      <p style={usingOrcaStyles.intro}>
        The infrastructure of modern science indexes answers, not questions. We build vast ontologies, 
        curate libraries of citations, develop detailed impact metrics, but when it comes to mapping the 
        structure of the unknown, we seem to fall flat. The conscious ignorance that Maxwell 
        praises seems only to exist tacitly in the minds of individual scientists, raising the question: 
        what does it mean to pursue thoroughly conscious ignorance?
      </p>

      <p style={usingOrcaStyles.intro}>
        When we think about thoroughly exploring normal concepts, we reflect on their nature as categories: 
        we build ourselves a taxonomical bridge between abstract notions and concrete instances. Each step lets 
        us talk and think about the world around us in new ways: you can reason about mammals or nuclear fusion 
        or coping mechanisms without reciting the full list of  features and examples that define them. If we treat 
        research questions as concepts in this way, the project of building out a thoroughly conscious ignorance becomes 
        one of mapping the avenues of abstraction that span from the ‘big questions’ the drive progress in a discipline 
        down to questions so concrete they could be addressed by a single research project.
      </p>

      <p style={usingOrcaStyles.intro}>
        This is the project that orca aims to facilitate. orca is a place where members of the
        research community can taxonomize questions with a parent/child hierarchy, voting on which
        more-concrete children they engage with for a given more-abstract parent
        and then linking to research material when the questions reach an appropriate level of
        concreteness. These links surface upwards along the hierarchy, so each question in orca becomes
        a reading list of the material attached to its descendant questions.
      </p>

      {showImage('children_view_questions.png', 'Children view of research questions')}

      <p style={usingOrcaStyles.intro}>
        When users inevitably vote on different subsets of child questions, these sets are tagged with
        unique colors, so that the different tastes and directions of research for a given parent
        question can be easily seen. The color sets can also act as filters to focus on a particular
        direction. This visualization encourages a dynamic taxonomy; the best ways to differentiate a
        given parent question (and indeed the best methods of differentiating questions in general)
        are diverse and should change over time. You can see the full list of questions you have voted
        for and use this list to navigate back to those questions, so you can change your votes as you
        revisit them and see how the voting landscape has changed.
      </p>

      {showImage('vote_set.png', 'Children view displaying color vote sets')}
      {showImage('votes_page.png', 'Votes page listing voted questions and links')}

      <p style={usingOrcaStyles.intro}>
        Active, dynamic categorization of questions is key to the project of thoroughly conscious
        ignorance. As we become more conscious of the world around us, our taxonomies change
        drastically and new language is developed to meet new levels of understanding. To apply this
        practice to questions is to pave the way for more differentiated and better understood
        ignorance, setting the stage for that ignorance to transform into new understanding.
      </p>
    </div>
  );
};

const usingOrcaStyles = {
  intro: {
    fontSize: '1.1em',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.6',
    margin: '0 0 24px 0',
  },
  italic: {
    fontStyle: 'italic',
  },
  epigraph: {
    fontSize: '1.15em',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.6',
    marginTop: '28px',
    marginBottom: '4px',
    textAlign: 'center',
  },
  epigraphAttribution: {
    fontSize: '0.95em',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#777',
    lineHeight: '1.6',
    margin: '0 0 28px 0',
    textAlign: 'right',
    marginRight: '20%',
  },
  useCase: {
    fontSize: '1.1em',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.6',
    margin: '0 0 0.75em 0',
  },
  subtleLink: {
    color: '#333',
    textDecoration: 'underline',
    textDecorationColor: '#ccc',
    textUnderlineOffset: '2px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  sectionTitle: {
    fontSize: '1.1em',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    marginBottom: '10px',
  },
  heroTitle: {
    fontSize: '1.1em',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    marginTop: '28px',
    marginBottom: '10px',
  },
  heroImage: {
    width: '100%',
    height: 'auto',
    display: 'block',
    border: '1px solid #e0e0e0',
    cursor: 'pointer',
  },
  screenshot: {
    maxWidth: '100%',
    border: '1px solid #e0e0e0',
    display: 'block',
    marginBottom: '10px',
  },
  caption: {
    fontSize: '0.85em',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    lineHeight: '1.6',
    margin: '0 0 28px 0',
  },
};

// ── Main InfoPage component ──────────────────────────────────
const InfoPage = ({ slug, onRequestLogin }) => {
  const navigate = useNavigate();
  const { user, isGuest } = useAuth();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentBody, setCommentBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reply state
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  // Lightbox state: { slides: [{ image, caption }], index: number } | null
  const [lightbox, setLightbox] = useState(null);

  const title = PAGE_TITLES[slug] || slug;
  const isUsingOrca = slug === 'using-orca';
  const isEssay = slug === 'thoroughly-conscious-ignorance';
  const isTwoCol = isUsingOrca || isEssay;
  const commentsHeading = isUsingOrca ? 'Report Bugs / Request Enhancements' : 'Community Comments';

  const loadComments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await pagesAPI.getComments(slug);
      setComments(res.data.comments || []);
    } catch (err) {
      console.error('Failed to load comments:', err);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (isEssay) return; // static essay page — no comments section
    loadComments();
  }, [loadComments, isEssay]);

  const handleAddComment = async () => {
    if (!commentBody.trim() || submitting) return;
    try {
      setSubmitting(true);
      const res = await pagesAPI.addComment(slug, commentBody.trim());
      setComments(prev => [res.data.comment, ...prev]);
      setCommentBody('');
    } catch (err) {
      console.error('Failed to add comment:', err);
      alert(err.response?.data?.error || 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddReply = async (parentCommentId) => {
    if (!replyBody.trim() || replySubmitting) return;
    try {
      setReplySubmitting(true);
      const res = await pagesAPI.addComment(slug, replyBody.trim(), parentCommentId);
      setComments(prev => prev.map(c => {
        if (c.id !== parentCommentId) return c;
        return { ...c, replies: [...(c.replies || []), res.data.comment] };
      }));
      setReplyBody('');
      setReplyingTo(null);
    } catch (err) {
      console.error('Failed to add reply:', err);
      alert(err.response?.data?.error || 'Failed to add reply');
    } finally {
      setReplySubmitting(false);
    }
  };

  // Toggle vote — searches both top-level and nested replies
  const toggleVoteInList = (list, commentId) => list.map(c => {
    if (c.id === commentId) {
      const newVoted = !c.userVoted;
      return { ...c, userVoted: newVoted, voteCount: c.voteCount + (newVoted ? 1 : -1) };
    }
    if (c.replies && c.replies.length > 0) {
      return { ...c, replies: toggleVoteInList(c.replies, commentId) };
    }
    return c;
  });

  const handleToggleVote = async (commentId) => {
    setComments(prev => toggleVoteInList(prev, commentId));

    try {
      await pagesAPI.toggleCommentVote(commentId);
    } catch (err) {
      console.error('Failed to toggle vote:', err);
      // Revert
      setComments(prev => toggleVoteInList(prev, commentId));
    }
  };

  const formatRelativeTime = (dateStr) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    return `${Math.floor(diffMonths / 12)}y ago`;
  };

  const renderComment = (comment, isReply = false) => (
    <div key={comment.id} style={isReply ? styles.reply : styles.comment}>
      <div style={styles.commentVoteCol}>
        {!isGuest ? (
          <button
            style={{
              ...styles.voteButton,
              color: comment.userVoted ? '#333' : '#ccc',
            }}
            onClick={() => handleToggleVote(comment.id)}
            title={comment.userVoted ? 'Remove vote' : 'Vote'}
          >
            {comment.userVoted ? '▲' : '△'}
          </button>
        ) : (
          <span style={styles.voteIcon}>{'△'}</span>
        )}
        <span style={styles.voteCount}>{comment.voteCount}</span>
      </div>
      <div style={styles.commentBody}>
        <div style={styles.commentMeta}>
          <span style={styles.commentUsername}>{comment.username}</span>
          <span style={styles.commentTime}>{formatRelativeTime(comment.createdAt)}</span>
        </div>
        <p style={styles.commentText}>{comment.body}</p>
        {!isGuest && !isReply && (
          <button
            style={styles.replyLink}
            onClick={() => {
              setReplyingTo(replyingTo === comment.id ? null : comment.id);
              setReplyBody('');
            }}
          >
            {replyingTo === comment.id ? 'Cancel' : 'Reply'}
          </button>
        )}
      </div>
    </div>
  );

  const renderCommentsSection = () => (
    <div style={isTwoCol ? styles.commentsSectionTwoCol : styles.commentsSection}>
      <h2 style={styles.commentsHeading}>{commentsHeading}</h2>

      {isGuest && (
        <p style={styles.loginNote}>Log in to add comments and vote.</p>
      )}

      {!isGuest && (
        <div style={styles.addComment}>
          <textarea
            style={styles.textarea}
            value={commentBody}
            onChange={e => setCommentBody(e.target.value)}
            placeholder="Add a comment..."
            maxLength={2000}
            rows={3}
          />
          <button
            style={{
              ...styles.addButton,
              opacity: submitting || !commentBody.trim() ? 0.5 : 1,
            }}
            onClick={handleAddComment}
            disabled={submitting || !commentBody.trim()}
          >
            {submitting ? 'Adding...' : 'Add Comment'}
          </button>
        </div>
      )}

      {loading ? (
        <p style={styles.loadingText}>Loading comments...</p>
      ) : comments.length === 0 ? (
        <p style={styles.emptyText}>No comments yet.</p>
      ) : (
        <div style={styles.commentList}>
          {comments.map(comment => (
            <div key={comment.id}>
              {renderComment(comment)}

              {/* Inline reply form */}
              {replyingTo === comment.id && (
                <div style={styles.replyForm}>
                  <textarea
                    style={styles.replyTextarea}
                    value={replyBody}
                    onChange={e => setReplyBody(e.target.value)}
                    placeholder="Write a reply..."
                    maxLength={2000}
                    rows={2}
                    autoFocus
                  />
                  <div style={styles.replyFormButtons}>
                    <button
                      style={{
                        ...styles.replySubmitButton,
                        opacity: replySubmitting || !replyBody.trim() ? 0.5 : 1,
                      }}
                      onClick={() => handleAddReply(comment.id)}
                      disabled={replySubmitting || !replyBody.trim()}
                    >
                      {replySubmitting ? 'Replying...' : 'Reply'}
                    </button>
                    <button
                      style={styles.replyCancelButton}
                      onClick={() => { setReplyingTo(null); setReplyBody(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Replies */}
              {comment.replies && comment.replies.length > 0 && (
                <div style={styles.repliesContainer}>
                  {comment.replies.map(reply => renderComment(reply, true))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Two-column layout for using-orca ────
  if (isTwoCol) {
    return (
      <div style={styles.container}>
        <div style={styles.twoColWrapper}>
          <div style={styles.leftCol}>
            <h1 style={{ ...styles.pageTitle, ...(isEssay ? styles.pageTitleCentered : {}) }}>{title}</h1>
            {isUsingOrca && <UsingOrcaContent onImageClick={setLightbox} />}
            {isEssay && <ThoroughlyConsciousIgnoranceContent onImageClick={setLightbox} />}

            {isEssay && (
              <div style={styles.footerNav}>
                <button style={styles.footerNavButton} onClick={() => navigate('/')}>
                  <span style={styles.footerArrow}>←</span> use orca
                </button>
                <button style={styles.footerNavButton} onClick={() => navigate('/using-orca')}>
                  learn more about orca <span style={styles.footerArrow}>→</span>
                </button>
              </div>
            )}

            {isUsingOrca && (
              <div style={styles.footerNavLeft}>
                <button style={styles.footerNavButton} onClick={() => navigate('/')}>
                  <span style={styles.footerArrow}>«</span> use orca
                </button>
                <button style={styles.footerNavButton} onClick={() => navigate('/thoroughly-conscious-ignorance')}>
                  <span style={styles.footerArrow}>←</span> thoroughly conscious ignorance
                </button>
              </div>
            )}
          </div>
        </div>

        {lightbox && (() => {
          const slide = lightbox.slides[lightbox.index];
          const hasMultiple = lightbox.slides.length > 1;
          const canPrev = lightbox.index > 0;
          const canNext = lightbox.index < lightbox.slides.length - 1;
          return (
            <div style={styles.lightboxOverlay} onClick={() => setLightbox(null)}>
              <div style={styles.lightboxContent} onClick={e => e.stopPropagation()}>
                <img
                  src={slide.image}
                  alt="Expanded view"
                  style={styles.lightboxImage}
                />
                {slide.caption && (
                  <p style={styles.lightboxCaption}>{slide.caption}</p>
                )}
                {hasMultiple && (
                  <div style={styles.lightboxControls}>
                    <button
                      style={{ ...styles.lightboxArrow, opacity: canPrev ? 1 : 0.3 }}
                      onClick={() => canPrev && setLightbox(prev => ({ ...prev, index: prev.index - 1 }))}
                      disabled={!canPrev}
                    >{'←'}</button>
                    <span style={styles.lightboxIndicator}>
                      {lightbox.index + 1} of {lightbox.slides.length}
                    </span>
                    <button
                      style={{ ...styles.lightboxArrow, opacity: canNext ? 1 : 0.3 }}
                      onClick={() => canNext && setLightbox(prev => ({ ...prev, index: prev.index + 1 }))}
                      disabled={!canNext}
                    >{'→'}</button>
                  </div>
                )}
                <button
                  style={styles.lightboxClose}
                  onClick={() => setLightbox(null)}
                >{'×'}</button>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ── Single-column layout (fallback) ───────
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.pageTitle}>{title}</h1>
        <p style={styles.placeholder}>This page is under construction. Content coming soon.</p>

        <div style={styles.commentsSection}>
          <h2 style={styles.commentsHeading}>{commentsHeading}</h2>

          {isGuest && (
            <p style={styles.loginNote}>Log in to add comments and vote.</p>
          )}

          {!isGuest && (
            <div style={styles.addComment}>
              <textarea
                style={styles.textarea}
                value={commentBody}
                onChange={e => setCommentBody(e.target.value)}
                placeholder="Add a comment..."
                maxLength={2000}
                rows={3}
              />
              <button
                style={{
                  ...styles.addButton,
                  opacity: submitting || !commentBody.trim() ? 0.5 : 1,
                }}
                onClick={handleAddComment}
                disabled={submitting || !commentBody.trim()}
              >
                {submitting ? 'Adding...' : 'Add Comment'}
              </button>
            </div>
          )}

          {loading ? (
            <p style={styles.loadingText}>Loading comments...</p>
          ) : comments.length === 0 ? (
            <p style={styles.emptyText}>No comments yet.</p>
          ) : (
            <div style={styles.commentList}>
              {comments.map(comment => (
                <div key={comment.id}>
                  {renderComment(comment)}

                  {/* Inline reply form */}
                  {replyingTo === comment.id && (
                    <div style={styles.replyForm}>
                      <textarea
                        style={styles.replyTextarea}
                        value={replyBody}
                        onChange={e => setReplyBody(e.target.value)}
                        placeholder="Write a reply..."
                        maxLength={2000}
                        rows={2}
                        autoFocus
                      />
                      <div style={styles.replyFormButtons}>
                        <button
                          style={{
                            ...styles.replySubmitButton,
                            opacity: replySubmitting || !replyBody.trim() ? 0.5 : 1,
                          }}
                          onClick={() => handleAddReply(comment.id)}
                          disabled={replySubmitting || !replyBody.trim()}
                        >
                          {replySubmitting ? 'Replying...' : 'Reply'}
                        </button>
                        <button
                          style={styles.replyCancelButton}
                          onClick={() => { setReplyingTo(null); setReplyBody(''); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Replies */}
                  {comment.replies && comment.replies.length > 0 && (
                    <div style={styles.repliesContainer}>
                      {comment.replies.map(reply => renderComment(reply, true))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    height: '100%',
    overflowY: 'auto',
    backgroundColor: '#faf9f7',
  },
  // ── Single-column (fallback) ───────────────
  content: {
    maxWidth: '680px',
    margin: '0 auto',
    padding: '40px 20px',
  },
  // ── Using-orca layout ────────────────────────────
  twoColWrapper: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '40px 20px',
  },
  leftCol: {
  },
  // ── Lightbox ────────────────────────────────────────────
  lightboxOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    cursor: 'pointer',
  },
  lightboxContent: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    maxWidth: '90vw',
    maxHeight: '90vh',
    cursor: 'default',
  },
  lightboxImage: {
    maxWidth: '90vw',
    maxHeight: '70vh',
    border: '1px solid #e0e0e0',
    display: 'block',
  },
  lightboxCaption: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#ddd',
    lineHeight: '1.5',
    marginTop: '12px',
    maxWidth: '700px',
    textAlign: 'center',
  },
  lightboxControls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    marginTop: '12px',
  },
  lightboxArrow: {
    background: 'none',
    border: '1px solid rgba(255,255,255,0.4)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#ddd',
    padding: '4px 12px',
    lineHeight: 1,
  },
  lightboxIndicator: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#aaa',
  },
  lightboxClose: {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    background: 'none',
    border: 'none',
    color: '#ddd',
    fontSize: '28px',
    cursor: 'pointer',
    lineHeight: 1,
    padding: '4px 8px',
  },
  // ── Shared styles ──────────────────────────────────────
  pageTitle: {
    fontSize: '28px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 16px 0',
  },
  pageTitleCentered: {
    textAlign: 'center',
  },
  footerNav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginTop: '16px',
    paddingTop: '24px',
    borderTop: '1px solid #e8e6e2',
  },
  footerNavLeft: {
    display: 'flex',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: '12px',
    marginTop: '16px',
    paddingTop: '24px',
    borderTop: '1px solid #e8e6e2',
  },
  footerNavButton: {
    padding: '8px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  footerArrow: {
    color: '#777',
  },
  placeholder: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    lineHeight: '1.6',
    margin: '0 0 40px 0',
  },
  commentsSection: {
    borderTop: '1px solid #e8e6e2',
    paddingTop: '24px',
  },
  commentsSectionTwoCol: {
    paddingTop: '0',
  },
  commentsHeading: {
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 16px 0',
  },
  loginNote: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    margin: '0 0 16px 0',
  },
  addComment: {
    marginBottom: '24px',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    resize: 'vertical',
    outline: 'none',
    boxSizing: 'border-box',
    backgroundColor: 'white',
    color: '#333',
  },
  addButton: {
    marginTop: '8px',
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  loadingText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  emptyText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  commentList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  comment: {
    display: 'flex',
    gap: '12px',
    padding: '12px',
    backgroundColor: 'white',
    border: '1px solid #eee',
    borderRadius: '4px',
  },
  commentVoteCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: '28px',
    flexShrink: 0,
  },
  voteButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px',
    lineHeight: 1,
  },
  voteIcon: {
    fontSize: '14px',
    color: '#ccc',
    lineHeight: 1,
  },
  voteCount: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    marginTop: '2px',
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  commentUsername: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  commentTime: {
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  commentText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#444',
    lineHeight: '1.5',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  replyLink: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
    padding: '4px 0 0 0',
  },
  replyForm: {
    marginTop: '8px',
    marginLeft: '40px',
  },
  replyTextarea: {
    width: '100%',
    padding: '8px 10px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    resize: 'vertical',
    outline: 'none',
    boxSizing: 'border-box',
    backgroundColor: 'white',
    color: '#333',
  },
  replyFormButtons: {
    display: 'flex',
    gap: '8px',
    marginTop: '6px',
  },
  replySubmitButton: {
    padding: '4px 12px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  replyCancelButton: {
    padding: '4px 12px',
    backgroundColor: 'transparent',
    color: '#999',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  repliesContainer: {
    marginTop: '8px',
    marginLeft: '40px',
    borderLeft: '2px solid #eee',
    paddingLeft: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  reply: {
    display: 'flex',
    gap: '10px',
    padding: '8px',
  },
};

export default InfoPage;
