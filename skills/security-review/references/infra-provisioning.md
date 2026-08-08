# Infrastructure provisioning

Load this when `## Stack` names `infra-provisioning`. It covers repositories
whose product is a **configured machine** rather than an application, at the
layer where that work is imperative shell run as root: the shell itself, the
ordering that decides whether the operator can still reach the box, and the
secrets such a run handles.

The blast radius is a machine: a wrong branch locks the maintainer out of the
only host, writes a credential world-readable, or prints one into a CI job log.

Such repos usually start as one shell script and grow into two declarative
layers, and the failures survive the migration — a rendered template leaks
exactly the credential the `sed` leaked, and a provider-managed firewall strands
an operator exactly the way `ufw` did. Those layers have modules of their own:
`references/config-as-code.md` for configuration management and
infrastructure-as-code, `references/cloud-network.md` for cloud firewalls and
network controls. Name them in `## Stack` alongside this one where the project
has them; the three modules cross-reference each other by rule.

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

Reachability sits in `auth-session` for want of a better bucket, and because it
travels with the credential it fronts: the rule naming which sources may reach
port 22 is reviewed in the same breath as the `authorized_keys` line behind it,
and separating them means each review sees half the control.

It is **not** there because a firewall authenticates anything. A source address
identifies a path, not a principal — spoofable, shared behind NAT, and
reassigned to a stranger next month. NIST SP 800-53 files firewalls under SC-7
Boundary Protection, deliberately apart from the IA (Identification and
Authentication) family, and SC-7's own discussion notes that strong
authentication of network addresses is not possible without explicit security
protocols. The practical consequence: **"the port is filtered" never upgrades a
service that has no credential.** A daemon with authentication disabled behind a
source-pinned rule is still an unauthenticated daemon and the finding stays
open. That is the same argument `references/cloud-network.md` → N2 makes about
private addressing, one layer up.

## Imperative shell run as root

**P1. An unquoted expansion is a privilege bug, not a style nit.** These scripts
run as root, so a path built from an unvalidated variable, a word-splitting
expansion, or an `rm -rf "$dir/"` where `$dir` can be empty is arbitrary
root-level damage from a caller-controlled value. Ask of every new variable: who
sets it, and where does it land — a path, a command, a config line, a regex?

Require `set -euo pipefail` and a shell linter, but treat `set -e` as a **floor,
not a guarantee**. It is not unambiguously good practice: BashFAQ 105 is titled
"Why doesn't set -e do what I expected?" and concludes "don't use set -e. Add
your own error checking instead", and Google's Shell Style Guide declines to
recommend it, saying "Always check return values" instead. The recommendation
stands here anyway — on a root script, carrying on after a failed step is the
worse failure — but the documented holes are wide:

- it is silently disabled inside any function invoked in a condition, or on
  either side of `&&` / `||`;
- `local var=$(cmd)` discards the command's status, because `local` is itself a
  command and it succeeded;
- it is not inherited inside command substitutions without `inherit_errexit`;
- `(( i++ ))` evaluating to zero is a non-zero exit status, so it kills the run.

A return value that must stop the run therefore gets checked explicitly, `set
-e` or not. And do not treat "and a shell linter" as closing the gap — **it does
not by default**: ShellCheck's checks for exactly this class
(`check-set-e-suppressed`, `check-extra-masked-returns`, SC2310/SC2311/SC2312)
live in `--list-optional` and are off unless enabled. Enabling them is part of
what "require a linter" has to mean here. Minor but real: `pipefail` is not
POSIX, so it is correct under bash and wrong under `#!/bin/sh` on a dash system.

**P2. A remote installer piped to a shell as root is usually the repo's largest
supply-chain surface.** `sh <(curl … install.sh)` and `curl … | sh` execute
whatever that URL serves at that moment — unpinned, unverified, recorded nowhere
in the repo, unconstrained by last week's audit. Be honest that this is
frequently the vendor's own documented path: the finding is not carelessness, it
is that the path has no integrity check when a better one usually exists. In
descending order of preference:

1. **The vendor's signed package repository**, key fetched to a keyring and the
   repository entry pinned to it. The apt option is spelled `signed-by=` in a
   one-line `sources.list` entry and `Signed-By:` in a deb822 `.sources` file —
   note the hyphen. `signed_by` with an underscore is Ansible's `apt_repository`
   parameter name, not apt's, so grep for the hyphenated form or the search
   comes back empty on a repository that is doing it right. Debian's
   guidance: the entry "SHOULD have the signed-by option set", the key "MUST NOT
   be placed in /etc/apt/trusted.gpg.d or loaded by apt-key add", and keyrings
   belong in `/etc/apt/keyrings` (operator-managed) or `/usr/share/keyrings`
   (package-managed). `apt-key` is removed as of Debian 13. The package manager
   then verifies every future upgrade too, which no one-shot download does.

   This item is **not a pure win**, and presenting it as one leaves the review
   incomplete. Unlike items 2 and 3 it permanently enlarges root-level trust:
   any package from that repository can run a maintainer-script command as root,
   on every upgrade, indefinitely. Debian's guidance pairs the entry with a pin
   for that reason — "a matching preferences file SHOULD be created to restrict
   the possible effects of the repository" — so a vendor repo cannot shadow a
   distro package such as `libc6`. A third-party repository added without an
   apt-preferences pin is an incomplete fix and worth saying so.

2. **A pinned release artifact with a recorded checksum**, verified by the
   fetching step itself rather than by a later call a `|| true` could swallow.
   Version and digest live together and move together.
3. **A source checkout at a pinned ref**, where the vendor supports it.

Rewriting `curl | sh` as "download to a file, then run the file" does not fix
the **integrity** problem — the same unverified bytes still execute, and it
becomes a fix only when a checksum or signature gates the execution. But it does
fix a second, independent problem, and flatly calling it "fixes nothing" is
wrong: a connection dropped mid-transfer feeds a **truncated** script to the
shell, which has already executed every line it read. The canonical illustration
is a line reading `rm -rf /usr/bin/some-app` truncating after `rm -rf /`.
Downloading first makes the file either whole or absent; the shell never sees a
prefix. Credit that, and still require the verification step. When judging a
vendor's installer, one that wraps all of its work in a function invoked on the
last line is immune to truncation by construction.

Two more properties of the piped form. In `curl … | sh`, curl's exit status is
the **left** side of the pipe, so without `pipefail` a failed or truncated
download is invisible to the calling script. And "I read the script first" is
not a mitigation for a pipe: serving different bytes to a reader than to a
runner is a demonstrated technique with public proof-of-concept code, not
folklore. A shell consuming a pipe stalls its reads while it executes each
chunk, and that stall is visible in the server's TCP write timing, so the server
can tell an audit from a run and answer them differently. Which is exactly why
the fix has to gate execution on a digest or a signature rather than on having
looked.

**P3. Code that writes a credential owns that file's mode.** Inheriting the
distro package's default is the quiet miss. Watch for the script that is
scrupulous about modes it is used to thinking about and silent about the new
one: a sudoers drop-in at `0440`, an `authorized_keys` at `0600`, and in the
same script a service config now carrying a plaintext password left at whatever
the package shipped.

State the hazard precisely, because the loose version is false and a false
premise gets the whole rule dismissed. Distro packages that ship
*credential-bearing* configuration generally do get the mode right —
`/etc/mysql/debian.cnf` is `0600`, `/etc/shadow` is `0640 root:shadow`. The real
hazard runs the other way: a script **adding a credential to a file the distro
correctly shipped at `0644` precisely because it had no credential in it**. The
package's mode was right for the file the package wrote; the script changed what
the file *is*, so the script owns the new mode. State owner, group and mode at
the point of writing.

Pick the mode from who actually reads the file, and be careful with the
recommendation that sounds generous:

- **A daemon that parses its config as root and then drops privileges** — the
  common case for anything binding a low port — never reads the file as the
  service identity at all, so `0600 root:root` is correct. `0640
  root:<svcgroup>` here is worse than doing nothing thoughtful: it hands the
  plaintext credential to exactly the identity an attacker lands on when that
  daemon is compromised, which is the scenario the mode exists to survive.
- **`0640 root:<svcgroup>` is right** when the daemon genuinely re-reads the
  file *after* dropping privileges (a reload path, a worker opening it lazily),
  or when a separate monitoring or backup identity must read it. Say which of
  those it is, in the code or in the finding. If neither is true, it is the
  first case and the group read is a gift to the attacker.

**P4. Where the consumer is a systemd unit, the file mode is the fallback, not
the design.** `LoadCredential=` and `LoadCredentialEncrypted=` pass a secret to
one unit through `$CREDENTIALS_DIRECTORY`, held in non-swappable memory. systemd
documents that "access to credentials is restricted to the service's user", that
"the credential data is not propagated down the process tree", and that "each
time a credential is accessed an access check is enforced by the kernel". There
is no mode to get wrong, nothing on `argv` (P5), and nothing a child process
inherits by accident. `LoadCredentialEncrypted=` goes further and lets the
encrypted value live in the repository, sealed to the host's TPM.

The honest caveat: many daemons only know how to read a plaintext config file,
so this is guidance where it applies rather than a universal replacement. Where
it does not apply, say so *in the finding* — "this daemon takes no credential
input other than its config file, so the mode is the control" is a complete
answer, and it distinguishes a considered fallback from an unexamined one.

**P5. Every secret travels three paths; walk all three for each new one.**

- **Printed.** A summary line reaches the operator's terminal *and*, from CI,
  that job's log, under whatever retention and visibility that repo has. Give the
  printing a switch and have the unattended caller set it off.
- **Written.** Which file, at what mode, owned by whom (P3), and whether a later
  step rewrites it and resets the mode.
- **Passed as a process argument.** Anything on `argv` is visible in `/proc` to
  any local user for the life of the call: `/proc/<pid>/cmdline` is `0444`,
  `hidepid=0` is the documented default, no mainstream distribution enables
  `hidepid`, and Red Hat advises against it on RHEL 7+ because it conflicts with
  systemd — so do not treat process hiding as an available mitigation. Some
  vendor CLIs accept a token only as a flag, so the exposure may be unavoidable;
  record it as a known limitation rather than leaving a reader to find it. An
  environment variable is materially better than `argv` — `/proc/<pid>/environ`
  is `0400`, owner-only — but stdin is better than both, because the value never
  lands in a readable kernel interface at all. Where a tool reads stdin, use it:
  piping a password into the account-update command instead of passing it as an
  argument removes the exposure in one line, and a script that does this for one
  credential but not another has an inconsistency worth flagging.

**P6. A generated-and-printed secret is not reproducible.** A script that invents
a password when the input is unset, prints it once and stores it nowhere has
produced a value existing only in terminal scrollback: it cannot be rotated
(nothing knows the current one), re-derived, or recovered once the window closes.
Requiring it as an input from wherever the project keeps secrets is the fix; the
convenience lost is smaller than the recovery problem created. Note what the
requirement costs elsewhere — see P12 on why an input-supplied credential is
*not* rotated by a rebuild.

**P7. Validate before installing, never after — and validate the thing you are
about to install, the way its consumer will read it.** Sudoers is the sharpest
case: an invalid file already in `/etc/sudoers.d` can break privilege escalation
for every account, and fixing it needs the privilege it just destroyed.
`visudo -cf` is the right check, but running it *after* `cat > /etc/sudoers.d/…`
only reports what you have already done — and `|| die` there exits leaving the
broken file in place. Render to a temporary file, validate that, install only on
success. Configuration-management tools expose this directly (a `validate:`
argument run against the staged file); imperative scripts must do it by hand and
often don't.

That shape is right and still leaves three gaps, each of which yields a script
that reports success while installing a grant that does not exist:

- **`visudo -cf <file>` does not check mode or ownership.** Those checks run
  only when *no* path is given. A staged file at `0666` reports "parsed OK" —
  and sudo then **skips** a world-writable drop-in at runtime. Pass `-O -P` to
  check owner and permissions too, or set `0440 root:root` on the staged file
  before validating it, which is better anyway since it is the mode the file
  will be installed with.
- **Without `-s`, an undefined `Cmnd_Alias` reference exits 0.** It prints a
  diagnostic and returns success, so a script keying off the exit status ships
  the break silently. Use `visudo -csf <file>`.
- **The destination filename is part of the contract.** `@includedir` skips any
  name containing a `.` or ending in `~`, so a drop-in installed as
  `50-proxy.sudoers` is never read and nothing anywhere reports it. The file is
  present, correct, and inert.

Same shape for anything whose breakage denies access: SSH daemon config
(`sshd -t`), firewall rules, PAM. In each case ask the same three questions —
does the checker verify mode and ownership, does it actually fail on the error
class you care about, and will the consumer read the path you wrote to.

**P8. Regex surgery means the repo never states what the file should be.** A
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

**P9. Reject credential shapes the config format cannot carry.** A
space-delimited directive (the classic `BasicAuth <user> <password>` form) does
not mis-parse loudly when the password contains a space; it mis-parses silently,
the service starts fine, and every login fails. Same class: newlines, and quoting
characters in formats with no escaping. Validate the shape at the boundary with a
message naming the reason — it is cheap, and it is the only place the constraint
can be enforced, because the format cannot express it.

## Ordering is a security property

**P10. Allowlist the inbound paths before anything captures reachability.** Any
step that changes how the machine can be reached — enabling a host firewall,
connecting a VPN client whose kill switch captures the default route, restarting
the SSH daemon under new config, changing the bind address — must have SSH, the
out-of-band shell (mosh or equivalent) and any service port permitted *before* it
takes effect. Reordering those strands the operator on a box reachable only
through the provider console, mid-run, with the configuration half applied.

The mechanism is worth getting right, because the usual shorthand — "a VPN
client's port allowlist is not a firewall" — is literally false and leads a
reviewer to the wrong conclusion about what the allowlist did. A commercial VPN
client's kill switch installs an nftables base chain at the `input` hook with
`policy drop`; that is why an un-allowlisted SSH session dies the moment the
tunnel connects. Allowlisting a port then adds **three** things, not one:

1. an `accept` rule in the client's own nftables table — this is what saves the
   SSH session;
2. a packet mark plus an inverted-fwmark policy-routing rule, so that traffic
   keeps using the real interface and the return path works;
3. a `masquerade`, so the reply leaves with the right source address.

The older description covered only the second. Its conclusion still holds — the
allowlist cannot open a port the real firewall denies — but the reason is the
traversal rule, not the absence of filtering: at a given hook, nftables
evaluates **every** base chain in priority order, so an `accept` in one table
merely lets the packet continue into the next, while a `drop` anywhere is
immediate and final. So the client's allowlist, the host firewall and the
provider firewall (`references/cloud-network.md`) must **all** permit, and any
one of them denying is the end of it. A review that conflates the three will
either report a hole that does not exist or miss the one that does.

**P11. A safety property that cannot be established is fatal, not a warning.**
Kill switches, egress verification, the tunnel technology actually in effect,
autoconnect-on-boot, detection of a genuinely reachable public address (the
routability assertion in `references/cloud-network.md` → N4): each either holds
or the run did not succeed. `die`, not `warn`.

The reason is the caller. Unattended runs key off the exit status, so a script
printing "Setup complete" over a control it could not verify is worse than one
that fails — it converts a loud failure into a silent false belief. `|| true`
belongs on cosmetics (suppressing a first-run consent prompt, a best-effort
analytics opt-out) and never on a control the posture depends on. Proceeding
without a control is an explicit input (`enable_killswitch=false`), not a
swallowed error.

## Secrets management for infrastructure

**P12. Rank by blast radius: account-scoped beats machine-scoped.** A cloud
provider API token, a VPN account token, or a CI platform token with
administration scope compromises everything under that account — and
**re-provisioning does not rotate it**. Destroy and rebuild and you get a clean
box that still trusts the same leaked token. When both appear in one finding,
the account-scoped one sets the severity.

The machine-scoped half needs a caveat, because as usually stated it contradicts
P6. "A per-machine credential is bounded by the machine and genuinely is rotated
by a rebuild" is true of a *generated* one — a host key is regenerated on first
boot — and **false of one supplied as an input**, which is exactly what P6
requires a service password to be. The rebuild reinstalls the identical leaked
value from the same secrets store. Ask which kind it is before crediting a
rebuild with rotation; where the value is input-supplied, the finding stays open
until the copy in the store is changed.

Then a pivot check, because "bounded by the machine" is a claim about the
machine's *reach*, not its size. A box holding a provider API token, carrying an
attached instance role, or merely able to reach the metadata endpoint (P16) is
not bounded by itself: compromise of it is compromise of whatever those
credentials reach, and the finding inherits account-scoped severity.

**P13. A secret reaching a target through a configuration run lands in three
places on that target.** Enumerate all three for every such value rather than
generalizing from one:

- **process arguments** on the target, for the life of the invoking task (P5);
- **run output** — the operator's terminal locally, a job log in CI;
- **on-disk artifacts** the run writes: the config it renders, any temporary
  file, and any private key material it deploys, each with a mode the code must
  set.

A private key deployed to a CI machine deserves its own line: it should be a
**dedicated, individually revocable** credential — removable with one
`authorized_keys` line — not an operator's own key, so revoking CI's access never
locks a human out. See `references/ci-workflows.md` for the runner side.

**P14. Where the value lives at rest decides whether it is recoverable, not just
whether it is hidden.** An untracked file beside the code and a managed secrets
store both keep a value out of version control; only one survives a lost laptop,
supports rotation without hunting every copy, and can be audited for who read it.
A project moving from environment files to a secrets manager changed its recovery
story, not only its hygiene — confirm the old path is actually gone rather than
merely unused, while keeping the ignore rules that catch a stray `*.env`.

Ask the same question of the values a tool writes at rest on the project's
behalf rather than the ones a human filed: `references/config-as-code.md` → D5
covers state files and plan output, which are credential material and land
wherever the backend puts them.

**P15. Prefer short-lived and derived over stored — and name the mechanism.**
Where a platform mints a short-lived registration or deployment token from a
longer-lived one, fetch it at use and persist it nowhere. "Supports workload
identity" is too vague for a reviewer to act on, so resolve it to one of these
and check for that:

- **OIDC federation from CI to the cloud provider**, against a trust policy
  scoped to the repository and ref. This replaces a long-lived access key
  sitting in repository secrets, which is the most common finding in this class.
- **An attached instance role**, read from the metadata service at the moment of
  use, instead of a static token written into an environment file on the box.
  P16 governs how that endpoint then has to be locked down.
- **A secrets manager's dynamic-secret or database backend**, issuing a
  credential per run under a lease that expires on its own.
- **SPIFFE/SPIRE SVIDs**, where a service mesh already issues workload
  identities.

If none of them apply, say so in the finding. "No federation is available for
this provider and CI combination, so a static token is the only option; it is
scoped to X and rotated on Y" is a defensible answer. An unexamined static token
is not.

**P16. The instance metadata service is a credential endpoint, and any outbound
fetch on the box can reach it.** `169.254.169.254` answers anything running on
the instance, authenticated by nothing more than being on the instance. Where
the instance carries an attached role, that endpoint hands out live cloud
credentials.

The consequence is the standard escalation path for this stack: a component that
fetches a URL on someone else's behalf — a forward proxy configured to fetch
arbitrary URLs, a webhook handler, a script curling a caller-supplied address —
will fetch *that* URL too if asked. That is the whole distance from "someone got
a request through your service" to "someone has your cloud account", and it
converts every machine-scoped finding in P12 into an account-scoped one.

What to require:

- **Session-oriented metadata access.** On AWS, IMDSv2 — session token required
  — with the PUT response hop limit set to `1`, so that a container on the host
  or an HTTP redirect cannot reach it second-hand. Require the equivalent on
  whichever provider is in use; the providers that demand a specific header on
  the request are relying on the same property, that a naive proxied GET cannot
  produce it.
- **Deny the link-local range at the egress boundary** wherever the box runs a
  forward proxy or anything else fetching attacker-influenced URLs — the common
  shape for this stack. Belt and braces: the hop limit stops the redirect, the
  egress rule stops the direct fetch.
- **Best of all, no attached role.** An instance with no role attached has
  nothing at that endpoint worth stealing. Ask what the role is for before
  hardening around it; the answer is sometimes "nothing, any more".

`references/cloud-network.md` → N4 legitimately reads this same endpoint to
discover the instance's own public address — that rule and this one are the two
halves of the same fact, and they are not in tension: a provisioning script
running as root reading it is fine. The control is that nothing *else* on the
box can be induced to read it on an outsider's behalf.
