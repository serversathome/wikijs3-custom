# Fork changes

This repository is [Wiki.js 3](https://github.com/requarks/wiki) (imported from upstream tag
`3.0.2`, history intact; last merged up to `3.3.0`) with the additions below. Upstream's 3.x
releases are tagged on its `scarlett` branch; add it as the `upstream` remote
(`git remote add upstream https://github.com/requarks/wiki.git`) and merge new release tags from it. Fork code is marked `FORK:` in comments so a merge conflict is easy to place, and
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

## Docker image

`.github/workflows/fork-image.yml` builds `dev/build/Dockerfile` and publishes it to
`ghcr.io/serversathome/wikijs3-custom` on every push to `main`, then cuts a GitHub release for it —
nothing is tagged or released by hand. Pushes touching only documentation (`*.md`, `.claude/`, the
dev container, the charts) publish nothing.

The version is the upstream release the fork is built on plus a running number: `3.0.2-fork.1`,
`3.0.2-fork.2`, …, restarting at `.1` once a newer upstream release is merged in. Each build is
tagged `latest`, `main`, `sha-<commit>` and its version; the release is `v<version>`, with the pull
command and the commits since the previous release as its notes. linux/amd64 by default; run the
workflow by hand on `main` with **arm64** ticked to rebuild the current release multi-arch (it keeps
its version and makes no new release). Upstream's own `build.yml` is left as it is: it only runs on
upstream's branch or by hand, and publishes to upstream's registries.

`dev/fork/docker-compose.yml` is a ready-to-run deployment (PostgreSQL 17 + the wiki, with an
optional Apprise API server). The first administrator is created on the first start from `ADMIN_EMAIL` / `ADMIN_PASS` (upstream's
defaults are `admin@example.com` / `12345678` when they are left out).
