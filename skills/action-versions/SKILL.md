---
name: action-versions
description: >
  Verify every GitHub Action reference is pinned correctly — the current latest
  major, and a commit SHA where the workflow is privileged — before writing or
  committing a workflow. Run whenever a change adds or edits a
  `uses: owner/repo@ref` line, and also whenever a change gives a workflow a
  secret or widens its `permissions:`, since that can make existing references
  need a SHA without touching them. Covers `.github/workflows/` files, composite
  and reusable actions, and any YAML referencing a GitHub Action. Use when asked
  to "add a workflow", "set up CI", "update actions", or "check action
  versions", and as part of any workflow-touching diff so stale majors never
  reach review.
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

**One diff shape needs a wider net.** If the change adds a secret reference or
widens `permissions:` in a workflow, that workflow may have just become
privileged while its `uses:` lines went untouched — so every existing reference
in it now needs the SHA that step 3 requires, and none of them appear in the
diff. When you see that shape, collect *every* `uses:` in the affected workflow,
not only the changed ones, and say in your report that you swept the file rather
than the diff.

Out of scope — do **not** rewrite these refs:

- **Local** (`uses: ./path`) and **Docker** (`uses: docker://…`) references.
- **Reusable-workflow calls** — a `uses:` whose path points at a workflow file,
  i.e. ends in `.yml` or `.yaml` (`owner/repo/.github/workflows/build.yml@ref`).
  There the `ref` selects a *version of that workflow file* at a git ref, not an
  action release: the repo may publish no releases at all, and a release major
  can point at a revision that lacks the file. Pinning such a ref to the repo's
  latest release major can make the workflow unresolvable or silently run the
  wrong revision. Leave reusable-workflow refs as-is; if they need currency,
  validate them separately against that repo's tags for the workflow path, not
  its action releases.
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

- **A workflow holding a secret or a write-scoped token gets the SHA, not the
  tag.** Look up the latest major as above, then pin the full 40-character SHA
  of that major's current release with the version in a trailing comment —
  `uses: owner/repo@<40-char-sha> # v7.0.1`. A moving major is a mutable ref: in
  March 2025 every tag of a widely-used action from `v1` through `v45.0.7` was
  retroactively repointed at a commit that dumped CI secrets into public logs,
  and a current major was no protection at all. This condition is not a
  preference — it is the same one `security-review`'s `ci-workflows` module
  states in C7, and the two skills must not prescribe opposite fixes for one
  line.
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
