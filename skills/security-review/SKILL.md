---
name: security-review
description: >
  Security review gate. Run when a change touches the project's trust boundary —
  data authorization, auth and session handling, secrets, client data handling,
  CI and dependencies — and as a full sweep before any release or store
  submission. Use when asked to "security review", "check RLS", "can users touch
  each other's data", "audit auth", or "pre-launch security check".
---

# Security review

## The dividing line

Every project has one control that actually keeps one user's data away from
another's, and a pile of checks that merely keep honest users out of trouble.
The whole value of this skill is telling them apart.

> A control an attacker can remove from the path is a **correctness** control.
> A control they must go through is a **security** control.

Client-side guards — the session check before a write, the sign-out clear, the
disabled button — protect the honest user's own data from bugs. None of them
constrain someone who extracts the credentials from a shipped binary and calls
the API directly. When you weigh a finding, weigh it against the control the
attacker cannot bypass.

Which control that is, in this project, is stated in
`.claude/project-profile.md` → `## Threat model`. Read it first; it is what
lets this review rank findings by consequence instead of by category.

## Project profile

| Section | Used for |
| --- | --- |
| `## Threat model` | ranking findings; the one control that matters |
| `## Trust boundary` | which check groups a changed path triggers — **authoritative** |
| `## Stack` | which `references/` modules to load |
| `## Identity model` | auth flow, ownership key, redirect surfaces |
| `## Secrets policy` | which values are public by design |
| `## Probe policy` | whether authorization can be tested rather than only read |
| `## Release targets` | whether the release group applies |
| `## Dependencies` | which ecosystems exist and what is deliberately pinned, for group 5 |
| `## Known gaps` | findings already recorded, so they are reported as known rather than as new |

Load the `references/` modules `## Stack` names **before** working the groups.
Most add depth to one group, but a module can also change how a group should be
*read*, and a reviewer who meets it only from inside the group that happens to
cite it has already worked the others on the wrong definitions.

**Without a profile, this skill cannot do its job.** Run the `secrets` and
`supply-chain` groups over the diff, report every other group as *not
configured*, and say so in the first line of the report. A security review that
silently checks nothing reads exactly like one that found nothing, and that is
the worst possible failure of a gate.

## When to run

**Per-change.** Match each changed path against `## Trust boundary` and run the
groups its row names. Read that table itself — never a copy kept elsewhere. A
second copy drifts from the first, and the row it silently drops (a new
`process.env` read, a dependency bump) is the one that mattered.

Route by what the diff can *break*, not by which group a file nominally belongs
to. A profile's table usually encodes cross-group rows for exactly this reason:
a transport downgrade can arrive through a config file, a widened CI secret
through a workflow edit, an unconstrained new column through a schema migration
with no client change at all.

A docs-only diff needs none of this — say so and move on, because a gate that
runs on everything gets ignored. But **data is not automatically exempt**: if a
project's table routes a data file here, it is because values in that file flow
somewhere dangerous.

**Full sweep.** Every group, whole tree, ignoring the diff. Run one before a
first release, before any release that changes auth or schema, and whenever
asked for a security review with no specific change in hand.

**Don't lean on the built-in `security-review` skill.** It is a generic
source-diff scanner: it reads the code in front of it and knows nothing about
this project's trust boundary. It cannot tell that one policy file is the only
authorization control, that a "public" env prefix says nothing about whether a
value is safe, or that the deployed system may not match its committed
definitions. Running it as a first pass is fine; treating its silence as a pass
is not. This skill is the gate.

## Group 1 — Authorization

The question: **can one user read or modify another user's data?** Everything
else in this group serves that question.

1. **Find the enforcement point.** Name the specific server-side control that
   rejects a cross-account request. If the answer is "the client doesn't send
   that request", there is no authorization control.
2. **Every reachable surface is covered.** Enumerate what the shipped
   credentials can reach — tables, endpoints, functions, storage buckets — and
   confirm each is covered. Treat a new surface as reachable unless the grants
   or routes prove otherwise; defaults usually favor exposure.
3. **Evaluate the effective rule, not the presence of a keyword.** Rules
   compose: one permissive rule that matches everything defeats every careful
   sibling. Judge the combined expression for a given operation and caller role.
4. **Writes are constrained after the write, not just before.** The interesting
   attack is not reading someone else's row, it is *moving* a row into someone
   else's account by supplying their identifier. Confirm the new-row state is
   checked, not only the targeted row.
5. **Client-supplied ownership identifiers are untrusted input.** Never relax a
   rule on the grounds that the app always sends the right value.
6. **Bypass paths.** Views, functions, and materialized views frequently run
   with their owner's privileges and return rows the underlying policies would
   have refused. Check them whenever such an object is added.
7. **Deployed ≠ committed.** Reviewing the migration proves what *should* be
   true. Before a release, verify against the live system.
8. **Server-authoritative values stay server-side.** Ordering timestamps, audit
   fields, and anything used to resolve conflicts must be written by the server;
   a client that can forge them can overwrite newer data.

When `## Stack` names `postgres-rls`, read `references/postgres-rls.md` — it
carries the RLS-specific rules, the live audit queries, and the two-account
probe procedure, including the ways a probe passes while proving nothing.

Whether you may probe at all is `## Probe policy`. Reading policy definitions is
weaker evidence than testing them; when probing is forbidden, say in the report
that the authorization finding rests on reading definitions only.

## Group 2 — Authentication and session handling

1. **Credential-bearing callbacks.** Determine whether the auth flow puts real
   credentials in a URL. If it does, the channel carrying that URL matters
   enormously: a custom scheme is not tied to a domain the app proves it owns,
   and on Android any installed app may register the same scheme, so a hostile
   app that wins the race receives a working session. Prefer a flow where the
   callback carries a single-use code useless without a device-held verifier,
   over a verified deep link (App Links / universal links). Treat any change
   that *adds* token-bearing custom-scheme handling as a finding.
2. **Inbound URL handling is narrow.** A handler that parses every link the app
   opens will install a session from an unexpected one. Require a path and
   scheme check before any credential is accepted.
3. **Token storage at rest.** Plain app storage is readable on a compromised
   device and may land in backups. Platform keychain/keystore is the right home
   for refresh tokens; flag changes that widen what plain storage holds.
4. **Sign-out clears local state when, and only when, the session actually goes
   away.** Two failure modes sit on opposite sides, and a fix for one must not
   reintroduce the other:
   - *Leak:* the UI shows signed out and local data is cleared, but the session
     is still in storage, so the account is restored without re-authenticating —
     on a shared device the next person sees the previous person's data.
   - *Data loss:* local state holds edits that never reached the server, and
     sign-out wipes them even though the session — and therefore the only copy —
     is still there.

   Verify the **failure** path against the client library's actual behavior.
   Many SDKs report a failed sign-out by *returning* an error rather than
   throwing, and abort before removing the local session, so an implementation
   that ignores the return value runs its teardown regardless — producing both
   failure modes from one bug. Require: handle the returned error; when the
   session did not actually go away, preserve local data and surface the
   failure instead of presenting a signed-out UI over a live session; when it is
   confirmed gone, clear immediately. A check that only asks "is there a
   `catch`" or "does local state end up empty" passes code that gets either half
   wrong.
5. **Background workers re-check identity.** A worker that started under one
   account must not finish under another after a fast sign-out/sign-in. The
   server would reject the cross-account write, but locally reconciled state can
   still mix accounts — a correctness control with security consequences.
6. **Signup and rate-limiting posture is deliberate.** Whether an unknown
   address can create an account by signing in, OTP expiry, and email rate
   limits are decisions, not defaults. Some live in code and some only in a
   provider dashboard; `## Identity model` says which. A diff that changes the
   in-code half is a finding to catch by reading the diff.
7. **Redirect allowlist holds exact, owned callback URLs and nothing else.** The
   rule is the *shape*, not a fixed list: every entry is a full callback URL for
   a scheme this app registers or a domain it controls, with **no wildcards** and
   no third-party domain. A wildcard entry is an open redirect that hands tokens
   to an arbitrary target.

## Group 3 — Secrets and keys

1. **Verify the value, not the variable name.** A framework's "public" prefix
   only means *inline this into the bundle*; it validates nothing. A privileged
   key placed behind that prefix ships to every device and passes a naive
   "no secret in the diff" grep. Decode or classify the actual value — most
   credential formats are self-describing — and check it in **every** build
   environment, not just locally. Production is the one most likely to have been
   configured hastily.
2. **No privileged credential anywhere in the repo or client**, under any
   variable name.
3. **Env file hygiene** — ignored except an example file, and the example
   carries placeholders, never real values.
4. **CI secrets are scoped to the step that needs them** via a step-level `env:`
   — never a job-level one, which hands the value to every step in the job
   including dependency installation and any install script it runs. See
   `references/ci-workflows.md`.
5. **Anything reaching the client bundle is public**, including over-the-air
   update payloads. Treat every constant shipped to a device as readable.

## Group 4 — Client and data handling

1. **No credentials or PII in logs** on any path that survives into a release
   build — sessions, tokens, email addresses.
2. **Externally-sourced content is untrusted input.** Anything scraped,
   user-submitted, or machine-written into the repo must be rendered as inert
   content only — never used to build a URL that is fetched with elevated
   context, never evaluated, never handed to an embedded browser. Confirm the
   rendering path of every new field.
3. **Transport is TLS-only.** No plaintext endpoint, and no platform exception
   that disables transport security (iOS ATS exceptions, Android cleartext
   permissions).
4. **Validate at the boundary that enforces at runtime.** Static types vanish at
   runtime; the database constraint or server-side validator is the real one.
   A new synced field needs the same treatment as the ones already there.

## Group 5 — Supply chain and CI

1. **Dependencies.** Audit the full tree, not production-only — that is the
   shape. A development dependency still executes during install, build and
   typecheck in CI, the place where privileged tokens sit in the environment, so
   dev/prod is not the axis; **reachability** is. The *ranking* belongs to
   `ci-workflows` → C5 and is not restated here: which combination of answers
   makes a finding a blocker, and which downgrades it, is a severity call, and a
   second copy of it here would drift from the module until the generic group
   reported a blocker the loaded module had already downgraded. Read it there
   and say which question decided each finding. If `## Stack` does not name
   `ci-workflows`, report each advisory with its reachability answers and say
   the severity grading was unavailable — do not supply a bar of your own. An
   advisory you cannot answer on is reported as unknown, never as clean.

   `## Dependencies` names which manifests are authoritative, which ecosystems
   are in play, and what is deliberately pinned. **Without it**, discover
   manifests and lockfiles by scanning, audit what you find, and say two things
   in the report: which ecosystems you audited *by name*, and that a deliberate
   pin was indistinguishable from a forgotten one — an old version looks the
   same either way, so nothing here can call a pin stale. The failure this
   guards against is a scan that finds one manifest at the repo root, reports
   clean, and never sees the provider lockfile or the base image.
2. **Workflow permissions are least-privilege**, and `pull_request_target` with
   a checkout of the PR head is always worth flagging — it is the shape that
   runs fork-authored code inside the base repository's context. What that
   *costs* depends on the privilege the job actually holds, so the ranking
   belongs to `references/ci-workflows.md` → C3 and is not summarized here: a
   job that narrows `permissions:`, wires in no secret and runs hosted is a
   lower-severity finding than one holding a write-scoped token, and calling
   both a repository compromise is a false finding. If `## Stack` does not name
   `ci-workflows`, report the shape, say the privilege grading was not
   available, and do not assume the write-scoped case.
3. **Untrusted text interpolated into a command is code execution.** A CI
   expression substituted into a shell line before the shell parses it turns any
   attacker-controlled field — a PR title or body, a branch name, a comment, an
   author name — into shell syntax running as the runner. Bind it to an
   intermediate environment variable and reference it quoted. `ci-workflows` →
   C4 carries the platform detail.
4. **A runner the project owns is part of the trust boundary.** Where CI runs on
   self-hosted or otherwise persistent infrastructure rather than a disposable
   host, ask what can reach it, what it can reach, and what survives between
   jobs — fork-authored code reaching it, credentials it holds for other
   systems, inbound exposure, and state left behind for the next job.
   `ci-workflows` → C9 carries the platform detail and the severities.
5. **Code-generating and data-writing scripts.** A script that writes into the
   repo must write data, never executable content, and must fail loud rather
   than emit something partial. Trace untrusted values into every path join,
   filename, and generated import: a value that reaches a path join can escape
   its directory with `../`, and when that value travels in a data file the whole
   attack arrives as a data-only diff. Constrain such values at both ends —
   reject the shape on the way in, and verify containment before writing.
6. **Action pinning** — two properties that degrade differently, so say which
   one you ran. *Currency* (is the major current?) belongs to the
   `action-versions` skill; defer to it and don't duplicate it here. If it isn't
   vendored, report currency as unchecked rather than reconstructing the lookup:
   `ci-workflows` → C7 says why a bare latest-major check can prescribe a worse
   fix than the staleness it replaces. *Immutability* (can the ref move?) is the
   shape to look for here — third-party code a privileged job runs needs a ref
   that cannot be repointed, whatever `uses:` syntax names it. The ranking and
   the platform detail belong to `ci-workflows` → C7; if `## Stack` does not name
   it, report the movable refs, say the grading was not available, and do not
   assume the worst case.
7. **Release and update channel integrity.** A token that can publish code to
   already-installed clients — an over-the-air update token, a package registry
   token, a deploy key — is usually the highest-value secret a project holds,
   because it reaches users with no review in the way. Confirm it lives only in
   secret storage, is never echoed in logs, and that any channel repointing is
   deliberate and reverted after use.

## Group 6 — Release readiness

Applies when `## Release targets` names somewhere this ships. Read
`references/mobile-release.md` when the target is an app store. Generic core:

1. **Account deletion** wherever account creation exists — and deleting the
   server-side record is not the whole path; the local session and cached data
   must go too, or the deleted account's data stays on screen and bleeds into
   the next session.
2. **Data-collection disclosure is accurate per recipient.** Over-broad
   disclosure is its own compliance problem, not a safe default. Check the
   *deployed* configuration before naming a processor: a mail or analytics
   provider configured in a dashboard is a recipient even though it appears
   nowhere in the repo.
3. **A reachable privacy policy**, once accounts exist.
4. **Permissions are minimal** — including ones a dependency added
   transitively that nothing uses.
5. **Encryption declarations are accurate** for what the app actually does.

## Known gaps

Before reporting, read `## Known gaps`. A finding already recorded there is
reported as **known** with its recorded status — not as new. Two rules keep this
from becoming a way to bury things:

- A diff that **worsens** a known gap, or adds a second instance of it, is a new
  finding at full severity.
- A gap recorded as a launch blocker stays a launch blocker. "Known" is not
  "accepted" unless the profile says it was accepted, by whom, and why.

If this review produces a finding that will not be fixed in the same change,
add it to `## Known gaps` or to a tracked issue. A finding that lives only in a
merged PR description is a finding that has been lost.

## Severity and what blocks a release

| Severity | Meaning | Action |
| --- | --- | --- |
| **Critical** | Cross-account data access or modification; a shipped secret that bypasses the authorization control; remote code execution on user devices | Blocks the release. Fix before merge. |
| **High** | Account takeover path (token interception); a missing store- or platform-required control | Blocks the release. |
| **Medium** | Defense-in-depth gap with a precondition — unencrypted token storage, an over-broad log | Fix before launch; may merge with a tracking issue. |
| **Low** | Hardening with no known exploit path | Note it; don't block. |

Report findings with the file and line, the concrete attack (who does what, and
what they get), and the fix. "This could be unsafe" is not a finding — if
there's no path from an attacker to an outcome, say so and drop it. False
positives cost the gate its credibility.

State in the report which groups ran, which were skipped, and why. A skipped
group is information; an unmentioned one is a silent hole.

## Interaction with a project's deferral policy

Projects legitimately defer classes of work — a pre-launch project may decline
all migration and backward-compatibility concerns, and `## Not findings` records
that. **No such carve-out extends to security findings.** "No users yet" is a
reason a security bug is *cheap to fix now*, never a reason to defer it: the
blast radius is zero today and permanent after launch. If a finding is genuinely
about migrating old data shapes, decline it per the policy; if it is about the
trust boundary, it stands on its own merits.

## Relationship to the other skills

`pr-preflight` invokes this skill for diffs touching the trust boundary, the
same way it invokes `action-versions` for workflow diffs. `review-sweep`
prioritizes reviewer-raised security issues — when one arrives, run the relevant
group here rather than judging it ad hoc, and never decline it under a
project's deferral policy.
