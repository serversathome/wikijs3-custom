# Fork changes

This repository is [Wiki.js 3](https://github.com/requarks/wiki) (imported from upstream tag
`3.0.2`, history intact) with the additions below. Upstream is the `upstream` remote; merge new
releases from it. Fork code is marked `FORK:` in comments so a merge conflict is easy to place, and
new code lives in files of its own wherever it can, so upstream files gain only a few lines.

## Apprise announcements

Admin → Notifications → **Apprise** sends a message to Discord, Slack, Telegram, ntfy, email or any
other [Apprise](https://github.com/caronc/apprise) service when:

| Event | Message links to |
| --- | --- |
| a comment is posted (`comment:new`) | the page's Talk tab |
| an edit is suggested or a suggestion is updated (`submission:new`) | the review screen |
| a suggested edit is approved (`submission:approved`) | the page |
| a suggested edit is declined (`submission:rejected`) | the page |
| an account is created (`user:join`) | Admin → Users |

Each event can be switched off. Two delivery modes:

- **Apprise command** (default): runs `apprise` on the wiki server with the URLs entered. The image
  built from `dev/build/Dockerfile` installs it.
- **Apprise API server**: posts to e.g. a `caronc/apprise` container at `http://apprise:8000`, either
  with a configuration key stored on that server or with the URLs entered.

**Save and Send Test** checks the destination before anything real is sent. Links in messages use
Admin → Mail's base URL when one is set, otherwise the site's hostname.

| File | What |
| --- | --- |
| `backend/models/apprise.ts` | settings, messages, queueing, delivery (CLI and API) |
| `backend/api/apprise.ts` | `GET`/`PUT /_api/system/apprise`, `POST /_api/system/apprise/test` (`manage:system`) |
| `backend/tasks/workers/dispatch-apprise.ts` | the worker task that sends a queued message |
| `backend/base.yml` | `apprise` defaults (off) |
| `frontend/src/components/AdminNotificationsApprise.vue` | the admin card |
| `.claude/rules/apprise.md` | the rules for working on it |

Upstream files touched, one `apprise.emit()` each: `api/comments.ts`, `api/feedback.ts`,
`api/approvals.ts` (submit, approve, decline), `models/users.ts` (`createUser`). Plus registrations
in `models/index.ts` and `api/index.ts`, strings in `backend/locales/en.json`, the card in
`frontend/src/pages/AdminNotifications.vue`, and `apprise` in the Dockerfile's package list.
