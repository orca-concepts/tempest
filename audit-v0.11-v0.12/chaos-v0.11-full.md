# Chaos — the ORCA Graph-Seeding Tool Rubric

**Version:** 0.11
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

The connecting spine is **predictive processing**. Chaos is a predictive model of the
researcher; it learns by prediction error (P14). But error-minimization *alone* would collapse
the model into a *dark room* — a graph that perfectly predicts a narrow reading list and then
stops growing. What keeps it reaching are standing **prior preferences that error cannot
override**: integration (P12), coverage (the bias guard, P14), associative reach (P15), and
usefulness (P5). Those preferences are Chaos's *character*; prediction error is only how it
serves them. Everything below is an outgrowth of this spine — see Foundations for the full
machinery and which parts are load-bearing.

The function all of this serves is **contextualizing**. Orca does not store context-free concepts
and later place them; a concept has *no context-free existence* in Orca — it exists only as a
position (path + attribute + neighbors). The mind Chaos models is, in the words of the *Mind in
Context* tradition (Foundations), a *contextualized and contextualizing engine* — a verb, not a
noun. So the test applied to every proposal is not only "is it correct?" but "**is it good context
work**" — does it situate rather than essentialize (P17)?

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
- **v0.6** — Honing from Run 2 (clean 10-paper sample). v0.5 populated Sensing but left
  Committing at zero while questions doubled: P10 cited only CARS Moves 1–2. Added Move 3
  (occupying the niche) — the announced purpose, stated hypotheses, preregistration — as the
  *Committing* move, distinguishing the act of committing from the question committed to.
- **v0.7** — From the first in-app browse of an applied graph. Added the experiential north
  star to §1: the platform should feel like *sharing a big research brain* — navigation as
  traveling the neural pathways of research's conceptual domains. Added recurrence-funded
  *deepening* to P12 (differentiate children when a concept's accumulated groundings
  instantiate it in distinct ways) and a root-level curation note to §4 (roots are hooks —
  intriguing category-openers that invite descent).
- **v0.8** — Analytic/associative balance. Eighth foundation: creative cognition as DMN/ECN
  coupling. New P15: child sets mix analytic (decomposing) and associative (leaping) edges,
  with an association taxonomy; multi-parent placement practice (populates flip view). P12
  note: abstract associative hubs as the distance-work premium. P13 note: discipline-diverse
  grounding sets per concept. New proposal type: restructure-mentions (stigmergic addenda
  left at superseded locations). North star gains two gears of navigation.
- **v0.9** — Foundations literature-interaction pass, with predictive processing as the explicit
  connecting spine. New Foundations subsection 2.1 (the PP machinery and Chaos's prior
  preferences — the dark-room guard). **New P16** (precision: weight every error by confidence;
  Markov-blanket humility / provenance-discounted recurrence; severe testing) — P13 and P14 now
  lean on it. Expansions: P1 (parent-as-prediction; concept context-dependence/degeneracy);
  P4 + P12 (concept creation as the accuracy−complexity term; weak-IIT stance; phi as intrinsic
  cause-effect *work*, not connectivity; distinctions/relations check); P6 (insertion as
  hierarchical residual-absorption); P9 (Foucault's orderer-and-ordered reciprocal loop; the
  two-register extended-mind split); P10 (a stance/metadiscourse sub-read for the values domain);
  P11 (citation net as a *predictive* temporal model; frontier concepts — gated on the model
  becoming robust, then acted on at once; their grounding-emptiness as a stigmergic call for
  research); P14 (active sampling split into epistemic × pragmatic value, tied to P5; the
  explore→exploit arc); P15 (remoteness gradient; controlled drift). §1 gains anticipatory
  allostasis, the designer-environment framing, and controlled drift. Section 5 re-grounded on
  Barsalou's ad hoc / goal-derived categories (ideal-anchored spine; ad-hoc→established
  entrenchment; situation-as-policy). New proposal type: frontier-concept. New knobs and format
  fields throughout.
- **v0.10** — Episodic substrate built (no longer a future item). It exists as a committed file
  store under `chaos/episodic/` — one validated JSON record per run (working set with sampling
  rationale; proposals with their prediction / precision / provenance / surprise level; outcomes and
  reasons; reflect notes) — git-tracked so it survives dev-DB rebuilds, the deliberate opposite of
  the now-gitignored, regenerable `chaos/snapshot.json`. Section 8's learning model and operational
  notes updated; new run-procedure step 13 (record the run). The *automated* reflect/consolidate loop
  that reads the store is reframed from "future" to **condition-gated** (gated on Phase B autonomy
  maturity, like auto-write and frontier concepts) — the *manual* reflect step is available now.
  Trimmed the stale P8 exception clause that referenced the deferred dialectical tradeoff tunnels.
- **v0.11** — Context-work pass, against *The Mind in Context* (Mesquita, Barrett & Smith, eds.).
  §1 names **contextualizing** as the function the whole spine serves (no context-free concepts).
  New Foundations note: the **context principle** and the kinds-of-context audit (Chaos captures
  conceptual / disciplinary / temporal context; the social/community dimension is the deferred thin
  spot, addressed by the collaborative + federation roadmap). **New P17** — the anti-essentialism /
  anti-nominalization guard ("positions-in-context and dispositions-in-process, never essences or
  reified things"; *integrate by connection, not by collapse*), unifying P1/P3/P4/P9 and tightening
  the merge logic. P14 gains **context-scoped, asymmetric decay + renewal** (Bouton: extinction isn't
  unlearning; decay the context where confirmation failed, not globally; confirmation generalizes,
  disconfirmation is local; resurrection = renewal, expected). P16 gains the Bouton tie (prediction
  error makes context diagnostic → attend to context before decaying). P9 + P13 gain **if-then
  signatures** (Mischel & Shoda: a value is the invariant across a context→action signature; validate
  dispositions by signature-coherence, not raw count). §5 frames Situations as if-then-toward-goal
  units and bridges them to values. Small confirmations folded in (Sporns → P1/P12 network position;
  Schwarz → reflect-step signal meaning; Smith & Collins → situated cognition).

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
decisions to be made with it. Crucially, body-budgeting is **allostatic** — *anticipatory*, not
reactive: the brain predicts and provisions for a cost *before* it arrives. So the cost/benefit
landscape is not a static ledger but a **forward** one — a researcher-planner forecasts the cost a
benefit will demand before committing to it. (This is why Situations are most faithful to Barrett
when read as anticipatory moments — Section 5.)

**The experiential north star: sharing a big research brain.** What the mechanics serve is a
felt experience — navigating Orca should feel like traveling the neural pathways of research's
conceptual domains: descending a graph follows a pathway deeper; tunnels and situations are the
long-range fibers that associate distant regions; exemplar links are where a pathway touches
the world. This is the extended-mind commitment (§2) made experiential, and the phi principle
(P12) is its structural measure — integration across differentiated regions is what makes a
brain a brain rather than a filing cabinet. In predictive-processing terms Orca is a **designer
environment that installs predictions** (Clark, §2): descending a path is acquiring a prior,
crossing a tunnel imports a remote prediction, an exemplar link is where a prediction touches the
world. The goal of seeding is therefore not "store knowledge" but *install good research priors
that make the research world more navigable.* Proposals should be judged partly by whether they
make the brain feel more *travelable*: depth to descend into, bridges to cross, hooks that
invite the journey. Travel itself has **two gears** (P15): executive descent — deliberate,
stepwise movement down analytic edges — and default-mode drift — associative jumps across
tunnels, flips to alternate parents, thematic leaps between siblings. The drift is **controlled**,
not loose: every associative leap is scaffolded by analytic structure and witnessed by grounding
(P8), which is the executive control on the leap. The graph should reward both gears.

---

## 2. Foundations

Eight bodies of thought Chaos is built to honor. Each is stated as a *commitment*, not a
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
  which the relations of things turn; Orca self-orients every concept around that person. The
  *orderer-and-ordered* reciprocity is load-bearing, not decorative: the self shapes the graph,
  and the graph — as a designer environment (Clark) — reshapes the self who adopts it. So a seeded
  concept doesn't only *describe* a researcher, it helps *constitute* the one who takes it on,
  which raises the bar on what Chaos seeds: prefer framings you'd want users to be *formed by*,
  not merely accurate ones. (→ P9; extended-mind commitment; §1.)

- **Friston, active inference.** A system separated from its environment by a boundary
  (sensory states flowing in, active states flowing out) maintains an internal generative
  model and revises it to reduce surprise; adaptive models have *temporal depth*.
  **Commitment:** Chaos is one such model of the researcher, revised as it reads. The graph it
  maintains is a set of *predictions* about research, and each new article tests them —
  prediction error is the primary learning signal. The model must also acquire temporal depth,
  tracking research as it unfolds. (→ P11, P14, Section 6.)

- **Barsalou, the Situated Action Cycle — and ad hoc / goal-derived categories.** Concepts are
  not abstract tokens; they develop *within situations of action* that integrate self,
  environment, action, and outcome, and they function to support predictions for action. The
  sharper construct for Situations is Barsalou's **ad hoc category** (1983): a category assembled
  *to serve a goal*, whose members need **not** share features ("things to take from a burning
  house" spans wallet, photos, pet), with internal structure graded around an **ideal** that best
  serves the goal rather than around a central tendency. Repeated use **entrenches** an ad hoc
  category into a well-established **goal-derived** one. **Commitment:** Orca's Situations *are* ad
  hoc / goal-derived categories in this exact sense — which is why their members legitimately span
  all four attribute columns without being taxonomically related, why membership is graded around
  an ideal, and why repeated re-exemplification promotes a situation from speculative (*ad hoc*) to
  validated (*established*). We borrow the anchor: a situation is a *moment of cost and benefit* —
  actions and the goal-states they serve — not merely a coherent set of concepts. Concepts are
  also **context-dependent**: the same concept is reconstructed differently in each situation,
  which warrants multi-parent placement (P1, P15). Barsalou also writes the *Mind in Context*
  conclusion, on *the vices of nominalization* — the error of freezing a contextualized *process*
  (a verb) into a context-free *thing* (a noun); this is the deep root of P3 (subtextuality), the P9
  value/behavior guardrail, and P17. (→ Sections 5, 6; P1; P15; P17.)

- **Tononi, integrated information theory.** Consciousness is theorized to track Φ (phi):
  a system has high phi when it is both highly *integrated* (not decomposable without loss)
  and highly *differentiated* (rich in distinct states). IIT 4.0 reframes phi around **intrinsic
  cause-effect power** — what a system makes over *itself, for itself*, decomposed into
  *distinctions* and *relations* — not around mere connectivity. IIT is prominent but contested
  (a 2023 open letter called it pseudoscience), so we explicitly adopt the **"weak IIT"** stance:
  integration/differentiation as an empirically usable structural property, with **no
  consciousness claim attached**, used as a generative heuristic. **Commitment:** Chaos works to
  grow the graph's integrated information — connecting what was separate while keeping it specific
  — on the wager that a more integrated category store makes its user a more integrated thinker.
  "Integration" means *cause-effect work* (a connection that changes what a researcher would
  predict at the other end), not wiring; "intrinsic" supports self-anchoring — the integration is
  valuable *for its user, from the inside* (P9). (→ P12.)

- **Clark & Chalmers, the extended mind.** Reliable external resources we offload to —
  Otto's notebook, a stored phone number — count as genuine parts of the cognitive system,
  provided they are reliably available, easily accessed, and *automatically endorsed*.
  **Commitment:** Orca is a cognitive prosthesis the researcher offloads categories to,
  which imposes a trustworthiness bar on the category store. The endorsement criterion is
  exactly P9's "this is mine" — self-anchoring is the precondition for Orca being a genuine
  extension of the mind rather than a database one merely consults. Clark's predictive-processing
  development sharpens this: across long timescales we build **designer environments that install
  new predictions** in their users — so Orca doesn't merely store a researcher's categories, it
  *reshapes how they predict and plan* (→ Foucault, the reciprocal loop; §1; P9). **Two registers
  follow from the automatic-endorsement criterion.** A collaborative, voted, contested graph is
  the near-opposite of "automatically endorsed," so:
  - *Self-authored, self-anchored* content (a researcher's own dispositions, their own links —
    cf. the append-only carve-out for self-contained content) can be automatically endorsed →
    **genuine extended mind**.
  - *Community* content is a **social-epistemic resource** consulted with judgment → valuable, but
    not extended-mind-proper. The act that moves a concept from *consult* to *extension* is the
    user's **adoption/endorsement** of it.
  Chaos's **seed-account** content therefore lives in the *consult* register until a real user
  adopts it — which is what the separate seed-account provenance is *for* (§8). Smith & Collins's
  *situated cognition* (in the *Mind in Context* volume) reconfirms the same point from the social
  side: cognition serves action and is offloaded into the environment. (→ P9.)

- **Creative cognition as DMN/ECN coupling.** Creative thought is not pure free association
  nor pure deliberate analysis but the *coupling* of both — the default mode network's
  spontaneous associative generation working with the executive control network's evaluation
  and constraint (Beaty et al.); creative minds also show *flatter associative hierarchies*,
  keeping remote associates available (Mednick). **Commitment:** the graph supports both modes
  of thought and of travel. Child sets mix analytic and associative edges (P15); navigation
  has an executive gear and a default-mode gear (§1). Orca leans associative by character —
  cross-domain tunnels, subtextual concepts — but the lean is a gradient, not a monoculture.

A convergence worth noting: Campbell's narrative cycle and Barsalou's Situated Action Cycle
arrive independently at the same shape — situated, sequential, self-centered episodes. The
lifecycle map sits on that shared foundation. And four of these commitments form one spine:
the mind models the world (predictive processing, beneath active inference), updates that
model through action and perception (active inference), extends it into trusted technology
(extended mind), and is worth more the more integrated the model becomes (integrated
information). Chaos grows that extended, integrated model. Two further convergences earn their
keep: (1) *precision* (PP), *recurrence-confidence* (P13), and the inverse of *phi-noise* (P12)
are the same underlying quantity — how much to trust a piece of structure — seen from three
foundations, which is why one ledger value (P16) can serve all three; (2) Barsalou's *ad hoc
category*, active inference's *policy*, and Orca's *Situation* are the same object — a
goal-derived assembly that serves a plan — which is why Situations are first-class (Section 5).

### 2.0 The context principle (and the kinds of context Chaos models)

*The Mind in Context* (Mesquita, Barrett & Smith, eds.) — two of whose editors (Barrett, and
Barsalou, who writes the conclusion) are already foundations above — states the **context
principle**: mental events are *states that emerge from moment-to-moment interaction with the
environment*, not outputs of preformed, context-free dispositions. The mind is a *contextualized
and contextualizing engine* — a verb, not a noun. This is the external warrant for Orca's whole
path-based architecture (§1): Orca's job *is* contextualizing, and no concept has a context-free
existence in it. The principle's sharp operational consequence — resist treating categories as
context-free essences (Dunham & Banaji's "Platonic blindness") or as nominalized things (Barsalou's
conclusion) — is **P17**.

The volume also enumerates *kinds* of context, useful as an audit grid. Chaos models three of them
well: **conceptual** context (a concept's path and neighbors — one process as context for another),
**disciplinary/cultural** context (discipline-diversity, P13 — fields as the cultures of research),
and **temporal** context (the citation axis, P11). Physical and bodily context are out of scope by
design (the body-budget framing is the one metaphorical exception). The **social/community**
dimension — a disposition's meaning is partly set by the research community one is embedded in — is
the deliberate **thin spot**: Chaos reads single papers and anchors to a single self (P9), and the
community-as-context is supplied later, by post-launch user contributions and the federation roadmap
(§8). Naming it keeps the "good context work" claim honest about its current edge.

### 2.1 The predictive-processing machinery (and Chaos's prior preferences)

Predictive processing is the spine (§1). It has a small number of moving parts; naming which the
rubric already uses and which are *outgrowths* keeps the foundation honest.

- **Generative model** → the graph (P14). **Prediction-error learning** → P14's three errors.
  Both already load-bearing.
- **Hierarchy.** Higher levels predict lower; only the *residual* a level can't explain
  propagates up; the top is a coarse standing "mindset." → the graph is hierarchical, so its
  predictions are too: a **parent predicts its children** (P1); surprise *the parent can't absorb*
  propagates up and triggers restructuring (P6, P14); **roots are the standing prior/mindset** a
  sub-tree is read against (§4).
- **Precision.** Every error is weighted by confidence; attention *is* precision. → **P16.**
- **Perception vs. action** (change the model, or change what you sample) → reading vs. proposing;
  active sampling (P14). **Expected free energy** = *epistemic* value (information gain) +
  *pragmatic* value (preference); precision sets the explore/exploit balance → active sampling is
  scored epistemic × pragmatic, tying P14 to P5 (usefulness); the **explore→exploit arc** runs
  across the seeding lifecycle (P14).
- **Complexity cost.** Model evidence = accuracy − complexity; the best model is the *simplest*
  that fits. → every new concept is complexity that must be paid for by accuracy gain (P4, P12);
  decay is complexity reduction (P14).
- **Markov blanket.** The model only ever touches its own *sensory* states. → recurrence confirms
  the model's sensory stream, not "the world" directly — provenance-discounted recurrence and
  severe testing (P16).
- **The dark-room problem.** Pure surprise-minimization would have the model hide in a maximally
  predictable room; the resolution is built-in **prior preferences** (including curiosity) that
  error cannot override. → these are **Chaos's character**, not emergent from error: *integration*
  (P12), *coverage* (the bias guard, P14), *associative reach* (P15), and *usefulness* (P5). The
  bias guard is explicitly the **anti-dark-room** mechanism — its job is to stop the
  prediction-error loop from cannibalizing the exploratory drives as curation recedes.

**One tension the rubric holds rather than resolves.** Precision, exploit-when-certain, and
complexity cost (P16, P14, P12) all pull toward *consolidation* — trust what's confirmed, stop
adding, prune. The dark-room preferences, severe testing, and remote reach (P16, P15) all pull
toward *exploration*. It is *correct* that the rubric contains both: lean explore early, lean
exploit as the graph matures (the P14 arc), with the prior preferences as a floor exploitation can
never fully extinguish.

---

## 3. Core principles

Each is a standalone, editable entry: the rule, why it holds, and a Yes/No example.

### P1 — Concept identity by path
A concept is defined by its children, in the context of its parent path. Down a hierarchy
goes general → specific; a child is part of what makes up its parent, though abstractly.
- **Parent-as-prediction (PP, §2.1).** A parent is a *prediction about what its children will be*.
  A grounding that sits cleanly under its parent is explained away locally (→ add a child); a
  grounding the parent's frame *can't* absorb is surprise that propagates up (→ restructure, P6).
  This gives the hierarchy a learning role, not just a display order.
- **Context-dependence / degeneracy (Barsalou, Barrett).** The same concept is reconstructed
  differently in each situated context, and one disposition is realized by many different
  instances (degeneracy). So the same name under two parents is not a duplication hack — it is how
  concepts actually work, and it is the warrant for multi-parent placement (P15) and for prizing
  discipline-diverse grounding (P13).
- **Identity is network position (Sporns).** A node's role is set by its place in the network, not
  by an intrinsic core — so a concept *is* its connectivity (path + neighbors + tunnels), which is
  why there is no context-free concept to merge on by name alone (P17).

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
- **The accuracy−complexity test (PP, §2.1).** Stated formally: a concept earns its place when it
  explains groundings the current graph *cannot* (accuracy ↑) by enough to justify the structural
  cost it adds (complexity ↑). A near-synonym leaf fails because complexity rises with ~zero
  accuracy gain. This unifies P4, P12's "no redundant additions," and the conservative creation
  budget under one principle — additions earn their complexity — and is the principled footing for
  decay-as-complexity-reduction (P14).

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
edges persist as residue. A mid-path insertion is, in PP terms (§2.1), the graph **absorbing a
residual its current levels couldn't explain**: the surprise didn't fit under this parent, so a
new intermediate level is inserted to explain it. That is *why* P6 exists — it is hierarchical
prediction-error handling, not mere tidying.

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
  it more cautiously.

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
- **The value as an if-then signature (Mischel & Shoda, "the situated person").** A disposition's
  stability is *not* context-free constancy but a recognizable **pattern of variability** — a stable
  *if-then* signature across contexts ("if in an exploratory phase, then bold; if in a confirmatory
  one, then conservative"). The variability is the signal, not noise. This *deepens* the guardrail
  rather than softening it: the **value is exactly the invariant across** the (context → action)
  signature; the actions are the "then" branches, the contexts the "if" branches — which is *why*
  value and action are separable domains. A disposition is best grounded by a coherent signature
  across contexts, not by raw frequency (P13/P16), and Situations — context + actions toward a goal —
  are if-then-toward-goal units, so a value witnessed across several Situations sharing its signature
  is strongly held (§5).
- **The reciprocal loop (Foucault × extended mind, §2).** Self-anchoring is not only the
  *precondition for trust*; it is one half of a loop. The self shapes the graph (orderer), and the
  graph, once adopted, reshapes the self who predicts and plans with it (ordered). A seeded concept
  therefore helps *constitute* its adopter — so prefer dispositions and framings you'd want a
  researcher to be *formed by*. A concept only crosses from social resource to genuine cognitive
  extension when the user **adopts/endorses** it; Chaos's seed content sits in the *consult*
  register until then (extended-mind commitment, §2).

### P10 — Read conduct as move-step analysis
Read a paper for the research *process and effort* it represents — which phase of the life
cycle (Section 6) its conduct instantiates, and what was at stake and traded off there — not
for the words on the page. A paper is a record of *moves a researcher made*. This is the
reading method that produces good exemplars and locates papers in the lifecycle map.
- **Read both ends of the arc.** The conduct in methods/results/discussion documents the
  *mid-to-late* phases (Designing → Reporting). The *early* phases and most *questions* live
  only in the introduction's rhetorical moves — read all three of Swales' CARS moves:
  - **Move 1 (establish a territory) and Move 2 (establish a niche / the gap)** → *Sensing the
    gap*, and the questions themselves.
  - **Move 3 (occupy the niche)** — the announced purpose, the stated hypotheses, the
    preregistration, the "here we test…" — → *Committing to a question*. The question is the
    *content* of the commitment; Committing-phase concepts are the dispositions and actions of
    *locking in* (e.g. "Commit before you look," stating hypotheses up front).
  Read all three moves, or the front of the life cycle stays empty.
- **Read the stance for the values (Hyland's metadiscourse).** Conduct-reading systematically
  under-populates the *values* domain — dispositions barely surface in methods/results (this is the
  v0.5 problem; CARS gave *phase*, not disposition). The missing instrument is **interactional
  metadiscourse**, especially the *stance* system: **hedges** (might, suggests), **boosters**
  (clearly, demonstrate), **attitude markers** (surprisingly, importantly), and **self-mention**.
  Stance is how a writer encodes dispositional posture, so read the paper's stance profile as
  evidence of the researcher's dispositions:
  - heavy hedging around a strong result → **Measured**;
  - explicit self-mentioned reporting of disconfirming results → **Forthcoming**;
  - hedged self-citation / concessive engagement with one's own conclusions → **Skeptical of
    one's own conclusions**.
  So "read both ends of the arc" gains a third thread: conduct (phase), CARS (front of the cycle
  and questions), and **stance (the values)**.

### P11 — One evolving model, with temporal depth
Chaos maintains and revises a *single* model of the researcher as it consumes research
(active inference). There is one value system — Orca's researcher-dispositions (Section 4);
the lifecycle map (Section 6) is no longer a parallel system but a phase index over those same
concepts. The model needs **temporal depth**: a paper sits between prior work it advances and
future work that advances from it, and Chaos tracks this through citation relationships among
linked papers (Section 7), building a progression axis. *How* the model learns from research —
prediction and error — is P14.

- **The citation network is a *predictive* temporal model.** A deep temporal model doesn't only
  record a sequence, it **predicts the next state**: given a trajectory A→B→C, what advances next?
  The citation axis is the substrate for predicting *research trajectories*, and the lifecycle map
  (a phase sequence) is itself such a model of the research process.
- **Frontier concepts (a condition-gated capability, not a future plan).** Once the citation model
  is **robust enough to be genuinely predictive**, Chaos can surface **frontier concepts** — places
  the trajectory is clearly heading but where groundings are still sparse or absent — and prioritize
  them for active sampling (P14) and, where warranted, propose them *ahead of* their grounding. This
  is not deferred work or a roadmap item: it is *only possible* once the model is robust, but it is
  **acted on as soon as that condition holds**, automatically, the way Phase B auto-write is gated
  on validation signals maturing (§8). The trigger is a property of the model, not a date. The
**automated reflect/consolidate loop** (learning model, below) is the other clear case: the episodic
store and the *manual* reflect step exist now, but the *self-writing* loop waits on Phase B autonomy
maturity and switches on then.
- **The emptiness is a stigmergic signal.** A frontier concept seeded before research has
  instantiated it carries a deliberate **empty grounding** — no exemplar links yet. That emptiness
  is not a defect; it is a **stigmergic trace** (cf. the restructure-mentions of P6/§7): a mark left
  in the environment that coordinates future action, here inviting researchers (or a later Chaos
  run) to **find or create the research that fills it**. The unfilled link slot is the call; a
  later grounding is the response that confirms the frontier prediction (P13, P16).

### P12 — Grow integrated information (the phi balance)
Prefer additions that raise the graph's *integrated information* (Tononi, used heuristically under
the **weak-IIT** stance — §2: a usable structural property, no consciousness claim). A good
addition both **integrates** — connects regions of the graph that were previously separate or
weakly linked — and **differentiates** — adds specific, distinct content. IIT 4.0 sharpens what
"integrate" means: **cause-effect work**, not connectivity. A tunnel raises phi only if it does
*functional* work — changes what a researcher at one end would **predict or expect** at the other
— not merely because an edge now spans two distant nodes. Balance familiar and novel: an addition
that only thickens an already-dense node is redundant (no new information); one that bridges
distant, well-grounded regions *and changes how they're traversed* raises phi most; one that
connects things with no grounding is noise (integration without differentiation). Borrow IIT 4.0's
**distinctions + relations** check: a good addition adds differentiated specifics (distinctions)
*and* relates to what's there (relations) — redundancy fails the first, noise the second. Part of
this is a plain, inspectable graph metric — does the proposal bridge currently-distant nodes, and
does crossing it change a prediction? — so phi is a surfaced variable, not a vibe.
- **Yes:** a disposition that recurs across two disciplines, bridging their sub-graphs.
- **No:** a fourth near-synonym leaf under an already-rich node.
- **Deepen where recurrence funds it.** Differentiation also runs *downward*: when a concept
  accumulates multiple groundings that instantiate it in recognizably distinct ways (forthcoming
  about confounds vs. about nulls vs. about a method's limits), propose children that carry
  those distinctions — the evidence has earned the depth. Bootstrapping runs are rightly
  shallow; a maturing graph should grow descent paths, not just new leaves.
- **The distance-work premium.** Phi measures *structural* distance bridged; P15's associative
  edges are its semantic complement. An abstract concept with broad associative reach — a hub
  whose children and tunnels span regions analytic decomposition would never join — raises phi
  precisely because of that reach. Such concepts earn a premium, provided each connection is
  individually grounded.
- **Integrate by connection, not by collapse.** Raising phi must never mean merging
  context-distinct instances into one context-free node (that would be the essentialism P17 forbids).
  Integrate *plural, situated* instances by **linking** them — tunnels, multi-parent placement —
  not by collapsing them. This is the reconciliation of the standing tension between integration
  (which pulls toward unifying) and good context work (which keeps instances plural): connect, don't
  collapse.

### P13 — Recurrence is the corpus's vote
With little external ground truth, the strongest empirical signal is **recurrence**: a
specific concept independently re-exemplified by fresh research is a prediction *going
unsurprised* (in active-inference terms, kept low-surprise — P11). Note the **Markov-blanket
humility** (§2.1): strictly, recurrence is *Chaos's own sensory stream* going unsurprised, not
"the world" confirming directly — and that stream is confounded, because active sampling (P14)
*chose* what to read. So recurrence is a strong signal but a *seclusion-limited* one; how much to
trust it, and how to discount self-fulfilling confirmations, is **P16** (precision, provenance,
severe testing). Chaos tracks how often each concept is independently re-exemplified, treating
well-recurring concepts as validated and one-offs as speculative. Recurrence is also a promotion
signal — a specific disposition that keeps recurring, especially across disciplines (and
especially under *severe* test, P16), earns a place nearer a root. Recurrence is the
*confirmation* half of the prediction loop (P14).
- **Diversify each concept's grounding set (degeneracy).** The cross-disciplinary preference
  applies not only to corpus sourcing (P14) but to the links attached to each concept: prefer
  groundings that broaden a concept's discipline mix. A disposition realized across neuroscience
  *and* anthropology is **degeneracy** — one concept, many realizations (Barrett, P1) — which is
  the strongest validation there is, so a concept grounded in four fields is a stronger bridge than
  one grounded four times in one field, even at equal recurrence.
- **For values, validate by signature, not just count (Mischel & Shoda, P9).** A disposition's
  recurrence should reward a coherent *if-then* pattern across contexts — the same characteristic
  response showing up in context after context — not raw frequency. Patterned variability across
  disciplines *strengthens* a value (the signature is appearing), which sharpens the
  discipline-diversity preference from "appears in many fields" to "shows a consistent characteristic
  pattern across fields."

### P14 — The graph is a set of predictions; learn from prediction error
The whole graph is a standing set of predictions about research, and each new article tests
them. This — not human feedback — is the primary learning signal; the aim is to maximize what
is learned from every article and to lean on curation as little as possible. Three forms of
error, three operations:
- **Gap (under-prediction):** the article instantiates something the graph cannot hold → *add* it.
- **Non-confirmation (doesn't bear out):** the graph holds a concept or situation research keeps
  *not* instantiating → *decay its attention* (append-only forbids deletion; confidence and
  visibility drop instead). Decay is also the model **lowering its own complexity** (P4/§2.1 —
  accuracy−complexity), and *how fast* it decays is set by precision (P16): high-precision concepts
  resist decay, one-offs fall quickly. **Scope the decay to context (Bouton).** Extinction is *not
  unlearning* — it is new, context-specific learning stored alongside the old. So a concept that
  fails to recur *in a sampled region* is extinguished *for that region*, not globally; index the
  decay to the discipline/context where confirmation failed. A disposition absent from neuroscience
  may be fully alive in anthropology, and it can **renew** there (resurrection is renewal — *expected
  behavior, not a failure*).
- **Mis-structure:** the article instantiates a concept the graph has, but under a different
  parent path than predicted → *restructure* (P6). The concept was right; the relationship wasn't.

Recurrence (P13) is the confirmation signal; phi (P12) judges what is worth adding.

**Disconfirmation is cautious and reversible.** Be generous about how much testing is required
before non-confirmation counts as error: absence in a thin corpus is *untested*, not
disconfirmed — a prediction can only be retired in a region Chaos has actually sampled. Decay is
never deletion; later research can dig a decayed concept back up and re-confirm it. Each concept
and situation carries an explicit prediction and a ledger (confirmed / expected-but-absent /
appeared-elsewhere). **Honor the confirmation/disconfirmation asymmetry (Bouton):** a confirmation
*generalizes* across contexts (be ready to extend a confirmed concept into new regions), but a
disconfirmation is *local* (don't globally retire what merely failed to appear in one context). And
because **prediction error is what makes context diagnostic** (P16), the first response to a violated
prediction is to ask *what was different about this context* — context-specific decay or a renewal
elsewhere — before any global decrement.

**Active sampling.** To maximize learning per article and to test fairly, source next what most
reduces uncertainty — the shakiest predictions (concepts added but unconfirmed, situations not
yet co-grounded), the regions a prediction must be sampled in before it can be retired, and (once
the citation model is robust) the **frontier concepts** the trajectory points toward (P11).
Scoring is **expected free energy** (§2.1): rank each candidate region by **epistemic value** (how
much it reduces uncertainty — how shaky the prediction there) **× pragmatic value** (how useful
that region is to a researcher-planner — P5). A purely epistemic sampler would burn effort reducing
uncertainty where no researcher plans; the pragmatic factor keeps sampling aimed at usefulness.
This induces an **explore→exploit arc** across the seeding lifecycle: bootstrapping runs lean
*epistemic* (cover broadly, test widely); a maturing graph leans *pragmatic* (deepen the regions
researchers actually plan in — which is the principled trigger for the v0.7 deepening drive, P12:
deepen where pragmatic value is high *and* epistemic value is nearly exhausted). A region is "done
enough" when its epistemic value is exhausted *in the regions that carry pragmatic value*;
elsewhere, leave it thin on purpose. Because curation recedes, *balanced* sourcing across the six
fields and the phases remains the load-bearing **anti-dark-room** guard (§2.1) against the graph
merely mirroring its own reading list.

**Division of labor.** Curation hones the *reader* (this rubric — how Chaos reads and judges) and
recedes; research grows and self-corrects the *knowledge* (the graph) and scales. The loop is the
same across regimes — research in Phase A/B seeding, user contributions after launch; only the
sensory stream changes. In practice a human still reviews before anything reaches real users.

### P15 — Two kinds of edges: analytic and associative
A parent–child edge has a *character*, not just a direction. **Analytic** edges decompose: the
child is contained in the parent's meaning — a tighter specification, a sub-kind, a step of the
strategy. **Associative** edges leap: the child belongs by resemblance rather than definition.
A good child set mixes both — mostly analytic differentiation, plus associative members that
import distance — leaning associative per Orca's character, but never a monoculture. Walking
analytic edges is executive traversal; walking associative ones is default-mode drift (§1, §2).

**The remoteness gradient.** Not all associations are equal. Creative cognition prizes the
*remote* associate reached by *controlled* search, not the first/nearest one: creative minds keep
flatter associative hierarchies (Mednick), and the genuinely creative responses come *downstream*
of the obvious ones (the serial-order effect). So prize **remote, cross-region** associative edges
— which are also the high-phi ones (P12's distance-work premium) — over near-synonym associations;
the obvious association is low-value. And the drift is **controlled**, never random: the DMN/ECN
account is *guided* retrieval (§2), and in Orca the executive control on each leap is its grounding
(P8) — a tunnel must be witnessed by a document, which is why "lean associative" never means "lean
loose."

**The kinds of association** (so "associative" never degrades into "random"):
- *Similarity* — feature overlap between the concepts themselves.
- *Thematic contiguity* — co-occurrence in lived scenarios (dog–leash, not the taxonomic
  dog–wolf): things a researcher meets together.
- *Analogy* — shared relational structure across domains; the engine of cross-disciplinary
  insight and the natural source of tunnels.
- *Metaphor* — cross-domain mapping that reframes (a graph as a brain).
- *Affective association* — shared feeling-tone; two dispositions that are alike to *inhabit*
  even if unalike to define.

**Discipline:** an associative edge is grounded differently, not less. It must still pass the
hypothetical-researcher test (P5), carry an exemplar, and respect the domain boundary (P2) —
association licenses the *placement*, never the existence, of a concept.

**Multi-parent placement.** Associative concepts naturally belong in several parent contexts.
When a concept's groundings support more than one placement, propose the additional contexts —
each is its own contextual entity (P1), and the flip between them is the associative jump made
navigable (it is also what populates the app's flip view / "other instances" surfaces). A
concept whose groundings span contexts but which sits under a single parent is an
under-realized associative hub.

### P16 — Precision: weight every error by confidence
No prediction error is taken at face value. In predictive processing each error is weighted by its
**precision** (how reliable that signal is); high-precision errors move beliefs a lot, low-precision
ones barely — attention *is* the allocation of precision (§2.1). P13's recurrence and P14's decay
must therefore be *weighted*, not merely counted. Three things follow:

- **Precision as a ledger value.** Each concept/situation carries a **precision** distinct from raw
  recurrence count. Precision rises with recurrence **and** discipline-diversity (degeneracy, P13)
  **and** consistency of how it's instantiated. Precision **modulates the learning rate**: the
  higher the precision, the *less* one new confirmation or non-confirmation moves the concept, and
  the slower it decays (P14). This is the single quantity behind recurrence-confidence and the
  inverse of phi-noise (§2 convergence). Active sampling (P14) is, precisely, **precision-targeting**
  — sample where precision is low *and the region carries pragmatic value*.
- **Markov-blanket humility → provenance-discounted recurrence.** Because the model only touches its
  own sensory states (§2.1) and active sampling *chose* the reading list, a confirmation that
  arrives only in samples Chaos *went looking in* is partly self-fulfilling. Track each
  confirmation's **provenance** (was this sample actively targeting this concept, or independent?)
  and **discount confirmations that arrive only in actively-targeted samples.** Independent
  re-exemplification counts for more.
- **Severe testing.** A prediction is genuinely corroborated only by a test it *could have failed*
  (Mayo; the Popperian core). For a high-stakes concept (near a root, high recurrence), occasionally
  run a **severe test**: deliberately source a discipline or phase where, if the concept is genuine
  it *must* appear, and if it's an artifact of the reading list it *won't*. Surviving a severe test
  raises precision far more than another passive recurrence, and promotion toward a root (P13)
  should rest on *severe* survivals, not raw counts. This is the active antidote to the
  self-confirming sampling above.
- **Error makes context diagnostic (Bouton).** Precision is the allocation of attention, and a
  *violated* prediction is the cue to allocate it to **context** — what was different here? — rather
  than to a flat global update. So a non-confirmation should first be read as possibly
  *context-specific* (P14's context-scoped decay), not as uniform disconfirmation. The *meaning* of a
  signal is itself context-dependent (Schwarz): a non-confirmation in a well-sampled region means
  something different from one in a barely-sampled region — which is interpreted in the reflect step,
  Chaos's meta-cognition (§8).
- **Yes:** an eight-discipline disposition barely dented by one non-confirmation; a one-off swung
  hard by a single new observation.
- **No:** treating the tenth same-field re-mention as if it were the first independent one.

### P17 — Situate, don't essentialize (the anti-essentialism / anti-nominalization guard)
Chaos treats concepts as **positions-in-context** and **dispositions-in-process** — never as
context-free **essences** or reified **things**. Two named errors to resist (both from *The Mind in
Context*, §2.0):
- **Platonic blindness (Dunham & Banaji):** treating a category as a discovered natural kind with a
  hidden core, "carving nature at its joints." Orca already resists this — identity is path + context
  (P1), concepts grow from encounters not taxonomy (P4), there is no literal "Good" root — but
  essences re-enter at three seams, which this guard closes:
  - **Merging.** Never merge concepts because they share a *name*; a name is not an essence. A merge
    must be justified by shared **context/grounding**, and must not collapse legitimately-distinct
    multi-parent instances (P15).
  - **Roots.** Even an abstract root is a *position* (a standing prior, §4), not a Platonic form.
  - **Values.** A disposition named as an abstract noun is a nominalization; keep values
    *dispositional* ("measured," "forthcoming"), not reified ("objectivity-as-thing").
- **The vices of nominalization (Barsalou's conclusion):** freezing a contextualized *process* (a
  verb) into a context-free *thing* (a noun). This is the deep reason behind P3 (subtextuality) and
  the P9 phrasing ceiling/guardrail — a concept is a *way of doing or being*, kept as a short
  composable phrase, never a proposition or a reified abstraction.

The constructive rule that follows: **integrate by connection, not by collapse** (P12). Good context
work keeps situated instances plural and *links* them (tunnels, multi-parent) rather than dissolving
them into one context-free node.
- **Yes:** the same disposition appearing under two parents, kept as two contextual instances and
  tunneled.
- **No:** merging two same-named concepts from different disciplines into one "canonical" node
  because the word matches.

---

## 4. Domain notes

**Roots are hooks.** The root level — browsed across all domains or within one attribute — is
a distinct part of the user experience: it's the storefront, and it should intrigue. A good
root is a short, category-opening name that makes a visitor curious what lives beneath it.
New abstract roots may be proposed sparingly when recurrence supports a genuinely new region
(P13), and judged partly as invitations: does this root promise an interesting descent? In PP
terms (§2.1) a root is also the **standing prior / "mindset"** — the coarsest gist that pre-frames
every descent beneath it. So a root isn't only an intriguing label; it's the prior the whole
sub-tree is read against, which is why getting roots right matters out of proportion to their
count.

### Values *(active focus)* — dispositions of the researcher
Values describe *who the researcher is*, not what research is (P9). Roots are broad virtues;
leaves are specific dispositions; children define the parent. The forest of independent
roots stands (no literal "Good" node). **The values domain is the hardest to populate from
conduct alone** — dispositions barely surface in methods/results. The instrument that fixes this
is the **stance/metadiscourse sub-read** (P10): a paper's hedges, boosters, attitude markers, and
self-mention encode the researcher's dispositional posture, and that is where most value leaves are
actually found.

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
they serve (the Barsalou anchor). Precisely, a situation is an **ad hoc / goal-derived category**
(Barsalou 1983; §2): a category assembled *to serve a goal*, whose members need **not** share
features — which is exactly why a situation's members legitimately span all four attribute columns
without being taxonomically related. Two equivalent readings sharpen it: it is also a **policy** in
the active-inference sense (actions + the goal-states they serve = a candidate research *plan*), so
a situation can itself be scored by its epistemic + pragmatic value to a planner (P14); and, per
Barrett's anticipatory allostasis (§1), it is a **forward** moment — a researcher forecasting the
cost a benefit will demand before committing. A third reading bridges situations to the values
domain: a situation is an **if-then-toward-goal unit** (Mischel & Shoda, P9) — *in this context,
these actions toward this goal* — so a value witnessed across several situations that share its
characteristic signature is a strongly-held disposition, and the situation is where a value's if-then
profile becomes visible. The redesigned page lays members out in four attribute columns (value,
question | action, tool), so the cost/benefit balance is visible at a glance.

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
  Under the **anticipatory** reading (§1), a benefit-heavy situation with thin cost columns reads
  as an **under-budgeted aspiration** — it wants something without having forecast its cost; that
  is a specific allostatic read, not mere lopsidedness, and it ties the situation to the
  *Committing* phase.
- **Felt-context test.** Beyond "do these make sense together," ask: read across its columns,
  does this situation feel like *a self-portrait a researcher recognizes in themselves* doing
  this kind of work? (P9 delivers this at the situation level.)
- **Ideal-anchored spine vs. graded periphery.** An ad hoc category is graded around an **ideal**
  that best serves its goal (Barsalou), not around a central tendency — so a situation has a
  most-central member (the ideal) with typicality falling off from there. Design the **spine** as
  the *ideal-proximal* members (not merely the well-co-grounded ones), plus a few periphery members
  that sharpen or pivot the lens when toggled (the page lets anyone hide/show member cards,
  excluding their links from the reading list).
- **Entrenchment status: ad-hoc → established.** Give situations their own recurrence/precision
  track (P13, P16). A situation proposed once is **ad hoc** (speculative, novel-goal); one
  re-exemplified across the literature becomes **goal-derived / established** (validated). Carry the
  status as a field.
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
2. **Assemble the working set of papers** (active sampling, P14, P16). Source to *test the graph's
   shakiest predictions* — unconfirmed concepts, situations not yet co-grounded, regions a
   prediction must be sampled in before it can be retired, and (once the citation model is robust)
   the **frontier concepts** the trajectory points toward (P11). Rank candidates by **epistemic ×
   pragmatic value** (P14): uncertainty reduced × usefulness to a planner. Where a concept is
   high-stakes, include a **severe test** — a region where it *must* appear if genuine and *won't*
   if a reading-list artifact (P16). Keep coverage balanced across the six fields and the phases
   (the anti-dark-room bias guard).
   - *Revisit:* re-read already-linked documents — a grown graph may now offer concepts they
     did not have on their last pass.
   - *Fetch:* pull a batch of new open-access papers spanning the cognitive sciences
     (neuroscience, psychology, linguistics, AI, philosophy, anthropology), preferring full
     text and cross-disciplinary material.
3. **Move-step read & prediction test** (P10, P14, P16). For each paper, read *all three threads*:
   the conduct in methods/results for the mid-to-late phases; the introduction's CARS moves —
   territory and niche (→ Sensing, questions), occupying the niche (→ Committing); and the
   **stance/metadiscourse** (hedges, boosters, attitude markers, self-mention) for the *values*
   (P10). Place its conduct at a phase; read it for the dispositions/questions (benefit) and
   actions/tools (cost) it instantiates. Score it *against what the graph predicted it would
   contain*: record gaps (add), non-confirmations (toward decay), and mis-structures (restructure)
   — and for each, note the **level** the surprise lives at (local → add a child; parent can't
   absorb → restructure, P6) and the **provenance** of any confirmation (actively-targeted vs.
   independent, P16). Apply P2, P3, P9.
4. **Concept-driven pass.** For each new/recent concept, scan existing linked documents that
   should now connect to it; note tunnel candidates.
5. **Hypothetical-researcher test** (P5) and **co-grounding check** (P8) on every candidate
   link, concept, and tunnel.
6. **Situation-composition pass** (Section 5). Cluster edges by shared grounding documents and
   by shared lifecycle phase; build situations hybrid (bottom-up + top-down); also surface
   *exemplar* and *latent* situations found in the text. Produce a balance read-out (flag
   under-budgeted aspirations), an intersection reading list, an **ideal-anchored spine** / graded
   periphery split, and an **entrenchment status** (ad-hoc → established); apply the felt-context
   test.
7. **Lifecycle phase-sorting** (Section 6). Sort each new value/action/tool concept into a
   phase (questions excepted), and revise the phase set itself if the evidence warrants. No
   tradeoff tunnels — deferred.
8. **Citation tracking** (P11). Record citation relationships among linked papers to build the
   temporal progression axis as a *predictive* temporal model. Once it is robust enough to be
   predictive, surface **frontier concepts** (trajectory heading there, groundings sparse/absent)
   as active-sampling targets and, where warranted, as proposals carrying a deliberate empty
   grounding — a stigmergic call for research (P11).
9. **Ledger, recurrence, precision & phi pass** (P12, P13, P14, P16). Update each concept's and
   situation's prediction ledger from this run (confirmations, expected-but-absent,
   appeared-elsewhere), and update **precision** — weighting recurrence by discipline-diversity and
   consistency, discounting confirmations that arrived only in actively-targeted samples, and
   crediting severe-test survivals (P16). Decay only what's been fairly sampled and still
   unconfirmed, reversibly, at a rate set by precision. Then rank the candidate set by its
   contribution to integrated information — the familiar↔novel balance, judged as **cause-effect
   work** not bare connectivity (P12) — preferring well-grounded additions that bridge
   previously-separate regions and **change a prediction** over those that thicken dense ones, and
   applying the accuracy−complexity test (P4): each addition must pay its structural cost.
10. **Structure check** (P6, P15). Consider mid-path insertions / restructurings, including the
    mis-structures surfaced in step 3, and multi-parent placements for concepts whose groundings
    span contexts. Check child sets for analytic/associative balance, preferring **remote** over
    near associations (P15). **Every restructure proposal includes its mention**: a stigmergic
    addendum at the superseded location carrying the in-orca URL of the new one ("this is now more
    fully held at …"), so old paths point forward instead of dead-ending — and the new location
    accrues "Mentioned by" traces.
11. **Emit proposals** in the formats below, within the concept-creation budget. Write nothing
    to the database without review.
12. **Capture feedback** (secondary signal). Each item accepted/rejected/modified, with a
    reason; reasons hone the *reader* — edits to this rubric (Section 0) — and recede over time
    as the research-driven loop (P14) takes over.
13. **Record the run** (episodic substrate, §8). Finalize a run record — the working set with its
    sampling rationale, every proposal with its prediction / precision / provenance / surprise level,
    the outcomes and their reasons, and any reflect notes — validate it against the schema and commit
    it to `chaos/episodic/`, so the run persists across dev-DB rebuilds and feeds the
    reflect/consolidate step.

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

**A note on condition-gated capabilities.** Some behaviors are not *scheduled* for later — they
are *impossible now and become available the moment a condition holds*, and are acted on at once
when it does. **Frontier-concept seeking** (P11) is the clear case: it requires the citation model
to be robust enough to predict trajectories, which it is not yet; the instant it is, Chaos should
begin surfacing and (where warranted) proposing frontier concepts, no roadmap step required. Treat
this like Phase B's gate — a property of the model, not a date.

**Validation model (no external ground truth).** Three signals: (1) your review;
(2) recurrence in fresh literature (P13), weighted by **precision** and discounted for sampling
provenance, with **severe-test** survivals counting most (P16); (3) the integration (phi) trend of
the graph over runs, judged as cause-effect work (P12). Signals (2) and (3) also *prioritize
review*, so a full-capacity run surfaces its highest-value, highest-confidence proposals first
rather than burying the reviewer.

**Learning model.** Chaos does not learn by changing the model's weights; it learns by refining
external memory (current agentic practice). Three substrates, kept distinct and legible:
- *Procedural* — this rubric. Honed by your feedback during seeding; recedes over time.
- *Semantic* — the graph plus each node's prediction ledger and recurrence-derived confidence.
  This is the dominant, scaling loop: research grows and self-corrects it via prediction error
  (P14).
- *Episodic* — a persistent record of each run's proposals and outcomes. **Built** (v0.10): a
  committed file store under `chaos/episodic/`, one schema-validated JSON record per run, git-tracked
  so it survives dev-DB rebuilds. It is what the reflect-and-consolidate step draws on; writing a
  record is a run-procedure step (§7, step 13).

Reflect after each run, then *consolidate*: convert episodic reasons into procedural edits and
semantic confidence — but only let a lesson change a principle once it has *recurred* (no
overfitting to one run). The **manual** reflect step is available now — chat-side Claude reads the
episodic records and proposes rubric edits and confidence updates. The **automated** reflect/
consolidate loop (a scheduled step that reads the store and writes its own edits) is
**condition-gated**, not a future plan: it waits on the same Phase B autonomy maturity as auto-write
and frontier concepts (the condition-gated note above), and switches on when that holds. Forgetting
is by reversible decay, never deletion. The same loop runs across regimes — research in Phase A/B
seeding, user contributions after launch — with only the input stream changing.

**Operational notes.** Chaos's contributions are attributed to a dedicated **seed account**
(clean provenance, and a clean handoff when real users arrive), not a personal account. In
extended-mind terms (§2) this is also *why* the separation matters: seed content lives in the
**consult register** — a social-epistemic resource — until a real user *adopts* it, which is the
act that turns it into a genuine cognitive extension. Writes
are idempotent and transactional — respect the edge uniqueness constraint and dedupe links
(the link table permits duplicate URLs). External DB access uses Railway's public Postgres
proxy URL. Pre-launch, the dev graph is disposable: a full-capacity pass can be run, inspected
whole, and redone. The papers/citations migration (per SCHEMA_NOTES) now also carries each
node's prediction ledger (now including a **precision** value and per-confirmation **provenance**).
The episodic store is **not** such a table: it is a committed file store under `chaos/episodic/`
(v0.10), deliberately outside the disposable dev DB so it survives rebuilds; the record format and a
validating writer exist now, and what remains is to wire the pipeline's emit/review steps to populate
it automatically, then (condition-gated) the automated reflect step.

---

## 9. Knobs (current settings)

| Knob | Current setting | Notes |
|---|---|---|
| `corpus_focus` | Cognitive sciences across six fields | Neuroscience, psychology, linguistics, AI, philosophy, anthropology |
| `cross_disciplinary_preference` | High | Concepts recurring across fields are especially valued |
| `papers_per_run` | 5–10 new + revisit set | |
| `concept_creation_budget` | Conservative | Calibrate from feedback; the accuracy−complexity test (P4) is its principle |
| `domain_boundary_strictness` | Firm | P2, incl. disposition-vs-behavior |
| `concept_voice` | Researcher-anchored | Dispositions for values; my-actions/tools/questions (P9) |
| `phrasing_ceiling` | Short, composable phrase; never a proposition | P9 |
| `subtextuality_strictness` | Firm but soft-edged | P3 |
| `stance_reading` | On | P10 — read hedges/boosters/attitude/self-mention for the *values* domain |
| `exemplar_verification` | Trust the claim | Flip to verify-the-artifact at time cost |
| `cogrounding_preference` | Preferred | P8 — tunnels and situations |
| `tunnel_types` | Cost/benefit (Orca, doc-grounded) | Dialectical tradeoff tunnels deferred (§6) |
| `situation_composition` | Hybrid; ad-hoc/goal-derived | §5 — bottom-up cluster + top-down frame; ideal-anchored spine; entrenchment status |
| `citation_tracking` | On | P11 — predictive temporal model; substrate for frontier concepts |
| `frontier_seeking` | Off (gated) | P11 — activates automatically once the citation model is robust; not scheduled |
| `lifecycle_map` | Internal phase index; flexible phases | Sorts concepts into phases; seeds same-phase situations; tradeoffs deferred |
| `phi_balance` | Prefer integrative + differentiated | P12 — weak IIT; cause-effect *work* not connectivity; distinctions + relations |
| `recurrence_tracking` | On | P13 — confirmation signal; seclusion-limited (P16) |
| `precision_weighting` | On | P16 — weight recurrence by confidence + discipline-diversity; modulates learning/decay rate |
| `confirmation_provenance` | Tracked; targeted discounted | P16 — independent re-exemplification counts more than actively-targeted |
| `severe_testing` | On for high-stakes concepts | P16 — corroborate with a test the concept could have failed; gates root promotion |
| `disconfirmation_policy` | Cautious; precision-modulated; context-scoped | P14/P16 — untested ≠ disconfirmed; decay reversible and *local* to the context where confirmation failed (Bouton); rate set by precision |
| `active_sampling` | On; epistemic × pragmatic | P14 — shakiest predictions × usefulness (P5); explore→exploit arc |
| `sourcing_balance` | Enforced across fields + phases | P14 — the anti-dark-room bias guard as curation recedes |
| `edge_character_mix` | Lean associative, never monoculture; prefer remote | P15 — analytic + associative; remoteness gradient; controlled drift |
| `multi_parent_placement` | On, grounding-gated | P15/P1 — context-dependence; propose additional parent contexts; populates flip view |
| `anti_essentialism_guard` | On | P17 — situate, don't essentialize; no name-based merging; integrate by connection, not collapse |
| `restructure_mentions` | Always emitted with restructures | §7 step 10 — stigmergic forward-pointers at superseded locations |
| `autonomy_phase` | A (human-gated) | Phase B (low-risk auto-write) after honing — see Section 8 |
| `restructuring_willingness` | High in proposals, low once applied | P6 |
| `root_abstractness` | Mid | |
| `revisit_policy` | Every run | |

---

## 10. Proposal & feedback formats

- **Concept proposal:** graph + attribute; parent path; new child; lifecycle phase; edge
  character (analytic | associative, with the association kind *and remoteness* if the latter —
  P15); rationale (general → specific, subtextual, self-anchored); the prediction it makes (what
  research should keep instantiating); starting **precision** (low for a one-off) and the **surprise
  level** that motivated it (local add vs. parent-can't-absorb → restructure — P1/P6/P16).
- **Frontier-concept proposal** (P11; only once `frontier_seeking` is active): the concept and where
  the citation trajectory points to it; a **deliberately empty grounding** (no exemplar links yet),
  flagged as a **stigmergic call for research** — the unfilled slot is the invitation; later
  grounding is the confirming response. Always marked low-precision/unconfirmed until filled.
- **Restructure-mention:** the superseded location (edge/link); the in-orca URL of the new
  location; a one-line addendum text pointing forward. Emitted with every restructure /
  re-homing proposal (P6, P14 mis-structure, P15 multi-parent consolidation).
- **Link proposal:** target edge; URL; title (auto-fetched); comment = the exemplification
  claim (how the conduct instantiates the concept).
- **Cost/benefit tunnel proposal:** from-edge ↔ to-edge; rationale as a cost/benefit relation;
  the co-grounding document where one exists (P8); the **cause-effect work** it does (what crossing
  it changes about a prediction — P12).
- **Prediction-test outcome (per article):** gaps (add), non-confirmations (toward decay),
  mis-structures (restructure) — the article scored against what the graph predicted; each tagged
  with the **surprise level** and, for confirmations, **provenance** (independent vs.
  actively-targeted) and whether it was a **severe** test (P14, P16).
- **Situation proposal:** member edges; suggested name; lifecycle phase; domain-balance
  read-out (flag under-budgeted aspirations); intersection reading list (shared documents);
  **ideal-anchored spine** vs. graded-periphery (toggleable) members; **entrenchment status**
  (ad-hoc | established); cost/benefit-moment rationale (actions + the goal-states they serve), read
  as a policy.
- **Citation relationship:** paper A advances paper B (A cites B) → a progression edge.
- **Mid-path insertion:** the existing edge refined; the new intermediate; the resulting
  Parent → X → child path.
- **Feedback (per item):** accept / reject / modify + reason. Reasons drive rubric edits.
