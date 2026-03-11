<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const identifier = ref('')
const showCustomHandle = ref(false)
const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  // Guard removed to allow one-tap login with default handle
  
  loading.value = true
  error.value = ''
  
  try {
    // This will redirect to the PDS/OAuth provider
    // We default to bsky.social if no custom handle is entered
    const handle = (showCustomHandle.value && identifier.value) ? identifier.value : ''
    await auth.login(handle)
  } catch (err) {
    error.value = 'Failed to initiate login. Please check your handle.'
    console.error(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-row justify="center" align="center" style="min-height: 80vh;">
    <v-col cols="12" sm="8" md="5" lg="4">
      <v-card class="pa-8 rounded-xl elevation-24" border>
        <div class="text-center mb-8">
          <v-icon icon="mdi-butterfly" color="primary" size="x-large" class="mb-2"></v-icon>
          <h1 class="text-h4 font-weight-black">Welcome Back</h1>
          <p class="text-medium-emphasis">Use your BlueSky or ATProto handle</p>
        </div>

        <v-form @submit.prevent="handleLogin" class="text-center">
          <p class="text-caption text-medium-emphasis mb-6">
            You will be redirected to BlueSky to securely authorize this application.
          </p>

          <v-alert v-if="error" type="error" variant="tonal" class="mb-6 rounded-lg text-caption">
            {{ error }}
          </v-alert>

          <v-btn
            block
            color="#0085ff"
            size="x-large"
            type="submit"
            :loading="loading"
            class="rounded-xl font-weight-black text-white mb-6 py-4"
            elevation="12"
            prepend-icon="mdi-butterfly"
            height="72"
          >
            Sign in with BlueSky
          </v-btn>
          
          <div class="text-caption text-medium-emphasis">
            Using a custom PDS? <a href="#" @click.prevent="showCustomHandle = !showCustomHandle" class="text-primary">Advanced options</a>
          </div>

          <v-expand-transition>
            <div v-if="showCustomHandle" class="mt-6">
              <v-text-field
                v-model="identifier"
                label="Custom Handle"
                placeholder="user.custom-pds.com"
                variant="outlined"
                density="compact"
                rounded="lg"
                color="primary"
                hide-details
                class="mb-2"
              ></v-text-field>
              <p class="text-xxs text-left text-medium-emphasis px-1">Only needed if you are NOT on bsky.social</p>
            </div>
          </v-expand-transition>
        </v-form>

        <div class="mt-8 text-center text-caption text-medium-emphasis">
          Don't have an account? <a href="https://bsky.app" target="_blank" class="text-primary text-decoration-none">Join BlueSky</a>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>
