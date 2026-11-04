<template>
  <w-card class="pb-2">
    <w-card-header>
      {{ t('admin.apprise.title') }}
      <template #hint>{{ t('admin.apprise.hint') }}</template>
    </w-card-header>
    <w-item tag="label">
      <blueprint-icon icon="automation" />
      <w-item-section>
        <w-item-label>{{ t('admin.apprise.enabled') }}</w-item-label>
        <w-item-label caption>{{ t('admin.apprise.enabledHint') }}</w-item-label>
      </w-item-section>
      <w-item-section avatar>
        <w-toggle v-model="state.config.isEnabled" :aria-label="t('admin.apprise.enabled')" />
      </w-item-section>
    </w-item>
    <w-separator class="my-2" inset />
    <w-item>
      <blueprint-icon icon="module" />
      <w-item-section>
        <w-item-label>{{ t('admin.apprise.mode') }}</w-item-label>
        <w-item-label caption>{{ t('admin.apprise.modeHint') }}</w-item-label>
      </w-item-section>
      <w-item-section class="flex-none">
        <w-btn-toggle
          v-model="state.config.mode"
          push
          glossy
          no-caps
          toggle-color="primary"
          :aria-label="t('admin.apprise.mode')"
          :options="modes" />
      </w-item-section>
    </w-item>
    <template v-if="state.config.mode === `api`">
      <w-separator class="my-2" inset />
      <w-item>
        <blueprint-icon icon="link" />
        <w-item-section>
          <w-item-label>{{ t('admin.apprise.apiUrl') }}</w-item-label>
          <w-item-label caption>{{ t('admin.apprise.apiUrlHint') }}</w-item-label>
        </w-item-section>
        <w-item-section>
          <w-input
            v-model="state.config.apiUrl"
            outlined
            dense
            placeholder="http://apprise:8000"
            :aria-label="t('admin.apprise.apiUrl')" />
        </w-item-section>
      </w-item>
      <w-separator class="my-2" inset />
      <w-item>
        <blueprint-icon icon="key" />
        <w-item-section>
          <w-item-label>{{ t('admin.apprise.apiKey') }}</w-item-label>
          <w-item-label caption>{{ t('admin.apprise.apiKeyHint') }}</w-item-label>
        </w-item-section>
        <w-item-section>
          <w-input
            v-model="state.config.apiKey"
            outlined
            dense
            no-autofill
            :aria-label="t('admin.apprise.apiKey')" />
        </w-item-section>
      </w-item>
    </template>
    <w-separator class="my-2" inset />
    <w-item>
      <blueprint-icon class="self-start" icon="cloud-checked" />
      <w-item-section>
        <w-item-label>{{ t('admin.apprise.urls') }}</w-item-label>
        <w-item-label caption>
          {{
            state.config.mode === `api`
              ? t('admin.apprise.urlsHintApi')
              : t('admin.apprise.urlsHint')
          }}
        </w-item-label>
        <w-input
          class="mt-4"
          v-model="state.config.urls"
          outlined
          dense
          no-autofill
          type="textarea"
          placeholder="discord://webhook_id/webhook_token"
          :aria-label="t('admin.apprise.urls')" />
      </w-item-section>
    </w-item>
    <w-separator class="my-2" inset />
    <w-item>
      <w-item-section>
        <w-item-label>{{ t('admin.apprise.events') }}</w-item-label>
        <w-item-label caption>{{ t('admin.apprise.eventsHint') }}</w-item-label>
      </w-item-section>
    </w-item>
    <w-item v-for="event of state.events" :key="event" tag="label">
      <blueprint-icon :icon="EVENT_ICONS[event] ?? `inbox`" />
      <w-item-section>
        <w-item-label>{{ t(`admin.apprise.eventLabels.${eventKey(event)}`) }}</w-item-label>
      </w-item-section>
      <w-item-section avatar>
        <w-toggle
          v-model="state.config.events[event]"
          :aria-label="t(`admin.apprise.eventLabels.${eventKey(event)}`)" />
      </w-item-section>
    </w-item>
    <div class="flex justify-end pr-4 py-2">
      <w-btn
        unelevated
        color="primary"
        icon="la:paper-plane"
        :label="t('admin.apprise.test')"
        :loading="state.testLoading"
        @click="sendTest" />
    </div>
  </w-card>
</template>

<script setup>
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import { notify } from '@/composables/notify'
import { apiErrorMessage } from '@/helpers/apiError'

/**
 * FORK: not part of upstream Wiki.js — see FORK.md.
 *
 * The Apprise card of Admin → Notifications: where the wiki announces comments, edit suggestions,
 * review decisions and new accounts. Loaded and saved by the page it sits on (`load` / `save`, through
 * the template ref), so that the page's one Apply button saves everything on it.
 *
 * The URLs and the API key come back as a mask when set; posted back unchanged, the mask means
 * "keep what is stored", and clearing the field removes it.
 */

const EVENT_ICONS = {
  'comment:new': 'comments',
  'submission:new': 'todo-list',
  'submission:approved': 'cloud-checked',
  'submission:rejected': 'denied',
  'user:join': 'person'
}

const { t } = useI18n()

const state = reactive({
  testLoading: false,
  events: [],
  config: {
    isEnabled: false,
    mode: 'cli',
    urls: '',
    apiUrl: '',
    apiKey: '',
    events: {}
  }
})

const modes = computed(() => [
  { value: 'cli', label: t('admin.apprise.modeCli') },
  { value: 'api', label: t('admin.apprise.modeApi') }
])

/** `submission:new` → `submissionNew`, the shape a translation key takes. */
function eventKey(event) {
  return event.replace(/:(\w)/, (_m, c) => c.toUpperCase())
}

async function load() {
  const resp = await API_CLIENT.get('system/apprise').json()
  state.events = resp.events
  state.config = { ...state.config, ...resp.settings }
}

async function save() {
  await API_CLIENT.put('system/apprise', {
    json: {
      isEnabled: state.config.isEnabled,
      mode: state.config.mode,
      urls: state.config.urls ?? '',
      apiUrl: `${state.config.apiUrl ?? ''}`.trim(),
      apiKey: `${state.config.apiKey ?? ''}`.trim(),
      events: { ...state.config.events }
    }
  })
}

async function sendTest() {
  state.testLoading = true
  try {
    // -> The saved settings are what it sends through, so save first: otherwise what is typed above
    //    is not what is being tested
    await save()
    await API_CLIENT.post('system/apprise/test').json()
    notify({ type: 'positive', message: t('admin.apprise.testSuccess') })
  } catch (err) {
    notify({
      type: 'negative',
      message: t('admin.apprise.testFailed'),
      caption: apiErrorMessage(err)
    })
  }
  state.testLoading = false
}

defineExpose({ load, save })
</script>
