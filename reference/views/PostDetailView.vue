<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { atproto } from '../services/atproto'
import { useAuthStore } from '../stores/auth'
import CommentSection from '../components/CommentSection.vue'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const post = ref(null)
const loading = ref(true)
const deleteDialog = ref(false)
const deleting = ref(false)

const isOwner = computed(() => {
  return auth.user && post.value && auth.user.handle === post.value.author.handle
})

const postUrl = computed(() => typeof window !== 'undefined' ? window.location.href : '')

const fetchPost = async () => {
  loading.value = true
  const { rkey } = route.params
  const repo = route.params.repo || import.meta.env.VITE_BLOG_OWNER || 'igrir.bsky.social'
  const uri = `at://${repo}/xyz.atoblog.post/${rkey}`
  
  try {
    const data = await atproto.getPost(uri)
    post.value = data.post
    
    if (post.value.record.isDraft && !isOwner.value) {
      router.push('/')
      return
    }
  } catch (error) {
    console.error(error)
    router.push('/')
  } finally {
    loading.value = false
  }
}

onMounted(fetchPost)

const formatDate = (dateStr) => {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

const getBlockImageUrl = (blob) => {
  if (!blob || !post.value?.author) return null
  const did = post.value.author.did || post.value.author.handle
  if (!did || !did.startsWith('did:')) return null
  const cid = blob.ref.$link || blob.ref
  const ext = blob.mimeType.split('/').pop()
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@${ext}`
}

const handleEdit = () => {
  const rkey = route.params.rkey
  router.push({ name: 'new-post', query: { rkey } })
}

const handleDelete = async () => {
  deleting.value = true
  try {
    const rkey = route.params.rkey
    await atproto.deletePost(rkey)
    router.push('/')
  } catch (error) {
    console.error('Failed to delete post:', error)
  } finally {
    deleting.value = false
    deleteDialog.value = false
  }
}

const handleThreadCreated = async (uri) => {
  const rkey = route.params.rkey
  try {
    // Collect existing URIs, including legacy single ones
    const currentUris = [...(post.value.record.blueskyUris || [])]
    if (post.value.record.blueskyUri && !currentUris.includes(post.value.record.blueskyUri)) {
      currentUris.push(post.value.record.blueskyUri)
    }
    
    // Add new one
    if (!currentUris.includes(uri)) {
      currentUris.push(uri)
    }

    await atproto.updatePost(
      rkey,
      post.value.record.title,
      post.value.record.blocks,
      post.value.record.createdAt,
      currentUris
    )
    post.value.record.blueskyUris = currentUris
    // Remove legacy single URI to keep record clean
    delete post.value.record.blueskyUri
  } catch (error) {
    console.error('Failed to update post with BlueSky URI:', error)
  }
}

const highlightCode = (code, lang) => {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang }).value
    } catch (__) {}
  }
  return hljs.highlightAuto(code).value
}

const formatText = (text) => {
  if (!text) return ''
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^&gt; (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\_\_([\s\S]*?)\_\_/g, '<u>$1</u>')
    .replace(/~~([\s\S]*?)~~/g, '<s>$1</s>')
    .replace(/\*([\s\S]*?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="story-link">$1</a>')
}
</script>

<template>
  <div class="story-detail-view py-12 position-relative">
    <v-btn 
      to="/" 
      icon="mdi-chevron-left" 
      variant="text" 
      class="back-button-floating"
    ></v-btn>

    <div v-if="loading" class="d-flex justify-center py-12">
      <v-progress-circular indeterminate color="primary" size="48" width="3"></v-progress-circular>
    </div>

    <article v-else-if="post" class="story-article">
      <header class="story-header mb-12">
        <h1 class="text-h2 font-weight-black mb-10 story-title">
          {{ post.record.title }}
          <v-chip v-if="post.record.isDraft" size="small" color="warning" variant="flat" class="ml-4 mb-2 font-weight-bold" style="vertical-align: middle; letter-spacing: 0.15em;">DRAFT</v-chip>
        </h1>
        
        <div class="d-flex align-center mb-16 pb-8 border-b">
          <div class="flex-grow-1">
            <div class="text-caption text-secondary">
              {{ formatDate(post.indexedAt) }} · 8 min read
            </div>
          </div>
          <div class="d-flex align-center gap-2">
            <v-menu v-if="isOwner">
              <template v-slot:activator="{ props }">
                <v-btn icon="mdi-dots-horizontal" variant="text" size="small" color="secondary" v-bind="props"></v-btn>
              </template>
              <v-list density="compact" class="rounded-lg">
                <v-list-item @click="handleEdit" prepend-icon="mdi-pencil">Edit Story</v-list-item>
                <v-list-item @click="deleteDialog = true" prepend-icon="mdi-delete" color="error">Delete</v-list-item>
              </v-list>
            </v-menu>
          </div>
        </div>
      </header>

      <div class="story-body text-serif pt-6">
        <template v-if="post.record.blocks">
          <div v-for="(block, index) in post.record.blocks" :key="index" class="mb-10 block-item">
            <p v-if="block.type === 'text'" class="story-paragraph" v-html="formatText(block.value)"></p>
            <h1 v-else-if="block.type === 'h1'" class="story-h1" v-html="formatText(block.value)"></h1>
            <h2 v-else-if="block.type === 'h2'" class="story-h2" v-html="formatText(block.value)"></h2>
            <h3 v-else-if="block.type === 'h3'" class="story-h3" v-html="formatText(block.value)"></h3>
            <blockquote v-else-if="block.type === 'quote'" class="story-quote">
              <p>{{ block.value }}</p>
            </blockquote>

            <div v-else-if="block.type === 'spacer'" class="story-spacer py-6 text-center">
              <div class="d-flex align-center justify-center ga-3">
                <span class="spacer-dot"></span>
                <span class="spacer-dot"></span>
                <span class="spacer-dot"></span>
              </div>
            </div>

            <div v-else-if="block.type === 'code'" class="story-code-block mb-10">
              <div v-if="block.language" class="code-lang-badge">{{ block.language }}</div>
              <pre><code :class="['hljs', 'language-' + (block.language || 'plaintext')]" v-html="highlightCode(block.value, block.language)"></code></pre>
            </div>

            <v-img
              v-else-if="block.type === 'image'"
              :src="getBlockImageUrl(block.blob)"
              class="story-image rounded-sm shadow-sm mx-auto"
              max-height="1000"
            >
              <template v-slot:placeholder>
                <v-progress-circular indeterminate color="grey-lighten-3"></v-progress-circular>
              </template>
            </v-img>
          </div>
        </template>
        
        <template v-else>
          <v-img
            v-if="post.record.image"
            :src="getBlockImageUrl(post.record.image)"
            class="story-image rounded-sm mb-10 mx-auto"
            max-height="600"
          ></v-img>
          <p class="story-paragraph">
            {{ post.record.text }}
          </p>
        </template>
      </div>

      <!-- Post Tags -->
      <div v-if="post.record.tags && post.record.tags.length > 0" class="mt-12 d-flex flex-wrap ga-3 pb-5">
        <v-chip
          v-for="tag in post.record.tags"
          :key="tag"
          size="small"
          variant="flat"
          color="grey-lighten-4"
          class="px-3 text-secondary text-uppercase font-weight-bold"
          style="letter-spacing: 0.05em; font-size: 0.7rem;"
          @click="router.push({ name: 'feed', query: { tag } })"
        >
          {{ tag }}
        </v-chip>
      </div>

      <!-- BlueSky Comments Section -->
      <CommentSection 
        :blueskyUri="post.record.blueskyUri"
        :blueskyUris="post.record.blueskyUris"
        :postTitle="post.record.title"
        :postUrl="postUrl"
        :isOwner="isOwner"
        :rkey="route.params.rkey"
        @thread-created="handleThreadCreated"
      />

      <footer class="story-footer mt-16 pt-12 pb-8 border-t">
        <!-- Footer cleaned -->
      </footer>
    </article>

    <!-- Delete Confirmation -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card class="rounded-lg pa-4">
        <v-card-title class="text-h6 font-weight-bold">Delete Story?</v-card-title>
        <v-card-text>This will permanently remove this story from your blog.</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="handleDelete" :loading="deleting" class="px-6 rounded-pill">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.story-detail-view {
  max-width: 680px !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

.story-title {
  font-size: 3rem !important;
  line-height: 1.05 !important;
  letter-spacing: -0.04em !important;
  color: #242424;
}

.story-paragraph {
  font-family: var(--medium-font-serif, source-serif-pro, Georgia, Cambria, "Times New Roman", Times, serif);
  font-size: 1.25rem;
  line-height: 1.62;
  color: #242424;
  margin-bottom: 2rem;
  white-space: pre-wrap;
  word-break: break-word;
  letter-spacing: -0.003em;
}

.story-h1 {
  font-family: var(--medium-font-sans);
  font-size: 2.5rem;
  line-height: 1.3;
  font-weight: 800;
  color: #242424;
  margin-top: 2rem;
  margin-bottom: 0.5rem;
}

.story-h2 {
  font-family: var(--medium-font-sans);
  font-size: 2rem;
  line-height: 1.3;
  font-weight: 700;
  color: #242424;
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
}

.story-h3 {
  font-family: var(--medium-font-sans);
  font-size: 1.5rem;
  line-height: 1.3;
  font-weight: 700;
  color: #242424;
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
}

.story-paragraph :deep(strong) {
  font-weight: 700;
}

.story-paragraph :deep(em) {
  font-style: italic;
}

.story-paragraph :deep(u) {
  text-decoration: underline;
}

.story-paragraph :deep(s) {
  text-decoration: line-through;
}

.story-paragraph :deep(blockquote) {
  border-left: 3px solid #242424;
  padding-left: 1.5rem;
  margin: 1rem 0;
  font-style: italic;
  color: #242424;
}

.story-paragraph :deep(.story-link) {
  color: #242424;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  transition: opacity 0.2s ease;
}

.story-paragraph :deep(.story-link:hover) {
  opacity: 0.7;
}

.back-button-floating {
  position: absolute;
  left: -80px;
  top: 48px;
  color: #757575 !important;
}

@media (max-width: 1024px) {
  .back-button-floating {
    position: static;
    margin-bottom: 2rem;
    margin-left: -0.5rem;
  }
}

.story-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 3.5rem auto; /* More generous spacing around images */
}

.story-spacer {
  margin: 2rem 0;
}

.spacer-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: #242424;
  opacity: 0.6;
}

.story-quote {
  border-left: 3px solid #242424;
  padding-left: 2rem;
  margin-bottom: 2.5rem;
  margin-top: 1rem;
}

.story-quote p {
  font-size: 1.8rem;
  line-height: 1.4;
  font-weight: 400;
  font-style: italic;
  color: #242424;
}

.story-code-block {
  position: relative;
  background: #282c34; /* Atom One Dark default background */
  border-radius: 8px;
  margin-bottom: 2.5rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.story-code-block pre {
  margin: 0;
  padding: 1.5rem;
  overflow-x: auto;
}

.story-code-block code {
  font-family: 'Fira Code', 'Roboto Mono', monospace !important;
  font-size: 0.95rem;
  line-height: 1.5;
  color: #abb2bf !important; /* Force readable base color */
  background: transparent !important;
  padding: 0 !important;
}

.code-lang-badge {
  position: absolute;
  top: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.4);
  padding: 4px 12px;
  font-size: 0.65rem;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.05em;
  border-bottom-left-radius: 8px;
  z-index: 1;
}

.border-b {
  border-bottom: 1px solid #F2F2F2 !important;
}

.border-t {
  border-top: 1px solid #F2F2F2 !important;
}

.gap-2 { gap: 8px; }
.gap-4 { gap: 16px; }

@media (max-width: 768px) {
  .story-title {
    font-size: 2.25rem !important;
  }
}
</style>
