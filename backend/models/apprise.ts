import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SENSITIVE_MASK } from '../helpers/common.ts'

const execFileAsync = promisify(execFile)

/**
 * The events Apprise can announce, as offered by Admin → Notifications. Every one of them has an
 * `apprise.emit()` call somewhere in the server; add the call in the same change that adds a key here.
 *
 * FORK: not part of upstream Wiki.js — see `FORK.md`.
 */
export const APPRISE_EVENTS = [
  'comment:new',
  'submission:new',
  'submission:approved',
  'submission:rejected',
  'user:join'
] as const

export type AppriseEvent = (typeof APPRISE_EVENTS)[number]

/** How a notification reaches Apprise: the `apprise` command, or an Apprise API server over HTTP. */
export const APPRISE_MODES = ['cli', 'api'] as const

export type AppriseMode = (typeof APPRISE_MODES)[number]

export const APPRISE_SETTINGS_FIELDS = [
  'isEnabled',
  'mode',
  'urls',
  'apiUrl',
  'apiKey',
  'events'
] as const

/** The settings that hold credentials, which the API never hands back. See `getConfig`. */
const SECRET_FIELDS = ['urls', 'apiKey'] as const

/** How long Apprise has to deliver before the attempt counts as failed. */
const DELIVERY_TIMEOUT = 20000

/** Longest a single field may run in a message, so a long title or name cannot flood the channel. */
const FIELD_MAX = 200

export interface AppriseConfig {
  isEnabled: boolean
  mode: AppriseMode
  /** Apprise URLs, separated by whitespace or commas. */
  urls: string
  /** The Apprise API server, e.g. `http://apprise:8000`. `api` mode only. */
  apiUrl: string
  /** A configuration key stored on that server. When set, `urls` is not sent. `api` mode only. */
  apiKey: string
  /** Every event in `APPRISE_EVENTS`, on or off. */
  events: Record<AppriseEvent, boolean>
}

/** One message, ready to send: everything is already resolved to text. */
export interface AppriseMessage {
  title: string
  body: string
}

/** What a call site knows about the event. Everything is optional; the message says what it has. */
export interface AppriseEventData {
  siteId?: string | null
  pageId?: string | null
  pageTitle?: string | null
  pagePath?: string | null
  actorName?: string | null
  submitterName?: string | null
  submissionId?: string | null
  isUpdate?: boolean
  userName?: string | null
  userEmail?: string | null
}

/**
 * A user-supplied value as it may appear in a message.
 *
 * Names and titles come from anyone who can register, comment or suggest an edit. Collapsing control
 * characters and newlines keeps each one on its line, so a crafted name cannot forge extra lines — a
 * fake "Review it here:" link, say — in the administrator's channel, and the cap bounds the message.
 */
export function field(value: unknown, max = FIELD_MAX): string {
  const str = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return str.length > max ? `${str.slice(0, max - 1)}…` : str
}

/** The URLs as a list, dropping anything that would read as a CLI option rather than a URL. */
export function splitUrls(urls: string): string[] {
  return String(urls ?? '')
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0 && !u.startsWith('-'))
}

/**
 * Apprise model
 *
 * Announces what happens on the wiki to one administrator-chosen destination — Discord, Slack,
 * Telegram, ntfy, email or any of the other services Apprise speaks — rather than to the people the
 * notification system tells. It is a broadcast to the site's operators, so there is no audience to
 * work out and no access to check: the channel is the administrator's.
 *
 * Like `hooks`, delivery goes through the scheduler rather than the request that triggered it, so a
 * slow or broken Apprise never delays anybody's action and a failed attempt is retried.
 */
class Apprise {
  get config(): AppriseConfig {
    return WIKI.config.apprise
  }

  /**
   * The settings as the admin screen sees them: credentials replaced by `SENSITIVE_MASK` when set,
   * and the mask posted back means "unchanged" (`withoutMasks`). Only the API route calls this; the
   * sending side reads `config`, which holds the real values.
   */
  getMaskedConfig(): AppriseConfig {
    const stored = this.config
    const masked: Record<string, any> = {
      isEnabled: stored.isEnabled,
      mode: stored.mode,
      urls: stored.urls,
      apiUrl: stored.apiUrl,
      apiKey: stored.apiKey,
      events: Object.fromEntries(APPRISE_EVENTS.map((e) => [e, stored.events?.[e] === true]))
    }
    for (const key of SECRET_FIELDS) {
      if (typeof masked[key] === 'string' && masked[key].length > 0) {
        masked[key] = SENSITIVE_MASK
      }
    }
    return masked as AppriseConfig
  }

  /**
   * Check a patch against the settings it will be merged with.
   *
   * @returns The reason it is invalid, or null when it is fine
   */
  validate(patch: Record<string, any>): string | null {
    const picked = this.withoutMasks(patch)
    const merged = { ...this.config, ...picked }
    if (
      picked.events !== undefined &&
      (typeof picked.events !== 'object' || picked.events === null)
    ) {
      return 'Events must be an object.'
    }
    if (typeof merged.isEnabled !== 'boolean') {
      return 'isEnabled must be true or false.'
    }
    if (!APPRISE_MODES.includes(merged.mode)) {
      return `The mode must be one of ${APPRISE_MODES.join(', ')}.`
    }
    for (const key of ['urls', 'apiUrl', 'apiKey'] as const) {
      if (typeof merged[key] !== 'string' || merged[key].length > 8192) {
        return `${key} must be a string of at most 8192 characters.`
      }
    }
    if (
      typeof merged.events !== 'object' ||
      merged.events === null ||
      Object.entries(merged.events).some(
        ([e, on]) => !APPRISE_EVENTS.includes(e as AppriseEvent) || typeof on !== 'boolean'
      )
    ) {
      return `Events must map each of ${APPRISE_EVENTS.join(', ')} to true or false.`
    }
    if (merged.mode === 'api' && merged.apiUrl.trim()) {
      try {
        const url = new URL(merged.apiUrl.trim())
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new Error('protocol')
        }
      } catch {
        return 'The Apprise API URL must be an http:// or https:// address.'
      }
    }
    if (!/^[\w-]*$/.test(merged.apiKey.trim())) {
      return 'The Apprise configuration key may only contain letters, digits, - and _.'
    }
    return null
  }

  /** A patch with the masked credentials taken out, which means "keep what is stored". */
  withoutMasks(patch: Record<string, any>): Record<string, any> {
    const picked: Record<string, any> = {}
    for (const field of APPRISE_SETTINGS_FIELDS) {
      if (patch[field] === undefined) {
        continue
      }
      if ((SECRET_FIELDS as readonly string[]).includes(field) && patch[field] === SENSITIVE_MASK) {
        continue
      }
      picked[field] = patch[field]
    }
    return picked
  }

  /**
   * Save the settings, on every instance.
   *
   * @returns Whether they were saved
   */
  async updateConfig(patch: Record<string, any>): Promise<boolean> {
    const previous = WIKI.config.apprise
    const picked = this.withoutMasks(patch)
    WIKI.config.apprise = {
      ...previous,
      ...picked,
      events: { ...previous.events, ...picked.events }
    }
    if (!(await WIKI.configSvc.saveToDb(['apprise']))) {
      WIKI.config.apprise = previous
      return false
    }
    return true
  }

  /** Whether there is anywhere to send to, in the stored settings. */
  isConfigured(config: AppriseConfig = this.config): boolean {
    if (config.mode === 'api') {
      return (
        Boolean(config.apiUrl.trim()) &&
        Boolean(config.apiKey.trim() || splitUrls(config.urls).length)
      )
    }
    return splitUrls(config.urls).length > 0
  }

  /**
   * Where a link in a message points. The mail settings' base URL when one is set, otherwise the
   * site's own hostname — or, for an event that belongs to no site, the first site that has one.
   */
  linkTo(siteId: string | null | undefined, path: string): string | null {
    let base = WIKI.models.mail.baseUrl({ siteId: siteId ?? undefined })
    if (!base && !siteId) {
      const site = Object.values(WIKI.sites ?? {}).find(
        (s: any) => s?.hostname && s.hostname !== '*'
      ) as any
      base = site ? `https://${site.hostname}` : null
    }
    return base ? `${base}${path}` : null
  }

  /** What an event says. Built in the request process, which has the sites and the mail settings. */
  messageFor(event: AppriseEvent, data: AppriseEventData): AppriseMessage {
    const page = `"${field(data.pageTitle || data.pagePath || 'Untitled')}"`
    const pageLink = data.pageId ? this.linkTo(data.siteId, `/i/${data.pageId}`) : null
    const lines: string[] = []
    let title: string

    switch (event) {
      case 'comment:new': {
        title = 'New Comment'
        lines.push(`${field(data.actorName || 'Someone')} commented on ${page}.`)
        const link = data.pageId ? this.linkTo(data.siteId, `/i/${data.pageId}#talk`) : null
        if (link) lines.push('', link)
        break
      }
      case 'submission:new': {
        title = data.isUpdate ? 'Edit Suggestion Updated' : 'Edit Suggested for Review'
        lines.push(
          `${field(data.actorName || 'Someone')} ${data.isUpdate ? 'updated their suggested edit to' : 'suggested an edit to'} ${page}.`
        )
        const link = data.submissionId
          ? this.linkTo(data.siteId, `/_inbox/review/${data.submissionId}`)
          : null
        if (link) lines.push('', `Review it here: ${link}`)
        break
      }
      case 'submission:approved': {
        title = 'Edit Suggestion Approved'
        lines.push(
          `${field(data.actorName || 'A reviewer')} approved the edit to ${page} suggested by ${field(data.submitterName || 'a guest')}.`
        )
        if (pageLink) lines.push('', `View it here: ${pageLink}`)
        break
      }
      case 'submission:rejected': {
        title = 'Edit Suggestion Declined'
        lines.push(
          `${field(data.actorName || 'A reviewer')} declined the edit to ${page} suggested by ${field(data.submitterName || 'a guest')}.`
        )
        if (pageLink) lines.push('', `Page: ${pageLink}`)
        break
      }
      case 'user:join': {
        title = 'New User Registered'
        lines.push(
          'A new account was created:',
          '',
          `Name: ${field(data.userName || 'Unknown')}`,
          `Email: ${field(data.userEmail || 'None')}`
        )
        const link = this.linkTo(null, '/_admin/users')
        if (link) lines.push('', `Manage users: ${link}`)
        break
      }
    }
    return { title, body: lines.join('\n') }
  }

  /**
   * Queue an announcement of an event, if Apprise is on and the event is ticked.
   *
   * Safe to call from anywhere, including request handlers: it only writes a job, and it never
   * throws — an Apprise problem must not fail the action that triggered it. Call it after the action
   * has succeeded.
   *
   * @returns Whether a delivery was queued
   */
  async emit(event: AppriseEvent, data: AppriseEventData = {}): Promise<boolean> {
    try {
      const config = this.config
      if (!config?.isEnabled || config.events?.[event] !== true || !this.isConfigured(config)) {
        return false
      }
      const message = this.messageFor(event, data)
      // -> The message travels with the job; the destination does not, so no credential is written
      //    to the job table. The worker reads it from the settings when it sends.
      const added = await WIKI.scheduler.addJob({
        task: 'dispatchApprise',
        payload: { event, ...message }
      })
      return Boolean(added?.id)
    } catch (err: any) {
      WIKI.logger.warn(`Failed to queue Apprise notification for ${event}: ${err.message}`)
      return false
    }
  }

  /**
   * Send one message through Apprise, with the stored settings unless others are given.
   *
   * Called by the `dispatchApprise` worker task and by the admin screen's test. Throws on failure, so
   * the scheduler retries a queued delivery and the test can say what went wrong.
   */
  async send(message: AppriseMessage, config: AppriseConfig = this.config): Promise<void> {
    if (!this.isConfigured(config)) {
      throw new Error('Apprise has nowhere to send to: no URLs (or API server) are configured.')
    }
    if (config.mode === 'api') {
      await this.sendViaApi(message, config)
    } else {
      await this.sendViaCli(message, config)
    }
  }

  /** The `apprise` command, which has to be on the PATH (the fork's image installs it). */
  async sendViaCli(message: AppriseMessage, config: AppriseConfig): Promise<void> {
    const urls = splitUrls(config.urls)
    try {
      // -> `--` ends option parsing, so whatever follows is only ever read as a URL
      await execFileAsync('apprise', ['-t', message.title, '-b', message.body, '--', ...urls], {
        timeout: DELIVERY_TIMEOUT
      })
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(
          'The apprise command was not found on this server. Install Apprise, or switch to an Apprise API server.'
        )
      }
      // -> Apprise prints why on stderr; the URLs are not repeated, since they carry tokens
      const reason = String(err.stderr || err.message || '')
        .trim()
        .split('\n')
        .slice(-3)
        .join(' ')
      throw new Error(`Apprise could not deliver the notification: ${reason}`)
    }
  }

  /**
   * An Apprise API server (`caronc/apprise`): `POST /notify/<key>` for a configuration stored on the
   * server, or a stateless `POST /notify/` carrying the URLs.
   */
  async sendViaApi(message: AppriseMessage, config: AppriseConfig): Promise<void> {
    const base = config.apiUrl.trim().replace(/\/+$/, '')
    const key = config.apiKey.trim()
    const endpoint = key ? `${base}/notify/${encodeURIComponent(key)}` : `${base}/notify/`
    const body = {
      title: message.title,
      body: message.body,
      type: 'info',
      format: 'text',
      ...(key ? {} : { urls: splitUrls(config.urls).join(',') })
    }
    let res: Response
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // -> No version: this runs in a worker thread, whose minimal WIKI does not carry one
          'user-agent': 'Wiki.js'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT)
      })
    } catch (err: any) {
      throw new Error(
        `The Apprise API server could not be reached: ${err.cause?.message ?? err.message}`
      )
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).trim().slice(0, 300)
      throw new Error(
        `The Apprise API server answered with HTTP ${res.status}${detail ? `: ${detail}` : '.'}`
      )
    }
  }

  /** The message the admin screen's test sends. */
  testMessage(): AppriseMessage {
    return {
      title: 'Wiki.js Test Notification',
      body: 'This is a test notification from Wiki.js. If you received this, your Apprise configuration is working.'
    }
  }
}

export const apprise = new Apprise()
