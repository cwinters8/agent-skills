# Mobile store release readiness

Load this when `## Release targets` names the App Store or Google Play. These are
store requirements, not merely good practice: failing one blocks the release at
review, after the work is done.

Run these on a full sweep. On a per-change diff, only the two a config change can
actually affect — M4 and M5 — apply; don't run a whole store audit because a
scheme moved.

## M1. In-app account deletion

App Store Review Guideline 5.1.1(v) requires any app offering account creation to
also offer account deletion **from within the app**. Google Play has a parallel
requirement, including a web-reachable deletion route. An app that creates
accounts — including passwordless sign-up by magic link, which creates one on
first use — is in scope. Treat a missing delete path as a launch blocker.

**Removing the server-side rows is not the whole path.** Deleting the account
record does nothing to the session cached on the device or the data persisted
locally, so an implementation that stops there leaves the deleted account's
identity and content on screen until a token refresh fails or the app restarts —
and that stale local state can then bleed into the next guest or account session,
the same device-sharing leak the sign-out rule covers.

A successful deletion must also cancel any queued background sync, remove the
local auth session, and clear locally cached user data. Mirror the sign-out
failure rule while doing it: if the deletion call fails, keep the session *and*
the local data rather than wiping state for an account that still exists.

Check the cascade: deleting the identity record should remove dependent rows, or
the deletion leaves orphaned user data behind.

## M2. Data-collection disclosure

Whatever the app collects must be declared accurately in App Store privacy
nutrition labels, the iOS privacy manifest (`PrivacyInfo.xcprivacy`), and the
Play Data Safety form.

Get the recipients right **per data type** — an over-broad disclosure is its own
compliance problem, not a safe default. For each third party, ask what it
actually receives:

- The backend that stores accounts receives the identifier and the user's data.
- An over-the-air update service receives update-check metadata (runtime version,
  channel, update id, and the device IP as with any request) — not the account
  identifier, unless something explicitly sends it. Declare it against the data
  it actually gets.
- **Mail and messaging delivery.** A passwordless sign-in hands the entered
  address to whatever service sends the message — the backend's built-in sender
  by default, or a third-party SMTP provider if one is configured in a dashboard.
  Check the **deployed** setting before naming the backend as sole recipient; a
  configured provider is a processor too and belongs in the disclosure even
  though it appears nowhere in the repo.

## M3. Privacy policy

A reachable URL is mandatory for both stores once an account exists.

## M4. Permissions

Declare only the runtime permissions a feature actually needs, and remove any a
dependency added transitively that nothing uses. A permission with no
corresponding feature is both a review risk and a disclosure problem.

## M5. Encryption declaration

`ITSAppUsesNonExemptEncryption` must be accurate for what the app actually does.
HTTPS-only usage keeps an app exempt; adding custom cryptography does not. Check
it whenever app config changes, since it is a one-line claim that silently goes
stale.

## M6. Launch flag

If the project keeps a flag distinguishing pre-launch from launched — one that
gates carve-outs like "no migration code yet" — flipping it belongs in the same
change that ships the first release. From that moment real user data exists and
those carve-outs stop applying.
