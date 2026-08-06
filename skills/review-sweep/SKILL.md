---
name: review-sweep
description: >
  Triage unaddressed review feedback on a repo's open PRs: mark each new comment
  as seen, fix what's worth fixing, decline the rest with a reason, and flag PRs
  that are ready to merge. Use when asked to "sweep reviews", "triage review
  comments", "check PR feedback", "address Codex comments", or when a scheduled
  routine invokes /review-sweep. Accepts an optional PR number as argument; with
  no argument it sweeps every open PR.
---

# Review sweep

Keep review feedback moving without waiting on a human. Reviewers — Codex,
another bot, or a person — comment on PRs; this skill triages every unhandled
comment to a terminal state (**fixed** or **declined with a reason**), tells the
maintainer when a PR needs nothing but their merge click, and knows when to stop.

Use the GitHub MCP tools (`mcp__github__*`) for all GitHub reads and writes;
many sessions have no `gh` CLI and block direct `api.github.com` calls. Load
them via ToolSearch as needed. Local git is available for checking out branches
and pushing fixes.

## Project profile

Read `.claude/project-profile.md`. It supplies:

- `## Repo` — which repo to sweep, and the collaborator model, which decides
  whether §5's reaction-count shortcut is available at all.
- `## Not findings` — the classes of feedback this project declines on sight,
  with the reason to cite.
- `## Review focus` — the invariants that make a comment worth fixing.
- `## Mechanical checks` — what must pass before a fix is pushed.

Without a profile, judge feedback on general merit, require an `APPROVED` review
for readiness, and say in the report that you swept without project context.

## Marker protocol

Emoji reactions on a comment record its triage state. Both
`add_reply_to_pull_request_comment` (inline review comments) and
`add_issue_comment` with `comment_id` (PR conversation comments) accept a
`reaction` parameter.

| Reaction | Meaning |
| --- | --- |
| 👀 `eyes` | Seen — triage in progress |
| 🚀 `rocket` | Addressed — a fix was pushed |
| 👎 `-1` | Declined — reply on the thread explains why |

Only the **terminal** markers mean a comment is handled, and the two are
proven differently:

- **👎 is terminal on its own.** The tools here can't see *who* left a
  reaction, but it doesn't matter: an agent's decline arrives with its
  explanatory reply, and a bare 👎 is the maintainer rejecting the feedback
  (Codex itself invites 👍/👎 ratings) — either way the comment is declined.
  On finding a bare 👎, resolve its thread and move on; no reply needed.
- **🚀 must be paired with its fix reply** (or a resolved thread). A 🚀
  claims a fix was pushed, and the reply linking the commit is the evidence;
  a bare 🚀 gets re-triaged like any unhandled comment.

A bare 👀 with no terminal marker is either *in-flight* (a live session is
working it) or *stale* (that session died before finishing). The GitHub MCP
tools can add reactions but cannot read reaction timestamps, so judge
staleness from thread activity instead: if the newest activity on the thread
(the comment itself or any reply) is **more than ~2 hours old**, treat the 👀
as stale and re-triage the comment — re-adding 👀 is a no-op, and overlap
with a live session is cheaper than feedback orphaned forever. With activity
newer than that, assume it's in-flight and leave it; if that session died,
the next sweep will see it as stale. Whoever marks 👀 must drive the comment
to a terminal state in the same run — that's what keeps the marker
meaningful. React 👀 first, before reading deeply, so humans and other
sessions can see the comment is being worked. GitHub reactions can't be
removed by a different token, so "replace 👀 with 🚀" just means adding the
terminal reaction; 👀 may remain alongside it.

Inline review comments thread naturally, but PR conversation comments don't —
`add_issue_comment` can't pair a `body` with a `comment_id`, so a closing
response there is a separate top-level comment. Make the association
explicit: start the closing comment by linking the original comment's URL
(e.g. `Re: <html_url> — …`), and when checking a conversation comment's
terminal state, count only a later comment from us that references its URL.
Wherever this skill speaks of a comment's thread, replies, or activity, read
that for a conversation comment as the original comment plus our later `Re:`
comments referencing its URL — the staleness window and the waiting-on-fix
check below both apply through those.

After reaching a terminal state on an inline comment, also resolve its thread
(`resolve_review_thread`) so the PR's unresolved count reflects reality.

## Workflow

### 1. Enumerate work

- No argument: `list_pull_requests` (state: open), paginated to the last
  page like every other listing here. One argument: just that PR.
- For each PR, gather review comments, conversation comments, and review
  summaries (`pull_request_read` methods `get_review_comments`,
  `get_comments`, `get_reviews` — a review's summary body can carry feedback
  that appears nowhere else), plus the PR diff.
  All three endpoints paginate (`perPage` with `after`/`page`): loop each
  until the last page before triaging or judging readiness — feedback missed
  by pagination would otherwise be treated as nonexistent.
- Filter to comments lacking a terminal state (see Marker protocol: any 👎,
  a 🚀 paired with its fix reply, or a resolved thread). A bare 👀 excludes
  a comment only while its thread shows activity inside the staleness window;
  a stale 👀 does not. Skip this skill's own prior output — a `Re:` closing or
  blocker-question comment, a decline/fix reply, the ready-to-merge signal, the
  stop-condition summary from §7, or an `@codex review (head …)` request from
  step 5 — but *not* every comment posted through this identity: where there is
  no separate bot account, `code-review`'s PR-mode findings (`### Code review`
  listing issues — see that skill) post through the same GitHub identity as this
  skill and must be triaged like any other reviewer's comment, or they'd never
  reach a terminal state. Its **clean** report (`### Code review` / `No issues
  found at <sha>`) is not feedback and needs no triage — skip it, and read it as
  the reviewer verdict step 5 is looking for. The distinction is authorship
  intent, not identity: requests, replies, and clean verdicts are bookkeeping;
  only a report that actually raises issues awaits triage. Reacting to or
  declining your own bookkeeping would both waste a cycle and stall readiness.

### 2. Triage each comment

React 👀, then judge the feedback on its merits — it may be from Codex,
another bot, or a human. Review summaries are the exception to the seen
marker: they can't receive reactions, so they have no 👀 state — their only
recorded states are the closing `Re:` comment or a linked blocker question.
Human comments from the maintainer get extra weight but the same process.

**Address** (in priority order): real bugs, security issues, violations of the
invariants named in `## Review focus`, data-loss risks, missing test coverage
where tests exist, genuine clarity problems.

**Decline**: style nitpicks, subjective preferences you disagree with after
honest consideration, speculative generality (YAGNI), and everything the
profile's `## Not findings` names — decline those citing the rules source rather
than implementing what they ask for. Reviewers will keep raising a project's
settled decisions; the profile exists so you can close them in one line.

When genuinely unsure whether feedback is right, lean toward declining with an
honest reply over guessing at a fix — a wrong "fix" costs more than a wrong
decline, and the reply invites correction.

### 3. Apply fixes

For feedback worth addressing:

- Fetch and check out the PR's branch locally.
- **Default: commit the fix directly on the PR branch and push.** Agent-authored
  PRs don't benefit from a fixes-PR stacked on top; it only creates more review
  surface for the maintainer.
- **Exception — use a side branch + draft PR targeting the PR's branch** when
  the PR was authored by a human, or the fix is large, design-changing, or
  you're not fully confident in it. Name it `<pr-branch>-review-fixes`.
- Before pushing, run `## Mechanical checks` **and** hand off to the
  `pr-preflight` skill for the project checks — a review fix is a change like
  any other, and can invalidate a doc or leak a secret just as easily.

  Give that skill the one instruction it cannot derive on its own: **scope its
  docs checks to the whole branch diff against the base**, not to the fix you
  just made. That is this skill's contribution and the reason the hand-off is
  worth spelling out — by round three, a fact corrected in round one sits on
  neither side of the current diff, and the copies still contradicting it are
  exactly the ones nobody has looked at since. A fix that corrects a claim is
  the most likely kind to leave a stale quotation of it somewhere else.

  **If `pr-preflight` isn't vendored here, run `## Mechanical checks`, say in
  the PR thread which project checks did not run, and stop there** — not part of
  them. Re-reading the rules source and running the docs checks are pieces of
  that skill, so doing them here is reconstructing it right after announcing it
  was skipped, and that produces the most misleading report available: one that
  names a gap while having quietly filled some of it, leaving no way to tell
  which part. A sweep that pushes without disclosing the gap reads exactly like
  one that cleared it; a sweep that discloses and then half-closes it reads
  worse.
- Reply to the comment stating what changed, linking the commit. React 🚀
  and resolve the thread. When the feedback item is a review summary, the
  response takes its only possible form — a top-level
  `Re: <review html_url> — Fixed in <sha>` comment, the same closing form
  the side-PR merge path uses — since summaries accept no replies,
  reactions, or thread resolution.
- **The side-PR path is different**: the fix isn't in the PR branch yet, so
  the comment is *waiting-on-fix*, not terminal. Reply linking the draft PR
  but do **not** react 🚀 or resolve. On later sweeps, a comment stays
  waiting-on-fix while **anywhere in its thread (or `Re:` chain) a reply from
  us links a side PR that is still open** — later replies, like a maintainer
  acknowledgment, don't clear that state. Check the linked side PR instead of
  re-triaging. Merged → record the terminal state in the form that feedback
  type requires: inline comments get 🚀 and a resolved thread; conversation
  comments and review summaries get their `Re: <html_url> — Fixed in <sha>`
  closing comment (plus 🚀 where reactions exist), since that comment is
  their terminal evidence. Closed unmerged → re-triage fresh.

### 4. Decline cleanly

Post a brief reply explaining why (one or two sentences — cite the rules source
when that's the reason), react 👎, and resolve the thread. A review summary's
decline takes the same form as its fix — a top-level
`Re: <review html_url> — Declined: <reason>` comment — since no reaction or
thread resolution exists there.

### 5. Ready-to-merge signal

A PR is ready to merge when all of:

- every review comment, every PR conversation comment, **and every review
  summary body** from a reviewer is in a terminal state per the marker
  protocol. A review whose substantive feedback lives only in its summary
  body (`COMMENTED` or `CHANGES_REQUESTED`) is triaged like a conversation
  comment, except review bodies can't receive reactions (GitHub's reactions
  API doesn't cover them) — so the `Re:` closing comment **is** the terminal
  evidence: it must link the review's URL and open with `Fixed in <sha>` or
  `Declined:` so later sweeps can read the outcome without any marker. A
  `CHANGES_REQUESTED` review additionally blocks readiness until a later
  verdict covers the current head. Informational bot boilerplate doesn't
  count, and neither does this skill's own bookkeeping — the same forms step 1
  skips. That exemption stops there: a `### Code review` report **raising
  issues** shares this identity but is real feedback, and an unclosed one blocks
  readiness like any other comment. Exempting it wholesale would let a PR be
  called ready with its own review's findings unresolved,
- CI checks on the head commit are green. Zero configured checks counts as
  green only when the project genuinely has no CI — read `## Mechanical checks`:
  if it names commands that a CI system is expected to run, a PR showing no
  checks is a broken pipeline, not a pass,
- no open side PR (`<pr-branch>-review-fixes`) still targets the PR's branch —
  an unmerged fix PR means known feedback isn't in the branch yet,
- the reviewer verdict is approving **and provably covers the current head**.
  Three signals qualify: an `APPROVED` review whose `commit_id` **is** the
  current head — review objects carry the reviewed SHA, and submission time
  proves nothing, since an approval can be submitted late against an older
  commit — an affirmative no-suggestions Codex round for this head, or a
  `code-review` clean report (`No issues found at <sha>`) whose SHA **is** the
  current head. Take the clean report before requesting a Codex round: the head
  already has an affirmative review, and re-requesting would spend a round to
  learn what the PR already says.
  **Silence is never approval** — a failed trigger or a Codex outage must
  not greenlight an unreviewed head. Obtain the Codex verdict actively:
  when every other condition passes and the head lacks a verdict, read the
  PR's current 👍 reaction count (`issue_read` on the PR returns per-emoji
  counts) and post one `@codex review (head <short-sha>, 👍-baseline <n>)`
  comment — the SHA is the dedupe key, and **at most two requests per head**:
  the initial one, plus the single promised retry marked with `retry` in the
  comment text (so the retry below survives the dedupe). A later pass
  judges the response: new Codex comments go through triage as usual, and
  the round is approving only if the PR's 👍 count **rose above the
  recorded baseline** with no new Codex suggestions — Codex reacts 👍 on
  the PR when it has none, and a maintainer's 👍 counts equally. If neither
  suggestions nor a 👍 arrive within a few hours, re-request once; if still
  nothing, report the PR as blocked on a reviewer verdict instead of
  declaring it ready.

  **The count-delta path requires permission from the profile.** Reaction
  authors aren't readable via the MCP tools and direct GitHub API calls are
  blocked in these sessions, so the signal is unattributed. It is sound only
  where the plausible reactors during the window are known — a private repo with
  a single maintainer plus the review bot. Use it only when `## Repo` says so.
  Otherwise require an `APPROVED` review and report the PR blocked without one.

When a PR becomes ready: if it is still a draft, mark it ready for review
first (`update_pull_request` with `draft: false`) — a draft can't be merged,
and the whole point of the signal is that only the merge click remains. Then
post **one** conversation comment telling the maintainer it's ready to merge,
naming the head SHA it covers, with a one-line summary of what was triaged.
Dedupe on both conditions together: skip only when an existing
ready-to-merge comment **names the current head** and is newer than all
reviewer activity on the PR — an old signal for a previous head never
suppresses the cue for a new one. If
feedback arrived after the last ready signal and was triaged without moving
the head (declines don't push commits), post a fresh signal — the
maintainer's newest notification should be the merge cue, not a feedback
thread.

### 6. Blockers

If you can't check out a branch, feedback is too unclear to triage, or a
decision genuinely needs the maintainer (e.g. two comments demand opposite
things), ask a specific question **attached to the feedback it blocks on**:
reply in the inline thread when there is one, otherwise post a top-level
comment opening with `Re: <html_url>` linking the original comment or review
— the same association rule as closing comments, so a later sweep can
connect the maintainer's answer back to the blocked item instead of
re-asking. Don't expect the maintainer to repeat the URL when answering: any
conversation comment they post after the blocker question is read as part of
that question's `Re:` chain, so a plain answer counts. A pending blocker
question is a *waiting-on-answer* state, preserved the same way as side-PR
waits: while the thread or `Re:` chain contains our unanswered question,
later sweeps don't re-triage or re-ask — they only check for a maintainer
answer, overriding the 👀 staleness window. Once answered, triage resumes
with the answer as direction; the feedback carries no terminal marker until
then.

### 7. Stop conditions

Triage has an end. Without one, a thorough reviewer and a compliant agent will
trade rounds indefinitely, each round smaller than the last, and the PR never
merges. These conditions end the cycle. They bound *how long the loop runs* —
they never lower the bar for a real defect, and a Critical or High security
finding is always addressed no matter which round it arrives in.

- **Non-substantive round.** A round whose feedback contains nothing from §2's
  Address list is non-substantive. **Two consecutive non-substantive rounds end
  the cycle** on that PR.
- **Re-litigation is terminal on sight.** Feedback restating something already
  declined on this PR — the same topic again, or an argument against a decline
  reply — gets one 👎 and a one-line `Already declined above: <url>`, and is
  closed. Don't re-argue it, and don't convert it into a fix because it came
  back louder. A genuinely *new* argument for a declined point is different:
  judge that on its merits, once.
- **Prose suggestions aren't fixes.** After the first round, wording changes to
  docs, comments, or a PR description that don't correct a stated fact are
  declined rather than applied. Rewording is infinite; correctness is not.
- **Fix-commit cap.** At most **5 review-driven fix commits** on one PR. On
  reaching the cap, stop pushing and hand the PR to the maintainer — a change
  needing a sixth round of fixes has a design problem that another round won't
  find. **The cap never applies to a Critical or High finding** (the severity
  table in `security-review` defines those), nor to any defect that would
  otherwise ship broken: fix those, push, and say in the hand-off that you passed
  the cap deliberately and why. A budget that can leave a Critical security bug
  unfixed is the wrong budget — the cap exists to stop rounds of polish, not to
  ration correctness.

**A sweep never schedules its own next run.** Finish the sweep, report, and end
the turn — no wake-up, no self check-in, no recurring poll, whether the PR is
resolved or still waiting on something. Where a project runs a scheduled sweep,
that routine is the recurrence; where it doesn't, the next sweep is invoked when
someone wants one. A session that re-arms itself turns a bounded task into an
unbounded one, which is the same failure the stop conditions above exist to
prevent.

**On stopping**, do not request another Codex round. Post one comment that:
names the current head SHA, lists every comment left open with the one-line
reason each was declined, and says plainly that the PR is being handed over
because the loop hit a stop condition (name which one). Mark the PR ready for
review if it is still a draft. Then report it as **needing a human call** —
not as ready to merge; those are different states and conflating them hides
exactly the PRs a maintainer should look at. The two-requests-per-head cap in
§5 remains the inner limit; these conditions bound the whole PR.

## Report

End with a short summary per PR: comments triaged (fixed / declined /
blocked), commits pushed, which PRs are ready to merge, and which stopped on a
§7 condition and why. If there was nothing to do, say so in one line.
