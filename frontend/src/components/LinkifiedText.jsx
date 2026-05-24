import React, { useState, useEffect, useRef } from 'react';

/**
 * In-orca URL regex pattern — must match character-for-character with the
 * pattern defined in backend/src/utils/inOrcaLinks.js. They are not literally
 * shared at build time, but must be kept in sync manually.
 */
// Note: [\\d,]* intentionally allows zero characters after ?path= — root concepts
// have empty graph_path and their share URLs emit ?path= with no value.
const IN_ORCA_LINK_PATTERN =
  '(?:https://orcaconcepts\\.org|https?://localhost(?::\\d+)?)/(?:concept|superconcept|link|tunnel)/\\d+(?:\\?path=[\\d,]*)?(?:#(?:link|tunnel)-\\d+)?';

const IN_ORCA_LINK_REGEX_GLOBAL = new RegExp(IN_ORCA_LINK_PATTERN, 'g');

const toggleLinkStyle = { fontSize: '11px', color: '#999', cursor: 'pointer', textDecoration: 'underline', fontFamily: '"EB Garamond", Georgia, serif' };

const linkStyle = { color: '#333', textDecoration: 'underline', fontFamily: 'inherit', cursor: 'pointer' };

/**
 * LinkifiedText — drop-in replacement for ClampedText on user-authored comment
 * surfaces. Same props (text, lines, style), plus optional `disabled` to skip
 * linkification. Only in-orca URLs become clickable hyperlinks; everything else
 * renders as plain text.
 */
const LinkifiedText = ({ text, lines = 3, style = {}, disabled = false }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) setOverflows(ref.current.scrollHeight > ref.current.clientHeight + 1); }, [text]);
  if (!text || !text.trim()) return null;
  const clampStyle = !expanded ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {};

  const renderContent = () => {
    if (disabled) return text;

    // Split text on in-orca URLs, preserving the matched URLs as separate tokens
    const parts = [];
    let lastIndex = 0;
    const regex = new RegExp(IN_ORCA_LINK_PATTERN, 'g');
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Add preceding plain text
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'link', value: match[0] });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining plain text
    if (lastIndex < text.length) {
      parts.push({ type: 'text', value: text.slice(lastIndex) });
    }

    if (parts.length === 0) return text;

    return parts.map((part, i) => {
      if (part.type === 'link') {
        return (
          <a
            key={i}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
            onClick={e => e.stopPropagation()}
          >
            {part.value}
          </a>
        );
      }
      return <React.Fragment key={i}>{part.value}</React.Fragment>;
    });
  };

  return (
    <div>
      <div ref={ref} style={{ ...style, ...clampStyle }}>{renderContent()}</div>
      {overflows && (
        <span onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
          style={toggleLinkStyle}>{expanded ? 'Show less' : 'Show more'}</span>
      )}
    </div>
  );
};

export default LinkifiedText;
