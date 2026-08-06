---
name: docs-currency
description: >
  Find the documentation a change invalidated and reconcile it in the same
  change: the rules source, the project profile, vendored skills, and every doc
  that restates a canonical file. Use when asked to "check the docs are
  current", "is anything stale", "docs currency", "what docs does this change
  invalidate", or "update the docs for this change", when a fact like a renamed
  variable or a changed default just moved, or when another skill invokes
  docs-currency.
---

# Docs currency

Docs state facts about a project: file layout, commands, defaults, invariants,
whether tests and CI exist. When a change makes one of those facts false, the
doc does not fail — it keeps being read. Stale guidance misleads every future
agent session and every reader who acts on it, so treat a contradicted doc like
a failing check, not like a nice-to-have follow-up.

Nothing else catches this. A code review looks for defects in code and
deliberately does not chase documentation gaps; a security gate reasons about a
trust boundary that a docs-only change usually sits outside of. This check is
the one that runs when every other gate is correctly quiet.

## The three-way duplication shape

The failure this skill exists for almost always has the same shape. A value is
**declared in code**, **restated in a header comment or docstring**, and
**restated again in user-facing documentation**. The code is canonical; the
other two are prose, and prose cannot fail a check. Change the declaration and
the two restatements keep asserting the old value indefinitely.

This is the single most common source of a documented default that is simply
false. Whenever a change touches a declared default, a variable name, a flag, a
path, or a command, assume there are two more copies and go find them before
concluding there are not.

## Project profile

Read `.claude/project-profile.md` first. Three sections matter here:

- `## Rules source` — the file stating the project's rules for agents. It is in
  scope on every run.
- `## Derived docs` — a table mapping each file that is canonical for some fact
  to the files that restate it. This is the only input that reaches docs written
  for a *person* rather than for an agent.

The profile itself is also in scope: it states facts about the project and goes
stale the same way.

If the profile is missing, look for `AGENTS.md` then `CLAUDE.md` at the repo
root, run the checks below against those plus any docs tree you can find, and
**say in your report that you ran without a profile**. If the profile exists but
has no `## Derived docs` table, say that doc-to-doc consistency was not checked,
rather than assuming no doc quotes another.

## Mode A — after a change

Use this when a diff exists: before a push, during a review, or when a change
just landed on the branch.

### 1. Scope to the whole branch diff, never to the last round of edits

```sh
# Resolve the branch this work merges into. Only an open PR's base establishes
# it — use origin/<that branch>. With no PR, ASK: the default branch is a guess,
# right for unstacked work and silently wrong for a stacked branch, which
# targets the branch below it.
#   Offer the default as the likely answer, do not adopt it unconfirmed:
#     git rev-parse --verify --quiet refs/remotes/origin/HEAD
#     (--verify, because this symbolic ref is optional: a repo whose remote was
#     added by hand has none, and `rev-parse --abbrev-ref origin/HEAD` exits 128
#     there rather than falling back)
#     git remote set-head origin --auto  — populates it, needs network
# Whatever resolves is already a full remote ref such as origin/main.
# Do not prefix it again.
base=<the confirmed result>

git diff "$(git merge-base HEAD "$base")"...HEAD   # committed work
git diff HEAD                                      # uncommitted edits to tracked files
git ls-files --others --exclude-standard           # new files, still untracked
```

Getting `base` wrong is the quiet failure here: against the wrong target this
check re-examines facts the parent branch already reconciled and reports their
restatements as though this change broke them. Nothing errors.

The third command is not optional. `git diff HEAD` reports nothing for a file
that has never been added, so a run before the first commit sees neither a new
canonical file nor a new doc that restates one — and both are in the push that
follows. Read the untracked files as wholly added content.

Scope to the whole branch diff against the base, **never to the round of
changes you just made**. A fact corrected in an earlier commit appears on
neither side of a later fix's diff, so a per-round grep stops being able to see
it exactly when the stale copies have had the longest to go unnoticed.

**Editing a doc is itself a fact change.** A docs-only diff is in scope here
precisely because it is the shape that arrives with every other gate correctly
stood down.

### 2. Grep for what the diff deleted, not only what it added

Collect the names and terms the diff touches, then grep the docs for them —
**and for the wording the diff removed**. A stale copy holds the *old*
phrasing, which survives only on the removed side of the diff, so grepping the
added terms finds the corrected sentence and misses every stale copy by
construction. Pull the old strings out of the diff's `-` lines explicitly:

```sh
git diff "$(git merge-base HEAD "$base")"...HEAD | grep '^-'   # committed
git diff HEAD | grep '^-'                                      # not yet committed
```

Both, for the same reason step 1 needs both. A rename made in the working tree
and not yet committed has its old wording only on the removed side of
`git diff HEAD`; extracting old strings from the committed range alone means a
pre-commit run never searches for the very term it just replaced.

Search the rules source, the profile, the project's docs tree **and the source
tree** for each old term. Renames, changed defaults, and moved paths are where
this pays.

The source tree belongs in that list because of the three-way shape above: the
second copy of a changed default is a header comment or docstring sitting beside
the declaration, not in any docs directory. Searching only the docs tree leaves
the code-adjacent explanation stale while the check reports done — and that copy
is the one the next reader of the code believes. Exclude generated output,
vendored dependencies and lockfiles, which restate nothing and drown the signal.

### 3. Walk the derived-docs table

For every canonical file the branch diff touches, walk its dependents in
`## Derived docs` and reconcile each in the same change. This is the direction
step 2 does not cover: step 2 asks whether a change invalidated the docs that
instruct an *agent*, and says nothing about one doc invalidating a second doc
that quotes it.

**Rank a dependent first when a reader acts on it somewhere the project cannot
revise.** A checklist step followed into a store submission, a form, or a
published page turns a stale sentence into an external claim that no later PR
retracts. Fix those before the internal ones.

### 4. Vendored skills are edited upstream, not in place

Skills vendored under the consumer's skills directory state facts too, so they
are in scope for reading — but a needed change to one is a PR against the skills
repo plus a re-sync, never an edit in place, which the next sync silently
overwrites. The project profile is usually where a project-specific correction
belongs instead. Say which of the two a finding needs.

## Mode B — a fact changed, no diff to work from

Use this when someone names the change directly: a renamed variable, a changed
default, a moved or deleted file, a retired command.

1. **Start with `## Derived docs`.** If the changed fact lives in a canonical
   file listed there, its dependents are the known-stale set, already enumerated
   so you do not have to re-read every doc.
2. **Grep the docs tree for both wordings** — the old name and the new one. The
   old wording finds the stale copies; the new wording finds the copies already
   updated, which tells you the search terms are right and bounds what is left.
3. **Then the rules source and the profile.** Both make claims about layout,
   commands and invariants that a rename or a removal quietly falsifies.
4. **Then the three-way shape.** For a changed default or renamed input, check
   the declaration in code, the header comment or docstring beside it, and the
   user-facing doc — all three, every time.

## What counts as done

- Every restatement of a changed fact is either fixed in the same change or
  reported with its exact location and what it now contradicts.
- A doc you cannot verify — one whose truth depends on a system you cannot
  observe, a document outside the repo, or a claim only the maintainer can
  settle — is **reported, not edited**. Guessing at the correct new wording
  produces a doc that reads as authoritative and is still wrong, which is worse
  than the stale sentence, because the stale sentence at least matches what the
  project used to do.
- Anything skipped is named: no profile, no `## Derived docs`, a docs tree you
  could not locate, a dependent living outside the repo. Say what was skipped
  and why. A run that silently checked less than it claims reads exactly like a
  clean one.

## Related skills

`pr-preflight` invokes this skill as part of its project checks; `code-review`
does not overlap with it, because that skill deliberately leaves documentation
gaps alone. If either is named in a report and is not vendored here, say so
rather than guessing at what it would have done.
