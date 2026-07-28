# agent-skills

Portable [Claude Code skills](https://code.claude.com/docs/en/skills) for QA and
code review, written to work in any repository. Project-specific facts live in
the consumer repo, in a single overlay file, so the skills themselves stay
generic.

| Skill | What it does |
| --- | --- |
| `pr-preflight` | Pre-push QA gate: mechanical checks, self review, project checks, then push and open a draft PR |
| `code-review` | Reviews a local branch diff or an open PR, scoring findings for confidence and dropping the weak ones |
| `review-sweep` | Triages every review comment on open PRs to a terminal state, and knows when to stop |
| `action-versions` | Pins every GitHub Action reference to its current latest major, looked up rather than remembered |
| `security-review` | Security gate driven by the project's stated trust boundary, with per-stack reference modules |

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

The consumer writes no tooling code. It owns two files and one command.

1. Copy `templates/project-profile.md` to `.claude/project-profile.md` and fill
   it in. Read `docs/project-profile.md` for what each section does, and
   `examples/` for a complete real one.
2. Add `.claude/skills.json` naming the skills you want:

   ```json
   {
     "skills": ["action-versions", "code-review", "pr-preflight", "review-sweep"]
   }
   ```

   (`agent-skills list` prints what this version ships.)
3. Run the sync and commit both the vendored skills and the updated lock:

   ```sh
   npx -y github:cwinters8/agent-skills#v1 sync
   ```

   In a Node repo, wrap it as a script so the invocation lives in one place:

   ```json
   "scripts": {
     "skills:sync": "npx -y github:cwinters8/agent-skills#v1 sync"
   }
   ```

4. Validate the profile any time you edit it:

   ```sh
   npx -y github:cwinters8/agent-skills#v1 check-profile
   ```

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
