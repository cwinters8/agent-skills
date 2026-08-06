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
against it. Pin something immutable once you have adopted: a tag when one ships
what you need, or a commit SHA meanwhile. `skills-adopt` phase 1 verifies
whichever ref you land on, and records it where a later bump can find it.

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
3. Run the sync and commit both the vendored skills and the updated lock:

   ```sh
   npx -y github:cwinters8/agent-skills#main sync
   ```

   Wrap it as a script so the invocation lives in one place — and **pin that one
   to the ref you verified below, never to `#main`.** A script is the *durable*
   invocation: every later sync runs whatever it names, so `#main` there means
   the content vendored can change from one sync to the next with no pin change
   in any diff, and an upstream schema change can invalidate your profile during
   a sync nobody thought was an upgrade. `#main` is for the one-shot bootstrap
   commands above, where you have no verified ref yet — that is the whole
   difference between the two.

   ```json
   "scripts": {
     "skills:sync": "npx -y github:cwinters8/agent-skills#<verified-ref> sync"
   }
   ```

4. Validate the profile any time you edit it:

   ```sh
   npx -y github:cwinters8/agent-skills#main check-profile
   ```

**Confirm the ref ships what these docs describe.** The ref in your invocation is
the only content pin, so a tag that has fallen behind this README hands you an
older schema than the template you just copied — and the validator then rejects a
section the template told you to write. `agent-skills list` plus a
`check-profile` against a freshly-copied template surfaces the disagreement in
one run. When a tag has drifted, pin a commit instead and record why in your
rules source.

## The version you invoke is the version you vendor

The skills ship **inside this package**, so `sync` copies from the version you
ran — there is no clone, no network beyond fetching the package, and **no second
pin**. The ref in your npx invocation is the only thing that decides which skills
you get.

That is why `.claude/skills.json` has no `ref`, `source`, or `commit` field. An
earlier design had one, and it could silently disagree with the invocation:
bumping the ignored pin looked exactly like an upstream with no changes. The tool
now refuses to run if it finds one of those fields, rather than ignoring it.

`.claude/skills.json` is therefore config plus lock: you write `skills`, and the
tool writes `version` (what produced the current copies) and `files` (a hash per
vendored file, so a hand-edit is detectable).

## Updating

Bump the ref in your invocation — `#v2`, or a tag, or a commit SHA — re-run the
sync, and commit the diff. Run `sync --check` in CI to be told when a vendored
copy has fallen behind the version you invoke, or has been hand-edited.

## Editing a skill

Skills are edited **here**, never in a consumer's `.claude/skills/` — a
hand-edit there is silently overwritten by the next sync and is invisible to
every other repo. If the change is project-specific, it belongs in that
project's profile instead.

See `AGENTS.md` for the conventions these skills are written to.
