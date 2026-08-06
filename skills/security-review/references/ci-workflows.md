# GitHub Actions and CI

Load this when `## Stack` names `ci-workflows`. CI is where privileged tokens sit
in an environment next to third-party code that executes on every run, which is
what makes it a first-class part of the trust boundary rather than tooling.

## C1. Secrets are scoped to the step that needs them

Bind a secret with a **step-level** `env:`, never a job-level one:

```yaml
# wrong — every step in the job sees it, including dependency installation
jobs:
  publish:
    env:
      DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
    steps:
      - run: npm ci          # a compromised install script reads process.env
      - run: ./publish.sh

# right — only the step that needs it
jobs:
  publish:
    steps:
      - run: npm ci
      - run: ./publish.sh
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

A job-level `env:` hands the value to dependency installation and every install
script it runs. Auditing those dependencies (C5) reduces the odds; it does not
remove the exposure. This is a real finding, not a style preference, and its
severity comes from what the token can do — see C6.

The checkout action leaves a credential behind for the same reason. It persists
the token into the repository's git config by default, where every later step —
and every dependency those steps execute — can read it, and from which it has
repeatedly escaped inside uploaded artifacts. Set `persist-credentials: false`,
including on a job that pushes: "it needs to push" is not an exception, because
the credential sits in git config from checkout until the push, covering every
install and build step in between — the exact window this rule is about. Give
the push step its own credential instead, scoped to that step (C1). On a
self-hosted runner this compounds with C9.4: the leftover outlives the job.

## C2. Workflow permissions are least-privilege

Each workflow declares the narrowest `permissions:` block that works — ideally a
top-level `permissions: {}` and then the specific grants each job needs.

Read the **organization's** Workflow permissions setting, not only the workflow
file. Since February 2023 new repositories default to a read-only `GITHUB_TOKEN`,
but org-owned repositories inherit the org setting, and long-lived orgs are
frequently still read/write. Inheriting a good default is also not the same as
declaring one: an explicit block survives the org setting being widened later.

`permissions:` is a GitHub Actions concept. Other CI systems that borrow the
`uses:`/`steps:` shape have no such block — don't ask for one there or flag its
absence. The rest of this module still applies to them.

## C3. `pull_request_target` plus a PR-head checkout is the classic compromise

```yaml
# never do this
on: pull_request_target
jobs:
  build:
    steps:
      - uses: actions/checkout@<sha>                       # see C7
        with:
          ref: ${{ github.event.pull_request.head.sha }}   # fork-authored code
      - run: npm ci                                        # …with write-scoped secrets
```

`pull_request_target` runs with the base repository's secrets and a write-scoped
token. Checking out the PR head then executes fork-authored code in that context.
If a workflow needs both untrusted code and secrets, split it along the documented
seam: run the untrusted half on `pull_request` with no secrets and have it upload
an artifact, then have a separate **`workflow_run`** job — which does run
privileged — download it.

That split relocates the trust boundary rather than removing it, so the
privileged half must treat what it downloads as untrusted **data**: never execute
it, and unzip it with the path-traversal care C8 describes. A `workflow_run` job
that runs a script out of the artifact has reintroduced the same bug one hop
later.

Flag any `pull_request_target` workflow that checks out, builds, or runs
anything from the PR head — then rank it on the privilege the job *actually*
holds, the same way C9.1 ranks runner reachability.

Read the effective privilege before assigning a consequence: the job's
`permissions:` after any narrowing, whether any secret is wired into it, and
whether checkout persisted a credential (C1). A job that reduces `permissions:`
to read-only or `{}`, references no secret, and runs on a hosted runner is not
executing fork code with write-scoped credentials, and calling it a repository
compromise is a false finding that costs the rule its credibility.

It stays a finding at lower severity, because the narrowing is not a control
anyone enforces: adding one `secrets:` line or widening `permissions:` re-arms
the whole thing, in a diff that touches no checkout step and reads like ordinary
CI work. That is the same one-line reversion `action-versions` now treats as a
trigger to re-sweep. Say what privilege you found and rank on it — never assume
the write-scoped case, and never treat today's narrowing as a guarantee.

Rank it **highest** when the job also names a self-hosted runner:
`pull_request_target` runs regardless of the fork-approval setting, so that
combination is unapproved fork code on owned hardware (C9.1).

## C4. Untrusted text interpolated into `run:` is code execution

```yaml
# wrong — the title is attacker-controlled and lands inside the shell command
- run: echo "Reviewing ${{ github.event.pull_request.title }}"

# right — through the environment, quoted, never expanded by the shell
- run: echo "Reviewing $TITLE"
  env:
    TITLE: ${{ github.event.pull_request.title }}
```

`${{ }}` is substituted into the script **before** the shell sees it, so any
attacker-controlled field — a PR title or body, a branch name, an issue comment,
a commit message, an author name — becomes shell syntax running as the runner.
This is the most common Actions vulnerability class there is, and on a
self-hosted runner it is code execution on a machine someone owns.

Bind the value to an intermediate environment variable and reference it as a
quoted shell variable. The same care applies to `${{ }}` inside an `actions/github-script`
body, where the substitution lands in JavaScript instead.

## C5. Dependencies are audited across the whole tree

Audit including development dependencies, not production-only. A dev dependency
executes during install, build, and typecheck — in CI, with tokens present.
Omitting dev advisories hides exactly the supply-chain path that matters most.

Judge findings by **reachability**, not by the dev/prod flag — and reachability
is two questions. Does the package execute during install, build or test, or
ship in the runtime bundle? *And* is the vulnerable path reachable from how this
project uses it? A blocker needs both yeses. A types-only package with no
scripts fails the first; a package that runs in CI through an entry point the
advisory never touches fails the second. Say which question downgraded a
finding, and report as unknown anything you could not answer.

## C6. Publish tokens are the highest-value secret

A token that can push code to already-installed clients — an over-the-air update
token, a package registry publish token, a deploy key — reaches users with no
review in the way. Treat its exposure as Critical, not High.

Confirm it lives only in secret storage, is never echoed into logs (including
debug output and error dumps), and that any channel or branch repointing done for
testing is deliberate and reverted afterwards.

## C7. Action pinning — two properties, not one

**Currency** — is the major current? Defer to the `action-versions` skill; don't
duplicate its rules here. That skill carries the matching half of this rule: it
pins the SHA rather than the tag when the workflow holds a secret or a
write-scoped token, so a reference satisfying it also satisfies this one. If it
is not vendored here, look the current major up yourself and apply the pin below
to it.

**Immutability** — can the ref change under you? A tag can, and this is not
theoretical. In March 2025 every tag of a widely-used action from `v1` through
`v45.0.7` was retroactively repointed at a commit that dumped CI secrets into
public workflow logs; roughly 23,000 repositories referenced it, and `v45` was a
perfectly current major at the time. GitHub's position: pinning to a full-length
commit SHA "is currently the only way to use an action as an immutable release."

So a current major is not a pinned action. Require a full 40-character SHA with
the version in a trailing comment — `uses: owner/repo@a1b2c3… # v4.2.1` — for
any third-party action in a job **worth attacking**. Decide that by asking what
an attacker gets if a reference in the job is repointed, rather than by matching
a list — four answers so far, and a job answering "nothing" to all four is the
only one safe on a moving tag:

- **a credential** — a secret, or a write-scoped token;
- **a host** — a self-hosted runner, where repointing a tag executes
  attacker-chosen code on an owned machine regardless of what token the job
  carries. C9.4 and C9.2 are the reason: that code outlives the job, and the host
  commonly reaches other infrastructure. The host *is* the asset;
- **private data the job can read** — a private checkout, a fetched dataset. A
  hosted job holding no secret, on a read-only token, still hands over
  everything it cloned;
- **an output something downstream trusts** — an artifact a later workflow
  publishes or deploys, an image pushed to a registry, a release asset.
  Substituting it reaches users through a path nobody reviews again.

The last two are the ones a credentials-and-runners test waves through, and they
are why this is a question rather than a pair of conditions. `action-versions`
asks the same question against the same four answers, deliberately: the two
skills must never prescribe opposite fixes for one line, and a project may vendor
either one without the other, so neither may be the only place a class of
exposure is named. If you find them differing, that divergence is the finding.
**A reusable-workflow call is in scope here too** — `owner/repo/.github/workflows/x.yml@ref`
runs with whatever the caller passes it, so a mutable tag there selects which
code receives those secrets. Its SHA resolves from the workflow path's history
rather than a release major, but the requirement is identical.
First-party actions from the platform vendor are lower risk, not exempt. Where
the organization can enforce rather than review it, the allowed-actions policy
supports requiring a SHA, and a workflow using an unpinned action fails outright.
Publisher-side immutable releases exist now too, but they are opt-in per
publisher, so they do not make a tag reference safe in general.

The two properties compose and neither substitutes for the other: a SHA pin rots
without a currency process, which is what `action-versions` and an update bot are
for.

## C8. Scripts that write into the repo

CI often runs a script that commits generated content. Two properties matter:

- It writes **data, never executable content**. A script that can emit code into
  the repo is a code-execution path that bypasses review.
- Untrusted values never reach a path join, filename, or generated import
  without shape validation. A scraped or user-supplied name containing `../`
  escapes its directory, and because the value can travel in a data file, the
  attack arrives as a data-only diff that looks harmless. Constrain at both ends:
  reject the shape on the way in, and resolve-then-verify containment before
  writing.
- It fails loud rather than writing something partial. A half-written generated
  file that still parses is worse than a failed job.

## C9. Self-hosted runners are part of the trust boundary

A hosted runner is a fresh VM the platform throws away. A self-hosted runner is a
machine someone owns, and every rule below follows from that difference. When
the project also provisions that machine, read `references/infra-provisioning.md`
alongside this — and `references/cloud-network.md` where a provider firewall
decides what reaches the runner, or `references/config-as-code.md` where the
provisioning is declarative.

**C9.1 Only private repositories may target the runner.** A fork PR on a
**public** repo can run code on a self-hosted runner — GitHub's own words:
"forks of your public repository can potentially run dangerous code on your
self-hosted runner machine by creating a pull request that executes the code in a
workflow." If the runner holds a key with privileged access to other
infrastructure, the runner is a lateral-movement path into it.

Grade it by whether fork-authored content can reach the runner *today*, and
report it either way. Calling every public repo critical burns the finding's
credibility on repos that are fine; calling a repo safe because its trigger
names look trusted is the mistake in the other direction, and it is the easier
one to make.

**Trace provenance, not event names.** A fork PR triggers only `pull_request`
and `pull_request_target` directly — but what those runs *produce* flows onward.
The documented chain is in C3: a `pull_request` job builds fork-authored code and
uploads an artifact, and a privileged `workflow_run` job downloads it. If that
second job runs on the self-hosted runner and executes what it downloaded, fork
code is running on owned hardware, and the runner's workflow never names a
fork-triggerable event at all. Anything else a fork can influence and a later job
consumes — a cache entry, a checked-out PR ref, a container image built from the
PR — is the same shape.

So for every job that names the runner, ask what it *executes* and where that
came from, not just what triggered it. A repo whose self-hosted jobs run solely
on a protected-branch `push`, a `schedule` or a `workflow_dispatch`, and consume
nothing produced by a fork-triggered run, is not currently reachable — say so
and rank it lower. It is still a finding at that lower severity, because nothing
enforces the arrangement: the control is a trigger line and a download step,
either changeable by anyone with write access in a PR that reads like a CI
tweak, and the runner's privilege does not change when they do. Never rank on
visibility alone, and never treat the absence of a PR trigger as a guarantee.

**The approval gate is not that control.** GitHub's default — *Require approval
for first-time contributors* — exempts anyone who has ever had a commit or PR
merged. It is per-contributor and permanent, not per-PR, so a merged typo fix
buys standing access; that is the documented opening move of the attacks that
took PyTorch and GitHub's own `actions/runner-images`. And `pull_request_target`
skips it outright: workflows it triggers "will always run, regardless of approval
settings." A `pull_request_target` job with `runs-on: self-hosted` is therefore
unapproved fork execution on owned hardware — the intersection of C3 and this
rule, and worse than either alone.

Verify in this order: read which repositories the runner is registered to and
confirm each is private; for an org runner group, confirm **Allow public
repositories** is off (it defaults off, and an enterprise-shared group can pin
it) and consider restricting **Workflow access** to named workflows; read the
repo's fork-approval setting and treat anything looser than *all external
contributors* as a finding on a runner that reaches other infrastructure. A
repo-scoped runner on a personal account has no group policy, so there the
constraint is convention only — say so rather than implying a setting enforces
it. A repo flipped to public later removes the control silently, with no diff
anywhere.

**C9.2 A runner reaching other infrastructure uses a dedicated, individually
revocable credential.** One `authorized_keys` line that can be deleted to lock CI
out — never a shared operator key, which cannot be revoked without locking the
operator out too. Generate the pair for CI alone and confirm the private half
lives only on the runner, at a mode only the runner's service account can read.

That is the floor, not the ceiling. A static key on a persistent runner is a
credential an attacker who reaches the runner simply keeps. Where the target is a
cloud provider, OIDC federation removes the stored credential outright — GitHub's
guidance is that it "will let you stop storing these credentials as long-lived
secrets." Where the target is a plain host, a short-lived certificate from an SSH
CA is the equivalent. Where neither is practical — one box, no identity provider
— the dedicated key is acceptable *and* is a standing finding to revisit. Say
which case the project is in instead of leaving it implied.

**C9.3 Inbound exposure is a finding, and outbound is not unlimited.**
Self-hosted runners are outbound-only by design: the agent long-polls for work
over HTTPS and nothing ever connects in. Any open inbound port beyond maintenance
access is attack surface the runner does not need — check the firewall in front
of it, not only the machine's own config. Outbound-only is not
outbound-unrestricted, though: GitHub publishes the domain allowlist a runner
actually needs, and a runner that can reach the whole internet exfiltrates
whatever it collects. An egress allowlist is the matching control.

**C9.4 A default-configured runner persists state between jobs — one job, one
host, then destroy the host.** The working directory, caches, installed tools
and anything a job leaves on disk survive into the next job, possibly from a
different workflow. **Cleanup steps are not the fix**: an attacker who owns a
job owns the cleanup, and the published technique for surviving it (setting
`RUNNER_TRACKING_ID=0` so the runner stops reaping child processes) is a
one-line workflow change.

Isolation takes two things, and only one of them is a flag. `--ephemeral` makes
GitHub de-register the runner after a single job, and just-in-time runners
minted through the REST API do the same while keeping a long-lived registration
token off the disk — but **de-registering a runner erases nothing**. The
registration is a lifecycle for the *agent*, not for the machine, so an
autoscaler that re-registers the same VM, the same container, or even the same
working directory hands the next job every file, cache and background process
the last one left. That is the whole of what this rule is trying to prevent, and
it survives the flag intact.

So require the second half explicitly: the host is a fresh VM or container per
job, discarded after de-registration and never re-registered. Actions Runner
Controller gets this right by construction — a new pod per job — which is why it
is the easy recommendation on Kubernetes. Elsewhere, read the autoscaler or the
supervisor that restarts the runner and confirm it *replaces* the host rather
than restarting the agent on it. A persistent runner that reaches other
infrastructure is a finding on its own; a nominally ephemeral runner on a
recycled host is the same finding wearing a flag.

**C9.5 A privileged apply/deploy workflow is gated by an environment, not by its
trigger.** `workflow_dispatch` is an intentionality control, not an authorization
one: triggering it needs write access — the same access that could merge to the
branch a `push` trigger fires on. It adds no reviewer, and it does not withhold
the secret.

Put the privileged job in an environment with **required reviewers** and
**prevent self-review** enabled. A job referencing an environment cannot access
that environment's secrets until every protection rule passes, so an unapproved
run never reaches the credential — which is the property `workflow_dispatch`
lacks entirely. Add branch or tag deployment restrictions so only the release ref
can deploy, and prefer OIDC over a stored deploy secret (C9.2). Manual dispatch
on top of that is still useful, and a `dry_run` input defaulting to true is sound
hygiene for a workflow whose failure mode is an unreachable target — but that is
operational practice, not the security control.
