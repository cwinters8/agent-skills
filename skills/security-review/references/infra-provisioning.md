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

**Provider defaults differ, and several rules below turn on one.** Where a rule
names a provider, it is because the behavior is that provider's and demonstrably
not the others'. One provider's behavior restated as general truth is how a
reviewer comes to "verify" a control that never existed, or to tighten a rule
that was holding the box together. Establish which provider is in play, and
which of its defaults are in force, before applying any N-series rule.

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
open. That is the same argument N2 makes about private addressing, one layer up.

## Imperative shell run as root

**S1. An unquoted expansion is a privilege bug, not a style nit.** These scripts
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

**S2. A remote installer piped to a shell as root is usually the repo's largest
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

**S3. Code that writes a credential owns that file's mode.** Inheriting the
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

**S3b. Where the consumer is a systemd unit, the file mode is the fallback, not
the design.** `LoadCredential=` and `LoadCredentialEncrypted=` pass a secret to
one unit through `$CREDENTIALS_DIRECTORY`, held in non-swappable memory. systemd
documents that "access to credentials is restricted to the service's user", that
"the credential data is not propagated down the process tree", and that "each
time a credential is accessed an access check is enforced by the kernel". There
is no mode to get wrong, nothing on `argv` (S4), and nothing a child process
inherits by accident. `LoadCredentialEncrypted=` goes further and lets the
encrypted value live in the repository, sealed to the host's TPM.

The honest caveat: many daemons only know how to read a plaintext config file,
so this is guidance where it applies rather than a universal replacement. Where
it does not apply, say so *in the finding* — "this daemon takes no credential
input other than its config file, so the mode is the control" is a complete
answer, and it distinguishes a considered fallback from an unexamined one.

**S4. Every secret travels three paths; walk all three for each new one.**

- **Printed.** A summary line reaches the operator's terminal *and*, from CI,
  that job's log, under whatever retention and visibility that repo has. Give the
  printing a switch and have the unattended caller set it off.
- **Written.** Which file, at what mode, owned by whom (S3), and whether a later
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

**S5. A generated-and-printed secret is not reproducible.** A script that invents
a password when the input is unset, prints it once and stores it nowhere has
produced a value existing only in terminal scrollback: it cannot be rotated
(nothing knows the current one), re-derived, or recovered once the window closes.
Requiring it as an input from wherever the project keeps secrets is the fix; the
convenience lost is smaller than the recovery problem created. Note what the
requirement costs elsewhere — see K1 on why an input-supplied credential is
*not* rotated by a rebuild.

**S6. Validate before installing, never after — and validate the thing you are
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
provider firewall must **all** permit, and any one of them denying is the end of
it. A review that conflates the three will either report a hole that does not
exist or miss the one that does.

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

**N1. Default-deny egress is one provider's behavior, not a general default.**
Establish which provider is in play before flagging — or "fixing" — anything
about outbound rules:

- **DigitalOcean** cloud firewalls default-deny outbound: "If no outbound rules
  are configured, no outbound traffic is permitted." Attaching one with only
  inbound rules kills all egress — no DNS, no package installation, no tunnel —
  and every later step then fails confusingly.
- **AWS** creates a new security group **with** an allow-all egress rule. That
  is the service's behavior, not a console convenience.
- **GCP** VPC firewalls carry an implied allow-egress rule.
- **Azure** network security groups carry `AllowInternetOutBound` at priority
  65001.

The AWS-shaped trap that looks like this one is not the provider's, it is the
IaC layer's; it lives in the D-series, with D2.

What the older framing got wrong is worth naming, because it handed reviewers a
reason to wave through `0.0.0.0/0` egress anywhere: a permissive outbound rule
is not automatically "load-bearing, not laziness". What breaks the box on a
default-deny provider is **removing an existing allow-all rule without replacing
it**. The defensible move there is not a blanket allow but a *narrow* outbound
rule covering what the host actually needs — DNS, the package mirror, the tunnel
endpoint. Egress filtering is a real control rather than ceremony (NIST SP
800-41r1 treats outbound policy as part of the firewall's job), and it is the
control that decides whether a compromised host can phone home. So: establish
the provider default and what the host is for, then judge the rule on its
*width*, and leave the reasoning in a comment beside it so the next reviewer
does not re-litigate it.

**N2. A private network or VPC is not an ingress control — but it is not inert
either.** The conclusion holds: private addressing is not authentication, and
"it's only on the private network" is an argument about *routing* (real, since
traffic between instances then avoids the public internet) and never an argument
that a port is protected. The premise that a VPC "filters nothing" is wrong on
two of the three major providers, and believing it makes a reviewer skip the
layer where the hole actually is.

- **GCP**: "every VPC network functions as a distributed firewall." Rules are
  defined at the *network* level rather than per instance, and the auto-created
  `default` network ships `default-allow-ssh` (TCP 22 from anywhere) alongside
  `default-allow-rdp`. An instance in the default VPC therefore sits in an
  ingress **hole**, not a neutral position.
- **AWS**: "Each subnet in your VPC must be associated with a network ACL." The
  default NACL is permissive, but it is never *absent*, and a restrictive one is
  a real filter a security-group-only review will not see.
- **DigitalOcean**: the VPC genuinely is only addressing; filtering is entirely
  the cloud firewall's job. This is the case the old text generalized from.

Correct the sibling claim too. It is not that "every instance already sits in
one by default" — it is that an instance **cannot exist outside** a VPC. The
difference matters: an organization-managed account may have no *default* VPC at
all, so a script or module that assumes one exists fails outright rather than
quietly landing in a shared network.

Practically: check the network-level rules as well as the instance-level ones,
and say in the finding which layer you checked. "The security group is tight"
with a permissive network-level rule above it has verified the smaller half.

**N3. Just-in-time firewall rules fail open.** The pattern is a CI job opening
its own runner's address at start and closing it in an always-run final step.
Three independent problems, and the third is the strongest.

**The closing step runs on a budget, not a guarantee.** The claim that a
cancelled job simply skips its cleanup is wrong, and stating it costs the rule
its credibility with anyone who has read the docs: GitHub Actions re-evaluates
`if` conditions when a job is cancelled, and an `always()` step **does** run —
inside a documented window. "After the 5 minute cancellation timeout period, the
server will forcibly terminate all jobs and steps marked for cancellation that
are still running." The real failure cases are a killed or evicted runner, a
crashed harness, a job or workflow timeout that ends the run outright, and
cleanup that outruns the five-minute budget — an API call retrying against a
rate limit will. Treat `always()` as a budget, not a promise. Note also that
GitHub's own guidance prefers `if: ${{ !cancelled() }}`, because `always()` can
hang a run by ignoring the cancellation that was trying to stop it.

**Provider-side expiry does not exist anywhere; expressiveness varies a lot.**
"Rules carry no timestamp" is overstated for AWS and *understated* for
DigitalOcean:

- **AWS** security group rules have a `securityGroupRuleId`, a `description` and
  tags, so "expire anything tagged past N minutes" is perfectly expressible — by
  a reaper you write and run, which is itself another privileged job. CloudTrail
  keeps 90 days of `AuthorizeSecurityGroupIngress` events, so a leaked rule is
  at least attributable. What AWS lacks is provider-side *enforcement*, not
  expressiveness.
- **DigitalOcean** is worse than the old text implied. An inbound rule has no
  id, no description, no tags and no timestamp — `created_at` lives on the
  enclosing firewall, not on the rule — so closing one rule means a read,
  modify, write of the *entire* rule array.

That last point is the strongest argument against the pattern, and it was
missing: **two concurrent CI jobs clobber each other's rules.** Job A reads the
array, job B reads the same array, both write, and whichever writes last erases
the other's rule. The same race lets a cleanup step silently *reopen* a rule
another job just closed, by writing back an array it read before the close. The
failure is non-deterministic, invisible, and produces precisely the leak the
cleanup step exists to prevent. What leaks is SSH open to an address the project
does not control, indefinitely, with nothing distinguishing it from a deliberate
rule.

**Prefer a stable identity.** A long-lived runner carrying a provider tag, and
one static rule whose source is that tag. That removes the IP detection, the
reaper, the race, and — worth stating explicitly — the cloud-provider API token
from CI entirely, since no job needs to mutate infrastructure any more.

Analogues exist on the other providers and are stronger: an AWS security group
can name **another security group** as a rule's source, and GCP supports source
tags and source service accounts. Prefer those where they exist, because of what
a tag actually is. The tag **is** a credential — anything wearing it gets in —
but be precise about which kind: it is an *API-authorization* credential, no
stronger than the IAM policy over who may apply that tag to a resource. Where
the provider offers group-membership referencing rather than a free-text label,
take it: membership is an authorized attachment, while a label is a string that
anyone with tag-write permission can forge onto their own instance. Say so where
the tag is defined, and never reuse it for unrelated instances.

**N4. Where an address must be discovered, read it from the provider metadata
service — not from the interface, and not from an outbound request.** The valid
kernel of this rule stands: with a kill switch on, an outbound "what is my IP"
request reports the *tunnel's* exit rather than the host's own address, so
pinning a firewall or publishing an endpoint on that value is silently wrong.
The remedy the rule used to give — read the address off the interface — is
backwards on most providers:

- **AWS** maps "a public IP address … to the primary private IP address through
  network address translation". The guest never sees the public address.
- **GCP** attaches an external IP as a `ONE_TO_ONE_NAT` access config; again the
  guest sees only an internal address.
- **DigitalOcean** behind a reserved (floating) IP puts the *anchor* address on
  `eth0`, not the reserved one, so the value read is not the address clients
  use. An instance created without public networking has no public interface at
  all.

On AWS and GCP the interface read fails the rule's **own** routability assertion
on every instance, because what it finds is an RFC1918 address. A rule that
cannot pass anywhere gets deleted rather than fixed.

Read `169.254.169.254` instead — the link-local metadata endpoint every major
provider serves, which reports the address actually assigned to the instance. It
has a second property that matters here: link-local traffic is not subject to
AWS security groups or network ACLs, so the read survives a kill switch and a
default-deny egress rule that would break an outbound HTTP call. Treat that
endpoint as the credential surface it also is — K5 is the other half of this
rule.

Keep the assertion, and relabel it. Rejecting a loopback, RFC1918, link-local or
RFC 6598 (`100.64.0.0/10`) answer is a **routability test**, not a NAT detector,
and the difference is not pedantic: AWS permits publicly-routable CIDRs inside a
VPC, and `100.64.0.0/10` is a common secondary CIDR for pod networking, so the
identical result is correct on one account and a bug on another. Publishing a
non-routable value as an endpoint is worse than failing (O2) — so assert
routability, fail closed, and do not claim the assertion tells you whether NAT
is in play.

**N5. Pinning ingress to a single egress IP couples reachability to a client
staying connected.** Restricting SSH to one VPN dedicated address is a strong
control and a real operational dependency: every client, phone included, reaches
the box only while that VPN is up, and a change of that address locks everyone
out until the infrastructure layer is applied from elsewhere. Legitimate, but it
has to be deliberate, and documented alongside the out-of-band recovery path (a
provider console that does not use SSH and is unaffected by the firewall).

Four things the rule needs, in descending severity:

1. **Check the other address family.** This is a straight bypass, and nothing
   else in N1–N5 mentions address families at all. Pinning SSH to one IPv4
   source while `sshd` listens on `::` and the firewall's IPv6 source is left at
   `::/0` leaves the box reachable from the entire internet — and the diff reads
   as a lockdown. Every ingress rule has an address-family dimension; a review
   that reads only the v4 rules has read half the policy. Pin both families, or
   disable the one you are not pinning at the daemon *and* the firewall.
2. **The console credential must be exercised, not merely set.** Same reasoning
   as O2: an unverified control is a false belief, and this one is only ever
   tested on the day it is needed. A break-glass path requiring a password
   nobody ever set — or ever logged in with — is not a break-glass path. Log in
   through it once, deliberately, before relying on it.
3. **Keep a second, independent ingress source**, so one provider's outage is
   not a total lockout. A pinned address whose only fallback is that same
   provider's console is one failure domain wearing two hats.
4. **Say where the provider API token lives during a recovery.** If the only
   copy is on the box you are locked out of, the recovery path is circular. It
   belongs wherever the project keeps secrets (K3), reachable from a machine
   that is not the failed host.

This also connects to K1: a dedicated egress address is normally a paid
subscription feature, so a lapsed payment or a cancelled account revokes the
address and locks everyone out — a billing event with the blast radius of a
firewall change.

## Configuration management and infrastructure-as-code

**D1. YAML 1.1 coerces bare `off`, `on`, `yes`, `no` to booleans.** Those four
words are exactly the right list to grep for, and the reason is narrower than
"YAML 1.1": PyYAML — and therefore Ansible — implements YAML 1.1 but a subset of
its resolver, dropping the bare `y`/`n` forms the 1.1 spec also admits. Worth
knowing that YAML **1.2**'s core schema admits only
`true|True|TRUE|false|False|FALSE`, so a repository whose linter targets 1.2
while its runtime parses 1.1 genuinely disagrees with itself about the same
file: the linter sees a string where the runtime sees a boolean.

Get the mechanism right, because the older version sends a reader to test the
wrong thing and conclude the rule is false. The YAML parse produces a Python
`False`. It is then the **argument-spec coercion in the tool** that renders it
as the string `"False"`, when the receiving parameter is typed `str`. Ansible
emits a warning at that point — but the warning is **non-fatal and suppressible
by default** (`string_conversion_action`), which is the actual reason this gets
missed: the run is green and the warning scrolls past.

Get the location right too. `command: foo off` is *not* an instance of this —
that whole line is a single plain scalar containing a space, and no per-word
coercion happens inside it. The coercion bites where the bare word is a scalar
**value** in its own right: a module parameter, an element of an `argv:` list,
an item in a loop. A reader who tests the free-form command string, watches it
work, and dismisses the rule has been misled by the rule's own example.

Require a YAML linter among the project's mechanical checks. yamllint's `truthy`
rule is **on by default but only at `level: warning`** — promote it to an error
or it is decoration. It also checks mapping *keys*, and some ecosystems use a
bare truthy word as a key legitimately (GitHub Actions' `on:` is the canonical
case). Set `check-keys: false` there rather than disabling the rule, which would
lose the value case — the one that actually bites.

**D2. Cross-layer coupling that can disagree silently is the dangerous kind.**
When one layer owns the firewall and another owns the service, the port number
lives twice. A mismatch raises no error anywhere: the service starts, a check
over `127.0.0.1` succeeds, both layers are individually "correct", and the system
is unreachable from every real client. Two fixes, and a project wants both:

- **One owner, passing the value downward — and name the channel, because they
  are not equally cheap.** Inside one layer, a module input or an inventory
  variable is free. *Across a state boundary* it becomes an output the other
  layer consumes, and Terraform's `terraform_remote_state` buys that at a real
  price: HashiCorp documents that "any user or server which has enough access to
  read the root module output values will also always have access to the full
  state snapshot data." Where the producing state holds secrets (D5), that is a
  secrets-disclosure decision made in passing, to avoid duplicating a port
  number. Publish the value explicitly instead — a parameter-store entry, or a
  provider data source that reads the live resource. Any duplicated defaults
  that remain are the no-state fallback and should be labelled as such.
- **Verify through the path a real client takes.** A loopback check proves the
  daemon is listening and nothing else — it cannot observe the firewall, the
  tunnel routing, or the address clients resolve. Where an off-box check is
  impossible inside the run, say so at the assertion: an assertion that cannot
  fail is worth less than none, because it reads like coverage.

Generalize the shape — any verification running on the same host as the thing it
verifies skips every network control in between.

**The same disagreement appears between a tool's defaults and a provider's.**
The AWS-shaped version of N1's egress trap belongs here, because it is the IaC
layer's behavior and not the cloud's: AWS creates a new security group *with* an
allow-all egress rule, and Terraform's `aws_security_group` **deletes that rule
on create**. A group declared with only `ingress` blocks therefore ends up
default-deny outbound, even though the console-created equivalent would not. The
code says nothing about egress, the provider's documented default says traffic
is allowed, and the resulting group blocks it. Read the *resource's* documented
defaults, not the provider's, whenever a review turns on "what happens if the
configuration says nothing".

**D3. Templates over in-place edits, rendered deterministically — and do not pay
for that with the salt.** This is S7 for the declarative layer plus one
property: a run that changes nothing must *report* nothing changed, or drift
detection is unusable. Anything non-deterministic in a rendered file — a
timestamp, a random salt, an unordered mapping — makes every run report a change
and trains the operator to ignore the output.

The tempting fix is to derive the value from a stable non-secret input: a
password salt derived from the account name. **Do not take that trade.** It is
not a trade that has to be made, and the account-name derivation is the worst
available choice — `root`, `deploy` and `ansible` are the same string on every
host on earth, so one precomputed table covers all of them, which is the exact
offline attack a salt exists to prevent. OWASP defines a salt as "a unique,
randomly generated string"; NIST SP 800-63B requires that "the salt SHALL be at
least 32 bits in length and be chosen arbitrarily so as to minimize salt value
collisions among stored hashes."

**Fix the reporting, not the cryptography.** Three documented ways to get a
random salt *and* a quiet run:

1. **Do not re-render the credential.** Ansible's `user` module takes
   `update_password: on_create`, so an existing account's hash is never
   rewritten. The task is idempotent with a fully random salt, because the salt
   is not regenerated on a run that has nothing to create.
2. **Generate once, then read.** Mint the value on first provision, persist it
   where the project keeps secrets (K3), and template the *stored* copy on every
   later run. Ansible's `lookup('password', …)` does this in-band and documents
   that it "forces saving the salt value for idempotence" when asked for a hash.
3. **Keep it out of the rendered artifact entirely.** Terraform's write-only
   arguments and ephemeral resources (1.11+) pass a secret to a provider without
   it reaching the plan or the state file — which settles D5 for that value too.

One pattern to recognize and *replace* rather than copy: Ansible's own
documentation shows a per-host derivation of the form
`65534 | random(seed=inventory_hostname)`. It is better than the account-name
version, in that hosts differ from one another — but it yields under 16 bits of
salt, half the NIST floor, from a public seed an attacker usually knows. Finding
it in a repository is a finding to replace, not a precedent to follow.

**D4. Format check, schema validation and plan are three different checks — and
the middle one is narrower than it looks.** Format checking catches nothing
semantic.

`terraform validate` "runs checks that verify whether a configuration is
syntactically valid and internally consistent, regardless of any provided
variables or existing state". It needs an initialized directory, so the provider
schemas are present, and it "does not validate remote services". What it
genuinely catches: misspelled or unsupported argument and attribute names,
missing required arguments, and expressions of a type with no possible
conversion to the argument's type.

What it does **not** catch is the example this rule used to give. A resource
attribute exposed as a string, fed to an argument typed as a number, passes
twice over: Terraform "automatically converts number and bool values to strings
when needed. It also converts strings to numbers or bools, as long as the string
contains a valid representation", and a resource attribute is unknown at
validate time anyway. That failure surfaces at apply, against a real value. Cite
an example validation actually catches — a mistyped argument name that silently
configures nothing, or a required argument omitted — and rely on the plan for
the rest. Only a plan against real state shows what will actually change;
require one before any apply touching ingress rules or destroying a resource.

The configuration-management parallel has the same trap, in both directions:

- A **syntax check** resolves module, role and collection references only
  against what is *actually installed* in that environment. A CI image that
  skipped its requirements file passes the check vacuously — every reference
  "resolves" because nothing was present to contradict it. Assert the
  dependencies were installed in the same job as the check.
- A **check-mode run** is weaker evidence than it reads as. Ansible documents
  that "modules that do not support check mode report nothing and do nothing";
  it produces no output for tasks conditional on variables registered by earlier
  (skipped) tasks; and any task marked `check_mode: false` changes the system
  for real during the supposedly dry run. A green check-mode run is not a
  statement that the play is safe. When citing one as evidence, say what it did
  not cover.

**D5. State files and plan output are credential material.** Terraform's own
documentation is unambiguous: it "stores your state in a plaintext file, which
includes any secret values you defined in your configuration". Marking a value
or an output `sensitive` changes only what is *printed* — sensitive values and
outputs are still written verbatim into state and into plan files. Confirm state
is ignored by version control, that the ignore rule is not defeated by a
variable-file exception, and that a committed lock file is the dependency lock
(which belongs in the repo) rather than state (which never does).

The remedies have moved, and a review citing only "use a remote backend" is
several years out of date:

- **OpenTofu 1.7+ encrypts state *and* plan files client-side** (AES-GCM, keyed
  by a passphrase or by AWS KMS, GCP KMS, Azure Key Vault or OpenBao). It is
  **off until configured**, so on an OpenTofu project its *absence* is a finding
  rather than an acceptable default.
- **Terraform has no client-side equivalent** and depends on the backend, which
  protects the stored copy and not much else: a local state file, or a plan file
  handed to a CI job as an artifact, is still plaintext.
- **Best is never putting the value in state at all** — ephemeral resources and
  write-only arguments (Terraform 1.11+), the same mechanism D3 reaches for.

**D6. Blanket log suppression is blunt and has a cost.** Marking a task `no_log`
keeps a rendered credential out of the run's output — necessary — but it also
censors that task's **diff**, and the mechanism is exactly as blunt as it
sounds: the whole task result is replaced with a `censored` marker preserving
only `changed`, `attempts` and `retries`, so the diff never reaches the callback
at all. A check-mode run then reports *that* the file changed without showing
*how*, and an operator reads a censored diff as a clean one.

Reach for the narrower control first. Ansible documents that "because the
`--diff` option can reveal sensitive information, you can disable it for a task
by specifying `diff: false`" — and its own example is a template task rendering
a secret, which is precisely this case. Use `diff: false` where the secret
appears only in the *diff*, and save `no_log` for where it appears in the
module's **return value**, which `diff: false` does not touch.

Two caveats on `no_log` itself, both arguing against leaning on it:

- it is not a dependable diff censor — modules have shipped bugs where `--diff`
  output escaped it, so treat it as a policy rather than a boundary;
- it never affects `-vvv` debug output, so a verbose run or a support-bundle
  capture can still print the value.

Better than either: split the secret into its own small file, so the bulk of the
configuration stays fully diffable and only the one-line credential file is
suppressed. Where a whole task must still be suppressed, say in the runbook that
drift in that file is detected but not displayed.

## Secrets management for infrastructure

**K1. Rank by blast radius: account-scoped beats machine-scoped.** A cloud
provider API token, a VPN account token, or a CI platform token with
administration scope compromises everything under that account — and
**re-provisioning does not rotate it**. Destroy and rebuild and you get a clean
box that still trusts the same leaked token. When both appear in one finding,
the account-scoped one sets the severity.

The machine-scoped half needs a caveat, because as usually stated it contradicts
S5. "A per-machine credential is bounded by the machine and genuinely is rotated
by a rebuild" is true of a *generated* one — a host key is regenerated on first
boot — and **false of one supplied as an input**, which is exactly what S5
requires a service password to be. The rebuild reinstalls the identical leaked
value from the same secrets store. Ask which kind it is before crediting a
rebuild with rotation; where the value is input-supplied, the finding stays open
until the copy in the store is changed.

Then a pivot check, because "bounded by the machine" is a claim about the
machine's *reach*, not its size. A box holding a provider API token, carrying an
attached instance role, or merely able to reach the metadata endpoint (K5) is
not bounded by itself: compromise of it is compromise of whatever those
credentials reach, and the finding inherits account-scoped severity.

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

**K4. Prefer short-lived and derived over stored — and name the mechanism.**
Where a platform mints a short-lived registration or deployment token from a
longer-lived one, fetch it at use and persist it nowhere. "Supports workload
identity" is too vague for a reviewer to act on, so resolve it to one of these
and check for that:

- **OIDC federation from CI to the cloud provider**, against a trust policy
  scoped to the repository and ref. This replaces a long-lived access key
  sitting in repository secrets, which is the most common finding in this class.
- **An attached instance role**, read from the metadata service at the moment of
  use, instead of a static token written into an environment file on the box.
  K5 governs how that endpoint then has to be locked down.
- **A secrets manager's dynamic-secret or database backend**, issuing a
  credential per run under a lease that expires on its own.
- **SPIFFE/SPIRE SVIDs**, where a service mesh already issues workload
  identities.

If none of them apply, say so in the finding. "No federation is available for
this provider and CI combination, so a static token is the only option; it is
scoped to X and rotated on Y" is a defensible answer. An unexamined static token
is not.

**K5. The instance metadata service is a credential endpoint, and any outbound
fetch on the box can reach it.** `169.254.169.254` answers anything running on
the instance, authenticated by nothing more than being on the instance. Where
the instance carries an attached role, that endpoint hands out live cloud
credentials.

The consequence is the standard escalation path for this stack: a component that
fetches a URL on someone else's behalf — a forward proxy configured to fetch
arbitrary URLs, a webhook handler, a script curling a caller-supplied address —
will fetch *that* URL too if asked. That is the whole distance from "someone got
a request through your service" to "someone has your cloud account", and it
converts every machine-scoped finding in K1 into an account-scoped one.

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

N4 legitimately reads this same endpoint to discover the instance's own public
address, and that is not in tension with this rule: a provisioning script
running as root reading it is fine. The control is that nothing *else* on the
box can be induced to read it on an outsider's behalf.
