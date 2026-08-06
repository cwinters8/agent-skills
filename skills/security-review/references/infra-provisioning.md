# Infrastructure provisioning

Load this when `## Stack` names `infra-provisioning`. It covers repositories
whose product is a **configured machine** rather than an application: imperative
shell run as root, configuration management (Ansible and peers),
infrastructure-as-code (Terraform/OpenTofu and peers), and the cloud-firewall and
secrets surfaces those touch.

Such repos usually start as one shell script and grow into two declarative
layers. All three shapes appear below, because the failures survive the
migration — a rendered template leaks exactly the credential the `sed` leaked,
and a provider-managed firewall strands an operator exactly the way `ufw` did.
The blast radius is a machine: a wrong branch locks the maintainer out of the
only host, writes a credential world-readable, or prints one into a CI job log.

## Reading the six groups for infrastructure

The group names in `SKILL.md` assume an application with user accounts. They map
onto a machine, but not obviously, and a consumer should not have to invent the
mapping in their own `## Trust boundary` table:

| Group | On a machine |
| --- | --- |
| `authorization` | who can do what **on the box** — which accounts exist, sudo policy, group membership, what identity each service runs as |
| `auth-session` | how an operator or client **proves it may connect** — SSH keys and the `authorized_keys` lines granting them, service credentials, and the firewall and routing ordering that decides whether the port is reachable at all |
| `secrets` | provider and vendor tokens, and where each lives at rest |
| `client-data` | what the code **writes to disk on the target**, at what mode, and what it **prints** to an operator's terminal or a CI job log |
| `supply-chain` | what the run downloads and executes as root, plus the CI that runs the provisioning — see `references/ci-workflows.md` |
| `release` | usually not applicable. A rebuild is the release; `## Release targets` is normally empty for this stack |

Reachability belongs in `auth-session` rather than a category of its own: on a
machine the firewall **is** an authentication surface, since the rule naming
which sources may reach port 22 decides who may attempt a key exchange at all.

## Imperative shell run as root

**S1. An unquoted expansion is a privilege bug, not a style nit.** These scripts
run as root, so a path built from an unvalidated variable, a word-splitting
expansion, or an `rm -rf "$dir/"` where `$dir` can be empty is arbitrary
root-level damage from a caller-controlled value. Ask of every new variable: who
sets it, and where does it land — a path, a command, a config line, a regex?
Require `set -euo pipefail` and a shell linter in the mechanical checks.

**S2. A remote installer piped to a shell as root is usually the repo's largest
supply-chain surface.** `sh <(curl … install.sh)` and `curl … | sh` execute
whatever that URL serves at that moment — unpinned, unverified, recorded nowhere
in the repo, unconstrained by last week's audit. Be honest that this is
frequently the vendor's own documented path: the finding is not carelessness, it
is that the path has no integrity check when a better one usually exists. In
descending order of preference:

1. **The vendor's signed package repository**, key fetched to a keyring and the
   repository entry pinned to it (`signed_by`). The package manager then verifies
   every future upgrade too, which no one-shot download does.
2. **A pinned release artifact with a recorded checksum**, verified by the
   fetching step itself rather than by a later call a `|| true` could swallow.
   Version and digest live together and move together.
3. **A source checkout at a pinned ref**, where the vendor supports it.

Rewriting `curl | sh` as "download to a file, then run the file" fixes nothing —
the same bytes still execute. It becomes a fix only when a checksum or signature
gates the execution.

**S3. Code that writes a credential owns that file's mode.** Inheriting the
distro package's default is the quiet miss. Watch for the script that is
scrupulous about modes it is used to thinking about and silent about the new one:
a sudoers drop-in at `0440`, an `authorized_keys` at `0600`, and in the same
script a service config now carrying a plaintext password left at whatever the
package shipped — frequently world-readable to every local account. State owner,
group and mode at the point of writing. Where a daemon reads its config as root
before dropping privileges, `0640 root:<svcgroup>` costs nothing operationally.

**S4. Every secret travels three paths; walk all three for each new one.**

- **Printed.** A summary line reaches the operator's terminal *and*, from CI,
  that job's log, under whatever retention and visibility that repo has. Give the
  printing a switch and have the unattended caller set it off.
- **Written.** Which file, at what mode, owned by whom (S3), and whether a later
  step rewrites it and resets the mode.
- **Passed as a process argument.** Anything on `argv` is visible in `/proc` to
  any local user for the life of the call. Some vendor CLIs accept a token only
  as a flag, so the exposure may be unavoidable — record it as a known limitation
  rather than leaving a reader to find it. Where a tool reads stdin, use it:
  piping a password into the account-update command instead of passing it as an
  argument removes the exposure in one line, and a script that does this for one
  credential but not another has an inconsistency worth flagging.

**S5. A generated-and-printed secret is not reproducible.** A script that invents
a password when the input is unset, prints it once and stores it nowhere has
produced a value existing only in terminal scrollback: it cannot be rotated
(nothing knows the current one), re-derived, or recovered once the window closes.
Requiring it as an input from wherever the project keeps secrets is the fix; the
convenience lost is smaller than the recovery problem created.

**S6. Validate before installing, never after.** Sudoers is the sharpest case: an
invalid file already in `/etc/sudoers.d` can break privilege escalation for every
account, and fixing it needs the privilege it just destroyed. `visudo -cf` is the
right check, but running it *after* `cat > /etc/sudoers.d/…` only reports what you
have already done — and `|| die` there exits leaving the broken file in place.
Render to a temporary file, validate that, install only on success.
Configuration-management tools expose this directly (a `validate:` argument run
against the staged file); imperative scripts must do it by hand and often don't.
Same shape for anything whose breakage denies access: SSH daemon config
(`sshd -t`), firewall rules, PAM.

**S7. Regex surgery means the repo never states what the file should be.** A
replace-or-append helper plus a few one-off `sed` calls — comment these lines out,
append that directive if absent, delete and re-add the credential line — leaves
the on-disk result a function of whatever the package shipped and every previous
run. There is no drift detection, because there is nothing to compare against,
and no reviewer can see the end state without building a box. A template
rendering the whole file makes the end state reviewable, makes drift a diff, and
makes a value the repo no longer sets actually disappear rather than linger.

The pattern also carries a direct injection bug: a value interpolated into a
`sed` expression is code, not data. The substitution delimiter ends the
replacement early, `&` expands to the whole match, a backslash changes the
expression's meaning — so a password containing any of those silently corrupts
the file it was meant to configure, and a password is the value most likely to
contain them.

**S8. Reject credential shapes the config format cannot carry.** A
space-delimited directive (the classic `BasicAuth <user> <password>` form) does
not mis-parse loudly when the password contains a space; it mis-parses silently,
the service starts fine, and every login fails. Same class: newlines, and quoting
characters in formats with no escaping. Validate the shape at the boundary with a
message naming the reason — it is cheap, and it is the only place the constraint
can be enforced, because the format cannot express it.

## Ordering is a security property

**O1. Allowlist the inbound paths before anything captures reachability.** Any
step that changes how the machine can be reached — enabling a host firewall,
connecting a VPN client whose kill switch captures the default route, restarting
the SSH daemon under new config, changing the bind address — must have SSH, the
out-of-band shell (mosh or equivalent) and any service port permitted *before* it
takes effect. Reordering those strands the operator on a box reachable only
through the provider console, mid-run, with the configuration half applied.

A VPN client's port allowlist is **not** a firewall even though it reads like
one: it tells the tunnel's routing to let those ports keep using the real
interface so their return path works. It permits nothing the actual firewall
denies, and both must allow traffic for any to arrive. A review conflating them
will either report a hole that does not exist or miss the one that does.

**O2. A safety property that cannot be established is fatal, not a warning.**
Kill switches, egress verification, the tunnel technology actually in effect,
autoconnect-on-boot, detection of a genuinely reachable public address: each
either holds or the run did not succeed. `die`, not `warn`.

The reason is the caller. Unattended runs key off the exit status, so a script
printing "Setup complete" over a control it could not verify is worse than one
that fails — it converts a loud failure into a silent false belief. `|| true`
belongs on cosmetics (suppressing a first-run consent prompt, a best-effort
analytics opt-out) and never on a control the posture depends on. Proceeding
without a control is an explicit input (`enable_killswitch=false`), not a
swallowed error.

## Cloud firewalls and network controls

**N1. Some providers' firewalls default-deny outbound.** Attaching one with only
inbound rules kills all egress — no DNS, no package installation, no tunnel — and
every later step then fails confusingly. On those providers a permissive outbound
rule is **load-bearing, not laziness**, and a reviewer who "tightens" it as an
easy hardening win breaks the box. Establish the provider's default and what the
host is for before flagging allow-all egress, and leave the reasoning in a
comment beside the rule so the next reviewer does not re-litigate it.

**N2. A private network or VPC is not an ingress control.** It provides private
addressing and filters nothing; on most providers every instance already sits in
one by default. The security-group analogue is the firewall. "It's only on the
private network" is an argument about *routing* — real, since traffic between
instances then avoids the public internet — never an argument that a port is
protected.

**N3. Just-in-time firewall rules fail open.** The pattern is a CI job opening
its own runner's address at start and closing it in an always-run final step. Two
independent failures:

- The closing step does not survive a killed runner, an evicted or cancelled job,
  or a crash in the harness. `if: always()` is a scheduler courtesy, not a
  guarantee.
- Provider rules usually carry **no timestamp**, so "expire anything older than N
  minutes" is inexpressible. A leaked rule is therefore permanent *and* invisible
  — nothing distinguishes it from a deliberate one, and nothing removes it
  without a purpose-built reaper that is itself another privileged job.

What leaks is SSH open to an address the project does not control, forever.
Prefer a **stable identity**: a long-lived runner carrying a provider tag, and one
static rule whose source is that tag. That removes the IP detection, the reaper,
and — worth stating explicitly — the cloud-provider API token from CI entirely,
since no job needs to mutate infrastructure any more. The tag then **is** a
credential: anything wearing it gets in. Say so where it is defined, and never
reuse it for unrelated instances.

**N4. Where an address genuinely must be discovered, read it from the interface,
not from an outbound request.** With a kill switch on, an outbound "what is my
IP" request reports the *tunnel's* exit rather than the host's own address, so
pinning a firewall or publishing an endpoint on that value is silently wrong.
Then assert the answer is externally routable: a loopback, RFC1918 or CGNAT
result means provider NAT, and publishing it as an endpoint is worse than
failing (O2).

**N5. Pinning ingress to a single egress IP couples reachability to a client
staying connected.** Restricting SSH to one VPN dedicated address is a strong
control and a real operational dependency: every client, phone included, reaches
the box only while that VPN is up, and a change of that address locks everyone
out until the infrastructure layer is applied from elsewhere. Legitimate, but it
has to be deliberate, and documented alongside the out-of-band recovery path (a
provider console that does not use SSH and is unaffected by the firewall) and the
credential that console needs. A break-glass path requiring a password nobody
ever set is not a break-glass path.

## Configuration management and infrastructure-as-code

**D1. YAML 1.1 coerces bare `off`, `on`, `yes`, `no` to booleans.** An unquoted
`off` in a command's argument list becomes `False` and reaches the tool as the
literal string `"False"` — a silently different command, usually one that fails
unread or, worse, no-ops. This is exactly the class a linter catches and human
review does not: the diff reads correctly in English. Require a YAML linter among
the project's mechanical checks, and note its `truthy` rule usually needs
configuring rather than disabling, since some ecosystems use bare `yes`/`no`
idiomatically for their own keys.

**D2. Cross-layer coupling that can disagree silently is the dangerous kind.**
When one layer owns the firewall and another owns the service, the port number
lives twice. A mismatch raises no error anywhere: the service starts, a check
over `127.0.0.1` succeeds, both layers are individually "correct", and the system
is unreachable from every real client. Two fixes, and a project wants both:

- **One owner, passed downward.** The layer owning the firewall owns the port
  numbers; the other receives them at invocation rather than keeping its own
  copy. Any duplicated defaults that remain are the no-state fallback and should
  be labelled as such.
- **Verify through the path a real client takes.** A loopback check proves the
  daemon is listening and nothing else — it cannot observe the firewall, the
  tunnel routing, or the address clients resolve. Where an off-box check is
  impossible inside the run, say so at the assertion: an assertion that cannot
  fail is worth less than none, because it reads like coverage.

Generalize the shape — any verification running on the same host as the thing it
verifies skips every network control in between.

**D3. Templates over in-place edits, rendered deterministically.** This is S7 for
the declarative layer plus one property: a run that changes nothing must *report*
nothing changed, or drift detection is unusable. Anything non-deterministic in a
rendered file — a timestamp, a random salt, an unordered mapping — makes every
run report a change and trains the operator to ignore the output. The usual fix
derives the value from a stable non-secret input (a password salt derived from
the account name rather than generated). Take that trade consciously: a
predictable salt loses cross-host uniqueness, which is what a salt is for. On a
single-operator box that is a defensible price for readable drift — write down
that it was a choice, so it is not later mistaken for an accident.

**D4. Format check, schema validation and plan are three different checks.**
Format checking catches nothing semantic. Schema validation against the *real
provider* (initialize with the backend disabled, then validate) catches type
mismatches no local linter can — a resource attribute exposed as a string fed to
an argument typed as a number, where the fix is an explicit conversion so a
surprising value fails loudly instead of coercing. Only a plan against real state
shows what will actually change; require one before any apply touching ingress
rules or destroying a resource. The same tiering holds for configuration
management: a syntax check proves the playbook parses and every module reference
resolves, a lint run catches the `off`-becomes-`False` class, and only a
check-mode run against a live host reports drift.

**D5. State files and plan output are credential material.** Infrastructure state
is unencrypted by default and records resource attributes verbatim, including
ones marked sensitive in the configuration; plan output and CI logs can carry the
same. Confirm state is ignored by version control, that the ignore rule is not
defeated by a variable-file exception, and that a committed lock file is the
dependency lock (which belongs in the repo) rather than state (which never does).

**D6. Blanket log suppression is blunt and has a cost.** Marking a task `no_log`
keeps a rendered credential out of the run's output — necessary — but it also
censors that task's **diff**, so a check-mode run reports *that* the file changed
without showing *how*. Suppress at the narrowest scope, and where a whole task
must be suppressed, say in the runbook that drift in that file is detected but
not displayed. Otherwise an operator reads a censored diff as a clean one.

## Secrets management for infrastructure

**K1. Rank by blast radius: account-scoped beats machine-scoped.** A cloud
provider API token, a VPN account token, or a CI platform token with
administration scope compromises everything under that account — and
**re-provisioning does not rotate it**. Destroy and rebuild and you get a clean
box that still trusts the same leaked token. A per-machine credential (a service
password, a host key) is bounded by the machine and genuinely is rotated by a
rebuild. When both appear in one finding, the account-scoped one sets the
severity.

**K2. A secret reaching a target through a configuration run lands in three
places on that target.** Enumerate all three for every such value rather than
generalizing from one:

- **process arguments** on the target, for the life of the invoking task (S4);
- **run output** — the operator's terminal locally, a job log in CI;
- **on-disk artifacts** the run writes: the config it renders, any temporary
  file, and any private key material it deploys, each with a mode the code must
  set.

A private key deployed to a CI machine deserves its own line: it should be a
**dedicated, individually revocable** credential — removable with one
`authorized_keys` line — not an operator's own key, so revoking CI's access never
locks a human out. See `references/ci-workflows.md` for the runner side.

**K3. Where the value lives at rest decides whether it is recoverable, not just
whether it is hidden.** An untracked file beside the code and a managed secrets
store both keep a value out of version control; only one survives a lost laptop,
supports rotation without hunting every copy, and can be audited for who read it.
A project moving from environment files to a secrets manager changed its recovery
story, not only its hygiene — confirm the old path is actually gone rather than
merely unused, while keeping the ignore rules that catch a stray `*.env`.

**K4. Prefer short-lived and derived over stored.** Where a platform mints a
short-lived registration or deployment token from a longer-lived one, fetch it at
use and persist it nowhere; where it supports workload identity instead of a
static token, the stored credential disappears entirely.
