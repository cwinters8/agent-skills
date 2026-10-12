// `agent-skills link`: symlink every skill in this checkout into the user's
// Claude config directory. Each test runs the real CLI as a subprocess against
// a throwaway config directory, so nothing here can touch ~/.claude.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(repo, 'bin', 'agent-skills.mjs');
const repoSkills = join(repo, 'skills');
const skills = readdirSync(repoSkills, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(repoSkills, e.name, 'SKILL.md')))
  .map((e) => e.name)
  .sort();

let scratch;
let config;
let target;

beforeEach(() => {
  // realpath: on macOS the temp directory is reached through a symlink, and a
  // path compared against a link's target has to be the same spelling.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'agent-skills-link-')));
  config = join(scratch, 'config');
  target = join(config, 'skills');
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const run = (args, { env = {}, script = cli } = {}) => {
  const result = spawnSync(process.execPath, [script, 'link', ...args], {
    // A cwd with no .claude directory: link must not care what repo it runs in.
    cwd: scratch,
    env: { ...process.env, CLAUDE_CONFIG_DIR: config, ...env },
    encoding: 'utf8',
  });
  return { ...result, output: result.stdout + result.stderr };
};

// Fixture links are junctions for the reason the CLI's are: on Windows an
// untyped link to a directory is a directory symlink, which needs a privilege
// non-elevated users lack, so the test would fail with EPERM before asserting
// anything. A junction needs no existing target, so dangling fixtures work too.
// The type is ignored everywhere else.
const junction = (to, path) => symlinkSync(to, path, 'junction');
const linkTarget = (name) => readlinkSync(join(target, name));
const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

test('links every skill into an empty config directory', () => {
  const r = run([]);
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(readdirSync(target).sort(), skills);
  for (const name of skills) assert.equal(linkTarget(name), join(repoSkills, name));
});

test('a second run changes nothing and exits zero', () => {
  run([]);
  const r = run([]);
  assert.equal(r.status, 0, r.output);
  assert.doesNotMatch(r.stdout, /\blinked\b/);
  assert.deepEqual(readdirSync(target).sort(), skills);
});

test('--check reports what is missing, writes nothing, and exits non-zero', () => {
  const r = run(['--check']);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, new RegExp(skills[0]));
  assert.equal(existsSync(target), false);
});

test('--check exits zero when every link is in place', () => {
  run([]);
  const r = run(['--check']);
  assert.equal(r.status, 0, r.output);
});

test('adds only the skill that is missing', () => {
  run([]);
  rmSync(join(target, skills[0]));
  const r = run([]);
  assert.equal(r.status, 0, r.output);
  assert.equal(linkTarget(skills[0]), join(repoSkills, skills[0]));
  assert.match(r.stdout, new RegExp(`linked\\s+${skills[0]}`));
});

test('a link to somewhere else is reported and kept, and --force replaces it', () => {
  const elsewhere = join(scratch, 'other-checkout', skills[0]);
  mkdirSync(elsewhere, { recursive: true });
  mkdirSync(target, { recursive: true });
  junction(elsewhere, join(target, skills[0]));

  const kept = run([]);
  assert.equal(kept.status, 1, kept.output);
  assert.equal(linkTarget(skills[0]), elsewhere);
  assert.match(kept.output, /--force/);
  // The conflict does not stop the rest from being linked.
  for (const name of skills.slice(1)) assert.equal(linkTarget(name), join(repoSkills, name));

  const forced = run(['--force']);
  assert.equal(forced.status, 0, forced.output);
  assert.equal(linkTarget(skills[0]), join(repoSkills, skills[0]));
});

test('a dangling link under a skill name is kept without --force', () => {
  mkdirSync(target, { recursive: true });
  junction(join(scratch, 'nowhere'), join(target, skills[0]));
  const r = run([]);
  assert.equal(r.status, 1, r.output);
  assert.equal(linkTarget(skills[0]), join(scratch, 'nowhere'));
});

test('a real directory under a skill name is never touched, even with --force', () => {
  const own = join(target, skills[0]);
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, 'SKILL.md'), 'my own skill\n');

  const r = run(['--force']);
  assert.equal(r.status, 1, r.output);
  assert.equal(isLink(own), false);
  assert.equal(readFileSync(join(own, 'SKILL.md'), 'utf8'), 'my own skill\n');
  assert.match(r.output, new RegExp(skills[0]));
});

test('removes a link to a skill this checkout no longer has', () => {
  run([]);
  const gone = join(target, 'renamed-away');
  junction(join(repoSkills, 'renamed-away'), gone);

  const checked = run(['--check']);
  assert.equal(checked.status, 1, checked.output);
  assert.equal(isLink(gone), true);

  const r = run([]);
  assert.equal(r.status, 0, r.output);
  assert.equal(isLink(gone), false);
  assert.match(r.stdout, /removed\s+renamed-away/);
});

test('a link written through a symlinked path to this checkout is still its own', () => {
  // A clone reached through a symlink, or moved with a link left at its old
  // place: the link's text names a different path to the same skills/.
  const alias = join(scratch, 'clone-alias');
  junction(repo, alias);
  run([]);
  rmSync(join(target, skills[0]));
  junction(join(alias, 'skills', skills[0]), join(target, skills[0]));
  const gone = join(target, 'renamed-away');
  junction(join(alias, 'skills', 'renamed-away'), gone);

  const r = run([]);
  assert.equal(r.status, 0, r.output);
  assert.doesNotMatch(r.output, /left alone \(--force/);
  assert.equal(linkTarget(skills[0]), join(alias, 'skills', skills[0]));
  assert.equal(isLink(gone), false);
});

test('leaves everything it did not create alone', () => {
  mkdirSync(join(target, 'synced', 'bucket'), { recursive: true });
  writeFileSync(join(target, 'synced', 'bucket', 'SKILL.md'), 'synced\n');
  mkdirSync(join(target, 'my-skill'));
  junction(join(scratch, 'nowhere'), join(target, 'dangling-elsewhere'));
  junction(join(scratch, 'other-checkout', 'skills', 'x'), join(target, 'other-checkout-skill'));

  const r = run([]);
  assert.equal(r.status, 0, r.output);
  assert.equal(readFileSync(join(target, 'synced', 'bucket', 'SKILL.md'), 'utf8'), 'synced\n');
  assert.equal(existsSync(join(target, 'my-skill')), true);
  assert.equal(isLink(join(target, 'dangling-elsewhere')), true);
  assert.equal(isLink(join(target, 'other-checkout-skill')), true);
});

test('falls back to ~/.claude/skills when CLAUDE_CONFIG_DIR is unset', () => {
  const home = join(scratch, 'home');
  mkdirSync(home);
  // homedir() reads USERPROFILE on Windows and HOME elsewhere. Redirect both,
  // or on Windows this links into the developer's real ~/.claude/skills.
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR;
  const r = spawnSync(process.execPath, [cli, 'link'], { cwd: scratch, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(join(home, '.claude', 'skills')).sort(), skills);
});

test('refuses to run from a copy that is not a git checkout', () => {
  // What `npx` runs: the package unpacked into npm's cache, with no .git. Links
  // into that cache dangle the moment npm prunes it.
  const unpacked = join(scratch, 'npx-cache', 'agent-skills');
  for (const part of ['bin', 'skills', 'package.json', 'profile-schema.json']) {
    cpSync(join(repo, part), join(unpacked, part), { recursive: true });
  }
  const r = run([], { script: join(unpacked, 'bin', 'agent-skills.mjs') });
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /git checkout/);
  assert.equal(existsSync(target), false);
});

test('rejects an unknown option instead of ignoring it', () => {
  const r = run(['--dry-run']);
  assert.equal(r.status, 2, r.output);
  assert.match(r.output, /--dry-run/);
  assert.equal(existsSync(target), false);
});

test('refuses when the skills path exists and is not a directory', () => {
  mkdirSync(config, { recursive: true });
  writeFileSync(target, 'not a directory\n');
  const r = run([]);
  assert.equal(r.status, 1, r.output);
  assert.equal(readFileSync(target, 'utf8'), 'not a directory\n');
});
