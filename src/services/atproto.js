import { BskyAgent } from '@atproto/api'

const BLOG_COLLECTION = 'xyz.atoblog.post'
const SETTINGS_COLLECTION = 'xyz.atoblog.settings'

class AtprotoService {
    constructor() {
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
                repo: this.agent.session.did,
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

    async login(identifier, password) {
        try {
            const { data } = await this.agent.login({ identifier, password })
            const profile = await this.agent.getProfile({ actor: data.did })
            const sessionWithProfile = { ...data, profile: profile.data }
            localStorage.setItem('atp_session', JSON.stringify(sessionWithProfile))
            return sessionWithProfile
        } catch (error) {
            console.error('Login failed:', error)
            throw error
        }
    }

    async resumeSession() {
        const session = localStorage.getItem('atp_session')
        if (session) {
            try {
                const sessionData = JSON.parse(session)
                await this.agent.resumeSession(sessionData)
                // Refresh profile data
                const profile = await this.agent.getProfile({ actor: sessionData.did })
                sessionData.profile = profile.data
                localStorage.setItem('atp_session', JSON.stringify(sessionData))
                return sessionData
            } catch (error) {
                console.error('Failed to resume session:', error)
                localStorage.removeItem('atp_session')
            }
        }
        return null
    }

    logout() {
        localStorage.removeItem('atp_session')
        this.agent = new BskyAgent({ service: 'https://bsky.social' })
        if (this.onLogout) this.onLogout()
    }

    async getPosts(repo) {
        try {
            // Use publicAgent for reads to avoid 401s from expired sessions
            const response = await this.publicAgent.api.com.atproto.repo.listRecords({
                repo: repo,
                collection: BLOG_COLLECTION,
                limit: 20,
            })

            // Get profile for author info
            let profileData = { handle: repo }
            try {
                const profile = await this.publicAgent.getProfile({ actor: repo })
                profileData = profile.data
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
                const profile = await this.publicAgent.getProfile({ actor: repo })
                profileData = profile.data
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

    async createPost(title, blocks) {
        try {
            const record = {
                $type: BLOG_COLLECTION,
                title: title,
                blocks: blocks,
                createdAt: new Date().toISOString(),
            }

            const response = await this.agent.api.com.atproto.repo.createRecord({
                repo: this.agent.session.did,
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

    async updatePost(rkey, title, blocks, createdAt, blueskyUri = null) {
        try {
            const record = {
                $type: BLOG_COLLECTION,
                title: title,
                blocks: blocks,
                createdAt: createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                blueskyUri: blueskyUri
            }

            const response = await this.agent.api.com.atproto.repo.putRecord({
                repo: this.agent.session.did,
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
        // Prefer authenticated agent if we have a session
        const activeAgent = this.agent.session ? this.agent : this.publicAgent
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

            console.error('Error fetching post thread:', error)
            throw error
        }
    }

    async postToBluesky(text, embed = null) {
        try {
            const record = {
                text: text,
                createdAt: new Date().toISOString()
            }
            if (embed) record.embed = embed

            const response = await this.agent.post(record)
            return response
        } catch (error) {
            if (error.status === 401) this.logout()
            console.error('Error posting to BlueSky:', error)
            throw error
        }
    }

    async replyToBluesky(text, root, parent) {
        try {
            const response = await this.agent.post({
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
            return await this.agent.like(uri, cid)
        } catch (error) {
            if (error.status === 401) this.logout()
            throw error
        }
    }

    async unlike(likeUri) {
        try {
            return await this.agent.deleteLike(likeUri)
        } catch (error) {
            if (error.status === 401) this.logout()
            throw error
        }
    }

    async repost(uri, cid) {
        try {
            return await this.agent.repost(uri, cid)
        } catch (error) {
            if (error.status === 401) this.logout()
            throw error
        }
    }

    async deleteRepost(repostUri) {
        try {
            return await this.agent.deleteRepost(repostUri)
        } catch (error) {
            if (error.status === 401) this.logout()
            throw error
        }
    }

    async deletePost(rkey) {
        try {
            const response = await this.agent.api.com.atproto.repo.deleteRecord({
                repo: this.agent.session.did,
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
