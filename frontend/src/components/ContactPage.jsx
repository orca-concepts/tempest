import React from 'react';

const ContactPage = () => {
  return (
    <div style={styles.container}>
      <p style={styles.paragraph}>
        Contact me at{' '}
        <a href="mailto:orcaconcepts@gmail.com" style={styles.subtleLink}>orcaconcepts@gmail.com</a>
      </p>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '760px',
    padding: '40px 20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: 1.6,
  },
  paragraph: {
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
  },
  subtleLink: {
    color: 'inherit',
    textDecoration: 'underline',
    textDecorationColor: '#ccc',
    textUnderlineOffset: '2px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default ContactPage;
