# Chaos — Episodic Memory Store

This directory is Chaos's **episodic** learning substrate: a persistent, per-run record of what
each Chaos run proposed and what happened to those proposals. It complements the other two
substrates:

- **Procedural** — the rubric (`chaos/chaos.md`). *How to reason.*
- **Semantic** — the graph itself plus per-node ledgers in the dev database. *What is known.*
- **Episodic** — this directory. *What happened, run by run.*

One JSON file per run (`run-0001.json`, `run-0002.json`, …) holds that run's working set,
proposals, outcomes, and reflection notes. `index.json` is a lightweight summary of all runs.

## The commit-don't-ignore rule (important)

**Episodic records are git-tracked and committed.** This is deliberate and is the *opposite* of
`chaos/snapshot.json`, which is regenerable from the database and therefore gitignored.

The dev database is **disposable** — we run full passes, inspect the results, wipe, and redo
(`chaos/clear.js`). Anything that lives only in the dev DB does not survive a rebuild. Episodic
memory must survive rebuilds: it is the record of runs we want to learn from across resets. So it
lives in committed files, not in a Postgres table.

Concretely:
- `chaos/episodic/*.json` (run records + `index.json`) → **tracked and committed**.
- `chaos/snapshot.json` → **gitignored** (regenerable via `chaos/snapshot.js`).

If a future `.gitignore` change ever introduces a broad `chaos/*.json` pattern, it must be narrowed
so it does not swallow this directory. As of this phase no such broad pattern exists, so no
`.gitignore` change was needed.

## Record format

`recordSchema.js` is the **source of truth** for the record shape. Read it directly rather than
trusting this prose to stay in sync. In summary, each record is an object with:

| Field                    | Type                | Notes |
|--------------------------|---------------------|-------|
| `record_schema_version`  | string              | Record format version. Currently `"1"`. |
| `run_id`                 | integer             | Unique per run; matches the `run-<id>.json` filename. |
| `timestamp`              | ISO 8601 string     | When the run was recorded. |
| `rubric_version`         | string              | The `chaos.md` version reasoned under (e.g. `"0.10"`). |
| `working_set`            | array               | Papers sampled this run; each `{ paper_ref, source_field, sampling_rationale: { epistemic, pragmatic } }`. |
| `proposals`              | array               | Each `{ ref (unique within run), type, payload, prediction_made, phi_note, precision (0–1 or null), provenance (independent\|targeted\|null), surprise_level (local\|parent_unabsorbed\|null) }`. |
| `outcomes`               | array               | Review decisions; each `{ proposal_ref, decision (accept\|reject\|modify), reason }`. |
| `run_notes`              | string              | Free-form notes about the run as a whole. |
| `reflect`                | object or null      | Lessons observed this run, held for later consolidation. |

`proposal.type` is one of: `concept`, `frontier_concept`, `link`, `tunnel`, `situation`,
`restructure_mention`, `citation`, `mid_path_insertion`.

`validate(record)` in `recordSchema.js` returns `{ ok, errors }`, reporting **every** problem it
finds (not just the first), so a malformed record can be fixed in one pass.

## Writing a run record

For now, run records are written **manually**. Pipeline hooks (emit/review stages writing records
automatically) come in a later phase once those stages are coded.

To write a record:

```sh
# From the repo root. The record is a JSON file matching the schema above.
node chaos/episodic/writeRecord.js path/to/record.json
```

`writeRecord.js`:
- validates the record via `recordSchema.validate` and **aborts** with a clear list of problems if
  it is invalid;
- assigns `run_id` as `(max existing run-NNNN.json id) + 1` unless the record already supplies one;
- writes `run-<id zero-padded to 4 digits>.json` (pretty-printed);
- appends `{ run_id, timestamp, rubric_version, proposal_count, accept_count }` to `index.json`.

It can also be called programmatically:

```js
const { writeRecord } = require('./chaos/episodic/writeRecord');
const { run_id, file } = writeRecord(recordObject);
```

## Non-goals (this phase)

- No Postgres table or migration — episodic memory must outlive the disposable dev DB.
- No automated reflect/consolidate logic — that is a later, condition-gated phase.
- No wiring into any pipeline stage — emit/review hooks arrive when those stages exist.
