import { defineStore } from 'pinia'
import { atproto } from '../services/atproto'

export const useAuthStore = defineStore('auth', {
    state: () => ({
        user: null,
        loading: false,
        error: null,
    }),
    actions: {
        async login(identifier, password) {
            this.loading = true
            this.error = null
            try {
                const data = await atproto.login(identifier, password)
                this.user = data
            } catch (err) {
                this.error = err.message || 'Login failed'
                throw err
            } finally {
                this.loading = false
            }
        },
        async checkSession() {
            const data = await atproto.resumeSession()
            if (data) {
                this.user = data
            }
        },
        logout() {
            atproto.logout()
            this.user = null
        },
    },
})
