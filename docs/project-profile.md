# The project profile

Every skill in this repo is written to be project-agnostic. The facts that make a
review useful — what this codebase gets wrong, what must never be raised, what
the security boundary actually is — live in the consumer repo, in a single file:

```
.claude/project-profile.md
```

Skills read it by heading. `profile-schema.json` at the repo root is the
canonical heading list; this document explains each one, and
`templates/project-profile.md` is the blank you copy. `examples/` holds a real,
complete profile worth reading before you write your own.

## How to write one

- **State facts, not intentions.** "`pending` is derived as `version >
  syncedVersion`, never stored" is usable. "We care about sync correctness" is
  not.
- **Name paths and commands.** A skill acts on `utils/locker.ts` and
  `npm run typecheck`. It cannot act on "the sync layer".
- **Point at the rules source; do not restate it.** The profile says where the
  project's rules live. If you copy a rule into the profile, you now have two
  copies that will disagree, and the skills will believe the wrong one.
- **Keep it short.** A profile that has grown past a page or two is usually
  holding content that belongs in the rules source.
- **Omit rather than fake.** Every optional section has a defined fallback and
  the skill will say it ran without that input. A section filled with vague
  filler is worse: it reads as configured.

Run the validator after editing:

```sh
npx -y github:cwinters8/agent-skills#main check-profile
```

`sync` runs the same validation, so a normal sync catches profile problems too.
Which sections are required depends on the skills your `.claude/skills.json`
lists — a repo that doesn't vendor `security-review` is not asked for a threat
model.

**What the validator does not do is check whether anything here is true.** It
verifies that required headings exist, that no heading is unknown, and that no
placeholder survives. Every statement inside a section is prose it cannot test,
which is why a profile goes stale silently: a wrong one reads exactly like a
current one, and every skill downstream reports confidently from it. Two skills
exist for that. `skills-adopt` writes a profile from the repo in the first place,
and `profile-refresh` re-derives an existing one against the repo as it is now.
Both act on the profile as a whole, so they do not appear in the per-section
*Read by* lines below.

## Sections

Required sections must always be present. Sections marked *required with
`<skill>`* are required only when you vendor that skill.

### `## Rules source` — required

Read by `code-review`, `docs-currency`, `pr-preflight`, `review-sweep`.

The file holding this project's rules for agents, and any file that merely points
at it. Skills read this file to judge whether a change violates a stated rule, and
`pr-preflight` treats a diff that contradicts it as a failing check.

*Missing:* skills look for `AGENTS.md` then `CLAUDE.md` at the repo root and say
in their report that they guessed.

### `## Repo` — required

Read by `code-review`, `review-sweep`.

`owner/repo`, visibility, and the collaborator model. `code-review` builds
permalinks from `owner/repo`. The collaborator model matters because
`review-sweep` has a shortcut — inferring reviewer approval from a reaction-count
delta — that is only sound when the plausible reactors are known.

*Missing:* `owner/repo` comes from the git remote, and `review-sweep` requires an
`APPROVED` review rather than using the shortcut.

### `## Mechanical checks` — required

Read by `dependency-refresh`, `pr-preflight`, `review-sweep`.

The commands that must pass before a push, one per line, most important first.
Write `none` if the project has none — that is a real answer and skills handle it.

*Missing:* `pr-preflight` reports that it ran no mechanical gate, which is a
finding in itself.

### `## Derived docs` — optional

Read by `docs-currency`, `pr-preflight`.

A table of canonical file to the files that restate what it says. Docs currency
otherwise covers only the rules source, the profile, and the vendored skills —
the files that instruct an *agent*. This section is what extends it to the docs
that instruct a *person*: a README quoting a policy page, a setup checklist
quoting a config file.

Declaring the edge is the whole point. Without it, catching a stale copy means
re-reading every doc on every PR, which nobody does; with it, the check is a
grep over a named list.

Note which dependents a reader acts on outside the repo. Those rank first,
because a stale sentence followed into a store form, a published page, or a
signed submission becomes an external claim that no later PR retracts.

*Missing:* docs currency checks the rules source, the profile and the vendored
skills only, and a human-facing doc quoting a changed fact goes stale silently.

### `## Dependencies` — optional

Read by `dependency-refresh`, `security-review`.

Which manifests and lockfiles are authoritative, which ecosystems are in play,
what is deliberately pinned and why, and the project's update policy. Most repos
have more than one ecosystem — an application manifest, an infrastructure
provider lockfile, a tool pinned as a downloaded archive, container base images,
system packages a setup script installs — and the ones nobody lists are the ones
that go a year without being looked at.

The reasons for a pin are the part that cannot be recovered by scanning. A
version held two majors back looks the same in the tree whether it is protecting
a migration you don't want yet or was simply forgotten, so say which. This
section also informs `security-review`'s supply-chain group, which ranks
dependency findings by whether the package executes in CI or reaches users.

*Missing:* two skills lose input here, not one. `dependency-refresh` discovers
manifests by scanning, cannot tell a deliberate pin from a stale one, and says
so — reporting every pin it could not classify rather than bumping it. And
`security-review`'s supply-chain group loses what it ranks by: which packages
execute in CI or reach users, and whether a pin is held deliberately or was
forgotten. Omitting this section is close to free for a single-manifest project
with no security review; it is not free for one that vendors `security-review`,
which is the case the one-skill wording used to hide.

### `## Review focus` — optional

Read by `code-review`, `pr-preflight`.

This project's known failure modes: invariants that are easy to break, generated
files that must not be hand-edited, conventions a reviewer should weight heavily.
This is the section that turns a generic review into a useful one.

*Missing:* reviews run the generic passes only and flag nothing project-specific.

### `## Not findings` — optional

Read by `code-review`, `review-sweep`.

Classes of feedback this project never wants raised, each with the reason. This
is what lets a reviewer decline a recurring objection without re-arguing it every
time, and what stops `code-review` from generating the same noise.

*Missing:* only the skill's built-in not-findings list applies.

### `## Local skills` — optional

Read by `pr-preflight`.

Skills that live only in this repo and what each one gates, so a shared skill can
hand off to them. Write `none` if there are none. Name what the skill decides,
not how it works — the hand-off rule is that the local skill's own trigger list
is authoritative, never a copy kept here.

*Missing:* no hand-off; `pr-preflight` runs only the vendored skills.

### `## Exemptions` — optional

Read by `action-versions`, `code-review`, `pr-preflight`.

Carve-outs, each naming the skill it applies to and why. Use this for things that
look like a violation but are not — a CI system whose steps resemble GitHub
Actions but aren't, a directory whose contents are intentionally generated.

*Missing:* no carve-outs, so expect false positives wherever a project convention
diverges from the generic rule.

### `## Ship` — optional

Read by `pr-preflight`.

How this project pushes and opens PRs: branch naming, draft or not, which tooling
to use (some environments have no `gh` CLI), and what to do after opening.

*Missing:* push the branch and open a draft PR with whatever GitHub tooling the
session has.

### `## Threat model` — required with `security-review`

One paragraph: what ships to parties you do not control, and what the single real
control is that keeps one user out of another's data. This is the most important
section in the file, because it is what lets the skill rank findings by
consequence instead of by category.

Write it as a claim that could be wrong. "The anon key ships inside a public
binary, so row-level security is the only thing standing between one user and
another user's rows" tells a reviewer exactly which findings are critical and
which are merely correctness bugs.

*Missing:* `security-review` cannot rank findings by what actually matters here
and will say so.

### `## Trust boundary` — required with `security-review`

Read by `security-review`, `pr-preflight`.

A table of path glob to check groups. This is the authoritative trigger list: a
changed path matching a row runs that row's groups. The groups are:

| Group | Covers |
| --- | --- |
| `authorization` | who can read or write which rows; server-enforced policy |
| `auth-session` | login, tokens, session lifetime, redirect and deep-link surfaces |
| `secrets` | credential handling, what is public by design, what must never ship |
| `client-data` | what the client stores, logs, and renders; injection surfaces |
| `supply-chain` | dependencies, CI workflows, build and release scripts |
| `release` | store or registry submission requirements |

Keep this table in one place — here. A skill that carried its own copy would
drift from yours, and the row a stale copy drops is the one that mattered.

*Missing:* `security-review` runs `secrets` and `supply-chain` over the whole
diff and reports every other group as not configured.

### `## Stack` — required with `security-review`

Which reference modules apply, from `skills/security-review/references/`:

| Module | Load when |
| --- | --- |
| `postgres-rls` | Postgres with row-level security, including Supabase / PostgREST |
| `ci-workflows` | GitHub Actions |
| `mobile-release` | shipping to the App Store or Play |

List only what the project actually uses. Each module is depth about a stack, not
about your project; naming one you don't use produces checks that cannot pass.

*Missing:* no reference module loads and the review stays at the level of the
generic checks.

### `## Identity model` — optional

Read by `security-review`.

How a user proves who they are, what key rows are owned by, and every redirect or
deep-link surface that participates in auth. The deep-link surfaces matter more
than they look: they are the part an attacker can reach from outside the app.

*Missing:* the `auth-session` group reports as not configured.

### `## Secrets policy` — optional

Read by `security-review`, `code-review`, `pr-preflight`.

Which env prefixes are public by design, where real secrets live, and what must
never appear in a commit. State the trap explicitly if your framework has one:
a "public" prefix usually controls *visibility*, not *safety*, so a privileged
key placed behind that prefix ships to every user and passes a naive grep.

*Missing:* the `secrets` group flags only obvious credential patterns and cannot
tell a public key from a private one.

### `## Probe policy` — optional

Read by `security-review`.

Whether live cross-account probing is permitted, against which environment, with
which accounts, and what is off limits. Write `no live probing` to forbid it.

Probing is how an authorization claim gets *tested* rather than read. Without it
the skill can only report what the policies say, which is weaker evidence and
must be labeled as such.

*Missing:* no live probing, and authorization findings rest on reading policy
definitions only — which the report must state.

### `## Known gaps` — optional

Read by `security-review`.

Security findings already recorded, each with a status: **open** (real, not yet
fixed), **accepted** (a decision was made to live with it — say by whom and
why), or **launch blocker** (must be fixed before shipping). Write `none` when
there are none.

This exists so a review reports a known issue as known instead of re-discovering
it every time, which is what trains a reader to skim security reports. Two rules
keep it from becoming a place to bury things: a diff that *worsens* a known gap
is a new finding at full severity, and "known" is not "accepted" unless the entry
says it was accepted.

*Missing:* every recurring finding is re-reported as new on each review.

### `## Release targets` — optional

Read by `security-review`.

Where this project ships: app stores, a web deploy, a package registry, or none.
Drives the release-readiness group, which is otherwise skipped.

*Missing:* the `release` group is skipped and reported as skipped.
