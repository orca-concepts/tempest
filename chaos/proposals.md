# Chaos — Proposals (Run 1, bootstrapping seed)

**Generated:** 2026-06-10 (reasoning pass, Claude direct — not yet scripted)
**Rubric:** chaos.md v0.4
**Snapshot:** chaos/snapshot.json — **empty graph confirmed** (4 attributes: action/tool/value/question; 0 concepts, 0 edges, 0 links, 0 combos, 0 tunnels).
**Write target:** this file only. **No database access of any kind was performed.**

> Because the graph is empty, the prediction test (P14) yields **all gaps** for every
> paper — there is nothing yet to non-confirm or mis-structure. This run lays the seed:
> roots and a few high-value leaves, each grounded in a paper that *exemplifies* (not
> merely discusses) it. In-batch recurrences are flagged as the corpus's **first
> confirmations** (P13).

---

## Papers chosen (5), and why

Selected for cross-disciplinary spread (5 of the 6 fields represented) and for being
genuinely **move-step readable** — each is a record of research *conduct*, not a pure-math
artifact. All five had `full_text_available: true` (verified in each file's `full_text`).

| # | OpenAlex | Field(s) | Title (short) | Conduct phase (P10) | Full text |
|---|----------|----------|---------------|---------------------|-----------|
| 1 | W7163565667 | neuroscience / psychology | Estradiol & brain connectivity in midlife episodic memory | Executing + Interpreting | ✓ europepmc |
| 2 | W7163698933 | psychology | Youth mental-health journeys, arts-based virtual methods | Designing + Executing | ✓ europepmc |
| 3 | W4407185029 | linguistics / AI | SelfCheck-Eval: zero-resource LLM hallucination detection | Designing + Reporting | ✓ ar5iv |
| 4 | W7154200910 | artificial intelligence | Choose, Don't Label: multiple-choice query synthesis (Socrates) | Designing | ✓ ar5iv |
| 5 | W7162256314 | anthropology | Epigenetic archaeology of human-dog companionship | Sensing the gap + Committing | ✓ europepmc |

**Why this set.** It spans wet-lab neuroscience, qualitative psychology, NLP/ML, programming-
languages AI, and evolutionary/biological anthropology — five distinct *modes* of doing
research. That maximizes the chance that any disposition recurring across them is deep and
subtextual (P3) rather than discipline jargon. It also spreads the conduct across the
lifecycle (Section 6): a hypothesis-generating commentary (5), method/design papers (3, 4),
a participatory field study (2), and a secondary-data reanalysis (1). I deliberately skipped
the OpenAlex-mistagged pure-math papers (e.g. Spectral Synthesis, Andrews-Gordon identities,
Lieb functional) — they are real research conduct but thin for researcher-disposition
decomposition, and would have over-weighted one mode.

---

## Lifecycle phase set used (Section 6, provisional)

Sensing the gap → Committing to a question → Designing the approach → Executing and wrestling
with data → Interpreting → Reporting and returning → (back to sensing). No revision warranted
from this batch; flagged below where evidence is thin (the "Sensing"/"Committing" phases got
no *concepts* even though paper 5's conduct sits there — see note under the per-article tests).

---

# 1. Concept proposals

Format (§10): domain + attribute · parent path · new child · lifecycle phase · rationale
(general→specific, subtextual, self-anchored) · the prediction it makes. Roots show parent
path as "— (root edge)". Confidence: **C** = confirmed in-batch (recurs ≥2 papers); **S** =
single-grounded, speculative.

## Values (disposition graph) — 10

**VAL-1 · Rigor** — *(root edge)* · phase: Interpreting · **C**
Broad person-describing virtue; already a disposition, so the P9 reframe barely moves it.
Anchors the "who I am when I doubt my own result" region.
*Prediction:* careful research will keep instantiating self-directed doubt as a standing trait,
not just an occasional act.

**VAL-2 · Rigor › Skeptical of one's own conclusions** · phase: Interpreting · **C** (papers 1, 3, 4, 5)
The disposition behind multiple-comparison correction (1), three-module triangulation (3),
four-domain evaluation (4), and explicit falsification criteria (5). The *testing* itself lives
in the action graph (P2); this is the standing wariness that drives it.
*Prediction:* strong work will keep treating its own headline finding as the thing most in need
of attack.

**VAL-3 · Rigor › Skeptical of one's own conclusions › Willing to be proven wrong** · phase: Designing · **S** (paper 5)
Sharper child: not just doubting, but *building in* the conditions of one's own refutation.
Paper 5, though only a commentary, states falsification criteria and negative controls up front.
*Prediction:* the most credible proposals will name, in advance, the observation that would sink
them. (Watch for recurrence before promoting toward the root.)

**VAL-4 · Honesty** — *(root edge)* · phase: Reporting · **C**
*Prediction:* research will keep rewarding straight reporting of what was actually found and
actually claimed.

**VAL-5 · Honesty › Measured** · phase: Reporting · **C** (papers 1, 3, 5) — *strongest recurrence this run*
Calibrated claims; not overclaiming. Paper 1 labels exploratory analyses as exploratory and
reports a null; paper 3 reports its math-factuality trade-offs plainly; paper 5 repeatedly bounds
its claim ("not germline inheritance," "not dog-specific," plasticity vs programming).
*Prediction:* trustworthy work will keep sizing its claims to its evidence, flagging what is
tentative.

**VAL-6 · Honesty › Forthcoming** · phase: Reporting · **C** (papers 1, 3, 5)
Volunteering what cuts against you — limitations, confounds, disconfirming results. Paper 1's
extensive limitations + null; paper 3's honest failure modes on mathematics; paper 5's
competing-explanations and confound accounting.
*Prediction:* research will keep surfacing its own weak points rather than hiding them.

**VAL-7 · Transparency** — *(root edge)* · phase: Reporting · **C**
*Prediction:* the field will keep valuing work whose evidence others can inspect.

**VAL-8 · Transparency › Open to scrutiny** · phase: Reporting · **C** (papers 1, 3)
The disposition of *wanting* one's materials checkable. Paper 3 releases dataset + code; paper 1
is built atop openly shared data and posts supplementary analyses.
*Prediction:* credible work will keep making the artifacts behind it available for re-checking.

**VAL-9 · Attentive to the studied** — *(root edge)* · phase: Designing · **S** (papers 2, 5)
Emergent root (the Section-4 "Protecting participants / research ethics" candidate, voiced as a
disposition). The stance that the subject of study has a perspective the method must respect —
youth directing their own representation (2); dogs reframed as active partners, not passive tools
(5). Cross-domain (psych↔anthro) bridge — high potential phi, but the two senses differ, so
low confidence.
*Prediction:* if real, this will recur as a disposition to decenter the researcher's own framing
in favor of the studied subject's.

**VAL-10 · Attentive to the studied › Led by the subject's own framing** · phase: Designing · **S** (paper 2)
Specific leaf: letting the people studied set the terms. Paper 2's youth-directed arts-based
elicitation is the exemplar.
*Prediction:* participatory work will keep handing representational choices to participants.

## Actions (what I do) — 10

**ACT-1 · Pressure-test your own result** — *(root edge)* · phase: Executing · **C**
*Prediction:* strong empirical work will keep trying to break its own result before publishing it.

**ACT-2 · Pressure-test your own result › Run the analysis every defensible way** · phase: Executing · **C** (papers 1, 4)
Sensitivity / robustness across analytic choices. Paper 1 reports results with *and* without mean
imputation; paper 4 evaluates across four domains (symbolic + neurosymbolic).
*Prediction:* results that survive will keep being shown to survive more than one defensible
analytic path.

**ACT-3 · Pressure-test your own result › Cross-check by independent methods** · phase: Interpreting · **C** (papers 3, 5)
Triangulation: convergence of independent routes. Paper 3's three-agent triangulation strategy;
paper 5's integration of genomics + neuroscience + microbiome + archaeology toward one claim.
*Prediction:* confident claims will keep being backed by more than one independent line of evidence.

**ACT-4 · Make the work checkable** — *(root edge)* · phase: Reporting · **C**
*Prediction:* research will keep producing artifacts that let others re-run or re-examine it.

**ACT-5 · Make the work checkable › Deposit your data and code openly** · phase: Reporting · **C** (paper 3; consumed by paper 1)
Paper 3 releases the AIME benchmark on HuggingFace and code on GitHub; paper 1 is the consumer
side (it exists because HCP deposited openly).
*Prediction:* reproducible work will keep shipping its data and code, not just its conclusions.

**ACT-6 · Report it straight** — *(root edge)* · phase: Reporting · **C**
*Prediction:* the field will keep rewarding reports that match what was actually done and found.

**ACT-7 · Report it straight › Report findings that cut against your hypothesis** · phase: Reporting · **C** (papers 1, 5)
Paper 1 reports the null (no E2↔performance relationship) prominently; paper 5 specifies the
falsification criterion under which its own thesis is rejected.
*Prediction:* honest work will keep publishing the result that disappoints the authors.

**ACT-8 · Report it straight › State up front what would disprove the idea** · phase: Designing · **S** (paper 5)
The behavioral exercise of VAL-3 (kept a separate node per P2's disposition↔behavior line).
Paper 5 lists exposure-gradient, within-site, negative-control, specificity, and falsification
tests before any data.
*Prediction:* the strongest proposals will keep pre-committing to their own disconfirmation conditions.

**ACT-9 · Let the subject direct the inquiry** — *(root edge)* · phase: Designing · **S** (paper 2)
The behavioral exercise of VAL-9/VAL-10. Paper 2 lets youth choose ecomaps, journey maps, or an
art piece of their choosing.
*Prediction:* participatory designs will keep ceding methodological choices to the studied.

**ACT-10 · Ask the question that most reduces uncertainty** — *(root edge)* · phase: Designing · **S** (paper 4)
Active-sampling-as-conduct (resonates with P14's own active sampling). Paper 4's Socrates
synthesizes the *most informative* multiple-choice query to disambiguate intent fastest.
*Prediction:* efficient inquiry will keep choosing the next question by how much it shrinks
uncertainty, not by convenience.

## Tools (what I use) — 5

**TOOL-1 · Shared public dataset** — *(root edge)* · phase: Executing · **C**
Generic tool root connecting concrete open datasets across fields (a deliberate phi bridge:
one tool node spans neuroscience and AI).
*Prediction:* research will keep building on datasets it did not itself collect.

**TOOL-2 · Shared public dataset › Human Connectome Project (HCP-Aging)** · phase: Executing · **S** (paper 1)
Paper 1's entire analysis runs on the HCP-Aging 2.0 release.
*Prediction:* aging-brain work will keep reusing HCP releases.

**TOOL-3 · Shared public dataset › Open benchmark dataset** · phase: Executing · **C** (paper 3; paper 4 four-domain benchmarks)
Paper 3 builds and releases the AIME math-hallucination benchmark; paper 4 evaluates on shared
benchmark domains.
*Prediction:* method papers will keep being validated on (and contributing) open benchmarks.

**TOOL-4 · Method for eliciting lived experience** — *(root edge)* · phase: Designing · **S** (paper 2)
Generic root for participatory/qualitative elicitation instruments.
*Prediction:* experience-centered research will keep reaching for structured elicitation methods.

**TOOL-5 · Method for eliciting lived experience › Journey mapping** · phase: Executing · **S** (paper 2)
Paper 2 uses journey maps (and ecomaps) as youth-directed elicitation artifacts.
*Prediction:* temporal-experience studies will keep using mapping artifacts to externalize a trajectory.

## Questions (what I ask) — 2 *(not phase-mapped, §6)*

**Q-1 · Whether a lived relationship leaves a biological trace** · **S** (paper 5)
Paper 5 asks whether 20,000 years of human-dog co-residence is detectable in human regulatory
biology — a genuine open question, not a proposition.
*Prediction:* this will keep generating concrete sub-questions (which loci? which exposure
windows? which controls?).

**Q-2 · Telling trustworthy output from fabrication** · **S** (paper 3)
The standing question behind hallucination detection: how do I know a generated answer is real?
*Prediction:* this will keep spawning sub-questions about consistency, uncertainty, and domain
specificity.

---

# 2. Link proposals

Format (§10): target edge · URL · comment = the exemplification claim (how the conduct
*instantiates* the concept). Titles auto-fetch on apply. URLs are each paper's `best_oa_url`.
Grouped by paper. A link is proposed only where the paper *demonstrates* the concept (P5).

**Paper 1 — https://doi.org/10.1007/s11682-026-01167-1**
- → VAL-5 (Measured): pre-labels its recall/cerebellar follow-ups as "exploratory" and reports the E2↔performance null without spin.
- → VAL-6 (Forthcoming): devotes a full limitations passage to between-subjects design, mean-imputation skew, site effects, and unmeasured vascular confounds.
- → VAL-8 (Open to scrutiny): posts a supplementary analysis run *without* imputed values so readers can check the imputation's effect.
- → ACT-2 (Run the analysis every defensible way): reports the connectivity result both with and without mean-imputed E2 as a sensitivity check.
- → ACT-7 (Report findings that cut against hypothesis): foregrounds the null E2↔FaceName-performance correlation (r = −0.004).
- → TOOL-2 (HCP-Aging): builds the entire 150-participant analysis on the HCP-Aging 2.0 release.

**Paper 2 — https://doi.org/10.1371/journal.pone.0349860**
- → VAL-10 (Led by the subject's own framing): youth choose their own representational form (ecomap, journey map, or self-chosen art piece).
- → ACT-9 (Let the subject direct the inquiry): the arts-based methods are youth-directed, not researcher-prescribed.
- → TOOL-5 (Journey mapping): uses journey maps to let participants externalize their pandemic mental-health trajectory over time.

**Paper 3 — https://doi.org/10.1016/j.patter.2026.101569**
- → VAL-2 (Skeptical of one's own conclusions): designs detection around the premise that any single check is untrustworthy, hence triangulation.
- → VAL-5 (Measured): reports plainly that factual/ranking scores collapse on mathematical reasoning (e.g. AIME Factual ~30%).
- → VAL-8 (Open to scrutiny): releases the AIME benchmark (HuggingFace) and all code (GitHub).
- → ACT-3 (Cross-check by independent methods): the triangulation strategy combines symbolic, specialized-detection, and contextual-consistency agents.
- → ACT-5 (Deposit your data and code openly): publishes dataset and scripts for reuse.
- → TOOL-3 (Open benchmark dataset): constructs and shares a new open benchmark for the math-hallucination gap.

**Paper 4 — https://doi.org/10.1145/3808279**
- → ACT-2 (Run the analysis every defensible way): evaluates Socrates across four domains spanning symbolic and neurosymbolic settings.
- → ACT-10 (Ask the question that most reduces uncertainty): synthesizes the most-informative multiple-choice query (Hoare-triple clusters) to disambiguate intent efficiently.

**Paper 5 — https://doi.org/10.1080/15592294.2026.2676911**
- → VAL-3 (Willing to be proven wrong): frames its own thesis with an explicit falsification criterion.
- → VAL-5 (Measured): repeatedly bounds claims (plasticity/programming, *not* germline inheritance; *not* dog-specific causation).
- → VAL-6 (Forthcoming): enumerates competing explanations (diet, mobility, pathogen burden) and residual confounds.
- → VAL-9 (Attentive to the studied): reframes dogs as active co-regulators rather than passive tools or mere companions.
- → ACT-3 (Cross-check by independent methods): builds its case from convergent genomics + neuroscience + microbiome + archaeology evidence.
- → ACT-8 (State up front what would disprove the idea): pre-specifies exposure-gradient, within-site, negative-control, specificity, and dyadic-concordance tests.
- → Q-1 (Whether a lived relationship leaves a biological trace): the paper's whole move is to make this question testable.

---

# 3. Cost/benefit tunnel proposals

Format (§10): from-edge ↔ to-edge · cost/benefit relation · co-grounding document (P8).
All five below are **co-grounded** — a single paper instantiates both ends, so the relation is
witnessed, not guessed. (Benefit side = value/question; cost side = action/tool.)

**TUN-1 · VAL-8 Open to scrutiny ↔ ACT-5 Deposit your data and code openly**
Benefit (the disposition) realized through the cost (the act of release). **Co-grounded: paper 3**
(it is open to scrutiny *because* it deposits its benchmark and code).

**TUN-2 · VAL-5 Measured ↔ ACT-2 Run the analysis every defensible way**
Calibrated claims are *earned* by paying the cost of multiple defensible analyses. **Co-grounded:
paper 1** (the measured null is backed by the with/without-imputation sensitivity check).

**TUN-3 · VAL-3 Willing to be proven wrong ↔ ACT-8 State up front what would disprove the idea**
The disposition and its enacting behavior, across the value/action boundary (P2). **Co-grounded:
paper 5** (falsificationist stance realized as pre-registered disconfirmation tests).

**TUN-4 · VAL-2 Skeptical of one's own conclusions ↔ ACT-3 Cross-check by independent methods**
Self-doubt as benefit-side disposition; triangulation as the cost paid to satisfy it. **Co-grounded:
paper 3** (three-agent triangulation) — also exemplified by paper 5 (convergent cross-field evidence).

**TUN-5 · VAL-10 Led by the subject's own framing ↔ ACT-9 Let the subject direct the inquiry**
Disposition↔behavior across value/action. **Co-grounded: paper 2** (youth-directed elicitation).
*Confidence S* — inherits the speculativeness of VAL-9/VAL-10.

*Speculative tunnel held back (not proposed):* Q-2 (Telling trustworthy output from fabrication)
↔ ACT-3 (Cross-check by independent methods) — plausible but not co-grounded by a single paper
at both ends; deferred per P8's caution.

---

# 4. Situation proposals

Format (§10): member edges · name · phase · domain-balance read-out · intersection reading list
· core spine vs toggleable · cost/benefit-moment rationale.

**SIT-1 · "Breaking your own finding before others can"** · phase: Interpreting · **C**
- **Members (edges):** VAL-2 Skeptical of one's own conclusions · VAL-5 Measured · ACT-2 Run the
  analysis every defensible way · ACT-3 Cross-check by independent methods · TOOL-1 Shared public dataset.
- **Domain balance:** value ×2, action ×2, tool ×1, question ×0. Cost-and-benefit balanced; silent
  on open questions (a moment of *consolidating*, not *opening*, inquiry).
- **Intersection reading list:** papers 1, 3, 4, 5 (each grounds ≥2 members) → a genuinely
  cross-disciplinary reading list, the strongest co-grounding this run.
- **Core spine:** VAL-2 + ACT-2 + ACT-3 (the doubt-and-stress-test trio, grounded in all four).
  **Toggleable:** VAL-5 (sharpens toward claim-sizing), TOOL-1 (pivots toward the data substrate).
- **Cost/benefit moment:** the post-result moment where the goal-state is a finding you trust, and
  the actions are the price — re-running, cross-checking, sizing the claim. Felt-context (P9): *the
  hour you have a result and are trying to break it yourself.* A researcher recognizes this as theirs.

**SIT-2 · "Putting the work where others can check it"** · phase: Reporting · **C**
- **Members (edges):** VAL-8 Open to scrutiny · VAL-6 Forthcoming · ACT-5 Deposit your data and code
  openly · ACT-7 Report findings that cut against your hypothesis.
- **Domain balance:** value ×2, action ×2, tool ×0, question ×0. Pure benefit↔cost on the
  disclosure axis; deliberately silent on tooling.
- **Intersection reading list:** papers 1, 3 (both ground multiple members — 3 deposits and is open;
  1 is forthcoming, reports the null, and posts supplementary checks).
- **Core spine:** VAL-8 + ACT-5 (open-and-deposit). **Toggleable:** VAL-6 + ACT-7 (the
  reporting-against-yourself pair).
- **Cost/benefit moment:** the return phase — goal-state is a trustworthy public record; the cost is
  exposing data, code, and inconvenient results. Felt-context: *the moment you decide how much of the
  messy truth to ship.*

**SIT-3 · "Letting the studied speak for themselves"** · phase: Designing · **S (latent/exemplar)**
- **Members (edges):** VAL-9 Attentive to the studied · VAL-10 Led by the subject's own framing ·
  ACT-9 Let the subject direct the inquiry · TOOL-5 Journey mapping.
- **Domain balance:** value ×2, action ×1, tool ×1, question ×0. Benefit-leaning (a disposition-heavy
  stance) with one concrete enacting action and instrument.
- **Intersection reading list:** paper 2 (strong, grounds all four); paper 5 grounds VAL-9 weakly
  (decentering the researcher's framing of dogs).
- **Core spine:** VAL-10 + ACT-9 (grounded in paper 2). **Toggleable:** VAL-9 (broadens to the
  ethics root), TOOL-5 (pins to a specific instrument).
- **Cost/benefit moment:** the design phase where the goal-state is a faithful account of someone
  else's experience, and the cost is surrendering methodological control to them. **Flagged latent /
  single-doc** — propose cautiously; promote only on recurrence (P8, P13).

---

# 5. Per-article prediction-test outcomes (P14)

Scored against what the graph predicted each paper would contain. The graph was **empty**, so every
concept is a **gap (add)**; there were no predictions to non-confirm and no structure to mis-place.

- **Paper 1 (estradiol):** Gaps → VAL-5, VAL-6, VAL-8, ACT-2, ACT-7, TOOL-1/2. No non-confirmations
  (nothing to test). No mis-structures. Conduct phase: Executing + Interpreting.
- **Paper 2 (youth):** Gaps → VAL-9, VAL-10, ACT-9, TOOL-4/5. Conduct phase: Designing + Executing.
- **Paper 3 (SelfCheck):** Gaps → VAL-2, VAL-5, VAL-8, ACT-3, ACT-5, TOOL-3, Q-2. Conduct phase:
  Designing + Reporting.
- **Paper 4 (Socrates):** Gaps → ACT-2, ACT-10 (and the Skeptical/robustness region). Conduct phase:
  Designing.
- **Paper 5 (dog epigenetics):** Gaps → VAL-3, VAL-5, VAL-6, VAL-9, ACT-3, ACT-8, Q-1. Conduct phase:
  Sensing the gap + Committing to a question.

**First confirmations (P13, in-batch recurrence — the corpus's first votes).** These are *not*
disconfirmation tests (impossible on an empty graph); they are the same disposition independently
re-exemplified within this run, which is the first positive evidence a seed concept is real:
- **Measured (VAL-5):** papers 1, 3, 5 — three independent fields. Strongest signal this run.
- **Skeptical / cross-checking (VAL-2 + ACT-3):** papers 3, 5 (plus the robustness face ACT-2 in 1, 4).
- **Forthcoming (VAL-6):** papers 1, 3, 5.
- **Open-to-scrutiny / open deposit (VAL-8 + ACT-5):** papers 1 (consumer), 3 (producer).
- **Report-against-yourself (ACT-7):** papers 1, 5.

**Note on empty phases.** "Sensing the gap" and "Committing to a question" received no *concepts*
this run even though paper 5's *conduct* sits there. This is expected, not a phase-set defect: a
hypothesis-generating paper can exercise dispositions (falsifiability planning, calibration) that
belong to *later* phases (Designing/Interpreting/Reporting). The phase index sorts concepts by where
the disposition is exercised, not by the paper's own phase. No phase-set revision warranted yet.

**Citation/progression edges (P11).** None within this batch — no paper's `referenced_works`
contains another's OpenAlex ID (papers 3 and 4 list none at all). No temporal progression axis can
be drawn from this run; revisit as the corpus grows.

---

# 6. Counts

**Concepts by domain (27 total):**
- Values: 10 · Actions: 10 · Tools: 5 · Questions: 2

**Phase-mapped concepts (25; questions excepted):**
- Sensing the gap: 0
- Committing to a question: 0
- Designing the approach: 7  (VAL-3, VAL-9, VAL-10, ACT-8, ACT-9, ACT-10, TOOL-4)
- Executing and wrestling with data: 6  (ACT-1, ACT-2, TOOL-1, TOOL-2, TOOL-3, TOOL-5)
- Interpreting: 3  (VAL-1, VAL-2, ACT-3)
- Reporting and returning: 9  (VAL-4, VAL-5, VAL-6, VAL-7, VAL-8, ACT-4, ACT-5, ACT-6, ACT-7)

**Other artifacts:** 5 tunnels (all co-grounded) · 3 situations (2 confirmed-spine, 1 latent) ·
~24 link proposals · 0 citation edges.

**Confidence split:** Confirmed-in-batch (C): VAL-1, VAL-2, VAL-4, VAL-5, VAL-6, VAL-7, VAL-8,
ACT-1, ACT-2, ACT-3, ACT-4, ACT-5, ACT-6, ACT-7, TOOL-1, TOOL-3 (16). Single-grounded/speculative
(S): VAL-3, VAL-9, VAL-10, ACT-8, ACT-9, ACT-10, TOOL-2, TOOL-4, TOOL-5, Q-1, Q-2 (11).

**Deferred (held back this run, conservative budget):** tool nodes for palaeoepigenetic
reconstruction (paper 5) and the active-learning query system / Socrates (paper 4); finer actions
"Quantify agreement between independent annotators" (paper 3, Cohen's κ) and "Correct for multiple
comparisons" (paper 1, FDR) — both fold under existing roots and can be added on recurrence; the
intent question "Pinning down what is actually intended" (paper 4). All are revisitable as the
corpus confirms the region.

---

**END OF PROPOSALS — Run 1. No database writes performed; review gate is next (Section 8, step 7).**
