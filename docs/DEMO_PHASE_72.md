# Phase 72 Demo Script

A walk-through of everything Phase 72 added, using the data already in your local database. About 20 minutes.

**Cast:**
- **bob**: sole owner of the curated community "Review 72b Recheck".
- **carol**: an ordinary reader.
- **a guest**: logged out.

**Setup:**
1. Start both servers the usual way (backend, then frontend).
2. Open **two browser windows**:
   - **Window A:** a normal window, logged in as **bob**.
   - **Window B:** a private/incognito window. Leave it logged out for now; it plays the guest first and carol later.

Data you'll touch: General (open) has voted links on the consciousness and heart-disease questions. Review 72b Recheck (curated) has one root question ("Can managed soils be a durable carbon sink?"), two children, one dated answer, and three feedback items in bob's inbox.

---

## Act 1: Two kinds of community (Window A, bob)

1. Click **Communities**. "Review 72b Recheck" carries a plain **Curated** label; General doesn't.
2. Open the create form, but **don't save**. You get an **Open / Curated** choice. A community's mode is fixed once it's created.

## Act 2: The open community, links in cards (72f) (Window A, bob)

1. Choose **General**. Click **How does conscious experience relate to physical processes?**, then **Which physical systems are conscious, and in virtue of what?**
2. Look at the card **"What in the brain marks the line between conscious and unconscious processing?"** Its top link sits inside the card with a **▲** vote button. There's no links panel down the right side any more.
3. Click into that question. Its own link, **Neural markers of conscious access**, sits under the title.
4. Look at the child card **"Does conscious perception require global broadcast…"**. It shows its top link, **Adversarial testing of global neuronal workspace…**, with **▲ 1**. Click ▲ to unvote, then again to re-vote. The count updates in place.
5. **Make a card expand.** Click into "Does conscious perception…". Under the title, use **Add a link** to add a silly second one:
   - URL: `https://example.org/brain-is-a-toaster`
   - Title: "The brain is basically a toaster"
   - Tick the affirmation box.
6. Go back one level. The card now shows **Show 1 more link**. Click it to get the full list inside the card:
   - **Top / New** sort;
   - Share, Copy, Remove, Add addendum, and "Other questions with this link" on each link;
   - the add-link form at the bottom.

   Click **Show fewer** to collapse it.
7. **Share link.** On any link, click **Share**, then paste the copied address into the address bar. Orca opens that link's own question page, expands the section, and briefly highlights the link in yellow. (Or type `localhost:3000/link/8`.)
8. **Flip View still has its panel.** "What in the brain marks the line…" sits under two different parents. Open it and switch to **Flip View**. The aggregated links panel is still there, grouped by context.

## Act 3: Graph view, both modes (72d) (Window A, bob)

1. On any General page, click **Graph**. The whole root graph opens as a tree:
   - the current question is highlighted and its path expanded;
   - link counts sit beside each question.
2. Try **Collapse all**, **Expand all**, and the ▸/▾ toggles. Clicking a question's text jumps there and closes the tree. **Escape** also closes it.

## Act 4: The curated community as a reader sees it (72a, 72b)

1. **Window A:** switch to **Review 72b Recheck**. Click **Share** in the header and paste the copied `/c/review-72b-recheck` address into **Window B** (logged out).
2. **Window B (guest):** you land straight in the community. Things to notice:
   - no vote buttons, vote counts or sort toggle anywhere;
   - the bottom bar is **search-only**, with no way to add;
   - the "Does no-till…" card shows its answer inside the card: title, date 2014-07-30 and comment;
   - **sort order:** the open question ("Is sequestered soil carbon permanent?") sits **above** the answered one.
3. **Window B:** type `localhost:3000/link/51`. It opens the no-till question's own page with the answer under the title, highlighted.

## Act 5: Owner editing (72c) (Window A, bob)

1. Open **Can managed soils be a durable carbon sink?** Flip the header toggle to **Edit**. Dashed outlines appear on everything editable.
2. **Rename:** click the question text and change "durable" to "centennial". (This puts carol's old, already-incorporated suggestion into effect.) Press Enter. The new name appears everywhere this question is placed.
3. **Add an answer** to "Is sequestered soil carbon permanent?":
   - click **+ Add answer**;
   - URL: `https://example.org/carbon-forever`
   - Title: "Carbon: It's Complicated"
   - Date: `2021-03-01`
   - any comment; tick the affirmation.

   **Watch the sort:** both questions are now answered, so the 2021 one moves **above** the 2014 one.
4. **Add a question:** click the **+** button and add **"Can a soil sample be bribed into honesty?"** It appears at the **top** because it's open (no answer yet).
5. **Precedent / subsequent:** on the new card, use the **+** under Precedents and pick "Does no-till…". Then click that name on the card. The page scrolls to the no-till card and highlights it.
   - Optional: make the 2021 question a precedent of the 2014 one to see the **"dated earlier than its precedent"** warning, then remove it with ✕.
6. **Own-page editing:** click into "Does no-till…". The answer is under the title. Still in Edit mode, click its comment, change it, and click away to save.
7. Flip back to **View**. This is exactly what readers see.
8. Click **Graph**. In curated mode the tree nests the answers (↗ title, date, comment) under each question.

## Act 6: Reader feedback (72e) (Window B, as carol)

1. In **Window B**, log in as **carol** and go to Review 72b Recheck.
2. **Card feedback:** click the feedback icon on **"Can a soil sample be bribed into honesty?"**
   - Choose **Suggest a change**, then the rewording option. Propose "Can a soil sample be trusted?" with a comment like "Bribery is not standard methodology."
   - It shows up publicly right away, and the icon's count goes up.
3. **Branch suggestion:** click the page-level icon in the **bottom-right corner**. Build a small branch:
   - "Does soil have feelings?";
   - a child under it, "Is a sad soil a carbon-leaky soil?";
   - a made-up answer on the child (any example.org URL and date);
   - a comment; then submit.
4. **Talk to others:** in the same page panel, find bob's existing suggestion ("A warming branch seems missing here"). **Upvote** it and **Reply** to it.

## Act 7: The owner inbox (72e-2) (Window A, bob)

1. Refresh. The header shows **Inbox (N)** with a higher number. Open it.
2. Click through the **Open / Incorporated / Declined / Archived** filters. You'll see carol's two new items, her older topsoil/subsoil note, and the incorporated "durable" item.
3. On carol's rewording, click **Open**. Orca jumps to the card and opens its feedback panel.
4. Mark it **Declined** with a reply: "We stand by the bribery framing."
5. **Window B (carol):** refresh and open that panel. Her item is now **locked**: the owner replied, so Edit and Delete are gone.
6. **Archive:** in **Window A**, Edit mode, **delete** the "bribed into honesty" card. Then open **Inbox → Archived**. Carol's suggestion is there, read-only, with a snapshot of the question as it was.
7. **Restore it:** add the exact same question text again with **+**. The old card comes back, and its feedback leaves the Archived filter.

## Act 8: Guest touches (Window B, logged out)

1. Log carol out. Open a card's feedback panel and click **Reply** or a vote. The panel closes and the login prompt opens on top.

---

**Cleanup (optional):** none is needed, since this is test data. If you want to tidy up, delete the "bribed into honesty" card again in Edit mode. Carol's branch suggestion never became a real question, so there's nothing to delete for it.
