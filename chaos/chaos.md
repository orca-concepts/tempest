# Chaos — design

**Architecture:** category-first (supersedes the v0.x bottom-up lineage, now archived)
**Domain:** the Orca `[value]` graph only
**Status:** v1.0 design — a buildable spec; review decisions settled (§10)

---

## 0. What changed, and why

The previous Chaos (v0.x) did **unsupervised concept discovery**: read papers in batches, extract
recurring dispositions, and let structure emerge under a predictive-processing / dark-room
discipline. After eight runs the graph was a flat two-layer tree — strong recurrence and precision on
broad virtues, but no depth and no multi-parent integration. The architecture was solving the wrong
problem. *Discovering* which categories exist is hard, and was never the goal; the space of research
values is already well-mapped by scholarship. The goal is a **deep, richly integrated, instantiated
taxonomy of research values** — the assertion and instantiation of category membership, structured to
*expand* a researcher's own value-thinking rather than mirror consensus back at them.

So the design inverts to **category-first**: author the category structure (deep, top-down, grounded
in scholarship), then go find real research that instantiates each node. This separates two problems
the old tool tangled into one per-paper loop — **building structure** (a generative / taxonomic
problem) and **grounding it** (an empirical / retrieval problem). Most of the old tool's hard
problems (flattening, the dark room, blind sampling) were artifacts of the bottom-up batch model;
under the inversion they don't get solved, they stop existing.

## 1. The target artifact — the shape of the graph

The graph is **a deeply differentiated KIND-OF hierarchy woven into an integrated web**. Not a clean
tree, not a flat list:

- An **analytic backbone** that descends by real, expectation-changing distinctions (depth comes from
  genuine differentiation, never padding).
- **Multi-parent placement** wherever a value-kind genuinely is a kind-of under several parents —
  each placement a distinct *contextual entity* (path-dependent identity), surfaced as flip view.
  This is the primary integration mechanism (see §8).
- Every node **grounded in research situations** and **instantiated by real research** (§2, §5).
- Integration ("phi") read out as a **richness map**: dense, meaningfully cross-linked regions are
  rich; sparse tree-only regions are underdeveloped and flag where to deepen.

**Every node has two faces.** A *structural identity* — an abstract name and its place in the
hierarchy, used for integration and navigation — and a *lived rendering* — its research-conduct
expression (the if-then / situated-conduct signature), used for display, for the user-facing hook,
and as the target the Instantiator grounds. Abstraction and lived-ness are not a single-axis
tradeoff per node; they are the two faces of the same node.

**Depth comes from differentiation; interest comes from integration.**

## 2. Architecture — three engines and the run model

**The Categorizer** builds and deepens the taxonomy top-down, reasoning about the *category space*,
not about papers. It takes a value and differentiates it into its kinds, and those into their kinds,
as deep as the distinctions are real. It is **bold** — it differentiates *ahead of* the documented
literature, carving distinctions the values scholarship implies but hasn't named — held honest by the
admission rules in §5. Its aggressiveness is a dial set **bold** and calibrated by review of the real
graph it produces, not by a fixed rule. Multi-parent placement is central to its work, not an
afterthought.

**The Instantiator** takes a node and finds research that **demonstrably exemplifies** it —
*demonstrates, not discusses* (the one discipline worth keeping from the old design). It is a
retrieval-plus-judgment task, and its retrieval is **targeted by the node it is grounding** (this is
why the old "active sampling" problem dissolves — there is never a blind batch to sample). Recurrence
and cross-field diversity survive only as an **instantiation-richness signal**, never as a category-
birth mechanism.

The **graphed unit is the paper** (the link runs concept → paper, as today), but the **link comment
must name the specific research act *within* the paper that demonstrates the value** — the actual
instantiation, not the paper in general. *Demonstrates-not-discusses* sharpens accordingly: the
evidence is a concrete act, cited in the comment. **Heuristic — papers should attach to multiple
concepts.** Having read a paper, extract *every* value it instantiates, not only the node you came
for; a paper linked to just one concept flags an under-utilized paper.

**The Scout** is a light bottom-up channel that scans research and proposes **new frontiers within the
existing spine** — distinctions or groundings the taxonomy is missing — for the Categorizer or a user
to take up. It proposes frontiers, *not new roots*. It is the old discovery engine, demoted from the
main loop to a suggestion box, and it is how the design keeps the *surprise* that pure top-down loses.

**The run model is frontier-driven, not batch.** The unit of work is **develop a frontier**, with
categorizing and instantiating *interleaved*:

1. Pick a frontier (a thinly-integrated region, a high-traffic node, a Scout-flagged gap).
2. The Categorizer differentiates it (boldly).
3. For each proposed child, the Instantiator immediately tries to ground it. Grounded → admitted, with
   its instances and its place in the integration quota. Ungroundable → demoted to a sub-frontier
   ("someone find this"), not deleted.
4. The integration checks run (§5).
5. New frontiers are emitted (§5 frontier obligation).

The Scout runs separately, feeding new frontiers into the queue. Review is **per-region and legible**
(you watch one value get differentiated and grounded), not a triage of a hundred proposals from a
random batch.

## 3. Scholarship foundations

**Layer one — what research values are, and how they are structured.** Virtue epistemology (Zagzebski;
Roberts & Wood, *Intellectual Virtues*; Baehr, *The Inquiring Mind*); philosophy-of-science values
(Kuhn's theory-choice virtues — accuracy, consistency, scope, simplicity, fruitfulness; Longino;
Douglas on epistemic vs. contextual values); research integrity (Merton's CUDOS norms; conduct
codes); metascience and open science (reproducibility, transparency, pre-registration); and, for the
power / vulnerability / other-ways-of-knowing values, Fricker's epistemic injustice and standpoint /
feminist epistemology (Haraway's situated knowledge).

**Layer two — what makes a good category structure at all** (the layer a pure values read would
miss): the cognitive science of categorization — Rosch (prototypes, **basic-level categories**, graded
membership), Gärdenfors (conceptual spaces — categories as regions in quality dimensions), Lakoff
(radial categories). This layer is where the repurposed chaos foundations (§4) live.

## 4. Categorizing principles (the repurposed chaos foundations)

The old foundations survive **not as discovery machinery but as principles for what makes a category
worth asserting**:

- **Predictive processing → the differentiation test.** Don't split a value into sub-kinds unless
  having the distinction *changes what you expect* of the instances. This is the engine of depth and
  the discipline against padding.
- **IIT / phi → the meaningful-integration richness map.** The graph should be integrated, not a tree
  of isolated branches — but with Cerullo's expander-graph result as the guardrail: integration only
  counts when each connection does predictive work, never raw density. Phi reads out rich vs. thin
  regions; it is, in effect, the formalization of "interesting."
- **Grounded cognition → context as the axis of differentiation.** Categories are anchored in research
  situations (the lived rendering / if-then signature), and you *split a value by the situations in
  which it manifests differently*. This is how depth stays lived rather than abstract.
- **Extended mind → the telos.** Orca is a cognitive prosthesis for the researcher's value-thinking.
  The graph exists to *expand* the researcher's categories. (See §6.)
- **Foucault (*The Order of Things*) → reflexive humility.** The taxonomy is *an* ordering, openly
  re-orderable, not the final word.
- **Severe testing / precision → demoted** to the instantiation discipline and the instantiation-
  richness signal.

## 5. Admission rules — the forcing functions

These are the operational heart: what makes a node or a placement admissible. They exist to force the
creative and integrative outcomes the design wants and to make lazy structure impossible.

**Two gates (every node):**

1. **Changes-expectations.** A distinction is admitted only if it does predictive work — knowing it
   changes what you expect of the instances.
2. **Instantiable.** A category is admitted only if real research can be found that demonstrates it.
   Ungroundable nodes become frontiers, not graph members.

**Three integration forcing functions:**

3. **Context-differentiated multi-parent quota — substantial.** Multi-parenthood should be pervasive:
   **most concepts should end up with at least one child that also has an alternate parent.** A node
   counts as genuinely abstract/integrative only when it has ≥2 parents *and differentiates differently
   under each* (different children per parent context) — two parents with the same children is
   duplication, not integration. This is natural for the values domain, where the same lived conduct
   expresses several virtues at once (e.g. *reporting null results* is a kind-of Honesty, Courage, and
   Rigor), so the coverage target is achievable; the demanding part is the context-differentiation, and
   that is deliberate — it forces real integrative work rather than shared-child duplication.
4. **Abstraction must bridge.** A new abstract node must connect ≥2 previously-separate regions. An
   "abstraction" atop a single branch is a branch label, not an abstraction. Every move up the
   hierarchy is thereby an act of integration by construction.
5. **Frontier obligation.** Every carve must emit at least one **frontier**. The graph therefore cannot
   close into a finished catalog; productive incompleteness is structural, not aspirational.

**Frontier (first-class object).** A marker that further differentiation or grounding is invited at a
location. Kinds: a node flagged "differentiates further"; an ungroundable proposed distinction held as
"someone find this"; or a resemblance with no shared parent ("what is the missing abstraction?").
Frontiers are simultaneously the tool's work queue and the user's invitation surface (§6).

## 6. Generativity and the researcher

The countermeasure to a static mirror of consensus is **productive incompleteness**: the graph is
**always more differentiated than the literature, and always frontiered beyond where it is
differentiated.** The Categorizer differentiates ahead of documented consensus (creative), held honest
by the two gates (not confabulatory). Where it reaches but hasn't yet carved or grounded, it leaves a
frontier.

A frontier is an **invitation**, and it is where the tool's creative work and the user's creative work
meet — the same mechanism serves both. The tool (Scout, Categorizer) works frontiers; the **researcher**
is invited to assert the distinction *they* find meaningful, instantiate it, and let the community
weigh it (Orca's append-only, community-voted substrate). Extended mind runs both directions: the
graph expands the researcher's categories, and the researcher expands the graph's.

**The single bar across all featured / entry content: "too obvious" = "non-generative."** A node that
expands nothing — that the researcher already has — does not belong on the surface. Every featured
node must hand the researcher a distinction or framing they did not already have, in lived terms.

## 7. Roots, hooks, and the conduct translation

At the top of a value hierarchy, abstraction and obviousness are *positively correlated*: the most
abstract values just are the virtue-words everyone already nods at (Honesty, Rigor, Care). So "root"
is doing two jobs, and the tension comes from asking one node to do both:

- the **integration ceiling** — the high abstraction that things multi-parent *under* (wants to be
  abstract), and
- the **entry hook** — the thing a researcher clicks (wants to be lived and non-obvious).

**Split them.** Keep the virtue-word abstractions as a thin **navigational / integration skeleton** —
de-emphasized, providing orientation and the multi-parent ceiling — but *not* the featured entry
points. The **hooks sit at Rosch's basic level** (the informative, action-relevant middle level),
rendered as **lived research conduct**.

The **value-conduct translation is the mechanism** for this, and it does double duty: rendering a
value as conduct moves it from obvious-abstract to lived-basic (so it hooks), *and* makes it
instantiable (conduct is what you find in papers). "Honesty" (inert) → "owning the load-bearing
assumption your result depends on, before a reviewer finds it" (a researcher leans in, and it can be
grounded). This is the node's *lived rendering* face (§1).

**Caution against over-correction:** keep the abstractions for orientation. If every surface node is a
surprising specific, the top level becomes a pile of micro-insights with no map. Demote the
virtue-words from hooks to skeleton; do not delete them.

## 8. Relations and structure

- **Multi-parent placement is the primary integration relation** (§5.3). Path-dependent identity: the
  same value-kind under different parents is different contextual entities, surfaced as flip view.
- **Tunnels (lateral resemblance links) are removed.** They had become lazy association ("thematic",
  "affective" labels with no structural consequence). The information they carried converts to either
  multi-parenthood under a now-named shared abstraction, or a frontier ("what is the missing
  abstraction?"). Creativity relocates into multi-parenthood, which is a harder and more accountable
  act than an analogy label.
- **Pure hierarchy — no lateral relations of any kind** (decided). No tunnels and no tension relation.
  The KIND-OF hierarchy and multi-parent placement are the only structure. Value-tensions (Boldness vs.
  Caution) are not first-class edges; a reader can still see an opposition by navigating siblings, but
  the graph does not assert it. The cost is accepted in exchange for forcing every connection to be a
  genuine kind-of or multi-parent relation, never a lazy lateral label.
- **Append-only** (concepts and edges; the existing user link-deletion carve-out stands). Restructuring
  is additive — add a parent, insert an intermediate, leave a mention at the superseded location —
  never a destructive move. The mention is the append-only-preserving marker.

## 9. Inherited invariants

- **`[value]`-domain only** (the action / tool / question domains were retired in the v0.12 pivot; that
  stands).
- **The disposition / value voice** (if-then situated-conduct phrasing) carries over as the lived
  rendering.
- **`apply.js` (the writer) largely survives** — its multi-parent and restructure-mention paths are
  already built and additive; it will need extension for frontiers-as-first-class-objects and the
  conduct-rendering face. `reason.js` (per-paper discovery) and `source.js` (batch sampling) are
  **replaced** by the Categorizer and the Instantiator's targeted retrieval.
- **The new taxonomy is authored fresh from the scholarship — not seeded from the 23 dispositions.**
  Those were produced by the bottom-up process being replaced; carrying them in would import the flat,
  emergent shape we are leaving behind. The existing graph is **cleared at cutover** (as the v0.12 pivot
  cleared it), and the new taxonomy is built from scratch by the Categorizer.

## 10. Settled decisions (from review)

1. **Relations:** pure hierarchy — no tunnels, no tension relation (§8).
2. **Unit of instantiation:** the paper is the graphed unit; the link comment names the specific
   research act within it; papers should attach to multiple concepts (§2).
3. **Seed authoring:** scholarship-synthesis, performed by the Categorizer's *genesis mode* (§11), not a
   separate pre-build step.
4. **Multi-parent quota:** substantial — most concepts should have at least one child with an alternate
   parent (§5.3).
5. **Categorizer boldness:** set bold, calibrated empirically against the real graph (§2).
6. **Seed material:** authored fresh from scholarship; the 23 dispositions are not carried in; the
   graph is cleared at cutover (§9).

## 11. Transition and build order

The seed spine is **not** a separate human-authoring phase that precedes building — authoring the
taxonomy from scholarship is literally the Categorizer's job. The initial skeleton and hooks are simply
the Categorizer's **genesis mode**: its first output, not its prerequisite.

1. **Build the Categorizer**, including a *genesis mode* that authors the initial abstract skeleton and
   its basic-level, conduct-translated hooks from the scholarship (§3) into an empty graph. After
   genesis, it runs in frontier-driven mode (§2).
2. **Build the Instantiator** — targeted retrieval and demonstrates-not-discusses judgment; the paper as
   graphed unit, with the research act named in the comment (§2).
3. **Build the frontier object + queue and the admission rules** (§5), interleaving categorize and
   instantiate per the run model.
4. **Build the Scout** last.
5. **Extend `apply.js`** for frontiers-as-first-class-objects and the conduct-rendering face; **retire
   `reason.js` / `source.js`**; **clear the existing graph** at cutover (§9).
6. **Archive the old `chaos.md`** (bottom-up lineage) as reference.
