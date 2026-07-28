# Agent guide

Conventions for editing the skills in this repository. `README.md` covers what
the repo is and how consumers adopt it; this file is about writing the content.

## The one rule

**A skill in this repo may not know anything about a specific project.** Every
project fact reaches a skill through `.claude/project-profile.md` in the consumer
repo, described by `profile-schema.json` and `docs/project-profile.md`.

Concretely, a skill must never name:

- a repository, owner, product, or domain
- a file path that only exists in one project (`utils/locker.ts`)
- a command that only one project runs (`npm run typecheck`)
- a framework-specific variable or config key, unless the skill is a
  `references/` module scoped to that stack

The mechanical check before committing:

```sh
grep -rniE '\b(sprite|locker|supabase|postgrest|expo|eas|cwinters8)\b' skills/ \
  --include=SKILL.md
```

Word boundaries matter here: an unanchored `locker` matches "blocker" and an
unanchored `expo` matches "exposure", and a check that cries wolf gets skipped.
Extend the alternation as new consumers adopt these skills.

Hits inside `skills/security-review/references/` may be legitimate — those
modules are deliberately stack-specific — but a hit in any `SKILL.md` is a leak
to fix.

## Layout

```
bin/agent-skills.mjs     the CLI consumers run via npx: sync, check-profile, list
package.json             `bin` + `files`; `files` decides what a consumer can actually receive
profile-schema.json      canonical section list; the validator, template and docs all derive from it
docs/project-profile.md  the schema reference consumers read
templates/               the annotated blank consumers copy
examples/                complete real profiles
skills/<name>/SKILL.md   one skill; supporting files live alongside it
```

**The package ships the skills, so the invoked version is the vendored version.**
There is no ref in a consumer's `.claude/skills.json` — the npx spec is the only
content pin, and the CLI refuses to run against a config carrying a leftover
`ref`/`source`/`commit` rather than ignoring it.

Two consequences when editing:

- **Adding a top-level directory that consumers need means adding it to
  `files`** in `package.json`, or it won't exist when the package is installed.
  `skills/`, `templates/`, `docs/` and `profile-schema.json` are there for that
  reason; `examples/` and `AGENTS.md` are repo-only.
- **Bump `version` in `package.json` when skills change.** A consumer's
  `sync --check` compares its recorded version against the running one, so an
  unbumped version makes a real change look like no change.

`skills/security-review/references/` holds per-stack depth loaded only when a
consumer's `## Stack` names the module. That is where content too specific for a
`SKILL.md`, but still true of a whole ecosystem rather than one project, belongs.

## Adding or changing a section of the profile

The heading list lives once, in `profile-schema.json`. Changing it means
updating four things in the same commit, or they drift:

1. `profile-schema.json` — the entry, with `readBy`, `supplies`, and `fallback`.
2. `docs/project-profile.md` — the reference entry.
3. `templates/project-profile.md` — the annotated blank, in canonical order.
4. The skill that reads it.

Removing or renaming a heading breaks every consumer's profile at their next
sync, since the validator rejects unknown headings. Prefer adding an optional
section over renaming an existing one.

## Writing a skill

- **Every skill states what it does without a profile.** A skill that silently
  degrades to a generic pass is worse than one that refuses to run: the report
  looks identical to a clean result. Say which inputs were missing and what was
  therefore skipped.
- **Cite, don't copy.** When one skill needs another's list — a trigger table, a
  set of triggers — it reads that source rather than keeping a summary. A second
  copy drifts, and the row it drops is the one that mattered.
- **Name other skills by name, and tolerate their absence.** A consumer may
  vendor only some of these. A referenced skill that isn't present means skip
  that step and say so, never guess at what it would have done.
- **Keep the reasoning.** These skills are long because they encode *why* a check
  exists — which false positive it avoids, which failure it caught before.
  Compressing a rule to its conclusion is how it gets ignored or misapplied.
- **Frontmatter is `name` plus `description`.** The description is what decides
  whether the skill triggers, so write it with the phrases a user would actually
  type.
- **A skill describes work for the current turn, never a schedule.** No skill
  here tells a session to arm a wake-up, a self check-in, or a recurring poll.
  Recurrence is the project's decision, configured once as a scheduled routine —
  a session that re-arms itself spends a full session to re-learn what an event
  would have delivered, and multiplies by every open PR. Where a skill subscribes
  to events, subscribing *is* the mechanism; say so and end the turn.

## Changing a skill that consumers have vendored

Consumers pin a ref and vendor copies, so a change here reaches them only when
they re-sync. That means:

- Breaking changes to a profile section are effectively breaking changes to every
  consumer. Prefer additive changes with a defined fallback.
- Say in the commit message when a change requires a profile update, so the
  consumer's sync diff is understandable.
