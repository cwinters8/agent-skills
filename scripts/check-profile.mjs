#!/usr/bin/env node
// Validate a consumer repo's .claude/project-profile.md against profile-schema.json.
//
// Usage:
//   node scripts/check-profile.mjs <path-to-project-profile.md> [--skills a,b,c]
//
// --skills is the list of skills the consumer actually vendors. A section marked
// requiredWith is only required when one of the named skills is in that list, so
// a repo that doesn't vendor security-review isn't nagged about a threat model.
//
// Exit 0 = valid. Exit 1 = problems, listed on stderr. Exit 2 = bad invocation.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, '..', 'profile-schema.json'), 'utf8'));

const args = process.argv.slice(2);
const profilePath = args.find((a) => !a.startsWith('--'));
const skillsArg = args.find((a) => a.startsWith('--skills='));
const vendored = skillsArg
  ? skillsArg.slice('--skills='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

if (!profilePath) {
  console.error('usage: check-profile.mjs <path-to-project-profile.md> [--skills=a,b,c]');
  process.exit(2);
}

let source;
try {
  source = readFileSync(profilePath, 'utf8');
} catch {
  console.error(`profile not found: ${profilePath}`);
  console.error(`copy templates/project-profile.md to ${schema.profilePath} and fill it in`);
  process.exit(1);
}

// Parse H2 headings and the body under each. Fenced code blocks are skipped so a
// "## " line inside an example doesn't register as a section.
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
  // Without an explicit skills list, assume every skill is vendored: better to
  // over-report a missing section than to let a security profile ship empty.
  if (!vendored) return true;
  return section.requiredWith.some((skill) => vendored.includes(skill));
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

if (problems.length) {
  console.error(`${profilePath}: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nsee docs/project-profile.md in cwinters8/agent-skills for the schema');
  process.exit(1);
}

const counted = vendored ? ` for skills: ${vendored.join(', ')}` : '';
console.log(`${profilePath}: ok (${sections.size} sections)${counted}`);
