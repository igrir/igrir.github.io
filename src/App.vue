<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

import { atproto } from './services/atproto'

const auth = useAuthStore()
const router = useRouter()
const blogOwner = import.meta.env.VITE_BLOG_OWNER || 'igrir.bsky.social'

onMounted(async () => {
  atproto.onLogout = () => {
    auth.user = null
  }
  await auth.checkSession()
})

const handleLogout = () => {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <v-app>
    <v-app-bar flat class="glass-nav px-4">
      <router-link to="/" class="text-decoration-none d-flex align-center">
        <v-app-bar-title class="font-weight-black text-h5 no-ellipsis">
          <span class="text-primary">igrir</span>talks
        </v-app-bar-title>
      </router-link>

      <v-spacer></v-spacer>

      <v-btn to="/" variant="text" class="mx-1" prepend-icon="mdi-home">Feed</v-btn>
      
      <template v-if="auth.user">
        <v-btn to="/new-post" variant="text" class="mx-1 d-none d-sm-inline-flex" prepend-icon="mdi-pencil">New Post</v-btn>
        
        <div class="d-flex align-center ml-2 mr-1 py-1 px-3 rounded-pill bg-grey-lighten-4 border transition-all hover-glow">
          <span class="text-caption font-weight-black text-secondary mr-3 d-none d-md-inline">{{ auth.user.handle }}</span>
          <v-menu location="bottom end">
            <template v-slot:activator="{ props }">
              <v-avatar v-bind="props" size="28" class="cursor-pointer border" color="white">
                <v-img 
                  v-if="auth.user?.profile?.avatar"
                  :src="auth.user.profile.avatar"
                  cover
                >
                  <template v-slot:placeholder>
                    <v-progress-circular indeterminate size="18" width="2"></v-progress-circular>
                  </template>
                  <template v-slot:error>
                    <v-icon icon="mdi-account" size="small"></v-icon>
                  </template>
                </v-img>
                <v-icon v-else icon="mdi-account" size="small"></v-icon>
              </v-avatar>
            </template>
          <v-list density="compact" class="rounded-lg py-2" width="200">
            <v-list-item :title="auth.user.handle" :subtitle="auth.user.did">
              <template v-slot:prepend>
                <v-icon icon="mdi-account"></v-icon>
              </template>
            </v-list-item>
            <v-divider class="my-1"></v-divider>
            <v-list-item to="/settings" prepend-icon="mdi-cog-outline">Blog Settings</v-list-item>
            <v-divider class="my-1"></v-divider>
            <v-list-item @click="handleLogout" prepend-icon="mdi-logout" color="error">Sign Out</v-list-item>
          </v-list>
        </v-menu>
      </div>
    </template>
      <v-btn v-else to="/login" variant="text" size="small" class="rounded-pill px-4">Sign In</v-btn>
    </v-app-bar>

    <v-main class="bg-background">
      <v-container fluid class="px-4">
        <template v-if="auth.loading && !auth.user">
           <div class="d-flex justify-center align-center py-16">
             <v-progress-circular indeterminate color="primary"></v-progress-circular>
           </div>
        </template>
        <router-view v-else v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </v-container>
    </v-main>
  </v-app>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');

:root {
  --medium-font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --medium-font-serif: 'Lora', Georgia, serif;
}

body {
  font-family: var(--medium-font-sans);
  background-color: #FFFFFF !important;
  color: #242424;
  -webkit-font-smoothing: antialiased;
}

.v-application {
  font-family: var(--medium-font-sans) !important;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--medium-font-sans);
  font-weight: 700;
  letter-spacing: -0.022em;
}

.text-serif {
  font-family: var(--medium-font-serif) !important;
}

.v-container {
  max-width: 1192px !important;
  margin-left: auto !important;
  margin-right: auto !important;
  padding-left: 24px !important;
  padding-right: 24px !important;
}

.v-btn {
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-weight: 500 !important;
}

::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
}

::-webkit-scrollbar-thumb {
  background: #ccc;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #bbb;
}

.glass-nav {
  background: rgba(255, 255, 255, 0.8) !important;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.05) !important;
  color: #242424 !important;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.cursor-pointer {
  cursor: pointer;
}

.no-ellipsis {
  overflow: visible !important;
  white-space: nowrap !important;
  text-overflow: clip !important;
}
</style>
