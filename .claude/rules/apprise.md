---
paths:
  - "backend/models/apprise.ts"
  - "backend/api/apprise.ts"
  - "backend/tasks/workers/dispatch-apprise.ts"
  - "frontend/src/components/AdminNotificationsApprise.vue"
---

# Apprise announcements (fork)

Not part of upstream Wiki.js — see `FORK.md`. Announces what happens on the wiki to ONE
administrator-chosen destination through [Apprise](https://github.com/caronc/apprise): a comment, an
edit suggestion, a suggestion approved or declined, a new account. It is a channel for the operators,
not a third delivery channel of the notification system beside in-app and email — that system tells
*people* what they may see and chose to hear about; this tells the admin's Discord everything ticked.

- **`apprise.emit(event, data)` never throws and only queues a job**, like `hooks.emit`. Call it from
  the route (or model) after the action succeeded, beside the matching `hooks.emit` /
  `notifications.emit`. The message text is built there, in the request process, which has the sites
  and the mail base URL; the `dispatchApprise` worker only sends it.
- **The destination never goes into the job table.** The job carries title and body; the worker
  re-reads the settings (`refreshWorkerConfig`) to learn where to send. URLs carry webhook tokens.
- **`urls` and `apiKey` are write-only**: `getMaskedConfig()` answers `SENSITIVE_MASK` for a set
  value, and the mask posted back means "unchanged" (`withoutMasks`).
- **`events` is a map, not a list.** Stored settings are merged over `base.yml` with `toMerged`,
  which merges arrays index by index; a map merges key by key.
- **Every user-supplied value goes through `field()`**, which collapses newlines and control
  characters and caps the length, so a crafted name or title cannot forge lines in the channel.
- **Two modes.** `cli` runs `apprise -t … -b … -- <urls>` (the fork's image installs the Debian
  `apprise` package; `--` and `splitUrls` keep a URL from being read as an option). `api` posts to an
  Apprise API server: `/notify/<apiKey>` for a configuration stored there, else stateless `/notify/`
  with the URLs.
- Adding an event: a key in `APPRISE_EVENTS`, its default in `base.yml`, a case in `messageFor`, an
  `emit` call, and `admin.apprise.eventLabels.<camelCase>` in `locales/en.json`.
