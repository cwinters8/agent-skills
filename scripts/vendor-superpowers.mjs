#!/usr/bin/env node
// Re-vendor the Superpowers skills into skills/ from the commit pinned in
// vendor/superpowers.json. Repo-only: consumers never run this, they get the
// result through `agent-skills sync` like any other skill.
//
//   node scripts/vendor-superpowers.mjs                 re-vendor the pinned commit
//   node scripts/vendor-superpowers.mjs --commit <sha>  move the pin, then re-vendor
//
// To bump: pick the upstream release you want, resolve it to its full commit
// SHA, run with --commit, read the diff under skills/, and bump `version` in
// package.json. A tag is not a pin for the reason README.md gives: it can be
// repointed, and the next re-vendor would ship different content with nothing
// in the manifest diff to show for it.
//
// Nothing from the upstream checkout is executed. It is cloned with hooks off
// and read as files; its scripts are copied, never run.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(repo, 'vendor', 'superpowers.json');
const skillsDir = join(repo, 'skills');

// The first line of every NOTICE.md this script writes. It is how the script
// tells a directory it vendored from one of this repo's own skills, so it never
// overwrites or removes a skill it did not write.
export const NOTICE_MARKER = '# Vendored from Superpowers';

const die = (message) => {
  console.error(`vendor-superpowers: ${message}`);
  process.exit(1);
};

const git = (args, cwd) => {
  // core.hooksPath off: a clone can run hooks, and nothing upstream should run.
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) die(`git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
};

// Vendored skills have no plugin namespace, so `superpowers:writing-plans` names
// a skill that does not exist in a consumer repo. Rewrite it to the plain name,
// but only for skills this manifest vendors: a reference to one it leaves out
// stays namespaced, which reads as "the plugin's skill" rather than pointing at
// nothing under a plausible name.
export const rewriteNamespace = (text, names) =>
  text.replace(/\bsuperpowers:([a-z0-9-]+)\b/g, (whole, name) => (names.includes(name) ? name : whole));

const walk = (dir, base = dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // Skip links for the reason the CLI's walk() does: sync would skip them too.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out.sort();
};

const isOurs = (dir) => {
  const notice = join(dir, 'NOTICE.md');
  return existsSync(notice) && readFileSync(notice, 'utf8').startsWith(NOTICE_MARKER);
};

const notice = (manifest, skill, rewritten) =>
  [
    NOTICE_MARKER,
    '',
    `This skill is copied from [Superpowers](${manifest.repository.replace(/\.git$/, '')}),`,
    `\`skills/${skill}/\` at commit \`${manifest.commit}\` (${manifest.release}).`,
    `Superpowers is licensed under the ${manifest.license} license; see \`LICENSE\` in this directory.`,
    '',
    'Changes from upstream:',
    '',
    rewritten.length
      ? `- \`superpowers:<skill>\` references rewritten to the plain skill name, because a vendored skill has no plugin namespace. Files: ${rewritten.map((f) => `\`${f}\``).join(', ')}.`
      : '- None.',
    '- `LICENSE` and this `NOTICE.md` added.',
    '',
    'Edit it upstream, not here: a local edit is overwritten by the next re-vendor.',
    '',
  ].join('\n');

const main = () => {
  const argv = process.argv.slice(2);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const commitFlag = argv.indexOf('--commit');
  if (commitFlag !== -1) {
    const sha = argv[commitFlag + 1];
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) die('--commit takes a full 40-character commit SHA');
    manifest.commit = sha;
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.commit)) die('vendor/superpowers.json needs a full 40-character commit');

  // A name this repo already uses for its own skill would be overwritten.
  for (const skill of manifest.skills) {
    const dest = join(skillsDir, skill);
    if (existsSync(dest) && !isOurs(dest)) {
      die(`skills/${skill} exists and was not vendored by this script — refusing to overwrite it`);
    }
  }

  const scratch = mkdtempSync(join(tmpdir(), 'superpowers-'));
  try {
    const checkout = join(scratch, 'upstream');
    git(['clone', '--quiet', '--no-checkout', manifest.repository, checkout], scratch);
    git(['checkout', '--quiet', '--detach', manifest.commit], checkout);
    const head = git(['rev-parse', 'HEAD'], checkout);
    if (head !== manifest.commit) die(`checked out ${head}, expected ${manifest.commit}`);

    const license = join(checkout, 'LICENSE');
    if (!existsSync(license)) die('upstream has no LICENSE at this commit — stop and check the terms');

    for (const skill of manifest.skills) {
      const from = join(checkout, 'skills', skill);
      if (!existsSync(join(from, 'SKILL.md'))) die(`upstream has no skills/${skill}/SKILL.md at this commit`);
      const to = join(skillsDir, skill);
      rmSync(to, { recursive: true, force: true });
      const rewritten = [];
      for (const rel of walk(from)) {
        const src = join(from, rel);
        const dest = join(to, rel);
        mkdirSync(dirname(dest), { recursive: true });
        // copyFileSync keeps the mode, so upstream's executable scripts stay executable.
        copyFileSync(src, dest);
        if (rel.endsWith('.md')) {
          const before = readFileSync(src, 'utf8');
          const after = rewriteNamespace(before, manifest.skills);
          if (after !== before) {
            writeFileSync(dest, after);
            rewritten.push(rel);
          }
        }
      }
      copyFileSync(license, join(to, 'LICENSE'));
      writeFileSync(join(to, 'NOTICE.md'), notice(manifest, skill, rewritten));
    }

    // A skill this script vendored earlier that the manifest no longer lists.
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      const dir = join(skillsDir, entry.name);
      if (entry.isDirectory() && !manifest.skills.includes(entry.name) && isOurs(dir)) {
        rmSync(dir, { recursive: true, force: true });
        console.log(`vendor-superpowers: removed skills/${entry.name}, no longer in the manifest`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`vendor-superpowers: ${manifest.skills.length} skills from ${manifest.commit}`);
  console.log('Read the diff under skills/, then bump `version` in package.json.');
};

// Importable for the tests, which check the rewrite without a network clone.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
