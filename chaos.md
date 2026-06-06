# ORCA Graph-Seeding Tool — Rubric

**Version:** 0.1 (first real draft)
**Purpose of this file:** This is the tool's *brain* — the set of principles, the run
procedure, and the tunable knobs it uses to propose contributions to Orca's concept
graphs. It is meant to be read, argued with, and edited. Every run is an opportunity to
refine it. It does **not** store the graph itself (see Principle 7).

---

## 0. Changelog

- **v0.1** — First draft. Established Principles 1–7, the run procedure, the knob table,
  and the values-domain notes. Built from the Transparency / Rigor / Honesty seed
  (two cognitive-science exemplar papers) and four design directives: subtextual
  concepts, the cost/benefit lens + hypothetical-researcher step, mid-path insertion,
  and a bounded cognitive-science corpus with document revisiting.

---

## 1. Purpose

Orca's four domains together model a **cost/benefit analysis of research**:

- **Benefit — what to move toward:** *values* and *open questions*.
- **Cost — what pursuing them takes:** *actions* and *tools*.

A researcher planning new work is, in effect, navigating this cost/benefit landscape.
The motivating analogy (held loosely, not as a claim) is the predictive-processing view
of mind: the brain runs a hierarchical generative model that cascades from abstract to
concrete, and that model is plausibly shaped like a cost/benefit calculation. Orca's
abstract-to-concrete hierarchies may mirror that shape. If so, then exploring Orca's
graphs, tunnels, and linked documents should be genuinely useful when planning a
research proposal and weighing its costs against its benefits.

**The tool's meta-objective is therefore usefulness to a researcher-planner** — not
completeness, not taxonomic tidiness. (This is why "Usefulness" is not itself a value
*node*: it is the lens every proposal is judged against. See Principle 5.)

---

## 2. Core principles

Each principle is a standalone, editable entry. Format: the rule, why it holds, and a
Yes/No example to keep it concrete.

### P1 — Concept identity by path
A concept is defined by its children, in the context of its parent path. Moving *down* a
hierarchy moves from general to specific; a child is part of what makes up its parent,
though that relationship can be abstract.
- **Why:** This is Orca's native semantics (path-dependent identity). The same name under
  a different parent is a different entity.

### P2 — Graph qualities, not practices or methods *(confirmed)*
A value graph holds **qualities** (expressions of the Good). A *practice or strategy*
belongs in the **action** graph; an *instrument or method* belongs in the **tool** graph.
A value leaf bottoms out at the most specific *quality*; one step more concrete and you
have crossed into another domain. The paper that performed the practice becomes the
**exemplar link** tying the quality to its instantiation, and the cross-domain concept
becomes a **tunnel candidate**.
- **Why:** Without this, the value graph quietly collapses into a to-do list of
  open-science chores.
- **Yes:** "Calibrated claims," "Inspectability of evidence."
- **No:** "Specification-curve analysis" (a tool) or "Preregister the analysis" (an
  action) as value concepts.

### P3 — Subtextual, not terminological
Graph the researcher's *lived and tacit* conceptualization, not the article's vocabulary.
Ask: "What is this paper an instance of, in the felt experience of doing research?" The
right concept is one a researcher would recognize as theirs **even if the paper never
names it.** This is a soft line — the concept may appear in the source — but the aim is to
sit *above or beneath* the literal text, in the more abstract ways of thinking about
research that papers rarely state outright.
- **Why:** The point of Orca is to help people think about research more abstractly and
  more personally than the documents themselves do. Indexing jargon defeats that.
- **Yes:** "Honesty about intentions" (no paper says this; a researcher recognizes it).
- **No:** Indexing "researcher degrees of freedom" or "FAIR principles" because those
  phrases appear in the source.
- **Relation to P2:** Both push concepts away from the literal text — P2 by domain
  (qualities vs. practices/methods), P3 by abstraction (experience vs. terminology).

### P4 — Grow from encounters, not taxonomy
A new concept appears because a real paper exemplified something the graph could not yet
hold — not because the taxonomy "felt incomplete." Evidence-led growth keeps the graph
first-person and subjective, and resists drifting into a tight technical ontology.

### P5 — The cost/benefit lens & the hypothetical-researcher test
Before proposing anything, simulate a researcher planning new work and navigating the
cost/benefit reasoning of Section 1. Ask: *would landing on this concept, and this
exemplar document, help that researcher see this benefit (value / open question) or this
cost (action / tool) instantiated in actual research, in a way that informs their own
plan?* If not, do not propose it. A source document linked to a concept must be an
**exemplar that demonstrates the concept being instantiated**, not a document that merely
discusses it.
- **This test is also the engine of tunnel proposals.** The most useful tunnels join a
  benefit-domain concept to the cost-domain concept it implies (value ↔ action/tool;
  open question ↔ action/tool), modeling "to obtain this benefit, here is the cost."
  Within-side tunnels (value ↔ question, action ↔ tool) are also valid.

### P6 — Do not be a prisoner of existing structure (mid-path insertion)
Be willing to insert a concept *between* an existing parent and child, or otherwise
restructure. Mechanically, under append-only, you never move an edge: you create the new
intermediate edge (Parent → X) and a new edge (X → existing child), and support migrates
to the better path via votes and future links; the original edge persists until the
community deprecates it through moderation.
- **Practical rule:** Restructure **freely while still in the proposal stage** (it costs
  nothing there). Restructure **already-applied** structure only when the improvement is
  clear, because append-only leaves the superseded edges behind as residue.

### P7 — Brain vs. state separation *(meta)*
This rubric is the *brain* (how to decide). The graph in the database is the *state*
(what has been decided). The rubric never hard-codes the current graph; it encodes the
principles that generate and revise it.

---

## 3. Domain notes

### Values *(active focus)*
Values are expressions of the Good; children define the parent more than the reverse. All
root-level values are notionally children of a proto-root "Good" that we do **not**
instantiate — the value domain is a *forest* of independent root graphs, not one tree
under a literal "Good" node.

- **Current roots:** Transparency, Rigor, Honesty.
- **Candidate root (emerged, not yet seeded):** Protecting participants / research ethics
  — in genuine tension with Transparency, which is a feature, not a bug.
- **Rejected as a node:** Usefulness — it is the meta-objective (P5), not a value.

### Open questions *(benefit side, not yet built)*
A parent question is answered by answering its more concrete child questions; concrete
questions are stepping stones to abstract ones.

### Actions *(cost side, not yet built)*
Abstractions read almost as strategies, with more concrete steps beneath them.

### Tools *(cost side, not yet built)*
Generic tool concepts connect more concrete examples of actual tools.

---

## 4. Run procedure

1. **Load state.** Read the current graph (concepts, edges, links) from the dev database;
   load this rubric.
2. **Assemble the working set of papers.**
   - *Revisit:* re-read already-linked documents — as the graph grows, an old paper may
     now exemplify concepts that did not exist on its last pass.
   - *Fetch:* pull a small batch (≈5–10) of new open-access papers within the corpus
     focus, preferring full text (methods/results are needed to judge exemplification).
3. **Doc-driven pass** (per paper). Decompose the paper's *conduct* across all enabled
   domains. Identify the subtextual qualities and open questions it instantiates
   (benefit) and the actions and tools it used (cost). Apply P2 and P3 throughout.
4. **Concept-driven pass** (per newly-proposed or recently-added concept). Scan existing
   linked documents for ones that should now connect to it. Note tunnel candidates.
5. **Hypothetical-researcher test** (P5). For each candidate link, concept, and tunnel,
   run the cost/benefit simulation. Keep what informs a real planning decision; drop the
   rest.
6. **Structure check** (P6). Consider mid-path insertions or restructurings that improve
   the graph — freely in the proposal, conservatively against already-applied structure.
7. **Emit proposals** in the format below, within the concept-creation budget. Write
   nothing to the database without review.
8. **Capture feedback.** Each item is accepted, rejected, or modified, *with a reason.*
   The reasons are distilled into edits to this rubric (logged in Section 0).

---

## 5. Knobs (current settings)

| Knob | Current setting | Notes |
|---|---|---|
| `corpus_focus` | Cognitive sciences | Interdisciplinary within, bounded to limit breadth |
| `papers_per_run` | 5–10 new + revisit set | |
| `concept_creation_budget` | Conservative | Last run: 3 roots + 6 children from 2 papers — calibrate from feedback |
| `domain_boundary_strictness` | Firm | P2 |
| `subtextuality_strictness` | Firm but soft-edged | P3 — concept may appear in source, but aim above the text |
| `exemplar_verification` | Trust the claim | We trust data-availability statements; flip to verify-the-artifact at time cost |
| `root_abstractness` | Mid | Transparency / Rigor / Honesty level, not a single "Integrity" root |
| `restructuring_willingness` | High in proposals, low once applied | P6 |
| `tunnel_proposal` | On | Prefer benefit ↔ cost cross-domain tunnels (P5) |
| `revisit_policy` | Every run | Re-pass linked docs for newly-available concepts |

---

## 6. Proposal & feedback formats

**Concept proposal:** graph + attribute; parent path; new child concept; rationale
(why it belongs here, general→specific, subtextual).

**Link proposal:** target edge; URL; title (auto-fetched); comment = the exemplification
claim (how the document's *conduct* instantiates the concept).

**Tunnel proposal:** from-edge ↔ to-edge; rationale stated as a cost/benefit relation.

**Mid-path insertion:** the existing edge being refined; the new intermediate concept;
the resulting Parent → X → child path.

**Feedback (per item):** accept / reject / modify + reason. Reasons drive rubric edits.
