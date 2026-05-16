import React from 'react';
import { useNavigate } from 'react-router-dom';

const TheStormPage = () => {
  const navigate = useNavigate();
  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>The Categorical Storm</h1>
      <p style={styles.body}>
        In her book How Emotions Are Made, Lisa Feldman Barrett describes our cognition as a ‘storm of predictions’, a vast and complex predictive model continuously built from conceptual hierarchies. These hierarchies ‘cascade’ from the abstract to the concrete in the unending task of predicting and constructing our experience.      </p>
      <p style={styles.body}>
        One can see these cascades as a unit of cognition and consciousness. They are building blocks, flexible and extensible enough to construct the complexity of our experience and by extension all the creations of our species; in a sense, they are our greatest tool. Their mechanism is category: the more abstract parent concept is a group which contains in some way the more concrete child concepts, and so on all the way down the hierarchy.      </p>
      <p style={styles.body}>
        In the storm, these cascades are lightning that strikes from the abstract clouds to the concrete ground. Neatly and carefully packed ontologies are an underuse of our greatest tool and inhibit its ability to generate creation and understanding. Instead, we need a shared sixth sense for category. We need a looking glass that allows us to perceive the storm without distilling it, to see it for the chaotic mess that it is.      </p>
      <p style={styles.body}>
        <strong>orca</strong> is a system of categories: concept graphs you continuously construct, explore, and connect, building maps of categories that cascade from abstract to concrete. Any concept can serve as a link to research documents, such that exploring the graphs exposes you to research material, unbounded by discipline or any category other than the one on which you are focused.
      </p>
      <h2 style={styles.subheading}>Values in Science</h2>
      <p style={styles.body}>The primary domain for these dynamic category graphs should be values, conceptual expressions of quality in science. By developing them with the flexibility and extensibility of this kind of graph, we can capture the values driving the cutting edge of research and use them as a framework for thinking about new ideas. Values, like all conceptual domains, are inherently messy, and because research values are perhaps the most critical domain to our species, we have an obligation to lean into this messiness rather than attempting to simplify it.
      </p>
      <p style={styles.body}>With dynamic value categories as the organizing mechanism for research material, you can explore research through a hyper-specific lens and at the same time see more of it than you otherwise would. The graphs in <strong>orca</strong> are designed to be connected, so you can not only move up and down category hierarchies, but tunnel into other graphs or compare alternate parent contexts of the same concept. Moving multi-dimensionally through this system of categories and landing on links to the research material that best exhibits them will allow you to find creativity in the values of research.
      </p>
      <h2 style={styles.subheading}>The Prosthesis of Technology</h2>
      <p style={styles.body}>In their article, “The Extended Mind”, Andy Clark and David Chalmers describe the relationship between our brains and the structured information around us as a single system of cognition, with the technologies that store and present that information acting as prosthetic devices in our thinking. <strong>orca</strong> is an attempt to more closely integrate the prosthesis with the biological processes of conceptual development it seeks to augment.
      </p>
      <p style={styles.body}>If the predictive cascades in a single mind are a storm, there is also a collective storm of conceptual development that we navigate together in the global pursuit of knowledge. <strong>orca</strong> is a means of connecting to the categorical mechanism of that development and amplifying the instantiations of value concepts in research. Use it to find creativity in the maintenance of these categories; lean into the storm and embrace its chaos.
      </p>
      <p style={{ ...styles.body, marginTop: '40px', textAlign: 'center' }}>
        <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { window.scrollTo(0, 0); navigate('/using-orca'); }} role="link" tabIndex={0}>Using orca →</span>
      </p>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '760px',
    margin: '0 auto',
    padding: '40px 20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    lineHeight: 1.6,
    textAlign: 'left',
  },
  heading: {
    fontSize: '28px',
    fontWeight: 'normal',
    marginBottom: '20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    textAlign: 'center',
  },
  subheading: {
    fontSize: '22px',
    fontWeight: 'normal',
    marginTop: '32px',
    marginBottom: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    textAlign: 'center',
  },
  body: {
    fontSize: '18px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default TheStormPage;
