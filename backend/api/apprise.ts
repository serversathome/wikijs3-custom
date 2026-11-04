import { audit } from '../helpers/audit.ts'
import { APPRISE_EVENTS, APPRISE_MODES, APPRISE_SETTINGS_FIELDS } from '../models/apprise.ts'
import type { FastifyInstance } from 'fastify'

/**
 * Admin → Notifications → Apprise: where the wiki announces what happens on it.
 *
 * FORK: not part of upstream Wiki.js — see `FORK.md`. Instance-wide and behind `manage:system`, like
 * the notification settings beside it. The URLs and the API key are credentials for somebody else's
 * service, so they read back as `SENSITIVE_MASK` and the mask posted back means "unchanged".
 */

const settingsSchema = {
  type: 'object',
  properties: {
    isEnabled: { type: 'boolean' },
    mode: { type: 'string', enum: [...APPRISE_MODES] },
    urls: { type: 'string', maxLength: 8192 },
    apiUrl: { type: 'string', maxLength: 2048 },
    apiKey: { type: 'string', maxLength: 256 },
    events: {
      type: 'object',
      properties: Object.fromEntries(APPRISE_EVENTS.map((e) => [e, { type: 'boolean' }])),
      additionalProperties: false
    }
  }
}

async function routes(app: FastifyInstance) {
  /**
   * GET APPRISE SETTINGS
   */
  app.get(
    '/system/apprise',
    {
      config: {
        permissions: ['manage:system']
      },
      schema: {
        summary: 'Get the Apprise settings',
        description:
          'Where the wiki announces comments, edit suggestions, review decisions and new accounts. The URLs and the API key are masked when set.',
        tags: ['Notifications'],
        response: {
          200: {
            description: 'Settings',
            type: 'object',
            properties: {
              settings: settingsSchema,
              events: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    },
    async (_req, reply) => {
      reply.preventCache()
      return {
        settings: WIKI.models.apprise.getMaskedConfig(),
        events: APPRISE_EVENTS
      }
    }
  )

  /**
   * UPDATE APPRISE SETTINGS
   */
  app.put<{ Body: Record<string, any> }>(
    '/system/apprise',
    {
      config: {
        permissions: ['manage:system']
      },
      schema: {
        summary: 'Update the Apprise settings',
        description:
          'Accepts any subset of the fields, and of the events within `events`. A masked URL list or API key leaves the stored one as it is.',
        tags: ['Notifications'],
        body: settingsSchema,
        response: {
          200: {
            description: 'Saved',
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              message: { type: 'string' }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const patch: Record<string, any> = {}
      for (const field of APPRISE_SETTINGS_FIELDS) {
        if (req.body?.[field] !== undefined) {
          patch[field] = req.body[field]
        }
      }
      if (Object.keys(patch).length < 1) {
        return reply.badRequest('No valid Apprise setting was provided.')
      }
      const invalid = WIKI.models.apprise.validate(patch)
      if (invalid) {
        return reply.badRequest(invalid)
      }
      if (!(await WIKI.models.apprise.updateConfig(patch))) {
        return reply.internalServerError('Failed to save the Apprise settings.')
      }
      // -> Fields rather than values, as the other configuration routes do: the values are credentials
      await audit(req, 'admin', 'updateNotificationSettings', {
        fields: Object.keys(patch)
          .map((f) => `apprise.${f}`)
          .sort()
      })
      return { ok: true, message: 'Apprise settings saved successfully.' }
    }
  )

  /**
   * SEND A TEST
   */
  app.post(
    '/system/apprise/test',
    {
      config: {
        permissions: ['manage:system']
      },
      schema: {
        summary: 'Send a test notification through Apprise',
        description:
          'Sends at once, through the saved settings, and answers with why it failed when it did. Works whether or not Apprise is switched on, so a destination can be checked before it is.',
        tags: ['Notifications'],
        response: {
          200: {
            description: 'Sent',
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              message: { type: 'string' }
            }
          }
        }
      }
    },
    async (_req, reply) => {
      try {
        await WIKI.models.apprise.send(WIKI.models.apprise.testMessage())
      } catch (err: any) {
        return reply.badRequest(err.message)
      }
      return { ok: true, message: 'Test notification sent.' }
    }
  )
}

export default routes
