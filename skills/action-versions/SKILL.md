---
name: action-versions
description: >
  Verify every GitHub Action reference is pinned correctly — the current latest
  major, and a commit SHA where the workflow is privileged — before writing or
  committing a workflow. Run whenever a change adds or edits a
  `uses: owner/repo@ref` line, and also whenever a change increases what a
  workflow job can reach or changes where its steps run — a secret expression, a
  widened `permissions:`, an added `environment:`, a changed event, a move to a
  self-hosted runner — since any of those can make existing references need a
  SHA without touching them. Covers
  `.github/workflows/` files, composite and reusable actions, and any YAML
  referencing a GitHub Action. Use when asked to "add a workflow", "set up CI",
  "update actions", or "check action versions", and as part of any
  workflow-touching diff so stale majors never reach review.
---

# Action versions

Agents reach for a version tag they remember (`actions/checkout@v4`,
`actions/setup-node@v4`) instead of the one that is current. Those memorized
tags go stale constantly, and the drift is only caught in review — the exact
thing this skill exists to prevent. **Never trust a tag from memory. Look it
up every time.**

This applies to real GitHub Actions — anything referenced as
`uses: owner/repo@ref`.

Read `.claude/project-profile.md` → `## Exemptions` first. Some CI systems use
`uses:` for their own built-in steps, which are versionless platform primitives
rather than GitHub Actions; a project that has one records it there. If the
profile is missing, treat every `uses: owner/repo@ref` as in scope and say in
your report that you ran without exemptions.

## Procedure

Run this on the diff you are about to commit, not the whole tree.

### 1. Collect every action reference

Find each `uses: owner/repo@ref` line the change adds or modifies, including
`owner/repo/subdir@ref` forms that point at a composite action in a
subdirectory — the action's repo is still `owner/repo`. Dedupe by `owner/repo`.

**A diff can arm existing references without touching them.** The rule: *any
change that increases what a job can reach, or changes where its steps run,
re-opens every reference that job executes* — including references the diff
never mentions, and including ones in other files. When that happens, sweep
rather than read the diff.

Known instances, none of which contains a `uses:` line:

- a new secret expression appears in the job;
- `permissions:` is widened;
- an **`environment:`** is added — environment-scoped secrets are unavailable to
  a job naming no environment, so a job can already reference
  `secrets.DEPLOY_KEY` and resolve it to nothing. `environment: production`
  makes that reference real in a one-word diff;
- the **event changes** — `pull_request` to `pull_request_target` runs the job
  in the base repository's context, where its secrets resolve and its token can
  be write-scoped, without any expression or permission changing;
- the job moves to a **self-hosted runner** (see step 3: the host is the asset).

Treat that list as instances, not as the definition. If a change grants reach by
some route not listed, it still triggers the sweep — the enumeration has been
extended three times, and the next path is likelier to be missing from it than
the principle is to be wrong.

**Sweep transitively.** Collect every `uses:` in the affected workflow, and then
follow each `uses: ./path` into the local composite it names and collect that
file's references too, recursively. A composite's steps run in the calling job,
so the privilege the diff just granted reaches straight through — and `./path`
is out of scope for *rewriting* (below) while the third-party tags inside it are
squarely in scope. Say in your report that you swept the workflow and which
composites you descended into.

Out of scope — do **not** rewrite these refs:

- **Local** (`uses: ./path`) and **Docker** (`uses: docker://…`) references.
- **Reusable-workflow calls, for the *currency* lookup only** — a `uses:` whose
  path points at a workflow file, i.e. ends in `.yml` or `.yaml`
  (`owner/repo/.github/workflows/build.yml@ref`). There the `ref` selects a
  *version of that workflow file* at a git ref, not an action release: the repo
  may publish no releases at all, and a release major can point at a revision
  that lacks the file. Pinning such a ref to the repo's latest release major can
  make the workflow unresolvable or silently run the wrong revision. Never put
  one through step 2's lookup; if it needs currency, validate it against that
  repo's tags for the workflow path.

  **The immutability rule still applies to them.** A called workflow runs with
  whatever the caller passes it — `secrets: inherit`, named secrets, a
  write-scoped `permissions:` — and a mutable tag on the call selects which code
  receives them. That is the same exposure as a tagged action, through a
  different syntax, so a privileged caller pins the full commit SHA of the ref
  it currently resolves to, with the tag in a trailing comment. Resolve that SHA
  from the workflow path's own history, never from a release major. The
  exclusion above is about *which lookup* is valid, not about whether the ref may
  move.
- Anything the profile's `## Exemptions` names.

### 2. Look up the current latest for each `owner/repo`

Do not guess. Resolve the real latest release:

- **Primary — WebFetch** `https://github.com/<owner>/<repo>/releases/latest`.
  GitHub redirects it to the latest release tag (e.g. `…/releases/tag/v7.0.1`);
  read the major from that tag. This works for any public action and does not
  depend on the session's repo scope.
- If the action publishes no releases, WebFetch
  `https://github.com/<owner>/<repo>/tags` and take the highest semver tag.
- **Alternative — GitHub MCP** `get_latest_release` (fall back to `list_tags`)
  when the tooling permits querying the action's repo. Note that a session's
  GitHub access may be scoped to the working repo only, in which case
  out-of-scope action repos are denied — use WebFetch then.

### 3. Pin to the latest major

Actions conventionally maintain a moving major tag (`v7`) that tracks the
newest `v7.x`. Reference that major:

```yaml
- uses: actions/checkout@v7        # not @v4
- uses: actions/setup-node@v7      # not @v4
```

(`v7` is the verified latest major for both as of this writing — it is what
step 2's lookup returns today, not a value copied from memory. Confirm the
current major yourself rather than pasting the tag above; that is the whole
point of step 2.)

- **A job worth attacking gets the SHA, not the tag.** Two ways a job qualifies,
  and the second is easy to miss. It **holds something**: a secret, or a
  write-scoped token. Or it **runs somewhere that matters**: a self-hosted
  runner, where repointing a tag executes attacker-chosen code on a machine
  someone owns — read-only permissions and no secrets change nothing about
  that. `security-review`'s `ci-workflows` module is explicit that such code can
  leave files and processes behind for later jobs (C9.4) and that the host
  commonly reaches other infrastructure (C9.2), so "no token" does not make a
  self-hosted job unprivileged; the host *is* the asset.

  Look up the latest major as above, then pin the full 40-character SHA
  of that major's current release with the version in a trailing comment —
  `uses: owner/repo@<40-char-sha> # v7.0.1`. A moving major is a mutable ref: in
  March 2025 every tag of a widely-used action from `v1` through `v45.0.7` was
  retroactively repointed at a commit that dumped CI secrets into public logs,
  and a current major was no protection at all. This condition is not a
  preference — it is the same one `security-review`'s `ci-workflows` module
  states in C7, and the two skills must not prescribe opposite fixes for one
  line.
- **A file that runs on someone else's privilege is as privileged as its most
  privileged caller.** Judge those by the callers, never by the file — the file
  itself holds no secret expression and no `permissions:` block, so the test
  above reads it as unprivileged every time. Two shapes have this property, and
  the reasoning is identical for both:

  - a **composite action** (`action.yml` reached by `uses: ./path`), whose steps
    run inside the calling job with whatever that job holds;
  - a **local reusable workflow** (`on: workflow_call`), which runs with the
    permissions and secrets its caller passes — the same inheritance C7 describes
    for calls to *other* repos' reusable workflows, which applies no less when
    the callee is in this one.

  Treat those as the known shapes rather than the definition: anything whose
  steps execute under a caller's token belongs here. Trace the callers, and if
  **any** is a job worth attacking, every third-party reference inside needs the
  SHA. When you cannot enumerate every caller — a file published for other repos
  to consume, or simply more callers than you checked — pin the SHA anyway. An
  unnecessary SHA costs a bump you had to make regardless; a missed one costs the
  caller's credentials.
- **Otherwise match what the rest of the workflow already does.** If sibling
  steps pin SHAs, pin a SHA. If not, the moving major tag is the right default
  for a workflow with nothing worth stealing in its environment.
- The two properties are separate and both are yours: the SHA is *which bytes*,
  the lookup is *which version*. A SHA pinned once and never revisited rots, so
  bumping a SHA-pinned reference still means looking the major up again.
- Bump every stale reference, not just the one a reviewer happened to flag.

### 4. Only stay behind deliberately

If the latest major is a breaking change you can't take right now (dropped
Node runtime, changed inputs, a required migration), keeping an older major is
a real decision — pin it intentionally and say why in a comment and the PR
description. An out-of-date tag with no such reason is a defect: fix it before
pushing.

## When a reviewer flags a stale action

Treat it as already-known work, not a debate: look up the current major per
step 2, bump every stale `uses:` in the file (not only the flagged line),
push, and reply with what you moved them to. This is the miss this skill is
meant to stop reaching review at all.
