<script setup>
import { ref, onMounted } from 'vue'
import { atproto } from '../services/atproto'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')

const title = ref('')
const description = ref('')

onMounted(async () => {
  if (!auth.user) return
  
  loading.value = true
  try {
    const settings = await atproto.getSettings(auth.user.handle)
    title.value = settings.title
    description.value = settings.description
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
})

const handleSave = async () => {
  saving.value = true
  error.value = ''
  success.value = ''
  
  try {
    await atproto.updateSettings({
      title: title.value,
      description: description.value
    })
    success.value = 'Settings saved successfully! You may need to refresh the feed to see changes.'
  } catch (err) {
    if (err.status === 401) {
      error.value = 'Your session has expired. Please log in again.'
    } else {
      error.value = 'Failed to save settings. ' + err.message
    }
    console.error(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-row justify="center" class="py-12">
    <v-col cols="12" md="8" lg="6">
      <div class="d-flex align-center mb-12">
        <v-btn to="/" icon="mdi-arrow-left" variant="text" class="mr-4"></v-btn>
        <h2 class="text-h4 font-weight-black">Blog Settings</h2>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" class="mb-8 rounded-lg">
        {{ error }}
      </v-alert>

      <v-alert v-if="success" type="success" variant="tonal" class="mb-8 rounded-lg">
        {{ success }}
      </v-alert>

      <v-card class="rounded-xl border pa-6" elevation="0">
        <v-form @submit.prevent="handleSave">
          <div class="mb-8">
            <label class="text-subtitle-1 font-weight-bold mb-2 d-block">Blog Title</label>
            <v-text-field
              v-model="title"
              placeholder="e.g. My Personal Journal"
              variant="outlined"
              density="comfortable"
              class="rounded-lg"
              :disabled="loading || saving"
            ></v-text-field>
          </div>

          <div class="mb-8">
            <label class="text-subtitle-1 font-weight-bold mb-2 d-block">Description</label>
            <v-textarea
              v-model="description"
              placeholder="A short tagline for your blog"
              variant="outlined"
              density="comfortable"
              class="rounded-lg"
              auto-grow
              rows="2"
              :disabled="loading || saving"
            ></v-textarea>
          </div>

          <v-btn
            color="primary"
            size="large"
            block
            class="rounded-pill font-weight-bold"
            elevation="4"
            :loading="saving"
            :disabled="loading || !title.trim()"
            type="submit"
          >
            Save Configuration
          </v-btn>
        </v-form>
      </v-card>
      
      <div class="mt-12 text-center text-secondary text-caption">
        These settings are stored as an <code>xyz.atoblog.settings</code> record in your ATProto repository.
      </div>
    </v-col>
  </v-row>
</template>
