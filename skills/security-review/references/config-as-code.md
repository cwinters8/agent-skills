# Configuration management and infrastructure-as-code

Load this when `## Stack` names `config-as-code`. It covers the declarative
layer — configuration management (Ansible and peers) and infrastructure-as-code
(Terraform/OpenTofu and peers) — and the rules are lettered **D** for
*declarative*. What fails here is rarely the run: it is a run that reports
success while the file it rendered, the state it wrote, or the check that
approved it says something other than what the reviewer read in the repository.

## Reading the six groups

If `## Stack` also names `infra-provisioning`, read that module's *Reading the
six groups for infrastructure* table first — it is the full translation of
`SKILL.md`'s group names onto a machine, and it is kept in one place so it
cannot drift. The two readings this module turns on: what the run **writes to
disk on the target**, at what mode, and what it **prints** to an operator's
terminal or a CI job log, is `client-data`; what it **downloads and executes**
is `supply-chain`.

## Rules

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
The AWS-shaped version of the egress trap in `references/cloud-network.md` → N1
belongs here, because it is the IaC layer's behavior and not the cloud's: AWS
creates a new security group *with* an allow-all egress rule, and Terraform's
`aws_security_group` **deletes that rule on create**. A group declared with only
`ingress` blocks therefore ends up default-deny outbound, even though the
console-created equivalent would not. The code says nothing about egress, the
provider's documented default says traffic is allowed, and the resulting group
blocks it. Read the *resource's* documented defaults, not the provider's,
whenever a review turns on "what happens if the configuration says nothing".

**D3. Templates over in-place edits, rendered deterministically — and do not pay
for that with the salt.** This is `references/infra-provisioning.md` → P8 for
the declarative layer plus one property: a run that changes nothing must
*report* nothing changed, or drift detection is unusable. Anything
non-deterministic in a rendered file — a timestamp, a random salt, an unordered
mapping — makes every run report a change and trains the operator to ignore the
output.

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
   where the project keeps secrets (`references/infra-provisioning.md` → P14),
   and template the *stored* copy on every later run. Ansible's
   `lookup('password', …)` does this in-band and documents that it "forces
   saving the salt value for idempotence" when asked for a hash.
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

**D5. State files and plan output are credential material.** Where such a value
lives at rest is `references/infra-provisioning.md` → P14's question, asked here
of a file the tool wrote rather than one anybody filed. Terraform's own
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
