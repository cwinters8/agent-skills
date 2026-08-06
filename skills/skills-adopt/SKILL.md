---
name: skills-adopt
description: >
  Vendor these shared skills into a repo that does not have them yet, and
  maintain the vendoring afterwards: survey the repo, write the project profile
  from what is already true of it, verify the pinned ref ships what its docs
  describe, run the sync, and record every place the ref landed. Use when asked
  to "adopt the skills", "set up agent-skills in this repo", "vendor the
  skills", "add a skill", or "bump the skills ref".
---

# Adopting the skills

After this, every review, preflight and sweep in the consumer repo is driven by
the profile written here. Two failure modes account for most bad adoptions, and
both produce something that *looks* finished:

- **A profile of plausible filler.** Seventeen headings invite an agent to write
  a sentence under each from what a repo of this shape usually does. Every skill
  downstream then acts on invented facts, and reports as configured.
- **A ref that does not ship what its docs describe.** The docs and the
  validator both travel inside the package, so a stale tag hands a consumer a
  template and a validator from different versions — with no symptom until the
  first sync fails.

Work the phases in order and commit nothing until the done bar at the end is
met: the adoption is one reviewable diff. This needs the repo, its history, and
network access to run the package's CLI. **If the CLI cannot be reached, stop
and say so** rather than pinning a ref you could not verify and writing a
profile you cannot validate — a half-adopted repo whose sync never ran is worse
than an unadopted one, because the vendored skills look present. No rules
source, no CI or no PR history blocks nothing; phases 2 and 3 say what each of
those becomes.

## Phase 1 — Choose a ref and prove it is the right one

1. **Pick a candidate ref** — whatever the package's own README tells consumers
   to invoke — and **ask the package what that ref actually ships.** This needs
   no config in the consumer repo, which is why it comes first; it prints the
   package version behind the ref and the skill names available under it:

   ```sh
   npx -y github:cwinters8/agent-skills#<ref> list
   ```

2. **Get the template and the schema reference from that same ref.** The package
   ships `templates/` and `docs/`, so read them wherever the pinned package
   resolves — the cache `list` just populated, a checkout at that ref, or the
   ref's file view. Never reconstruct the template from memory or copy it from
   another ref: the section list you fill in has to be the one the validator
   behind your ref accepts.

3. **Confirm those two agree.** This is the check that earns its place. A
   released tag can lag the branch its docs are written from: the docs and
   template on the newer branch describe a profile section the tag's validator
   has never heard of, so a consumer following the README to the letter produces
   a profile the README's own validator rejects. The template is not
   self-validating — only running the tag's validator against a profile
   containing that section reveals it, which is why the confirming
   `check-profile` lands in phase 4, once the lock exists. If they disagree,
   **the tag is stale: pin a commit instead**, and say in the consumer's rules
   source which commit and why, so the next person does not "fix" it back.

4. **Use a seven-character abbreviated SHA, not the full 40.** A full-length SHA
   in an npm git spec trips a `GitFetcher` bug on npm 10.9.7 — *"GitFetcher
   requires an Arborist constructor to pack a tarball"* — and the invocation
   fails before anything is fetched. The abbreviation resolves fine.

## Phase 2 — Survey the repo before writing a word of the profile

The profile states facts a skill can act on. Derive every answer; guess none.

5. **Read what the repo already tells you.** The git log (what changes actually
   land, and how they are described), the existing docs, the scripts and config
   an operator runs, the CI definition if there is one, and the open *and
   merged* PRs. Merged review rounds are the richest source: a convention that
   survived review is a real convention, and an objection that got declined is a
   `## Not findings` entry with its reason already written.

6. **Fill each section from that survey, and leave out what you could not
   derive.** `docs/project-profile.md` behind your pinned ref gives, per
   section, what it supplies and exactly what its absence costs — read it there
   rather than from a list restated here, because a second copy drifts and the
   row it drops is the one that mattered. An omitted optional section makes a
   skill announce it ran without that input; a section of vague filler makes the
   same skill act confidently on nothing. Prefer the omission. `none`, where a
   section invites it, is not the same as omitting: it says you looked.

7. **Let the vendored set decide what is required.** Sections marked required
   with a skill are demanded only when `.claude/skills.json` lists that skill —
   a repo that does not vendor `security-review` is never asked for a threat
   model. Choose the skills first, then write only the sections you owe.

## Phase 3 — The rules source, which is usually the blocker

8. **If there is no rules source, write one.** `## Rules source` is required and
   many repos have no agent-facing rules file at all; the fallback is that
   skills guess at a conventional filename and admit they guessed, which is a
   weak foundation for every review that follows. Write it as a record, not a
   wish list: the conventions visible in the code, the invariants the scripts
   depend on, the decisions argued out in merged review rounds and now settled.

9. **Do not invent a rule to fill a heading.** The skills treat the rules source
   as authoritative — `code-review` judges diffs against it, `pr-preflight`
   treats a diff contradicting it as a failing check. A fabricated convention
   therefore does not sit harmlessly in a file; it becomes a finding raised
   against every future PR that does the sensible thing instead. Leave a
   genuinely unsettled convention out and let a human settle it later. Point at
   the file from the profile rather than restating it: a rule copied into the
   profile is a second copy that will disagree with the first, and the skills
   will believe whichever they read.

## Phase 4 — Wire it up, in this order

10. **Write `.claude/skills.json` before running anything.** It must exist
    first: the CLI refuses to run without it and prints a starter naming the
    skills that version ships. It carries only a `skills` array — no ref,
    source, or commit field. The tool hard-fails on those rather than ignoring
    them, because a second pin can silently disagree with the npx spec, and
    bumping the ignored one looks exactly like an upstream with no changes.

    `init` writes that file and a blank profile for you, and never overwrites
    either — so if you are reading this skill because a bootstrap sync put it on
    disk, both already exist and this step is done:

    ```sh
    npx -y github:cwinters8/agent-skills#<ref> init [skill...]
    ```

    It scaffolds only. The survey in phase 2 is still the work, and a profile
    left as the template it wrote fails validation exactly as it should.

11. **Validate, then sync**, in that order — the validation is possible only now
    that the lock exists:

    ```sh
    npx -y github:cwinters8/agent-skills#<ref> check-profile
    npx -y github:cwinters8/agent-skills#<ref> sync
    ```

12. **Treat an "unknown section" complaint as phase 1's mismatch surfacing.** If
    the rejected heading came straight out of the template you copied, the ref
    is stale — the profile is not wrong. Go back to step 3.

13. **Know what a failing sync already did before you retry it.** `sync`
    validates the profile as part of its run, *after* writing the skills. A run
    ending in "vendored skills are current, but the project profile failed
    validation" has already written the skills and the lock — the remaining work
    is the profile, not the sync. Re-running it blind changes nothing and buries
    the real error.

14. **Add `sync --check` to `## Mechanical checks`.** It is what reports a
    vendored copy that has fallen behind the ref this repo invokes, or been
    hand-edited. `pr-preflight` runs that section before every push, which in a
    repo with no CI is the only place drift gets caught.

15. **Record every location of the ref in `## Derived docs`.** The ref does not
    live in one place: in a real adoption it landed in the rules source twice
    and in `## Mechanical checks`. Nothing else knows those copies exist —
    `## Derived docs` maps a canonical fact to the files restating it, and
    `pr-preflight` walks that map when the canonical file changes. Without the
    entry, a future bump updates the invocation someone remembered and leaves
    the rest pointing at the old version.

## Done

16. Every command in `## Mechanical checks` passes, `sync --check` among them,
    and `check-profile` is clean with no section left holding template text.
17. The vendored skills, `.claude/skills.json` (config plus lock), the profile
    and the rules source land in one diff. Split across commits, a reviewer
    cannot see that the lock matches the skills.

Never hand-edit a file under the vendored skills directory: the next sync
overwrites it and the change is invisible to every other consumer. A
project-specific correction belongs in the profile; a general one is a change
upstream plus a re-sync.

If `pr-preflight` is vendored here, ship the adoption through it. If it is not,
run the checks by hand and say in the PR description that the gate did not run,
rather than implying it did.

## Maintenance

Both modes below rely on phase 1's verification, so run it again rather than
trusting the ref already recorded. Keeping the profile *true* as the repo
changes is a different job: if `profile-refresh` is vendored here, that is the
skill for it; if it is not, re-derive the affected sections per phase 2 and say
which ones you checked.

### Adding a skill to a repo that already has them

1. Add the name to the `skills` array in `.claude/skills.json`. `list` at the
   pinned ref prints what is available under that exact ref.
2. Write any section the new skill makes required — the validator names them for
   you, `docs/project-profile.md` says what each supplies, and phase 2 still
   applies: a required section is not a licence to guess.
3. Run `sync`, then `sync --check`, and commit the new skill directory with the
   updated lock.

### Bumping the pinned ref

1. Re-run phase 1 against the new ref: `list` it, read the template and docs
   *from that ref*, confirm the two agree. A bump is when a stale tag bites, and
   when it is cheapest to catch.
2. Update the ref in every location `## Derived docs` records — that entry
   exists for this step. If the map proves incomplete, fix the map in the same
   change.
3. Run `sync` and read the diff: an upstream section rename or removal shows up
   as a profile the new validator rejects, which is profile work, not a sync
   failure to retry.
4. Run the full `## Mechanical checks` and commit the vendored diff with the
   lock. Say in the PR description what moved between versions, since the
   vendored diff is the only place a consumer ever sees an upstream change.
