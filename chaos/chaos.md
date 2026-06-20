# Chaos — design

**Architecture:** category-first, **adjective-constrained** (supersedes v1.0's conduct-translation model)
**Domain:** the Orca `[value]` graph only
**Status:** v2.0 design — a buildable spec; the conduct face is removed (§7), nodes are bare quality-adjectives

---

## 0. What changed, and why

Two inversions brought the design here.

**The first inversion (v1.0) was bottom-up → category-first.** The original Chaos read papers in
batches and let dispositions emerge; after eight runs the graph was a flat two-layer tree. Discovering
*which* categories exist is hard and was never the goal — the space of research values is already
well-mapped by scholarship. So the design inverted to: author the category structure top-down, then go
find research that instantiates each node. That inversion stands.

**The second inversion (v2.0) is situated-conduct → bare adjective.** v1.0 gave every node *two faces*:
an abstract name and a "lived rendering" — a baked-in situated-conduct string ("owning the load-bearing
assumption before a reviewer finds it"). In practice the nodes came out self-oriented and over-situated,
and this was not an execution error — it is what §4's "split by the situation" and §7's "conduct
translation" *instructed*. Two problems followed:

- **A situated string is single-parent by construction.** It is already so fully specified that it fits
  in exactly one place; it has no blanks left to mean something different under a different parent. This
  defeats multi-parenthood, which is the entire integration engine (§5, §8).
- **It puts chaos in the wrong job.** Language is generative because it combines small pieces into
  complex situations. A baked situation does that combining *for* the user — handing them an insight the
  author already had, instead of handing them pieces from which they make insights the author didn't.

So nodes become **bare quality-adjectives**. The situation does not disappear; it **relocates** — to the
user (supplied at read-time, confronting a familiar word in an unfamiliar place) and to the **path**
(meaning is compositional: `Rigorous > Controlled > Blinded` reads as a narrowing). Shorter, blank-leaving
adjectives are good *precisely because* they don't paint the whole picture: they ask the reader what is
being asserted by this word, here, in this position.

**Symmetry is the organizing principle.** Chaos manipulates exactly the objects the user manipulates —
categories presented in the app, nothing more. There is no privileged hidden layer, no conduct string
chaos knows that the user can't see. Chaos is a participant in the same graph the researcher navigates,
not an oracle authoring a richer structure underneath. This is why the conduct face is removed, not
merely de-emphasized.

## 1. The target artifact — the shape of the graph

The graph is **a deeply differentiated KIND-OF hierarchy of quality-adjectives, woven into an integrated
web.** Not a clean tree, not a flat list:

- Every node is **one thing**: a quality-adjective ("Honest", "Transparent", "Reproducible") and its
  place in the hierarchy. No second "lived" face.
- An **analytic backbone** that descends by real, expectation-changing distinctions — by *respect* and
  *standard*, never by padding (§4, §5).
- **Multi-parent placement** wherever an adjective genuinely is a kind-of under several parents — each
  placement a distinct *contextual entity* (path-dependent identity), surfaced as flip view. This is the
  primary integration mechanism (§8), and the bare-adjective form is what makes it pervasive: a reusable
  word can sit under many parents and **mean something different in each**.
- **Meaning is compositional.** The unit of meaning is the **path**, not the node — a path reads as a
  near-sentence ("good research that is rigorous, by way of control, by way of blinding"). The node
  contributes a word; the path contributes the assertion.
- Every node **grounded in real research** by instantiation (§2, §5), with abstract nodes grounded *by
  aggregation* rather than directly (§2).
- Integration ("phi") read out as a **richness map**: densely multi-parented, cross-linked regions are
  rich; sparse tree-only regions are underdeveloped and flag where to deepen.

**The blank is the point.** A bare adjective in a position leaves a blank the reader fills. This is
productive incompleteness turned inward (§6): the graph is incomplete not only at its frontiers but
inside every node.

**Depth comes from differentiation; interest comes from integration.**

## 2. Architecture — three engines and the run model

The three engines are named for the order that emerges out of Chaos: **Ouranos** (the Categorizer — the
structuring sky), **Gaia** (the Instantiator — the grounding earth), and **Krius** (the Scout — the Titan
at the frontier).

**The Categorizer (Ouranos)** builds and deepens the taxonomy top-down, reasoning about the *category space*. It
takes a quality-adjective and differentiates it into its kinds — narrower qualities — as deep as the
distinctions are real. Its differentiation move is **"good in what respect, by what standard?"** (§4):
each child is a *dimension along which* the parent quality is realized. It is **bold** — it carves
distinctions the values scholarship implies but hasn't named — held honest by the admission rules in §5.
Multi-parent placement is central to its work, not an afterthought.

**The Instantiator (Gaia)** takes a node and finds research that **demonstrably exhibits** it — *exhibits, not
discusses*. Its retrieval is **targeted by the node it is grounding** (so the old "blind sampling"
problem never arises). Recurrence and cross-field diversity survive only as an **instantiation-richness
signal**, never as a category-birth mechanism.

The **graphed unit is the paper** (the link runs concept → paper), but the **link comment must name the
specific feature of the work that exhibits the quality** — the actual instantiation, not the paper in
general. **Heuristic — papers should attach to multiple concepts.** Having read a paper, extract *every*
quality it exhibits; a paper linked to just one concept flags an under-utilized paper.

**Instantiation grounds concrete leaves; abstract nodes are grounded by aggregation.** A bare abstract
adjective ("Honest") is not directly groundable — there is no "honest act" to point at. So the
Instantiator only ever grounds **concrete leaves**, where a deep composed path is specific enough that a
real research feature exhibits it (a double-blinded study exhibits `…Controlled > Blinded`). Abstract
nodes get their reading list by **path-scoped upward aggregation**: a link added at path `A > B > C`
also surfaces at edges `B` and `A` *along that same path*. (Path-scoped, not concept-id-scoped: the link
follows the path it was added under, not every parent the concept has elsewhere — this is path-dependent
identity again.) The aggregated instances are also the node's only **gloss**: you understand
`Honest > Transparent` by seeing what got linked beneath it. This keeps abstract nodes empty-and-
generative while still giving the reader grip.

**The Scout (Krius)** is a light bottom-up channel that scans research and proposes **new frontiers within the
existing spine** — a missing adjective, a missing multi-parent placement, an ungrounded distinction —
for the Categorizer or a user to take up. It proposes frontiers, *not new roots*. It is how the design
keeps the *surprise* that pure top-down loses.

**The run model is frontier-driven, not batch.** The unit of work is **develop a frontier**, with
categorizing and instantiating *interleaved*:

1. Pick a frontier (a thinly-integrated region, a high-traffic node, a Scout-flagged gap).
2. The Categorizer differentiates it (boldly).
3. For each proposed child, the Instantiator immediately tries to ground it (at the leaf). Grounded →
   admitted, with its instances and its place in the integration quota. Ungroundable → demoted to a
   sub-frontier ("someone find this"), not deleted.
4. The integration checks run (§5).
5. New frontiers are emitted (§5 frontier obligation).

The Scout runs separately, feeding new frontiers into the queue. Review is **per-region and legible**,
not a triage of a hundred proposals from a random batch.

## 3. Scholarship foundations

**Layer one — what research values are.** Virtue epistemology (Zagzebski; Roberts & Wood, *Intellectual
Virtues*; Baehr, *The Inquiring Mind*); philosophy-of-science values (Kuhn's theory-choice virtues —
accuracy, consistency, scope, simplicity, fruitfulness; Longino; Douglas on epistemic vs. contextual
values); research integrity (Merton's CUDOS norms; conduct codes); metascience and open science
(reproducibility, transparency, pre-registration); and, for the power / vulnerability / other-ways-of-
knowing values, Fricker's epistemic injustice and standpoint / feminist epistemology (Haraway's situated
knowledge). These supply the *adjectives*.

**Layer two — what makes a good category structure** (and, in v2.0, how to carve an adjective into
narrower adjectives). **Gärdenfors (conceptual spaces — categories as regions in quality dimensions) is
now central**: differentiating an adjective means finding the *quality dimensions* along which the
parent is realized. Rosch (prototypes, **basic-level categories**, graded membership) sets where to pitch
the informative middle level; Lakoff (radial categories) for the multi-parent web. This layer is where
the repurposed chaos foundations (§4) live.

## 4. Categorizing principles (the repurposed chaos foundations)

- **Predictive processing → the differentiation test.** Don't split an adjective into sub-adjectives
  unless having the distinction *changes what you expect* of the instances. The engine of depth and the
  discipline against padding.
- **IIT / phi → the meaningful-integration richness map.** Integration should be real, not raw density
  (Cerullo's expander-graph guardrail): a connection counts only when it does predictive work. Phi reads
  out rich vs. thin regions — the formalization of "interesting."
- **Conceptual spaces → differentiate by respect and standard.** You split an adjective by finding the
  *dimension of quality* it varies along: "Rigorous" → rigorous in control of confounds (Controlled), in
  measurement (Calibrated), in inference (Warranted). The **differentiating context is now the parent
  adjective itself** — "Careful" means one thing under "Honest", another under "Rigorous" — so context
  lives in the path, never baked into the node. This replaces v1.0's "split by situation."
- **Extended mind → the telos.** Orca is a cognitive prosthesis for the researcher's value-thinking. The
  graph exists to *expand* the researcher's categories — best done by handing them combinable pieces, not
  pre-assembled insights. (See §6.)
- **Foucault (*The Order of Things*) → reflexive humility.** The taxonomy is *an* ordering, openly
  re-orderable, not the final word.
- **Severe testing / precision → demoted** to the instantiation discipline and the richness signal.

## 5. Admission rules — the forcing functions

The operational heart: what makes a node or placement admissible. They force the creative and integrative
outcomes the design wants and make lazy structure impossible.

**Two gates (every node):**

1. **Changes-expectations, and is separable.** A distinction is admitted only if it does predictive work
   — and, because bare adjectives invite a *thesaurus* (Honest / Truthful / Candid / Forthright piling up
   as synonyms with no expectation-difference), the test is sharpened to **contrastive separability**:
   - research can be **{parent} but not {child}** (the child names something the parent doesn't entail),
     and
   - research can be **{child} but not {sibling}** (the child is pull-apart-able from its siblings).
   If "Transparent" and "Open" can't be pulled apart, they are one node. This synonym guardrail is the
   v2.0 analog of the old flattening problem — more acute here, because evaluative adjectives are dense
   with near-synonyms — and it is the primary discipline of the Categorizer.
2. **Instantiable at or below.** *Leaves* must be instantiable — real research can be found that exhibits
   them. *Interior adjectives need not be directly groundable*; they are admitted if they sit on a path
   that bottoms out in groundable leaves, and they are grounded by upward aggregation (§2). An interior
   node with no groundable descendants is a frontier, not a member.

**Three integration forcing functions:**

3. **Context-differentiated multi-parent quota — substantial.** Multi-parenthood should be pervasive:
   **most concepts should end up with at least one child that also has an alternate parent.** A node
   counts as genuinely integrative only when it has ≥2 parents *and differentiates differently under
   each* (different children per parent context) — two parents with the same children is duplication, not
   integration. This is natural for bare adjectives, where the same word expresses several qualities at
   once (e.g. *reporting null results* exhibits Honest, Courageous, and Rigorous); the demanding part is
   the context-differentiation, and that is deliberate — it forces real integrative work rather than
   shared-child duplication.
4. **Abstraction must bridge; specialization must compose.** *Up:* a new abstract node must connect ≥2
   previously-separate regions — an "abstraction" atop a single branch is a branch label, not an
   abstraction. *Down:* a child must read as a genuine narrowing of **the parent-as-read-in-context** —
   the path must remain a legible composition. Every move up is an act of integration; every move down is
   an act of composition.
5. **Frontier obligation.** Every carve must emit at least one **frontier**. The graph cannot close into
   a finished catalog; productive incompleteness is structural, not aspirational.

**Frontier (first-class object).** A marker that further differentiation or grounding is invited at a
location. Kinds: a node flagged "differentiate further"; an ungroundable proposed distinction held as
"someone find this"; or a resemblance with no shared parent ("what is the missing abstraction?").
Frontiers are simultaneously the tool's work queue and the user's invitation surface (§6).

## 6. Generativity and the researcher

The countermeasure to a static mirror of consensus is **productive incompleteness**, now in two senses:

- **At the frontiers** — the graph is always more differentiated than the literature, and always
  frontiered beyond where it is differentiated.
- **Inside every node** — a bare adjective in a position leaves a blank the reader fills. The lived
  meaning is generated at *read-time* by the user, not baked at *author-time* by the Categorizer.

A frontier is an **invitation**, and it is where the tool's creative work and the user's creative work
meet. The tool (Scout, Categorizer) works frontiers; the **researcher** is invited to assert the
distinction or placement *they* find meaningful, instantiate it, and let the community weigh it (Orca's
append-only, community-voted substrate). Extended mind runs both directions: the graph expands the
researcher's categories, and the researcher expands the graph's.

**The single bar across all featured / entry content: "too obvious" = "non-generative."** A node is
non-generative when its position asserts nothing the researcher didn't already have. Obviousness is
fought not by a surprising baked specific (v1.0's move) but by **position and contrast** — a familiar
adjective made non-obvious by where it sits and what it sits beside.

## 7. The adjective constraint — surface form and comprehension

The v1.0 tension — a root must be both the *integration ceiling* (wants to be abstract) and the *entry
hook* (wants to be lived and non-obvious) — is **dissolved, not split.** There is no separate hook
rendering. The same bare adjective serves both jobs: abstract at the top (the multi-parent ceiling),
made non-obvious lower down by position and contrast.

- **Nodes are quality-adjectives** — predicates the user applies to research ("this research is ___").
  The implicit unifying predicate is **"Good"** (good research is honest, is transparent, …); it is *not*
  a stored root node, just the frame.
- **Adjective form over noun form** — "Honest", not "Honesty"; "Reproducible", not "Reproducibility".
  This reinforces the predicate reading and the fill-in-the-blank stance.
- **As short as the quality allows.** Prefer a single adjective; allow a tight adjectival phrase only
  when no single word names the quality. Shorter = more reusable = more multi-parentable, which is the
  whole engine.
- **Comprehension comes from aggregated instances, not a stored gloss.** There is no `description` /
  `conduct` column and no per-node prose. An abstract node is understood through the research that
  aggregates beneath it (§2). Storing a private gloss would reintroduce the asymmetry §0 removes.

**Caution against over-correction:** keep the abstract adjectives for orientation. If every surface node
is a deep specific, the top level becomes a pile of micro-distinctions with no map. The virtue-words stay
as the navigational / integration skeleton — de-emphasized as entry points, never deleted.

## 8. Relations and structure

- **Multi-parent placement is the primary integration relation** (§5.3). Path-dependent identity: the
  same adjective under different parents is a different contextual entity, surfaced as flip view.
- **The path is the unit of meaning** — meaning is compositional, read along the path, not carried by the
  node alone.
- **Tunnels (lateral resemblance links) are removed.** The information they carried converts to either
  multi-parenthood under a now-named shared abstraction, or a frontier ("what is the missing
  abstraction?"). Creativity relocates into multi-parenthood, a harder and more accountable act than an
  analogy label.
- **Pure hierarchy — no lateral relations of any kind** (decided). No tunnels and no tension relation.
  Value-tensions (Boldness vs. Caution) are not first-class edges; a reader can see an opposition by
  navigating siblings, but the graph does not assert it. The cost is accepted in exchange for forcing
  every connection to be a genuine kind-of or multi-parent relation.
- **Append-only** (concepts and edges; the existing user link-deletion carve-out stands). Restructuring
  is additive — add a parent, insert an intermediate, leave a mention at the superseded location — never
  a destructive move.

## 9. Inherited invariants

- **`[value]`-domain only.** The action / tool / question domains were retired in the v0.12 pivot; that
  stands. Note that `[value]` is now read broadly as **quality-adjectives describing good research**, not
  dispositions of the researcher.
- **`apply.js` (the writer) largely survives** — its multi-parent and restructure-mention paths are built
  and additive. It must be **extended for path-scoped upward link aggregation** (§2) and for frontiers-
  as-first-class-objects, and should be **trimmed of the v0.x payload** (tunnels, papers, predictions,
  precision ledger) that pure hierarchy drops (§8). It no longer needs a conduct-rendering face. `reason.js`
  (per-paper discovery) and `source.js` (batch sampling) are **retired**.
- **The taxonomy is authored fresh from the scholarship — not seeded from the 23 dispositions, and not
  from the v1.0 46-node genesis proposal.** Both were produced under models being replaced (the 23 by
  bottom-up emergence; the 46 by conduct-translation) and would import the shape we are leaving. The
  existing graph is **cleared at cutover** (it was never written to from genesis, so no DB rollback is
  involved — only the proposal artifacts are superseded), and the new taxonomy is built from scratch by
  the Categorizer in genesis mode.

## 10. Settled decisions (from review)

1. **Relations:** pure hierarchy — no tunnels, no tension relation (§8).
2. **Unit of instantiation:** the paper is the graphed unit; the link comment names the specific feature
   of the work that exhibits the quality; papers should attach to multiple concepts (§2).
3. **Seed authoring:** scholarship-synthesis, performed by the Categorizer's *genesis mode* (§11).
4. **Multi-parent quota:** substantial — most concepts should have at least one child with an alternate
   parent (§5.3).
5. **Categorizer boldness:** set bold, calibrated empirically against the real graph (§2).
6. **Seed material:** authored fresh from scholarship; neither the 23 dispositions nor the v1.0 46-node
   proposal is carried in; the graph is cleared at cutover (§9).
7. **Nodes are bare quality-adjectives** (v2.0). The conduct / "lived rendering" face is removed; there is
   no `description` / `conduct` column; comprehension is via aggregated instances (§7). Chaos and the user
   manipulate the same objects (§0 symmetry).
8. **Instantiation grounds concrete leaves; abstract nodes are grounded by path-scoped upward
   aggregation** (§2).

## 11. Transition and build order

The seed spine is not a separate human-authoring phase — authoring the taxonomy from scholarship is the
Categorizer's *genesis mode*: its first output, not its prerequisite.

1. **Update this spec to v2.0** (the Categorizer loads `chaos.md` as its system prompt, so the spec is the
   behavior change). Done with this revision.
2. **Re-run genesis** under the v2.0 rubric → a fresh adjective proposal; run the structural validator;
   review the real graph for multi-parent density and separability.
3. **Build the Instantiator** — targeted retrieval and exhibits-not-discusses judgment; the paper as
   graphed unit, with the exhibiting feature named in the comment (§2).
4. **Build path-scoped upward link aggregation** — the instantiation-completion mechanism (§2). App-side
   query change: `getWebLinks` moves from a single `edge_id` to the set of ancestor edge ids along the
   link's path; the `graph_path` prefix arithmetic already exists in the codebase.
5. **Build the frontier object + queue and the admission rules** (§5), and the frontier-driven run mode in
   the Categorizer (genesis is currently one-shot).
6. **Build the Scout** last.
7. **Cutover housekeeping:** extend/trim `apply.js` (upward aggregation; drop the v0.x tunnel/paper/
   prediction payload); retire `reason.js` / `source.js`; clear the existing graph (§9). The v1.0
   `chaos.md` is already archived under `chaos/Chaos v0 (old)/`.
