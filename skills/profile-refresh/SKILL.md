---
name: profile-refresh
description: >
  Re-derive an existing project profile against the current state of the repo
  and report or fix each drift, section by section. Use when asked to "refresh
  the profile", "is the project profile still accurate", "the profile is
  stale", "re-derive the profile", or "check the profile against the repo", and
  after a large refactor, migration, or rewrite merges — that is what
  invalidates a profile wholesale.
---

# Profile refresh

`.claude/project-profile.md` is the input every other skill in this package
reads, and the CLI's `check-profile` validates only its **structure**: required
headings present, no unknown heading, no leftover placeholder marker. It never
asks whether a single statement in the file is still *true* of the repo. That is
the whole gap, and the profile is the one file that degrades silently — a stale
one reads exactly like a current one, so every skill downstream keeps reporting
confidently from bad input. A `## Mechanical checks` entry naming a command that
no longer exists doesn't announce itself; it just means the pre-push gate ran
nothing and said it passed.

## When to run it

**The strongest trigger is a large change that already merged.** A refactor, a
platform migration, a subsystem rewrite, a directory reorganization — each
invalidates several sections at once, and nobody reopens the profile afterward
because the profile wasn't in the diff. Run this right after such a merge, while
it is fresh enough to say what moved where. The other case is a suspicion: a
skill reported something that felt wrong. Whether this happens repeatedly is the
project's decision, configured once elsewhere; this is one pass over one repo.

## Prerequisites

- **No profile at all** — nothing to refresh. Hand off to the `skills-adopt`
  skill, which derives a first profile from scratch; if it isn't vendored here,
  say so and stop. Do not improvise one under this skill's name: the output
  would claim to be verified against a prior state that never existed.
- **No `## Rules source`, or one naming a file that is gone** — that is the
  first finding, and it leaves every check below that compares against the
  project's stated rules with nothing to compare against. Name the checks
  weakened by it instead of running them on a guess.
- **Run `check-profile` first.** Structural problems are cheaper to fix and
  change what this skill can parse at all. A missing heading is its job.

## Per-section checks

Work the sections in profile order, asking the same question each time: *what
would make this false, and can I detect it mechanically?* Most can be. Put any
section not named below through the same question. Say for each one whether you
verified it, couldn't, or skipped it.

### `## Mechanical checks`

**Run every listed command.** This is the most consequential drift in the file,
because it fails quietly: a command that no longer exists, or a script since
renamed, means the pre-push gate executes nothing and reports a pass. A gate
silently running zero checks is worse than a project that honestly says `none`.
Distinguish the two failures. *Command not found* is drift — fix the profile.
*Command runs and fails* is not profile drift; the repo is broken, and that is a
finding for the maintainer, never a reason to edit the failing check out of the
profile. Look for checks the project has **gained** too — a new script in the
manifest, a new CI job, a linter added since. An unlisted check is a gate nobody
runs before a push.

### `## Review focus`

Each item names a file, a function, a generated artifact, or an invariant.
**Grep for every named path and symbol.** A renamed module or deleted helper
leaves an entry reading as an active invariant while pointing at nothing — and a
reviewer walking the list by name finds no match, moves on, and believes the
project's known failure mode was covered. For an invariant with no path
attached, read the code meant to hold it; if the mechanism moved, the entry
needs rewording, which is a report and not a fix.

### `## Repo`

Check visibility and the collaborator model against the repo's current state.
Visibility is load-bearing: `review-sweep` may infer reviewer approval from a
reaction-count delta only because the plausible reactors are known. A repo that
went **public**, or gained collaborators, invalidates that shortcut entirely,
and the profile is the only place that says so. A renamed repo or owner matters
too — `code-review` builds permalinks from it, so a wrong `owner/repo` puts a
404 in every review comment it posts.

### `## Rules source`

Confirm the named file still exists and is still the authority: not a stub, not
a pointer to somewhere that has since become canonical. A project that split
its rules across a second file leaves this section naming the smaller half.

### `## Derived docs`

Three ways this goes stale. A canonical file **moved or was renamed**, so the
row's left side is dead. A dependent **no longer restates anything**, so the row
costs a check on every relevant PR and catches nothing. And the one people miss:
a **new duplication has appeared** since the table was written. The table's
value is that it turns the check into a grep over a named list instead of
re-reading every doc — which is exactly why an unlisted duplicate is invisible
to it. Look for prose quoting a config value, a command, or a policy statement
that another file owns. Rank a dependent a reader acts on outside the repo
first, for the reason the section states: a stale sentence followed off-repo
becomes a claim no later PR retracts.

### `## Trust boundary`

Two directions, and the second is the dangerous one.

- **Dead rows** — expand each path glob against the tree; a row matching no file
  is a check that can never fire.
- **Unmatched paths** — enumerate the tree and find directories matching *no*
  row that plausibly belong to a group: a new server or API directory
  (`authorization`), a new workflow or build-script location (`supply-chain`),
  a new place credentials are read (`secrets`). This is how a security gate
  stops covering what it exists for — the table was right when written, the
  architecture grew a surface, and no changed path matches a row again. Report
  each with a suggested group and the evidence: assigning a group is a judgment
  about what the code does, so propose rather than write.

### `## Stack`

Check both directions against the manifest and the code: a named reference
module for a stack **no longer used** (its checks cannot pass and read as
failures), and a stack **adopted** since with no module named (that depth never
loads, and the review stays generic without saying which depth was missing).

### `## Known gaps`

The drift here is an entry since **fixed**. Leaving a closed gap recorded is not
harmless: it trains the reader to skim the section, and the skimmed entry is the
still-open one underneath it. But removing an entry needs evidence — **point at
the commit or the code that closed it**: the migration that landed, the call
site that now validates, the permission that was narrowed. "I looked and it
seems fine" does not delete a recorded security finding; report it as *believed
closed, evidence requested*. Re-check status words too: a *launch blocker* on a
project that has since launched is either fixed or a far louder finding than the
profile now says.

### `## Not findings` and `## Exemptions`

Each carve-out has a stated reason, and a reason can expire. The classic: "there
are no users yet, so migration and backward-compatibility concerns are declined"
— sound until the project has users, at which point the profile instructs every
reviewer to wave through the class of bug that now costs the most. Re-read each
reason as a condition and check that the condition still holds. For
`## Exemptions`, also confirm the carve-out still corresponds to something real:
an exemption for a CI system the project dropped is dead text that will one day
be read as permission.

### `## Local skills`

Confirm each named skill still exists in the repo. A hand-off to a deleted or
renamed skill means `pr-preflight` names a gate in its report that never ran.

### `## Threat model`

The hard one, and the only one with no mechanical form. Do not skip it because
it can't be grepped — read it as a **claim** and ask whether the named control
is still the one that matters. The failure is architectural, not textual: the
paragraph stays well written and internally coherent while the system moves out
from under it. A project that added a server tier now enforces policy somewhere
the paragraph never mentions; a project that moved a credential out of the
client changed which finding is critical. "X is the only thing standing between one user and another user's
data" is either still true or has quietly become false, and the entire ranking
`security-review` applies rests on it. Flag it when the architecture moved, and
**never rewrite it silently** — an authoritative-sounding threat model written
on an agent's inference is the worst artifact this skill could produce.

## Report, then fix — and know which is which

Sort every drift into one of two buckets before touching the file.

**Provable → fix it.** A command that **does not exist**, a path that does not
exist, a named skill absent from the repo, a glob matching nothing, a changed
visibility. The evidence is mechanical and reproducible: correct the profile,
and say what the evidence was.

A command that exists and **exits non-zero** is not in this bucket, however
mechanical the evidence looks. That is the repo being broken, not the profile
being wrong, and it goes to the maintainer untouched — editing a failing gate
out of `## Mechanical checks` is how a refresh run during a real test failure
silently weakens every later preflight.

**Judgment → report it.** Is this still the threat model? Should this new
directory be `authorization` or `client-data`? Has this carve-out's reason
expired? Is this gap really closed? Bring the maintainer the evidence and a
proposed edit, and leave the file alone.

The asymmetry is deliberate. **A profile edited on a guess is worse than a stale
one**, because the guess reads as freshly verified: nobody downstream can tell a
re-derived line from an invented one, and making the file trustworthy again is
the entire point of the run. A stale line at least has age as a hint. Report
grouped by section — what you checked, what you found, whether you changed it.

## Shipping the fix

**A profile edit is a change that ships**, not a side effect. It goes through
the project's normal gate: run the `pr-preflight` skill, which runs the
project's mechanical checks and a self review over the diff. If `pr-preflight`
isn't vendored here, run the commands in `## Mechanical checks` yourself and say
the rest of the gate did not run.

Re-run `check-profile` after editing — this skill changes prose inside sections,
but a rewritten section that lost its heading, or a deleted optional section a
vendored skill requires, is a structural break the validator catches cheaply.
Put the reported-not-fixed items in the PR description: they are why the profile
is still partly unverified, and they are what the maintainer has to decide.
