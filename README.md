# agent-skills

Portable [Claude Code skills](https://code.claude.com/docs/en/skills) for QA and
code review, written to work in any repository. Project-specific facts live in
the consumer repo, in a single overlay file, so the skills themselves stay
generic.

Shipping a change:

| Skill | What it does |
| --- | --- |
| `pr-preflight` | Pre-push QA gate: mechanical checks, self review, project checks, then push and open a draft PR |
| `code-review` | Reviews a local branch diff or an open PR, scoring findings for confidence and dropping the weak ones |
| `review-sweep` | Triages every review comment on open PRs to a terminal state, and knows when to stop |
| `security-review` | Security gate driven by the project's stated trust boundary, with per-stack reference modules |
| `docs-currency` | Finds every doc a change invalidated, including the copies that only hold the wording the diff deleted |

Keeping the repo's inputs honest:

| Skill | What it does |
| --- | --- |
| `action-versions` | Pins every GitHub Action reference to its current latest major, looked up rather than remembered |
| `dependency-refresh` | Bumps and audits dependencies across whatever ecosystems the repo actually has, ranked by reachability |
| `skills-adopt` | Vendors these skills into a new repo, deriving the profile from the repo instead of a template |
| `profile-refresh` | Re-derives an existing profile against the repo, because a stale profile reads exactly like a current one |

## How consumers get them

**Vendored, not linked.** A consumer repo copies the skills it wants into its
own `.claude/skills/` and commits them, using the `agent-skills` CLI this package
provides. That is deliberate:

- Skills must be available on a session's **first turn**, before any hook or
  fetch has run.
- A change to your review tooling should be **reviewable** — committed skills
  show up in a PR diff; fetched ones never do.
- No runtime dependency: committed skills work offline, during a GitHub outage,
  and in scheduled runs.

The cost is that an update is a sync plus a PR in each consumer. The CLI makes
that a one-liner and detects drift.

## Adopting in a new repo

The consumer writes no tooling code. It owns two files — `.claude/skills.json`
and `.claude/project-profile.md` — and runs one command.

**Which ref to invoke.** The ref in the npx spec is the only content pin, so it
decides which skills you get. The commands below say `#main`, which is what
ships everything this README describes. **`v1` is not that ref** — it still
points at package 1.0.0, which predates `init`, `skills-adopt`, and several
other skills in the table above, so the bootstrap below exits with a usage error
against it.

Once you have adopted, pin the **full 40-character commit SHA** — not a tag. A
tag is a movable pointer, and this repo's own `ci-workflows` module exists partly
because of what happens when one moves: in March 2025 every tag of a widely-used
action was retroactively repointed at code that dumped CI secrets. The same
mechanism applies here — a repointed tag would vendor different skills into your
repo on the next routine sync, with nothing in your diff to show for it. A tag is
fine for *finding* the version you want; the object id is what you pin.
`skills-adopt` phase 1 resolves and verifies it, and records it where a later
bump can find it.

**Hand it to an agent.** Filling in the profile is the whole job, and it is
research: the answers have to come from the repo, not from a template. Paste
this into a session at the root of the repo you are adopting into.

> Adopt the shared Claude Code skills from `cwinters8/agent-skills` into this
> repository.
>
> 1. Run `npx -y github:cwinters8/agent-skills#main init` to scaffold
>    `.claude/skills.json` and a blank `.claude/project-profile.md`.
> 2. Run `npx -y github:cwinters8/agent-skills#main sync`. It vendors the skills
>    and then exits non-zero because the profile is still the template — that is
>    expected, and it is what puts `.claude/skills/skills-adopt/SKILL.md` on
>    disk.
> 3. Read that skill and follow it. It covers deriving each profile section from
>    this repo, what to do when there is no rules source to point at, and how to
>    confirm the ref you pinned ships the schema the template was written for.

That is the whole bootstrap, and it settles the obvious objection: the skill
explaining adoption is vendored *by* step 2, before it is needed in step 3.
`sync` writes the skills before it validates the profile, deliberately, so a
first run always leaves the guidance on disk even though it fails.

`#main` is right for the bootstrap specifically: nothing durable comes out of it
— two scaffolded files you are about to rewrite — and the pin that *is* durable
gets chosen and verified in `skills-adopt` phase 1, with the whole current
feature set on disk to choose from.

**Or do it by hand.** `init` is a convenience, not a requirement.

1. Copy `templates/project-profile.md` to `.claude/project-profile.md` and fill
   it in. Read `docs/project-profile.md` for what each section does and what
   omitting it costs you, and `examples/` for a complete real one.
2. Add `.claude/skills.json` naming the skills you want:

   ```json
   {
     "skills": ["action-versions", "code-review", "pr-preflight", "review-sweep"]
   }
   ```

   (`agent-skills list` prints what this version ships.)
3. **Confirm the ref ships what these docs describe, and pin it.** The ref in
   your invocation is the only content pin, so a tag that has fallen behind this
   README hands you an older schema than the template you just copied — and the
   validator then rejects a section the template told you to write.
   `agent-skills list` plus a `check-profile` against the freshly-copied
   template surfaces the disagreement in one run. Pin the commit SHA it resolves
   to — per the rule above, a tag is not a pin — and record why in your rules
   source. Everything below uses that verified ref; `#main` appears only in the
   bootstrap, the one place you have no verified ref yet.

4. Run the sync and commit both the vendored skills and the updated lock:

   ```sh
   npx -y github:cwinters8/agent-skills#<verified-ref> sync
   ```

   Wrap it as a script so the invocation lives in one place. The rule for
   every invocation that outlives adoption is the same: **pin the verified ref,
   never `#main`.** A script, and the validation below, are *durable*
   invocations — they run again and again, so `#main` in one means the content
   can change between runs with no pin change in any diff, and an upstream
   schema change can invalidate your profile during a routine command nobody
   thought was an upgrade. Only the one-shot bootstrap gets `#main`, because
   there is no verified ref yet at that point; that is the whole difference.

   ```json
   "scripts": {
     "skills:sync": "npx -y github:cwinters8/agent-skills#<verified-ref> sync"
   }
   ```

5. Validate the profile any time you edit it — a recurring command, so it
   carries the pinned ref for the reason just given:

   ```sh
   npx -y github:cwinters8/agent-skills#<verified-ref> check-profile
   ```

## The version you invoke is the version you vendor

The skills ship **inside this package**, so `sync` copies from the version you
ran — there is no clone, no network beyond fetching the package, and **no second
pin**. The ref in your npx invocation is the only thing that decides which skills
you get.

That is why `.claude/skills.json` has no `ref`, `source`, or `commit` field. An
earlier design had one, and it could silently disagree with the invocation:
bumping the ignored pin looked exactly like an upstream with no changes. The tool
now refuses to run if it finds one of those fields, rather than ignoring it.

`.claude/skills.json` is therefore config plus lock: you write `skills` (and
optionally `workflows` and `workflowRef`, below), and the tool writes `version`
(what produced the current copies), `files` (a hash per vendored file, so a
hand-edit is detectable) and `workflowFiles` (the same, for workflow callers).

## Updating

Bump the ref in your invocation — `#v2`, or a tag, or a commit SHA — re-run the
sync, and commit the diff. Run `sync --check` in CI to be told when a vendored
copy has fallen behind the version you invoke, or has been hand-edited.

## Answering review feedback automatically

`review-sweep` triages review comments on your open PRs — fixing what is worth
fixing, declining the rest with a reason on the thread. Something has to *start*
it. In a cloud session that is `subscribe_pr_activity`, but a terminal session
on your laptop has no such tool and no listener once you close it, so a PR opened
from your terminal is watched by nothing.

The workflow caller closes that gap: GitHub events start the sweep, so it works
the same whether the PR came from your terminal, the web, or a teammate.

**Once per account:**

1. Install the [Claude GitHub App](https://github.com/apps/claude) on the account
   or organization, for all repositories. This is what delivers the webhooks;
   `/web-setup` grants repository access but does **not** install the app.

**Then the token — and how far one copy reaches depends on who owns the repos.**
Actions secrets exist at repository, environment and organization scope only.
There is no user-account-level Actions secret: the user-level secrets a personal
account does have are for Codespaces and Dependabot, and neither is visible to
Actions. So:

- **Repositories under an organization**: set `CLAUDE_CODE_OAUTH_TOKEN` once as
  an organization secret, grant it to the repositories that need it, and you are
  done.
- **Repositories under a personal account**: it is one repository secret each.
  There is no shortcut, but it scripts:

  ```sh
  TOKEN=$(claude setup-token)
  for repo in owner/one owner/two; do
    gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo "$repo" --body "$TOKEN"
  done
  ```

  Rotation has the same shape — re-run the loop. If that becomes tiresome across
  many repositories, moving them under an organization is the fix, and the only
  one.

`ANTHROPIC_API_KEY` works instead of the OAuth token, and bills to the API
rather than your subscription. A token from `claude setup-token` is tied to the
subscription of whoever ran it.

### Or store no credential at all

The action can authenticate by exchanging the runner's GitHub OIDC token, which
removes the secret entirely. What replaces it is three *identifiers* — not
secrets — so they can be set as **organization variables** and shared across
every repository, which is the one way a personal account avoids a per-repository
copy of anything:

| Variable | Value |
| --- | --- |
| `ANTHROPIC_FEDERATION_RULE_ID` | `fdrl_...`, from the federation rule you create in the Claude Console |
| `ANTHROPIC_ORGANIZATION_ID` | your Anthropic organization ID |
| `ANTHROPIC_WORKSPACE_ID` | optional, `wrkspc_...`, when the rule targets more than one workspace |

The tradeoff is billing, not security: federation authenticates a Console
service account, so runs bill to the API rather than to a Claude subscription.
The federation rule is also where you constrain which repositories may exchange
a token — worth setting narrowly, since the workflow it authorizes runs with
`contents: write`.

**A third-party secrets manager is a different question.** Fetching the token
from one at runtime works, and with that provider's own OIDC support it needs no
stored credential either — but it cannot live in the shared workflow. GitHub
forbids expressions in `uses:`, so a reusable workflow cannot dispatch to
whichever provider a caller chose, and hardcoding one would make this file wrong
for every consumer who picked a different one. A caller can't bridge the gap
either: a job with `uses:` cannot have `steps:`, and passing a fetched secret
between jobs as an output is unmasked. So that path means owning your caller —
drop `review-sweep` from `workflows`, keep your own copy with the fetch step
before the `uses:` line, and accept that loop changes no longer arrive by
bumping a ref.

**Per repository**, add the caller to `.claude/skills.json` and sync:

```json
{
  "skills": ["review-sweep", "pr-preflight"],
  "workflows": ["review-sweep"],
  "workflowRef": "<commit-sha>"
}
```

`agent-skills init --with-workflows` writes the first two for you. The sync
writes `.github/workflows/agent-skills-review-sweep.yml`, a short caller whose
whole job is to say *when* to sweep. The loop it calls lives in this repository,
so a fix there reaches you when the ref moves — not as a pull request in every
repo you own.

**`workflowRef` is worth setting.** Without it the caller resolves a movable
major tag, `v2`. The rule from the section above applies with more force here,
not less: that workflow runs against your repository with `contents: write`, so
whoever can move the tag can change what runs. The default is a tag only because
this package cannot discover its own commit SHA from inside an npx checkout —
it will not render a pin it has no way to verify. Set the SHA yourself and the
caller gets exactly it; `sync` names the ref on every run so you can see which
one you are on.

**Configure it with repository variables, never by editing the file.** It is a
vendored file like any other: an edit makes your next sync refuse until you
revert it. The caller reads:

| Variable | Effect |
| --- | --- |
| `AGENT_SKILLS_REVIEW_BOTS` | Comma-separated bot logins whose comments start a sweep. The action ignores bot actors otherwise — which would ignore exactly the review bot you want answered. Unset means human reviewers only. |
| `AGENT_SKILLS_REVIEW_MODEL` | Model override. Unset uses the action's default. |

If you need different triggers than the caller ships with, drop `review-sweep`
from `workflows` and keep your own copy. The sync stops writing that file and
leaves yours alone.

## Editing a skill

Skills are edited **here**, never in a consumer's `.claude/skills/` — a
hand-edit there is silently overwritten by the next sync and is invisible to
every other repo. If the change is project-specific, it belongs in that
project's profile instead.

See `AGENTS.md` for the conventions these skills are written to.
