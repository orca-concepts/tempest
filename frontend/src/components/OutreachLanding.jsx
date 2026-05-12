import React from 'react';

const OutreachLanding = () => (
  <div style={styles.page}>
    <div style={styles.card}>
      <h1 style={styles.wordmark}>orca</h1>
      <p style={styles.body}>
        <strong>orca is built and ready, but not live.</strong>{' '}
        I am looking for a nonprofit/university to own the operation and hosting.
        Please contact{' '}
        <a href="mailto:orcaconcepts@gmail.com" style={styles.link}>
          orcaconcepts@gmail.com
        </a>{' '}
        if interested.
      </p>
    </div>
  </div>
);

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#faf9f7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  card: {
    maxWidth: '600px',
    width: '100%',
    textAlign: 'center',
  },
  wordmark: {
    margin: '0 0 32px 0',
    fontSize: '36px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  body: {
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: '1.6',
    margin: 0,
  },
  link: {
    color: '#333',
    textDecoration: 'underline',
    textDecorationColor: '#999',
    textUnderlineOffset: '2px',
  },
};

export default OutreachLanding;
