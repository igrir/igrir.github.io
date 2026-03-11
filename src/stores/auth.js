import { defineStore } from 'pinia'
import { atproto } from '../services/atproto'

export const useAuthStore = defineStore('auth', {
    state: () => ({
        user: null,
        loading: false,
        error: null,
    }),
    actions: {
        async login(handle) {
            this.loading = true
            this.error = null
            try {
                // For OAuth, this will redirect away from the page
                await atproto.login(handle)
            } catch (err) {
                this.error = err.message || 'Login failed'
                throw err
            } finally {
                this.loading = false
            }
        },
        async checkSession() {
            this.loading = true
            try {
                const data = await atproto.resumeSession()
                if (data) {
                    this.user = data
                }
            } finally {
                this.loading = false
            }
        },
        logout() {
            atproto.logout()
            this.user = null
        },
    },
})
