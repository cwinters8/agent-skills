---
name: pr-preflight
description: >
  Pre-push QA gate. Run before pushing a branch or opening a PR: the project's
  mechanical checks, a self code-review, the project's own review focus and
  security gate, then push, open a draft PR, and subscribe to its activity. Use
  when a change is ready to ship, or when asked to "preflight", "run the QA
  gate", or "get this ready for review".
---

# PR preflight

The goal is that the maintainer is a merge decision, not a review bottleneck.
That only works if PRs arrive already QA'd. Run this gate on every non-trivial
change before it is pushed.

## Project profile

Read `.claude/project-profile.md` first. This skill is mostly a sequencer; the
profile supplies what each step actually does:

| Step | Reads |
| --- | --- |
| 1. Mechanical checks | `## Mechanical checks` |
| 3. Project checks | `## Review focus`, `## Secrets policy`, `## Exemptions`, `## Trust boundary`, `## Local skills`, `## Derived docs` |
| 5. Ship | `## Ship`, `## Rules source` |

If the profile is missing, run the generic gate — typecheck/test commands you
can discover, a `code-review`, a secrets scan — and **state in the PR
description that the project-specific checks did not run**. A gate that quietly
degrades to nothing is worse than no gate.

## Gate steps (in order)

### 1. Mechanical checks

Run every command in `## Mechanical checks`, in order. All must pass. This is
non-negotiable: it is the only part of the gate that is mechanically decidable.

If the section says `none`, say so explicitly in the PR description — a project
with no automated checks is relying entirely on the review below, and the
reader should know that.

### 2. Self code-review

Invoke the `code-review` skill on everything the push will contain: the branch
diff against the base branch **plus** any uncommitted changes — not just the
working tree, which is empty when the work was already committed. That skill
defaults to exactly this local-diff mode. Fix what it finds before pushing.

Findings you deliberately don't fix should be mentioned in the PR description,
not silently dropped.

If a skill named here isn't vendored in this repo, skip that step and say so in
your report rather than substituting a guess at what it would have done.

### 3. Project checks

Review the diff yourself against the profile:

- **Review focus** — walk every item in `## Review focus` and check the diff
  against it by name. These are the project's known failure modes; they are
  listed because they have gone wrong before.
- **Secrets** — check the diff against `## Secrets policy`. No credential
  belongs in a commit, and note that a "public" env prefix is usually about
  *visibility*, not safety: a privileged key behind that prefix ships to every
  user and passes a naive grep. Confirm ignored env files didn't sneak in.
- **Security** — if any changed path matches a row in `## Trust boundary`, run
  the `security-review` skill for that row's groups. Read the trust-boundary
  table itself rather than a summary of it: a second copy drifts, and the row it
  silently drops is the one that mattered. Authorization findings matter most.
  Security findings are **never** covered by a project's `## Not findings`
  carve-outs about deferring work — fixing them before launch is the cheap
  moment, not a deferral.
- **Local gates** — run anything `## Local skills` names for the paths this diff
  touches, using that skill's own trigger list as authoritative.
- **GitHub Action versions** — if the diff adds or edits any
  `uses: owner/repo@ref` reference, run the `action-versions` skill: look up each
  action's current latest major and pin to it rather than a tag remembered from
  training. Apply any carve-out in `## Exemptions`.
- **Docs and skills currency** — the file named by `## Rules source`, the
  profile itself, and the skills in `.claude/skills/` all state facts about this
  project: file layout, commands, invariants, whether tests and CI exist. If the
  diff changes a fact they state, update them **in the same PR** — grep those
  files for the names and terms the diff touches, **and for the wording the diff
  deleted**. A stale copy holds the *old* phrasing, which survives only on the
  removed side of the diff, so grepping the added terms finds the corrected
  sentence and misses every stale copy by construction. Scope this to the whole
  branch diff against the base, never to the round of changes you just made: a
  fact corrected in an earlier commit appears on neither side of a later fix's
  diff, so a per-round grep stops being able to see it exactly when the stale
  copies have had the longest to go unnoticed. Stale guidance misleads every
  future agent session, so treat a contradicted doc like a failing check.
  Remember that vendored skills are edited upstream, not here: a needed change
  to one is a PR against the skills repo plus a re-sync, and the profile is
  where a project-specific correction usually belongs instead.
- **Derived docs** — `## Derived docs` maps each file that is canonical for some
  fact to the files that restate it. If the branch diff touches a canonical
  file, walk its dependents and reconcile them in the same PR. Nothing else in
  this gate covers that direction: the bullet above asks whether a change
  invalidated the docs that instruct an *agent*, and says nothing about one doc
  invalidating a second doc that quotes it. **Editing a doc is itself a fact
  change.** A docs-only diff is in scope here precisely because it is the shape
  that arrives with every other gate correctly stood down — `code-review` does
  not chase documentation gaps, and a docs-only diff is usually outside the
  security gate's trust boundary. Rank a dependent first when a reader acts on
  it somewhere you cannot revise: a checklist step followed into a store
  submission, a form, or a published page turns a stale sentence into an
  external claim that no later PR retracts. If the profile has no
  `## Derived docs`, say in the PR description that doc-to-doc consistency was
  not checked, rather than assuming no doc quotes another.

### 4. Verify behavior when feasible

For changes with a runtime surface, use the built-in `verify` skill (or at
minimum reason through the affected flow end-to-end) rather than relying on the
mechanical checks alone. `verify` ships with Claude Code rather than living in
this repo; a harness without it should substitute reasoning through the flow.

### 5. Ship

- If any step after the mechanical checks changed files (review fixes count),
  run them again — the gate applies to the exact tree being pushed, not the
  tree that existed at step 1.
- Commit with a clear message and push with `git push -u origin <branch>`.
- Open the PR the way `## Ship` says. Absent instructions: a **draft** PR, using
  the `mcp__github__*` tools where a session has no `gh` CLI. The description
  should say what changed, why, how it was verified, and any known gaps or
  skipped review findings.
- Call `subscribe_pr_activity` for the new PR so review comments and CI
  failures flow back into the session, where the tooling supports it. **Then end
  the turn.** Do not schedule a wake-up, a self check-in, or a recurring poll
  for the PR. The subscription is the mechanism; a timer on top of it spends a
  whole session to re-learn what the next webhook would have delivered anyway.
  If a project wants a periodic backstop, that is a scheduled routine the
  project configures once — not something a session arms for itself.

After the PR is open, incoming reviewer feedback is handled by the
`review-sweep` skill — either live in this session via the subscription, or by a
scheduled sweep. `review-sweep` is also what marks a draft ready for review once
it reaches the ready-to-merge bar, so the maintainer's only remaining action is
the merge.
