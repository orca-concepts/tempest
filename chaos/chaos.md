# Chaos — the ORCA Graph-Seeding Tool Rubric

**Version:** 0.5
**Purpose of this file:** This is the tool's *brain* — the principles, the run procedure,
and the tunable knobs Chaos uses to propose contributions to Orca's concept graphs. It is
meant to be read, argued with, and edited; every run is an opportunity to refine it. It
does **not** store the graph itself (Principle 7).

Chaos is no longer only a concept-extractor. Its deeper job is to build and continually
revise **an evolving model of the researcher** — or of the global amalgam of researchers —
as that researcher interacts with the world of scientific research. Reading papers is the
model's sensory channel; proposing research-shaped concepts approximates its active
channel. Everything below serves that.

Two further commitments frame the aim. Orca is meant to function as an **extended mind** —
a trusted external store of categories the researcher offloads to — and Chaos works to grow
that store's **integrated information**, connecting what was previously separate. See
Foundations.

---

## 0. Changelog

- **v0.1** — First draft. Principles 1–7, run procedure, knob table, values-domain notes.
  Transparency / Rigor / Honesty value seed from two cognitive-science exemplar papers.
- **v0.2** — Major revision and reorganization.
  - Added Section 2 (Foundations): five intellectual commitments — move-step analysis,
    Campbell's monomyth, Foucault, Friston's active inference, Barsalou's Situated Action
    Cycle.
  - Added Principles P8 (co-grounding, promoted from a P5 sub-note), P9 (researcher as
    fulcrum / self-anchoring), P10 (read conduct as move-step analysis), P11 (one evolving
    model with temporal depth).
  - Sharpened P2 with the disposition-vs-behavior line.
  - Filled in the Actions domain (four roots). Re-voiced values as dispositions.
  - Added Section 5 (Situations) and Section 6 (the internal lifecycle map and dialectical
    tradeoff tunnels).
  - Updated run procedure, knobs, and formats. Corpus focus made explicitly
    cross-disciplinary; citation tracking added.
- **v0.3** — Added two foundations: Tononi's integrated information (phi) and Clark &
  Chalmers' extended mind. Added Principles P12 (grow integrated information / the phi
  balance) and P13 (recurrence is the corpus's vote). Added a recurrence-&-phi step to the
  run procedure and a new Section 8 (Architecture & operation) capturing the pipeline,
  the code-vs-Claude split, the staged autonomy, and the validation model. Knobs and
  Formats renumbered to Sections 9 and 10.
- **v0.4** — Made prediction-error the primary learning loop: added P14 (the graph is a set
  of predictions; learn from gaps, non-confirmations, and mis-structures), with a cautious,
  reversible disconfirmation policy and active sampling. Simplified the lifecycle map (Section
  6) from a parallel value system into a phase index over the real concepts; deferred the
  dialectical tradeoff tunnels. Recast Situations (Section 5) as cost/benefit moments
  (Barsalou anchor) that Chaos also learns from research. Added a Learning model to Section 8.
  Trimmed P11's two-value-systems clause. Updated the run procedure, knobs, and formats.
- **v0.5** — Honing from Run 1 (bootstrapping seed). Extended P10 to read the introduction's
  rhetorical moves (Swales CARS Move 1/2) for the early phases (Sensing, Committing) and for
  questions — conduct-reading alone systematically under-populated the front of the life cycle.
  Added a tunnel-directness note to P2 (pair a disposition with the action that most directly
  enacts it).

---

## 1. Purpose

Orca's four domains together model a **cost/benefit analysis of research**:

- **Benefit — what to move toward:** *values* and *open questions*.
- **Cost — what pursuing them takes:** *actions* and *tools*.

A researcher planning new work navigates this landscape. **The tool's meta-objective is
usefulness to a researcher-planner** — not completeness, not taxonomic tidiness. ("Usefulness"
is therefore not a value node; it is the lens every proposal is judged against — P5.)

The cost/benefit frame has two faces of one self: the benefit side (values, questions) is
the **aspirational self** — who I want to be, what I want to know; the cost side (actions,
tools) is the **enacting self** — what I do and use to get there.

The cost/benefit frame reflects what Lisa Feldman Barrett writes about cognition and conscious 
experience as anchored by body budgeting, interoceptive activities in the brain. The 
categorical mechanisms of the brain are thus anchored by questions of finite energy and the 
decisions to be made with it. 

---

## 2. Foundations

Seven bodies of thought Chaos is built to honor. Each is stated as a *commitment*, not a
citation.

- **Move-step analysis (Swales' CARS model).** Genre analysts read research writing as a
  sequence of rhetorical *moves* (establish a territory → establish a niche → occupy it)
  and finer *steps*, each performing a communicative function in the act of claiming
  research space. **Commitment:** Chaos reads a document for what its *conduct* is doing in
  the arc of producing research — the move it represents, the choices it embodies — not for
  the terminology on its surface. (→ P10.)

- **Campbell's monomyth (the hero's journey).** A cyclical event-structure — departure,
  initiation, return — that recurs across stories as a lens for interpreting them.
  **Commitment:** treat the research life cycle as a *cycle* with recognizable stages, and
  read papers as episodes within it. (→ Section 6.)

- **Foucault, *The Order of Things*.** Knowledge is produced through situated acts of
  categorization, with the individual knower at the center as both the one who orders and a
  thing ordered. **Commitment (our reading):** the individual researcher is the fulcrum on
  which the relations of things turn; Orca self-orients every concept around that person.
  (→ P9.)

- **Friston, active inference.** A system separated from its environment by a boundary
  (sensory states flowing in, active states flowing out) maintains an internal generative
  model and revises it to reduce surprise; adaptive models have *temporal depth*.
  **Commitment:** Chaos is one such model of the researcher, revised as it reads. The graph it
  maintains is a set of *predictions* about research, and each new article tests them —
  prediction error is the primary learning signal. The model must also acquire temporal depth,
  tracking research as it unfolds. (→ P11, P14, Section 6.)

- **Barsalou, the Situated Action Cycle.** Concepts are not abstract tokens; they develop
  *within situations of action* that integrate self, environment, action, and outcome, and
  they function to support predictions for action. **Commitment:** Orca's Situations and the
  lifecycle map are exactly these loci — concept development happens inside situated cycles,
  which is why both are first-class. We don't apply the cycle literally, but we borrow its
  anchor: a situation is a *moment of cost and benefit* — actions and the goal-states they
  serve — not merely a coherent set of concepts. (→ Sections 5, 6.)

- **Tononi, integrated information theory.** Consciousness is theorized to track Φ (phi):
  a system has high phi when it is both highly *integrated* (not decomposable without loss)
  and highly *differentiated* (rich in distinct states). IIT is prominent but contested, so
  we use it as a generative heuristic, not a settled measure. **Commitment:** Chaos works to
  grow the graph's integrated information — connecting what was separate while keeping it
  specific — on the wager that a more integrated category store makes its user a more
  integrated thinker. (→ P12.)

- **Clark & Chalmers, the extended mind.** Reliable external resources we offload to —
  Otto's notebook, a stored phone number — count as genuine parts of the cognitive system,
  provided they are reliably available, easily accessed, and *automatically endorsed*.
  **Commitment:** Orca is a cognitive prosthesis the researcher offloads categories to,
  which imposes a trustworthiness bar on the category store. The endorsement criterion is
  exactly P9's "this is mine" — self-anchoring is the precondition for Orca being a genuine
  extension of the mind rather than a database one merely consults.

A convergence worth noting: Campbell's narrative cycle and Barsalou's Situated Action Cycle
arrive independently at the same shape — situated, sequential, self-centered episodes. The
lifecycle map sits on that shared foundation. And four of these commitments form one spine:
the mind models the world (predictive processing, beneath active inference), updates that
model through action and perception (active inference), extends it into trusted technology
(extended mind), and is worth more the more integrated the model becomes (integrated
information). Chaos grows that extended, integrated model.

---

## 3. Core principles

Each is a standalone, editable entry: the rule, why it holds, and a Yes/No example.

### P1 — Concept identity by path
A concept is defined by its children, in the context of its parent path. Down a hierarchy
goes general → specific; a child is part of what makes up its parent, though abstractly.

### P2 — Graph qualities, not practices or methods *(sharpened)*
A value graph holds **qualities** (dispositions of the researcher — see P9). A *practice or
strategy* belongs in the **action** graph; an *instrument or method* in the **tool** graph.
- **The disposition-vs-behavior line:** a value is a *standing quality*; the action is its
  *exercise*. They tunnel; they are not the same node. When you tunnel them, pair the
  disposition with the action that *most directly* enacts it (Skeptical ↔ cross-check;
  Measured ↔ calibrated reporting) — not with whatever action the same paper happens to ground.
- **Yes:** "Skeptical of one's own conclusions" (disposition).
- **No:** "Run every defensible version of the analysis" as a *value* — that is the action
  the disposition drives.

### P3 — Subtextual, not terminological
Graph the researcher's lived, tacit conceptualization, not the article's vocabulary. The
right concept is one a researcher would recognize as theirs even if the paper never names
it. Soft line — the word may appear in the source — but aim above the literal text.
- **Yes:** "Forthcoming." **No:** indexing "researcher degrees of freedom" because the
  phrase appears.
- Works with P9: P3 pushes away from text by abstraction; P9 anchors to the self.

### P4 — Grow from encounters, not taxonomy
A new concept appears because a real paper exemplified something the graph could not hold —
not because the taxonomy "felt incomplete." Evidence-led growth keeps the graph
first-person and resists drift into a technical ontology.

### P5 — The cost/benefit lens & the hypothetical-researcher test
Before proposing anything, simulate a researcher planning new work. Ask: would landing on
this concept, and this exemplar document, help them see a benefit (value/question) or a cost
(action/tool) *instantiated in actual research* in a way that informs their plan? If not,
don't propose it. A linked document must be an **exemplar that demonstrates the concept**,
not one that merely discusses it. (Co-grounding, the engine of tunnels, is now P8.)

### P6 — Don't be a prisoner of existing structure
Be willing to insert a concept between an existing parent and child. Under append-only you
never move an edge; you create the new intermediate (Parent → X) and the new edge
(X → child), and support migrates via votes and links. **Restructure freely in the proposal
stage; restructure already-applied structure only when the gain is clear**, since the old
edges persist as residue.

### P7 — Brain vs. state separation *(meta)*
This rubric is the *brain* (how to decide). The database is the *state* (what's decided).
The rubric never hard-codes the current graph.

### P8 — Co-grounding *(promoted to first-class)*
A cross-domain connection is strongest when a **single document instantiates all of its
ends** — then the relationship is witnessed, not guessed. Two applications:
- **Cost/benefit tunnels:** prefer tunnels where one paper exemplifies both the value (or
  question) and the action (or tool) it connects to.
- **Situations:** compose them from member edges that share grounding documents; the
  intersection reading list (Section 5) then falls out for free.
- A connection that no single document grounds on every end is more speculative — propose
  it more cautiously. (Exception: dialectical tradeoff tunnels in the lifecycle map, which
  are validated by reasoning, not documents — Section 6.)

### P9 — The researcher as fulcrum (self-anchoring)
Every concept is a predicate of the researcher's **self**, which is what gives a concept its
felt, "this is mine" quality. Intimacy comes from the *referent* (a person), not from
grammar — so **no first-person pronouns are needed**, and concepts stay short.
- **Values** = *who I am* (dispositions). **Actions** = *what I do*. **Tools** = *what I
  use*. **Questions** = *what I ask*. Voice differs in form across domains, but the anchor —
  the self — is uniform, which is what lets a Situation read as a coherent self-portrait.
- **The phrasing ceiling (composability discipline):** a concept must remain a noun, gerund,
  or short imperative *phrase* that can take a parent and children and read general →
  specific. It may **never** become a declarative clause with a truth value.
  - **Yes:** "Letting others check my work." **No:** "Open data improves reproducibility"
    (a proposition — stops being an ontology node).
- **Guardrail (with P2):** a value-disposition must not slide into the behavior that enacts
  it. ("Skeptical," not "tests the result every way.")

### P10 — Read conduct as move-step analysis
Read a paper for the research *process and effort* it represents — which phase of the life
cycle (Section 6) its conduct instantiates, and what was at stake and traded off there — not
for the words on the page. A paper is a record of *moves a researcher made*. This is the
reading method that produces good exemplars and locates papers in the lifecycle map.
- **Read both ends of the arc.** The conduct in methods/results/discussion documents the
  *mid-to-late* phases (Designing → Reporting). The *early* phases (Sensing the gap,
  Committing to a question) and most *questions* live only in the introduction's rhetorical
  moves — Swales' CARS Move 1 (establish a territory) and Move 2 (establish a niche / the
  gap). Read those moves too, or the front of the life cycle stays empty.

### P11 — One evolving model, with temporal depth
Chaos maintains and revises a *single* model of the researcher as it consumes research
(active inference). There is one value system — Orca's researcher-dispositions (Section 4);
the lifecycle map (Section 6) is no longer a parallel system but a phase index over those same
concepts. The model needs **temporal depth**: a paper sits between prior work it advances and
future work that advances from it, and Chaos tracks this through citation relationships among
linked papers (Section 7), building a progression axis. *How* the model learns from research —
prediction and error — is P14.

### P12 — Grow integrated information (the phi balance)
Prefer additions that raise the graph's *integrated information* (Tononi, used heuristically).
A good addition both **integrates** — connects regions of the graph that were previously
separate or weakly linked — and **differentiates** — adds specific, distinct content. Balance
familiar and novel: an addition that only thickens an already-dense node is redundant (no new
information); one that bridges distant, well-grounded regions raises phi most; one that
connects things with no grounding is noise (integration without differentiation). Part of this
is a plain, inspectable graph metric — does the proposal bridge currently-distant nodes? — so
phi is a surfaced variable, not a vibe.
- **Yes:** a disposition that recurs across two disciplines, bridging their sub-graphs.
- **No:** a fourth near-synonym leaf under an already-rich node.

### P13 — Recurrence is the corpus's vote
With little external ground truth, the strongest empirical signal is **recurrence**: a
specific concept independently re-exemplified by fresh research is the world confirming it
(in active-inference terms, a prediction kept low-surprise — P11). Chaos tracks how often each
concept is independently re-exemplified, treating well-recurring concepts as validated and
one-offs as speculative. Recurrence is also a promotion signal — a specific disposition that
keeps recurring, especially across disciplines, earns a place nearer a root. Recurrence is the
*confirmation* half of the prediction loop (P14).

### P14 — The graph is a set of predictions; learn from prediction error
The whole graph is a standing set of predictions about research, and each new article tests
them. This — not human feedback — is the primary learning signal; the aim is to maximize what
is learned from every article and to lean on curation as little as possible. Three forms of
error, three operations:
- **Gap (under-prediction):** the article instantiates something the graph cannot hold → *add* it.
- **Non-confirmation (doesn't bear out):** the graph holds a concept or situation research keeps
  *not* instantiating → *decay its attention* (append-only forbids deletion; confidence and
  visibility drop instead).
- **Mis-structure:** the article instantiates a concept the graph has, but under a different
  parent path than predicted → *restructure* (P6). The concept was right; the relationship wasn't.

Recurrence (P13) is the confirmation signal; phi (P12) judges what is worth adding.

**Disconfirmation is cautious and reversible.** Be generous about how much testing is required
before non-confirmation counts as error: absence in a thin corpus is *untested*, not
disconfirmed — a prediction can only be retired in a region Chaos has actually sampled. Decay is
never deletion; later research can dig a decayed concept back up and re-confirm it. Each concept
and situation carries an explicit prediction and a ledger (confirmed / expected-but-absent /
appeared-elsewhere).

**Active sampling.** To maximize learning per article and to test fairly, source next what most
reduces uncertainty — the shakiest predictions (concepts added but unconfirmed, situations not
yet co-grounded) and the regions a prediction must be sampled in before it can be retired.
Because curation recedes, *balanced* sourcing across the six fields and the phases is the
load-bearing guard against the graph merely mirroring its own reading list.

**Division of labor.** Curation hones the *reader* (this rubric — how Chaos reads and judges) and
recedes; research grows and self-corrects the *knowledge* (the graph) and scales. The loop is the
same across regimes — research in Phase A/B seeding, user contributions after launch; only the
sensory stream changes. In practice a human still reviews before anything reaches real users.

---

## 4. Domain notes

### Values *(active focus)* — dispositions of the researcher
Values describe *who the researcher is*, not what research is (P9). Roots are broad virtues;
leaves are specific dispositions; children define the parent. The forest of independent
roots stands (no literal "Good" node).

- **Current roots:** Transparency, Rigor, Honesty — already person-describing, so the
  disposition reframe barely moves them. It bites at the leaves, where earlier drafts
  described the *work*. Re-voicings:
  - "Inspectability of evidence" → **Open to scrutiny**
  - "Calibrated claims" → **Measured**
  - "Robustness to analytic choices" → **Skeptical of one's own conclusions** (the *testing*
    lives in the action graph)
  - "Reporting disconfirming results" → **Forthcoming** (this one was already action-shaped;
    the reframe sends the *act* of reporting to the action graph and keeps the disposition
    here — so self-anchoring doubles as a detector for value leaves that were secretly actions)
- **Candidate root (emerged, not yet seeded):** Protecting participants / research ethics —
  in genuine tension with Transparency, which is a feature.

### Actions *(cost side)* — what I do
Abstractions read as strategies; concrete steps sit beneath. Current roots from the seed:

- **Make the work checkable** → Publish the materials to re-run the analysis (→ Deposit your
  data and code openly); Record your decisions as you go (→ Document where you departed from
  the plan); Disclose what could bias the work.
- **Commit before you look** → Register hypotheses and design before collecting data.
- **Pressure-test your own result** → Run every defensible version of the analysis (→ Sample
  the space when too large to enumerate); Check the result against chance.
- **Report it straight** → Report findings that cut against your hypothesis; Anchor effect
  sizes to familiar comparisons.

### Open questions *(benefit side, not yet built)*
A parent question is answered by answering its more concrete child questions.

### Tools *(cost side, not yet built)*
Generic tool concepts connect more concrete examples of actual tools.

### Corpus and cross-disciplinarity
Pull from across the cognitive sciences — **neuroscience, psychology, linguistics, AI,
philosophy, anthropology**. **Cross-disciplinary concepts are especially valuable:** a
disposition or strategy that recurs across, say, neuroscience and anthropology is more
likely to be a deep, lived, subtextual concept than a discipline-bound term.

---

## 5. Situations (composition over the graph)

A Situation (the app feature, backed by `combos`/`combo_edges`) is a **composed research
lens**: a curated set of member *edges* — concept-in-context, not bare concepts — assembled
into a coherent slice of context, read through against source material. More than a coherent
set of concepts, a situation is a **moment of cost and benefit** — actions and the goal-states
they serve (the Barsalou-inspired anchor). The redesigned page lays members out in four
attribute columns (value, question | action, tool), so the cost/benefit balance is visible at
a glance.

- **Members are edges.** Each member is a concept at a specific path and attribute.
- **Reading list = intersection, not aggregation (P8 generalized).** Compose situations from
  edges that *share grounding documents*; those shared documents then surface across multiple
  members and form an intersection-rich reading list under the app's aggregation, with no app
  change required. A document touching several members is evidence they belong in one frame.
- **Composition is hybrid.** Build both directions: **bottom-up** (cluster edges by shared
  grounding documents and let the frame crystallize) and **top-down** (name a research context
  a researcher would recognize, then assemble members and a reading list to fit). Reconcile
  the two — in reality these are built with feedback from both sides.
- **Domain-balance read-out.** Every proposed situation reports its spread across the four
  columns in cost/benefit terms. Lopsidedness is *informative*, not forbidden — surface and
  interpret it ("names what to want and one way to pursue it, but is silent on tooling cost").
  A deliberately one-sided frame (all open questions = an unexplored frontier) is legitimate.
- **Felt-context test.** Beyond "do these make sense together," ask: read across its columns,
  does this situation feel like *a self-portrait a researcher recognizes in themselves* doing
  this kind of work? (P9 delivers this at the situation level.)
- **Core spine vs. toggleable members.** The page lets anyone hide/show member cards
  (excluding their links from the reading list). Design situations with a stable co-grounded
  *spine* plus a few members that sharpen or pivot the lens when toggled.
- **Same-phase clustering (Section 6).** Concepts sharing a lifecycle phase are natural
  co-members — a situation is usually a moment *within* one phase, so phase is a composition
  heuristic alongside shared-document co-grounding.
- **Situations learn too.** Chaos looks for *exemplars* of a situation in the literature (a
  paper that instantiates the whole moment) and proposes *latent* situations it detects under
  the surface of the text (the move-step read, P10) — not only situations composed from
  concepts already in the graph.

---

## 6. The lifecycle map *(internal to Chaos — for now)*

A structure Chaos builds and hones as it reads: a map of the **research life cycle** as a
*cycle* of phases (Campbell + Barsalou), used to **sort the concepts Chaos adds into phases**
and, mainly, to seed situations from same-phase concepts. It is **internal to the tool and not
part of the Orca app at present**, though there's no deep barrier to it entering Orca later,
since Chaos aims to build the graphs real researchers would make. It is **built incrementally**,
and — importantly — its phases are **flexible**: as more research is consumed, revise the phase
set if the evidence warrants. Do not treat the phases as settled scaffolding.

- **It is a phase index over the real concepts, not a separate value system.** Each value,
  action, and tool Chaos adds is sorted into a phase. *Questions are not phase-mapped* — they
  don't belong to a single phase of research.
- **Primary use: seeding situations.** Concepts sharing a phase are natural co-members of a
  situation (a moment within that phase). This is the map's main job (Section 5).
- **Phases (provisional, illustrative).** Sensing the gap → Committing to a question →
  Designing the approach → Executing and wrestling with data → Interpreting → Reporting and
  returning → (back to sensing). Revisable from evidence.
- **The move-step lens (P10).** Each paper's conduct is read for which phase it instantiates —
  which is how concepts get their phase, and how the phase set itself gets tested and revised.
- **Value tradeoffs are deferred.** The earlier idea of abstract Good-values in dialectical
  tradeoff tunnels (Speed ↔ Rigor, etc.) is *not* part of the build. It may return later as
  interesting metadata, but it is not a current target.

---

## 7. Run procedure

1. **Load state.** Read the current graph (concepts, edges, links, situations, citation
   relationships, prediction ledgers) from the dev database; load this rubric.
2. **Assemble the working set of papers** (active sampling, P14). Source to *test the graph's
   shakiest predictions* — unconfirmed concepts, situations not yet co-grounded, and regions a
   prediction must be sampled in before it can be retired — while keeping coverage balanced
   across the six fields and the phases (the bias guard).
   - *Revisit:* re-read already-linked documents — a grown graph may now offer concepts they
     did not have on their last pass.
   - *Fetch:* pull a batch of new open-access papers spanning the cognitive sciences
     (neuroscience, psychology, linguistics, AI, philosophy, anthropology), preferring full
     text and cross-disciplinary material.
3. **Move-step read & prediction test** (P10, P14). For each paper, read *both ends of the
   arc*: the conduct in methods/results for the mid-to-late phases, and the introduction's CARS
   moves (territory, niche) for the early phases (Sensing, Committing) and questions. Place its
   conduct at a phase; read it for the dispositions/questions (benefit) and actions/tools (cost)
   it instantiates. Score it *against what the graph predicted it would contain*: record gaps
   (add), non-confirmations (toward decay), and mis-structures (restructure). Apply P2, P3, P9.
4. **Concept-driven pass.** For each new/recent concept, scan existing linked documents that
   should now connect to it; note tunnel candidates.
5. **Hypothetical-researcher test** (P5) and **co-grounding check** (P8) on every candidate
   link, concept, and tunnel.
6. **Situation-composition pass** (Section 5). Cluster edges by shared grounding documents and
   by shared lifecycle phase; build situations hybrid (bottom-up + top-down); also surface
   *exemplar* and *latent* situations found in the text. Produce a balance read-out, an
   intersection reading list, a core/toggleable split; apply the felt-context test.
7. **Lifecycle phase-sorting** (Section 6). Sort each new value/action/tool concept into a
   phase (questions excepted), and revise the phase set itself if the evidence warrants. No
   tradeoff tunnels — deferred.
8. **Citation tracking** (P11). Record citation relationships among linked papers to build the
   temporal progression axis.
9. **Ledger, recurrence & phi pass** (P12, P13, P14). Update each concept's and situation's
   prediction ledger from this run (confirmations, expected-but-absent, appeared-elsewhere);
   decay only what's been fairly sampled and still unconfirmed, reversibly. Then rank the
   candidate set by its contribution to integrated information — the familiar↔novel balance —
   preferring well-grounded additions that bridge previously-separate regions over those that
   thicken dense ones.
10. **Structure check** (P6). Consider mid-path insertions / restructurings, including the
    mis-structures surfaced in step 3.
11. **Emit proposals** in the formats below, within the concept-creation budget. Write nothing
    to the database without review.
12. **Capture feedback** (secondary signal). Each item accepted/rejected/modified, with a
    reason; reasons hone the *reader* — edits to this rubric (Section 0) — and recede over time
    as the research-driven loop (P14) takes over.

---

## 8. Architecture & operation

How Chaos is *built and run*, distinct from *what* it reasons (Section 7).

**Shape.** Chaos is a **staged pipeline orchestrated as a Claude Code skill** — not an
autonomous agent swarm. Deterministic plumbing is small, testable scripts; reasoning stages
are Claude calls guided by this file. The separation keeps the tool legible and keeps a
database write from ever depending on an opaque agent loop.

**The pipeline:**
1. *Snapshot* (code) — read the dev DB into a compact structured state (concepts, edges by
   domain, links, situations, citation edges, lifecycle map).
2. *Source* (code/API) — fetch open-access papers across the six fields; full text; dedupe
   against already-linked papers; pull citation metadata.
3. *Read & decompose* (Claude) — move-step read each paper into candidate concepts, links,
   tunnels, a phase placement, and a prediction test against the current graph.
4. *Compose & integrate* (Claude) — situations, tunnels, phase-sorting, citation edges.
5. *Ledger, recurrence & phi rank* (Claude + code metrics) — update prediction ledgers and
   recurrence; rank the candidate set by the integration / differentiation balance.
6. *Emit* (code) — write proposals to a review file, never directly to the DB.
7. *Review gate* (you) — accept / reject / modify, with reasons.
8. *Apply* (code) — write accepted proposals to the DB, transactionally and idempotently.
9. *Distill* (Claude + you) — turn reasons into edits to this file.

Code owns the plumbing (1, 2, 6, 8); Claude owns the thinking (3, 4, 5, 9); steps 3–5 read
this rubric as their instructions.

**Autonomy, staged.**
- *Phase A (now, through honing):* every run is human-gated — Chaos proposes, you review,
  accepted items are written. This is where the rubric hardens.
- *Phase B (after honing):* scheduled runs may auto-write **low-risk** outputs (links,
  citation edges) while still queuing **high-risk** outputs (new concepts, roots, situations,
  lifecycle changes) for review, because append-only makes concept creation sticky. The
  trigger to loosen the gate is the validation signals maturing (consistent acceptance plus
  rising recurrence).

**Validation model (no external ground truth).** Three signals: (1) your review;
(2) recurrence in fresh literature (P13); (3) the integration (phi) trend of the graph over
runs (P12). Signals (2) and (3) also *prioritize review*, so a full-capacity run surfaces its
highest-value, highest-confidence proposals first rather than burying the reviewer.

**Learning model.** Chaos does not learn by changing the model's weights; it learns by refining
external memory (current agentic practice). Three substrates, kept distinct and legible:
- *Procedural* — this rubric. Honed by your feedback during seeding; recedes over time.
- *Semantic* — the graph plus each node's prediction ledger and recurrence-derived confidence.
  This is the dominant, scaling loop: research grows and self-corrects it via prediction error
  (P14).
- *Episodic* — a persistent record of each run's proposals and outcomes. **Not built yet**; it
  is what a reflect-and-consolidate step would draw on.

Reflect after each run, then *consolidate*: convert episodic reasons into procedural edits and
semantic confidence — but only let a lesson change a principle once it has *recurred* (no
overfitting to one run). Forgetting is by reversible decay, never deletion. The same loop runs
across regimes — research in Phase A/B seeding, user contributions after launch — with only the
input stream changing.

**Operational notes.** Chaos's contributions are attributed to a dedicated **seed account**
(clean provenance, and a clean handoff when real users arrive), not a personal account. Writes
are idempotent and transactional — respect the edge uniqueness constraint and dedupe links
(the link table permits duplicate URLs). External DB access uses Railway's public Postgres
proxy URL. Pre-launch, the dev graph is disposable: a full-capacity pass can be run, inspected
whole, and redone. The papers/citations migration (per SCHEMA_NOTES) now also carries each
node's prediction ledger; a persistent episodic feedback store is a further table to add when
the reflect/consolidate loop is automated.

---

## 9. Knobs (current settings)

| Knob | Current setting | Notes |
|---|---|---|
| `corpus_focus` | Cognitive sciences across six fields | Neuroscience, psychology, linguistics, AI, philosophy, anthropology |
| `cross_disciplinary_preference` | High | Concepts recurring across fields are especially valued |
| `papers_per_run` | 5–10 new + revisit set | |
| `concept_creation_budget` | Conservative | Calibrate from feedback |
| `domain_boundary_strictness` | Firm | P2, incl. disposition-vs-behavior |
| `concept_voice` | Researcher-anchored | Dispositions for values; my-actions/tools/questions (P9) |
| `phrasing_ceiling` | Short, composable phrase; never a proposition | P9 |
| `subtextuality_strictness` | Firm but soft-edged | P3 |
| `exemplar_verification` | Trust the claim | Flip to verify-the-artifact at time cost |
| `cogrounding_preference` | Preferred | P8 — tunnels and situations |
| `tunnel_types` | Cost/benefit (Orca, doc-grounded) | Dialectical tradeoff tunnels deferred (§6) |
| `situation_composition` | Hybrid | Bottom-up cluster + top-down frame |
| `citation_tracking` | On | Build temporal progression axis (P11) |
| `lifecycle_map` | Internal phase index; flexible phases | Sorts concepts into phases; seeds same-phase situations; tradeoffs deferred |
| `phi_balance` | Prefer integrative + differentiated | P12 — bridge separate regions; avoid both redundancy and noise |
| `recurrence_tracking` | On | P13 — the confirmation signal of the prediction loop |
| `disconfirmation_policy` | Cautious; generous testing threshold | P14 — untested ≠ disconfirmed; decay is reversible, gated on having sampled the area |
| `active_sampling` | On | P14 — source to test the shakiest predictions |
| `sourcing_balance` | Enforced across fields + phases | P14 — the bias guard as curation recedes |
| `autonomy_phase` | A (human-gated) | Phase B (low-risk auto-write) after honing — see Section 8 |
| `restructuring_willingness` | High in proposals, low once applied | P6 |
| `root_abstractness` | Mid | |
| `revisit_policy` | Every run | |

---

## 10. Proposal & feedback formats

- **Concept proposal:** graph + attribute; parent path; new child; lifecycle phase; rationale
  (general → specific, subtextual, self-anchored); the prediction it makes (what research should
  keep instantiating).
- **Link proposal:** target edge; URL; title (auto-fetched); comment = the exemplification
  claim (how the conduct instantiates the concept).
- **Cost/benefit tunnel proposal:** from-edge ↔ to-edge; rationale as a cost/benefit relation;
  the co-grounding document where one exists (P8).
- **Prediction-test outcome (per article):** gaps (add), non-confirmations (toward decay),
  mis-structures (restructure) — the article scored against what the graph predicted (P14).
- **Situation proposal:** member edges; suggested name; lifecycle phase; domain-balance
  read-out; intersection reading list (shared documents); core spine vs. toggleable members;
  cost/benefit-moment rationale (actions + the goal-states they serve).
- **Citation relationship:** paper A advances paper B (A cites B) → a progression edge.
- **Mid-path insertion:** the existing edge refined; the new intermediate; the resulting
  Parent → X → child path.
- **Feedback (per item):** accept / reject / modify + reason. Reasons drive rubric edits.
