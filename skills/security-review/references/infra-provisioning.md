# Infrastructure provisioning

Load this when `## Stack` names `infra-provisioning`. It covers repositories
whose product is a **configured machine** rather than an application: the
imperative shell run as root where a project still has one, the ordering that
decides whether the operator can still reach the box, and where the credentials
such work handles live. Only the shell section assumes a shell — the group
translation below, the ordering rules and the secrets rules hold for an
infrastructure repository of any shape, including one that is entirely
declarative.

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

This one is the base of the three, and the dependency runs one way. Both of the
others are written against the group translation below and cite it rather than
copy it, so a `## Stack` naming either of them names this module too — the shell
section simply finds nothing to match on a repository that has no shell. A
project with a provisioning script and neither of those layers names this module
alone.

That implication is bounded by what this module is *about*, and the boundary
falls in one of the two. What the table below translates the six group names
onto is **a configured machine**: which accounts exist on the box, what the run
writes to disk on the target, which sources may reach a port. `cloud-network`
always has that machine, since what its rules govern is what can reach one.
`config-as-code` need not: a declarative repository can manage DNS records,
object storage or a SaaS tenant's configuration and provision nothing that boots.
Almost all of its D-series still holds there, because those rules are properties
of the tooling rather than of a target — parser coercion, what a plan does and
does not verify, state and plan files as credential material, a secret reaching
a run's output. The translation is the part with nothing to map onto, and
loading this module for such a repository asks account, disk and reachability
questions it cannot answer, which is the "checks that cannot pass" failure the
profile warns about. So a declarative repository that provisions no machine
names `config-as-code` alone and takes that module's own not-loaded path: apply
the D-series, file each finding under a group by hand, and say in the report
that no machine translation applied. Name this module the moment any target *is*
a machine — one instance, one `authorized_keys` line, one host firewall is
enough.

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

Require a shell linter, and require the strict-mode options the script's own
shell actually has — **read the shebang before prescribing them.** Under bash
that is `set -euo pipefail`. Under `#!/bin/sh` on a dash system it is `set -eu`,
because `pipefail` is not POSIX: `dash -c 'set -euo pipefail'` answers `Illegal
option -o pipefail` and exits 2, so the line prescribed as hardening kills the
script on its first statement. Where a POSIX script genuinely needs a pipeline's
status, check it explicitly rather than reaching for the option. Then treat
`set -e` as a **floor, not a guarantee**. It is not unambiguously good practice: BashFAQ 105 is titled
"Why doesn't set -e do what I expected?" and concludes "don't use set -e. Add
your own error checking instead", and Google's Shell Style Guide declines to
recommend it, saying "Always check return values" instead. The recommendation
stands here anyway — on a root script, carrying on after a failed step is the
worse failure — but the documented holes are wide:

- it is silently disabled inside any function invoked in a condition, and for
  every command in an `&&` / `||` list **except the last one** — so `false &&
  true` carries on while `true && false` exits, which is the reverse of the
  shorthand "`set -e` is off around `&&`". Getting this backwards produces
  findings against a failure the shell does stop on, which is how the rule
  loses the reader;
- `local var=$(cmd)` discards the command's status, because `local` is itself a
  command and it succeeded;
- it is not inherited inside command substitutions without `inherit_errexit`;
- `(( i++ ))` evaluating to zero is a non-zero exit status, so it kills the run.

A return value that must stop the run therefore gets checked explicitly, `set
-e` or not. And do not treat "and a shell linter" as closing the gap — **it does
not by default**: ShellCheck's checks for exactly this class
(`check-set-e-suppressed`, `check-extra-masked-returns`, SC2310/SC2311/SC2312)
live in `--list-optional` and are off unless enabled. Enabling them is part of
what "require a linter" has to mean here.

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

   **Where the key came from decides whether any of that is trust.** Fetching
   the signing key over HTTPS from the same origin that serves the repository
   buys ordinary TLS and nothing beyond it: whoever can serve a malicious
   repository at that origin — a compromised vendor, a mis-issued certificate,
   an intercepted first run — serves the matching key in the same breath, and
   `signed-by` then verifies the attacker's signatures faithfully, as root, on
   every upgrade from then on. The pin has to be anchored to something that
   download cannot substitute: an expected fingerprint written into the reviewed
   code and checked after fetching, a key shipped by a distribution keyring
   package, or one obtained over a channel independent of the repository.
   Record the fingerprint, verify it, and fail the run when it does not match
   (P11). A `signed-by` entry whose key was fetched moments earlier from the
   same host is trust-on-first-use wearing the ceremony of verification — worth
   saying in the finding rather than crediting the entry as the fix.

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
3. **A source checkout at an immutable revision**, where the vendor supports
   it — a full commit object id, or a tag whose signature is actually verified.
   "Pinned ref" is not enough, and the phrase does real damage here: a branch
   or an ordinary release tag is a mutable pointer the vendor can move after
   the review that approved it, and what then runs as root is whatever it
   points at now. `references/ci-workflows.md` establishes this for privileged
   CI, where a retagged release is a documented incident rather than a
   hypothetical; a root shell on the box is the same requirement with a larger
   blast radius.

Rewriting `curl | sh` as "download to a file, then run the file" does not fix
the **integrity** problem — the same unverified bytes still execute, and it
becomes a fix only when a checksum or signature gates the execution. But it does
fix a second, independent problem, and flatly calling it "fixes nothing" is
wrong: a connection dropped mid-transfer feeds a **truncated** script to the
shell, which has already executed every line it read. The canonical illustration
is a line reading `rm -rf /usr/bin/some-app` truncating after `rm -rf /`.

Downloading first *makes it possible* for the shell never to see a prefix; it
does not achieve it, and crediting the two-step form on its own re-opens the
same bug one line later. curl leaves the partial output file in place when a
transfer fails — `--remove-on-error` is documented as opt-in, and it fires only
on an error curl actually returns, so it needs `--fail` beside it or an HTTP
error page is a *successful* transfer of the wrong bytes. None of which matters
if the script then invokes the file without consulting the download's exit
status. So credit the rewrite only when all three hold: the transfer's status
gates the execution, a failed transfer leaves no file behind (or the download
lands on a temporary path and is renamed into place only on success, which buys
the same guarantee from the filesystem), and the digest or signature check above
still runs. When judging a vendor's installer, one that wraps all of its work in
a function invoked on the last line is immune to truncation by construction.

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
is nothing on `argv` (P5), and no mode to get wrong **on the copy the service
reads**. `LoadCredentialEncrypted=` goes further and lets the encrypted value
live in the repository.

That qualifier is load-bearing, because plain `LoadCredential=` has to read the
secret from somewhere, and systemd's controls attach to the runtime copy in
`$CREDENTIALS_DIRECTORY` — not to the source. A unit pointing at a plaintext
file leaves that file exactly where it was, at whatever owner and mode it was
created with, and a review that reads "systemd credentials, so the mode is not
the control" has approved a world-readable secret one path away from the one it
checked. P3 still governs the source file: state its owner, group and mode at
the point the run writes it. The mechanism removes the mode question only where
the source is itself protected, or where `LoadCredentialEncrypted=` makes the
on-disk form useless without the key (and see the key-mode caveat below).

**Read the middle guarantee precisely: it is about the bytes, not about
access.** What does not propagate is the *secret value* — unlike
`Environment=SECRET=…`, the credential never enters the environment block that
descendants inherit and that surfaces in `/proc/<pid>/environ`. That is a real
gain and most of the reason to prefer this mechanism. What descendants **do**
inherit is `$CREDENTIALS_DIRECTORY` and the namespace it names, and the access
check is against the *unit's* identity rather than the individual process — so a
helper, plugin or subprocess the service spawns under that same identity can
open the credential file and read it. The boundary is the unit, not the process
that was handed the secret. Where something the service starts must not read the
value — a plugin, an interpreter running user-supplied code, a shell-out to a
third-party binary — that needs a *different* identity: a separate unit with its
own `LoadCredential=`, or a sandbox that unsets the variable and drops the
mount. Say which is in place, because "it uses systemd credentials" on its own
does not keep a value away from everything the service launches.

**Check what it was sealed *to* before crediting that last part.** "Encrypted"
here names a file format, not a guarantee, and the guarantee is chosen by
`--with-key=` at encryption time — `host`, `tpm2`, `host+tpm2`, `tpm2-absent`,
`auto`, `auto-initrd`. Two of those change the review's conclusion, and neither
announces itself in the unit file:

- **`auto` with no usable TPM2 silently falls back to the host key.** Verified
  on systemd 255: the encrypt succeeds, warns only that
  `/var/lib/systemd/credential.secret` "is not located on encrypted media", and
  emits ordinary-looking ciphertext. Nothing is TPM-bound. That still protects a
  repository copy — the secret file is `0400 root:root` and local to the box —
  but it binds the ciphertext to *that machine's* secret file, so a rebuilt host
  cannot read it and the credential has to be re-encrypted. Worth knowing before
  a rebuild, not after.
- **`tpm2-absent` provides nothing at all.** It says so — "Using a null key for
  encryption and signing. Confidentiality or authenticity will not be provided"
  — and still writes a blob indistinguishable at a glance from a real one. A
  value committed to a repository under that mode is plaintext to anyone who
  can read the repository, wearing the appearance of an encrypted credential.
  This is the one to grep for.

So require evidence of the key mode and of TPM availability on the target before
treating a repository-stored ciphertext as TPM-bound. Where the mode is not
recorded anywhere the repository can show you, that is itself the finding.

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
  is `0400`, owner-only — but stdin is better than both, because the value is
  never parked in an interface another process can read at leisure. Do not
  upgrade that to "never readable". A peer process under the same uid can open
  the victim's `/proc/<pid>/fd/0` and reach the pipe while the value is in
  flight, and a same-uid peer can generally `ptrace` the process anyway. The
  ranking still holds, and it is the useful part — `argv` is world-readable for
  the whole call, `environ` is owner-readable for the life of the process, stdin
  is a narrow window an attacker has to be present for — but grade it as a large
  reduction in exposure rather than a boundary, and note that the boundary which
  would actually hold is a separate identity. Where a tool reads stdin, use it:
  piping a password into the account-update command instead of passing it as an
  argument removes the exposure in one line, and a script that does this for one
  credential but not another has an inconsistency worth flagging.

**P6. A generated-and-printed secret is not reproducible.** A script that invents
a password when the input is unset, prints it once and stores it nowhere has
produced a value existing only in terminal scrollback: once that window closes,
the value cannot be recovered or re-derived.

Say **unrecoverable**, not **unrotatable**, because the two come apart and the
stronger claim is usually false. Rotating a credential means replacing it, and
replacement rarely requires the current value: an administrator with root on the
box overwrites the stored hash, or rewrites the service configuration, without
presenting the old password. What the lost value actually costs is every
*consumer* of it — the client config, the backup job, the operator's own access
— each of which now has to be found and updated, and any one that is missed
breaks at the moment of the reset rather than at the moment of the loss. So ask
two questions rather than asserting the worst: can the value be replaced without
knowing it, and can every dependent be updated when it is. Where both answers
are yes, a lost generated password is a reset-and-update chore, and the finding
is scoped to that. Where the value genuinely cannot be replaced without itself —
an encryption key that existing data was sealed under, a credential a third
party will only change on presentation of the old one — the loss is permanent
and that is a different severity.

Requiring the value as an input from wherever the project keeps secrets is the
fix in either case; the convenience lost is smaller than the recovery problem
created. Note what the requirement costs elsewhere — see P12 on why an
input-supplied credential is *not* rotated by a rebuild.

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
  check owner and permissions too, and set `0440 root:root` on the staged file
  before validating it. `-O -P` earns its place: verified locally, a drop-in at
  `0755` or `0664` parses fine under `-csf` and exits `0`, while
  `visudo -c -O -P -s -f` reports `bad permissions, should be mode 0440` and
  exits `1`.

  **Then read the install step, because validating the staged inode says
  nothing about the one sudo opens.** GNU `install` does not carry the source's
  mode across — its own `--help` gives `-m` as setting the mode "instead of
  rwxr-xr-x" — so a staged file validated at `0440` arrives at the destination
  as `0755`, confirmed locally. The privilege policy is then readable by every
  local account, and the mode contract established one sentence earlier is
  broken by the step that publishes the file.

  **Publish it by rename, not by copy** — the metadata is only half of what the
  publishing step decides. `install` and `cp` write *into* the destination:
  verified locally, both keep the destination's inode and truncate it in place,
  so an interrupted copy or a full filesystem leaves a **partially written
  sudoers file** where a valid one used to be, which is the outcome this entire
  rule exists to prevent, arrived at from the one direction the validation
  cannot see. `mv` within the same filesystem is a rename: verified locally, the
  destination gets the staged file's inode and its `0440` intact, and a failure
  leaves the previous valid policy untouched. So stage the file **on the
  destination's filesystem**, set owner, group and mode there, validate it
  there, then rename it into place — and note the condition, since `mv` across
  filesystems degrades to copy-then-unlink and gives none of this back.

  The general form of the trap is worth keeping in view: a check proves a
  property of the artifact it was handed, and what the consumer reads is a
  different artifact — different mode, different inode, or different content
  than the one that passed.
- **Without `-s`, an undefined `Cmnd_Alias` reference exits 0.** It prints a
  diagnostic and returns success, so a script keying off the exit status ships
  the break silently. Use `visudo -csf <file>`.

  Strict mode then costs something, and a project that hit the cost and dropped
  `-s` rather than fixing the cause has quietly lost the check. `-s` treats an
  alias used before it is defined as a parse error, and a drop-in validated on
  its own never sees an alias defined in the parent `sudoers` — so a drop-in
  that legitimately references one fails validation while being perfectly valid
  at runtime, where `@includedir` has pulled it in after the definitions. Two
  fixes keep `-s`: require drop-ins to be **self-contained**, defining every
  alias they use, which is the better default because it also makes the file
  mean the same thing to anything that reads it in isolation; or validate a
  **staged complete tree** — a temporary copy of the main `sudoers` and its
  include directory with the new file in place — and check that rather than the
  fragment. What is not a fix is dropping `-s`, which restores the
  exit-0-on-a-broken-grant hole this bullet opens with.

  The staged tree carries one trap that makes it worse than skipping the check,
  because it reports success. **`visudo -f` names the file to parse; it does not
  relocate the paths written inside that file.** A copied `sudoers` still
  reading `@includedir /etc/sudoers.d` therefore sends the validator to the
  **live** directory — it parses the drop-ins already installed and never opens
  the staged one. Demonstrated: a staged tree whose include directory holds a
  deliberately corrupt drop-in reports `parsed OK` and exits `0`, naming files
  from `/etc/sudoers.d` as it goes; rewriting that one directive to the staged
  directory catches the same file with a syntax error and exits `1`. So the
  staged tree is a remedy only once the copy's `@includedir` points at the
  staged directory — or the check runs in an isolated root where the absolute
  path resolves there. Check the include line, not merely that a temporary
  directory exists: a green validation of the *old* policy, immediately before
  installing a broken new fragment, is precisely the false pass this whole rule
  exists to prevent.
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
the SSH daemon under new config, changing the bind address — must have the
**access paths** permitted *before* it takes effect: SSH, and any second shell
the project relies on. Reordering those strands the operator on a box reachable
only through the provider console, mid-run, with the configuration half applied.

**Application ports are the opposite case, and folding them into the same rule
inverts it.** A package that starts its daemon on install starts it under the
distribution's default configuration — before the run has written the
credential, set the mode (P3), or applied whatever hardening the repository
carries for it. Permitting that port up front "so nothing breaks later"
publishes an unconfigured listener for the remainder of the run, which is the
exposure the firewall was ordered early to prevent. So the ordering has two
halves running opposite ways: management and recovery paths go **first**,
because losing them ends the run and needs the console to recover; each service
port goes **last**, once its listener is configured, authenticated and verified.
"Everything permitted up front" reads as the cautious choice and is not one.

Be careful what gets counted as that second shell, because the usual candidate
is not independent of the first. A roaming shell such as mosh is genuinely
valuable mid-reprovision — it survives the address change and the dropped
connection that would kill an SSH session — but it is **not an out-of-band
path**: the client bootstraps the remote server over SSH, and the session then
needs its own UDP range through the very firewall the run is changing. It shares
both dependencies with the thing it is supposed to back up, so it fails in
precisely the scenario it would be called on for, and both of those
dependencies have to be permitted before the change rather than just the UDP
range. The only genuinely out-of-band path is one that does not traverse the
machine's network policy at all — the provider's serial or web console, or a
management interface on a separate path — and `references/cloud-network.md` →
N5 requires that one be exercised rather than merely configured.

The mechanism is worth getting right, because the usual shorthand — "a VPN
client's port allowlist is not a firewall" — is literally false and leads a
reviewer to the wrong conclusion about what the allowlist did.

State the invariant before any implementation, since the invariant is what has
to hold and it holds for every client. A kill switch works by making the default
packet path **drop**, which is why an un-allowlisted SSH session dies the moment
the tunnel connects. Restoring one port therefore has to restore **three**
distinct properties, and an allowlist that delivers fewer has left the port
broken rather than open:

1. **the inbound packet survives filtering** — something has to accept it where
   the kill switch drops. This is the part that saves the SSH session;
2. **the reply is routed back out the real interface** rather than into the
   tunnel. That is a routing decision, and the accept rule does not make it;
3. **the reply leaves with the source address the client sent to**, or it is
   discarded as unrelated.

Check for the three by their effect, not by their spelling. A client whose kill
switch is an nftables base chain at the `input` hook with `policy drop`
satisfies them with an `accept` rule in its own table, a packet mark plus an
inverted-fwmark policy-routing rule, and a `masquerade` — one concrete example,
useful because it is a common one. Another client does the same work with a
separate routing table and an `iptables` rule, or in a `wg-quick` `PostUp`. A
reviewer matching on the nftables spelling reads those as "no kill switch"; a
reviewer matching on the invariant does not. The older description of this rule
named only the second property, which is why its conclusion needs restating from
the invariant rather than from any one mechanism.

That conclusion still holds — the allowlist cannot open a port the real firewall
denies — but the reason is that the layers compose by **conjunction**, not that
the client filters nothing. Where the kill switch and the host firewall are both
nftables base chains, the composition is explicit in the traversal rule: at a
given hook, nftables evaluates every base chain in priority order, so an
`accept` in one table merely lets the packet continue into the next, while a
`drop` anywhere is immediate and final. The provider firewall
(`references/cloud-network.md`) is a separate device on the path and composes
the same way. So the client's allowlist, the host firewall and the provider
firewall must **all** permit, and any one of them denying is the end of it. A
review that conflates the three will either report a hole that does not exist or
miss the one that does.

**P11. A safety property that cannot be established is fatal, not a warning.**
Kill switches, egress verification, the tunnel technology actually in effect,
autoconnect-on-boot, detection of a genuinely reachable public address (the
reachability check in `references/cloud-network.md` → N4, which is the range
check *and* the positive association, not either alone): each either holds
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
credentials reach.

Which makes the severity a question about the *grant*, not about its existence,
so read the grant before assigning one. An administration-scoped API token, or a
role whose policy names a wildcard resource, is account-scoped and the finding
says so. A role constrained to that host's own backup prefix, one parameter
path, or a single queue reaches what compromise of the box already reached, and
promoting it to account-scoped inverts the ranking this rule exists to produce:
nearly every instance carries *some* role, so a check that promotes all of them
promotes none of them. Inspect the attached policies' actions, resources and
conditions and rank on what they actually reach; where those policies are not
readable from the repository under review, say the scope was not established
rather than assuming either end of it. The metadata endpoint is the same
question one step removed — it is account-scoped when what it serves is, and an
instance with no role attached has nothing there at all (P16).

**P13. A secret reaching a target through a configuration run has three places
it can land.** Walk all three for every such value rather than generalizing from
one — then report the ones it actually reaches.

The older phrasing said the value *lands* in all three, which is both wrong and
in conflict with P5 a few rules up: preferring stdin, a credential API or a
mode-protected temporary file is worth doing precisely because those routes miss
one or more of these. A tool that streams the value to the target's stdin and
suppresses it from task output has put it in neither of the first two. So treat
the list as channels to establish rather than findings to file — an argv
exposure reported against a transport that never touched argv is the false
positive that gets the rule waved through the next time it is right:

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
  scoped so that only the intended workflow can assume it. Require repository
  scope plus **one** of a permitted ref or a protected deployment environment —
  one, not both, because the subject claim carries one *or* the other. A
  ref-scoped subject names the branch or tag directly; an environment-scoped one
  (`repo:<owner>/<repo>:environment:<name>`) carries no ref at all, and which
  branches may reach it is decided by that environment's own deployment
  restrictions instead. So demanding a ref in the subject rejects the
  environment-scoped setup, which is usually the *stronger* of the two, since an
  environment can also require a reviewer — `references/ci-workflows.md` → C9.5
  is where those restrictions get checked, and this bullet defers to it rather
  than restating them. Establish which shape the subject takes, then verify the
  matching restriction: the ref pattern where it is ref-scoped, the branch rules
  and required reviewers where it is environment-scoped. Scoped to the
  repository and nothing else is the finding, in either shape. Any of this
  replaces a long-lived access key sitting in repository secrets, which is the
  most common finding in this class.
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
a request through your service" to "someone has whatever the attached role has",
and it lifts a machine-scoped finding in P12 to the scope of that role — up to
the whole account where the role is scoped that way, which is what P12 sends you
to read the policy for.

What to require:

- **Session-oriented metadata access.** On AWS, IMDSv2 — session token required
  — plus a PUT response hop limit tight enough that an HTTP redirect or a
  neighboring container cannot reach the endpoint second-hand. Require the
  equivalent on whichever provider is in use; the providers that demand a
  specific header on the request are relying on the same property, that a naive
  proxied GET cannot produce it.

  **The hop limit is a decision, not a constant**, and `1` prescribed blindly
  breaks working credentials. A process in a container on a bridge network
  reaches the endpoint one hop further out than a host process does, so `1` is
  precisely what denies IMDS to containerized workloads — the goal when nothing
  in a container needs the role, an outage when something does, and the same
  setting either way. Establish which case the box is in before requiring a
  value:

  - **Nothing containerized needs IMDS** → `1`, and that is the value to
    require.
  - **A containerized workload holds the identity** → give the workload its own
    credential instead of letting it reach the host's. The task- or pod-level
    identity the platform issues is served from its own endpoint, so the host
    hop limit stays at `1` and the container never touches `169.254.169.254`.
  - **Neither is available** → the provider-documented container hop limit (`2`
    on AWS) is the supported fallback, and the finding says so rather than
    leaving it to look like an oversight: every process one hop out now reaches
    the endpoint, so the egress rule below and the role's own scope (P12) are
    carrying the control the hop limit was.

  Reporting "hop limit is 2" without establishing which of the three applies is
  reporting a configuration, not a hole.
- **Deny the link-local range at the egress boundary** wherever the box runs a
  forward proxy or anything else fetching attacker-influenced URLs — the common
  shape for this stack. Belt and braces: the hop limit stops the redirect, the
  egress rule stops the direct fetch.

  **Scope that denial to the fetcher rather than to the host**, or it takes the
  legitimate reader out with the hostile one: `references/cloud-network.md` → N4
  has the provisioning run itself reading this endpoint to discover the
  machine's advertised address, and a host-wide link-local drop blocks that too.
  What makes the two compatible is that they are different *principals* on one
  box, so the boundary has to be drawn where that difference is visible — the
  fetcher's own network namespace or container, a rule matching its uid or
  cgroup, an egress policy attached to its identity rather than to the
  interface. Where the platform expresses none of those, invert it: deny broadly
  and permit the one trusted caller explicitly, and say in the finding which
  principal the exception names, since an exception nobody can enumerate is the
  hole again. A rule that simply drops `169.254.169.254` for everything is not a
  stricter version of this control; it is a different control that breaks the
  run.
- **Best of all, no attached role.** An instance with no role attached has no
  live cloud credentials at that endpoint, which removes the escalation this
  rule opens with. Ask what the role is for before hardening around it; the
  answer is sometimes "nothing, any more".

  It does not empty the endpoint, though, and "no role, so nothing to steal" is
  how a reviewer stops one step early. The same service still answers for the
  instance's **user-data** — where a bootstrap script routinely parks the very
  credentials it exists to install — along with the signed instance identity
  document, any keys the provider injects, and whatever else that provider files
  under its own metadata categories. Inventory what the endpoint actually serves
  on the provider in play rather than inferring it from the role, and keep the
  hop limit and egress controls above pointed at it either way. A role-less
  instance is a smaller prize, not an empty one.

`references/cloud-network.md` → N4 legitimately reads this same endpoint to
discover the instance's own public address — that rule and this one are the two
halves of the same fact. They are not in tension over *whether* the endpoint may
be read: a provisioning script running as root reading it is fine, and the
control is that nothing *else* on the box can be induced to read it on an
outsider's behalf. Where they do collide is over how a denial gets written,
which is why the egress rule above has to name a principal rather than an
address — the host-wide version satisfies this rule by breaking that one. A
review reporting "link-local is reachable from this host" without asking which
process was doing the reaching has not yet established either half.
