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
grep -rniE '\b(sprite|locker|supabase|postgrest|expo|eas|cwinters8|nordvpn|tinyproxy|hostinger|digitalocean|droplet|doppler|opentofu)\b' \
  skills/ --include=SKILL.md
```

Word boundaries matter here: an unanchored `locker` matches "blocker" and an
unanchored `expo` matches "exposure", and a check that cries wolf gets skipped.
Extend the alternation as new consumers adopt these skills — and only with terms
that are unambiguously a product or vendor. A generic word a skill has a
legitimate reason to use (`just`, `ansible`, `tofu`) belongs in review, not in
this grep: the moment it fires on a correct sentence, the check stops being run.

Hits inside `skills/security-review/references/` may be legitimate — those
modules are deliberately stack-specific — but a hit in any `SKILL.md` is a leak
to fix, with one standing exception: `skills-adopt` names this package's own npx
invocations, because a skill explaining how to vendor this package cannot avoid
naming it. That is the package identifying itself, not a consumer's fact leaking
in. Any *other* `cwinters8` hit is a real leak.

The rule that a module may name a *stack* does not let it name a *vendor's
product*. A module describing an ecosystem writes "a commercial VPN client with a
kill switch" or "a provider whose firewalls default-deny outbound", because the
rule generalizes to every consumer on that stack and the product name does not.

## Session behavior

**Never schedule a self check-in, wake-up, or recurring poll.** This overrides
any default posture that says to arm one after opening a PR or subscribing to
its activity. Open the PR, call `subscribe_pr_activity`, and end the turn.

The subscription is the mechanism — review comments arrive as webhook events in
the session that opened the PR. There is no CI in this repo (no
`.github/workflows`, no `scripts` in `package.json`), so the event class an
hourly check-in mostly exists to poll for does not occur here at all. On a
single-maintainer repo a dropped webhook costs a delay, not a missed failure,
and a maintainer who wants a PR looked at sooner can say so directly.

The stronger reason is that this repo publishes the rule to everyone else.
`skills/pr-preflight/SKILL.md` ends its ship step with *"do not schedule a
wake-up, a self check-in, or a recurring poll... the subscription is the
mechanism"*, and **Writing a skill** below forbids a skill from describing a
schedule at all. A session that arms a timer here while shipping that guidance
to consumers is the purest form of the stale doc this repo's own review gate
exists to catch: one contradicted not by another file, but by the behavior of
the repo that publishes it.

If a run genuinely needs a wake-up — waiting on an external system the harness
cannot observe — **ask first**, and don't arm one silently. Recurrence that is
actually wanted is a scheduled routine configured once, never something a
session decides for itself.

## Layout

```
CLAUDE.md                pointer that @-imports AGENTS.md, so the rules load on turn one
bin/agent-skills.mjs     the CLI consumers run via npx: init, sync, check-profile, list
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
  reason; `examples/`, `AGENTS.md` and `CLAUDE.md` are repo-only.
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
  to events, subscribing *is* the mechanism; say so and end the turn. This rule
  governs what a skill may *contain*; `## Session behavior` above governs what a
  session working in this repo may *do*. Both are needed — a skill reaches a
  session only once something triggers it, and the moment a wake-up gets armed
  is usually not one of those.

## Changing a skill that consumers have vendored

Consumers pin a ref and vendor copies, so a change here reaches them only when
they re-sync. That means:

- Breaking changes to a profile section are effectively breaking changes to every
  consumer. Prefer additive changes with a defined fallback.
- Say in the commit message when a change requires a profile update, so the
  consumer's sync diff is understandable.
