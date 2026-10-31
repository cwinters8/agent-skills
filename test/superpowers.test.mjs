// The Superpowers skills vendored under skills/ by scripts/vendor-superpowers.mjs.
// Re-vendoring needs the network, so these check what it left on disk instead:
// that the tree matches the manifest, carries the upstream license, and that a
// consumer listing only part of the set is told what it is missing.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NOTICE_MARKER, rewriteNamespace } from '../scripts/vendor-superpowers.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(repo, 'skills');
const manifest = JSON.parse(readFileSync(join(repo, 'vendor', 'superpowers.json'), 'utf8'));

const filesUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name));

test('the manifest pins a full commit and lists each skill once', () => {
  assert.match(manifest.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(manifest.skills, [...new Set(manifest.skills)].sort());
  for (const name of Object.keys(manifest.excluded ?? {})) assert.ok(!manifest.skills.includes(name), name);
});

test('every vendored skill carries the upstream license and a notice naming the pinned commit', () => {
  const licenses = new Set();
  for (const skill of manifest.skills) {
    const dir = join(skillsDir, skill);
    const body = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    assert.match(body, new RegExp(`^---\\nname: ${skill}\\n`), `${skill}: frontmatter name`);
    const license = readFileSync(join(dir, 'LICENSE'), 'utf8');
    assert.match(license, /^MIT License/);
    assert.match(license, /Copyright \(c\) \d{4} Jesse Vincent/);
    licenses.add(license);
    const notice = readFileSync(join(dir, 'NOTICE.md'), 'utf8');
    assert.ok(notice.startsWith(NOTICE_MARKER), `${skill}: notice marker`);
    assert.ok(notice.includes(manifest.commit), `${skill}: notice names the pinned commit`);
  }
  assert.equal(licenses.size, 1, 'every copy is the same license text');
});

test('no directory under skills/ claims to be vendored without being in the manifest', () => {
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    const notice = join(skillsDir, entry.name, 'NOTICE.md');
    if (!existsSync(notice) || !readFileSync(notice, 'utf8').startsWith(NOTICE_MARKER)) continue;
    assert.ok(manifest.skills.includes(entry.name), entry.name);
  }
});

test('no vendored file still names a vendored skill by its plugin namespace', () => {
  for (const skill of manifest.skills) {
    for (const file of filesUnder(join(skillsDir, skill))) {
      if (!file.endsWith('.md') || file.endsWith('NOTICE.md')) continue;
      const text = readFileSync(file, 'utf8');
      assert.equal(rewriteNamespace(text, manifest.skills), text, file);
    }
  }
});

test('the namespace rewrite leaves a skill the manifest excludes namespaced', () => {
  const text = 'Use superpowers:writing-plans, then superpowers:diagnosing-superpowers.';
  assert.equal(
    rewriteNamespace(text, ['writing-plans']),
    'Use writing-plans, then superpowers:diagnosing-superpowers.',
  );
});

test('sync reports a sibling a vendored skill reaches by relative path', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'agent-skills-sp-'));
  try {
    mkdirSync(join(scratch, '.claude'));
    writeFileSync(join(scratch, '.claude', 'skills.json'), JSON.stringify({ skills: ['executing-plans'] }));
    copyFileSync(join(repo, 'templates', 'project-profile.md'), join(scratch, '.claude', 'project-profile.md'));
    const result = spawnSync(process.execPath, [join(repo, 'bin', 'agent-skills.mjs'), 'sync'], {
      cwd: scratch,
      encoding: 'utf8',
    });
    // The template profile fails validation; the hand-off report prints first.
    assert.match(result.stdout, /subagent-driven-development — executing-plans hands off to it/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
