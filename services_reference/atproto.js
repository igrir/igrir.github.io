import { BskyAgent } from '@atproto/api'
import { getAgent, getPdsAgent, currentUser, userProfile, getPdsEndpoint, generateFacets } from './bluesky'

const NOTES_COLLECTION = 'id.gamedev.notes'
const SETTINGS_COLLECTION = 'xyz.atoblog.settings'

class AtprotoService {
    constructor() {
        this.publicAgent = new BskyAgent({
            service: 'https://bsky.social',
        })
    }

    get did() {
        return currentUser.value?.did;
    }

    async getSettings(repo) {
        try {
            const pdsUrl = await getPdsEndpoint(repo);
            const activeAgent = pdsUrl ? new BskyAgent({ service: pdsUrl }) : this.publicAgent;

            const response = await activeAgent.api.com.atproto.repo.getRecord({
                repo: repo,
                collection: SETTINGS_COLLECTION,
                rkey: 'self',
            })
            return response.data.value
        } catch (error) {
            console.warn('Could not fetch blog settings, using defaults', error)
            return {
                title: 'Gamedev Notes',
                description: 'Personal notes and gamedev insights'
            }
        }
    }

    async updateSettings(settings) {
        try {
            if (!currentUser.value?.did) throw new Error('Authentication required');
            const record = {
                $type: SETTINGS_COLLECTION,
                title: settings.title,
                description: settings.description,
                updatedAt: new Date().toISOString()
            }

            const pdsAgent = getPdsAgent();
            console.log(`[AtprotoService] Updating settings on PDS: ${pdsAgent.options?.service}`);

            const response = await pdsAgent.com.atproto.repo.putRecord({
                repo: currentUser.value.did,
                collection: SETTINGS_COLLECTION,
                rkey: 'self',
                record: record
            })
            return response
        } catch (error) {
            console.error('Error updating blog settings:', error)
            throw error
        }
    }

    async login() { throw new Error('Use OAuth login via bluesky.ts'); }
    async resumeSession() {
        if (!currentUser.value?.did) return null;
        return {
            did: currentUser.value.did,
            handle: currentUser.value.handle,
            profile: userProfile.value
        };
    }
    logout() { }

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

    async getNotes(repo) {
        let profileData = { handle: repo };
        try {
            const prof = await this.getPublicProfile(repo);
            if (prof) profileData = prof;
        } catch (pError) {
            console.warn('Could not fetch profile for notes, using fallback', pError);
        }

        const mapRecords = async (records) => {
            return records.map(record => {
                const uriParts = record.uri.split('/');
                const didFromUri = uriParts[2];
                return {
                    uri: record.uri,
                    cid: record.cid,
                    author: { ...profileData, did: profileData.did || didFromUri },
                    value: record.value,
                    indexedAt: record.value.createdAt
                };
            });
        };

        const tryFetch = async (agent) => {
            const response = await agent.com.atproto.repo.listRecords({
                repo: repo,
                collection: NOTES_COLLECTION,
                limit: 50,
            });
            let records = response.data.records;

            // Draft filtering: only show drafts to the owner
            const currentDid = currentUser.value?.did;
            const isOwner = currentDid && (repo === currentDid || profileData.did === currentDid);

            if (!isOwner) {
                records = records.filter(r => !r.value.isDraft);
            }

            return await mapRecords(records);
        };

        try {
            const agent = getAgent();
            const pdsUrl = await getPdsEndpoint(repo);
            const activeAgent = pdsUrl ? new BskyAgent({ service: pdsUrl }) : agent;

            try {
                return await tryFetch(activeAgent);
            } catch (e) {
                if (activeAgent !== agent) {
                    return await tryFetch(agent);
                }
                throw e;
            }
        } catch (error) {
            try {
                return await tryFetch(this.publicAgent);
            } catch (fallbackErr) {
                console.error('Error fetching notes (even with public fallback):', fallbackErr);
                throw error;
            }
        }
    }

    async getNote(uri) {
        const [repo, collection, rkey] = uri.replace('at://', '').split('/');

        const tryFetch = async (agent) => {
            const response = await agent.com.atproto.repo.getRecord({
                repo: repo,
                collection: collection,
                rkey: rkey,
            });

            let profileData = { handle: repo };
            try {
                const prof = await this.getPublicProfile(repo);
                if (prof) profileData = prof;
            } catch (pError) {
                console.warn('Could not fetch profile for note detail', pError);
            }

            const uriParts = response.data.uri.split('/');
            const didFromUri = uriParts[2];

            return {
                uri: uri,
                cid: response.data.cid,
                author: { ...profileData, did: profileData.did || didFromUri },
                value: response.data.value,
                indexedAt: response.data.value.createdAt
            };
        };

        try {
            const agent = getAgent();
            const pdsUrl = await getPdsEndpoint(repo);
            const activeAgent = pdsUrl ? new BskyAgent({ service: pdsUrl }) : agent;

            try {
                const note = await tryFetch(activeAgent);

                // Draft security: only owner can see drafts
                if (note.value.isDraft && note.author.did !== currentUser.value?.did) {
                    throw new Error('This note is a draft and only visible to the owner.');
                }

                return note;
            } catch (e) {
                if (activeAgent !== agent) {
                    const note = await tryFetch(agent);

                    // Draft security: only owner can see drafts
                    if (note.value.isDraft && note.author.did !== currentUser.value?.did) {
                        throw new Error('This note is a draft and only visible to the owner.');
                    }

                    return note;
                }
                throw e;
            }
        } catch (error) {
            try {
                const response = await this.publicAgent.com.atproto.repo.getRecord({
                    repo: repo,
                    collection: collection,
                    rkey: rkey,
                });

                const note = {
                    uri: uri,
                    cid: response.data.cid,
                    author: { handle: repo, did: response.data.uri.split('/')[2] },
                    value: response.data.value,
                    indexedAt: response.data.value.createdAt
                };

                // Draft security for public fallback
                if (note.value.isDraft && note.author.did !== currentUser.value?.did) {
                    throw new Error('This note is a draft and only visible to the owner.');
                }

                return note;
            } catch (fallbackErr) {
                console.error('Error fetching note detail (even with public fallback):', fallbackErr);
                throw error;
            }
        }
    }

    async uploadBlob(file) {
        try {
            const pdsAgent = getPdsAgent();
            const { data } = await pdsAgent.com.atproto.repo.uploadBlob(file, {
                encoding: file.type
            })
            return data.blob
        } catch (error) {
            console.error('Error uploading blob:', error)
            throw error
        }
    }

    async createNote(title, blocks, tags = [], isDraft = false) {
        try {
            if (!currentUser.value?.did) throw new Error('Authentication required');
            const record = {
                $type: NOTES_COLLECTION,
                title: title,
                blocks: blocks,
                tags: Array.isArray(tags) ? tags : [],
                createdAt: new Date().toISOString(),
                isDraft: isDraft
            }

            const pdsAgent = getPdsAgent();
            console.log(`[AtprotoService] Creating note on PDS: ${pdsAgent.options?.service}`);

            const response = await pdsAgent.com.atproto.repo.createRecord({
                repo: currentUser.value.did,
                collection: NOTES_COLLECTION,
                record: record
            })
            return response
        } catch (error) {
            console.error('Error creating note:', error)
            throw error
        }
    }

    async updateNote(rkey, title, blocks, createdAt, tags = [], isDraft = false) {
        try {
            if (!currentUser.value?.did) throw new Error('Authentication required');
            const record = {
                $type: NOTES_COLLECTION,
                title: title,
                blocks: blocks,
                tags: Array.isArray(tags) ? tags : [],
                createdAt: createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                isDraft: isDraft
            }

            const pdsAgent = getPdsAgent();
            console.log(`[AtprotoService] Updating note on PDS: ${pdsAgent.options?.service}`);

            const response = await pdsAgent.com.atproto.repo.putRecord({
                repo: currentUser.value.did,
                collection: NOTES_COLLECTION,
                rkey: rkey,
                record: record
            })
            return response
        } catch (error) {
            console.error('Error updating note:', error)
            throw error
        }
    }

    async getPostThread(uri) {
        const agent = getAgent();
        const activeAgent = currentUser.value?.did ? agent : this.publicAgent
        try {
            const response = await activeAgent.api.app.bsky.feed.getPostThread({
                uri: uri,
                depth: 10,
                parentHeight: 0
            })
            return response.data.thread
        } catch (error) {
            if (activeAgent === agent && (error.status === 401 || error.message?.includes('Authentication'))) {
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

            if (error.status === 400 || error.status === 404 || error.message?.includes('not found')) {
                console.warn('Post thread not found on BlueSky:', uri)
                return null
            }

            if (activeAgent === this.publicAgent && (error.status === 401 || error.status === 403 || error.message?.includes('Authentication'))) {
                console.warn('Public fetch unauthorized, returning null thread:', uri)
                return null
            }

            console.error('Error fetching post thread:', error)
            throw error
        }
    }

    async getFeedGenerator(uri) {
        const agent = getAgent();
        const activeAgent = currentUser.value?.did ? agent : this.publicAgent;
        try {
            const response = await activeAgent.api.app.bsky.feed.getFeedGenerator({ feed: uri });
            return response.data.view;
        } catch (error) {
            console.error('Error fetching feed generator:', error);
            if (activeAgent !== this.publicAgent) {
                try {
                    const response = await this.publicAgent.api.app.bsky.feed.getFeedGenerator({ feed: uri });
                    return response.data.view;
                } catch (e) {
                    console.warn('Public fetch for feed generator failed', e);
                }
            }
            return null;
        }
    }

    async getStarterPack(uri) {
        const agent = getAgent();
        const activeAgent = currentUser.value?.did ? agent : this.publicAgent;
        try {
            const response = await activeAgent.api.app.bsky.graph.getStarterPack({ starterPack: uri });
            return response.data.starterPack;
        } catch (error) {
            console.error('Error fetching starter pack:', error);
            if (activeAgent !== this.publicAgent) {
                try {
                    const response = await this.publicAgent.api.app.bsky.graph.getStarterPack({ starterPack: uri });
                    return response.data.starterPack;
                } catch (e) {
                    console.warn('Public fetch for starter pack failed', e);
                }
            }
            return null;
        }
    }

    async getList(uri) {
        const agent = getAgent();
        const activeAgent = currentUser.value?.did ? agent : this.publicAgent;
        try {
            const response = await activeAgent.api.app.bsky.graph.getList({ list: uri, limit: 1 });
            return response.data.list;
        } catch (error) {
            console.error('Error fetching list:', error);
            if (activeAgent !== this.publicAgent) {
                try {
                    const response = await this.publicAgent.api.app.bsky.graph.getList({ list: uri, limit: 1 });
                    return response.data.list;
                } catch (e) {
                    console.warn('Public fetch for list failed', e);
                }
            }
            return null;
        }
    }

    async postToBluesky(text, embed = null) {
        try {
            const facets = generateFacets(text)
            const record = {
                text: text,
                facets: facets.length > 0 ? facets : undefined,
                createdAt: new Date().toISOString()
            }
            if (embed) record.embed = embed

            const pdsAgent = getPdsAgent();
            console.log(`[AtprotoService] Posting to BlueSky on PDS: ${pdsAgent.options?.service}`);

            const response = await pdsAgent.post(record)
            return response
        } catch (error) {
            console.error('Error posting to BlueSky:', error)
            throw error
        }
    }

    async replyToBluesky(text, root, parent) {
        try {
            const pdsAgent = getPdsAgent();
            console.log(`[AtprotoService] Replying to BlueSky on PDS: ${pdsAgent.options?.service}`);

            const facets = generateFacets(text)
            const response = await pdsAgent.post({
                text: text,
                facets: facets.length > 0 ? facets : undefined,
                reply: {
                    root: { uri: root.uri, cid: root.cid },
                    parent: { uri: parent.uri, cid: parent.cid }
                },
                createdAt: new Date().toISOString()
            })
            return response
        } catch (error) {
            console.error('Error replying to BlueSky:', error)
            throw error
        }
    }

    async like(uri, cid) {
        try {
            const pdsAgent = getPdsAgent();
            return await pdsAgent.like(uri, cid);
        } catch (error) {
            throw error
        }
    }

    async unlike(likeUri) {
        try {
            const pdsAgent = getPdsAgent();
            return await pdsAgent.deleteLike(likeUri);
        } catch (error) {
            throw error
        }
    }

    async repost(uri, cid) {
        try {
            const pdsAgent = getPdsAgent();
            return await pdsAgent.repost(uri, cid);
        } catch (error) {
            throw error
        }
    }

    async deleteRepost(repostUri) {
        try {
            const pdsAgent = getPdsAgent();
            return await pdsAgent.deleteRepost(repostUri);
        } catch (error) {
            throw error
        }
    }

    async deleteNote(rkey) {
        try {
            if (!currentUser.value?.did) throw new Error('Authentication required');

            const pdsAgent = getPdsAgent();
            console.log(`[AtprotoService] Attempting to delete note '${rkey}' on PDS: ${pdsAgent.options?.service || pdsAgent.api?.xrpc?.baseUri || 'unknown'}`);

            const response = await pdsAgent.com.atproto.repo.deleteRecord({
                repo: currentUser.value.did,
                collection: NOTES_COLLECTION,
                rkey: rkey
            })
            console.log('[AtprotoService] Delete response:', response.status);
            return response
        } catch (error) {
            console.error('[AtprotoService] Error deleting note:', error)
            throw error
        }
    }
}

export const atproto = new AtprotoService()
