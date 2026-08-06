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

const available = () =>
  readdirSync(packageSkills, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packageSkills, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();

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
  const skills = requested.length ? requested : available();
  const unknown = skills.filter((s) => !available().includes(s));
  if (unknown.length) {
    die(`unknown skill${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')} — available: ${available().join(', ')}`);
  }

  // Never overwrite. A second `init` in a configured repo would otherwise
  // discard a filled-in profile, and the adopter's own work is the expensive
  // part of adoption — the scaffolding is the cheap part.
  const wrote = [];
  const kept = [];
  mkdirSync(join(repoRoot, '.claude'), { recursive: true });

  if (existsSync(lockPath)) kept.push('.claude/skills.json');
  else {
    writeFileSync(lockPath, `${JSON.stringify({ skills }, null, 2)}\n`);
    wrote.push('.claude/skills.json');
  }

  if (existsSync(profilePath)) kept.push('.claude/project-profile.md');
  else {
    copyFileSync(join(packageRoot, 'templates', 'project-profile.md'), profilePath);
    wrote.push('.claude/project-profile.md');
  }

  for (const f of wrote) console.log(`agent-skills: wrote ${f}`);
  for (const f of kept) console.log(`agent-skills: kept existing ${f}`);
  console.log('');
  console.log('Next: fill in .claude/project-profile.md — every TODO must be replaced.');
  console.log('Then: agent-skills sync    (validates the profile and vendors the skills)');
  console.log('');
  console.log('An agent can do the whole thing: see "Adopting in a new repo" in the');
  console.log(`${pkg.name} README for a prompt to hand it.`);
  process.exit(0);
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

    // A local file matching neither the package nor the lock was hand-edited.
    // Overwriting it silently would discard work; refusing without --force is
    // the only way the edit gets noticed.
    if (localHash !== null && lockedHash !== null && localHash !== lockedHash && !force) {
      problems.push(`${key}: edited locally — fix it upstream and re-sync, or pass --force to discard`);
      continue;
    }
    problems.push(localHash === null ? `${key}: missing` : `${key}: out of date`);
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

const hasEdits = problems.some((p) => p.includes('edited locally'));
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
  die('refusing to overwrite locally-edited vendored files — nothing was written');
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
const missingSiblings = new Map();
for (const skill of lock.skills) {
  const file = join(skillsDir, skill, 'SKILL.md');
  if (!existsSync(file)) continue;
  const body = readFileSync(file, 'utf8');
  for (const other of available()) {
    if (other === skill || lock.skills.includes(other)) continue;
    // Backticked name only — prose like "review the changes" must not match.
    if (!body.includes(`\`${other}\``)) continue;
    if (!missingSiblings.has(other)) missingSiblings.set(other, []);
    missingSiblings.get(other).push(skill);
  }
}
if (missingSiblings.size) {
  console.log('');
  console.log('agent-skills: vendored skills hand off to skills this repo does not list:');
  for (const [other, byWhom] of [...missingSiblings].sort()) {
    console.log(`  ${other} — referenced by ${byWhom.sort().join(', ')}`);
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
