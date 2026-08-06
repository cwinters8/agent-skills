---
name: dependency-refresh
description: >
  Update and audit a project's dependencies: find every manifest and lockfile,
  read the ecosystem's own advisories, and decide whether a bump is safe to
  take. Use when asked to "update dependencies", "bump dependencies", "check
  for vulnerable packages", "run npm audit", "are our deps out of date", or to
  respond to a "dependency advisory", and before a release whose tree has not
  been refreshed.
---

# Dependency refresh

## Where this sits

`action-versions` owns one narrow thing: a `uses: owner/repo@ref` line, pinned
to the action's current latest major. It stops at the workflow file. Everything
else a project pulls in from outside — packages, provider plugins, a tool
downloaded as a tarball, a container base image, a system package installed by a
setup script — arrives through this skill. If a change touches a `uses:` ref,
that is `action-versions`' call, not this one; if that skill isn't vendored
here, say so rather than pinning action refs from memory.

`security-review` → **Group 5 — Supply chain and CI**, item 1, states the
posture this skill executes. Read it there; it is not restated here, because a
second copy drifts and the sentence it drops is the one that mattered. If
`security-review` is not vendored, this skill still runs — note in the report
that the posture came from this skill alone. The consequence you act on: **a
development dependency still executes during install, build and test in CI**,
which is precisely where privileged tokens sit in the environment. So dev/prod
is not the axis.

## Project profile

| Section | Used for |
| --- | --- |
| `## Dependencies` | which manifests and lockfiles are authoritative, which ecosystems are in play, what is deliberately pinned and why, the update policy |
| `## Mechanical checks` | the commands that decide whether a bump actually works |

**Without `## Dependencies`,** discover what you can by scanning (below) and
run. What you cannot recover by scanning is *intent*: a version held two majors
back looks identical whether it is a deliberate pin protecting a migration
nobody wants to do yet, or a bump somebody forgot. Do not guess. Leave such a
pin alone and list it in the report as **unclassified**. A deliberate pin
quietly bumped is a regression wearing the costume of maintenance.

Without `## Mechanical checks`, run whatever checks you can discover, and say in
the report which ones those were and that they were not the project's stated
gate.

## Ranking: reachability, not dev/prod

For every advisory, answer three questions before assigning it any weight:

1. **Does it execute during install, build or test?** Install and post-install
   hooks run arbitrary code on every machine that installs, CI included.
2. **Does it reach users?** Bundled into a shipped artifact, baked into an
   image, published to a registry.
3. **Is the vulnerable path reachable at all** from how this project uses the
   package — a flaw in a code path nothing here calls is weaker than the score
   suggests, and saying so is part of the job.

A blocker needs **two** yeses, not one: the package runs in CI or reaches users
*and* the vulnerable path is reachable from how this project uses it. Question 3
is not a tiebreaker — a package that executes in CI through an entry point the
advisory does not touch is not a blocker, and calling it one because question 1
said yes makes question 3 decorative and every routine refresh a fight.

Downgrade in either direction and say which question did it: an advisory in a
package that never executes during install, build or test and never ships, or
one whose vulnerable path this project never calls. Note it, don't block on it,
and record the reasoning so the next refresh does not re-litigate it. Findings
you cannot rank — including "I could not tell whether we call that path" — get
reported as unknown, never as clean.

## Procedure

### 1. Derive the toolchain from the repo

Do not assume an ecosystem. Scan for manifests and lockfiles, and **identify the
package manager from the lockfile that is actually present**, not from what the
manifest implies or what the project used last time you looked. The lockfile is
what performs the install; a repo can carry a manifest one manager wrote and a
lockfile another one did, and only the lockfile tells you which resolution the
next install reproduces.

**A project usually has several ecosystems at once.** Expect to find more than
one of:

- an application or library manifest with its lockfile
- an infrastructure provider lockfile, which pins the provider plugins a
  manifest only constrains by range
- a tool pinned as a downloaded archive or binary with a recorded checksum
- container base images in image definitions or compose files
- system packages installed by a setup or provisioning script
- vendored copies of another repo's files, which have an upstream but no manager
  that will ever tell you they are behind

**Finding only the obvious one is the common failure of this skill.** The
manifest at the repo root gets audited, the provider lockfile and the base image
go unexamined for a year, and the report says "dependencies are current" —
which now reads as a clean result over a tree that was never looked at. Report
the ecosystems you found and audited, by name.

### 2. Ask each ecosystem, not your memory

Use that ecosystem's own audit and outdated commands. They read the advisory
database as it is today; a version or a CVE recalled from training is stale by
construction — the same reason `action-versions` refuses to trust a remembered
tag. Run them once per lockfile, including sub-projects and workspaces that
install separately, and prefer a machine-readable output flag where one exists
so counts are read rather than eyeballed.

For an ecosystem with no audit command, advisories come from the upstream's own
security advisories and release notes. Say in the report which ecosystems were
covered by a real audit tool and which by reading release notes, because those
are very different levels of assurance.

### 3. Treat a pin as a claim that must be verifiable

A pin is a promise that the bytes fetched next time are the bytes reviewed this
time. Two rules keep it true:

- **A pinned artifact fetched by URL needs two different things, and a hash is
  only one of them.** Hashing what you downloaded pins **reproducibility**: every
  later fetch is compared against the bytes reviewed this time, and a substitution
  after today fails loudly. It establishes no **authenticity** — if the artifact
  you fetched was already substituted, you have permanently pinned the attacker's
  hash, and every future verification passes. That is trust-on-first-use, and
  SLSA names it as such precisely because it is the weaker option.

  So: verify the first fetch against something the publisher **signed**, using
  whatever this ecosystem actually provides — a detached signature over the
  checksum file, a signing key the package manager already trusts, a build
  provenance attestation — and record the hash for reproducibility afterwards.
  Which of those exists is an ecosystem fact to look up, not a tool to assume;
  name the one you used in the report.
  Where the vendor publishes only a checksum on a web page, fetching that page
  over TLS and hashing the artifact yourself are two reads of the same trust
  root, so say in the report that the pin is TOFU rather than implying it was
  verified. Naming which of the two you got is the whole point; "we checksummed
  it" hides the difference.
- **For a package manager, the lockfile is the pin.** A range in a manifest is a
  statement of intent — two installs a week apart resolve differently and both
  satisfy it. A change that edits a range and leaves the lockfile alone has
  pinned nothing; a change that updates a lockfile is the real diff to review.

### 4. Separate the bump from the fix

A routine version bump and an advisory response are different changes and must
not travel together:

- **Batch routine bumps.** They share one review, one verification run, and one
  revert if the batch misbehaves.
- **An advisory fix ships on its own**, naming the advisory, the affected
  package and version range, and which of the three reachability questions made
  it a blocker.

Burying an advisory fix inside a batch of forty bumps is how it stops being
reviewed: the urgency, the blast radius and the review a human needs to give it
are all different, and a reviewer skimming a large batch diff will not find the
line that mattered. A major-version bump carrying a migration is its own change
for the same reason.

### 5. Verify with the project's own gate

Run every command in `## Mechanical checks` after the bump. **A dependency
change with no test run is a guess**: a lockfile diff tells you what resolved,
never whether the project still works. If that section says `none`, say so in
the report — the change is then resting entirely on review. Nothing here
substitutes a check the project did not state.

### 6. Ship it

Hand off to `pr-preflight`, which owns the push, the PR and the subscription to
its activity. If it isn't vendored here, say so and follow whatever the project
does to open a change, rather than inventing a gate. This skill describes one
refresh pass: do not arm a wake-up, a check-in or a recurring poll for the next
one — whether refreshes recur is the project's decision, configured once as a
scheduled routine.

## Report

State, every time:

- which ecosystems were found, and which were audited with a real audit tool
  versus read from release notes
- what was bumped, batched separately from any advisory fix
- every advisory downgraded by reachability, with the reason
- every pin you could not classify as deliberate or stale
- which checks ran, and any input that was missing and what was therefore
  skipped
