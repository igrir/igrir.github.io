<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { atproto } from '../services/atproto'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const posts = ref([])
const loading = ref(true)
const settings = ref({
  title: 'Reflections on Decentralization',
  description: 'Stories and insights from the AT Protocol'
})

const fetchPosts = async () => {
  loading.value = true
  try {
    const actor = import.meta.env.VITE_BLOG_OWNER || 'igrir.bsky.social'
    
    // Fetch settings and posts in parallel
    const [blogPosts, blogSettings] = await Promise.all([
      atproto.getPosts(actor),
      atproto.getSettings(actor)
    ])
    
    posts.value = blogPosts
    settings.value = blogSettings
  } catch (error) {
    console.error('Failed to fetch posts or settings:', error)
    posts.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchPosts)

const formatDate = (dateStr) => {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}

const getImageUrl = (item) => {
  const { record, author } = item.post
  if (record.blocks) {
    const firstImageBlock = record.blocks.find(b => b.type === 'image')
    if (firstImageBlock) return constructUrl(author, firstImageBlock.blob)
  }
  if (record.image) return constructUrl(author, record.image)
  return null
}

const constructUrl = (actor, blob) => {
  if (!blob || !actor) return null
  const did = typeof actor === 'string' ? actor : actor.did || actor.handle
  if (!did || !did.startsWith('did:')) return null
  const cid = blob.ref.$link || blob.ref
  const ext = blob.mimeType.split('/').pop()
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@${ext}`
}

const getSnippet = (item) => {
  const { record } = item.post
  if (record.blocks) {
    const firstTextBlock = record.blocks.find(b => b.type === 'text')
    if (firstTextBlock) return firstTextBlock.value
  }
  return record.text || ''
}
</script>

<template>
  <div class="feed-container py-12">
    <header class="mb-12 border-b pb-8">
      <h1 class="text-h2 font-weight-black mb-2 hero-title">{{ settings.title }}</h1>
      <p class="text-h6 text-secondary">{{ settings.description }}</p>
    </header>

    <div v-if="loading" class="d-flex justify-center py-12">
      <v-progress-circular indeterminate color="primary" size="48" width="3"></v-progress-circular>
    </div>

    <div v-else-if="posts.length > 0" class="posts-list">
      <article v-for="item in posts" :key="item.post.cid" class="post-item mb-12">
        <v-row no-gutters align="center">
          <v-col class="pr-8">
            <div class="d-flex align-center mb-3">
              <span class="text-caption text-secondary">{{ formatDate(item.post.indexedAt) }}</span>
            </div>

            <router-link 
              :to="{ name: 'post-detail', params: { repo: item.post.author.handle, rkey: item.post.uri.split('/').pop() } }"
              class="text-decoration-none"
            >
              <h3 class="text-h5 font-weight-black mb-2 post-title">{{ item.post.record.title || 'Untitled Story' }}</h3>
              <p class="text-body-1 text-secondary line-clamp-2 mb-4 post-snippet">
                {{ getSnippet(item) }}
              </p>
            </router-link>

            <div class="d-flex align-center">
              <span class="text-caption text-secondary">5 min read</span>
            </div>
          </v-col>

          <v-col cols="auto" v-if="getImageUrl(item)">
            <v-img
              :src="getImageUrl(item)"
              width="160"
              height="112"
              cover
              class="rounded-lg bg-grey-lighten-4 cursor-pointer"
              @click="router.push({ name: 'post-detail', params: { repo: item.post.author.handle, rkey: item.post.uri.split('/').pop() } })"
            ></v-img>
          </v-col>
        </v-row>
      </article>
    </div>

    <div v-else class="text-center py-12">
      <v-icon icon="mdi-text-box-search-outline" size="64" color="secondary" class="mb-4 opacity-30"></v-icon>
      <h3 class="text-h5 text-secondary font-weight-medium">No stories found yet.</h3>
    </div>
  </div>
</template>

<style scoped>
.feed-container {
  max-width: 720px !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

.hero-title {
  letter-spacing: -0.04em !important;
  color: #242424;
}

.post-item {
  border-bottom: 0px solid #f2f2f2;
}

.post-title {
  color: #242424;
  line-height: 1.25 !important;
  transition: opacity 0.2s ease;
}

.post-title:hover {
  opacity: 0.8;
}

.post-snippet {
  line-height: 1.5 !important;
  color: #6B6B6B;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.post-item:not(:last-child) {
  padding-bottom: 48px;
  border-bottom: 1px solid #F2F2F2;
}
</style>
