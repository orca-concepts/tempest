import React, { useState, useEffect, useRef } from 'react';

const toggleLinkStyle = { fontSize: '11px', color: '#999', cursor: 'pointer', textDecoration: 'underline', fontFamily: '"EB Garamond", Georgia, serif' };

const ClampedText = ({ text, lines = 3, style = {} }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) setOverflows(ref.current.scrollHeight > ref.current.clientHeight + 1); }, [text]);
  if (!text || !text.trim()) return null;
  const clampStyle = !expanded ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {};
  return (
    <div>
      <div ref={ref} style={{ ...style, ...clampStyle }}>{text}</div>
      {overflows && (
        <span onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
          style={toggleLinkStyle}>{expanded ? 'Show less' : 'Show more'}</span>
      )}
    </div>
  );
};

export default ClampedText;
