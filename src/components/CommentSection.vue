<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { atproto } from '../services/atproto'
import { useAuthStore } from '../stores/auth'

const props = defineProps({
  blueskyUri: String,    // Support legacy
  blueskyUris: Array,    // New multi-thread support
  postTitle: String,
  postUrl: String,
  isOwner: Boolean,
  rkey: String
})

const emit = defineEmits(['thread-created'])

const auth = useAuthStore()
const threads = ref([])
const replies = ref([])
const loading = ref(false)
const posting = ref(false)
const commentText = ref('')
const error = ref('')

// indicates we tried to fetch publicly and all calls failed due to auth restrictions
const unauthError = ref(false)

// derive whether any URI was supplied so we can decide which message to show
const hasUri = computed(() => {
  return (props.blueskyUris && props.blueskyUris.length > 0) || !!props.blueskyUri
})

// build array of converted BlueSky web links, resolving any DID repos to handles if possible
const blueSkyLinks = ref([])

const resolveLinks = async () => {
  const uris = [...(props.blueskyUris || [])]
  if (props.blueskyUri && !uris.includes(props.blueskyUri)) {
    uris.push(props.blueskyUri)
  }
  const results = await Promise.all(
    uris.map(async uri => {
      const parts = uri.replace('at://', '').split('/')
      let repo = parts[0]
      const rkey = parts[2]
      if (!repo || !rkey) return null
      if (repo.startsWith('did:')) {
        // attempt to fetch profile to convert DID to handle
        try {
          const prof = await atproto.getPublicProfile(repo)
          if (prof?.handle) {
            repo = prof.handle
          }
        } catch (e) {
          console.warn('Could not resolve DID to handle for', repo, e)
        }
      }
      return `https://bsky.app/profile/${repo}/post/${rkey}`
    })
  )
  blueSkyLinks.value = results.filter(r => r)
}

// recompute when props change
watch([() => props.blueskyUri, () => props.blueskyUris], resolveLinks, { deep: true, immediate: true })

// helper that fetches a thread directly using GET against the public Bluesky API
const fetchThreadViaXrpc = async (uri) => {
  try {
    // encode parameters in query string as per API spec
    const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread')
    url.searchParams.set('uri', uri)
    url.searchParams.set('depth', '10')
    url.searchParams.set('parentHeight', '0')
    const res = await fetch(url.toString(), { method: 'GET' })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = await res.json()
    return data?.thread || null
  } catch (err) {
    console.warn('XRPC fallback failed for', uri, err)
    return null
  }
}

const fetchThreads = async () => {
  // prepare list of BlueSky thread URIs, supporting legacy single/array props
  const uris = [...(props.blueskyUris || [])]
  if (props.blueskyUri && !uris.includes(props.blueskyUri)) {
    uris.push(props.blueskyUri)
  }

  // if we don’t have any URIs there’s nothing to load; clear state and stop loading
  if (uris.length === 0) {
    threads.value = []
    replies.value = []
    loading.value = false
    return
  }

  loading.value = true
  try {
    // first attempt using atproto service (authenticated or public)
    let threadResults = await Promise.all(
      uris.map(uri => atproto.getPostThread(uri).catch(err => {
        console.warn(`Failed to fetch thread for ${uri}:`, err)
        return null
      }))
    )

    // if all calls returned null and we're a guest, remember that
    if (!auth.user && threadResults.every(r => r === null)) {
      unauthError.value = true
    } else {
      unauthError.value = false
    }

    // fallback: try direct XRPC fetch for any null entries
    if (threadResults.some(r => r === null)) {
      await Promise.all(uris.map(async (uri, idx) => {
        if (threadResults[idx] === null) {
          try {
            const fallback = await fetchThreadViaXrpc(uri)
            if (fallback) threadResults[idx] = fallback
          } catch (__) {
            // ignore
          }
        }
      }))
    }

    threads.value = threadResults.filter(t => t !== null)

    // walk replies recursively, collecting depth information
    const structured = []
    const gather = (replyList, depth) => {
      if (!replyList) return
      replyList.forEach(r => {
        structured.push({ reply: r, depth })
        if (r.replies && r.replies.length) {
          gather(r.replies, depth + 1)
        }
      })
    }

    threads.value.forEach(t => {
      if (t.replies) {
        gather(t.replies, 0)
      }
    })

    // deduplicate keeping smallest depth (closest to root)
    const uniqueMap = new Map()
    structured.forEach(item => {
      const uri = item.reply.post.uri
      if (!uniqueMap.has(uri) || item.depth < uniqueMap.get(uri).depth) {
        uniqueMap.set(uri, item)
      }
    })

    // convert back to array preserving insertion order (depth-first traversal)
    replies.value = Array.from(uniqueMap.values())
  } catch (err) {
    console.error('Failed to fetch threads:', err)
  } finally {
    loading.value = false
  }
}

onMounted(fetchThreads)
watch([() => props.blueskyUri, () => props.blueskyUris], fetchThreads, { deep: true })

const handlePostThread = async () => {
  posting.value = true
  try {
    const text = `New blog post: ${props.postTitle}\n\nRead more: ${props.postUrl}`
    const result = await atproto.postToBluesky(text)
    emit('thread-created', result.uri)
  } catch (err) {
    error.value = 'Failed to create BlueSky thread: ' + err.message
  } finally {
    posting.value = false
  }
}

const replyingTo = ref(null)
const replyText = ref('')

const handleLike = async (post) => {
  if (!auth.user) return router.push('/login')
  try {
    if (post.viewer?.like) {
      await atproto.unlike(post.viewer.like)
    } else {
      await atproto.like(post.uri, post.cid)
    }
    await fetchThreads()
  } catch (err) {
    error.value = 'Failed to update like: ' + err.message
  }
}

const handleRepost = async (post) => {
  if (!auth.user) return router.push('/login')
  try {
    if (post.viewer?.repost) {
      await atproto.deleteRepost(post.viewer.repost)
    } else {
      await atproto.repost(post.uri, post.cid)
    }
    await fetchThreads()
  } catch (err) {
    error.value = 'Failed to update repost: ' + err.message
  }
}

const handlePostComment = async () => {
  if (!commentText.value.trim() || threads.value.length === 0) return
  posting.value = true
  try {
    const primaryThread = threads.value[0]
    await atproto.replyToBluesky(
      commentText.value,
      primaryThread.post,
      primaryThread.post
    )
    commentText.value = ''
    error.value = ''
    await fetchThreads()
  } catch (err) {
    error.value = 'Failed to post comment: ' + err.message
  } finally {
    posting.value = false
  }
}

const handleReplySubmit = async (parentPost) => {
  if (!replyText.value.trim()) return
  posting.value = true
  try {
    // Find which thread this parent belongs to so we use correct root
    // For simplicity, we can use the root from the first thread or find match
    const rootPost = threads.value[0].post // Fallback
    
    await atproto.replyToBluesky(
      replyText.value,
      rootPost, 
      parentPost
    )
    replyText.value = ''
    replyingTo.value = null
    await fetchThreads()
  } catch (err) {
    error.value = 'Failed to post reply: ' + err.message
  } finally {
    posting.value = false
  }
}

const formatDate = (dateStr) => {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// helpers for media attachments embedded in BlueSky posts
const constructUrl = (actor, blob) => {
  if (!blob || !actor) return null
  const did = typeof actor === 'string' ? actor : actor.did || actor.handle
  if (!did || !did.startsWith('did:')) return null
  const cid = blob.ref.$link || blob.ref
  const ext = blob.mimeType.split('/').pop()
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@${ext}`
}

const extractMedia = (post) => {
  const media = { images: [], videos: [] }
  if (!post?.record?.embed) return media
  const actor = post.author?.did || post.author?.handle || post.author
  const emb = post.record.embed
  // image embeds
  if (emb.images) {
    emb.images.forEach(img => {
      const url = constructUrl(actor, img.image)
      if (url) media.images.push({ url, alt: img.alt || '' })
    })
  }
  // generic media (video/audio) embeds
  if (emb.media) {
    emb.media.forEach(m => {
      if (m.video) {
        const url = constructUrl(actor, m.video)
        if (url) media.videos.push({ url, alt: m.alt || '' })
      } else if (m.image) {
        const url = constructUrl(actor, m.image)
        if (url) media.images.push({ url, alt: m.alt || '' })
      }
    })
  }
  // external embed thumbnail
  if (emb.external && emb.external.thumb) {
    const url = constructUrl(actor, emb.external.thumb)
    if (url) media.images.push({ url, alt: emb.external.title || '' })
  }
  return media
}
</script>

<template>
  <div class="comments-section mt-16 pt-12 border-t">
    <div v-if="(props.blueskyUris?.length === 0 && !props.blueskyUri) || (threads.length === 0 && !loading)" class="text-center py-10 transition-all">
      <div v-if="(props.blueskyUris?.length > 0 || props.blueskyUri) && threads.length === 0 && !loading" class="mb-6">
        <template v-if="unauthError">
          <v-icon icon="mdi-lock-open-outline" size="48" color="warning" class="mb-4 opacity-50"></v-icon>
          <h3 class="text-h6 font-weight-bold mb-2">Comments hidden</h3>
          <p class="text-secondary max-w-sm mx-auto mb-2">
            BlueSky requires authentication to view replies. You can open the thread(s) for this post on 
            <span v-for="(link, idx) in blueSkyLinks" :key="link">
              <a :href="link" target="_blank" class="font-weight-bold"> bsky.app</a><span v-if="idx < blueSkyLinks.length - 1">, </span>
            </span>
            or
            <v-btn to="/login" variant="text" class="font-weight-bold pa-0 h-auto min-w-0">sign in</v-btn>
            to see them inline.
          </p>
        </template>
        <template v-else>
          <v-icon icon="mdi-link-variant-off" size="48" color="warning" class="mb-4 opacity-50"></v-icon>
          <h3 class="text-h6 font-weight-bold mb-2">BlueSky threads not found.</h3>
          <p class="text-secondary max-w-sm mx-auto mb-6">Linked posts might have been deleted or moved on BlueSky.</p>
        </template>
      </div>
      <div v-else class="mb-6">
        <h3 class="text-h6 font-weight-bold mb-4">No comments yet.</h3>
        <p v-if="isOwner" class="text-secondary mb-6">Start a conversation on BlueSky to enable comments.</p>
        <p v-else class="text-secondary">Discussion for this post hasn't started on BlueSky yet.</p>
        <p v-if="!auth.user" class="text-secondary mt-4">
          <v-btn to="/login" variant="text" class="font-weight-bold pa-0 h-auto min-w-0 mr-1">Sign in</v-btn>
          with BlueSky to join the conversation.
        </p>
      </div>

      <template v-if="auth.user && props.isOwner">
        <v-btn
          color="primary"
          prepend-icon="mdi-share-variant"
          class="rounded-pill px-8 py-6 h-auto"
          :loading="posting"
          elevation="2"
          @click="handlePostThread"
        >
          Post to BlueSky to start comments thread
        </v-btn>
      </template>
    </div>

    <div v-else>
      <div class="d-flex align-center mb-8">
        <h3 class="text-h5 font-weight-black">Responses</h3>
        <v-spacer></v-spacer>
        <div class="d-flex gap-2">
          <v-chip
            v-for="(t, idx) in threads"
            :key="t.post.uri"
            :href="'https://bsky.app/profile/' + t.post.author.handle + '/post/' + t.post.uri.split('/').pop()"
            target="_blank"
            variant="tonal"
            size="small"
            prepend-icon="mdi-open-in-new"
            class="px-3"
          >
            Thread
          </v-chip>
        </div>
      </div>

      <!-- Comment Input -->
      <v-card v-if="auth.user" class="mb-10 rounded-xl border pa-4 shadow-sm" elevation="0">
        <v-textarea
          v-model="commentText"
          placeholder="What are your thoughts?"
          variant="plain"
          auto-grow
          rows="1"
          hide-details
          class="comment-input"
        ></v-textarea>
        <div class="d-flex justify-end mt-4">
          <v-btn
            color="success"
            size="small"
            class="rounded-pill px-6 font-weight-bold"
            :disabled="!commentText.trim() || posting"
            :loading="posting"
            @click="handlePostComment"
          >
            Respond
          </v-btn>
        </div>
      </v-card>
      <v-alert v-else type="info" variant="tonal" class="mb-10 rounded-lg">
        <v-btn to="/login" variant="text" class="font-weight-bold pa-0 h-auto min-w-0 mr-1">Sign in</v-btn> with BlueSky to join the conversation.
      </v-alert>

      <v-alert v-if="error" type="error" variant="tonal" class="mb-6 rounded-lg">
        {{ error }}
      </v-alert>

      <!-- Loading State -->
      <div v-if="loading" class="d-flex justify-center py-8">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </div>

      <!-- Thread List -->
      <div v-else-if="replies.length > 0" class="replies-list">
        <div v-for="item in replies" :key="item.reply.post.cid" class="reply-item py-6 border-b" :style="{ paddingLeft: item.depth * 32 + 'px' }">
          <div class="d-flex align-start mb-2">
            <v-avatar size="32" class="mr-5 mt-1">
              <v-img v-if="item.reply.post.author.avatar" :src="item.reply.post.author.avatar" cover></v-img>
              <v-icon v-else icon="mdi-account" size="small"></v-icon>
            </v-avatar>
            <div class="flex-grow-1">
              <div class="d-flex align-center gap-2 pl-2">
                <span class="text-subtitle-2 font-weight-bold">{{ item.reply.post.author.displayName || item.reply.post.author.handle }}</span>
                <a 
                  :href="'https://bsky.app/profile/' + item.reply.post.author.handle + '/post/' + item.reply.post.uri.split('/').pop()" 
                  target="_blank" 
                  class="text-caption text-secondary text-decoration-none hover-underline"
                >
                  {{ formatDate(item.reply.post.indexedAt) }}
                </a>
              </div>
              <p class="text-body-1 mt-1 comment-text pl-2">{{ item.reply.post.record.text }}</p>

              <!-- media attachments (images/videos) -->
              <div v-if="extractMedia(item.reply.post).images.length || extractMedia(item.reply.post).videos.length" class="pl-2 mt-4 comment-media">
                <div v-for="img in extractMedia(item.reply.post).images" :key="img.url" class="mb-4">
                  <v-img
                    :src="img.url"
                    :alt="img.alt"
                    max-width="400"
                    class="rounded-sm shadow-sm"
                  ></v-img>
                </div>
                <div v-for="vid in extractMedia(item.reply.post).videos" :key="vid.url" class="mb-4">
                  <video :src="vid.url" controls class="rounded-sm shadow-sm max-w-full"></video>
                </div>
              </div>
            </div>
          </div>
          <div class="d-flex align-center pl-11 gap-4">
            <v-btn 
              :icon="item.reply.post.viewer?.like ? 'mdi-heart' : 'mdi-heart-outline'" 
              variant="text" 
              size="x-small" 
              :color="item.reply.post.viewer?.like ? 'error' : 'secondary'" 
              density="comfortable"
              @click="handleLike(item.reply.post)"
            >
              <v-icon left size="16">{{ item.reply.post.viewer?.like ? 'mdi-heart' : 'mdi-heart-outline' }}</v-icon>
              {{ item.reply.post.likeCount || 0 }}
            </v-btn>
            <v-btn 
              icon="mdi-repeat" 
              variant="text" 
              size="x-small" 
              :color="item.reply.post.viewer?.repost ? 'success' : 'secondary'" 
              density="comfortable"
              @click="handleRepost(item.reply.post)"
            >
              <v-icon left size="16">mdi-repeat</v-icon>
              {{ item.reply.post.repostCount || 0 }}
            </v-btn>
            <v-btn 
              icon="mdi-comment-outline" 
              variant="text" 
              size="x-small" 
              color="secondary" 
              density="comfortable"
              @click="replyingTo === item.reply.post.cid ? replyingTo = null : replyingTo = item.reply.post.cid"
            >
              <v-icon left size="16">mdi-comment-outline</v-icon>
              {{ item.reply.post.replyCount || 0 }}
            </v-btn>
          </div>

          <!-- Inline Reply Field -->
          <v-expand-transition>
            <div v-if="replyingTo === item.reply.post.cid" class="pl-11 mt-4">
              <v-card class="rounded-lg border pa-3 bg-grey-lighten-5" elevation="0">
                <v-textarea
                  v-model="replyText"
                  :placeholder="'Reply to ' + (item.reply.post.author.displayName || item.reply.post.author.handle) + '...'"
                  variant="plain"
                  auto-grow
                  rows="1"
                  hide-details
                  class="reply-textarea"
                ></v-textarea>
                <div class="d-flex justify-end mt-2 gap-2">
                   <v-btn variant="text" size="x-small" @click="replyingTo = null">Cancel</v-btn>
                   <v-btn color="success" size="x-small" class="rounded-pill font-weight-bold" @click="handleReplySubmit(item.reply.post)" :loading="posting">Reply</v-btn>
                </div>
              </v-card>
            </div>
          </v-expand-transition>
        </div>
      </div>
      
      <div v-else class="text-center py-8 opacity-50">
         Be the first to share a thought.
      </div>
    </div>
  </div>
</template>

<style scoped>
.comment-input :deep(textarea) {
  font-size: 1rem !important;
  color: #242424 !important;
}

.reply-textarea :deep(textarea) {
  font-size: 0.95rem !important;
  color: #242424 !important;
  line-height: 1.4 !important;
}

.comment-text {
  line-height: 1.5;
  color: #242424;
}

.border-b {
  border-bottom: 1px solid #F2F2F2 !important;
}

.gap-2 { gap: 8px; }
.gap-4 { gap: 16px; }

.shadow-sm {
  box-shadow: 0 1px 4px rgba(0,0,0,0.05) !important;
}

.hover-underline:hover {
  text-decoration: underline !important;
}

.reply-item {
  transition: background-color 0.2s ease;
}

.comment-media img,
.comment-media video {
  display: block;
  max-width: 100%;
  border-radius: 0.375rem;
}
.comment-media video {
  max-height: 300px;
}

.opacity-60 { opacity: 0.6; }
</style>
