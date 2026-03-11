import { BskyAgent, Agent } from '@atproto/api'
import { BrowserOAuthClient } from '@atproto/oauth-client-browser'

const BLOG_COLLECTION = 'xyz.atoblog.post'
const SETTINGS_COLLECTION = 'xyz.atoblog.settings'

class AtprotoService {
    constructor() {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        let baseUrl = import.meta.env.VITE_BASE_URL || (isLocal ? 'http://127.0.0.1:5173' : 'https://' + window.location.hostname)
        
        // Ensure baseUrl has a protocol
        if (!baseUrl.startsWith('http')) {
            baseUrl = 'https://' + baseUrl
        }
        
        // Remove trailing slash if present to avoid double-slashes during join
        baseUrl = baseUrl.replace(/\/$/, '')

        // Adopt the loopbackId pattern for localhost to ensure redirect and scope stability
        const fullScopes = 'atproto transition:generic repo:xyz.atoblog.settings repo:xyz.atoblog.post'
        const encodedRedirect = encodeURIComponent(baseUrl + '/')
        const encodedScope = encodeURIComponent(fullScopes)
        const loopbackId = `http://localhost/?redirect_uri=${encodedRedirect}&scope=${encodedScope}`

        this.client = new BrowserOAuthClient({
            handleResolver: 'https://bsky.social',
            clientMetadata: {
                client_id: isLocal ? loopbackId : `${baseUrl}/client-metadata.json`,
                client_name: 'Brot!',
                client_uri: baseUrl,
                redirect_uris: [`${baseUrl}/`],
                scope: fullScopes,
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
                application_type: 'native',
                dpop_bound_access_tokens: true
            }
        })

        this.agent = new BskyAgent({
            service: 'https://bsky.social',
        })
        this.publicAgent = new BskyAgent({
            service: 'https://bsky.social',
        })
        this.onLogout = null
    }

    async getSettings(repo) {
        try {
            const response = await this.publicAgent.api.com.atproto.repo.getRecord({
                repo: repo,
                collection: SETTINGS_COLLECTION,
                rkey: 'self',
            })
            return response.data.value
        } catch (error) {
            console.warn('Could not fetch blog settings, using defaults', error)
            return {
                title: 'Reflections on Decentralization',
                description: 'Stories and insights from the AT Protocol'
            }
        }
    }

    async updateSettings(settings) {
        try {
            const record = {
                $type: SETTINGS_COLLECTION,
                title: settings.title,
                description: settings.description,
                updatedAt: new Date().toISOString()
            }

            const response = await this.agent.api.com.atproto.repo.putRecord({
                repo: this.agent.sub || this.agent.session?.did || this.agent.session?.handle,
                collection: SETTINGS_COLLECTION,
                rkey: 'self',
                record: record
            })
            return response
        } catch (error) {
            if (error.status === 401) this.logout()
            console.error('Error updating blog settings:', error)
            throw error
        }
    }

    async login(handle) {
        try {
            // Use handle if provided, otherwise default to BlueSky's PDS URL
            // Using the full URL 'https://bsky.social' ensures it's treated as a service, not a handle
            const discoverHandle = (handle && handle.trim()) ? handle.trim() : 'https://bsky.social'
            await this.client.signIn(discoverHandle)
        } catch (error) {
            console.error('OAuth sign-in failed:', error)
            throw error
        }
    }

    async handleCallback() {
        try {
            const result = await this.client.init()
            if (result?.session) {
                console.log('OAuth callback success. Session sub:', result.session.sub)

                // Clear OAuth parameters from URL after successful callback
                this.normalizeUrl()
                console.log('OAuth redirect handling successful. Session found.')

                // MODERN APPROACH: Initialize Agent directly with the session
                // This handles DPoP, PDS resolving, and fetcher binding automatically.
                this.agent = new Agent(result.session)

                // Identity data
                this.agent.sub = result.session.sub

                // Get profile
                const profile = await this.agent.getProfile({ actor: result.session.sub })

                const sessionWithProfile = {
                    did: result.session.sub,
                    handle: profile.data.handle,
                    pdsUrl: result.session.pdsUrl,
                    profile: profile.data,
                    isOAuth: true
                }
                console.log('Final session with profile:', sessionWithProfile)
                return sessionWithProfile
            }
            return null
        } catch (error) {
            console.error('OAuth callback handling failed:', error)
            throw error
        }
    }

    async resumeSession() {
        try {
            const result = await this.client.init()
            if (result?.session) {
                // Clear OAuth parameters if they were present (e.g. after refresh on callback URL)
                this.normalizeUrl()

                console.log('OAuth session found:', result.session)

                // MODERN APPROACH: Initialize Agent directly with the recovered session
                this.agent = new Agent(result.session)

                // Compatibility identity
                this.agent.sub = result.session.sub

                try {
                    const profile = await this.agent.getProfile({ actor: result.session.sub })
                    return {
                        did: result.session.sub,
                        handle: profile.data.handle,
                        pdsUrl: result.session.pdsUrl,
                        profile: profile.data,
                        isOAuth: true
                    }
                } catch (pErr) {
                    console.warn('Could not refresh profile during resume:', pErr)
                    return {
                        did: result.session.sub,
                        handle: (result.session).handle || result.session.sub,
                        pdsUrl: result.session.pdsUrl,
                        profile: null,
                        isOAuth: true
                    }
                }
            }
            console.log('No OAuth session found during resume')

            // Fallback to legacy session for transition or if user still uses it
            const legacySession = localStorage.getItem('atp_session')
            if (legacySession) {
                const sessionData = JSON.parse(legacySession)
                if (!sessionData.isOAuth) {
                    await this.agent.resumeSession(sessionData)
                    const profile = await this.agent.getProfile({ actor: sessionData.did })
                    sessionData.profile = profile.data
                    localStorage.setItem('atp_session', JSON.stringify(sessionData))
                    return sessionData
                }
            }
        } catch (error) {
            // Ignore "Unknown authorization session" errors during resume. 
            // This happens if the user refreshes a page that still has stale OAuth params in the URL.
            // We retry init() after normalizing the URL to ensure the session is recovered.
            if (error.message?.includes('Unknown authorization session')) {
                console.warn('Stale OAuth parameters in URL - cleaning and retrying resume')
                this.normalizeUrl()
                // Retry init without the stale params
                try {
                    const retryResult = await this.client.init()
                    if (retryResult?.session) {
                        this.agent = new Agent(retryResult.session)
                        this.agent.sub = retryResult.session.sub
                        const profile = await this.agent.getProfile({ actor: retryResult.session.sub })
                        return {
                            did: retryResult.session.sub,
                            handle: profile.data.handle,
                            pdsUrl: retryResult.session.pdsUrl,
                            profile: profile.data,
                            isOAuth: true
                        }
                    }
                } catch (retryError) {
                    console.error('Retry resume failed:', retryError)
                }
                return null
            }
            console.error('Failed to resume session:', error)
        }
        return null
    }

    // Helper to remove OAuth parameters (code, state, iss) from the URL
    normalizeUrl() {
        if (!window.history.replaceState) return
        const url = new URL(window.location.href)
        let changed = false
        if (url.searchParams.has('code')) { url.searchParams.delete('code'); changed = true }
        if (url.searchParams.has('state')) { url.searchParams.delete('state'); changed = true }
        if (url.searchParams.has('iss')) { url.searchParams.delete('iss'); changed = true }

        if (changed) {
            window.history.replaceState({}, document.title, url.pathname + url.search + url.hash)
        }
    }

    async logout() {
        localStorage.removeItem('atp_session')
        // OAuth logout
        try {
            const result = await this.client.init()
            if (result?.session) {
                await result.session.signOut()
            }
        } catch (e) {
            console.warn('OAuth signOut failed:', e)
        }
        this.agent = new BskyAgent({ service: 'https://bsky.social' })
        if (this.onLogout) this.onLogout()
    }

    // fetch profile from public API host to avoid auth errors
    async getPublicProfile(actor) {
        try {
            const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile')
            url.searchParams.set('actor', actor)
            const res = await fetch(url.toString(), { method: 'GET' })
            if (!res.ok) throw new Error('status ' + res.status)
            const data = await res.json()
            return data?.data || null
        } catch (err) {
            console.warn('public profile lookup failed for', actor, err)
            return null
        }
    }

    async getPosts(repo) {
        try {
            // Use publicAgent for reads to avoid 401s from expired sessions
            const response = await this.publicAgent.api.com.atproto.repo.listRecords({
                repo: repo,
                collection: BLOG_COLLECTION,
                limit: 20,
            })

            // Get profile for author info via public API (avoids 401 from PDS)
            let profileData = { handle: repo }
            try {
                const prof = await this.getPublicProfile(repo)
                if (prof) profileData = prof
            } catch (pError) {
                console.warn('Could not fetch profile, using fallback', pError)
            }

            // Map records to a format similar to what we had before for UI compatibility
            return response.data.records.map(record => {
                // Extract DID from at://did:plc:xxx/...
                const uriParts = record.uri.split('/')
                const didFromUri = uriParts[2]

                return {
                    post: {
                        uri: record.uri,
                        cid: record.cid,
                        author: {
                            ...profileData,
                            did: profileData.did || didFromUri
                        },
                        record: record.value,
                        indexedAt: record.value.createdAt
                    }
                }
            })
        } catch (error) {
            if (error.status === 401) {
                this.logout()
            }
            console.error('Error fetching blog posts:', error)
            throw error
        }
    }

    async getPost(uri) {
        try {
            const [repo, collection, rkey] = uri.replace('at://', '').split('/')
            // Use publicAgent for reads
            const response = await this.publicAgent.api.com.atproto.repo.getRecord({
                repo: repo,
                collection: collection,
                rkey: rkey,
            })

            // Get profile for author info
            let profileData = { handle: repo }
            try {
                const prof = await this.getPublicProfile(repo)
                if (prof) profileData = prof
            } catch (pError) {
                console.warn('Could not fetch profile for post detail', pError)
            }

            // Extract DID from response.data.uri
            const uriParts = response.data.uri.split('/')
            const didFromUri = uriParts[2]

            return {
                post: {
                    uri: uri,
                    cid: response.data.cid,
                    author: {
                        ...profileData,
                        did: profileData.did || didFromUri
                    },
                    record: response.data.value,
                    indexedAt: response.data.value.createdAt
                }
            }
        } catch (error) {
            if (error.status === 401) {
                this.logout()
            }
            console.error('Error fetching post detail:', error)
            throw error
        }
    }

    async uploadBlob(file) {
        try {
            const { data } = await this.agent.api.com.atproto.repo.uploadBlob(file, {
                encoding: file.type
            })
            return data.blob
        } catch (error) {
            if (error.status === 401) this.logout()
            console.error('Error uploading blob:', error)
            throw error
        }
    }

    async createPost(title, blocks, tags = [], isDraft = false) {
        try {
            const record = {
                $type: BLOG_COLLECTION,
                title: title,
                blocks: blocks,
                tags: Array.isArray(tags) ? tags : [],
                createdAt: new Date().toISOString(),
                isDraft: isDraft
            }

            const response = await this.agent.api.com.atproto.repo.createRecord({
                repo: this.agent.sub || this.agent.session?.did || this.agent.session?.handle,
                collection: BLOG_COLLECTION,
                record: record
            })
            return response
        } catch (error) {
            if (error.status === 401) this.logout()
            console.error('Error creating blog post:', error)
            throw error
        }
    }

    async updatePost(rkey, title, blocks, createdAt, blueskyUris = [], tags = [], isDraft = false) {
        try {
            // Ensure blueskyUris is always an array
            const uris = Array.isArray(blueskyUris) ? blueskyUris : (blueskyUris ? [blueskyUris] : [])

            const record = {
                $type: BLOG_COLLECTION,
                title: title,
                blocks: blocks,
                tags: Array.isArray(tags) ? tags : [],
                createdAt: createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                blueskyUris: uris,
                isDraft: isDraft
            }

            const response = await this.agent.api.com.atproto.repo.putRecord({
                repo: this.agent.sub || this.agent.session?.did || this.agent.session?.handle,
                collection: BLOG_COLLECTION,
                rkey: rkey,
                record: record
            })
            return response
        } catch (error) {
            if (error.status === 401) this.logout()
            console.error('Error updating blog post:', error)
            throw error
        }
    }

    async getPostThread(uri) {
        // Prefer authenticated agent if we have a session (OAuth sub or legacy session)
        const hasSession = this.agent && (this.agent.sub || this.agent.session)
        const activeAgent = hasSession ? this.agent : this.publicAgent
        try {
            const response = await activeAgent.api.app.bsky.feed.getPostThread({
                uri: uri,
                depth: 10,
                parentHeight: 0
            })
            return response.data.thread
        } catch (error) {
            // If authenticated fetch failed with 401, try public as last resort
            if (activeAgent === this.agent && (error.status === 401 || error.message?.includes('Authentication'))) {
                try {
                    const response = await this.publicAgent.api.app.bsky.feed.getPostThread({
                        uri: uri,
                        depth: 10,
                        parentHeight: 0
                    })
                    return response.data.thread
                } catch (pError) {
                    console.warn('Public fetch for thread also failed', pError)
                }
            }

            // Handle "Post not found" or "Bad Request" by returning null instead of throwing
            if (error.status === 400 || error.status === 404 || error.message?.includes('not found')) {
                console.warn('Post thread not found on BlueSky:', uri)
                return null
            }

            // also ignore auth failures from public agent (treat as missing thread)
            if (activeAgent === this.publicAgent && (error.status === 401 || error.status === 403 || error.message?.includes('Authentication'))) {
                console.warn('Public fetch unauthorized, returning null thread:', uri)
                return null
            }

            console.error('Error fetching post thread:', error)
            throw error
        }
    }

    async postToBluesky(text, embed = null) {
        try {
            const record = {
                $type: 'app.bsky.feed.post',
                text: text,
                createdAt: new Date().toISOString()
            }
            if (embed) record.embed = embed

            const response = await this.agent.api.app.bsky.feed.post.create({
                repo: this.agent.sub || this.agent.session?.did
            }, record)
            return response
        } catch (error) {
            if (error.status === 401) this.logout()
            console.error('Error posting to BlueSky:', error)
            throw error
        }
    }

    async replyToBluesky(text, root, parent) {
        try {
            const response = await this.agent.api.app.bsky.feed.post.create({
                repo: this.agent.sub || this.agent.session?.did
            }, {
                $type: 'app.bsky.feed.post',
                text: text,
                reply: {
                    root: { uri: root.uri, cid: root.cid },
                    parent: { uri: parent.uri, cid: parent.cid }
                },
                createdAt: new Date().toISOString()
            })
            return response
        } catch (error) {
            if (error.status === 401) this.logout()
            console.error('Error replying to BlueSky:', error)
            throw error
        }
    }

    async like(uri, cid) {
        try {
            return await this.agent.api.app.bsky.feed.like.create({
                repo: this.agent.sub || this.agent.session?.did
            }, {
                subject: { uri, cid },
                createdAt: new Date().toISOString()
            })
        } catch (error) {
            if (error.status === 401) this.logout()
            throw error
        }
    }

    async unlike(likeUri) {
        try {
            const [repo, collection, rkey] = likeUri.replace('at://', '').split('/')
            return await this.agent.api.com.atproto.repo.deleteRecord({
                repo: repo,
                collection: collection,
                rkey: rkey
            })
        } catch (error) {
            if (error.status === 401) this.logout()
            throw error
        }
    }

    async repost(uri, cid) {
        try {
            return await this.agent.api.app.bsky.feed.repost.create({
                repo: this.agent.sub || this.agent.session?.did
            }, {
                subject: { uri, cid },
                createdAt: new Date().toISOString()
            })
        } catch (error) {
            if (error.status === 401) this.logout()
            throw error
        }
    }

    async deleteRepost(repostUri) {
        try {
            const [repo, collection, rkey] = repostUri.replace('at://', '').split('/')
            return await this.agent.api.com.atproto.repo.deleteRecord({
                repo: repo,
                collection: collection,
                rkey: rkey
            })
        } catch (error) {
            if (error.status === 401) this.logout()
            throw error
        }
    }

    async deletePost(rkey) {
        try {
            const response = await this.agent.api.com.atproto.repo.deleteRecord({
                repo: this.agent.sub || this.agent.session?.did || this.agent.session?.handle,
                collection: BLOG_COLLECTION,
                rkey: rkey
            })
            return response
        } catch (error) {
            if (error.status === 401) this.logout()
            console.error('Error deleting blog post:', error)
            throw error
        }
    }
}

export const atproto = new AtprotoService()
