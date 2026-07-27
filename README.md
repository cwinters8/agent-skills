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
own `.claude/skills/` and commits them. That is deliberate:

- Skills must be available on a session's **first turn**, before any hook or
  fetch has run.
- A change to your review tooling should be **reviewable** — committed skills
  show up in a PR diff; fetched ones never do.
- No runtime dependency: committed skills work offline, during a GitHub outage,
  and in scheduled runs.

The cost is that an update is a sync plus a PR in each consumer. The sync script
makes that a one-liner and detects drift.

## Adopting in a new repo

1. Copy `templates/project-profile.md` to `.claude/project-profile.md` and fill
   it in. Read `docs/project-profile.md` for what each section does, and
   `examples/` for a complete real one.
2. Add `.claude/skills.json` naming the skills you want:

   ```json
   {
     "source": "https://github.com/cwinters8/agent-skills",
     "ref": "main",
     "skills": ["action-versions", "code-review", "pr-preflight", "review-sweep"]
   }
   ```

3. Copy a sync script into the repo (see `scripts/sync-skills.mjs` in any
   consumer, e.g. [`cwinters8/sprite-locker`](https://github.com/cwinters8/sprite-locker)).
   It shallow-clones this repo at `ref`, copies the named skill directories into
   `.claude/skills/`, validates your profile, and records the resolved commit.
4. Run it, then commit both the vendored skills and the updated lock.
5. Validate the profile any time you edit it:

   ```sh
   node scripts/check-profile.mjs .claude/project-profile.md --skills=code-review,pr-preflight
   ```

## Updating

Bump `ref` in `.claude/skills.json` (or leave it on `main`), re-run the sync, and
commit the diff. Run the sync with `--check` in CI to be told when a vendored
copy has fallen behind or been hand-edited.

## Editing a skill

Skills are edited **here**, never in a consumer's `.claude/skills/` — a
hand-edit there is silently overwritten by the next sync and is invisible to
every other repo. If the change is project-specific, it belongs in that
project's profile instead.

See `AGENTS.md` for the conventions these skills are written to.
