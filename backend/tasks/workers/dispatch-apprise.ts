import { apprise } from '../../models/apprise.ts'
import { refreshWorkerConfig } from '../../notifications/queue.ts'

/**
 * Send one message through Apprise.
 *
 * Queued by `models/apprise.ts` → `emit()`, one job per event, so a slow Apprise delays nothing else
 * and a failing one is retried with the scheduler's backoff. A worker thread rather than in-process
 * for the same reason as `dispatchWebhook`: it waits on somebody else's server, or a child process.
 *
 * The job carries the message but not the destination — the URLs are credentials and stay out of the
 * job table — so the settings are re-read here, a worker thread's copy being otherwise as old as
 * the thread.
 *
 * FORK: not part of upstream Wiki.js — see `FORK.md`.
 */
export async function task(job: {
  payload: { event: string; title: string; body: string }
}): Promise<void> {
  await WIKI.ensureDb!()
  await refreshWorkerConfig()
  if (!WIKI.config.apprise?.isEnabled) {
    // -> Turned off between queueing and sending; nothing to do and nothing to retry
    return
  }
  try {
    await apprise.send({ title: job.payload.title, body: job.payload.body })
    WIKI.logger.debug(`Sent Apprise notification for ${job.payload.event} [ OK ]`)
  } catch (err: any) {
    WIKI.logger.warn(`Failed to send Apprise notification for ${job.payload.event}: ${err.message}`)
    // -> Rethrown so the job fails and the scheduler retries it
    throw err
  }
}
