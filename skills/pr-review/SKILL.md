---
name: pr-review
description: >
  Run the whole pre-push review set against a PR that is already open, and post
  the result as one consolidated comment that review-sweep can triage: code
  review, the project's review focus and secrets policy, security review for the
  trust boundary, action versions for CI files, and docs currency. Use when
  asked to "pr-review <n>", "run the full review on PR <n>", "review PR <n> the
  way preflight would", "run the preflight review on an open PR", or to review a
  PR that was opened without preflight, by someone else, or by a bot.
---

# PR review

`pr-preflight` runs a good set of reviews, but only on the author's machine and
only before the push. Once a PR is open, `code-review` is the only skill with a
way to post findings on it. `security-review`, `action-versions` and
`docs-currency` have no PR mode. So a PR opened without preflight, by someone
else, or by a bot gets a code review at most, its trust-boundary, CI-pinning and
docs checks never run, and nothing on the PR says they didn't.

This skill reviews an open PR the way preflight would have, and posts one
comment that says what every review found and which reviews did not run.
`review-sweep` triages that comment like any other reviewer's.

**It only reports.** It never commits, pushes, edits a file the PR contains,
reacts to a comment, resolves a thread or marks a PR ready. That is
`review-sweep`'s job, and a reviewer that also fixes produces commits nobody
reviewed. The one write it makes is the comment.

**It runs once per invocation and ends the turn.** It does not schedule a
wake-up, a self check-in or a poll for the next head. Whoever wants the next
head reviewed invokes it again.

GitHub access varies by environment. Where the `mcp__github__*` tools are
present, use them, because some sessions have no `gh` CLI and block direct
`api.github.com` calls. Load them via ToolSearch as needed.

## What runs, and who decides

**The review set is `pr-preflight`'s, and this skill keeps no copy of it.**
Routing defers to `pr-preflight` §2 (the self code-review) and §3 (project
checks): every review those sections would run on this diff, routed by the
profile sections they name, runs here. Read the routing in that file, every
time, rather than a summary of it. §3's own `action-versions` paragraph explains
why: a routing list copied out of its owner goes on matching the old conditions
after the owner widens, and it fails silently on exactly the cases most recently
understood to matter. A second copy here would be that list.

Not in the set: §1's mechanical checks, §4's behavior verification and §5's
ship step. CI owns builds and tests on an open PR, and `code-review` already
treats what a typechecker catches as not a finding.

Two departures from how those reviews behave under preflight. Both come from
reviewing something this session does not own.

- **Report-only.** `docs-currency` and `action-versions` normally fix what they
  find, and so may a skill named in `## Local skills`. Here, tell each one the
  run is report-only: edit nothing, and report each thing it would have fixed as
  a finding with its location and the fix. Those findings become that review's
  subsection of the comment.
- **A missing skill is reported, never substituted.** §3 makes one exception to
  its skip-and-say rule. When `docs-currency` is not vendored, it runs a
  degraded grep, because preflight carried that check inline before the split
  and a consumer that upgraded would otherwise lose coverage it already had. That
  reason does not reach this skill, since no consumer ever had docs checks from
  `pr-review`. So here `docs-currency` not being vendored is *unavailable* like
  any other skill, and the degraded grep does not run.

### When `pr-preflight` is not vendored

Then §2 and §3 are not there to read. Run exactly two reviews: invoke
`code-review` for its passes and confidence scoring, and run the
`security-review` skill in its per-change mode, routed by `## Trust boundary`.
The comment's first line says the rest of the review set did not run because
`pr-preflight` is not vendored.

That floor is the whole fallback. **Nothing may be added to it**, however
obvious the addition looks: `action-versions` on a workflow file, say. Each
addition is a step toward the copied routing list this skill exists not to
keep, and the honest report of a missing set is one line, not a partial
reconstruction of it.

### Without a project profile

Invoke `code-review` for its generic passes and run the `security-review` skill
for the groups it runs without a profile. Every other review reads `not run`,
*unavailable*, because there is no profile. The comment's first line says the
project-specific checks did not run. A review that silently skipped the
project-specific half would read exactly like one that found nothing.

## Steps

### 1. Eligibility

Defer to `code-review` §1 for what makes a PR ineligible: closed, merged, or an
automated PR whose diff is purely generated. One thing differs. The
already-reviewed check here looks for a **`### PR review`** comment whose first
line names the current head SHA, not for a `### Code review`. The two reports
are independent: either one at a head does not satisfy the other.

When the head was already reviewed, post nothing and say in the session that
this head already has a `### PR review` comment, linking it.

**Record `head.sha` now.** You will check it again before posting.

### 2. Check the loop bound

A PR that has already been through many rounds of review should not get another
full report. Re-reviewing each new head is the second way into the review loop
that `review-sweep` §7 bounds. So before running anything, defer to `review-sweep` §7 for
whether this PR has reached a stop condition. Read the conditions and how they
are counted in that section rather than restating them here, since they are
expected to change. A stop-condition hand-off comment from `review-sweep` on the
PR is the plainest evidence.

At a stop condition, post only findings that rank **Critical** or **High** on
`security-review`'s severity table. That table ranks every finding here, not
only those from the security review, and a finding it does not reach is below
the bar. The reason is §7's own: a Critical or High finding is always addressed,
whichever round it arrives in. If any survive, the comment's first line names
the stop condition and says that lower-severity findings were withheld. If none
survive, post nothing, and name the stop condition in the session.

If `review-sweep` is not vendored, there is no §7 to read. Say so in the
session, and post the full report.

### 3. Check out the head in a temporary worktree

The invoking checkout is the user's. Its branch, working tree, index and
worktree list are exactly as they were before the run when it ends.

Resolve the base from PR metadata following `code-review`'s base-resolution
rules: the base branch lives in the PR's *base repository*, which is not always
the remote called `origin`. Fetch the head by `pull/<n>/head` from that same
repository. That ref exists on the base repository for fork PRs too, where the
head branch itself does not.

```sh
# <remote> is the local remote whose URL is the PR's base repository. If none
# matches, fetch from the repository's URL instead of naming a remote.
git fetch <remote> "<base-branch>"
git fetch <remote> "pull/<n>/head"
test "$(git rev-parse FETCH_HEAD)" = "<head-sha>"   # fails if the head moved
dir="$(mktemp -d)"
git worktree add --detach "$dir" "<head-sha>"
```

The fetches write no local branch, only objects, `FETCH_HEAD` and the remote's
tracking ref for the base. `--detach` at the recorded SHA creates no branch
either, and leaves `HEAD` in the invoking checkout alone. If the `test` fails,
the head moved after you recorded it. Stop there and report the review abandoned
(§6).

Run every routed review from inside `$dir`, against the base you resolved. Pass
the base explicitly so no review has to ask or guess: inside the worktree,
`code-review`'s local-diff mode then reviews exactly the PR's diff. Give each
review the full head SHA and the PR number too, since the findings link to them.

**The profile comes from the base, not from the PR.** If the diff changes
`.claude/project-profile.md`, the worktree holds the PR's version of it. A
change under review does not get to configure its own review: an edit to
`## Not findings` or `## Trust boundary` would otherwise suppress or reroute the
very findings it should face. So give the routed reviews the base's profile
(`git show <base-sha>:.claude/project-profile.md`), and say in the comment's
first line that the PR changes the profile and the base's version was used. The
profile edit is itself in the diff, and `docs-currency` reviews it like any
other doc.

**Remove the worktree when the run ends**, whichever way it ends: posted,
skipped, or abandoned.

```sh
git worktree remove --force "$dir"
```

### 4. Run the review set

Run each review the routing selected. Where the diff is large enough, run them
in parallel subagents. Each review's findings go through `code-review`'s
confidence scoring (§4: drop anything below 80), whichever review produced
them. That bar is what keeps one consolidated comment worth reading.

Every review the routing names ends in exactly one of three states:

- **findings**: what it found, after scoring;
- **clean**: it ran and nothing cleared the bar;
- **not run**, with one of two kinds of reason:
  - *not applicable*: nothing in the diff routed to it. For example, no
    CI-definition path for `action-versions`, or no `## Trust boundary` row
    matched for `security-review`.
  - *unavailable*: the diff routed to it, but it could not run. Its skill is not
    vendored, there is no profile, or `pr-preflight` is absent. Name what was
    routed and by what, e.g. "`security-review` was routed by
    `## Trust boundary` but is not vendored".

A review left out of the comment altogether is the silent hole every one of
these skills exists to prevent. If the routing names it, it gets one of those
three states.

### 5. Post one comment

Immediately before posting, re-check eligibility (§1) and fetch `head.sha`
again. If the head moved, **post nothing**. The findings describe a diff the PR
no longer has, and their line numbers no longer locate the code they cite.
Report the review abandoned (§6).

Post exactly one conversation comment with `mcp__github__add_issue_comment`
(or `gh pr comment` where the tools are absent). No inline comments and no
review object: `review-sweep` closes conversation comments with its `Re:` form,
and a second shape of reviewer would need a second set of rules there.

**The heading is `### PR review` and nothing else.** Each review gets a
`####` subsection named for it: `#### Code review`, `#### Review focus`,
`#### Secrets`, `#### Security review`, `#### Action versions`,
`#### Docs currency`, and one per skill named in `## Local skills`. Order them
the way §2 and §3 order them. Never use `### Code review` anywhere in this
comment. `code-review`'s eligibility check and `review-sweep`'s recognition of a
`code-review` report both key on that heading, and this comment is neither.

**The first line under the heading names the full head SHA**, findings and clean
alike, so that the next invocation's eligibility check can read it without
inference. Notes about how the run was configured go on that same line: no
profile, no `pr-preflight`, a stop condition, the base's profile used.

With findings:

```
### PR review

Found 3 issues at <full-sha>. <configuration notes, if any>

#### Code review

1. <brief description> (bug in <file>: <short snippet>)

<permalink>

#### Security review

1. <severity>: <who does what, and what they get>. Fix: <fix>

<permalink>

#### Docs currency

1. <doc> still says "<old wording>", which <change> made false. Fix: <fix>

<permalink>

#### Action versions

clean

#### Secrets

not run: not applicable — <reason>
```

Number findings within each subsection. Cite every one with a permalink at the
**full** head SHA, following `code-review` §5's permalink rules, including its
rule for deleted paths: code the PR removed does not exist at the head, so link
the base SHA or the PR's diff view instead and say which you used. Give at least
one line of context either side of the flagged line. A subsection reads
`clean` when it ran and found nothing. It never reads "No issues found".

When no subsection lists findings:

```
### PR review

No issues found at <full-sha>. Ran: <reviews that ran>. <configuration notes, if any>

#### Security review

not run: unavailable — `security-review` was routed by `## Trust boundary` but is not vendored

#### Action versions

not run: not applicable — no CI-definition path in the diff
```

List every `not run` review after that line, each with its reason. A report with
an *unavailable* review is still clean. Not vendoring a skill is the consumer's
decision. The report makes the gap visible, and blocking readiness on it
forever would only teach people to ignore the report.

`No issues found at <full-sha>` on the first line is the one shape
`review-sweep` reads as a clean verdict, so it appears only there and only when
nothing anywhere in the comment is a finding.

End the comment with the attribution footer:

```
---
_Generated by [Claude Code](https://claude.ai/code)_
```

### 6. Report in the session

Say one of these, then end the turn:

- **posted**: link the comment, with the count of findings per review;
- **already reviewed**: this head already has a `### PR review` comment (link
  it);
- **skipped**: the PR is closed, merged, or purely generated (say which);
- **stop condition**: the PR is at a `review-sweep` §7 stop condition, nothing
  reached Critical or High, and nothing was posted (name the condition);
- **abandoned**: the head moved between the start of the run and posting, so
  nothing was posted. Name both SHAs. Invoking the skill again reviews the new
  head.

In every case, confirm the worktree was removed.
