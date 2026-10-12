# Project profile

The profile for the repo that publishes the shared skills. The skills a session
runs here come from the maintainer's user-level install (symlinks into this
clone, made by `agent-skills link`), not from a vendored copy, so this repo
deliberately has no `.claude/skills.json` and no `.claude/skills/` — `init`
would vendor a second copy of `skills/` beside the real one, and every edit
would then review itself against a stale version.

AGENTS.md remains this project's single source of truth. Where this file
summarizes it, AGENTS.md wins on any disagreement.

## Rules source

`AGENTS.md` at the repo root. `CLAUDE.md` is a pointer that `@`-imports it and
holds no rules of its own. `## Session behavior` in AGENTS.md overrides harness
defaults rather than adding to them.

## Repo

`cwinters8/agent-skills` — **public**, single maintainer. Because the repo is
public, anyone can react on a PR, so `review-sweep`'s reaction-count approval
shortcut is **not** permitted here: require an `APPROVED` review, or report the
PR as blocked on a reviewer verdict.

## Mechanical checks

- The leak grep from AGENTS.md → "The one rule". Any hit in a `SKILL.md` is a
  defect; hits under `skills/security-review/references/` need judgment.

  ```sh
  grep -rniE '\b(sprite|locker|supabase|postgrest|expo|eas|cwinters8|nordvpn|tinyproxy|hostinger|digitalocean|droplet|doppler|opentofu)\b' \
    skills/ --include=SKILL.md --exclude-dir=skills-adopt
  ```

- `node --check bin/agent-skills.mjs` — syntax.
- `node --test` — the CLI's tests under `test/`, which run it as a subprocess
  against throwaway directories. They cover `link` only so far; `sync`, `init`
  and `check-profile` have none yet (#14), so a change to those still rests on
  reading it.
- `node -e 'JSON.parse(require("fs").readFileSync("profile-schema.json","utf8"))'`
  when `profile-schema.json` changed.

There is no CI (no `.github/workflows`) and no `scripts` in `package.json`; these
are the whole gate, and the session runs them by hand.

## Derived docs

| Canonical | Restated in |
| --- | --- |
| `profile-schema.json` — the section list | `docs/project-profile.md`, `templates/project-profile.md` (canonical order), the skill that reads each section |
| `bin/agent-skills.mjs` — CLI commands and flags | its own header comment, `README.md`, `skills/skills-adopt/SKILL.md` |
| `skills/security-review/references/<module>.md` | the check group in `skills/security-review/SKILL.md` that cites it |
| `AGENTS.md` | this profile, wherever it summarizes rather than points |

`README.md` and `docs/project-profile.md` rank first: consumers read them off
this repo and act on them in their own, so a stale flag or section name there
becomes a broken adoption no later PR here retracts. AGENTS.md → "Adding or
changing a section of the profile" and "A module and the group that cites it are
one rule in two files" are the authoritative versions of the first and third
rows.

## Dependencies

None at runtime. `package.json` has no `dependencies` or `devDependencies`, no
lockfile, and the CLI imports only `node:` built-ins; `engines.node >= 18` is
the only constraint. Adding any dependency changes what every consumer's `npx`
pulls, so treat it as a supply-chain change, not a convenience.

## Review focus

- **The one rule** — no skill may name a specific project, path, command or
  vendor outside a stack-scoped `references/` module. The grep catches the known
  names; review catches the new ones, and a new consumer's vendor terms belong in
  the grep's alternation in the same change.
- **Version bump** — any change under `skills/` (or anything else consumers
  receive) bumps `version` in `package.json`, or a consumer's `sync --check`
  reports no change.
- **`files` in `package.json`** — a new top-level directory consumers need must
  be listed there, or it does not exist in the installed package.
- **Schema changes move four files together** — `profile-schema.json`,
  `docs/project-profile.md`, `templates/project-profile.md`, and the reading
  skill. Renaming or removing a heading breaks every consumer's profile at its
  next sync; prefer an additive optional section.
- **Keep the reasoning** — these skills are long on purpose. A diff that
  compresses a rule to its conclusion, or drops the "why", is a regression even
  when the rule survives.
- **Hand-off verbs** — a step that delegates says run / invoke / hand off to /
  defer to plus the backticked skill name, and a skill tolerates the named skill
  being absent. A bare mention must not use those verbs.
- **No schedules** — no skill may describe arming a wake-up, self check-in or
  recurring poll; where a skill subscribes, subscribing is the mechanism.
- **Every skill states its no-profile behavior** — which inputs were missing and
  what was skipped, never a silent generic pass.

## Not findings

- **Skill length.** Long skill files encoding why each check exists are the
  design, not bloat (AGENTS.md → "Keep the reasoning"). Don't suggest
  condensing them.
- **`cwinters8` inside `skills/skills-adopt/`.** That skill is the package
  identifying itself; the grep excludes the directory for this reason.
- **Missing CI.** There is deliberately no workflow; the mechanical checks above
  are the gate, run by hand.
- **No tests for `sync`, `init` or `check-profile`.** Known and tracked in #14.
  It is a finding only on a change that adds behavior to those commands without
  a test, now that a harness exists to put one in.
- **No `.claude/skills.json` or vendored skills in this repo.** Deliberate — see
  the note at the top of this file.

## Local skills

none

## Exemptions

- `code-review`, `docs-currency`: `examples/project-profile.sprite-locker.md` is
  a real consumer's profile kept as an example and names that project
  throughout. That is its purpose; it is not a leak, and it is not shipped
  (`examples/` is not in `files`).

## Ship

Branches are `claude/<topic>`. Push, open a **draft** PR against `main`, call
`subscribe_pr_activity`, and end the turn. Per AGENTS.md → "Session behavior":
never schedule a wake-up, self check-in or recurring poll; ask first if one is
genuinely needed. Commit messages say when a change requires consumers to update
their profile.

## Threat model

What ships to parties we don't control is the package: skill text that agents
in consumer repos follow with those repos' permissions, and a CLI that consumers
run via `npx` and that writes into their `.claude/`. A malicious or careless
change here becomes instructions executed in every consumer session after its
next sync — exfiltrating secrets, pushing, or weakening a review gate. The single
real control is that only the maintainer can push to this repo, and consumers
pin a ref they have read through the `sync` diff before committing it. Anything
that makes a skill change land without appearing in that diff, or lets the CLI
write outside `.claude/`, defeats the control.

One deliberate exception: `init` (unless `--no-superpowers`) runs Claude Code's
own `claude plugin marketplace add` and `claude plugin install` with constant
arguments, which change the adopter's user-level plugin state outside the repo.
That happens on the bootstrap run at `#main`, before any `sync` diff has been
read, so the control above does not cover it. The marketplace-source check and
the fixed plugin ID are what bound it instead. A change that makes those
arguments variable, installs anything else, or weakens the source check widens
what an unread ref can do on an adopter's machine. Review it as a supply-chain
change.

A second exception: `link` writes outside the repo, into the user's Claude config
directory. It is not a consumer path. It refuses to run from anything but a git
checkout, so the `npx` copy a consumer runs cannot use it. It creates and removes
only symlinks, and removes only those pointing into the running checkout's
`skills/`. What it does change is *when* skill text takes effect. Every session
on that machine follows the clone's working tree, with no `sync` diff in
between, so checking out an unreviewed branch (a contributor's PR, say) makes its
skills live everywhere at once. A change that lets `link` run from a non-checkout,
write anything but those links, or delete anything else widens the first half.

## Trust boundary

| Path | Groups |
| --- | --- |
| `skills/**` | supply-chain, secrets |
| `bin/**` | supply-chain, client-data |
| `package.json` | supply-chain, release |
| `templates/**`, `profile-schema.json` | supply-chain |

## Stack

none — this repo has no workflows, database, mobile release or infrastructure,
so no reference module applies to it. (It *authors* those modules; reviewing
their content is `## Review focus`, not a security-review stack.)

## Release targets

No registry publish. Consumers install from GitHub via
`npx -y github:cwinters8/agent-skills#<ref>`, so every pushed commit on `main`
is a release candidate and `version` in `package.json` is the release marker.
