# Chaos — the ORCA Graph-Seeding Tool Rubric

**Version:** 0.14
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
- **v0.12 — The value-only refocus (major).** Orca is narrowing to a single attribute domain:
  **`[value]`** — researcher *dispositions*, in the disposition register. The `[action]`, `[tool]`,
  and `[question]` domains are removed from the app, and Chaos now develops **only value
  categories**. The goal is adoptability: a focused ontology of research dispositions is far more
  legible to a new user than a four-domain graph with cross-domain compositions. **Dropped:**
  Situations (§5) and combos — they were inherently cross-domain; the four-domain cost/benefit frame
  (§1); the Actions / Tools / Questions domain notes (§4); the lifecycle map (§6) — its main job was
  seeding Situations; and the CARS/phase apparatus in P10. **Reworked to value-only:** §1 (the model
  is the researcher's dispositional self, not a cost/benefit landscape); P2 (only the value graph
  exists — a practice/method is the *behavior* a disposition enacts, not graphed); P5 (the usefulness
  lens, minus cost/benefit); P8 (co-grounding now witnesses value↔value tunnels); P9 (self-anchoring,
  the phrasing ceiling, the disposition guardrail, and the if-then signature, minus the value/action
  contrast); P10 (the stance/metadiscourse read becomes the primary instrument; conduct is read as
  evidence of disposition); the run procedure, knobs, and formats. **Kept intact** (all
  domain-agnostic): the predictive-processing spine, the reconciliation work and the anti-essentialism
  guard (P1/P17 — now *central*, since clustering value families is the whole game), the
  recurrence / precision / provenance ledger, subtextuality (P3), grow-from-encounters (P4),
  the phi/integration principle and tunnels (P12/P15), prediction-error learning (P14), the context
  principle (§2.0), frontier concepts (P11), six-field cross-disciplinary sourcing, and the episodic
  substrate + reflect loop. A possible future successor to Situations — a **value constellation**
  (a coherent cluster of co-occurring dispositions, a "research character") — is noted as
  condition-gated on a rich value hierarchy, not built.
- **v0.13 — Value-only audit corrections.** Two fixes from auditing the v0.12 pivot against v0.11.
  (1) **Research phase restored as a context axis** (a reading lens, *not* a structure). P9's
  if-then signature now runs on **two** explicit "if" axes — **research phase** (where in the
  inquiry's arc the conduct sits: exploratory → confirmatory → reporting) and **discipline** —
  reconciling the dangling phase example that survived after the lifecycle map was dropped. Updated
  to match: the Campbell foundation (the *field's* arc is tracked by citations, P11; the
  *researcher's* phase within the arc is the if-then "if", P9), P13's signature-validation, the run
  procedure's read step (note the phase the conduct sits in), and a new `phase_signature_axis` knob.
  Phase here is purely a lens for reading **how one disposition varies** — emphatically *not* the
  retired concept-sorting lifecycle map / Situations seeder (v0.12). (2) **Swales foundation
  de-orphaned**: slimmed to its one surviving commitment (read *conduct*, not surface terminology —
  now → P3/P10) after P10 dropped the CARS move apparatus in v0.12, so no foundation points at a
  principle that no longer implements it.
- **v0.14 — Planning-experience pass.** Three small refinements from translating a researcher's
  *plan-the-next-move* use-case into the value-only frame — no new machinery, and the action-domain
  framing of the same intuition stays retired (v0.12). (1) **Phase coverage reconciled.** Run-procedure
  step 2 now samples "across the six fields **and the phases**," matching P14's anti-dark-room
  commitment, which step 2 had under-stated (fields only). Phase stays a **sampling-balance and reading
  axis**, never a structure — the retired lifecycle map is *not* reintroduced. (2) **Planning named as a
  target experience.** §1's north star and P5's usefulness lens now name *planning the next research
  move* explicitly: a researcher locates their phase in the inquiry's arc, descends to the disposition
  that bears on it, and reads the if-then signature (P9) and exemplar groundings as what that
  disposition looks like, lived, at that phase. (3) **Anticipatory link-comments.** The link-comment
  format (§8) notes that an exemplification claim may make the **anticipatory/allostatic** read explicit
  — naming the conduct as the disposition *leaning in before the situation demands it* (the body-budget
  logic of §1), which is where the retired cost/benefit note now surfaces.

---

## 1. Purpose

Orca models the researcher's **dispositional self** — the standing **values** that characterize how
a researcher works: *who they are* as a researcher, not what research is (P9). Chaos's single job is
to build and continually revise a graph of these dispositions, grounded in real research. **The
tool's meta-objective is usefulness to a researcher** — not completeness, not taxonomic tidiness.
("Usefulness" is therefore not a value node; it is the lens every proposal is judged against — P5.)

A value is **aspirational**: it names who a researcher wants to be. The dispositions are the
researcher's character — the invariants that hold across the changing contexts of their work
(the if-then signature, P9). Earlier drafts framed this as one column of a four-domain cost/benefit
landscape (values/questions as benefit, actions/tools as cost); that frame is **retired** (v0.12).
Chaos now graphs *only* the dispositional layer.

Why dispositions are the right thing to anchor on draws on what Lisa Feldman Barrett writes about
cognition as anchored by **body budgeting** — the brain's categories are shaped by an economy of
finite energy and the decisions made with it, and that budgeting is **allostatic** (*anticipatory*,
not reactive): the brain predicts before it provisions. A researcher's dispositions are exactly the
anticipatory stances that economy settles into — the characteristic ways they lean *before* a
situation demands it. That is what makes a disposition a *standing prediction* (P14) and not a
momentary act.

**The experiential north star: sharing a big research brain.** What the mechanics serve is a felt
experience — navigating Orca should feel like traveling the neural pathways of research's
dispositional landscape: descending a graph follows a pathway from a broad virtue deeper into its
specific dispositions; tunnels are the long-range fibers that associate distant regions; exemplar
links are where a disposition touches real research. This is the extended-mind commitment (§2) made
experiential, and the phi principle (P12) is its structural measure — integration across
differentiated regions is what makes a brain a brain rather than a filing cabinet. In
predictive-processing terms Orca is a **designer environment that installs predictions** (Clark, §2):
descending a path is acquiring a prior, crossing a tunnel imports a remote prediction, an exemplar
link is where a prediction touches the world. The goal of seeding is therefore not "store knowledge"
but *install good research priors that make a researcher's character more navigable.* Proposals
should be judged partly by whether they make the brain feel more *travelable*: depth to descend into,
bridges to cross, hooks that invite the journey. One thing this travel is *for*: a researcher mulling
a next move can locate their phase in the inquiry's arc (P9), descend to the disposition that bears on
it, and read its if-then signature and exemplar groundings as what that disposition looks like, lived,
at that phase — planning as navigation of one's own dispositional character. Travel itself has **two
gears** (P15): executive
descent — deliberate, stepwise movement down analytic edges — and default-mode drift — associative
jumps across tunnels, flips to alternate parents, thematic leaps between siblings. The drift is
**controlled**, not loose: every associative leap is scaffolded by analytic structure and witnessed
by grounding (P8), which is the executive control on the leap. The graph should reward both gears.

---

## 2. Foundations

Eight bodies of thought Chaos is built to honor. Each is stated as a *commitment*, not a
citation.

- **Genre analysis (Swales' CARS tradition).** Genre analysts read research writing not for its
  surface terminology but for what each part is *doing* — the rhetorical work it performs in the act
  of claiming research space. **Commitment:** Chaos reads a document for what its *conduct* is
  doing — the choices it embodies, the posture it takes — not for the words on its surface. (An
  earlier draft borrowed CARS's specific *move sequence* to populate research phases and questions;
  with those retired in v0.12, what stays load-bearing is the conduct-over-terminology stance
  itself.) (→ P3, P10.)

- **Campbell's monomyth (the hero's journey).** A cyclical event-structure — departure,
  initiation, return — that recurs across stories as a lens for interpreting them.
  **Commitment:** treat research as having a recognizable temporal arc and read papers as
  episodes within it — a researcher's dispositions show differently at different points in that
  arc (the if-then signature, P9). The arc is used **two ways, kept distinct**: the *field's*
  progression is tracked through citations (temporal depth, frontier dispositions — P11), and the
  *researcher's* phase within the arc (exploratory → confirmatory → reporting) is a **context axis**
  for reading how a disposition varies (the "if" of the if-then signature, P9) — a reading lens,
  not the retired concept-sorting phase map. (→ P9, P11.)

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
  tracking research as it unfolds. (→ P11, P14.)

- **Barsalou, situated conceptualization — and the vices of nominalization.** Concepts are not
  abstract tokens; they develop *within situations of action* that integrate self, environment,
  action, and outcome, and they function to support predictions for action. Two consequences are
  load-bearing for Chaos. First, concepts are **context-dependent**: the same concept is
  reconstructed differently in each context it's used in, and one disposition is realized by many
  different instances (degeneracy) — which is the warrant for multi-parent placement and for prizing
  discipline-diverse grounding (P1, P15, P13). Second, Barsalou's *Mind in Context* conclusion names
  *the vices of nominalization* — the error of freezing a contextualized *process* (a verb) into a
  context-free *thing* (a noun); this is the deep root of P3 (subtextuality), the P9 phrasing
  ceiling / disposition guardrail, and P17. (→ P1; P3; P9; P15; P17.)

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
  adopts it — which is what the separate seed-account provenance is *for* (§6). Smith & Collins's
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

A convergence worth noting: four of these commitments form one spine — the mind models the world
(predictive processing, beneath active inference), updates that model through action and perception
(active inference), extends it into trusted technology (extended mind), and is worth more the more
integrated the model becomes (integrated information). Chaos grows that extended, integrated model.
And one further convergence earns its keep: *precision* (PP), *recurrence-confidence* (P13), and the
inverse of *phi-noise* (P12) are the same underlying quantity — how much to trust a piece of
structure — seen from three foundations, which is why one ledger value (P16) can serve all three.

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
(§6). Naming it keeps the "good context work" claim honest about its current edge.

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

### P2 — Dispositions, not practices or methods *(sharpened)*
The graph holds **dispositions** — standing qualities of the researcher (see P9). A *practice or
strategy*, an *instrument or method*, a *step you take* — these are the **behaviors a disposition
enacts**, and Chaos no longer graphs them (the action/tool/question domains are retired, v0.12). They
still matter as *evidence*: a paper's practices and methods are read as signs of the disposition
behind them (P10), but the node is always the disposition, never the behavior.
- **The disposition-vs-behavior line:** a value is a *standing quality*; the practice is its
  *exercise*. Keep the node on the quality. The discipline holds even without an action domain to
  send the behavior to — a disposition that has slid into the behavior that enacts it has stopped
  being a disposition.
- **Yes:** "Skeptical of one's own conclusions" (disposition).
- **No:** "Run every defensible version of the analysis" as a value — that is the *behavior* the
  disposition drives, not the disposition.

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

### P5 — The usefulness lens & the hypothetical-researcher test
Before proposing anything, simulate a researcher reflecting on how they work. Ask: would landing on
this disposition, and this exemplar document, help them recognize or sharpen a value *instantiated
in actual research* in a way that informs who they are as a researcher? If not, don't propose it. The
sharpest form of this test is the researcher *planning a next move* — would landing here help them see
how a disposition they aspire to actually shows at the phase they are entering (P9), with research that
proves it can be done? A linked document must be an **exemplar that demonstrates the disposition** —
research whose conduct
*shows* the disposition at work — not one that merely discusses it. (Co-grounding, the engine of
tunnels, is now P8.)

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

### P8 — Co-grounding *(first-class)*
A tunnel between two dispositions is strongest when a **single document instantiates both ends** —
then the association is witnessed, not guessed. When one paper exemplifies both dispositions a
tunnel connects (e.g. a paper whose conduct shows *both* "Skeptical of one's own conclusions" and
"Measured"), the tunnel is co-grounded and trustworthy. A tunnel that no single document grounds on
both ends is more speculative — propose it more cautiously. Co-grounding is the executive control on
the associative leap (P15): "lean associative" never means "lean loose."

### P9 — The researcher as fulcrum (self-anchoring)
Every disposition is a predicate of the researcher's **self**, which is what gives a concept its
felt, "this is mine" quality. Intimacy comes from the *referent* (a person), not from grammar — so
**no first-person pronouns are needed**, and concepts stay short. A value names *who I am*; the
anchor — the self — is what lets the graph read as a coherent self-portrait of a researcher's
character.
- **The phrasing ceiling (composability discipline):** a concept must remain a noun, gerund,
  or short imperative *phrase* that can take a parent and children and read general →
  specific. It may **never** become a declarative clause with a truth value.
  - **Yes:** "Skeptical of one's own conclusions." **No:** "Open data improves reproducibility"
    (a proposition — stops being an ontology node).
- **Guardrail (with P2):** a value-disposition must not slide into the behavior that enacts
  it. ("Skeptical," not "tests the result every way.")
- **The value as an if-then signature (Mischel & Shoda, "the situated person").** A disposition's
  stability is *not* context-free constancy but a recognizable **pattern of variability** — a stable
  *if-then* signature across contexts. The variability is the signal, not noise. This *deepens* the
  guardrail rather than softening it: the **value is exactly the invariant across** the (context →
  conduct) signature — the disposition is the standing leaning, the conduct in each context is how it
  shows.
  - **The "if" runs on two context axes, kept distinct.** *Research phase* — where in the inquiry's
    arc the conduct sits (exploratory → confirmatory → reporting and the like): "if exploratory,
    then bold; if confirmatory, then conservative." And *discipline* — the field the conduct comes
    from. They are complementary: phase captures how a disposition shifts across the stages of one
    inquiry; discipline captures how it holds across fields. **Phase here is a reading lens only** —
    a way of locating the conduct so a signature can be read — *not* a structure Chaos builds or
    sorts concepts into (the lifecycle map is retired, v0.12). The phase set is illustrative and
    revisable, never settled scaffolding.
  - So a disposition is best grounded by a **coherent signature across both axes**, not by raw
    frequency (P13/P16): a value that bends the same characteristic way across phases *and* recurs
    across fields is the most strongly held.
- **The reciprocal loop (Foucault × extended mind, §2).** Self-anchoring is not only the
  *precondition for trust*; it is one half of a loop. The self shapes the graph (orderer), and the
  graph, once adopted, reshapes the self who predicts and plans with it (ordered). A seeded
  disposition therefore helps *constitute* its adopter — so prefer dispositions and framings you'd
  want a researcher to be *formed by*. A concept only crosses from social resource to genuine
  cognitive extension when the user **adopts/endorses** it; Chaos's seed content sits in the
  *consult* register until then (extended-mind commitment, §2).

### P10 — Read conduct as evidence of disposition
Read a paper for the **dispositions** its conduct reveals — not for the words on the page. A paper
is a record of choices a researcher made, and those choices are evidence of standing character: what
they hedged, what they disclosed, what they tested, what they refused to overclaim. The node is
always the disposition; the conduct is the sign.
- **Stance is the primary instrument (Hyland's metadiscourse).** Dispositions barely surface in the
  literal content of methods/results — they live in **interactional metadiscourse**, especially the
  *stance* system: **hedges** (might, suggests), **boosters** (clearly, demonstrate), **attitude
  markers** (surprisingly, importantly), and **self-mention**. Stance is how a writer encodes
  dispositional posture, so read the paper's stance profile as evidence of the researcher's
  dispositions:
  - heavy hedging around a strong result → **Measured**;
  - explicit self-mentioned reporting of disconfirming results → **Forthcoming**;
  - hedged, concessive engagement with one's own conclusions → **Skeptical of one's own
    conclusions**.
- **Conduct as corroboration.** The practices and methods in the paper (preregistering, running
  every defensible analysis, depositing data) are not themselves nodes (P2), but they corroborate
  the disposition behind them — a paper that *both* hedges its claims *and* runs robustness checks
  is double evidence for a cautious, self-skeptical character. Read conduct and stance together; the
  disposition is what they jointly point to.
- Works with P3 and P9: P3 pushes away from the paper's vocabulary toward the lived disposition;
  P9 anchors that disposition to the self.

### P11 — One evolving model, with temporal depth
Chaos maintains and revises a *single* model of the researcher's dispositions as it consumes
research (active inference). The model needs **temporal depth**: a paper sits between prior work it
advances and future work that advances from it, and Chaos tracks this through citation relationships
among linked papers (Section 5), building a progression axis. *How* the model learns from research —
prediction and error — is P14.

- **The citation network is a *predictive* temporal model.** A deep temporal model doesn't only
  record a sequence, it **predicts the next state**: given a trajectory A→B→C, what advances next?
  The citation axis is the substrate for predicting *research trajectories* — and thus for the
  frontier dispositions a trajectory is heading toward.
- **Frontier concepts (a condition-gated capability, not a future plan).** Once the citation model
  is **robust enough to be genuinely predictive**, Chaos can surface **frontier concepts** — places
  the trajectory is clearly heading but where groundings are still sparse or absent — and prioritize
  them for active sampling (P14) and, where warranted, propose them *ahead of* their grounding. This
  is not deferred work or a roadmap item: it is *only possible* once the model is robust, but it is
  **acted on as soon as that condition holds**, automatically, the way Phase B auto-write is gated
  on validation signals maturing (§6). The trigger is a property of the model, not a date. The
**automated reflect/consolidate loop** (learning model, below) is the other clear case: the episodic
store and the *manual* reflect step exist now, but the *self-writing* loop waits on Phase B autonomy
maturity and switches on then.
- **The emptiness is a stigmergic signal.** A frontier concept seeded before research has
  instantiated it carries a deliberate **empty grounding** — no exemplar links yet. That emptiness
  is not a defect; it is a **stigmergic trace** (cf. the restructure-mentions of P6/§5): a mark left
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
  response showing up in context after context — not raw frequency. The contexts run on P9's two
  axes: **research phase** (the same characteristic bend across the stages of an inquiry) and
  **discipline** (the same characteristic showing across fields). Patterned variability that holds on
  both *strengthens* a value (the signature is appearing), which sharpens the discipline-diversity
  preference from "appears in many fields" to "shows a consistent characteristic pattern across
  fields *and* phases."

### P14 — The graph is a set of predictions; learn from prediction error
The whole graph is a standing set of predictions about research, and each new article tests
them. This — not human feedback — is the primary learning signal; the aim is to maximize what
is learned from every article and to lean on curation as little as possible. Three forms of
error, three operations:
- **Gap (under-prediction):** the article instantiates something the graph cannot hold → *add* it.
- **Non-confirmation (doesn't bear out):** the graph holds a disposition research keeps
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
carries an explicit prediction and a ledger (confirmed / expected-but-absent /
appeared-elsewhere). **Honor the confirmation/disconfirmation asymmetry (Bouton):** a confirmation
*generalizes* across contexts (be ready to extend a confirmed concept into new regions), but a
disconfirmation is *local* (don't globally retire what merely failed to appear in one context). And
because **prediction error is what makes context diagnostic** (P16), the first response to a violated
prediction is to ask *what was different about this context* — context-specific decay or a renewal
elsewhere — before any global decrement.

**Active sampling.** To maximize learning per article and to test fairly, source next what most
reduces uncertainty — the shakiest predictions (dispositions added but unconfirmed), the regions a
prediction must be sampled in before it can be retired, and (once the citation model is robust)
the **frontier dispositions** the trajectory points toward (P11).
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
hypothetical-researcher test (P5) and carry an exemplar — association licenses the *placement*,
never the existence, of a concept.

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

- **Precision as a ledger value.** Each concept carries a **precision** distinct from raw
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
  Chaos's meta-cognition (§6).
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

There is a single attribute domain: **`[value]`** (v0.12). Everything Chaos graphs is a researcher
disposition.

**Roots are hooks.** The root level is a distinct part of the user experience: it's the storefront,
and it should intrigue. A good root is a short, category-opening name that makes a visitor curious
what lives beneath it. New abstract roots may be proposed sparingly when recurrence supports a
genuinely new region (P13), and judged partly as invitations: does this root promise an interesting
descent? In PP terms (§2.1) a root is also the **standing prior / "mindset"** — the coarsest gist
that pre-frames every descent beneath it. So a root isn't only an intriguing label; it's the prior
the whole sub-tree is read against, which is why getting roots right matters out of proportion to
their count.

### Values — dispositions of the researcher
Values describe *who the researcher is*, not what research is (P9). Roots are broad virtues; leaves
are specific dispositions; children define the parent. The forest of independent roots stands (no
literal "Good" node). Dispositions are **hard to populate from a paper's literal content** — they
barely surface in methods/results. The instrument that finds them is the **stance/metadiscourse
read** (P10): a paper's hedges, boosters, attitude markers, and self-mention encode the researcher's
dispositional posture, and that is where most value leaves are actually found, corroborated by the
conduct itself.

- **Example roots:** Transparency, Rigor, Honesty — already person-describing. The disposition
  discipline bites at the leaves, where earlier drafts described the *work* rather than the standing
  quality. Re-voicings:
  - "Inspectability of evidence" → **Open to scrutiny**
  - "Calibrated claims" → **Measured**
  - "Robustness to analytic choices" → **Skeptical of one's own conclusions** (the *testing* itself
    is the behavior the disposition drives, not a node — P2)
  - "Reporting disconfirming results" → **Forthcoming** (this one was secretly behavior-shaped; the
    reframe keeps the disposition and drops the *act* — so self-anchoring doubles as a detector for
    value leaves that were really behaviors)
- **Candidate root (emerged, not yet seeded):** Protecting participants / research ethics — in
  genuine tension with Transparency, which is a feature.

### Corpus and cross-disciplinarity
Pull from across the cognitive sciences — **neuroscience, psychology, linguistics, AI,
philosophy, anthropology**. **Cross-disciplinary concepts are especially valuable:** a
disposition or strategy that recurs across, say, neuroscience and anthropology is more
likely to be a deep, lived, subtextual concept than a discipline-bound term.

---

## 5. Run procedure

1. **Load state.** Read the current graph (concepts, edges, links, citation relationships,
   prediction ledgers) from the dev database; load this rubric.
2. **Assemble the working set of papers** (active sampling, P14, P16). Source to *test the graph's
   shakiest predictions* — unconfirmed dispositions, regions a prediction must be sampled in before
   it can be retired, and (once the citation model is robust) the **frontier dispositions** the
   trajectory points toward (P11). Rank candidates by **epistemic × pragmatic value** (P14):
   uncertainty reduced × usefulness to a researcher. Where a disposition is high-stakes, include a
   **severe test** — a region where it *must* appear if genuine and *won't* if a reading-list
   artifact (P16). Keep coverage balanced across the six fields **and the phases** (exploratory →
   confirmatory → reporting) — the anti-dark-room bias guard (P14); sampling the whole arc is what
   lets each disposition's if-then signature (P9) be read across it, not just where the corpus clusters.
   - *Revisit:* re-read already-linked documents — a grown graph may now offer dispositions they
     did not have on their last pass.
   - *Fetch:* pull a batch of new open-access papers spanning the cognitive sciences
     (neuroscience, psychology, linguistics, AI, philosophy, anthropology), preferring full
     text and cross-disciplinary material.
3. **Disposition read & prediction test** (P10, P14, P16). For each paper, read it for the
   **dispositions its conduct and stance reveal** (P10): the **stance/metadiscourse** profile
   (hedges, boosters, attitude markers, self-mention) as the primary instrument, corroborated by the
   conduct itself (what the researcher tested, disclosed, or refused to overclaim). Note the
   **research phase** the conduct sits in (exploratory → confirmatory → reporting) as the "if"
   context for P9's signature — a reading lens, not a structure. Score it
   *against what the graph predicted it would contain*: record gaps (add), non-confirmations (toward
   decay), and mis-structures (restructure) — and for each, note the **level** the surprise lives at
   (local → add a child; parent can't absorb → restructure, P6) and the **provenance** of any
   confirmation (actively-targeted vs. independent, P16). Apply P2, P3, P9.
4. **Concept-driven pass.** For each new/recent disposition, scan existing linked documents that
   should now connect to it; note tunnel candidates.
5. **Hypothetical-researcher test** (P5) and **co-grounding check** (P8) on every candidate
   link, disposition, and tunnel.
6. **Citation tracking** (P11). Record citation relationships among linked papers to build the
   temporal progression axis as a *predictive* temporal model. Once it is robust enough to be
   predictive, surface **frontier dispositions** (trajectory heading there, groundings sparse/absent)
   as active-sampling targets and, where warranted, as proposals carrying a deliberate empty
   grounding — a stigmergic call for research (P11).
7. **Ledger, recurrence, precision & phi pass** (P12, P13, P14, P16). Update each disposition's
   prediction ledger from this run (confirmations, expected-but-absent, appeared-elsewhere), and
   update **precision** — weighting recurrence by discipline-diversity and consistency, discounting
   confirmations that arrived only in actively-targeted samples, and crediting severe-test survivals
   (P16). Decay only what's been fairly sampled and still unconfirmed, reversibly, at a rate set by
   precision. Then rank the candidate set by its contribution to integrated information — the
   familiar↔novel balance, judged as **cause-effect work** not bare connectivity (P12) — preferring
   well-grounded additions that bridge previously-separate regions and **change a prediction** over
   those that thicken dense ones, and applying the accuracy−complexity test (P4): each addition must
   pay its structural cost.
8. **Structure check** (P6, P15). Consider mid-path insertions / restructurings, including the
   mis-structures surfaced in step 3, and multi-parent placements for dispositions whose groundings
   span contexts. Check child sets for analytic/associative balance, preferring **remote** over
   near associations (P15). **Every restructure proposal includes its mention**: a stigmergic
   addendum at the superseded location carrying the in-orca URL of the new one ("this is now more
   fully held at …"), so old paths point forward instead of dead-ending — and the new location
   accrues "Mentioned by" traces.
9. **Emit proposals** in the formats below, within the concept-creation budget. Write nothing
   to the database without review.
10. **Capture feedback** (secondary signal). Each item accepted/rejected/modified, with a
    reason; reasons hone the *reader* — edits to this rubric (Section 0) — and recede over time
    as the research-driven loop (P14) takes over.
11. **Record the run** (episodic substrate, §6). Finalize a run record — the working set with its
    sampling rationale, every proposal with its prediction / precision / provenance / surprise level,
    the outcomes and their reasons, and any reflect notes — validate it against the schema and commit
    it to `chaos/episodic/`, so the run persists across dev-DB rebuilds and feeds the
    reflect/consolidate step.

---

## 6. Architecture & operation

How Chaos is *built and run*, distinct from *what* it reasons (Section 5).

**Shape.** Chaos is a **staged pipeline orchestrated as a Claude Code skill** — not an
autonomous agent swarm. Deterministic plumbing is small, testable scripts; reasoning stages
are Claude calls guided by this file. The separation keeps the tool legible and keeps a
database write from ever depending on an opaque agent loop.

**The pipeline:**
1. *Snapshot* (code) — read the dev DB into a compact structured state (concepts, edges,
   links, citation edges, prediction ledgers).
2. *Source* (code/API) — fetch open-access papers across the six fields; full text; dedupe
   against already-linked papers; pull citation metadata.
3. *Read & decompose* (Claude) — read each paper for the dispositions its conduct and stance
   reveal, into candidate concepts, links, tunnels, and a prediction test against the current graph.
4. *Integrate* (Claude) — tunnels, multi-parent placements, citation edges.
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
  citation edges) while still queuing **high-risk** outputs (new dispositions, roots) for review,
  because append-only makes concept creation sticky. The
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
  record is a run-procedure step (§5, step 11).

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

## 7. Knobs (current settings)

| Knob | Current setting | Notes |
|---|---|---|
| `corpus_focus` | Cognitive sciences across six fields | Neuroscience, psychology, linguistics, AI, philosophy, anthropology |
| `cross_disciplinary_preference` | High | Dispositions recurring across fields are especially valued |
| `papers_per_run` | 5–10 new + revisit set | |
| `concept_creation_budget` | Conservative | Calibrate from feedback; the accuracy−complexity test (P4) is its principle |
| `disposition_discipline` | Firm | P2 — keep the node on the standing quality, never the behavior that enacts it |
| `concept_voice` | Researcher-anchored | Dispositions — *who I am* (P9) |
| `phrasing_ceiling` | Short, composable phrase; never a proposition | P9 |
| `subtextuality_strictness` | Firm but soft-edged | P3 |
| `stance_reading` | On (primary instrument) | P10 — read hedges/boosters/attitude/self-mention as the main evidence of disposition |
| `phase_signature_axis` | On (reading lens) | P9/P13 — research phase as the "if" context for a disposition's if-then signature; a lens for reading variation, **not** a concept-sorting phase map |
| `exemplar_verification` | Trust the claim | Flip to verify-the-artifact at time cost |
| `cogrounding_preference` | Preferred | P8 — value↔value tunnels witnessed by a shared document |
| `tunnel_types` | Value↔value associative (doc-grounded) | P8/P15 — the long-range fibers between dispositions |
| `citation_tracking` | On | P11 — predictive temporal model; substrate for frontier dispositions |
| `frontier_seeking` | Off (gated) | P11 — activates automatically once the citation model is robust; not scheduled |
| `phi_balance` | Prefer integrative + differentiated | P12 — weak IIT; cause-effect *work* not connectivity; distinctions + relations |
| `recurrence_tracking` | On | P13 — confirmation signal; seclusion-limited (P16) |
| `precision_weighting` | On | P16 — weight recurrence by confidence + discipline-diversity; modulates learning/decay rate |
| `confirmation_provenance` | Tracked; targeted discounted | P16 — independent re-exemplification counts more than actively-targeted |
| `severe_testing` | On for high-stakes dispositions | P16 — corroborate with a test the concept could have failed; gates root promotion |
| `disconfirmation_policy` | Cautious; precision-modulated; context-scoped | P14/P16 — untested ≠ disconfirmed; decay reversible and *local* to the context where confirmation failed (Bouton); rate set by precision |
| `active_sampling` | On; epistemic × pragmatic | P14 — shakiest predictions × usefulness (P5); explore→exploit arc |
| `sourcing_balance` | Enforced across fields | P14 — the anti-dark-room bias guard as curation recedes |
| `edge_character_mix` | Lean associative, never monoculture; prefer remote | P15 — analytic + associative; remoteness gradient; controlled drift |
| `multi_parent_placement` | On, grounding-gated | P15/P1 — context-dependence; propose additional parent contexts; populates flip view |
| `anti_essentialism_guard` | On | P17 — situate, don't essentialize; no name-based merging; integrate by connection, not collapse |
| `restructure_mentions` | Always emitted with restructures | §5 step 8 — stigmergic forward-pointers at superseded locations |
| `autonomy_phase` | A (human-gated) | Phase B (low-risk auto-write) after honing — see Section 6 |
| `restructuring_willingness` | High in proposals, low once applied | P6 |
| `root_abstractness` | Mid | |
| `revisit_policy` | Every run | |

---

## 8. Proposal & feedback formats

- **Concept (disposition) proposal:** parent path; new child; edge
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
  claim (how the conduct instantiates the concept) — which may make the **anticipatory/allostatic**
  read explicit, naming the conduct as the disposition *leaning in before the situation demands it* (§1).
- **Tunnel proposal:** from-edge ↔ to-edge (disposition ↔ disposition); rationale as the
  association kind (similarity, thematic, analogy, metaphor, affective — P15); the co-grounding
  document where one exists (P8); the **cause-effect work** it does (what crossing it changes about a
  prediction — P12).
- **Prediction-test outcome (per article):** gaps (add), non-confirmations (toward decay),
  mis-structures (restructure) — the article scored against what the graph predicted; each tagged
  with the **surprise level** and, for confirmations, **provenance** (independent vs.
  actively-targeted) and whether it was a **severe** test (P14, P16).
- **Citation relationship:** paper A advances paper B (A cites B) → a progression edge.
- **Mid-path insertion:** the existing edge refined; the new intermediate; the resulting
  Parent → X → child path.
- **Feedback (per item):** accept / reject / modify + reason. Reasons drive rubric edits.
