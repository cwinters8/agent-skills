---
name: apple-photos
description: >
  Read, search, export from, and import into the Apple Photos library on a Mac
  with `osxphotos`, from an agent session that macOS privacy controls would
  otherwise block. Use when asked to "find videos in Photos", "search my photo
  library", "export clips from Photos", "pull footage from my iPhone library",
  "save this to a Photos album", or "import into Photos", whenever a task needs
  originals that live only in iCloud, and whenever an `osxphotos` command fails
  with `PermissionError: [Errno 1] Operation not permitted` on `Photos.sqlite`
  or leaves an `osxphotos_crash.log` behind.
---

# Apple Photos

`osxphotos` reads the Photos library's database directly and drives PhotoKit
for downloads and imports. It works from a terminal on the Mac. It fails from
an agent session, and the failure looks like a bug in osxphotos when it is
actually macOS doing its job.

**macOS privacy grants belong to the app that launched a process, not to the
process.** Full Disk Access and Photos access are recorded against the
*responsible* app — the one at the top of the launch chain. A shell the agent
runs inherits the agent host's grants, and the host app almost never has Full
Disk Access, so osxphotos cannot even copy `Photos.sqlite` to read it. A
terminal app the user granted access to *does* have it, so the fix is to run
the command **inside that terminal app**, started through `osascript`, and
read its results back from files.

**The relay is not narrower than granting Full Disk Access to the agent's
host app, and the user should know that before setting it up.** The
Automation consent in Setup step 4 is recorded for the host-to-relay-app pair
and kept. From then on, any process the host app is responsible for (every
session, every tool call, any prompt-injected command) can open a window in
the relay app running any script, and that script runs with the relay app's
Full Disk Access. If the relay app is the user's everyday terminal, the same
consent also lets those processes type into the terminal sessions the user
already has open. Nobody reads the relay script before it runs either: the
agent writes it and launches it in the same command. So treat the Automation
grant as roughly equal to giving the host app Full Disk Access, plus control
of the relay app.

What the relay does buy is that the grant stays visible and revocable in one
place (Automation, in System Settings), and that each run leaves its script
on disk as a record of what ran. If the user wants a narrower setup, the relay
app should be a dedicated one that holds these grants and is used for nothing
else, not their everyday terminal; name it in `## Photos` → relay app. Do not
present either the relay or a direct Full Disk Access grant as the safe
option; both are the user's decision to make in System Settings.

## What this skill reads

Read `.claude/project-profile.md` → `## Photos` first. It supplies:

- **Writable albums** — the albums this project may import into. When the
  section exists, these are the only writes this skill will ever make: an
  album the user names that is not on the list is refused and reported, not
  imported into. The project chose its list; widening it is a profile edit.
- **Relay app** — `iTerm` or `Terminal`: whichever holds the grants on this
  Mac. A section that leaves it out means iTerm, as the template says. These
  are the only two the relay has a launch line for (Step 2); a profile
  naming any other app is a profile error to report, not a guess to make.

**Without a profile, or without a `## Photos` section,** query and export
freely, and import nothing unless the user's own message in this session
names the destination album for that import. That one case is the only write
this fallback allows. Say in your report that no writable album was
configured, and either that no import was made or which session-named import
was. For the relay app, use
iTerm if it is installed and Terminal otherwise, and say which one you used
and that you guessed.

## Setup the user does once

These are the user's steps — they are privacy settings, so an agent does not
change them. If the relay fails for a missing grant, name the missing step
and stop.

1. **Install osxphotos** — `uv tool install osxphotos`, `pipx install
   osxphotos`, or with Homebrew `brew tap RhetTbull/osxphotos` then `brew
   install osxphotos` (the formula lives in that tap, so the install alone
   fails with `No available formula`). Confirm with `osxphotos --version`.
2. **System Settings → Privacy & Security → Full Disk Access**: add the relay
   app. This is what lets osxphotos read `Photos.sqlite`.
3. **Privacy & Security → Photos**: give the relay app **Full Access**. This is
   what `--download-missing --use-photokit` and `import` need. A library on
   "Optimize Mac Storage" keeps most originals in iCloud, so without this an
   export silently skips everything that is not on disk.
4. **Automation**: the first relay run prompts twice — once for the agent's
   host app to control the relay app, once for the relay app to control
   Photos. Both must be allowed; a declined prompt makes `osascript` fail with
   `Not authorized to send Apple events`. Allowing the first one is the
   decision described above: it gives everything running under the host app
   the relay app's Full Disk Access, and lasts until revoked in Privacy &
   Security → Automation.

Restart the relay app after changing its grants. A running app keeps the
permissions it started with.

## Step 1 — Try directly once, then relay

The host might already have the grant (a terminal-based agent launched from a
granted terminal inherits it). Run one cheap query directly:

```sh
cd "<scratch dir>" && osxphotos query --only-movies --from-date <recent date> --count
```

Run it from a scratch directory, not the repo: a failure writes
`osxphotos_crash.log` into the current directory.

- **A number comes back:** this session can read the database, which is the
  Full Disk Access grant. Queries and exports of originals already on disk can
  run directly. Downloads (`--download-missing --use-photokit`) and `import`
  go through PhotoKit, which needs the separate Photos grant (Setup step 3),
  and a successful query does not show this session has it. Run those
  through the relay unless one has already succeeded directly in this
  session. If one fails directly, relay it, and before relaying an import,
  check the album first (Step 4).
- **`Operation not permitted` on `Photos.sqlite`:** use the relay for *every*
  osxphotos command in this session — query, export and import alike. Delete
  the `osxphotos_crash.log` the failure wrote into the working directory, and
  never commit it; it is a stack trace with the library path in it.

**Confirm the library before the first read.** Every osxphotos command
without `--library` uses the *last opened* library, and its stderr starts
with `Using last opened Photos library: <path>`. osxphotos's own docs say that
automatic choice is not always the library the user expects. So on first use
in a session, run `osxphotos list` (directly or through the relay, as above).
If it shows only one library of the user's own (ignore the
`Syndication.photoslibrary` entries macOS keeps for shared-with-you items) and
that is the last opened one, carry on. If it shows more than one, ask the user
which library they mean before querying anything, then pass `--library
"<that path>"` to every query and export for the rest of the session. Step 4
adds what an import needs on top of this.

Never retry an `import` directly after a failure, and never retry it at all
before checking. A direct import has been seen to copy the file into the
library and *then* crash, so a blind retry duplicates it. Query the target
album first (Step 4).

## Step 2 — The relay

Write the command into a script, start that script in the relay app, and wait
for a sentinel file.

```sh
OSXP=$(/bin/zsh -fc 'whence -p osxphotos') || { echo "osxphotos not on PATH"; exit 1; }
echo "relaying with $OSXP"   # check it before the first run; see below
RUN=$(mktemp -d "<scratch dir>/photos-XXXXXX") || { echo "mktemp failed"; exit 1; }
[[ $RUN == *[^A-Za-z0-9/._-]* ]] && { echo "unsafe run path: $RUN"; exit 1; }
/bin/zsh -f -s -- "$RUN" "$OSXP" "<recent date>" <<'GEN'
{
  printf '#!/bin/zsh -f\n'
  printf 'cd %q\n' "$1"
  printf '%q query --only-movies --not-hidden --from-date %q --json > out.json 2> err.log\n' "$2" "$3"
  print -r -- 'echo $? > exit.code'
  print -r -- 'touch done'
} > "$1/run.sh"
GEN
chmod +x "$RUN/run.sh"

(osascript -e 'with timeout of 20 seconds' \
  -e "tell application \"iTerm\" to create window with default profile command \"$RUN/run.sh\"" \
  -e 'end timeout' > "$RUN/osa.log" 2>&1 &)

for i in $(seq 1 90); do [ -f "$RUN/done" ] && break; sleep 2; done
cat "$RUN/exit.code" "$RUN/osa.log"; tail -5 "$RUN/err.log"
```

Each part is there for a reason:

- **A script file, not an inline command.** Inline, the command would cross
  an AppleScript string as well as the shell. The file removes the AppleScript
  layer: only `$RUN/run.sh` goes into the `osascript` line, and never any
  other value. The script is also a record of exactly what ran.
- **The run path is checked before it is used.** That one path still crosses
  two layers unquoted: the AppleScript string, and the relay app splitting
  the command on spaces. A scratch directory with a space in it (`~/Temporary
  Files`) would launch only the part before the space, and the sentinel would
  never appear. Escaping for both layers at once is easy to get wrong, so the
  check refuses any path with characters outside letters, digits, `/`, `.`,
  `_` and `-`. If it fires, pick a scratch directory that passes rather than
  escaping around it.
- **Every value goes in through zsh's `printf %q`, inside a quoted heredoc.**
  The shell layer is still there: the script is shell code that runs with the
  relay app's Full Disk Access. Album names, paths, titles and uuids are data,
  and some of them come from the library rather than from you (a shared
  album's name is set by whoever shared it). The values reach the generator
  as positional arguments (`$1`, `$2`, …) and `%q` quotes each one so the
  script sees one literal argument, whatever `"`, `'`, `$(...)`, backticks,
  spaces, `{template}` braces or a leading `-` it holds. An unquoted heredoc
  (`<<EOF`) would instead expand `$(...)` and `$VAR` while writing the file,
  and a `"` in a value would end the quoting inside the script, so a name like
  `x"; curl … | sh; "` would become a command. Build every osxphotos line in
  Steps 3 and 4 the same way: the command and flags in the format string, each
  value as a positional argument to the generator and a `%q` in the format.
- **The generator runs in `/bin/zsh`, whatever your own shell is.** `%q`
  quotes for the shell that runs it, and the script runs in zsh. bash's `%q`
  leaves a leading `=` or `~` bare, and zsh expands both at the start of a
  word: a value like `=Trips` aborts the script before it writes `exit.code`
  or `done`, so the run waits out the loop and reports nothing, and one like
  `~root` silently turns into a path. `-f` skips the user's zsh startup files,
  which the generator does not need.
- **osxphotos by absolute path, resolved in the session.** The relay app's
  `command` runs the file without an interactive shell, so a `PATH` entry
  the user only added in `~/.zshrc` is not loaded, and a login shell (`-l`)
  does not load `.zshrc` either. Resolving the path here and writing it into
  the script (through `%q`, like any other value) works whichever startup
  file set `PATH`. With the path absolute, the script needs no startup files
  at all, hence `-f`. If nothing resolves, ask the user for the path rather
  than guessing one.
- **That path gets the relay app's Full Disk Access, so check it.**
  `whence -p` returns only an executable file on `PATH`, never an alias or a
  shell function, which `command -v` can return. But `PATH` itself can put a
  project's own `osxphotos` (a `node_modules/.bin`, a repo `bin/`, a virtualenv
  inside the checkout) ahead of the real one, and whatever it finds runs with
  access to every file on the disk. Before the first run, refuse a path inside
  the repository or the current working directory. If the path is not under
  the user's tool locations (`~/.local/bin`, a `pipx` or `uv` tools
  directory, `/opt/homebrew/bin`, `/usr/local/bin`), show it to the user and
  wait for their yes. Name the path in your report either way.
- **`mktemp -d` for the run directory, outside the repo, checked.** If the
  scratch parent is missing or unwritable, `mktemp` fails and `RUN` is
  empty; without the `||` the script would go to `/run.sh` and the loop
  would wait three minutes on `/done` before showing anything. Every run
  needs a directory no earlier run has used, because the wait loop trusts the first `done` it
  sees. A name built from the time (`$(date +%s)`) repeats for runs started
  in the same second, such as the split export runs below, and `mkdir -p`
  would reuse the old directory silently: the loop finds the earlier run's
  `done` at once and prints that run's `exit.code` and output as this one's.
  `mktemp -d` creates a new directory or fails.
- **`cd "$RUN"`, so every path argument must be absolute.** A crashing
  osxphotos writes `osxphotos_crash.log` into the current directory, which
  keeps it out of the repo. The same `cd` means a relative path in the
  script (`exports/clips`, `media/clip.mp4`) resolves inside the run
  directory: an export lands in scratch and an import cannot find its file.
  Resolve every export destination and import source to an absolute path
  in the session (zsh `${p:A}`, or `realpath`) before passing it in.
- **Output, stderr and exit code to files.** Nothing the relay app prints
  reaches the session. The exit code is the only reliable success signal:
  osxphotos prints progress to stderr even when it succeeds.
- **`with timeout of 20 seconds`, backgrounded, logged.** The relay app can
  stop answering Apple events — iTerm has done so with many windows open — and
  then `osascript` hangs indefinitely and takes the session's shell with it.
  The timeout bounds that; the background subshell keeps it from blocking even
  when the timeout does not fire; the log is where the failure shows up.
- **A bounded wait inside the same command.** The loop waits for this run's
  sentinel and gives up after three minutes. It is part of this turn's work,
  not a wake-up or a scheduled check-in — those are never the answer here.
  Raise the bound for a large export rather than looping again blind.
- **A shell-tool timeout above the loop's bound.** If your shell tool kills a
  command after a fixed time (Claude Code's Bash tool stops a foreground call
  at 120 s unless the call passes a longer `timeout`, up to 600 s), the tool
  kills a slow run before the loop gives up and before the trailing `cat`
  prints the diagnostics the next section depends on. Pass a timeout a little
  above the loop's bound (200 s for the 180 s loop above), and raise both
  together. The tool only kills the wait, never the relayed job: that runs
  in the relay app and keeps going. So if a wait is cut off or gives up,
  keep the same `$RUN` and wait on its `done` again; do not start another
  run for the same uuids until it appears, or two exports write the same
  files at once. To keep a run inside one wait, split a large export
  across several runs from the start.

For Terminal instead of iTerm, the launch line is
`tell application "Terminal" to do script "$RUN/run.sh"`. Terminal's `do
script` types that path into an interactive shell, which is one more reason
the run-path check above matters. This variant
follows Terminal's documented AppleScript but has not been exercised the way
the iTerm one has; say so if you use it.

A successful launch leaves `window id <n>` in `osa.log`.

**When the sentinel never appears:**

- `osa.log` holds `Not authorized to send Apple events` → an Automation prompt
  was declined (Setup step 4).
- `osa.log` holds a timeout (`AppleEvent timed out`, error -1712) → the relay
  app is not answering. A timed-out Apple event may still be queued and run
  once the app recovers, so treat the timed-out run as *possibly still
  coming*, not as cancelled. For a query, or an export into a destination
  no other run uses, wait a few minutes and retry once in a new run
  directory; if both end up running, the cost is a duplicate read. **Never
  relaunch an import after a timeout.** Tell the user the import may still
  run when the relay app responds, and leave it to them: a second launch can
  land the file twice. If the retry also times out, stop and tell the user
  the relay app is not responding (often after many windows have piled up
  in it). Do not quit or
  restart the relay app and do not close its windows: the user is working in
  them, and the ones you did not open are not yours.
- `osa.log` is empty and `err.log` shows `Operation not permitted` → the relay
  app lacks Full Disk Access, or was not restarted after the grant.
- `exit.code` is non-zero → read `err.log`; that is an osxphotos error, not a
  relay one.

Leave the windows the relay opens alone too. Whether one closes when its
script exits depends on the user's profile settings; one left open is the
user's to close.

## Step 3 — Reading: query and export

**Query is free; export downloads.** `osxphotos query --json` reads only the
database. On an iCloud-optimized library an export of originals can be
gigabytes and minutes per large video, so find what you want with queries
first and export only the shortlist.

Useful query filters: `--from-date`/`--to-date`, `--album`, `--person`,
`--label` (Apple's own image classification, which works on libraries with no
keywords), `--only-movies`/`--only-photos`, `--uuid`. Trash is excluded by
default; **hidden items are not**. Pass `--not-hidden` on every query and
export, and drop it only when the user asks to search their hidden items.
Hiding something is the user saying it should not come up in passing. Fields in the JSON worth knowing:

| Field | Why it matters |
| --- | --- |
| `uuid` | The only stable identity. Export and dedupe by this. |
| `original_filename`, `date` | Camera counters reset, so `IMG_1216` exists in several years. Never select by filename without a date range. |
| `ismissing` | `true` means the original is iCloud-only; exporting it downloads. |
| `path_derivatives` | Preview JPEGs Photos already keeps on disk, even for iCloud-only items. Look at these instead of exporting when you only need to see the image or a video's poster frame. |
| `albums`, `persons`, `labels`, `place` | Searchable context for picking items. |

Photos can hold the same item twice (an item imported twice gets a second
uuid). When it matters, collapse on filename plus timestamp plus duration, and
export by `--uuid`.

Export the shortlist by uuid:

```sh
osxphotos export "<dest>" --uuid <uuid> --uuid <uuid> \
  --download-missing --use-photokit --skip-edited --skip-live \
  --filename "{uuid}" --not-hidden --no-exportdb
```

- `--download-missing --use-photokit` fetches iCloud-only originals; without
  both, those items are skipped with only a log line to show for it.
  osxphotos's own help says `--use-photokit` does not work with iTerm2 and
  to use Terminal. With osxphotos 0.77.2 it did work through the iTerm
  relay: an iCloud-only clip exported with `missing: 0, error: 0`. So
  iTerm stays the default, but read the summary line. If a relayed iTerm
  export reports items as missing or errored, rerun that export with
  Terminal as the relay app before concluding the download failed.
- `--skip-edited` exports the original, not the user's edit in Photos. Drop it
  when the user wants their edits.
- `--skip-live` skips the short video half of a Live Photo, which otherwise
  appears as a second file per still.
- `--no-exportdb` stops osxphotos leaving `.osxphotos_export.db` in the
  destination. That hidden database holds metadata for what was exported,
  including places and people's names, and travels with the folder if it is
  zipped or shared. These are one-off exports, so nothing needs it.
- `--filename "{uuid}"` names files by uuid, which avoids the repeating
  camera filenames colliding in one directory.

After an export, read the `Processed: … exported: …, missing: …, error: …`
line in its output, then check the destination holds a `<uuid>.<ext>` file
for each uuid you asked for. An iCloud download can fail for one item in a batch, and an
exit code covers the batch. The uuid-named files are what prove each one
arrived, which is why `--filename "{uuid}"` is part of the command:
under original filenames, repeated camera names get numbered suffixes that
no longer map back to a uuid.

## Step 4 — Writing: import into a permitted album only

**Never modify, delete, retag, rename, favorite, hide, or move anything
already in the library.** The user's library is the only copy of most of it,
and a metadata change made from a script has no undo in Photos. The only write this skill
makes is importing new files into an album from `## Photos` → writable albums.
Only when the profile has no `## Photos` section may it import into an album
the user named as the destination in this session's messages (see What this
skill reads).

**An import lands in the most recently opened Photos library**, which is not
necessarily the system library, and `--library` does not redirect it. So
the library Step 1 confirmed must also be the last opened one: check the
`Using last opened Photos library:` line in the latest `err.log`. If it names
a different library, stop and ask the user to open the right library in
Photos before importing anything.

```sh
osxphotos import --album "<permitted album>" --skip-dups \
  --title "{filepath.stem}" "<file>"
```

- **The album name must be a literal, and braces make it a template.**
  `--album` is rendered as an osxphotos template, so a name containing `{`
  or `}` (`{created.year}`, `{filepath.parent}`) can create or write to an
  album other than the one named. Refuse an album name with a brace in it,
  even one from the profile, and report it. Do not try to escape it.
- **No `/` in the album name either.** Import and query read a slash
  differently: to `query --album` it separates a folder from an album, and
  a literal slash has to be doubled (`Travel//2025`). A name with a slash
  would be imported under one reading and verified under the other. Refuse
  it and report it, the same as a brace.
- **`--skip-dups`** skips a file osxphotos considers already in the library,
  so a retry after an unclear failure does not duplicate. For photos that
  means the same fingerprint. **For videos it means the same lowercase
  filename and byte size**, because Photos does not always store a video
  fingerprint. A different video that happens to share both is skipped as a
  duplicate. So when a video import reports a skip, query the library for
  that filename and compare the match's date and duration with the file
  you meant to import before calling it a duplicate. A re-cut should
  carry a new filename (`<name>-v2.mp4`) anyway, which also keeps it clear of
  this rule. The import output says whether each file was imported or
  skipped; read it.
- **Verify after importing**, through the relay like everything else:
  `osxphotos query --album "<permitted album>" --not-hidden --json`, and
  confirm the new item is there. Without `--library` the query reads the last opened
  library, the same one the import wrote to. Check its `err.log` names the
  same path as before the import; if it doesn't, the user switched
  libraries in between, so say so instead of reporting the result.
  Report the uuid.

If an import's exit code is non-zero, run that verification query before
anything else. The file may already be in the library.

## Reporting

Say whether you ran directly or through the relay (and which app), what you
queried, which uuids you exported and where, and every import with its album
and uuid. If the profile supplied no writable album, say so, and say either
that no import was made or which session-named import was. If a grant was missing, name the Setup step rather than describing the
error.
