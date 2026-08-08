# Project profile

<!--
  Copy this file to .claude/project-profile.md in your repo and fill it in.

  Shared skills read this file by heading. Keep the headings exactly as written;
  the validator rejects renamed or unknown ones. Delete each HTML comment as you
  write that section, so an unfinished profile stays visibly unfinished.

  Every "TODO" below must be replaced — the validator fails while any remain.
  A section you genuinely don't need can be deleted outright if it is optional;
  see docs/project-profile.md in cwinters8/agent-skills for what each fallback
  costs you.

  Validate with:
    npx -y github:cwinters8/agent-skills#<verified-ref> check-profile
-->

## Rules source

<!-- REQUIRED. The file holding this project's rules for agents, plus any file
     that just points at it. Skills read it to judge whether a diff breaks a
     stated rule. -->

TODO

## Repo

<!-- REQUIRED. owner/repo, visibility, and the collaborator model. The
     collaborator model decides whether review-sweep may infer approval from a
     reaction-count delta or must require an APPROVED review. -->

TODO

## Mechanical checks

<!-- REQUIRED. Commands that must pass before a push, one per line, most
     important first. "none" is a real answer. -->

TODO

## Derived docs

<!-- Canonical file -> the files that restate what it says, so a changed fact
     can be traced to every copy of it. Without this, docs currency covers only
     the files that instruct an agent (the rules source, this profile, the
     vendored skills) and never the ones that instruct a person.

     | Canonical | Restated in |
     | --- | --- |
     | `docs/privacy.md` | `README.md`, `SETUP.md` (store-submission steps) |

     Say which dependents a reader acts on outside the repo — a form, a store
     submission, a published page. Those rank first: a stale sentence followed
     off-repo becomes a claim no later PR retracts. "none" if no doc restates
     another. -->

TODO

## Dependencies

<!-- Which manifests and lockfiles are authoritative, which ecosystems are in
     play, what is deliberately pinned and why, and the update policy. List
     every ecosystem, not just the obvious one: an application manifest, an
     infrastructure provider lockfile, a tool pinned as a downloaded archive,
     container base images, system packages a setup script installs.

     The "why" behind a pin is the part scanning cannot recover — a version held
     back deliberately looks exactly like one that was forgotten. Without it a
     refresh leaves those pins alone and reports them as unclassified. -->

TODO

## Review focus

<!-- This project's known failure modes: invariants that are easy to break,
     generated files that must not be hand-edited, conventions to weight
     heavily. This section is what makes a review project-specific. -->

TODO

## Not findings

<!-- Feedback this project never wants raised, each with its reason. This is
     what lets a reviewer decline a recurring objection without re-arguing it. -->

TODO

## Local skills

<!-- Skills that live only in this repo and what each one gates, so a shared
     skill can hand off. "none" if there are none. Name what the skill decides;
     its own trigger list stays authoritative. -->

TODO

## Exemptions

<!-- Carve-outs, each naming the skill it applies to and why. For things that
     look like a violation but aren't. -->

TODO

## Ship

<!-- How this project pushes and opens PRs: branch naming, draft or not, which
     tooling (some environments have no gh CLI), what to do after opening. -->

TODO

## Threat model

<!-- REQUIRED IF YOU VENDOR security-review. One paragraph: what ships to
     parties you don't control, and the single real control keeping one user out
     of another's data. Write it as a claim that could be wrong — it is what
     ranks findings by consequence instead of by category. -->

TODO

## Trust boundary

<!-- REQUIRED IF YOU VENDOR security-review. Path glob -> check groups. This is
     the authoritative trigger list. Groups: authorization, auth-session,
     secrets, client-data, supply-chain, release.

     | Path | Groups |
     | --- | --- |
     | `db/**` | authorization |
     | `.github/workflows/**` | supply-chain |
-->

TODO

## Stack

<!-- REQUIRED IF YOU VENDOR security-review. Which reference modules apply:
     postgres-rls, ci-workflows, mobile-release, infra-provisioning,
     cloud-network, config-as-code. List only what you actually use — naming one
     you don't produces checks that cannot pass. -->

TODO

## Identity model

<!-- How a user proves who they are, what key rows are owned by, and every
     redirect or deep-link surface participating in auth. -->

TODO

## Secrets policy

<!-- Which env prefixes are public by design, where real secrets live, what must
     never be committed. State the visibility-vs-safety trap if your framework
     has one. -->

TODO

## Probe policy

<!-- Whether live cross-account probing is permitted, against which environment,
     with which accounts, and what is off limits. "no live probing" forbids it —
     findings then rest on reading policy definitions, which the report says. -->

TODO

## Known gaps

<!-- Security findings already recorded, each with a status: open, accepted (say
     by whom and why), or launch blocker. "none" if there are none. A review
     reports these as known instead of re-discovering them; a diff that worsens
     one is still a new finding. -->

TODO

## Release targets

<!-- Where this ships: app stores, a web deploy, a package registry, or none. -->

TODO
