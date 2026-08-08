# Cloud firewalls and network controls

Load this when `## Stack` names `cloud-network`. It covers the provider-managed
layer that decides what can reach a machine at all: cloud firewalls, VPCs and
network ACLs, just-in-time rule automation, and the addresses those rules are
pinned to. A rule here is applied by the provider rather than by the host, so it
is the one control that still holds when the box itself is misconfigured — and
the one whose failure modes are hardest to see, because a wrong rule and a right
one read identically in a diff.

**Provider defaults differ, and several rules below turn on one.** Where a rule
names a provider, it is because the behavior is that provider's and demonstrably
not the others'. One provider's behavior restated as general truth is how a
reviewer comes to "verify" a control that never existed, or to tighten a rule
that was holding the box together. Establish which provider is in play, and
which of its defaults are in force, before applying any N-series rule.

## Reading the six groups

A `## Stack` naming this module names `infra-provisioning` too, so read that
module's *Reading the six groups for infrastructure* table first — it is the
full translation of `SKILL.md`'s group names onto a machine, kept in one place
so it cannot drift, and the N-series below is written against it. That holds
here without qualification, because this module's subject *is* a machine's
reachability: naming it asserts there is a box behind the firewall, and a
project with no box has nothing for N1–N5 to review either.

The reading this module turns on: **reachability is filed under `auth-session`**,
because it travels with the credential it fronts. It is not there because a
firewall authenticates anything — a source address identifies a path, not a
principal, so "the port is filtered" never upgrades a service that has no
credential. That argument is stated once, with the standards framing behind it,
in `references/infra-provisioning.md`'s same section; the one-line version here
is a reminder, and a refinement belongs there rather than in both.

If that module was not loaded anyway, apply the N-series regardless and say in
the report which group each finding was filed under and that the translation was
unavailable — an improvised mapping a reader can see is fine, one they cannot
distinguish from the canonical one is not.

## Rules

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
IaC layer's; it lives in `references/config-as-code.md`, with D2.

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
Three independent problems. The third does the most damage where it lands, and
only half of it is conditional on how the automation talks to the provider — so
establish that before reporting that half.

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
  enclosing firewall, not on the rule — so "expire anything older than N
  minutes" is not merely unenforced, it is *inexpressible*. There is nothing on
  the rule to compare a clock against, and nothing to tell one job's rule from
  another job's, or from a rule somebody added deliberately.

**Check which API path the automation takes.** The pattern's worst failure —
**two concurrent jobs clobbering each other's rules** — is real, but it is a
property of the *whole-firewall update* path rather than of the provider, and
the provider offers both paths. Read the automation and decide which one it
drives before reporting a clobber — then read the third bullet, because
concurrency has a second failure that neither path fixes.

- **The whole-firewall update is the racy path.** `PUT /v2/firewalls/{id}`,
  `doctl compute firewall update`, and any declarative infrastructure resource
  that manages the firewall as a single unit all send a full representation:
  "the request should contain a full representation of the firewall including
  existing attributes… any attributes that are not provided will be reset to
  their default values." Changing one rule therefore does mean reading the
  current array, modifying it, and writing all of it back — and that is the
  race. Job A reads the array, job B reads the same array, both write, and
  whichever writes last erases the other's rule. The same race lets a cleanup
  step silently *reopen* a rule another job just closed, by writing back an
  array it read before the close. The failure is non-deterministic, invisible,
  and produces precisely the leak the cleanup step exists to prevent. The fix
  is the next bullet, not a lock around the job.
- **The dedicated rules endpoints are not.** `POST /v2/firewalls/{id}/rules`
  and `DELETE /v2/firewalls/{id}/rules` each take a list of rules to add or to
  remove and return `204` with no body; `doctl compute firewall add-rules` and
  `remove-rules` wrap them. Neither reads anything first. The missing rule id
  is exactly *why* those endpoints address rules by value — send the rule you
  want gone and the provider drops that rule and leaves the rest alone — which
  makes delete-by-value the race-free path rather than the impossible one. A
  project already on these endpoints does not have the clobbering bug, and
  reporting that one there is a false positive; false positives cost the gate
  its credibility. It may still have the next one.
- **Neither path survives two jobs sharing a source address.** The missing rule
  id cuts both ways. It is what lets these endpoints address a rule by value,
  and it is also what makes a rule unattributable — so when two runs come from
  one address (self-hosted runners behind a single NAT, or two runs drawn from
  the same hosted egress range) they do not each get a rule, they *both* ask
  for the identical tuple, and nothing in the firewall records whose it is. The
  provider does not document whether a second identical add stores a second
  copy or collapses into one, and neither answer rescues the pattern: collapsed,
  the first job's cleanup deletes the only rule while the second job is still
  using it; kept, the `DELETE` names a value rather than an instance, so nothing
  promises it removes one copy rather than both — and the copies are
  interchangeable anyway. The symptom is the reverse of the leak this rule opens
  with: a run whose access is withdrawn partway through, at a moment set by
  another run's schedule. AWS makes the same collision loud rather than silent —
  a duplicate authorization is refused with `InvalidPermission.Duplicate`, so
  the second job fails at its own open step, and if it shrugs that off and
  continues, the first job's revoke strands it exactly the same way. Report this
  wherever concurrent runs can share a source, and require one of: a distinct
  source per job, a lock serializing the runs, or the stable identity below,
  which dissolves the question by adding no per-job rule at all.

What leaks when it does go wrong is SSH open to an address the project does not
control, indefinitely, with nothing distinguishing it from a deliberate rule.

**Prefer a stable identity.** A long-lived runner carrying a provider tag, and
one static rule whose source is that tag. That removes the IP detection, the
reaper, whichever API path the job was driving, and — worth stating explicitly —
the cloud-provider API token from CI entirely, since no job needs to mutate
infrastructure any more.

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
endpoint as the credential surface it also is —
`references/infra-provisioning.md` → P16 is the other half of this rule.

Keep the assertion, and relabel it. Rejecting a loopback, RFC1918, link-local or
RFC 6598 (`100.64.0.0/10`) answer is a **routability test**, not a NAT detector,
and the difference is not pedantic: AWS permits publicly-routable CIDRs inside a
VPC, and `100.64.0.0/10` is a common secondary CIDR for pod networking, so the
identical result is correct on one account and a bug on another. Publishing a
non-routable value as an endpoint is worse than failing
(`references/infra-provisioning.md` → P11) — so assert routability, fail closed,
and do not claim the assertion tells you whether NAT is in play.

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
   as `references/infra-provisioning.md` → P11: an unverified control is a
   false belief, and this one is only ever tested on the day it is needed. A
   break-glass path requiring a password nobody ever set — or ever logged in
   with — is not a break-glass path. Log in through it once, deliberately,
   before relying on it.
3. **Keep a second, independent ingress source**, so one provider's outage is
   not a total lockout. A pinned address whose only fallback is that same
   provider's console is one failure domain wearing two hats.
4. **Say where the provider API token lives during a recovery.** If the only
   copy is on the box you are locked out of, the recovery path is circular. It
   belongs wherever the project keeps secrets
   (`references/infra-provisioning.md` → P14), reachable from a machine that is
   not the failed host.

This also connects to `references/infra-provisioning.md` → P12: a dedicated
egress address is normally a paid subscription feature, so a lapsed payment or a
cancelled account revokes the address and locks everyone out — a billing event
with the blast radius of a firewall change.
