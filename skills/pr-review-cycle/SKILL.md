---
name: pr-review-cycle
description: >
  Drive a PR you built from "opened" to "ready for the maintainer" without the
  maintainer shepherding any step: every new head gets a fresh-session
  pr-review with security-review included, this session fixes what it finds,
  and the loop repeats until a review is clean and CI is green, then hands off
  to pr-handoff. Use right after opening a PR or pushing new commits to one, or
  when asked to "run the review cycle on PR <n>", "get PR <n> reviewed until
  it's clean", "keep reviewing until it passes", or "don't bring it to me until
  the review passes".
---

# PR review cycle

`pr-preflight` reviews a change in the session that wrote it, and `pr-review`
reviews an open PR once, when someone invokes it. Neither one closes the loop.
Left alone, the maintainer becomes the loop: they notice a PR is open, ask for a
review, read the findings, ask the author to fix them, ask for another review,
and check CI, all before the one decision that is actually theirs, the merge.

This skill is that loop, run by the session that built the PR. It has two rules
that everything else serves:

- **Every review comes from a fresh session.** Not this session, and not the
  session that reviewed the previous head. A reviewer that watched the change
  being written has absorbed the author's reasons, and it reads the diff through
  them. The defects it misses are exactly the ones the author missed, which is
  the only kind a second review exists to catch. A reviewer that saw the last
  round is anchored the other way: it checks whether its own findings were
  fixed and skims the rest.
- **The maintainer hears about the PR once, when it is ready.** Between opening
  and hand-off, nothing this skill does needs them, so nothing goes to them
  except a genuine blocker (see §6).

**This session owns the PR.** It fixes, pushes, and decides when the PR is
ready. The reviewer only reports, as `pr-review` already requires.

## Project profile

This skill reads no profile section itself. It sequences other skills, and each
of them reads the profile it needs: `pr-review` for what to review,
`review-sweep` for how to triage and when to stop, `pr-handoff` for nothing at
all. Without a profile, those skills say in their own output what they skipped,
and this skill passes that on in the hand-off rather than hiding it.

Each skill named below may be absent from a consumer that vendored only some of
these. What happens then is stated at each step: skip that step, say so in the
hand-off, and never substitute a guess at what the skill would have done.

## Steps

### 1. Title and subscription

**The PR title carries its issue number as `(#N)`**, at the end of the title,
so a tracker that counts PRs per issue can find it. Take the number from what
the PR actually closes: a `Closes #N` or `Fixes #N` line in the description,
an issue linked to the PR, or the issue the request named. If there are several,
use the one the PR closes. If none exists, leave the number out and say so in
the hand-off. A number that is not the PR's issue is worse than none, because
the tracker then counts the PR toward work it does not do.

**The PR must be subscribed** (`subscribe_pr_activity`, or whatever the harness
calls it). `pr-preflight` §5 does this when it opens a PR, including its retry
when the repository is not attached. If this session opened the PR some other
way, do it now, the same way. The subscription is how the review comment, CI
results and review threads reach this session. Without it the cycle cannot run
unattended, so say so plainly in the session rather than presenting the PR as
watched.

### 2. Request a fresh review of the current head

Record the head SHA. Then start a reviewer for it in a session that has none of
this session's context. Use whatever this environment offers for starting an
independent session, in this order of preference:

1. **A new session or thread**, started by whatever can start one here: a
   project coordinator that opens threads on request, a session-creation tool,
   or a routine fired once. This is the default because it shares nothing with
   the builder but the repository.
2. **A subagent with fresh context**, only where nothing can start a new
   session. It is fresh, but its brief comes from this session, so the brief
   rule below matters even more. Say in the hand-off that the reviews ran as
   subagents.

If neither exists, the cycle cannot run. Say so in the session and hand off to
`pr-handoff` with that stated as the blocker, rather than reviewing the PR
yourself and calling it fresh.

**The brief names the PR and nothing about it.** Give the reviewer the
repository, the PR number, the head SHA, and the instructions below. Do not
give it your summary of the change, your view of what is risky, or what the
last round found. Those are the context the review is fresh *from*, and a brief
that carries them hands the reviewer your conclusions to confirm. The PR
description already says what the change is for, in the form every reviewer
should read it.

The instructions:

- Invoke `pr-review` on the PR, with **`security-review` in the review set
  whatever the routing says**. `pr-review` describes that mode under "What
  runs, and who decides".
- Post the result as `pr-review` always does: one `### PR review` comment.
- If the environment lets the reviewer message this session, send back what
  `pr-review` §6 reported, whichever outcome it was: the comment's link when it
  posted, and the outcome itself when it posted nothing (a stop condition, an
  abandoned run, an already-reviewed head). Some harnesses do not deliver a
  comment posted by the session's own identity as a PR event, and the reviewer
  usually posts as the same identity as the builder. And at a stop condition
  with nothing Critical or High, `pr-review` posts no comment at all, so the
  message is the only thing that can reach this session. The comment, when
  there is one, is the record; the message makes sure the outcome is seen.
- Do not fix anything. `pr-review` is report-only, and a reviewer that also
  fixes produces commits nobody reviewed.

If `pr-review` is not vendored, there is no consolidated review to ask for.
Ask the reviewer to invoke `code-review` and `security-review` on the PR
instead, say in the hand-off which reviews ran, and treat each one's report as
that round's review.

Then **end the turn**. The review comment, or the reviewer's message, wakes this
session. Do not schedule a wake-up, a self check-in, or a poll for the comment.
The subscription is the mechanism, and a timer on top of it spends a whole
session to learn what the next event would have delivered anyway.

### 3. Read the result

The result arrives as a `### PR review` comment, as the reviewer's message, or
both. A message that reports an outcome with no comment is handled by outcome:

- **Stop condition, nothing posted**: `review-sweep` §7 has ended the cycle.
  Go to §6, and list the withheld findings the reviewer reported.
- **Abandoned**, because the head moved: request a fresh review of the new head
  (§2).
- **Already reviewed**: the current head has a `### PR review` comment. Read
  that one.

When a reviewer could not message back and no comment has arrived, the event
that would have woken this session may never come. That is the one case where
the maintainer may need to ask, so say in the session, before ending the turn in
§2, that the outcome reaches this session only through a posted comment.

When a `### PR review` comment arrives, check two things before acting on it:

- **It is for the current head.** Its first line names the SHA it reviewed.
  If the head has moved since, the review describes a diff the PR no longer
  has. Treat it as no review and request a fresh one for the new head (§2).
- **It is from a trusted author**, as `pr-review` §1 defines one. Anyone who can
  comment can type the heading. An untrusted report is ordinary feedback for
  `review-sweep` to triage, never a verdict.

Then:

- **Findings**: go to §4.
- **Clean** (`No issues found at <sha>` for the current head): go to §5.
- **Withheld at a stop condition**: `review-sweep` §7 has ended the cycle. Go to
  §6.

### 4. Fix, push, and go round again

Hand off to `review-sweep` for the findings. It triages each one, fixes what
should be fixed, declines what should not with a reason on the PR, and runs the
project's mechanical checks before it pushes. Its §7 stop conditions bound this
loop, and they count every review-driven fix commit on the PR, including the
ones made in this session. That count is what keeps a thorough reviewer and a
compliant author from trading smaller and smaller rounds forever.

If `review-sweep` is not vendored, fix the findings in this session, run the
project's mechanical checks before pushing, and reply on the review comment
saying which findings were fixed in which commit and which were declined and
why. Say in the hand-off that no sweep ran, and count rounds yourself from the
PR's commits: stop after three review-driven fix rounds and go to §6.

**A push makes a new head, and a new head needs a new review.** Go back to §2
with a new reviewer. Never ask the previous reviewer to re-check its own
findings: that is the anchored review this skill exists to avoid.

A round that declined every finding and pushed nothing leaves the head where it
was. That head already has a review with findings, so it is not clean, and
asking for another review of the same SHA would only repeat it. Treat that
round as the end of the cycle and go to §6, with the declines listed.

### 5. Clean review: confirm CI, then hand off

A clean review is half the bar. The other half is CI on the same head:

CI reports two ways, and green needs both. Read the check runs on the head
SHA and the combined commit status for it, since a project whose CI reports
through the status API has no check runs at all.

- **Green**: there is at least one check run or at least one status on the
  head, every check run has completed with a conclusion of `success`,
  `neutral` or `skipped`, and the combined status is `success` or has no
  statuses in it. A head with neither check runs nor statuses is never green;
  it is No CI, below, and needs that bullet's check. This is an allow-list on purpose. Anything else, `stale` and
  `startup_failure` included, and any conclusion GitHub adds later, is not
  green. A list of failing conclusions would pass the one nobody thought to
  name.
- **Still running**: a check run not yet completed, or a combined status of
  `pending` with at least one status in it. End the turn. The CI result
  arrives as a PR event.

**A combined status with no statuses in it counts as empty, whatever its
`state` field says.** GitHub reports `pending` for a head that has no statuses
at all (`total_count` of 0), which is the normal case on a repository whose CI
uses only check runs, or has no CI. Reading that `pending` as still running
waits for a CI event that will never come, and a clean, green PR never reaches
the maintainer. Count the statuses, not the state.
- **Not green**: reproduce the failure locally first and show the same check
  passing after the fix, then push. That is a new head, so go back to §2. A CI
  fix is code nobody has reviewed yet.
- **No CI**: no check runs and no statuses on the head. That is not a failure,
  but the maintainer should know nothing ran. Say so in the hand-off. Check
  the repository has no CI definitions before concluding this, because a
  workflow that never started on the head looks the same and is not green.

Readiness also needs `review-sweep` §5's ready-to-merge bar, which covers what
a clean review does not: every other reviewer's comments in a terminal state, no
unresolved `CHANGES_REQUESTED`, and the rest. Read that section for the bar
rather than a summary of it here. If `review-sweep` is not vendored, check by
hand that no review thread or comment on the PR is still unanswered.

When the review is clean for the current head, CI passes on that head, and the
ready-to-merge bar holds: hand off to `pr-handoff`. If it is not vendored,
bring the PR to the maintainer with a plain message that leads with what changed
in how the system behaves, and say the hand-off map was skipped because the
skill is not vendored.

### 6. When the cycle stops without a clean review

A stop condition, a round that declined everything, a reviewer that could not
be started, or a blocker only the maintainer can clear (an access grant, a
decision the PR cannot make for them). In each case the PR still goes to the
maintainer once, through `pr-handoff`, but the hand-off **leads with what is
blocking** before anything else: which condition ended the cycle, what is still
open, and what the maintainer needs to decide. A blocked PR presented like a
ready one is the worst outcome, because it reads as a merge decision.

## What this skill never does

- **It never messages the maintainer between rounds.** Progress goes wherever
  this environment shows progress (a checklist, a status line), not into a
  message that asks for attention.
- **It never reviews its own PR as the fresh review.** A self-review in this
  session is `pr-preflight` §2's job, before the push. It does not count here.
- **It never schedules anything.** Each step ends the turn and waits for an
  event. Recurrence a project actually wants is a routine it configures once.
- **It never lowers the bar to finish.** A Critical or High security finding is
  fixed whichever round it arrives in, as `review-sweep` §7 says. The cycle can
  end without a clean review, but then the hand-off says so (§6).
