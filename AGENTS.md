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
profile-schema.json      canonical section list; the validator, template and docs all derive from it
docs/project-profile.md  the schema reference consumers read
templates/               the annotated blank consumers copy
examples/                complete real profiles
scripts/check-profile.mjs validates a consumer profile against the schema
skills/<name>/SKILL.md   one skill; supporting files live alongside it
```

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

## Changing a skill that consumers have vendored

Consumers pin a ref and vendor copies, so a change here reaches them only when
they re-sync. That means:

- Breaking changes to a profile section are effectively breaking changes to every
  consumer. Prefer additive changes with a defined fallback.
- Say in the commit message when a change requires a profile update, so the
  consumer's sync diff is understandable.
