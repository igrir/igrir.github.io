<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const identifier = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  if (!identifier.value || !password.value) return
  
  loading.ref = true
  error.value = ''
  
  try {
    await auth.login(identifier.value, password.value)
    router.push('/')
  } catch (err) {
    error.value = 'Invalid identifier or app password.'
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

        <v-form @submit.prevent="handleLogin">
          <v-text-field
            v-model="identifier"
            label="Handle or Email"
            placeholder="alice.bsky.social"
            variant="outlined"
            prepend-inner-icon="mdi-at"
            class="mb-4"
            rounded="lg"
          ></v-text-field>

          <v-text-field
            v-model="password"
            label="App Password"
            :type="showPassword ? 'text' : 'password'"
            variant="outlined"
            prepend-inner-icon="mdi-lock"
            :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
            @click:append-inner="showPassword = !showPassword"
            class="mb-6"
            rounded="lg"
            hint="Generate an App Password in your settings"
            persistent-hint
          ></v-text-field>

          <v-alert v-if="error" type="error" variant="tonal" class="mb-6 rounded-lg text-caption">
            {{ error }}
          </v-alert>

          <v-btn
            block
            color="primary"
            size="x-large"
            type="submit"
            :loading="auth.loading"
            class="rounded-lg font-weight-bold"
            elevation="8"
          >
            Sign In
          </v-btn>
        </v-form>

        <div class="mt-8 text-center text-caption text-medium-emphasis">
          Don't have an account? <a href="https://bsky.app" target="_blank" class="text-primary text-decoration-none">Join BlueSky</a>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>
