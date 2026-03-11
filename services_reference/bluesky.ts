import { BskyAgent, Agent } from '@atproto/api'
import { BrowserOAuthClient } from '@atproto/oauth-client-browser'
import { ref } from 'vue';

// Dynamically detect current origin for local development to avoid localhost vs 127.0.0.1 mismatches
const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173';
const appUrl = import.meta.env.VITE_APP_URL || currentOrigin;

const encodedRedirect = encodeURIComponent(appUrl)
const encodedScope = encodeURIComponent('atproto transition:generic transition:chat.bsky atproto:did:web:api.bsky.chat')
// Using both transitional scopes and strict audience-bound atproto scope for the chat service.
const loopbackId = `http://localhost/?redirect_uri=${encodedRedirect}&scope=${encodedScope}`

// For production on Netlify, client_id must be https and have a path.
// The @atproto/oauth-client-browser package uses Zod to validate this strictly.
const isLocalhost = appUrl.includes('localhost') || appUrl.includes('127.0.0.1');
const clientId = isLocalhost ? loopbackId : `${appUrl}/client-metadata.json`;

// AppView service URL for general reads and metadata
const BSKY_SERVICE = 'https://bsky.social'
// Public gateway for unauthenticated reads (search, public profiles, etc)
const BSKY_PUBLIC_SERVICE = 'https://api.bsky.app'

export const oauthClient = new BrowserOAuthClient({
    handleResolver: BSKY_SERVICE,
    clientMetadata: {
        client_id: clientId,
        client_name: 'Gamedev Tag OAuth',
        client_uri: appUrl,
        redirect_uris: [appUrl],
        scope: 'atproto transition:generic transition:chat.bsky atproto:did:web:api.bsky.chat',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true
    },
})

// Internal state for agents
let _agent: any = new BskyAgent({ service: BSKY_SERVICE })
let _pdsAgent: any = _agent;

// Publicly exported agents (getters ensure we always get the latest authenticated instance)
export const getAgent = () => _agent;
export const getPdsAgent = () => _pdsAgent;

// Backward compatibility for existing imports (standard ESM live bindings)
export { _agent as agent, _pdsAgent as pdsAgent };

export const getPdsEndpoint = async (did: string): Promise<string | null> => {
    try {
        if (did.startsWith('did:plc:')) {
            const response = await fetch(`https://plc.directory/${did}`);
            if (!response.ok) return null;
            const data = await response.json();
            const service = data.service?.find((s: any) =>
                s.id === '#atproto_pds' ||
                s.type === 'AtprotoPersonalDataServer'
            );
            return service?.serviceEndpoint || null;
        } else if (did.startsWith('did:web:')) {
            const domain = did.split(':')[2];
            const response = await fetch(`https://${domain}/.well-known/did.json`);
            if (!response.ok) return null;
            const data = await response.json();
            const service = data.service?.find((s: any) =>
                s.id === '#atproto_pds' ||
                s.type === 'AtprotoPersonalDataServer'
            );
            return service?.serviceEndpoint || null;
        }
    } catch (e) {
        console.error('Failed to resolve PDS for', did, e);
    }
    return null;
};

// Public agent explicitly for unauthenticated fallback reads
export const publicAgent = new BskyAgent({ service: BSKY_PUBLIC_SERVICE })

// Reactive state
export const bookmarkedUris = ref<Set<string>>(new Set());
export const currentUser = ref<{ did: string; handle: string } | null>(null);
export const userProfile = ref<any>(null);

let initPromise: Promise<boolean> | null = null;
export const initOAuth = async () => {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        console.log('[OAuth] initOAuth starting.');
        try {
            const result = await oauthClient.init()
            if (result && result.session) {
                console.log('[OAuth] Session found! DID:', result.session.did);

                // Initialize modern Agent with OAuth session natively
                // This handles DPoP, PDS resolving, and AppView proxying automatically
                const sessionAgent = new Agent(result.session);

                _agent = sessionAgent;
                _pdsAgent = sessionAgent;

                console.log(`[OAuth] Authenticated. PDS: ${(_pdsAgent as any).pdsUrl?.href || 'resolved automatically'}`);

                currentUser.value = {
                    did: result.session.did,
                    handle: (result.session as any).handle || result.session.did
                };
                await fetchUserProfile()
                return true
            } else {
                console.log('[OAuth] No session found.');
                initPromise = null;
            }
        } catch (e: any) {
            console.error('[OAuth] initialization failed:', e)
            initPromise = null;
        }
        return false
    })();
    return initPromise;
}

export const login = async (identifier: string) => {
    try {
        await oauthClient.signIn(identifier, {
            prompt: 'login',
            scope: 'atproto transition:generic transition:chat.bsky atproto:did:web:api.bsky.chat',
        })
    } catch (error) {
        console.error('Login redirect failed:', error)
        throw error
    }
}

export const logout = async () => {
    if (currentUser.value?.did) {
        try {
            await oauthClient.revoke(currentUser.value.did)
        } catch (error) {
            console.error('Failed to revoke OAuth session:', error)
        }
    }
    localStorage.removeItem('bsky_session')
    _agent = new BskyAgent({ service: 'https://api.bsky.app' })
    _pdsAgent = _agent;
    currentUser.value = null;
    userProfile.value = null;
    location.reload()
}

export const isAuthenticated = () => !!currentUser.value?.did
export const getCurrentUser = () => currentUser.value;

export const searchGamedevPosts = async (tag: string = 'gamedevid') => {
    await initOAuth();
    const activeAgent = currentUser.value?.did ? _agent : publicAgent
    try {
        const response = await activeAgent.app.bsky.feed.searchPosts({
            q: `#${tag}`,
            limit: 30,
        })
        return response.data.posts
    } catch (error) {
        if (activeAgent !== publicAgent) {
            try {
                return (await publicAgent.app.bsky.feed.searchPosts({ q: `#${tag}`, limit: 30 })).data.posts
            } catch (fallbackError) {
                console.error('Error searching posts (fallback):', fallbackError)
            }
        }
        return []
    }
}

export const searchPosts = async (query: string, limit: number = 30) => {
    await initOAuth();
    const activeAgent = currentUser.value?.did ? _agent : publicAgent
    try {
        const response = await activeAgent.app.bsky.feed.searchPosts({ q: query, limit: limit })
        return response.data.posts
    } catch (error) {
        if (activeAgent !== publicAgent) {
            try {
                return (await publicAgent.app.bsky.feed.searchPosts({ q: query, limit: limit })).data.posts
            } catch (fallbackError) {
                console.error('Error in searchPosts (fallback):', fallbackError)
            }
        }
        return []
    }
}

export const searchActors = async (term: string, limit: number = 10) => {
    await initOAuth();
    const activeAgent = currentUser.value?.did ? _agent : publicAgent
    try {
        const response = await activeAgent.app.bsky.actor.searchActors({ term, limit })
        return response.data.actors
    } catch (error) {
        if (activeAgent !== publicAgent) {
            try {
                return (await publicAgent.app.bsky.actor.searchActors({ term, limit })).data.actors
            } catch (fallbackError) {
                console.error('Error in searchActors (fallback):', fallbackError)
            }
        }
        return []
    }
}

const mergeThreads = (thread1: any, thread2: any): any => {
    if (!thread1) return thread2;
    if (!thread2) return thread1;
    if (thread1.post.uri !== thread2.post.uri) return thread1; // Safety check

    const merged = { ...thread1 };
    const replies1 = thread1.replies || [];
    const replies2 = thread2.replies || [];

    // Map to keep track of merged replies by URI
    const replyMap = new Map();

    // Add all from first thread
    replies1.forEach((r: any) => {
        if (r.post) replyMap.set(r.post.uri, r);
    });

    // Merge or add from second thread
    replies2.forEach((r: any) => {
        if (r.post) {
            if (replyMap.has(r.post.uri)) {
                // Recursive merge for nested replies
                replyMap.set(r.post.uri, mergeThreads(replyMap.get(r.post.uri), r));
            } else {
                replyMap.set(r.post.uri, r);
            }
        }
    });

    merged.replies = Array.from(replyMap.values());

    // Sort replies by creation date if available, or just keep order
    merged.replies.sort((a: any, b: any) => {
        const dateA = new Date(a.post?.record?.createdAt || 0).getTime();
        const dateB = new Date(b.post?.record?.createdAt || 0).getTime();
        return dateA - dateB;
    });

    return merged;
};

export const getPostThread = async (uri: string) => {
    await initOAuth();


    const isAuthed = !!currentUser.value?.did;
    console.log(currentUser.value)

    try {
        console.log("isAuthed " + isAuthed)
        if (!isAuthed) {
            const res = await publicAgent.app.bsky.feed.getPostThread({ uri, depth: 10 });
            return res.data.thread;
        }

        // Fetch in parallel if authed
        const [publicRes, authRes] = await Promise.allSettled([
            publicAgent.app.bsky.feed.getPostThread({ uri, depth: 10 }),
            _agent.app.bsky.feed.getPostThread({ uri, depth: 10 })
        ]);

        const publicThread = publicRes.status === 'fulfilled' ? publicRes.value.data.thread : null;
        const authThread = authRes.status === 'fulfilled' ? authRes.value.data.thread : null;

        console.log("Public Thread")
        console.log(publicThread)
        console.log("Auth Thread")
        console.log(authThread)

        if (!publicThread && !authThread) return null;

        // Prefer auth thread as base to keep viewer state
        return mergeThreads(authThread, publicThread);
    } catch (error) {
        console.error('Error fetching thread:', error);
        return null;
    }
};

export const sendReply = async (text: string, root: { uri: string, cid: string }, parent: { uri: string, cid: string }) => {
    try {
        return await _pdsAgent.post({
            text,
            reply: { root, parent },
            createdAt: new Date().toISOString(),
        })
    } catch (error) {
        console.error('Error sending reply:', error)
        throw error
    }
}

export const uploadBlob = async (blob: Blob, encoding: string) => {
    try {
        const response = await _pdsAgent.uploadBlob(blob, { encoding });
        return response.data.blob;
    } catch (error) {
        console.error('Error uploading blob:', error);
        throw error;
    }
};

export const generateFacets = (text: string) => {
    const facets: any[] = [];
    const utf8Encoder = new TextEncoder();

    // Hashtags: #word
    const hashtagRegex = /#(\w+)/g;
    let match;
    while ((match = hashtagRegex.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const byteStart = utf8Encoder.encode(text.substring(0, start)).length;
        const byteEnd = utf8Encoder.encode(text.substring(0, end)).length;
        facets.push({
            index: { byteStart, byteEnd },
            features: [{ $type: 'app.bsky.richtext.facet#tag', tag: match[1] }]
        });
    }

    // URLs: https?://...
    // Note: This is a simplified URL regex; production-grade apps might use something more robust like 'linkify-it'
    const urlRegex = /https?:\/\/[^\s\n\r\t]+[^\s\n\r\t.,;:!?"')\]]/g;
    while ((match = urlRegex.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const byteStart = utf8Encoder.encode(text.substring(0, start)).length;
        const byteEnd = utf8Encoder.encode(text.substring(0, end)).length;
        facets.push({
            index: { byteStart, byteEnd },
            features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }]
        });
    }

    // Sort facets by byteStart as required by AT Protocol
    return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
};

// Interactions
export interface InteractionSettings {
    replyOption: 'anyone' | 'nobody' | 'custom';
    replyRules?: {
        followers?: boolean;
        following?: boolean;
        mentioned?: boolean;
        lists?: string[]; // array of list URIs
    };
    allowQuotes: boolean;
}

export const createPost = async (text: string, embed?: any, settings?: InteractionSettings) => {
    if (!currentUser.value?.did) throw new Error('Not logged in');
    try {
        const facets = generateFacets(text);

        const response = await _pdsAgent.post({
            text,
            facets: facets.length > 0 ? facets : undefined,
            embed,
            createdAt: new Date().toISOString(),
        });

        if (settings && (settings.replyOption !== 'anyone' || !settings.allowQuotes)) {
            await applyInteractionSettings(response.uri, settings);
        }

        return response;
    } catch (error) {
        console.error('Error creating post:', error);
        throw error;
    }
};

const applyInteractionSettings = async (postUri: string, settings: InteractionSettings) => {
    if (!currentUser.value?.did) return;
    const rkey = postUri.split('/').pop();

    // 1. ThreadGate (for replies)
    if (settings.replyOption !== 'anyone') {
        const allow: any[] = [];

        if (settings.replyOption === 'custom' && settings.replyRules) {
            if (settings.replyRules.mentioned) {
                allow.push({ $type: 'app.bsky.feed.threadgate#mentionedRule' });
            }
            if (settings.replyRules.following) {
                allow.push({ $type: 'app.bsky.feed.threadgate#followingRule' });
            }
            if (settings.replyRules.followers) {
                allow.push({ $type: 'app.bsky.feed.threadgate#followerRule' });
            }
            if (settings.replyRules.lists && settings.replyRules.lists.length > 0) {
                settings.replyRules.lists.forEach(listUri => {
                    allow.push({ $type: 'app.bsky.feed.threadgate#listRule', list: listUri });
                });
            }
        }
        // If replyOption is 'nobody', allow remains empty

        try {
            await _pdsAgent.com.atproto.repo.putRecord({
                repo: currentUser.value.did,
                collection: 'app.bsky.feed.threadgate',
                rkey: rkey!,
                record: {
                    post: postUri,
                    allow: allow,
                    createdAt: new Date().toISOString(),
                }
            });
        } catch (e) {
            console.error('Failed to apply threadgate:', e);
        }
    }

    // 2. PostGate (for quotes)
    if (!settings.allowQuotes) {
        try {
            await _pdsAgent.com.atproto.repo.putRecord({
                repo: currentUser.value.did,
                collection: 'app.bsky.feed.postgate',
                rkey: rkey!,
                record: {
                    post: postUri,
                    embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
                    createdAt: new Date().toISOString(),
                }
            });
        } catch (e) {
            console.error('Failed to apply postgate:', e);
        }
    }
};

export const deletePost = async (uri: string) => {
    try {
        console.log('[BskyAgent] Attempting to delete record:', uri);
        const parts = uri.split('/');
        if (parts.length < 5 || parts[0] !== 'at:') throw new Error(`Invalid AT URI format: ${uri}`);
        const repo = parts[2];
        const collection = parts[3];
        const rkey = parts[4];

        console.log(`[BskyAgent] Deleting from PDS: ${_pdsAgent.options?.service || 'default'}`);
        await _pdsAgent.com.atproto.repo.deleteRecord({
            repo: repo,
            collection: collection,
            rkey: rkey,
        })
    } catch (error) {
        console.error('Error deleting post:', error)
        throw error
    }
}

export const likePost = async (uri: string, cid: string) => {
    try {
        return await _pdsAgent.like(uri, cid);
    } catch (error) {
        console.error('Error liking post:', error);
        throw error;
    }
};

export const unlikePost = async (likeUri: string) => {
    try {
        await _pdsAgent.deleteLike(likeUri);
    } catch (error) {
        console.error('Error unliking post:', error);
        throw error;
    }
};

export const repostPost = async (uri: string, cid: string) => {
    try {
        return await _pdsAgent.repost(uri, cid);
    } catch (error) {
        console.error('Error reposting post:', error);
        throw error;
    }
};

export const unrepostPost = async (repostUri: string) => {
    try {
        await _pdsAgent.deleteRepost(repostUri);
    } catch (error) {
        console.error('Error unreposting post:', error);
        throw error;
    }
};

export const getNotifications = async (limit = 30, cursor?: string) => {
    await initOAuth();
    if (!currentUser.value?.did) return { notifications: [], cursor: undefined };
    try {
        const response = await _agent.app.bsky.notification.listNotifications({
            limit,
            cursor,
        });
        return {
            notifications: response.data.notifications,
            cursor: response.data.cursor
        };
    } catch (error) {
        console.error('Error fetching notifications:', error);
        return { notifications: [], cursor: undefined };
    }
};

export const getUnreadCount = async () => {
    await initOAuth();
    if (!currentUser.value?.did) return 0;
    try {
        const response = await _agent.app.bsky.notification.getUnreadCount();
        return response.data.count;
    } catch (error) {
        console.error('Error fetching unread count:', error);
        return 0;
    }
};

export const updateNotificationsSeen = async () => {
    await initOAuth();
    if (!currentUser.value?.did) return;
    try {
        await _agent.app.bsky.notification.updateSeen({
            seenAt: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Error updating notifications seen:', error);
    }
};

export const fetchUserProfile = async () => {
    if (!currentUser.value?.did) {
        userProfile.value = null;
        return;
    }
    try {
        const response = await _agent.getProfile({ actor: currentUser.value.did });
        userProfile.value = response.data;
        if (currentUser.value) currentUser.value.handle = response.data.handle;
    } catch (error) {
        try {
            const response = await publicAgent.getProfile({ actor: currentUser.value.did });
            userProfile.value = response.data;
            if (currentUser.value) currentUser.value.handle = response.data.handle;
        } catch (fallbackError) {
            console.error('Final failure fetching user profile:', fallbackError);
        }
    }
};

export const getOtherProfile = async (did: string) => {
    await initOAuth();
    const activeAgent = currentUser.value?.did ? _agent : publicAgent;
    try {
        const response = await activeAgent.getProfile({ actor: did });
        return response.data;
    } catch (error) {
        if (activeAgent !== publicAgent) {
            try {
                return (await publicAgent.getProfile({ actor: did })).data;
            } catch (fallbackError) {
                console.error(`Error fetching profile for ${did} (fallback):`, fallbackError);
            }
        } else {
            console.error(`Error fetching profile for ${did}:`, error);
        }
        return null;
    }
};

export const followUser = async (did: string) => {
    await initOAuth();
    try {
        return await _pdsAgent.follow(did);
    } catch (error) {
        console.error(`Error following ${did}:`, error);
        throw error;
    }
};

export const unfollowUser = async (followUri: string) => {
    await initOAuth();
    try {
        await _pdsAgent.deleteFollow(followUri);
    } catch (error) {
        console.error(`Error unfollowing ${followUri}:`, error);
        throw error;
    }
};

export const getBookmarks = async (targetDid?: string) => {
    await initOAuth();
    const did = targetDid || currentUser.value?.did;
    if (!did) return null;

    // Resolve PDS for custom lexicon data
    const pdsUrl = await getPdsEndpoint(did);
    const activeAgent = pdsUrl ? new BskyAgent({ service: pdsUrl }) : _agent;

    try {
        const response = await activeAgent.com.atproto.repo.getRecord({
            repo: did,
            collection: 'id.gamedev.bookmarks',
            rkey: 'self',
        });
        const data = response.data.value as any;
        if (did === currentUser.value?.did) {
            const uris = new Set<string>();
            data.groups?.forEach((g: any) => {
                g.postUris?.forEach((uri: string) => uris.add(uri));
            });
            bookmarkedUris.value = uris;
        }
        return data;
    } catch (e: any) {
        // Fallback to main agent
        if (activeAgent !== _agent) {
            try {
                const response = await _agent.com.atproto.repo.getRecord({
                    repo: did,
                    collection: 'id.gamedev.bookmarks',
                    rkey: 'self',
                });
                return response.data.value as any;
            } catch (fallbackErr) { }
        }

        // Public fallback
        try {
            return (await publicAgent.com.atproto.repo.getRecord({
                repo: did,
                collection: 'id.gamedev.bookmarks',
                rkey: 'self',
            })).data.value;
        } catch (fallbackErr) { }

        if (e.status === 400 || e.status === 404 || e.error === 'RecordNotFound') {
            if (did === currentUser.value?.did) bookmarkedUris.value = new Set();
            return { groups: [], updatedAt: new Date().toISOString() };
        }
        console.error('Error fetching bookmarks:', e);
        return null;
    }
};

export const saveBookmarks = async (bookmarks: any) => {
    if (!currentUser.value?.did) throw new Error('Not logged in');
    try {
        await _pdsAgent.com.atproto.repo.putRecord({
            repo: currentUser.value.did,
            collection: 'id.gamedev.bookmarks',
            rkey: 'self',
            record: {
                $type: 'id.gamedev.bookmarks',
                groups: bookmarks.groups,
                updatedAt: new Date().toISOString(),
            },
        });
        const uris = new Set<string>();
        bookmarks.groups?.forEach((g: any) => {
            g.postUris?.forEach((uri: string) => uris.add(uri));
        });
        bookmarkedUris.value = uris;
    } catch (e) {
        console.error('Error saving bookmarks:', e);
        throw e;
    }
};

export const getLikes = async (uri: string, limit: number = 20, cursor?: string) => {
    await initOAuth();
    const activeAgent = currentUser.value?.did ? _agent : publicAgent;
    try {
        const response = await activeAgent.app.bsky.feed.getLikes({ uri, limit, cursor });
        return {
            likes: response.data.likes,
            cursor: response.data.cursor
        };
    } catch (e) {
        console.error('Error fetching likes:', e);
        return { likes: [], cursor: undefined };
    }
};

export const getRepostedBy = async (uri: string, limit: number = 20, cursor?: string) => {
    await initOAuth();
    const activeAgent = currentUser.value?.did ? _agent : publicAgent;
    try {
        const response = await activeAgent.app.bsky.feed.getRepostedBy({ uri, limit, cursor });
        return {
            repostedBy: response.data.repostedBy,
            cursor: response.data.cursor
        };
    } catch (e) {
        console.error('Error fetching reposters:', e);
        return { repostedBy: [], cursor: undefined };
    }
};

export const getQuotes = async (uri: string, limit: number = 20, cursor?: string) => {
    await initOAuth();
    const activeAgent = currentUser.value?.did ? _agent : publicAgent;
    try {
        const response = await activeAgent.app.bsky.feed.getQuotes({ uri, limit, cursor });
        return {
            posts: response.data.posts,
            cursor: response.data.cursor
        };
    } catch (e) {
        console.error('Error fetching quotes:', e);
        return { posts: [], cursor: undefined };
    }
};

export const getMyLists = async () => {
    if (!currentUser.value?.did) return [];
    try {
        const response = await _agent.app.bsky.graph.getLists({ actor: currentUser.value.did });
        return response.data.lists;
    } catch (e) {
        console.error('Failed to fetch lists:', e);
        return [];
    }
};

export const getPostsBatch = async (uris: string[]) => {
    if (uris.length === 0) return [];
    try {
        const response = await _agent.app.bsky.feed.getPosts({ uris });
        return response.data.posts;
    } catch (e) {
        try {
            return (await publicAgent.app.bsky.feed.getPosts({ uris })).data.posts;
        } catch (pe) {
            console.error('Error fetching batch posts:', pe);
            return [];
        }
    }
};

export const getAuthorFeed = async (actor: string) => {
    try {
        const response = await _agent.app.bsky.feed.getAuthorFeed({
            actor: actor,
            limit: 30,
        });
        return response.data.feed.map((item: any) => item.post);
    } catch (error) {
        try {
            return (await publicAgent.app.bsky.feed.getAuthorFeed({ actor: actor, limit: 30 })).data.feed.map((item: any) => item.post);
        } catch (fallbackError) {
            console.error('Error fetching author feed (fallback):', fallbackError);
            return [];
        }
    }
};

export interface CustomDiscover { id: string; name: string; query: string; }
export const customDiscovers = ref<CustomDiscover[]>([]);

export const getDiscovers = async (targetDid?: string) => {
    await initOAuth();
    const did = targetDid || currentUser.value?.did || 'did:plc:3rslglrz5mcgzw6tccvlgqlq';

    // Resolve PDS for custom lexicon data
    const pdsUrl = await getPdsEndpoint(did);
    const activeAgent = pdsUrl ? new BskyAgent({ service: pdsUrl }) : _agent;

    try {
        const response = await activeAgent.com.atproto.repo.getRecord({
            repo: did,
            collection: 'id.gamedev.discovers',
            rkey: 'self',
        });
        const data = response.data.value as any;
        if (did === currentUser.value?.did) {
            customDiscovers.value = data.discovers || [];
        }
        return data.discovers || [];
    } catch (e: any) {
        // Fallback to main agent
        if (activeAgent !== _agent) {
            try {
                const response = await _agent.com.atproto.repo.getRecord({
                    repo: did,
                    collection: 'id.gamedev.discovers',
                    rkey: 'self',
                });
                const data = response.data.value as any;
                if (did === currentUser.value?.did) {
                    customDiscovers.value = data.discovers || [];
                }
                return data.discovers || [];
            } catch (fallbackError) { }
        }

        // Public fallback
        try {
            const response = await publicAgent.com.atproto.repo.getRecord({
                repo: did,
                collection: 'id.gamedev.discovers',
                rkey: 'self',
            });
            const data = response.data.value as any;
            if (did === currentUser.value?.did) {
                customDiscovers.value = data.discovers || [];
            }
            return data.discovers || [];
        } catch (fallbackError) { }

        if (e.status === 400 || e.status === 404 || e.error === 'RecordNotFound') {
            if (currentUser.value?.did === did) customDiscovers.value = [];
            return [];
        }
        return [];
    }
};

export const saveDiscovers = async (discovers: CustomDiscover[]) => {
    if (!currentUser.value?.did) throw new Error('Not logged in');
    try {
        await _pdsAgent.com.atproto.repo.putRecord({
            repo: currentUser.value.did,
            collection: 'id.gamedev.discovers',
            rkey: 'self',
            record: {
                $type: 'id.gamedev.discovers',
                discovers,
                updatedAt: new Date().toISOString(),
            },
        });
        customDiscovers.value = discovers;
    } catch (e) {
        console.error('Error saving discovers:', e);
        throw e;
    }
};

export interface PortfolioSection {
    type: 'h1' | 'h2' | 'text' | 'image';
    content: string;
    blob?: any;
    pendingFile?: File;
}

export interface Experience {
    company: string;
    position: string;
    startDate: string;
    endDate?: string;
    current: boolean;
    description: string;
}

export interface GameWork {
    title: string;
    role: string;
    year: string;
    platform: string;
    link?: string;
    thumbnail?: string;
    blob?: any;
    pendingFile?: File;
    _uploadType?: 'url' | 'file';
    searching?: boolean;
}

export interface SocialLink { platform: string; url: string; }

export interface Portfolio {
    bio: string;
    sections: PortfolioSection[];
    experiences: Experience[];
    ludography: GameWork[];
    socials: SocialLink[];
    contact: { email?: string; website?: string; };
    updatedAt: string;
}

export const getPortfolio = async (targetDid?: string): Promise<Portfolio | null> => {
    await initOAuth();
    const did = targetDid || currentUser.value?.did;
    if (!did) return null;

    // Portfolios live on the owner's PDS. Since it's a custom lexicon, 
    // the generic AppView might not have it. We should fetch from the PDS.
    const pdsUrl = await getPdsEndpoint(did);
    const activeAgent = pdsUrl ? new BskyAgent({ service: pdsUrl }) : _agent;

    try {
        const response = await activeAgent.com.atproto.repo.getRecord({
            repo: did,
            collection: 'id.gamedev.profile',
            rkey: 'self',
        });
        return response.data.value as unknown as Portfolio;
    } catch (e: any) {
        // Fallback to main agent if PDS fetch failed or wasn't possible
        if (activeAgent !== _agent) {
            try {
                const response = await _agent.com.atproto.repo.getRecord({
                    repo: did,
                    collection: 'id.gamedev.profile',
                    rkey: 'self',
                });
                return response.data.value as unknown as Portfolio;
            } catch (fallbackError) { }
        }

        // Final fallback to public agent
        try {
            const response = await publicAgent.com.atproto.repo.getRecord({
                repo: did,
                collection: 'id.gamedev.profile',
                rkey: 'self',
            });
            return response.data.value as unknown as Portfolio;
        } catch (publicError) { }

        if (e.status === 400 || e.status === 404 || e.error === 'RecordNotFound') return null;
        return null;
    }
};

export const savePortfolio = async (portfolio: Portfolio) => {
    await initOAuth();
    if (!currentUser.value?.did) throw new Error('Not logged in');
    try {
        await _pdsAgent.com.atproto.repo.putRecord({
            repo: currentUser.value.did,
            collection: 'id.gamedev.profile',
            rkey: 'self',
            record: {
                $type: 'id.gamedev.profile',
                ...portfolio,
                updatedAt: new Date().toISOString(),
            },
        });
    } catch (e) {
        console.error('Error saving portfolio:', e);
        throw e;
    }
};

// --- CHAT FEATURE (DMs) ---
export const listConversations = async (limit = 30, cursor?: string) => {
    await initOAuth();
    if (!currentUser.value?.did) return { convos: [], cursor: undefined };
    try {
        // Chat APIs are available on the Agent instance (lexicon chat.bsky.convo)
        // We use the proxied chat service via the PDS agent
        const response = await _agent.api.chat.bsky.convo.listConvos({
            limit,
            cursor,
        }, {
            headers: {
                'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
            }
        });
        return {
            convos: response.data.convos,
            cursor: response.data.cursor
        };
    } catch (error) {
        console.error('Error listing conversations:', error);
        return { convos: [], cursor: undefined };
    }
};

export const getConversationMessages = async (convoId: string, limit = 50, cursor?: string) => {
    await initOAuth();
    if (!currentUser.value?.did) return { messages: [], cursor: undefined };
    try {
        const response = await _agent.api.chat.bsky.convo.getMessages({
            convoId,
            limit,
            cursor,
        }, {
            headers: {
                'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
            }
        });
        return {
            messages: response.data.messages,
            cursor: response.data.cursor
        };
    } catch (error) {
        console.error('Error fetching chat messages:', error);
        return { messages: [], cursor: undefined };
    }
};

export const sendMessageToConvo = async (convoId: string, text: string) => {
    await initOAuth();
    if (!currentUser.value?.did) throw new Error('Not logged in');
    try {
        return await _agent.api.chat.bsky.convo.sendMessage({
            convoId,
            message: {
                text,
            }
        }, {
            headers: {
                'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
            }
        });
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
};

export const getUnreadChatCount = async () => {
    // There isn't a direct "getUnreadTotal" for chat yet in common lexicons, 
    // but some implementations might have it or we check listConvos unread state
    try {
        const { convos } = await listConversations(20);
        return convos.reduce((acc: number, c: any) => acc + (c.unreadCount || 0), 0);
    } catch (e) {
        return 0;
    }
};

export const getOrCreateConvo = async (members: string[]) => {
    await initOAuth();
    if (!currentUser.value?.did) throw new Error('Not logged in');
    try {
        const response = await _agent.api.chat.bsky.convo.getConvoForMembers({
            members: [currentUser.value.did, ...members],
        }, {
            headers: {
                'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
            }
        });
        return response.data.convo;
    } catch (error) {
        console.error('Error getting/creating conversation:', error);
        throw error;
    }
};

export const updateChatRead = async (convoId: string, messageId?: string) => {
    await initOAuth();
    if (!currentUser.value?.did) return;
    try {
        await _agent.api.chat.bsky.convo.updateRead({
            convoId,
            messageId,
        }, {
            headers: {
                'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat',
            }
        });
    } catch (error) {
        console.error('Error updating chat read status:', error);
    }
};

