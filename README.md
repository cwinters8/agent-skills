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
it. In a cloud session that is `subscribe_pr_activity`, but a terminal session on
your laptop has no such tool and no listener once you close it, so a PR opened
from your terminal is watched by nothing.

The workflow caller closes that gap: GitHub events start the sweep, so it works
the same whether the PR came from your terminal, the web, or a teammate.

Setup is four steps, and only the third involves a choice:

1. **Install the Claude GitHub App** — once per account.
2. **Vendor the caller** — per repository.
3. **Give the run a credential** — one of three routes.
4. **Tune it** — all optional.

### 1. Install the Claude GitHub App

Install the [Claude GitHub App](https://github.com/apps/claude) on the account or
organization, **selecting only the repositories that will run this workflow**.
Installing across everything is one click less and grants the app access to
repositories that have no use for it, which widens what an app-token or
configuration compromise reaches. You can add repositories later as you adopt
them.

This is what delivers the webhooks; `/web-setup` grants repository access but
does **not** install the app.

### 2. Vendor the caller

Add it to `.claude/skills.json` and sync:

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

The `review-sweep` skill must be in `skills` as well, since the caller invokes it
by name; the sync refuses the pairing rather than writing a caller with nothing
to run.

**`workflowRef` is required**, and there is no default. It names the revision of
this package that GitHub resolves when the workflow fires — on a runner, long
after your sync finished. The tool will not guess one: it has no way to check
that a ref it rendered exists upstream, and a caller pointing at a missing tag
fails at event time in your repository rather than at sync time where you could
see it.

Use a commit SHA. The pinning rule from the section above applies with more
force here, not less: that workflow runs against your repository with
`contents: write`, so whoever can move a tag can change what runs. A major tag
like `v2` works and is the conventional choice for workflow refs, but it is
movable, and `sync` says so on every run that uses one.

### 3. Give the run a credential

Pick one of the three routes below. The caller reads all three and uses whichever
is configured, so a repository needs exactly one.

**Where a value can live at all.** Actions secrets exist at repository,
environment and organization scope only. There is no user-account-level Actions
secret — the user-level secrets a personal account does have are for Codespaces
and Dependabot, and Actions can see neither. Of those three scopes the vendored
caller can reach two: it selects no environment, and a job that calls a reusable
workflow cannot, so an environment-scoped secret or variable resolves empty.
Variables are scoped identically, so being non-secret buys convenience, not
reach. Repositories under an organization can share one copy there; repositories
under a personal account need their own.

#### Route A — a stored Actions secret

The simplest, and the only one that bills to a Claude subscription rather than
the API.

- **Under an organization**: set `CLAUDE_CODE_OAUTH_TOKEN` once as an
  organization secret and grant it to the repositories that need it.
- **Under a personal account**: one repository secret each. No shortcut, but it
  scripts, and rotation is the same loop:

  ```sh
  TOKEN=$(claude setup-token)
  for repo in owner/one owner/two; do
    gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo "$repo" --body "$TOKEN"
  done
  ```

  If that becomes tiresome across many repositories, moving them under an
  organization is the fix, and the only one.

`ANTHROPIC_API_KEY` works instead and bills to the API. A token from
`claude setup-token` is tied to the subscription of whoever ran it.

#### Route B — Anthropic OIDC federation, storing nothing

The action exchanges the runner's GitHub OIDC token for API access, so no
credential is stored. What replaces it is identifiers:

| Variable | Value |
| --- | --- |
| `ANTHROPIC_FEDERATION_RULE_ID` | `fdrl_...`, from the federation rule you create in the Claude Console |
| `ANTHROPIC_ORGANIZATION_ID` | your Anthropic organization ID |
| `ANTHROPIC_SERVICE_ACCOUNT_ID` | `svac_...`, required unless the federation rule already targets one service account |
| `ANTHROPIC_WORKSPACE_ID` | optional, `wrkspc_...`, when the rule targets more than one workspace |

The tradeoff is billing, not security: federation authenticates a Console service
account, so runs bill to the API rather than to a Claude subscription. The
federation rule is also where you constrain which repositories may exchange a
token — worth setting narrowly, since the workflow it authorizes runs with
`contents: write`.

#### Route C — Doppler, fetched by OIDC

The credential stays in Doppler and is fetched at run time, authenticating by
OIDC, so neither a Claude token nor a Doppler token is stored in GitHub.

**In Doppler**, before setting anything in GitHub:

1. Put the credential in the project and config you intend to use, named
   `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`). Any other name works too —
   see the overrides in the table below.
2. **Create a service account** for this, at **Team → Service Accounts → `+`**.
   Doppler service accounts are machine users that live at the workspace level
   and are then granted access to individual projects. Make a new one rather than
   reusing a broad existing account: the identity in step 4 authenticates *as*
   this account, so whatever it can read is what a workflow running your
   repository's own commands can reach.
3. **Grant it access to only the project holding the credential.** Open that
   project, choose **Members**, add the service account, and give it read access
   to just the environment this config lives in. This is the step that bounds the
   blast radius — everything after it inherits whatever you grant here.
4. On the service account's page, under **Service Account Identities**, create a
   new identity and select GitHub as the provider.
5. Configure the two required claims — **audience** and **subject**. The audience
   is what the runner asks GitHub to mint the token for; the fetch action requests
   `https://github.com/<owner>`. The subject is GitHub's `sub` claim for the run,
   and GitHub uses [several formats depending on
   context](https://docs.github.com/en/actions/concepts/security/openid-connect),
   so match the shape your repository actually emits rather than a remembered
   one.

   **This caller emits two shapes, and configuring only one is the likely way to
   get this wrong.** The ref in the subject follows the triggering event:

   | Trigger | Ref in the subject |
   | --- | --- |
   | `issue_comment` (PR conversation comments), `check_suite`, `schedule`, `workflow_dispatch` | the default branch |
   | `pull_request_review`, `pull_request_review_comment` | `refs/pull/<n>/merge` |

   So an identity configured only for the default-branch subject authenticates
   for conversation comments and the backstop, and fails for submitted reviews
   and inline review comments — the two that matter most. Either configure a
   claim that matches both, or add the second as an additional subject on the
   same identity. Doppler's own guidance points at the [secrets-fetch-action
   README](https://github.com/DopplerHQ/secrets-fetch-action) for the exact
   formats it accepts.
6. Copy the identity's UUID — that is `DOPPLER_IDENTITY_ID`.

**Then in GitHub**, set these repository or organization variables:

| Variable | Value |
| --- | --- |
| `DOPPLER_IDENTITY_ID` | service account identity UUID, from step 6. Setting this turns the fetch on |
| `DOPPLER_PROJECT` | project holding the credential |
| `DOPPLER_CONFIG` | config within that project |
| `DOPPLER_SECRET_NAME` | optional, when the **subscription token** is not named `CLAUDE_CODE_OAUTH_TOKEN` |
| `DOPPLER_API_KEY_NAME` | optional, when the **API key** is not named `ANTHROPIC_API_KEY` |

The fetch step is skipped entirely when `DOPPLER_IDENTITY_ID` is unset, so this
route costs nothing if you don't use it.

`CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` are the conventional names —
what Claude Code itself writes when it stores the credential as a repository
secret — but Doppler exposes each secret under its own name, so the workflow has
to read whichever you used. The two overrides are separate because they feed
different inputs. The stored-secret route has no equivalent: `secrets:` on a
reusable workflow is a static declaration, so only the declared names exist to
read there.

Fetched values stay step outputs and are never exported into the environment
(`inject-env-vars: false`, set explicitly), because the step that follows runs
the project's own commands and anything in the environment is readable by them.

The fetch lives in the shared workflow rather than in your caller because it has
to: GitHub drops job outputs that look like secrets, so a fetch in one job cannot
hand a credential to another, and a job with `uses:` cannot have `steps:` of its
own. It must sit in the same job as the step consuming it. Supporting another
provider means adding it there the same way, opt-in and inert by default.

### 4. Optional tuning

**Configure the caller with repository variables, never by editing the file.** It
is a vendored file like any other: an edit makes your next sync refuse until you
revert it. Every knob is a variable for that reason.

| Variable | Effect |
| --- | --- |
| `AGENT_SKILLS_REVIEW_BOTS` | Comma-separated bot logins whose comments start a sweep. Bot actors are ignored otherwise — which would ignore exactly the review bot you want answered. Unset means human reviewers only. **No spaces around the commas**: entries are matched whole, so `" x[bot]"` will not match `x[bot]` |
| `AGENT_SKILLS_REVIEW_MODEL` | Model override. Unset uses the action's default |
| `AGENT_SKILLS_RUNNER` | Runner label, for self-hosted runners. Default `ubuntu-latest` |
| `AGENT_SKILLS_MAX_TURNS` | Turn ceiling per run. Default 40. A sweep that hits it stops with partial work; the skill's reaction markers mean the next run resumes rather than redoing |
| `AGENT_SKILLS_SWEEP_SCHEDULE` | Set to `on` for a daily backstop sweep, covering states no webhook announces — a reviewer who signals with a reaction rather than a comment, or an event that never arrived |

The caller also sweeps when **CI finishes** — `check_suite` for third-party CI
apps and `status` for the older Commit Status API.

**If your CI is GitHub Actions, neither fires.** GitHub suppresses `check_suite`
for suites Actions created, to prevent recursion, and the event that does fire —
`workflow_run` — has to name the workflows it watches, which differ per
repository and cannot come from a variable, because triggers do not evaluate
expressions. So a vendored caller cannot subscribe to your CI. Either set
`AGENT_SKILLS_SWEEP_SCHEDULE` to `on` and let the daily backstop close it, or
take ownership of the caller and add a `workflow_run` trigger naming your own CI
workflows. This is the one place where leaving the schedule off has a real cost. Readiness needs green CI, and a sweep that just pushed a fix sees the
new head's checks still pending; without these a PR could sit unmarked with the
work already done, waiting for a reviewer to say something else.

Each run resolves the pull requests it may sweep before anything privileged
happens, and sweeps them **one job per pull request**. A run that finds more than
50 eligible sweeps a rotating window of 50 and says so in its log rather than
truncating silently — successive runs continue where the last stopped, so the
whole list is covered over several rather than the same end of it every time.

| `AGENT_SKILLS_ALLOW_FORKS` | Set to `true` to sweep pull requests from forks. Read the section below first |

### Pull requests from forks

**Skipped unless you set `AGENT_SKILLS_ALLOW_FORKS` to `true`**, and turning it
on buys less than it looks like.

A comment on a fork's PR fires `issue_comment` in *your* repository, so the sweep
would run with your credential and write permission while checking out
contributor-controlled code and running your project's own commands over it. The
workflow resolves the head repository first and stops before the checkout,
leaving a notice rather than a failure. An all-PR sweep drops the fork
pull requests and sweeps the rest, naming how many it left out — so leaving this
off costs you coverage of forks only, never of your own pull requests.

With the flag on, the sweep can triage a fork PR, reply on its threads and
decline feedback — but it **cannot push a fix**. The checkout credential is
scoped to your repository, the branch lives in the contributor's fork, and a side
PR cannot target a branch that exists only there. Fixing one needs a credential
that can write to the fork, which this workflow does not ask for.

### Taking ownership of the caller

If you need different triggers than the caller ships with, copy it — in this
order, because the obvious order does not work:

```sh
cp .github/workflows/agent-skills-review-sweep.yml .github/workflows/my-review-sweep.yml
# then drop "review-sweep" from the "workflows" array, and:
npx -y github:cwinters8/agent-skills#<verified-ref> sync
```

The sync removes the file it vendored and never touches yours, because yours has
a name it does not own. Doing it the other way round fails both ways: editing the
vendored file first makes every later sync refuse it as locally edited, and
dropping the name first deletes the copy you were about to base yours on.

## Editing a skill

Skills are edited **here**, never in a consumer's `.claude/skills/` — a
hand-edit there is silently overwritten by the next sync and is invisible to
every other repo. If the change is project-specific, it belongs in that
project's profile instead.

See `AGENTS.md` for the conventions these skills are written to.
