---
name: action-versions
description: >
  Verify every GitHub Action reference is pinned correctly — the current latest
  major, and a commit SHA where the workflow is privileged — before writing or
  committing a workflow. Run whenever a change adds or edits any `uses:` line,
  whatever follows it — an action, a `docker://` image, a local composite or
  reusable workflow. Run it also whenever a change increases what a
  workflow job can reach or changes where its steps run — a secret expression, a
  widened `permissions:`, an added `environment:`, a changed event, a move to a
  self-hosted runner — since any of those can make existing references need a
  SHA without touching them, and whenever a change makes another job's output
  trusted, such as a new publish, deploy, or registry push of an artifact built
  elsewhere, which re-opens the unchanged job that produced it. Covers
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

**Collect on the keyword, not on a shape.** Find every `uses:` line the change
adds or modifies, whatever sits to the right of it, and classify afterwards. Do
not filter to `owner/repo@ref` while collecting: the `docker://` and `./local`
forms are excluded from the *currency lookup* further down and from nothing
else, so a collector that never sees them makes those exclusions unreachable —
a newly added `docker://registry/image:tag` in a privileged job would be dropped
here and never reach the digest rule that governs it. Filtering at collection
time is also what forces every new `uses:` syntax to be re-litigated one finding
at a time; matching the keyword covers the next one for free.

**Dedupe by whatever the pin is applied to, and collapse two references only
once you know one answer serves both.** The key is not the same for every form:

- **Actions** usually dedupe by `owner/repo`, because a repo normally has one
  release stream and so one latest major. `owner/repo/subdir@ref` names a
  composite action in a subdirectory of that same repo, and where the repo tags
  as a whole those sub-actions do move together. **But some monorepos tag per
  path**, publishing their sub-actions on independent version lines — and there
  the single `releases/latest` lookup returns one stream's answer, which
  collapsing by `owner/repo` then applies to every sub-action under it. That
  either names a ref that does not exist for the one you rewrote or bumps it to
  a version that was never its own. So keep the subdirectory in the identity
  until you have seen that the repo versions its actions together; dropping it
  is the optimization, not the default.
- **Registry references** never dedupe by image. `docker://runtime:20` and
  `docker://runtime:22` are one image at two tags resolving to two different
  digests, and collapsing them either leaves one still on a mutable tag or
  writes the other's digest over it and silently changes the version the job
  runs. Key those on the full reference, tag included, and resolve each digest
  separately.

The shape of the mistake is the same in both: a key coarser than the thing being
resolved, which reads as tidy and hands one reference's answer to another.

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
- the job moves to a **self-hosted runner** (see step 3: the host is the asset);
- the job **adds a local call** — `uses: ./some-action`, or a call to a local
  reusable workflow. Nothing about the job's privilege changed and the callee's
  file did not change either, but the callee's references now execute under that
  privilege for the first time. The collection step cannot see them on its own,
  because a local call is not an action reference.

Treat that list as instances, not as the definition. If a change grants reach by
some route not listed, it still triggers the sweep — the enumeration has been
extended three times, and the next path is likelier to be missing from it than
the principle is to be wrong.

**A second rule, pointing the other way.** Everything above asks what changed
about a job and re-opens *that* job. There is a case the whole shape of that
question misses: *a change that makes some other, unchanged job's output
trusted re-opens the references in the job that produces it.* A diff adds a
step that publishes an artifact, deploys it, or pushes an image built earlier;
the producing job's permissions, secrets, runner and `uses:` lines are all
exactly as they were. Nothing about it appears in the diff. But step 3's fourth
asset — an output something downstream trusts — has just become true of it, so
its moving tags now decide what reaches users, and no trigger phrased as "what
changed about this job" will ever fire on it.

So when a diff **adds or widens a consumer of an existing artifact** — a new
publish, deploy, release, or registry push, or an existing one that starts
consuming something it did not before — trace the edge back to whatever produced
that artifact and sweep the producer, in whatever workflow it lives. The
producer is usually the innocuous-looking half: a hosted, read-only build job
that was genuinely safe on a moving tag right up until the moment something
started trusting what it emitted.

**Sweep transitively.** Collect every `uses:` in the affected workflow, then
follow each local call into the file it names and collect that file's references
too, recursively. **Both call shapes, not one** — a `uses: ./path` naming a
composite action, *and* a `uses: ./.github/workflows/x.yml` naming a local
reusable workflow. The justification is identical, and it is the same one that
makes the sweep necessary at all: a composite's steps run inside the calling job,
and a called workflow runs on the permissions and secrets its caller passes it,
so the privilege the diff just granted reaches straight through either one.
Descending into composites alone is the mistake to avoid, because the shape it
skips is the one whose callee is a whole file of its own steps — the larger
blast radius, not the smaller. A local call is out of scope for *rewriting*
(below) while the third-party tags inside it are squarely in scope. Say in your
report that you swept the workflow and which callees you descended into.

Out of scope — do **not** rewrite these refs:

- **Local** (`uses: ./path`) references, for the *currency* lookup — there is no
  release major to resolve. Their contents are still swept above, and step 3's
  caller-privilege rule decides how the references inside them pin.
- **Docker** (`uses: docker://registry/image:tag`) references, for the *currency*
  lookup only. **Immutability still applies**, for exactly the reason it does to
  the reusable-workflow calls below: an image tag is mutable, repointing it runs
  attacker-chosen code with whatever the job holds, and C7 requires a pin for any
  third-party code in a job worth attacking. Pin the digest —
  `docker://registry/image@sha256:…` — with the tag in a trailing comment. What
  is excluded here is the release-major lookup, never the requirement that the
  ref cannot move.
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
  it currently resolves to, with the tag in a trailing comment.

  **Resolve the ref itself to a commit — not the workflow file's history.**
  `owner/repo/.github/workflows/x.yml@v1` selects the whole repository at
  whatever `v1` points to, and the workflow file is only read out of that tree.
  Its own last-touched commit is usually older, because unrelated commits land
  after a workflow is edited, and pinning to that older commit silently rewinds
  everything else in the tree the workflow depends on — the local composites it
  calls, the scripts it runs, the files it reads. The reference would still
  resolve and would still run, which is what makes this the wrong kind of
  mistake: a rollback that reports success. So resolve the tag or branch to its
  SHA, then confirm the workflow file exists at that SHA. The exclusion above is
  about *which lookup* is valid, not about whether the ref may move.
- Anything the profile's `## Exemptions` names.

### 2. Look up the current latest for each `owner/repo`

Do not guess. Resolve the real latest release:

- **Primary — WebFetch** `https://github.com/<owner>/<repo>/releases/latest`.
  GitHub redirects it to the latest release tag (e.g. `…/releases/tag/v7.0.1`);
  read the major from that tag. This works for any public action and does not
  depend on the session's repo scope.
- If the action publishes no releases, WebFetch
  `https://github.com/<owner>/<repo>/tags` and take the highest **stable**
  semver tag.
- **Alternative — GitHub MCP** `get_latest_release` (fall back to `list_tags`)
  when the tooling permits querying the action's repo. Note that a session's
  GitHub access may be scoped to the working repo only, in which case
  out-of-scope action repos are denied — use WebFetch then.

**Discard prereleases on either tag-listing path.** A tag carrying a
prerelease identifier — `v8.0.0-beta.1`, `-rc.2`, `-alpha` — outranks every
stable `v7.x` under semver ordering, so "highest semver tag" hands back the
unreleased next major and step 4 then reads a *stable* reference as out of date.
That is the one failure mode worse than staleness here: this skill exists to
bump references, so a wrong answer gets acted on rather than merely reported,
and it moves a workflow onto a major the publisher has not shipped. The
`releases/latest` path above is already safe — GitHub excludes prereleases from
it — which is exactly why the fallbacks need saying separately; only take a
prerelease if the project has said it wants one.

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

- **A job worth attacking gets the SHA, not the tag.** Decide by asking what an
  attacker gets if a reference in this job is repointed, rather than by matching
  a list. Four answers so far, and this enumeration has already been widened
  twice, so treat a fifth as likelier than the question being wrong:

  - **a credential** — a secret, or a write-scoped token;
  - **a host** — a self-hosted runner, where the code runs on a machine someone
    owns whatever token the job carries. `security-review`'s `ci-workflows`
    module is explicit that such code leaves files and processes behind for
    later jobs (C9.4) and that the host commonly reaches other infrastructure
    (C9.2). The host *is* the asset;
  - **private data the job can read** — a private checkout, a fetched dataset. A
    hosted job with no secret and a read-only token still hands over everything
    it cloned;
  - **an output something downstream trusts** — an artifact a later workflow
    publishes or deploys, an image pushed to a registry, a release asset.
    Substituting it reaches users through a path nobody reviews again.

  Only a job answering "nothing" to all four — public inputs, no credential,
  hosted runner, output nothing trusts — is safe on a moving tag.

  **`security-review`'s `ci-workflows` module → C7 is canonical for this
  predicate; the copy above is the follower.** It lives in both places for one
  reason: this skill has to decide how to pin when `security-review` is not
  vendored at all, and a skill that cannot answer its own central question
  without a sibling is not usable alone. So C7 is the file to change when the
  list learns a fifth asset, and this one follows in the same commit. If
  `security-review` *is* vendored here, read C7 and let it decide — and if the
  two ever disagree, that divergence is the finding, not something to
  split the difference on.

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
