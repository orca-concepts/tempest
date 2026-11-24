import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { pagesAPI } from '../services/api';

const PAGE_TITLES = {
  'using-orca': 'What is Orca?',
  'thoroughly-conscious-ignorance': 'Thoroughly Conscious Ignorance',
};

// ── What is orca? content (left column) ──────────────────────
const UsingOrcaContent = ({ onImageClick, navigate }) => {
  const showImage = (file, alt, maxWidth) => (
    <div style={{ marginBottom: '28px' }}>
      <img
        src={`/images/using-orca/${file}`}
        alt={alt}
                style={{ ...usingOrcaStyles.heroImage, ...(maxWidth ? { maxWidth, margin: '0 auto' } : {}) }}
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
        Orca treats research questions as categories. An open goal question holds together 
        the more concrete questions that pursue it and the linked research that answers them.
      </p>
  
      <div style={usingOrcaStyles.sectionTitle}>Goal questions as categories</div>
      <p style={usingOrcaStyles.intro}>
        Exploring the relationship between members of the same goal category can inspire new ideas.
        Answered questions are ordered by the publication date of their research, with open questions on top,
        so scrolling through a goal question shows how it has been pursued. Each answer links its paper and 
        states the finding.
      </p>
      {showImage('goal-page.png', 'A goal question page with answered and open child questions')}

      <div style={usingOrcaStyles.sectionTitle}>Curated communities with researcher feedback</div>
      <p style={usingOrcaStyles.intro}>
        The moderators of a community decide which questions appear, how they are grouped,
        and which research answers them.
      </p>
      {showImage('edit-mode.png', 'A community page in edit mode')}
      <p style={usingOrcaStyles.intro}>
        Readers can suggest rewordings, new questions, and changes to answers. 
        Moderators reply and mark each suggestion incorporated or declined, so the graph keeps pace with its field.
      </p>
      {showImage('feedback.png', "A reader suggestion with an editor's reply", '420px')}
      <p style={usingOrcaStyles.intro}>
        The graph view shows a community's full structure, with its answers, at a glance:
      </p>
      {showImage('graph-view.png', 'Graph view of a community')}

      <div style={usingOrcaStyles.sectionTitle}>Open communities</div>
      <p style={usingOrcaStyles.intro}>
        Communities can also be open: anyone can add questions and links, and votes show which directions
        people favor.
      </p>

      <p style={usingOrcaStyles.intro}>
        This is a free, open-source project for use by researchers:{' '}
        <a href="https://github.com/orca-concepts/tempest" target="_blank" rel="noopener noreferrer" style={usingOrcaStyles.subtleLink}>https://github.com/orca-concepts/tempest</a>.
        {' '}In general, this app aims to index information in a way that is more closely aligned to the goals of those accessing it, an idea that could be iterated on.
      </p>
    </div>
  );
};

// ── Thoroughly Conscious Ignorance essay (left column) ───────
// Position paper text (November 2026). Figures live in /images/tci/.
const TCI_SECTIONS = [
  {
    title: 'Introduction',
    paras: [
      'The large majority of organizational mechanisms in science index information based on what is known; what we don’t know is often discussed but rarely the primary object in the arrangement of scientific material (Boguslav et al., 2023). These mechanisms thus fail to attach to the ultimate goal of researchers who use them: discovery. At the moment of discovery, the landscape of open research questions changes: some are closed, some reframed, some created. These questions make up the conscious ignorance that Maxwell describes, and in this paper I focus on how thoroughly conscious that ignorance is, how vivid a landscape we have painted. Used correctly, research questions can become an organizing principle, a framing device from which to access information and shape our understanding. I argue that building that frame and integrating it into the processes of creating and accessing research will allow us to pursue more thoroughly conscious ignorance and lay a better foundation for advances in science.',
    ],
  },
  {
    title: 'Goal-Derived Categories',
    paras: [
      'The project of thoroughly conscious ignorance is a project of structuring this dynamic landscape of questions, mapping out the terrain of known unknowns by drawing connections between open and closed questions. We can see that the nature of such connections has been explored from several directions. Linguist Craige Roberts describes the primary goal of discourse, “communal inquiry,” as an attempt to discover and share “the way things are,” and from that abstract aim the task is to develop strategies of subinquiries, a process of finding the smaller questions that constitute the larger ones (Roberts, 2012, p. 6:4). In education, Joseph Krajcik’s project-based learning model focuses on driving questions that motivate students to learn; a quality of driving questions is to enable students to generate subquestions (Krajcik et al., 2003). In organizational behavior, goal or problem decomposition is used to enhance resource planning and decision making (Armstrong et al., 1975); for academics, open research questions are the goals to be decomposed.',
      'The common thread is a practice of turning questions into categories, grouping them together for an epistemic purpose represented by a broader question. Categorization is central to cognition (Harnad, 2005) and thus to understanding information, and what ultimately holds together a category is the purpose it serves. Lisa Feldman Barrett argues that the brain constructs even perception and emotion through goal-derived categorization (Barrett, 2017). If our cognition arises from categorizing that is contingent on and derived from our goals, we should evaluate categories on the basis of the shared epistemic goals they might serve and integrate them into our methods of storing and accessing information. This means we should focus on the thread of goal-derivation inherent in the categories we use and intentionally develop them to hold informational resources pertinent to the shared goal. Externalizing a core cognitive mechanism developed for individual goals and extrapolating it to shared goals is a phenomenon that has worked already with, for example, language: mental concepts were vocalized in service to shared goals. In the landscape of open and closed research questions, the development of goal-derived categories would look like a hierarchy where answering a child question is a sub-goal of answering its parent (Figure 1). When you reach a question so concrete as to be closed by research, the question is used to store that research.',
      { figure: ['figure-1.png'], alt: 'A goal question with three closed child questions beneath it', caption: 'Figure 1: The goal of answering the top question is served by the goals of answering the questions beneath it' },
      'To test whether such hierarchies are workable in practice, I built an open-source prototype, Orca (Williams, 2026); the figures that follow are drawn from it. In the prototype, research questions can be categorized under common goal parents. The goal questions should sit at a productive level of breadth and abstraction comparable in function to a review article, which surveys the work done in a specific topic and suggests what might be left to do. Likewise, goal questions should be specific enough to meaningfully group their constituent questions while leaving room for future work. The benefit of graphing questions like this is that gaps will appear: the goal question and the work already done in its service invite researchers to fill in the remainder with new questions and research projects.',
      { figure: ['figure-2.png'], alt: 'An Orca goal question page with three closed child questions and their linked research', caption: 'Figure 2: A goal question about soil with three closed child questions (Orca prototype)' },
      'The visual interface of a given goal question becomes a resource for those pursuing the goal. The closed questions are sorted by the publication date of the associated research, so as you scroll through the page you are tracing the goal-derived threads that hold the category together, seeing an image of its progress that allows you to think productively about future pursuits in achieving that goal. Seeing and interacting with the live development of these goal-derived question categories while exploring research papers could help researchers by strengthening their concept of ‘research question’ into a more complex, configurable, and extensible tool for reasoning about their field.',
      'A key feature of question graphs is that their structure can change as the landscape of research questions changes. Looking at Figure 2, it might make sense to group some of the closed questions under an intermediate open question that still sits below “Does carbon added…”. The new question becomes a goal category of its own, with its own visible gaps. Once an intermediate question exists, it creates a new layer of abstraction, inviting sibling open questions alongside it, each of which invites new questions and research. The same restructuring could apply at the top of the graph: grouping existing top-level goal questions under a broader, more abstract parent for further organization of the field. While an ever-expanding set of closed research questions listed under a single goal parent would lose its value in framing an area of research, graphs that are restructured as the body of literature grows can remain as goal-derived categories that help readers think about the current shape of their field and the paths forward.',
    ],
  },
  {
    title: 'Related Approaches',
    paras: [
      'Several recent projects have taken the approach of treating questions as conceptual objects to be mapped in research work. Discourse Graphs (Chan et al., 2024) break scientific arguments into questions, claims and evidence, linked by relations of support and opposition. They are built mostly by individual researchers and labs, and the medium allows users to synthesize and share complex information efficiently. Octopus (n.d.) also breaks the publication of research work into linked units, including a “Research Problem” that later work can attach to. The Open Research Knowledge Graph (Jaradeh et al., 2019) describes the contributions of papers in structured, machine-readable form, including research problems, and again integrates this with the other elements of research work.',
      'What distinguishes question graphs from the above approaches is both the emphasis on goal-derived categorization in the development of research questions and the editorial, as opposed to individual researcher, ownership of the graphs, which I will describe in the next section. Boguslav et al.’s (2023) ignorance-base complements the question graph approach by using natural language processing to pull statements of ignorance out of biomedical literature. This kind of automatic extraction can support the building of question graphs outlined below.',
    ],
  },
  {
    title: 'Building Question Graphs',
    paras: [
      'There are several pragmatic constraints to consider in the actual construction of question graphs, all of which suggest that they should be built and maintained by academic journals.',
      'First, the scope of a given set of graphs should be established: how broad a swathe of high-level questions are of interest to a single audience of researchers? Journals have already situated themselves in their selected fields, drawing the disciplinary boundaries that best serve their readership in terms of interest and value. Each journal, occupying this territory, can build a system of question graphs to populate it with the goal questions that represent the aims of the field and the questions closed by past research.',
      'There is also a tension between the value of crowd-sourcing question graphs and that of curating them. To maintain a navigable and coherent experience, each system of graphs should be owned and maintained by a central moderator or group of moderators, such as the editors of a journal. Journal ownership also circumvents the problem of “authorship bottleneck” (Chan, 2021), where researchers do not have time to adopt another system of documentation that sits outside of their normal workflows. But editorial ownership should be supported by feedback from the readership/authorship of the constituent research. Readers and authors should be able to suggest edits to the graphs and the linked material (Figure 3). It is through this bidirectional engagement that a field can be most effectively mapped.',
      { figure: ['figure-3a.png', 'figure-3b.png'], ratios: [612 / 464, 1036 / 741], alt: 'The reader feedback form and a public record of feedback with an editor’s reply', caption: 'Figure 3: Feedback form for researchers (left); public record of feedback (right)' },
      'One could argue that a single journal’s graphs will be incomplete, since work toward any goal is rarely published in one venue. A goal question restricted to a single journal’s papers would show “gaps” that simply represent work published elsewhere. So the curation of question graphs should pertain to the questions, not the linked material that answers them. Like a review article that links to research wherever it was published, a question graph should describe current and future progress for specific problems, and so journals should attach any research that closes questions belonging to a goal.',
      'The purpose of this project is to shape future research, so it is important to recognize the ways in which question graphs can fit into the processes by which research is funded and published. I see two primary integrations:',
      { list: [
        'When submitting a paper, researchers can propose where it might sit in the journal’s graphs: the new question their work answers and the goal question(s) it serves. Editors can accept or adjust that placement as part of review; building and maintaining the graphs could be a helpful supplemental practice to reviewing submitted papers. By linking to a question, authors can quickly contextualize the content and scope of their contribution. Journals can also reference goal questions when soliciting new work.',
        'Researchers applying for grants can make the same kind of placement for a question they want to answer with a new project. Linking to a position in a journal’s graph lets panels judge the proposal against the field’s stated aims, and the graph gives panelists, who may not be specialists in the exact subfield, a unique context of the prior work the proposal builds on.',
      ] },
      'There could be other beneficial integrations: review articles and calls for papers could use graphs as reference tools; editors could source peer reviewers from graph-proximate research; students at various levels of education in a field could use the visibility of mapped questions to find areas they want to pursue. The power of explicitly building goal-derived, dynamic categories in research publication is that many tangential tasks and goals are also served.',
    ],
  },
  {
    title: 'Costs and Benefits for Journals',
    paras: [
      'Building and maintaining question graphs would involve a certain amount of work for journal editors, so it is important to be clear about that work and what journals might stand to gain from doing it. As papers become more freely available through preprints and open access, hosting and distributing research becomes a less important part of a journal’s mandate, and deciding what is relevant and of high quality becomes even more important. Question graphs represent an extension of the moderation that journals do when they decide what to publish, surfacing the underlying aims against which relevance and importance are judged. Crucially, this also makes these aims more granular and public, so that elevating the value of something, for example null results, in a specific context can be efficiently expressed.',
      'Question graphs also showcase a journal’s published work in a new way. Papers that might otherwise be stored in separate issues can appear together as contributions toward a common goal, ordered by publication date so that readers can see how the journal’s work has advanced that goal over time. Open questions under a goal could serve as a standing call for papers, signaling the work a journal wants to receive and giving prospective authors a precise way to show how their submission fits.',
      'The cost of building these graphs can be kept small. AI tools can analyze the sections of papers where these questions are frequently discussed and help draft the closed questions or find shared goals for editors to review. A starting point could be gathering closed questions and their publications in the journal from a short lookback period, then grouping by shared goal questions and looking for more closed questions in outside publications. And, as explained in the integrations above, the maintenance of an existing graph can ultimately become part of the natural flow of submissions rather than a separate project.',
      'Finally, the public feedback channel described above gives journals an ongoing relationship with their readers and authors. Researchers can take a more active role in shaping how the field’s aims are stated and developed, which creates a more engaging experience with the material.',
    ],
  },
  {
    title: 'Conclusion: A New Dimension of Quality Moderation',
    paras: [
      'In research, there are powerful tools for organizing what is known, and comparatively few for organizing what is not yet known. The landscape of thoroughly conscious ignorance is widely discussed but not an operationalized tool for storing information. Question graphs make that landscape explicit and systematic by treating research questions as goal-derived categories: closed questions grouped under the goals they serve, with the remaining gaps inviting new work.',
      'I have argued that journals are the natural owners of these graphs. They already define the disciplinary territory readers are interested in, exercise editorial judgment with a field’s goals in mind, and are positioned at the places where research is submitted, reviewed, and (through grant applications that cite their publications) funded. Building question graphs adds a missing dimension to quality moderation: directly and continuously stating the aims of a field and receiving feedback from the researchers working toward them. Today, this happens only periodically, through review articles and special issues; doing it more thoroughly could make research publication a more productive conversation about where a field is going.',
      'Robert K. Merton raised the question of “whether scientific disciplines differ in the extent of routinely specifying ignorance and how this affects the growth of knowledge” (Merton, 1987, p. 1). I think not only specifying ignorance but structuring it can indeed be integrated into the routines of science, and that research publication is the place for that integration.',
    ],
  },
];

// Each reference: text, plus an optional link shown after it.
const TCI_REFERENCES = [
  ['Armstrong, J. S., Denniston, W. B., & Gordon, M. M. (1975). The use of the decomposition principle in making judgments. Organizational Behavior and Human Performance, 14(2), 257–263.', 'https://doi.org/10.1016/0030-5073(75)90028-8'],
  ['Barrett, L. F. (2017). The theory of constructed emotion: An active inference account of interoception and categorization. Social Cognitive and Affective Neuroscience, 12(1), 1–23.', 'https://doi.org/10.1093/scan/nsw154'],
  ['Boguslav, M. R., Salem, N. M., White, E. K., Sullivan, K. J., Bada, M., Hernandez, T. L., Leach, S. M., & Hunter, L. E. (2023). Creating an ignorance-base: Exploring known unknowns in the scientific literature. Journal of Biomedical Informatics, 143, Article 104405.', 'https://doi.org/10.1016/j.jbi.2023.104405'],
  ['Chan, J. (2021). Sustainable authorship models for a discourse-based scholarly communication infrastructure. Commonplace, 1(1).', 'https://doi.org/10.21428/6ffd8432.8b4aad0c'],
  ['Chan, J., Akamatsu, M., Vargas, D., Kawerau, L., & Gartner, M. (2024). Steps towards an infrastructure for scholarly synthesis (arXiv:2407.20666). arXiv.', 'https://doi.org/10.48550/arXiv.2407.20666'],
  ['Einstein, A., & Infeld, L. (1938). The evolution of physics. Simon & Schuster.', null],
  ['Firestein, S. (2012). Ignorance: How it drives science. Oxford University Press.', null],
  ['Harnad, S. (2005). To cognize is to categorize: Cognition is categorization. In H. Cohen & C. Lefebvre (Eds.), Handbook of categorization in cognitive science (pp. 20–42). Elsevier.', null],
  ['Jaradeh, M. Y., Oelen, A., Farfar, K. E., Prinz, M., D’Souza, J., Kismihók, G., Stocker, M., & Auer, S. (2019). Open Research Knowledge Graph: Next generation infrastructure for semantic scholarly knowledge. In M. Kejriwal, P. Szekely, & R. Troncy (Eds.), Proceedings of the 10th International Conference on Knowledge Capture (pp. 243–246). Association for Computing Machinery.', 'https://doi.org/10.1145/3360901.3364435'],
  ['Krajcik, J. S., Czerniak, C. M., & Berger, C. F. (2003). Teaching science in elementary and middle school classrooms: A project-based approach (2nd ed.). McGraw-Hill.', null],
  ['Merton, R. K. (1987). Three fragments from a sociologist’s notebooks: Establishing the phenomenon, specified ignorance, and strategic research materials. Annual Review of Sociology, 13, 1–28.', null],
  ['Octopus. (n.d.). Free, fast and fair: The global primary research record. Retrieved November 18, 2026, from', 'https://www.octopus.ac'],
  ['Roberts, C. (2012). Information structure in discourse: Towards an integrated formal theory of pragmatics. Semantics and Pragmatics, 5, Article 6.', 'https://doi.org/10.3765/sp.5.6'],
  ['Williams, M. (2026). Orca [Computer software]. Orca Concepts LLC.', 'https://orcaconcepts.org'],
];

const ThoroughlyConsciousIgnoranceContent = ({ onImageClick }) => {
  const showFigure = (fig) => (
    <div style={{ marginBottom: '28px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        {fig.figure.map((file, i) => (
          <img
            key={file}
            src={`/images/tci/${file}`}
            alt={fig.alt}
            style={{
              ...usingOrcaStyles.heroImage,
              ...(fig.figure.length > 1 ? { width: 'auto', minWidth: 0, flex: `${fig.ratios[i]} 1 0` } : {}),
            }}
            onClick={() => onImageClick({
              slides: fig.figure.map(f => ({ image: `/images/tci/${f}`, caption: fig.caption })),
              index: i,
            })}
          />
        ))}
      </div>
      <p style={{ ...usingOrcaStyles.caption, margin: '8px 0 0 0', textAlign: 'center' }}>{fig.caption}</p>
    </div>
  );

  const renderPara = (p, key) => {
    if (typeof p === 'string') return <p key={key} style={usingOrcaStyles.intro}>{p}</p>;
    if (p.figure) return <div key={key}>{showFigure(p)}</div>;
    if (p.list) {
      return (
        <ol key={key} style={{ ...usingOrcaStyles.intro, paddingLeft: '1.5em' }}>
          {p.list.map((item, i) => <li key={i} style={{ marginBottom: '0.75em' }}>{item}</li>)}
        </ol>
      );
    }
    return null;
  };

  return (
    <div>
      <p style={{ ...usingOrcaStyles.caption, textAlign: 'center', fontSize: '1.05em', margin: '-8px 0 24px 0' }}>
        A Goal-Derived Model for Organizing Journal Articles
      </p>

      <p style={usingOrcaStyles.epigraph}>
        The formulation of a problem is often more essential than its solution, which may be merely a matter of
        mathematical or experimental skill. To raise new questions, new possibilities, to regard old problems from
        a new angle, requires creative imagination and marks real advance in science.
      </p>
      <p style={usingOrcaStyles.epigraphAttribution}>Einstein and Infeld (1938, p. 92)</p>

      <p style={usingOrcaStyles.epigraph}>
        Thoroughly conscious ignorance is the prelude to every real advance in science.
      </p>
      <p style={usingOrcaStyles.epigraphAttribution}>James Clerk Maxwell, as cited in Firestein (2012, p. 7)</p>


      {TCI_SECTIONS.map(section => (
        <div key={section.title} style={{ marginTop: '32px' }}>
          <div style={usingOrcaStyles.sectionTitle}>{section.title}</div>
          {section.paras.map((p, i) => renderPara(p, i))}
        </div>
      ))}


      <div style={{ marginTop: '32px' }}>
        <div style={usingOrcaStyles.sectionTitle}>References</div>
        {TCI_REFERENCES.map(([text, url]) => (
          <p key={text} style={{ ...usingOrcaStyles.footnote, paddingLeft: '2em', textIndent: '-2em', margin: '0 0 10px 0' }}>
            {text}
            {url && (
              <>
                {' '}
                <a href={url} target="_blank" rel="noopener noreferrer" style={usingOrcaStyles.subtleLink}>{url}</a>
              </>
            )}
          </p>
        ))}
      </div>
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
  footnote: {
    fontSize: '1.0em',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    lineHeight: '1.6',
    margin: '8px 0 20px 0',
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
  subtleLinkButton: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: '#333',
    textDecoration: 'underline',
    textDecorationColor: '#ccc',
    textUnderlineOffset: '2px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: 'inherit',
    lineHeight: 'inherit',
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
            {isUsingOrca && <UsingOrcaContent onImageClick={setLightbox} navigate={navigate} />}
            {isEssay && <ThoroughlyConsciousIgnoranceContent onImageClick={setLightbox} />}


            {isEssay && (
              <div style={styles.footerNav}>
                <button style={styles.footerNavButton} onClick={() => navigate('/')}>
                  <span style={styles.footerArrow}>←</span> Use Orca
                </button>
                <button style={styles.footerNavButton} onClick={() => navigate('/using-orca')}>
                  What is Orca? <span style={styles.footerArrow}>→</span>
                </button>
              </div>
            )}

            {isUsingOrca && (
              <div style={styles.footerNavLeft}>
                <button style={styles.footerNavButton} onClick={() => navigate('/')}>
                  <span style={styles.footerArrow}>«</span> Use Orca
                </button>
                <button style={styles.footerNavButton} onClick={() => navigate('/thoroughly-conscious-ignorance')}>
                  <span style={styles.footerArrow}>←</span> Thoroughly Conscious Ignorance
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
