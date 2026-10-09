#!/usr/bin/env node
// Vendor the shared Claude Code skills into a consumer repo's .claude/skills/.
//
//   agent-skills sync            write the vendored copies
//   agent-skills sync --check    verify without writing; non-zero on drift
//   agent-skills sync --force    overwrite locally-edited vendored files
//   agent-skills init            scaffold the lock and profile, enable the
//                                superpowers plugin in .claude/settings.json,
//                                and install it here if `claude` is on PATH
//   agent-skills init --no-superpowers
//                                scaffold without touching superpowers at all
//
// Typically run without installing:
//
//   npx -y github:cwinters8/agent-skills#<verified-ref> sync
//
// The skills ship inside this package, so the version you invoke IS the version
// you vendor — there is no second pin. `.claude/skills.json` says which skills a
// repo wants and records what was written; it does not name a ref, because the
// npx spec in the consumer's package.json is the only content pin.
//
// Skills are copied into the repo and committed rather than fetched at session
// start, so they exist on a session's first turn, appear in PR diffs, and need
// no network once vendored.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  lstatSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const packageSkills = join(packageRoot, 'skills');
const schemaPath = join(packageRoot, 'profile-schema.json');

const repoRoot = process.cwd();
const lockPath = join(repoRoot, '.claude', 'skills.json');
const skillsDir = join(repoRoot, '.claude', 'skills');
const profilePath = join(repoRoot, '.claude', 'project-profile.md');
const settingsPath = join(repoRoot, '.claude', 'settings.json');

// The plugin these skills are written to sit beside: superpowers owns how a
// session plans, debugs and verifies, these skills own what lands in the diff.
// The official marketplace id, because Claude Code knows that marketplace
// without an `extraKnownMarketplaces` entry — this is exactly what
// `claude plugin install --scope project` writes.
const SUPERPOWERS = 'superpowers@claude-plugins-official';

const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith('--')) ?? 'sync';
const check = argv.includes('--check');
const force = argv.includes('--force');
const noSuperpowers = argv.includes('--no-superpowers');

const die = (message) => {
  console.error(`agent-skills: ${message}`);
  process.exit(1);
};

const usage = () => {
  console.error('usage: agent-skills sync [--check] [--force]');
  console.error('       agent-skills init [--no-superpowers] [skill...]');
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

// A relative path with forward slashes on every platform. `relative()` is
// platform-specific, so on Windows it yields backslashes — and these strings
// become lock keys and get compared against keys built with a literal `/`. That
// breaks two things at once: a descendant test like `key.startsWith(dir + '/')`
// silently never matches, and a lock written on one platform reads as total
// drift on another. Normalizing here means no comparison downstream has to know
// about separators. `join()` accepts forward slashes on Windows, so the paths
// still resolve.
const relKey = (base, full) => relative(base, full).split(sep).join('/');

// Every regular file in a skill directory, relative to it, sorted for a stable
// lock. Symlinks are skipped: they would hash as nothing and copy verbatim,
// putting a link to an arbitrary path inside .claude/skills/.
const walk = (dir, base = dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(relKey(base, full));
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
    const rel = relKey(base, full);
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

// The directories every write below goes through. Guarding the children is not
// enough: if an ancestor is a symlink, mkdirSync follows it and succeeds, every
// child path then resolves inside the link's target, and each per-file check
// sees an ordinary absent path and writes. The result is `init` scaffolding
// into another location — or `sync` deleting and rewriting a skills tree there
// — while both report the in-repo names they were asked about. A guard one
// level below the thing being followed cannot see the following.
// Every ancestor directory the writes below pass through must be absent or a
// real directory, and *each* one has to be checked. A guard on `.claude` alone
// leaves `.claude/skills`, and this was found three times in three shapes
// before it was stated as a rule: a symlink here silently redirects every path
// underneath, and a regular file here makes each child probe report "absent" —
// so `init` scaffolds and exits 0, and the `sync` it tells you to run next dies
// on an uncaught ENOTDIR. Neither is a shape the rest of this command lacks a
// refusal for; they were simply never reached.
const requireWritableDir = (path, label) => {
  if (isSymlink(path)) {
    die(
      `${label} is a symlink — refusing to read or write through it, because every path ` +
        'below it would resolve somewhere this command cannot honestly report. ' +
        'Replace it with a real directory.',
    );
  }
  if (existsSync(path) && !statSync(path).isDirectory()) {
    die(`${label} exists but is not a directory — nothing can be read or written under it.`);
  }
};

// Guard each directory only for the commands that actually go through it.
// `list` reads the package and never touches the repo. `check-profile` reads
// one file under `.claude` and never the skills tree — refusing it because of
// the shape of a directory it does not open would fail a valid profile for a
// reason unrelated to the profile, which is the opposite of what a validator is
// for. Scope a guard to what it protects, or it becomes a second thing that can
// be wrong.
if (command !== 'list') requireWritableDir(join(repoRoot, '.claude'), '.claude');
if (command === 'init' || command === 'sync') requireWritableDir(skillsDir, '.claude/skills');

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
  // Reject any flag init does not know. --no-superpowers exists to prevent a
  // durable side effect, so a misspelling of it (or a `=true` form) silently
  // ignored would perform exactly what the adopter asked to skip.
  const unknownFlags = argv.filter((a) => a.startsWith('--') && a !== '--no-superpowers');
  if (unknownFlags.length) {
    console.error(`agent-skills: unknown option${unknownFlags.length === 1 ? '' : 's'} for init: ${unknownFlags.join(' ')}`);
    usage();
  }
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

  // Enable superpowers for the repo. This is the one write in `init` that merges
  // rather than scaffolds, and deliberately: a repo adopting these skills very
  // often has a .claude/settings.json already, and treating it like the two
  // files above — present, so kept — would print "kept existing" and leave the
  // plugin unconfigured, an adoption that reads as complete and is not. The
  // merge only ever adds one key. Everything else in the file is the adopter's,
  // and an existing entry for superpowers is a decision already made — `false`
  // is an opt-out, and an install from another marketplace would load the same
  // skills twice — so either one is left exactly as found.
  const settingsProblems = [];
  let install = false;
  // What .claude/settings.json held before this run added the entry — null
  // when the file did not exist, undefined when this run wrote nothing. Kept so
  // a refused install can put the file back rather than leave the plugin
  // enabled for whatever a later session finds installed under that name.
  let previousSettings;
  const writeSettings = (text) => {
    const temp = `${settingsPath}.agent-skills-${randomBytes(8).toString('hex')}.tmp`;
    const mode = existsSync(settingsPath) ? statSync(settingsPath).mode & 0o777 : undefined;
    writeFileSync(temp, text, { flag: 'wx', ...(mode === undefined ? {} : { mode }) });
    if (mode !== undefined) chmodSync(temp, mode);
    renameSync(temp, settingsPath);
  };
  // A blocked scaffold means this run already cannot initialize the repo, and
  // it exits non-zero below. Enabling and installing a plugin for a repository
  // init then reports as not initialized would leave durable state behind a
  // failure, so the plugin waits for a run that can succeed.
  const scaffoldFailed = links.length > 0 || blocked.length > 0;
  if (!noSuperpowers && scaffoldFailed) {
    settingsProblems.push('superpowers not set up — fix the paths above and re-run init');
  }
  if (!noSuperpowers && !scaffoldFailed) {
    const label = '.claude/settings.json';
    if (isSymlink(settingsPath)) links.push(label);
    else if (existsSync(settingsPath) && !statSync(settingsPath).isFile()) blocked.push(label);
    else {
      let settings = {};
      let readable = true;
      if (existsSync(settingsPath)) {
        // Unparseable is not the same as absent. Rewriting it from `{}` would
        // discard whatever the adopter meant to be there, so refuse and say why.
        try {
          settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        } catch (error) {
          settingsProblems.push(`${label} is not valid JSON (${error.message}) — superpowers not enabled`);
          readable = false;
        }
      }
      const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
      if (readable && (!isObject(settings) || (settings.enabledPlugins !== undefined && !isObject(settings.enabledPlugins)))) {
        settingsProblems.push(`${label} does not have the shape Claude Code expects — superpowers not enabled`);
        readable = false;
      }
      if (readable) {
        const plugins = settings.enabledPlugins ?? {};
        // The official key decides when it is present, whatever else is listed;
        // only without it does another marketplace's entry stand in, and that
        // one is never installed over. A first-match search would make the
        // outcome depend on key order.
        const existing =
          SUPERPOWERS in plugins ? SUPERPOWERS : Object.keys(plugins).find((k) => k.startsWith('superpowers@'));
        if (existing) {
          kept.push(`${label} (${existing} already listed)`);
          // `true` is not the only enabled form: the settings schema also takes
          // an array of version constraints, and that entry still needs the
          // download as much as a bare `true` does. `false` is the opt-out.
          const value = plugins[existing];
          const constraints = Array.isArray(value) && value.every((v) => typeof v === 'string');
          if (existing === SUPERPOWERS && typeof value !== 'boolean' && !constraints) {
            // Anything else is a value Claude Code will not honor — the
            // adopter believes the plugin is on and it is not. Say so rather
            // than calling a broken entry kept.
            kept.pop();
            settingsProblems.push(
              `${label} has "${SUPERPOWERS}": ${JSON.stringify(value)}, which is not true, false, or a list of ` +
                'version constraints — superpowers not set up. Fix or remove the entry and re-run init.',
            );
          }
          install = existing === SUPERPOWERS && (value === true || constraints);
        } else {
          settings.enabledPlugins = { ...plugins, [SUPERPOWERS]: true };
          // Write beside it and rename over it. An in-place write truncates the
          // adopter's only copy first, so an interrupted run or a full disk
          // would leave the very file this merge exists to preserve empty.
          // Carry the original's permission bits across, or the rename quietly
          // widens a file the adopter had restricted to whatever the umask
          // gives a new one.
          // A random name opened exclusively: `wx` fails on anything already at
          // the path, a symlink included, so a planted link cannot redirect the
          // write outside the repository.
          previousSettings = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null;
          writeSettings(`${JSON.stringify(settings, null, 2)}\n`);
          wrote.push(`${label} (enabled ${SUPERPOWERS})`);
          install = true;
        }
      }
    }
  }

  for (const f of wrote) console.log(`agent-skills: wrote ${f}`);
  for (const f of kept) console.log(`agent-skills: kept existing ${f}`);

  // Enabling is not installing. A project-scope `enabledPlugins` entry turns the
  // plugin on for everyone in the repo but downloads it for no one: Claude Code
  // reports it as enabled but not installed until each person runs the install
  // once. Stopping at the settings write would therefore exit 0 with superpowers
  // still absent on the very machine that asked for it. So install it here,
  // through Claude Code's own CLI rather than by reproducing its plugin cache —
  // that layout is Claude Code's to change. Only for the official entry, and
  // only when it is `true`: an opt-out or another marketplace's install was left
  // as found above, and installing over it would undo that decision.
  // `claude` missing is not a failure of init — a machine without Claude Code
  // has nothing to install into — but it is said, with the command to run, so
  // the gap is visible rather than discovered later as a skill that never loads.
  const installCommand = `claude plugin install ${SUPERPOWERS} --scope project`;
  const MARKETPLACE = SUPERPOWERS.split('@')[1];
  const marketplaceCommand = `claude plugin marketplace add anthropics/${MARKETPLACE}`;
  let installed = false;
  if (install) {
    // Windows exposes `claude` as a .cmd shim, which spawn finds only through a
    // shell. Every argument here is a constant, so the shell has nothing to
    // interpret — but the shell's command search is its own hazard: cmd looks
    // in the current directory before PATH, and the current directory is the
    // repository being adopted. A `claude.cmd` committed there would run in
    // place of Claude Code. NoDefaultCurrentDirectoryInExePath is Windows' own
    // switch for dropping the current directory from that search.
    const win = process.platform === 'win32';
    const env = win ? { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' } : process.env;
    const claude = (args, options = {}) => spawnSync('claude', args, { shell: win, env, ...options });

    // Claude Code registers the official marketplace only on the first
    // interactive session, so on a machine that has never had one the install
    // below fails on an unknown marketplace — and a fresh machine is exactly
    // where `init` is likeliest to run. Register it first, but only when it is
    // missing: `marketplace add` on a registered marketplace still writes a
    // declaration into the user's settings, which is not this command's to touch.
    // Missing `claude` has to be detected before anything runs through it. With
    // a shell in between (Windows, above), a command that does not exist is the
    // shell's own non-zero exit, not ENOENT, so the check below would see an
    // ordinary failure and report a broken install where there is simply no
    // Claude Code. Ask `where` directly there, restricted to PATH with its
    // `$PATH:` form — a bare `where` also searches the current directory, so a
    // file in the repository would answer for a Claude Code that is not
    // installed. Elsewhere spawn reports ENOENT.
    const missing = win && spawnSync('where', ['$PATH:claude'], { stdio: 'ignore', env }).status !== 0;
    const listed = missing ? null : claude(['plugin', 'marketplace', 'list', '--json'], { encoding: 'utf8' });
    if (missing || listed.error?.code === 'ENOENT') {
      console.log('agent-skills: `claude` is not on PATH, so superpowers is enabled but not installed here.');
      console.log(`  Install Claude Code, then run: ${installCommand}`);
    } else {
      // Read a marketplace listing into one of three answers: the official
      // marketplace is registered (`known`), something makes it unsafe to go
      // on (`refusal`), or it is simply absent (neither).
      const verify = (listing) => {
        // Fail closed on a listing that cannot be read. Treating it as empty
        // would go on to `marketplace add`, which can exit 0 for a same-named
        // marketplace already on disk from another source — and then install
        // from it with the source check below never having run.
        let entries = null;
        if (!listing.error && listing.status === 0) {
          try {
            const parsed = JSON.parse(listing.stdout);
            if (Array.isArray(parsed)) entries = parsed;
          } catch {}
        }
        if (entries === null) {
          // The commonest cause is not tampering but age: the JSON listing
          // needs Claude Code 2.1.273 or later. Name that, so the failure reads
          // as an upgrade rather than a mystery.
          return {
            refusal:
              `superpowers not installed: \`claude plugin marketplace list --json\` failed or returned something unreadable, ` +
              `so the "${MARKETPLACE}" marketplace could not be verified.\n` +
              '  That listing needs Claude Code 2.1.273 or later. Run `claude update` and re-run init, or install by hand\n' +
              `  once \`claude plugin marketplace list\` shows anthropics/${MARKETPLACE}: ${installCommand}`,
          };
        }
        // Match the source, not only the name: a registered marketplace by this
        // name from any other repository would otherwise supply the plugin.
        const entry = entries.find((m) => m?.name === MARKETPLACE);
        if (!entry) return {};
        if (entry.source === 'github' && entry.repo === `anthropics/${MARKETPLACE}`) return { known: true };
        const from = entry.repo ?? entry.url ?? entry.source ?? 'an unrecognized source';
        return {
          refusal:
            `superpowers not installed: the registered "${MARKETPLACE}" marketplace points at ${from}, not ` +
            `anthropics/${MARKETPLACE}. Check \`claude plugin marketplace list\` before installing it yourself.`,
        };
      };
      const relist = () => claude(['plugin', 'marketplace', 'list', '--json'], { encoding: 'utf8' });

      let { known, refusal } = verify(listed);
      let addFailed = false;
      if (!known && !refusal) {
        console.log(`agent-skills: running ${marketplaceCommand}`);
        const added = claude(['plugin', 'marketplace', 'add', `anthropics/${MARKETPLACE}`], { stdio: 'inherit' });
        if (added.error || added.status !== 0) addFailed = true;
        else {
          // A successful add is not proof of the source: it also exits 0 when a
          // marketplace by that name is merely already on disk, from wherever
          // it came. Install only from what the listing then verifies.
          ({ known, refusal } = verify(relist()));
          if (!known && !refusal) {
            refusal =
              `superpowers not installed: \`${marketplaceCommand}\` reported success, but the listing still does not ` +
              `show anthropics/${MARKETPLACE}. Check \`claude plugin marketplace list\` before installing it yourself.`;
          }
        }
      }
      let ready = Boolean(known);
      if (refusal) {
        ready = false;
        // The entry is only safe to leave when the marketplace behind it is the
        // official one. Here it is not, and a project-scope entry enables
        // whatever is already installed under that ID — so undo this run's
        // write. An entry that was already in the file is the adopter's.
        if (previousSettings !== undefined) {
          if (previousSettings === null) rmSync(settingsPath, { force: true });
          else writeSettings(previousSettings);
          console.log('agent-skills: undid the .claude/settings.json change above — superpowers is not enabled');
        }
        install = false;
        settingsProblems.push(refusal);
      } else if (addFailed) {
        settingsProblems.push(
          `${marketplaceCommand} failed — superpowers is enabled in .claude/settings.json but not installed`,
        );
      }
      if (ready) {
        console.log(`agent-skills: running ${installCommand}`);
        const result = claude(['plugin', 'install', SUPERPOWERS, '--scope', 'project'], { stdio: 'inherit' });
        if (result.error || result.status !== 0) {
          settingsProblems.push(
            `${installCommand} failed — superpowers is enabled in .claude/settings.json but not installed`,
          );
        } else installed = true;
      }
    }
  }

  for (const f of links) {
    console.error(`agent-skills: ${f} is a symlink — left alone, nothing written through it`);
  }
  for (const f of blocked) {
    console.error(`agent-skills: ${f} exists but is not a regular file — nothing written, and sync cannot read it`);
  }
  for (const p of settingsProblems) console.error(`agent-skills: ${p}`);
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
  if (install) {
    console.log('');
    console.log('Commit .claude/settings.json too. It enables superpowers for everyone in this');
    console.log('repo, but each collaborator still installs it once on their own machine:');
    console.log(`  ${installCommand}`);
    // The same fresh-machine gap init closes for itself above: without the
    // marketplace step, the one command a collaborator is handed fails.
    console.log('On a machine that has never opened an interactive Claude Code session,');
    console.log(`register the marketplace first: ${marketplaceCommand}`);
    if (!installed) console.log('(That includes this machine — it was not installed here.)');
  }
  console.log('');
  console.log('An agent can do the whole thing: see "Adopting in a new repo" in the');
  console.log(`${pkg.name} README for a prompt to hand it.`);
  // A link that blocked scaffolding means a file init exists to create does not
  // exist, so the run did not do its job — and the next `sync` fails on the
  // missing lock regardless. Exiting zero there tells a script the adoption
  // succeeded and leaves the failure to surface one command later, detached
  // from its cause. Refusing to write through the link was the right call;
  // reporting success afterwards would undo the point of it.
  // An unreadable settings file, or an install that ran and failed, is the same
  // failure in a different shape: init was asked to set up the plugin and could
  // not.
  process.exit(links.length || blocked.length || settingsProblems.length ? 1 : 0);
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
    const verb = byWhom.length === 1 ? 'hands' : 'hand';
    console.log(`  ${other} — ${byWhom.sort().join(', ')} ${verb} off to it`);
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
