# agent-skills

Portable [Claude Code skills](https://code.claude.com/docs/en/skills) for QA,
code review, and agent work on the user's machine, written to work in any
repository. Project-specific facts live in the consumer repo, in a single
overlay file, so the skills themselves stay generic.

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

Working on the user's machine:

| Skill | What it does |
| --- | --- |
| `apple-photos` | Queries, exports from and imports into Apple Photos with `osxphotos`, relayed through a terminal app that holds the macOS privacy grants |

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
against it.

Once you have adopted, pin the **full 40-character commit SHA** — not a tag. A
tag is a movable pointer, and this repo's own `ci-workflows` module exists partly
because of what happens when one moves: in March 2025 every tag of a widely-used
action was retroactively repointed at code that dumped CI secrets. The same
mechanism applies here — a repointed tag would vendor different skills into your
repo on the next routine sync, with nothing in your diff to show for it. A tag is
fine for *finding* the version you want; the object id is what you pin.
`skills-adopt` phase 1 resolves and verifies it, and records it where a later
bump can find it.

**Hand it to an agent.** Filling in the profile is the whole job, and it is
research: the answers have to come from the repo, not from a template. Paste
this into a session at the root of the repo you are adopting into.

> Adopt the shared Claude Code skills from `cwinters8/agent-skills` into this
> repository.
>
> 1. Run `npx -y github:cwinters8/agent-skills#main init` to scaffold
>    `.claude/skills.json` and a blank `.claude/project-profile.md`, and to
>    enable and install the superpowers plugin for this repo.
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

`#main` is right for the bootstrap specifically: nothing durable *that depends on
the ref* comes out of it — two scaffolded files you are about to rewrite — and
the pin that *is* durable gets chosen and verified in `skills-adopt` phase 1,
with the whole current feature set on disk to choose from. The superpowers entry
`init` adds to `.claude/settings.json` (below) does outlive the bootstrap, but it
names the plugin's own marketplace, not this package: the plugin version comes
from that marketplace whichever ref you pin later, so pinning an older ref
leaves nothing to reconcile. If you don't want it, pass `--no-superpowers` to the
bootstrap `init` or delete the entry before committing.

**Superpowers comes with `init` by default.** These skills own what lands in a
diff; [superpowers](https://github.com/obra/superpowers) owns how the session
gets there — planning, debugging, test-driving, verifying before claiming done.
So `init` adds `"superpowers@claude-plugins-official": true` to
`enabledPlugins` in `.claude/settings.json`, then runs
`claude plugin install superpowers@claude-plugins-official --scope project` to
install it on the machine running `init`.

Commit `.claude/settings.json`. That entry turns the plugin on for everyone who
runs Claude Code locally in the repo — terminal, desktop app, IDE — but cloud
sessions do not load plugins from a repository's settings at all, so agents
there run without superpowers. Locally, too, it does not download the plugin:
each collaborator runs the same `claude plugin install … --scope project` once,
and `init` prints it. If
`claude` is not on PATH, `init` still writes the entry and tells you to run the
install yourself. A machine that has never opened an interactive session has
not registered the official marketplace yet, so `init` runs
`claude plugin marketplace add anthropics/claude-plugins-official` first when
it is missing, and prints that step alongside the install command it hands
collaborators, since a fresh machine of theirs has the same gap. If
either command fails, `init` exits non-zero. The install step needs Claude Code
2.1.273 or later, because it verifies the marketplace's source through
`claude plugin marketplace list --json`; on anything older `init` refuses the
install, leaves your settings as they were, and says to run `claude update`.

It merges rather than scaffolds: an existing settings file keeps every other
key, and an existing `superpowers@…` entry — `false`, or an install from another
marketplace — is left exactly as found. A settings file that is not valid JSON,
or is a symlink, is not touched, and `init` exits non-zero to say so. An entry
that is not the official one set to `true` is not installed over either. Pass
`--no-superpowers` to skip both the settings entry and the install:

```sh
npx -y github:cwinters8/agent-skills#main init --no-superpowers
```

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
3. **Confirm the ref ships what these docs describe, and pin it.** The ref in
   your invocation is the only content pin, so a tag that has fallen behind this
   README hands you an older schema than the template you just copied — and the
   validator then rejects a section the template told you to write.
   `agent-skills list` plus a `check-profile` against the freshly-copied
   template surfaces the disagreement in one run. Pin the commit SHA it resolves
   to — per the rule above, a tag is not a pin — and record why in your rules
   source. Everything below uses that verified ref; `#main` appears only in the
   bootstrap, the one place you have no verified ref yet.

4. Run the sync and commit both the vendored skills and the updated lock:

   ```sh
   npx -y github:cwinters8/agent-skills#<verified-ref> sync
   ```

   Wrap it as a script so the invocation lives in one place. The rule for
   every invocation that outlives adoption is the same: **pin the verified ref,
   never `#main`.** A script, and the validation below, are *durable*
   invocations — they run again and again, so `#main` in one means the content
   can change between runs with no pin change in any diff, and an upstream
   schema change can invalidate your profile during a routine command nobody
   thought was an upgrade. Only the one-shot bootstrap gets `#main`, because
   there is no verified ref yet at that point; that is the whole difference.

   ```json
   "scripts": {
     "skills:sync": "npx -y github:cwinters8/agent-skills#<verified-ref> sync"
   }
   ```

5. Validate the profile any time you edit it — a recurring command, so it
   carries the pinned ref for the reason just given:

   ```sh
   npx -y github:cwinters8/agent-skills#<verified-ref> check-profile
   ```

6. **Set up superpowers, or decide not to.** `init` does this by default, so
   skipping it here should be a choice rather than an omission. To match `init`,
   install it at project scope — on a machine that has never opened an
   interactive Claude Code session, register the marketplace first — and commit
   the `.claude/settings.json` it writes:

   ```sh
   claude plugin marketplace add anthropics/claude-plugins-official
   claude plugin install superpowers@claude-plugins-official --scope project
   ```

   Collaborators run the same commands once on their own machines; the
   committed entry enables the plugin but downloads it for no one.

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
