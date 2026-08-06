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
script it runs. Auditing those dependencies (C4) reduces the odds; it does not
remove the exposure. This is a real finding, not a style preference, and its
severity comes from what the token can do — see C5.

## C2. Workflow permissions are least-privilege

Each workflow declares the narrowest `permissions:` block that works. The default
is usually wider than the job needs.

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
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.head.sha }}   # fork-authored code
      - run: npm ci                                        # …with write-scoped secrets
```

`pull_request_target` runs with the base repository's secrets and a write-scoped
token. Checking out the PR head then executes fork-authored code in that context.
If a workflow needs both untrusted code and secrets, split it: run the untrusted
half on `pull_request` with no secrets, and have a separate trusted job consume
its artifacts.

Flag any `pull_request_target` workflow that checks out, builds, or runs anything
from the PR head.

## C4. Dependencies are audited across the whole tree

Audit including development dependencies, not production-only. A dev dependency
executes during install, build, and typecheck — in CI, with tokens present.
Omitting dev advisories hides exactly the supply-chain path that matters most.

Judge findings by **reachability**, not by the dev/prod flag: an advisory in a
package that never runs during install, build, or test (a types-only package with
no scripts) is not a release blocker; anything that executes in CI or ships in
the runtime bundle is.

## C5. Publish tokens are the highest-value secret

A token that can push code to already-installed clients — an over-the-air update
token, a package registry publish token, a deploy key — reaches users with no
review in the way. Treat its exposure as Critical, not High.

Confirm it lives only in secret storage, is never echoed into logs (including
debug output and error dumps), and that any channel or branch repointing done for
testing is deliberate and reverted afterwards.

## C6. Action pinning

Defer to the `action-versions` skill. Don't duplicate its rules here.

## C7. Scripts that write into the repo

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

## C8. Self-hosted runners are part of the trust boundary

A hosted runner is a fresh VM the platform throws away. A self-hosted runner is a
machine someone owns, and every rule below follows from that difference. When the
project also provisions that machine, read
`references/infra-provisioning.md` alongside this.

**Only private repositories may target the runner.** A fork PR on a **public**
repo can run arbitrary code on a self-hosted runner — GitHub's own documented
behavior, not an edge case. If that runner holds a key with privileged access to
other infrastructure, the runner is a lateral-movement path into it: a fork PR
becomes root on the machine that key reaches. State this as a rule to verify, not
an assumption. Read which repositories the runner is registered to and confirm
each is private, and record the constraint where the visibility decision gets
made — a repo flipped to public later removes the control silently, with no diff
anywhere.

**A runner reaching other infrastructure uses a dedicated, individually revocable
credential.** One `authorized_keys` line that can be deleted to lock CI out —
never a shared operator key, which cannot be revoked without locking the operator
out too. Generate the pair for CI alone and confirm the private half lives only
on the runner, at a mode only the runner's service account can read.

**Inbound exposure is a finding.** Self-hosted runners are outbound-only by
design: the agent long-polls for work and nothing ever connects in. Any open
inbound port beyond maintenance access is attack surface the runner does not need
— check the firewall in front of it, not only the machine's own config.

**Runners persist state between jobs.** Unlike an ephemeral hosted runner, the
working directory, caches, installed tools and anything a job leaves on disk
survive into the next job, possibly from a different workflow. Treat "a
compromised job can leave something behind for the next one" as the default
rather than the exotic case.

**Gate a privileged apply/deploy workflow to manual dispatch.** When a workflow
reconfigures infrastructure unattended and a bad change can leave the target
unreachable, `workflow_dispatch` — with a dry-run input defaulting to true — is
the right trigger. An automatic `push` trigger on that workflow means discovering
the breakage from a merge; add one only once the change path is trusted.
