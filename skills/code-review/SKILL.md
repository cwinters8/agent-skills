---
name: code-review
description: >
  Review a change for bugs and project-rule violations, filtering low-confidence
  findings before reporting. Works on the local branch diff (the default, used
  by pr-preflight before a PR exists) or on an open PR given its number. Use
  when asked to "code review", "review this change", "review PR <n>", or when
  another skill invokes code-review.
---

# Code review

Find real defects in a change and report them at high confidence. The bar is a
senior engineer's: a small number of findings that are worth acting on beats an
exhaustive list padded with nitpicks. Reporting nothing is a valid and common
outcome.

## Project profile

Read `.claude/project-profile.md` before reviewing. It supplies four things this
skill depends on:

- `## Rules source` — the file stating the project's rules, which findings are
  judged against.
- `## Repo` — `owner/repo`, used to build permalinks.
- `## Review focus` — this project's known failure modes, which get extra
  attention in the passes below.
- `## Not findings` — classes of feedback this project never wants raised.

If the profile is missing, look for `AGENTS.md` then `CLAUDE.md` at the repo
root, derive `owner/repo` from the git remote, run the generic passes only, and
**say in your report that you ran without a profile**. A review that silently
skips the project-specific half looks identical to one that found nothing.

GitHub access varies by environment. Where the `mcp__github__*` tools are
present, use them — some sessions have no `gh` CLI and block direct
`api.github.com` calls. Load them via ToolSearch as needed.

## Modes

**Local diff (default, no argument).** Review the branch diff against its base
plus any uncommitted changes:

```sh
base=origin/main   # the branch this work merges into
git diff "$(git merge-base HEAD "$base")"...HEAD   # committed work
git diff HEAD                                      # uncommitted edits to tracked files
git ls-files --others --exclude-standard           # untracked files — read each in full
```

All three matter — the working tree is empty when the work is already
committed, so reviewing only `git diff` silently reviews nothing, and
`git diff HEAD` never shows a file git isn't tracking yet, so a newly created
file would otherwise reach `pr-preflight`'s shipping step unreviewed. List the
untracked files and read them as new files; review them as if every line were
added.

Do **not** reach for `git add -N` to force untracked files into the diff. It
leaves intent-to-add entries in the index, and a later `git commit -a` then
commits those files — including scratch files that were never meant for the
PR. (Verified: `git add -N . && git commit -a` swept an unrelated scratch file
into the commit.) The review must not mutate the index it is reviewing.

Confirm what `base` should be rather than assuming `origin/main`: a stacked
branch targets the branch below it, and diffing against the default branch there
pulls in the parent PR's commits and reviews them as if they were new. Report
findings in the session; do not post to GitHub in this mode.

**PR (`<number>` argument).** Review an open PR. Read it with
`mcp__github__pull_request_read` (`get` for metadata, `get_diff` for the diff,
`get_files` for the file list) and post one comment at the end.

## Steps

### 1. Eligibility (PR mode only)

Skip the review entirely if the PR is closed, merged, already carries a code
review from you at the current head SHA, or is an automated PR whose diff is
purely generated — the profile's `## Review focus` names this project's
generated paths, and a bot PR that only touches those is not worth a review.
Both report shapes state the head SHA in their first line (§5), so the
already-reviewed case is always readable without inference.

**Record `head.sha` when you start**, and re-run this check immediately before
posting: a PR can close, or take new commits, while the review runs. If the
head has moved, do not post — the findings describe the old diff, and their
line numbers no longer locate the code they cite. Start over against the new
head, or report in-session that the review was abandoned mid-flight.

### 2. Read the change and its rules

Read the diff, then the file named by `## Rules source`. Note that such a file
is written as guidance for agents *writing* code, so not every line is a review
criterion — flag a violation only where it states a rule the diff actually
breaks.

### 3. Review passes

Cover these angles, in parallel subagents when the change is large enough to
warrant it, otherwise inline. Each pass returns findings with the reason each
was flagged:

1. **Rules adherence** — the project's stated conventions and layout rules.
2. **Obvious bugs** — read the changed lines and scan for real defects. Stay
   close to the diff; don't spelunk for context you don't need.
3. **Historical context** — `git log` / `git blame` on the modified regions.
   Code that was deliberately written a certain way, and is now being undone,
   is a common real finding.
4. **Prior review feedback** — earlier PRs touching these files, via
   `mcp__github__search_pull_requests` / `pull_request_read`. Feedback that
   applied then often applies now.
5. **Code comments** — comments in and around the modified code frequently
   state invariants the diff violates.
6. **Project focus** — every item in `## Review focus`, checked against the
   diff by name. This is the pass that makes the review project-specific;
   skipping it because the diff "looks unrelated" is how the invariant the
   project actually cares about gets through.

Two checks that recur across projects:

- **Generated files.** Anything `## Review focus` marks as generated is
  written by a script. A hand-edit is a defect regardless of how correct the
  content looks.
- **Action pinning.** A new or edited `uses: owner/repo@ref` should be on the
  action's current latest major — defer to the `action-versions` skill. If that skill
  isn't vendored here, note that the reference went unchecked.

### 4. Score confidence

Score every finding 0–100 for whether it is real, and **drop everything below
80**. For a finding attributed to the rules source, verify it actually says that
before scoring it above 50.

| Score | Meaning |
| --- | --- |
| 0 | False positive, or a pre-existing issue the diff didn't introduce |
| 25 | Might be real; couldn't verify. Stylistic and not called out in the rules |
| 50 | Verified real, but a nitpick or rare in practice |
| 75 | Verified, will be hit in practice, or explicitly named in the rules |
| 100 | Confirmed by direct evidence, will happen routinely |

### 5. Report

**Local mode** — report in the session. Use the `ReportFindings` tool if it is
available, most severe first; plain text is fine if it isn't. If nothing
cleared the bar, say so in one line.

**PR mode** — post exactly one comment with `mcp__github__add_issue_comment`.
Keep it brief, no emojis, and cite every finding with a permalink built from
`owner/repo` (from `## Repo`, or the PR metadata) and the **full** head SHA
(`mcp__github__pull_request_read` `get` returns it in `head.sha`) — a
`$(git rev-parse HEAD)` substitution renders literally and breaks the link:

```
https://github.com/<owner>/<repo>/blob/<full-sha>/<path>#L40-L44
```

When the finding is about code the PR **deleted** — a removed file, or the old
side of a rename — that path doesn't exist at the head SHA and a head link
404s. Cite the base SHA (`base.sha` from the same `get` call) instead, or link
the PR's diff view, and say which you used. Surviving files still get head-SHA
links.

Both report shapes state the reviewed head SHA in their first line, findings
and clean alike. Don't rely on the permalinks to carry it: a review whose
findings are all on deleted code links only base SHAs, and the eligibility
check in §1 would then have no head SHA to read and would review the same head
again.

Give at least one line of context either side of the line you're flagging.
Format:

```
### Code review

Found 2 issues at <full-sha>:

1. <brief description> (<rules source> says "<quoted rule>")

<permalink>

2. <brief description> (bug in <file>: <short snippet>)

<permalink>
```

Or, when nothing cleared the bar — name the full head SHA reviewed, so a later
invocation's eligibility check (§1) can tell this head was already covered:

```
### Code review

No issues found at <full-sha>. Checked for bugs and rules compliance.
```

End every GitHub comment with the attribution footer:

```
---
_Generated by [Claude Code](https://claude.ai/code)_
```

## Not findings

Do not report these — they are the bulk of what a naive pass produces:

- Anything a typechecker or compiler catches, when the project runs one (see
  `## Mechanical checks`). Don't run builds as part of the review.
- Everything listed under the profile's `## Not findings`. Those are settled
  decisions; raising one re-opens an argument the project already had.
- Missing tests, general security posture, or documentation gaps, unless the
  rules source requires them specifically. Security belongs elsewhere: hand off
  to the `security-review` skill, which reasons from the project's actual trust
  boundary rather than from the diff alone. If that skill isn't vendored here,
  say in the report that the security pass did not run, rather than letting a
  clean code review imply one happened.
- Pre-existing issues on lines the diff didn't touch.
- Issues explicitly silenced in the code.
- Intentional behavior changes that are the point of the PR.
- Pedantic style notes a senior engineer would let pass.
