<script setup>
import { ref, onMounted, watch } from 'vue'
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

const fetchThreads = async () => {
  const uris = [...(props.blueskyUris || [])]
  if (props.blueskyUri && !uris.includes(props.blueskyUri)) {
    uris.push(props.blueskyUri)
  }
  
  if (uris.length === 0) return
  
  loading.value = true
  try {
    const threadResults = await Promise.all(
      uris.map(uri => atproto.getPostThread(uri).catch(err => {
        console.warn(`Failed to fetch thread for ${uri}:`, err)
        return null
      }))
    )
    
    threads.value = threadResults.filter(t => t !== null)
    
    // Aggregating all replies from all threads
    const allReplies = []
    threads.value.forEach(t => {
      if (t.replies) {
        allReplies.push(...t.replies)
      }
    })
    
    // De-duplicate (in case overlapping threads) and sort
    const uniqueRepliesMap = new Map()
    allReplies.forEach(r => {
      uniqueRepliesMap.set(r.post.uri, r)
    })
    
    replies.value = Array.from(uniqueRepliesMap.values()).sort((a, b) => {
      return new Date(b.post.indexedAt) - new Date(a.post.indexedAt)
    })
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
</script>

<template>
  <div class="comments-section mt-16 pt-12 border-t">
    <div v-if="(props.blueskyUris?.length === 0 && !props.blueskyUri) || (threads.length === 0 && !loading)" class="text-center py-10 transition-all">
      <div v-if="(props.blueskyUris?.length > 0 || props.blueskyUri) && threads.length === 0 && !loading" class="mb-6">
        <v-icon icon="mdi-link-variant-off" size="48" color="warning" class="mb-4 opacity-50"></v-icon>
        <h3 class="text-h6 font-weight-bold mb-2">BlueSky threads not found.</h3>
        <p class="text-secondary max-w-sm mx-auto mb-6">Linked posts might have been deleted or moved on BlueSky.</p>
      </div>
      <div v-else class="mb-6">
        <h3 class="text-h6 font-weight-bold mb-4">No comments yet.</h3>
        <p v-if="isOwner" class="text-secondary mb-6">Start a conversation on BlueSky to enable comments.</p>
        <p v-else class="text-secondary">Discussion for this post hasn't started on BlueSky yet.</p>
      </div>

      <template v-if="auth.user">
        <v-btn
          color="primary"
          prepend-icon="mdi-share-variant"
          class="rounded-pill px-8 py-6 h-auto"
          :loading="posting"
          elevation="2"
          @click="handlePostThread"
        >
          Post to BlueSky
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
            Thread {{ idx + 1 }}
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
        <div v-for="reply in replies" :key="reply.post.cid" class="reply-item py-6 border-b">
          <div class="d-flex align-start mb-2">
            <v-avatar size="32" class="mr-3 mt-1">
              <v-img v-if="reply.post.author.avatar" :src="reply.post.author.avatar" cover></v-img>
              <v-icon v-else icon="mdi-account" size="small"></v-icon>
            </v-avatar>
            <div class="flex-grow-1">
              <div class="d-flex align-center gap-2">
                <span class="text-subtitle-2 font-weight-black">{{ reply.post.author.displayName || reply.post.author.handle }}</span>
                <a 
                  :href="'https://bsky.app/profile/' + reply.post.author.handle + '/post/' + reply.post.uri.split('/').pop()" 
                  target="_blank" 
                  class="text-caption text-secondary text-decoration-none hover-underline"
                >
                  {{ formatDate(reply.post.indexedAt) }}
                </a>
              </div>
              <p class="text-body-1 mt-1 comment-text">{{ reply.post.record.text }}</p>
            </div>
          </div>
          <div class="d-flex align-center pl-11 gap-4">
            <v-btn 
              :icon="reply.post.viewer?.like ? 'mdi-heart' : 'mdi-heart-outline'" 
              variant="text" 
              size="x-small" 
              :color="reply.post.viewer?.like ? 'error' : 'secondary'" 
              density="comfortable"
              @click="handleLike(reply.post)"
            >
              <v-icon left size="16">{{ reply.post.viewer?.like ? 'mdi-heart' : 'mdi-heart-outline' }}</v-icon>
              {{ reply.post.likeCount || 0 }}
            </v-btn>
            <v-btn 
              icon="mdi-repeat" 
              variant="text" 
              size="x-small" 
              :color="reply.post.viewer?.repost ? 'success' : 'secondary'" 
              density="comfortable"
              @click="handleRepost(reply.post)"
            >
              <v-icon left size="16">mdi-repeat</v-icon>
              {{ reply.post.repostCount || 0 }}
            </v-btn>
            <v-btn 
              icon="mdi-comment-outline" 
              variant="text" 
              size="x-small" 
              color="secondary" 
              density="comfortable"
              @click="replyingTo === reply.post.cid ? replyingTo = null : replyingTo = reply.post.cid"
            >
              <v-icon left size="16">mdi-comment-outline</v-icon>
              {{ reply.post.replyCount || 0 }}
            </v-btn>
          </div>

          <!-- Inline Reply Field -->
          <v-expand-transition>
            <div v-if="replyingTo === reply.post.cid" class="pl-11 mt-4">
              <v-card class="rounded-lg border pa-3 bg-grey-lighten-5" elevation="0">
                <v-textarea
                  v-model="replyText"
                  :placeholder="'Reply to ' + (reply.post.author.displayName || reply.post.author.handle) + '...'"
                  variant="plain"
                  auto-grow
                  rows="1"
                  hide-details
                  class="reply-textarea"
                ></v-textarea>
                <div class="d-flex justify-end mt-2 gap-2">
                   <v-btn variant="text" size="x-small" @click="replyingTo = null">Cancel</v-btn>
                   <v-btn color="success" size="x-small" class="rounded-pill font-weight-bold" @click="handleReplySubmit(reply.post)" :loading="posting">Reply</v-btn>
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

.opacity-60 { opacity: 0.6; }
</style>
