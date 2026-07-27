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
