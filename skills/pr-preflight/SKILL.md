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
| 3. Project checks | `## Review focus`, `## Secrets policy`, `## Exemptions`, `## Trust boundary`, `## Local skills` |
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
- **GitHub Action versions** — run the `action-versions` skill whenever the diff
  touches **any CI definition at all**: a file under `.github/workflows/`, an
  `action.yml` or `action.yaml`, or any other YAML this project treats as CI
  (`## Exemptions` names those, if it names any). That is the whole routing
  rule. Do not decide here whether the change is the *kind* that needs the
  skill.

  This gate is deliberately wider than the skill's own triggers, because a
  narrower one cannot be kept correct. Its trigger list has grown four times
  during this repo's life — container references, local calls, a job whose reach
  changed without any reference changing, a job whose output something
  downstream started trusting — and each time, a copy of the list living here
  would have gone on matching the old conditions and quietly declining to invoke
  the skill for the new ones. **A routing test that is a stale copy of the
  callee's triggers fails closed on exactly the cases most recently understood
  to matter**, and it fails silently, because nothing reports a skill that was
  never asked to run.

  So the file-path test is the point: it needs no maintenance, it cannot narrow
  as the skill widens, and its worst case is one cheap invocation that reports
  nothing to do. **The skill owns the question of whether there is work** — read
  its trigger list there, in the skill, and let it answer. Apply any carve-out in
  `## Exemptions`.
- **Docs currency** — run the `docs-currency` skill on the whole branch diff. It
  reads the profile sections it needs itself, and its rules are not restated
  here: a second copy drifts, and the clause it drops is the one that mattered.
  Reconcile what it reports **in the same PR** — a contradicted doc is a failing
  check, not a follow-up — and carry anything it says it skipped into the PR
  description.

  If it isn't vendored here, this step is **degraded, not skipped**, and that is
  a deliberate exception to the rule that a missing skill means skip and say so.
  The exception exists for one reason and does not generalize: this skill
  *carried the docs check inline* until `docs-currency` was split out of it, so
  a repo that upgrades without adding the name to `.claude/skills.json` loses
  coverage it already had — silently, with nothing in the diff to show for it.
  Skipping cleanly is the right default everywhere else; here it would hand a
  regression to the consumers least likely to notice.

  Bound it accordingly. Add the skill and re-sync — that is the fix. Until it
  lands, run only the irreducible minimum: grep the rules source, the profile
  and the vendored skills for the terms the diff touches *and for the wording it
  deleted*. That is a mechanical action, not a summary of what `docs-currency`
  decides, which is why it cannot drift as that skill evolves — and it is why
  nothing may be added to it here. Say in the PR description that the full check
  did not run. Don't guess at the rest of what that skill would have done.

  This paragraph is deletable, and should be deleted once no supported consumer
  predates the split.

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

After the PR is open, hand off to the `review-sweep` skill for incoming
reviewer feedback — either live in this session via the subscription, or by a
scheduled sweep. That skill is also what marks a draft ready for review once it
reaches the ready-to-merge bar, so the maintainer's only remaining action is the
merge. If it isn't vendored here, say so when you report the PR: the draft stays
a draft, and nothing triages the feedback this step just subscribed you to.
