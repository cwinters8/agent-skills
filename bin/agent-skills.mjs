#!/usr/bin/env node
// Vendor the shared Claude Code skills into a consumer repo's .claude/skills/.
//
//   agent-skills sync            write the vendored copies
//   agent-skills sync --check    verify without writing; non-zero on drift
//   agent-skills sync --force    overwrite locally-edited vendored files
//
// Typically run without installing:
//
//   npx -y github:cwinters8/agent-skills#v1 sync
//
// The skills ship inside this package, so the version you invoke IS the version
// you vendor — there is no second pin. `.claude/skills.json` says which skills a
// repo wants and records what was written; it does not name a ref, because the
// npx spec in the consumer's package.json is the only content pin.
//
// Skills are copied into the repo and committed rather than fetched at session
// start, so they exist on a session's first turn, appear in PR diffs, and need
// no network once vendored.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  lstatSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const packageSkills = join(packageRoot, 'skills');
const schemaPath = join(packageRoot, 'profile-schema.json');

const repoRoot = process.cwd();
const lockPath = join(repoRoot, '.claude', 'skills.json');
const skillsDir = join(repoRoot, '.claude', 'skills');
const profilePath = join(repoRoot, '.claude', 'project-profile.md');

const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith('--')) ?? 'sync';
const check = argv.includes('--check');
const force = argv.includes('--force');

const die = (message) => {
  console.error(`agent-skills: ${message}`);
  process.exit(1);
};

const usage = () => {
  console.error('usage: agent-skills sync [--check] [--force]');
  console.error('       agent-skills init [skill...]');
  console.error('       agent-skills check-profile');
  console.error('       agent-skills list');
  process.exit(2);
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const bannerText = `<!-- vendored from ${pkg.name}@${pkg.version} — edit upstream, then re-run the sync -->`;

// A vendored SKILL.md carries a provenance banner this tool inserts, so the
// on-disk file never equals its packaged original. Compare and lock the
// banner-stripped content, or every run would see drift and re-copy.
const BANNER = /^<!-- vendored from .*? -->\n/m;
const canonical = (buffer) => sha256(Buffer.from(buffer.toString('utf8').replace(BANNER, '')));

// Every regular file in a skill directory, relative to it, sorted for a stable
// lock. Symlinks are skipped: they would hash as nothing and copy verbatim,
// putting a link to an arbitrary path inside .claude/skills/.
const walk = (dir, base = dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relative(base, full));
  }
  return out.sort();
};

// Everything under a directory, including the symlinks and empty directories
// walk() omits. The deletion guard has to see strictly more than the copier
// does: walk() skips a symlink so it is never hashed or copied, and never
// yields a directory holding no file — but the write step rms the tree
// recursively, so every entry walk() cannot see is destroyed silently, which
// is the class of loss the guard exists to refuse. Hashing and copying still
// go through walk(); only this enumeration is wider.
//
// Each entry carries its `kind`, and that is deliberate rather than
// convenient. Every guard downstream has to decide by what an entry *is* — a
// pathname is not evidence of a type, since a consumer can put a file where a
// directory belongs, or a symlink where either does — and each time that
// information was left to be re-derived at the call site, a call site forgot.
// Returning it with the path makes forgetting take an explicit `kind` check
// rather than an omitted one.
const walkAll = (dir, base = dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(base, full);
    // Dirent types come from lstat, so a link to a directory lands here and not
    // in the branch below — which is what keeps the walk from descending it.
    if (entry.isSymbolicLink()) out.push({ rel, kind: 'symlink' });
    else if (entry.isDirectory()) {
      const inner = walkAll(full, base);
      // A directory holding nothing is itself the thing that would be lost, so
      // it stands in for its absent contents.
      if (inner.length === 0) out.push({ rel, kind: 'dir' });
      else out.push(...inner);
    } else out.push({ rel, kind: 'file' });
  }
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
};

// lstat, never stat: every other check on these paths follows links, which is
// precisely what hides a link from them. Absent counts as not-a-link — that is
// the normal first-sync case.
const isSymlink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const available = () =>
  readdirSync(packageSkills, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packageSkills, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();

// The directory every write below goes through. Guarding the children is not
// enough: if `.claude` is itself a symlink, mkdirSync follows it and succeeds,
// every child path then resolves inside the link's target, and each per-file
// check sees an ordinary absent path and writes. The result is `init`
// scaffolding into another location — or `sync` deleting and rewriting a skills
// tree there — while both report the in-repo names they were asked about. A
// guard one level below the thing being followed cannot see the following.
//
// `list` is exempt: it reads the package and never touches the repo.
if (command !== 'list') {
  const claudeDir = join(repoRoot, '.claude');
  if (isSymlink(claudeDir)) {
    die(
      '.claude is a symlink — refusing to read or write through it, because every path ' +
        'below it would resolve somewhere this command cannot honestly report. ' +
        'Replace it with a real directory.',
    );
  }
  // Not-a-symlink is not the same as is-a-directory. A regular file here reached
  // init's recursive mkdir and died on an uncaught EEXIST — a stack trace where
  // this command has a refusal for every other shape at every other path.
  if (existsSync(claudeDir) && !statSync(claudeDir).isDirectory()) {
    die('.claude exists but is not a directory — nothing can be read or written under it.');
  }
}

if (command === 'list') {
  console.log(`@cwinters8/agent-skills ${pkg.version} ships:`);
  for (const name of available()) console.log(`  ${name}`);
  process.exit(0);
}

// `init` scaffolds the two files a consumer owns, so it is the one command that
// must run before .claude/skills.json exists. It deliberately does NOT sync:
// the profile it writes is still a template full of placeholders, and a sync
// would fail validation on it. Write, then let the adopter fill it in.
if (command === 'init') {
  const requested = argv.filter((a) => !a.startsWith('--') && a !== 'init');
  // Dedupe: a repeated name is a typo, not a request for two copies, and it
  // does lasting damage if it reaches the file. Every later stage keys on the
  // name, so a duplicate makes the banner pass insert the banner twice into one
  // file, canonical() strips only the first, and the skill then reads as
  // locally edited on every subsequent sync — a repo that refuses to sync and
  // cannot be repaired with --force, which recreates the same double banner.
  const skills = [...new Set(requested.length ? requested : available())];
  const unknown = skills.filter((s) => !available().includes(s));
  if (unknown.length) {
    die(`unknown skill${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')} — available: ${available().join(', ')}`);
  }

  // Never overwrite. A second `init` in a configured repo would otherwise
  // discard a filled-in profile, and the adopter's own work is the expensive
  // part of adoption — the scaffolding is the cheap part.
  const wrote = [];
  const kept = [];
  const links = [];
  const blocked = [];
  mkdirSync(join(repoRoot, '.claude'), { recursive: true });

  // Scaffold one file, deciding by what is at the path rather than by whether
  // reading it would succeed. existsSync follows links and so reports a
  // *dangling* symlink as absent — after which writeFileSync follows it too and
  // creates the link's target, which need not be in this repository at all.
  // That is a write outside the tree reported as ".claude/…: wrote", the worst
  // combination available. A link is something the adopter put there
  // deliberately; neither writing through it nor silently calling it fine is
  // right, so name it and leave it alone.
  const scaffold = (path, label, write) => {
    if (isSymlink(path)) {
      links.push(label);
      return;
    }
    if (existsSync(path)) {
      // "Kept" has to mean the adopter's own file is there, not merely that
      // something occupies the name. A directory at either of these paths makes
      // the repo unusable — sync reads one as JSON and validates the other as
      // the profile — so recording it as kept would report an initialization
      // that cannot work, and the failure would surface one command later
      // against a file init said was fine.
      if (!statSync(path).isFile()) blocked.push(label);
      else kept.push(label);
      return;
    }
    write();
    wrote.push(label);
  };

  scaffold(lockPath, '.claude/skills.json', () =>
    writeFileSync(lockPath, `${JSON.stringify({ skills }, null, 2)}\n`),
  );

  // Warn where the adopter can still act on it: a directory already sitting
  // under .claude/skills/ with a name this package also ships is almost
  // certainly a locally authored skill, and listing that name means the next
  // sync tries to vendor over it. sync refuses, but saying so here is cheaper
  // than a failed sync the adopter has to interpret.
  const collisions = skills.filter((s2) => existsSync(join(skillsDir, s2)));

  scaffold(profilePath, '.claude/project-profile.md', () =>
    copyFileSync(join(packageRoot, 'templates', 'project-profile.md'), profilePath),
  );

  for (const f of wrote) console.log(`agent-skills: wrote ${f}`);
  for (const f of kept) console.log(`agent-skills: kept existing ${f}`);
  for (const f of links) {
    console.error(`agent-skills: ${f} is a symlink — left alone, nothing written through it`);
  }
  for (const f of blocked) {
    console.error(`agent-skills: ${f} exists but is not a regular file — nothing written, and sync cannot read it`);
  }
  if (collisions.length) {
    console.log('');
    console.log('agent-skills: these names already exist under .claude/skills/ and are listed:');
    for (const c of collisions) console.log(`  ${c}`);
    console.log('  If those are your own skills, rename them or drop the name from');
    console.log('  .claude/skills.json — sync will refuse to overwrite them either way.');
  }
  console.log('');
  console.log('Next: fill in .claude/project-profile.md — every TODO must be replaced.');
  console.log('Then: agent-skills sync    (validates the profile and vendors the skills)');
  console.log('');
  console.log('An agent can do the whole thing: see "Adopting in a new repo" in the');
  console.log(`${pkg.name} README for a prompt to hand it.`);
  // A link that blocked scaffolding means a file init exists to create does not
  // exist, so the run did not do its job — and the next `sync` fails on the
  // missing lock regardless. Exiting zero there tells a script the adoption
  // succeeded and leaves the failure to surface one command later, detached
  // from its cause. Refusing to write through the link was the right call;
  // reporting success afterwards would undo the point of it.
  process.exit(links.length || blocked.length ? 1 : 0);
}

if (command !== 'sync' && command !== 'check-profile') usage();

if (!existsSync(lockPath)) {
  console.error(`agent-skills: no .claude/skills.json in ${repoRoot}`);
  console.error('create one naming the skills this repo wants:');
  console.error(`  { "skills": ${JSON.stringify(available())} }`);
  console.error('or run: agent-skills init');
  process.exit(1);
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
if (!Array.isArray(lock.skills) || lock.skills.length === 0) {
  die('.claude/skills.json needs a non-empty "skills" array');
}
// Dedupe here as well as in `init`, because this file is hand-written at least
// as often as it is scaffolded — the README tells adopters to write it — and a
// duplicate name is unrecoverable once synced: the banner pass keys on the name
// and would stamp one file twice, after which canonical() strips only the first
// banner and the skill reads as locally edited forever. Normalizing on read
// makes that true of every path into the file, not just the one command.
const duplicateNames = [...new Set(lock.skills.filter((s, i) => lock.skills.indexOf(s) !== i))];
if (duplicateNames.length) lock.skills = [...new Set(lock.skills)];

// A ref here would be a second content pin competing with the npx spec, and the
// two can disagree silently — bumping the one that is ignored looks like an
// upstream with no changes. Fail loudly instead of ignoring it.
for (const stale of ['ref', 'source', 'commit']) {
  if (stale in lock) {
    die(
      `.claude/skills.json has a "${stale}" field, which this version no longer reads.\n` +
        '  Skills ship inside the package, so the npx spec in your package.json is the only\n' +
        '  content pin. Remove the field to avoid two pins that can disagree.',
    );
  }
}

if (command === 'check-profile') {
  const result = validateProfile();
  for (const line of result.lines) (result.ok ? process.stdout : process.stderr).write(`${line}\n`);
  process.exit(result.ok ? 0 : 1);
}

// Skill names are interpolated into paths this tool then deletes and writes.
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/;
for (const skill of lock.skills) {
  if (typeof skill !== 'string' || !SKILL_NAME.test(skill) || skill.includes('..')) {
    die(`invalid skill name ${JSON.stringify(skill)} — expected a plain directory name`);
  }
}

const problems = [];
const nextFiles = {};
const plan = [];

// A duplicate name is drift in the file, not something to normalize away in
// memory and forget. The deduped list above is what this run uses — the write
// path needs it, since a name appearing twice would stamp one SKILL.md with two
// provenance banners and leave it reading as locally edited forever. But
// --check writes nothing, so silently normalizing there would report the repo
// up to date while the duplicate stayed on disk, which is exactly the promise
// --check makes and would be breaking. Reporting it means CI fails until a real
// sync rewrites the lock.
for (const name of duplicateNames) {
  problems.push(`${name}: listed more than once in .claude/skills.json — run a sync to rewrite the lock`);
}

// Scan every skill before writing any of them. Deciding and writing in one pass
// would overwrite the skills listed before a hand-edited one and then abort,
// leaving the tree half-synced and the lock stale.
for (const skill of lock.skills) {
  const from = join(packageSkills, skill);
  if (!existsSync(from) || !statSync(from).isDirectory()) {
    die(`"${skill}" is not in @cwinters8/agent-skills ${pkg.version} — available: ${available().join(', ')}`);
  }
  const to = join(skillsDir, skill);
  const files = walk(from);
  plan.push({ from, to, files });

  for (const rel of files) {
    const key = `${skill}/${rel}`;
    const upstreamHash = sha256(readFileSync(join(from, rel)));
    nextFiles[key] = upstreamHash;

    const localPath = join(to, rel);
    const localHash = existsSync(localPath) ? canonical(readFileSync(localPath)) : null;
    const lockedHash = lock.files?.[key] ?? null;

    if (localHash === upstreamHash) {
      // The content hash is banner-stripped, so a deleted banner is invisible to
      // it — the file would read as current while looking locally authored.
      // Check for the banner's presence as its own condition. Presence, not exact
      // text: a banner naming an older version is already reported by the version
      // comparison below, and flagging both would put a redundant line against
      // every unchanged skill on every version bump.
      if (rel === 'SKILL.md' && !BANNER.test(readFileSync(localPath, 'utf8'))) {
        problems.push(`${key}: provenance banner missing — re-run the sync to restore it`);
      }
      continue;
    }

    // A local file differing from the package was either hand-edited after a
    // sync (the lock knows it) or was never ours to begin with (the lock does
    // not). Both must refuse; the second is the dangerous one, because a repo
    // that hand-wrote its own skill under a name this package also ships has no
    // lock entry at all, and treating "no entry" as "out of date" hands it
    // straight to the overwrite below.
    if (localHash !== null && localHash !== lockedHash && !force) {
      problems.push(
        lockedHash === null
          ? `${key}: present but not vendored by this tool — refusing to overwrite`
          : `${key}: edited locally — fix it upstream and re-sync, or pass --force to discard`,
      );
      continue;
    }
    problems.push(localHash === null ? `${key}: missing` : `${key}: out of date`);
  }

  // The skill directory itself, on its own terms. Everything below enumerates
  // what is *under* `to` and so structurally cannot see `to`: a skill directory
  // that is a symlink has nothing beneath it to report if its target is empty,
  // and if the link dangles, existsSync follows it and reports the whole
  // directory absent. Both read as "nothing here to protect" while the write
  // step's recursive rm replaces the link. lstat, because every other check on
  // this path follows links and that is exactly what hides this one.
  // Classify the target once, without following links, and let everything below
  // assume a real directory. Three things can sit at this path and only one of
  // them can be walked: a directory, a symlink, or a plain file. existsSync
  // answers none of that — it says yes to all three and follows links besides.
  const targetIsSymlink = isSymlink(to);
  const targetIsDir = !targetIsSymlink && existsSync(to) && statSync(to).isDirectory();
  const targetExists = targetIsSymlink || existsSync(to);

  if (targetExists && !targetIsDir) {
    // Refuse, but only refuse — do not `continue` under --force. The write
    // step's recursive rm handles either shape, and skipping it there left the
    // one path --force could not repair: a plain file here used to reach
    // walkAll, where readdirSync throws ENOTDIR, so the run died on an internal
    // stack trace instead of producing this refusal, with or without the flag.
    if (!force) {
      problems.push(
        targetIsSymlink
          ? `${skill}: the skill directory is a symlink, not something this tool vendored — refusing to replace it`
          : `${skill}: exists as a file, not a directory this tool vendored — refusing to replace it`,
      );
      continue;
    }
  }

  // Does the package ship, or the lock record, any file beneath this path?
  // Only meaningful for a directory: it is what separates our own emptied
  // directory from one a consumer created.
  const shipsFilesUnder = (dirKey) =>
    Object.keys(nextFiles).some((k) => k.startsWith(`${dirKey}/`)) ||
    Object.keys(lock.files ?? {}).some((k) => k.startsWith(`${dirKey}/`));

  // The write step rms the whole directory, so anything this package does not
  // ship and the lock does not know about would be destroyed as collateral —
  // it never appears in the per-file loop above, because that iterates the
  // package's files. Enumerate the target instead, with walkAll rather than
  // walk: a locally authored symlink or an empty directory is invisible to the
  // copier by design and would otherwise pass this guard and then be removed.
  if (targetIsDir) {
    for (const { rel, kind } of walkAll(to)) {
      const key = `${skill}/${rel}`;
      // Type before pathname, every time. This tool only ever writes regular
      // files, so a symlink is never something it vendored no matter whose name
      // it wears — and occupying a shipped path is the likeliest way for one to
      // exist (a repo pointing several copies at one checkout). Both guards
      // would otherwise wave it through on the name alone: the hash check above
      // reads through the link, so a link onto the shipped content matches
      // exactly, and the exemption below matches the key. The rm then replaces
      // the link with a regular file, silently, which is the whole failure.
      if (kind === 'symlink' && !force) {
        problems.push(`${key}: a symlink, not a file this tool vendored — refusing to replace it`);
        continue;
      }
      // walkAll yields kind 'dir' only for a directory holding nothing at all,
      // and an empty directory this package ships files *into* is not local
      // content — it is our own directory with its files deleted. Refusing
      // there would block the restore of the very files the loop above just
      // reported missing. The `kind` test is load-bearing and not a formality:
      // nextFiles holds `<skill>/references/x.md` and never `<skill>/references`
      // itself, so a consumer's own *file* sitting at that path matches
      // shipsFilesUnder on the name alone, and this exemption would hand it
      // straight to the rm.
      if (kind === 'dir' && shipsFilesUnder(key)) continue;
      if (key in nextFiles || lock.files?.[key] !== undefined) continue;
      if (!force) problems.push(`${key}: not shipped by this package and not in the lock — refusing to delete`);
    }
  }
}

// Files the lock knows about that this version no longer ships: a removed or
// renamed skill file. Clean them up so a stale copy can't outlive its source.
const removed = Object.keys(lock.files ?? {}).filter(
  (key) => !(key in nextFiles) && existsSync(join(skillsDir, key)),
);
for (const key of removed) problems.push(`${key}: no longer shipped`);

// Validate the profile with the schema from this same package, so the validator
// and the skills that read the profile are always the same version.
let profileOk = true;
if (existsSync(schemaPath)) {
  const result = validateProfile();
  profileOk = result.ok;
  for (const line of result.lines) (result.ok ? process.stdout : process.stderr).write(`${line}\n`);
}

// Any problem that refuses. Matching "refusing to" rather than each exact
// phrasing: the previous form listed the three messages that existed when it
// was written, so adding a fourth refusal silently produced a problem that
// printed as advice and then let the write proceed anyway. The refusal is the
// property; the wording after it is not.
const hasEdits = problems.some((p) => p.includes('refusing to') || p.includes('edited locally'));
const staleVersion = lock.version !== pkg.version;

if (check) {
  if (problems.length === 0 && !staleVersion && profileOk) {
    console.log(`agent-skills: up to date at ${pkg.version} (${lock.skills.length} skills)`);
    process.exit(0);
  }
  if (staleVersion) {
    console.error(`agent-skills: vendored from ${lock.version ?? 'an unrecorded version'}, running ${pkg.version}`);
  }
  for (const p of problems) console.error(`  - ${p}`);
  if (!profileOk) console.error('  - project profile failed validation (above)');
  console.error('run the sync to update');
  process.exit(1);
}

if (hasEdits) {
  for (const p of problems) console.error(`  - ${p}`);
  die('refusing to overwrite or delete files this tool did not vendor — nothing was written');
}

// Past this point nothing can refuse: write the whole plan.
for (const { from, to, files } of plan) {
  // Copy the walked files rather than the directory: a blanket recursive copy
  // would reproduce symlinks that walk() deliberately skipped.
  rmSync(to, { recursive: true, force: true });
  for (const rel of files) {
    const dest = join(to, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(from, rel), dest);
  }
}
for (const key of removed) rmSync(join(skillsDir, key), { force: true });

for (const skill of lock.skills) {
  const skillFile = join(skillsDir, skill, 'SKILL.md');
  if (!existsSync(skillFile)) continue;
  const body = readFileSync(skillFile, 'utf8');
  // Insert the provenance banner right after the frontmatter block. nextFiles
  // already holds the packaged hash; the banner is stripped before comparison,
  // so it must not be folded into the recorded value.
  const end = body.indexOf('\n---', 3);
  if (!body.startsWith('---') || end === -1) continue;
  const cut = end + 4;
  writeFileSync(skillFile, `${body.slice(0, cut)}\n${bannerText}${body.slice(cut)}`);
}

writeFileSync(
  lockPath,
  `${JSON.stringify({ skills: lock.skills, version: pkg.version, files: nextFiles }, null, 2)}\n`,
);

const changed = problems.length;
console.log(
  `agent-skills: ${lock.skills.length} skills at ${pkg.version}` +
    (changed ? ` — ${changed} file${changed === 1 ? '' : 's'} updated` : ' — already current'),
);

// A vendored skill that hands off to a sibling degrades quietly when that
// sibling isn't listed: the step is skipped and only the run's own report says
// so. That is worst on an upgrade, where a skill's work moves into a NEW skill
// — coverage the repo already had disappears, with nothing in the sync diff to
// show for it. Report it here, where the skills array is in front of the person
// who can change it. Advisory only: wanting a subset is legitimate.
// A backticked name alone is NOT a handoff. Skills name each other to draw
// boundaries ("`code-review` does not chase documentation gaps"), to cite a
// shared rule, and to say what they are not — flagging those would recommend
// skills a consumer has no use for and teach them to ignore the one warning
// that matters. Match the verbs a handoff is actually written with; AGENTS.md
// documents these as the phrasing to use, so the check is a convention rather
// than a guess at intent.
// Collapse whitespace before matching. These files wrap at 80 columns, so a
// hand-off phrase splits across lines wherever it happens to fall — between the
// verb and the name, and inside a multi-word verb ("hand off / to"). Every
// literal space in the pattern was a missed hand-off until this normalized
// first; two separate rounds of that bug is enough to stop writing spaces.
const flatten = (s) => s.replace(/\s+/g, ' ');
const HANDOFF = (name) =>
  new RegExp(`(run|runs|invoke|invokes|hands? off to|defers? to)( the)? \`${name}\``, 'i');

const missingSiblings = new Map();
for (const skill of lock.skills) {
  const file = join(skillsDir, skill, 'SKILL.md');
  if (!existsSync(file)) continue;
  const body = flatten(readFileSync(file, 'utf8'));
  for (const other of available()) {
    if (other === skill || lock.skills.includes(other)) continue;
    if (!HANDOFF(other).test(body)) continue;
    if (!missingSiblings.has(other)) missingSiblings.set(other, []);
    missingSiblings.get(other).push(skill);
  }
}
if (missingSiblings.size) {
  console.log('');
  console.log('agent-skills: vendored skills hand work to skills this repo does not list:');
  for (const [other, byWhom] of [...missingSiblings].sort()) {
    console.log(`  ${other} — ${byWhom.sort().join(', ')} hands off to it`);
  }
  console.log('  Those steps will be skipped. Add them to .claude/skills.json if you want them.');
}
// The skills were written above before this check, deliberately: on a first
// adoption the profile is still the untouched template, and the adopter needs
// the vendored `skills-adopt` on disk to be told how to fill it in. So this exit
// is non-zero (unattended callers must still see a failure) but it is a normal
// step of adoption, not a broken sync — say which of the two this is.
if (!profileOk) {
  const untouched = validateProfile().lines.filter((l) => l.includes('template text')).length;
  if (untouched > 1) {
    console.error('');
    console.error('agent-skills: the skills are vendored, but the profile is still the template.');
    console.error('  That is expected on a first adoption — fill it in, then re-run the sync.');
    console.error(`  The vendored skills-adopt skill walks through it, if you listed it.`);
    process.exit(1);
  }
  die('vendored skills are current, but the project profile failed validation');
}

// --- profile validation -----------------------------------------------------

function validateProfile() {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const lines = [];
  const rel = relative(repoRoot, profilePath) || profilePath;

  let source;
  try {
    source = readFileSync(profilePath, 'utf8');
  } catch {
    return {
      ok: false,
      lines: [
        `${rel}: not found`,
        `  copy templates/project-profile.md from ${pkg.name} and fill it in`,
      ],
    };
  }

  // Parse H2 headings and the body under each. Fenced code blocks are skipped so
  // a "## " line inside an example doesn't register as a section.
  const sections = new Map();
  let current = null;
  let inFence = false;
  for (const line of source.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = !inFence && line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1];
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }

  const known = new Set(schema.sections.map((s) => s.heading));
  const problems = [];

  const isRequired = (section) => {
    if (section.required) return true;
    if (!section.requiredWith) return false;
    return section.requiredWith.some((skill) => lock.skills.includes(skill));
  };

  for (const section of schema.sections) {
    const body = sections.get(section.heading);
    if (body === undefined) {
      if (isRequired(section)) {
        problems.push(`missing required section "## ${section.heading}" — ${section.supplies}`);
      }
      continue;
    }
    const text = body.join('\n').trim();
    if (!text) {
      problems.push(`section "## ${section.heading}" is empty — ${section.supplies}`);
      continue;
    }
    const marker = schema.placeholderMarkers.find((m) => text.includes(m));
    if (marker) {
      problems.push(`section "## ${section.heading}" still holds template text (found "${marker}")`);
    }
  }

  for (const heading of sections.keys()) {
    if (!known.has(heading)) {
      problems.push(`unknown section "## ${heading}" — no skill reads this; typo or a renamed heading?`);
    }
  }

  if (problems.length === 0) {
    return { ok: true, lines: [`${rel}: ok (${sections.size} sections)`] };
  }
  lines.push(`${rel}: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const p of problems) lines.push(`  - ${p}`);
  lines.push(`see docs/project-profile.md in ${pkg.name} for the schema`);
  return { ok: false, lines };
}
