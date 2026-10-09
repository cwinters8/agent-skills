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

The alternative — granting Full Disk Access to the agent's host app — would
work, but it hands every session, every tool call and every prompt-injected
command the whole disk, not just the Photos library. The relay confines the
grant to the commands the agent writes into a script you can read. Do not
suggest the broader grant as a shortcut; if the user wants it, that is their
decision to make in System Settings.

## What this skill reads

Read `.claude/project-profile.md` → `## Photos` first. It supplies:

- **Writable albums** — the albums this project may import into. These are the
  only writes this skill will ever make.
- **Relay app** — the terminal app on this Mac that holds the grants, if it is
  not iTerm.

**Without a profile, or without a `## Photos` section,** run read-only: query
and export freely, and import only into an album the user's own message in
this session names as the destination. Say in your report that no writable
album was configured. For the relay app, use
iTerm if it is installed and Terminal otherwise, and say which one you used
and that you guessed.

## Setup the user does once

These are the user's steps — they are privacy settings, so an agent does not
change them. If the relay fails for a missing grant, name the missing step
and stop.

1. **Install osxphotos** — `uv tool install osxphotos`, `pipx install
   osxphotos`, or `brew install osxphotos`. Confirm with `osxphotos --version`.
2. **System Settings → Privacy & Security → Full Disk Access**: add the relay
   app. This is what lets osxphotos read `Photos.sqlite`.
3. **Privacy & Security → Photos**: give the relay app **Full Access**. This is
   what `--download-missing --use-photokit` and `import` need. A library on
   "Optimize Mac Storage" keeps most originals in iCloud, so without this an
   export silently skips everything that is not on disk.
4. **Automation**: the first relay run prompts twice — once for the agent's
   host app to control the relay app, once for the relay app to control
   Photos. Both must be allowed; a declined prompt makes `osascript` fail with
   `Not authorized to send Apple events`.

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

Never retry an `import` directly after a failure, and never retry it at all
before checking. A direct import has been seen to copy the file into the
library and *then* crash, so a blind retry duplicates it. Query the target
album first (Step 4).

## Step 2 — The relay

Write the command into a script, start that script in the relay app, and wait
for a sentinel file.

```sh
RUN="<scratch dir>/photos-$(date +%s)"     # a fresh dir per run, outside the repo
mkdir -p "$RUN"
cat > "$RUN/run.sh" <<EOF
#!/bin/zsh -l
cd "$RUN"
osxphotos query --only-movies --from-date 2026-10-01 --json > out.json 2> err.log
echo \$? > exit.code
touch done
EOF
chmod +x "$RUN/run.sh"

(osascript -e 'with timeout of 20 seconds' \
  -e "tell application \"iTerm\" to create window with default profile command \"$RUN/run.sh\"" \
  -e 'end timeout' > "$RUN/osa.log" 2>&1 &)

for i in $(seq 1 90); do [ -f "$RUN/done" ] && break; sleep 2; done
cat "$RUN/exit.code" "$RUN/osa.log"; tail -5 "$RUN/err.log"
```

Each part is there for a reason:

- **A script file, not an inline command.** The command crosses two quoting
  layers — the shell, then an AppleScript string. Paths with spaces, album
  names with quotes, and `{template}` arguments break one layer or the other.
  A file path has none of that, and the script is a record of exactly what ran.
- **`#!/bin/zsh -l`.** iTerm's `command` runs the file without an interactive
  shell, so the user's `PATH` is not loaded and `osxphotos` (often in
  `~/.local/bin`) is not found. A login shell loads it.
- **`cd "$RUN"`.** A crashing osxphotos writes `osxphotos_crash.log` into the
  current directory. Keep that out of the repo.
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

For Terminal instead of iTerm, the launch line is
`tell application "Terminal" to do script "$RUN/run.sh"`. Terminal's `do
script` runs in an interactive shell, so `-l` is harmless there. This variant
follows Terminal's documented AppleScript but has not been exercised the way
the iTerm one has; say so if you use it.

A successful launch leaves `window id <n>` in `osa.log`.

**When the sentinel never appears:**

- `osa.log` holds `Not authorized to send Apple events` → an Automation prompt
  was declined (Setup step 4).
- `osa.log` holds a timeout (`AppleEvent timed out`, error -1712) → the relay
  app is not answering. Wait a few minutes and retry once. Do not quit or
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
keywords), `--only-movies`/`--only-photos`, `--uuid`, `--not-hidden`. Trash is
excluded by default. Fields in the JSON worth knowing:

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
  --download-missing --use-photokit --skip-edited --skip-live
```

- `--download-missing --use-photokit` fetches iCloud-only originals; without
  both, those items are skipped with only a log line to show for it.
- `--skip-edited` exports the original, not the user's edit in Photos. Drop it
  when the user wants their edits.
- `--skip-live` skips the short video half of a Live Photo, which otherwise
  appears as a second file per still.
- `--filename "{uuid}"` names files by uuid, which avoids the repeating
  camera filenames colliding in one directory.

After an export, check the destination holds a file per uuid you asked for.
An iCloud download can fail for one item in a batch, and an exit code covers
the batch; counting the files is what proves each one arrived.

## Step 4 — Writing: import into a permitted album only

**Never modify, delete, retag, rename, favorite, hide, or move anything
already in the library.** The user's library is the only copy of most of it,
and a metadata change made from a script has no undo in Photos. The only write this skill
makes is importing new files into an album from `## Photos` → writable albums,
or one the user named as the destination in this session's messages.

```sh
osxphotos import --album "<permitted album>" --skip-dups \
  --title "{filepath.stem}" "<file>"
```

- **A literal album name.** `--album` accepts templates like
  `{filepath.parent}` that create albums from paths. Pass the permitted name
  exactly; a template can write somewhere nobody approved.
- **`--skip-dups`** skips a file whose fingerprint is already in the library,
  so a retry after an unclear failure does not duplicate. The same check
  silently skips a re-render that came out byte-identical; if a new version
  must land, it has to differ, and the output says whether it was imported or
  skipped — read it.
- **Verify after importing**, through the relay like everything else:
  `osxphotos query --album "<permitted album>" --json` and confirm the new
  item is there. Report the uuid.

If an import's exit code is non-zero, run that verification query before
anything else. The file may already be in the library.

## Reporting

Say whether you ran directly or through the relay (and which app), what you
queried, which uuids you exported and where, and every import with its album
and uuid. If the profile supplied no writable album, say that writes were
off. If a grant was missing, name the Setup step rather than describing the
error.
