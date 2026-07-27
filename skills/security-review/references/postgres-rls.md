# Postgres row-level security

Load this when `## Stack` names `postgres-rls`. It covers Postgres RLS and the
PostgREST-style APIs built on it (Supabase and similar), where the client holds
a credential that reaches the database directly.

Read `## Identity model` for the ownership column and the row identity (primary
key) this project uses; the rules below refer to them generically.

## Rules

**R1. RLS is enabled on every client-reachable table.** The qualifier matters
and has two halves: RLS off **and** the client holding privileges on the table.
Postgres checks table privileges before policies, so a server-only table with no
grant to `anon`, `authenticated`, or `PUBLIC` is not exposed regardless of its
RLS state — flagging it is noise.

Default to treating an RLS-off table as reachable unless the grants say
otherwise: Supabase configures default privileges that grant new tables in
`public` to `anon` and `authenticated`, so a migration that never writes a
`grant` line still commonly produces a reachable table. Correlate the two with
the first query below rather than reading `relrowsecurity` alone. Adding a table
is the single most likely way a project of this shape grows a hole.

**R2. The *combined* policy expression scopes rows by the authenticated user.**
Postgres combines **permissive** policies with `OR` and **restrictive** ones with
`AND`, so the unit to judge is the whole set for a given command, not each
policy in isolation:

- A **permissive** policy widens access. One with `using (true)` destroys the
  boundary no matter how correct its siblings are, because it ORs in every row.
- A **restrictive** policy only ever narrows. It does not need to repeat the
  ownership test — an ownership-scoped permissive policy plus a restrictive
  status constraint is tenant-safe, and flagging the restrictive one for lacking
  `auth.uid()` is a false positive.

**Combine per role, not just per command.** Policies carry a `roles` list, and a
restrictive policy only narrows the roles it names. A permissive `using (true)`
for `authenticated` is *not* rescued by a restrictive ownership policy scoped to
`admin` — merging every row for the command would call that setup safe. Group by
`(command, role)`, evaluate the permissive-OR / restrictive-AND expression within
each group, and remember role membership: a policy naming a group role also binds
every role inheriting it. The roles that matter are the ones the shipped
credential can assume — typically `anon` and `authenticated`.

The policy query below returns `permissive` and `roles` for exactly this reason;
a review that ignores either column cannot tell these cases apart.

**R3. `UPDATE` policies constrain the row *after* the write, not just before.**
`using` decides which rows you may target; `with check` decides what the row is
allowed to look like once written. The risk is a user setting the ownership
column to someone else's id and moving a row out of their account into another
user's.

Read the *effective* new-row check, not the presence of a clause. **PostgreSQL
falls back to the `using` expression as the `with check` expression when
`with check` is omitted**, so an omitted clause is not itself a defect — with
`using ((select auth.uid()) = user_id)`, the ownership transfer above is already
rejected. Writing `with check` explicitly is a readability recommendation: it
states the intent instead of leaving a reader to recall the fallback rule.

The actual defect is an effective new-row check that permits a foreign owner id
— a `using (true)`, a check scoped to something other than ownership, or an
explicit `with check` looser than the `using` it accompanies. Flag those; don't
flag a null `with_check` on sight.

**R4. The effective insert check scopes new rows to the caller.** How to read it
depends on the policy's command, and the R3 fallback applies here too:

- A **`for insert`** policy has no `using` clause at all — Postgres rejects one
  — so `with check` is the only clause and must carry the ownership test. A
  missing `with check` on a `for insert` policy is a real finding.
- A **`for all`** policy governs inserts as well, and when it omits `with check`,
  its `using` expression becomes the effective new-row check. So
  `for all using ((select auth.uid()) = user_id)` is already safe; flagging it
  for a missing clause is the same false positive R3 warns about.

Evaluate the effective check, not the presence of a keyword.

**R5. No `anon` or `PUBLIC` grants.** `authenticated` only, unless a public read
is a deliberate product decision.

**R6. Grants are minimal.** No `grant all`, nothing to `postgres`/`service_role`
that the client path can reach, and `authenticated` holds only
SELECT/INSERT/UPDATE/DELETE — not TRUNCATE, which no RLS policy constrains.

**R7. Client-supplied owner ids are untrusted input.** A client that upserts
`{ user_id: <value>, … }` chooses that value. The `with check` expression is the
only reason it can't be an arbitrary uuid. Never "simplify" a policy on the
grounds that the app always sends the right id. Consider `default auth.uid()` on
the column as defense in depth.

**R8. Views and functions bypass RLS by default.** A `security definer` function
runs as its owner, and a view runs as the *view owner* unless created with
`security_invoker = on` — either one silently returns other users' rows through a
table whose policies look perfect. Check both whenever SQL is added. Materialized
views cannot carry RLS at all.

**R9. The deployed database matches the migrations.** Reviewing migrations proves
what *should* be true. Policies can be edited in a dashboard, and a migration can
be written but never applied. Before a release, verify against the live database.

**R10. Server-authoritative timestamps stay server-authoritative.** An
`updated_at` trigger exists so a client can't forge merge ordering and overwrite
a newer value. Dropping it is a data-integrity regression, not a cleanup.

## Live audit queries

Reading SQL is necessary but not sufficient — R9 exists because the file and the
database can disagree. For a full sweep, run these in the SQL editor (ask the
maintainer to run them and paste results if the session has no database access).

**First, find which schemas are actually exposed.** These queries are written
against `public`, but PostgREST serves whatever schemas the API settings list
(`public` and `graphql_public` by default). A client-granted table in an `api`
schema is just as reachable and would be invisible to a `public`-only audit.
Read that list first and substitute it in **every** query — tables, policies,
grants, functions, views, triggers.

```sql
-- RLS state AND client reachability together. RLS-off is only a hole if the
-- client can reach the table: Postgres still requires table privileges, so a
-- server-only table with no grants to anon/authenticated/PUBLIC is not exposed.
-- Assume reachable unless the grants column comes back empty, though — default
-- privileges commonly grant new public tables to anon and authenticated, so
-- "no explicit grant in the migration" does not mean no grant.
-- Table-level AND column-level grants: a privilege granted on individual
-- columns never appears in table_privileges, so a table reachable via
-- column-level SELECT/UPDATE would read as '(none)' and be dismissed as
-- server-only. Union both before classifying anything as unreachable.
select c.relname as table, c.relrowsecurity as rls_enabled,
       coalesce(string_agg(distinct g.grantee || ':' || g.privilege_type || g.scope, ', '), '(none)') as client_grants
from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join (
    select table_schema, table_name, grantee, privilege_type, '' as scope
      from information_schema.table_privileges
    union all
    select table_schema, table_name, grantee, privilege_type,
           ' (column:' || column_name || ')' as scope
      from information_schema.column_privileges
  ) g on g.table_schema = n.nspname and g.table_name = c.relname
     and g.grantee in ('anon', 'authenticated', 'PUBLIC')
where n.nspname = 'public' and c.relkind in ('r', 'p')
group by c.relname, c.relrowsecurity;

-- Every policy, with both clauses and its permissive/restrictive kind. Read the
-- EFFECTIVE new-row check per R3: a null with_check means Postgres reuses
-- using_clause, which is fine when that clause is the ownership test. Read the
-- COMBINED expression per R2 — permissive policies OR together, restrictive
-- ones AND — so judge the whole set per command and role, not each row alone.
select tablename, policyname, cmd, permissive, roles,
       qual as using_clause, with_check
from pg_policies where schemaname = 'public' order by tablename, cmd, permissive;

-- Grants reaching anon/PUBLIC (R5) and authenticated (R6). Use
-- table_privileges, NOT role_table_grants: the latter omits privileges held
-- via a grant to PUBLIC, which is exactly the case R5 exists to catch. PUBLIC
-- is also spelled uppercase here. anon/PUBLIC should have no rows at all;
-- authenticated should have exactly SELECT/INSERT/UPDATE/DELETE — flag
-- anything wider (TRUNCATE especially: it is not constrained by any RLS
-- policy, so granting it to authenticated lets any signed-in user erase
-- every row regardless of how correct the row policies are).
select table_name, grantee, privilege_type
from information_schema.table_privileges
where table_schema = 'public' and grantee in ('anon', 'PUBLIC', 'authenticated');

-- security definer functions and views lacking security_invoker (R8).
select p.proname, p.prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef;

-- Views AND materialized views. relkind 'm' matters as much as 'v': a
-- materialized view cannot carry RLS at all, and its stored rows were
-- populated by its privileged owner, so granting one to `authenticated`
-- exposes every user's data no matter how correct the source table's policies
-- are. Check the grants on anything listed here.
select c.relname, c.relkind, c.reloptions from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm');

-- R10: a server-authoritative timestamp trigger must actually exist, be
-- enabled, and fire for BOTH insert and update. Asserting the migration file is
-- not enough — see R9. tgenabled 'D' means disabled; pg_get_triggerdef spells
-- out the actual "BEFORE INSERT OR UPDATE" (or a partial, regressed version of
-- it) so a missing event shows up without decoding the catalog's tgtype bitmask.
select c.relname as table, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal;
```

## The behavioral probe

The decisive test is behavioral, and it is worth doing once before launch. Check
`## Probe policy` first — some projects forbid it, or allow it only against a
non-production environment.

Set up two real accounts, **A** and **B**:

- From **A**, note the row's full identity — every column of the primary key, not
  just the one that looks like the record id. Where the key is
  `(owner_id, item_id)`, the item id alone does not name A's row; every user can
  hold the same item id.
- Authenticate every request as **B**, using B's access token. Sending A's token
  proves nothing — it authorizes A's own row, and the request succeeding is
  correct behavior misread as a failure.

As B, attempt to (1) select A's rows, (2) update A's row, (3) insert a row
carrying A's owner id, (4) delete A's row.

**Probe 3 must be rejected for the right reason.** Send A's owner id with a
record id A does *not* already hold, and values that satisfy every CHECK
constraint. Reusing A's existing record id collides with the primary key and an
invalid value trips a CHECK — either produces an error with RLS wide open, so the
probe would "pass" while proving nothing. Read the returned SQLSTATE: `42501`
(insufficient privilege) or PostgREST's RLS denial is the pass; `23505` (unique
violation) and `23514` (check violation) mean the probe was malformed, not that
the boundary held.

**An empty response is only proof for the read.** PostgREST answers mutations
with `Prefer: return=minimal` by default, so a *successful* cross-account INSERT,
UPDATE, or DELETE also comes back empty — read that as a pass and the probe
reports safety while B is actively rewriting A's data. That is a false negative in
the one test the whole section exists to provide. For each write, demand positive
evidence instead:

- send `Prefer: return=representation` (or `count=exact`) so a write that
  succeeded has to show the rows it touched, and
- **re-read as A afterwards** and confirm the targeted rows are unchanged and no
  new row appeared.

The pass condition is an explicit error or zero affected rows *and* A's data
verified intact — never an empty body alone. A passing read of the SQL plus a
failing probe means R9 was the problem.

Add a fifth and sixth probe for R10, since the four above never touch it: as B,
**insert** one of B's own rows supplying a server-authoritative timestamp far in
the future, then separately **update** a B-owned row supplying a different
far-future value. Both stored values must come back as server time, not the value
sent — a single write can't tell an insert-only trigger from an update-only one
apart from a fully-working one, since the first probe passes on a fresh row
regardless of whether update is covered, and the second passes on an existing row
regardless of whether insert is covered. If either survives, the trigger is
missing, disabled, or partial for that event, and a client can forge merge
ordering on that path to overwrite a newer value from another device — invisible
to every other check here.
