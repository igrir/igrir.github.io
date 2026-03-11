<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { atproto } from '../services/atproto'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const posts = ref([])
const loading = ref(false)
const filterTag = ref(route.query.tag || '')
const blogOwner = import.meta.env.VITE_BLOG_OWNER || 'igrir.bsky.social'
// console.log('FeedView: blogOwner:', blogOwner)

const settings = ref({
  title: 'Reflections on Decentralization',
  description: 'Stories and insights from the AT Protocol'
})
// profile info for current repo, used to display avatar
const repoProfile = ref({ handle: '', avatar: '' })

// compute which repository's feed we should show (env default or route param)
const currentRepo = computed(() => {
  const r = route.params.repo || blogOwner || 'igrir.bsky.social'
  if (!r || r === 'undefined' || r === 'null') return 'igrir.bsky.social'
  return r
})

// whether the active user owns this repo
const isOwner = computed(() => {
  const repo = currentRepo.value
  return auth.user && (auth.user.handle === repo || auth.user.did === repo)
})

watch(() => route.query.tag, (newTag) => {
  filterTag.value = newTag || ''
})

watch(
  () => route.params.repo,
  () => {
    filterTag.value = '' // clear tag filter when switching profile
    fetchPosts()
  }
)

const filteredPosts = computed(() => {
  if (!filterTag.value) return posts.value
  return posts.value.filter(p => 
    p.post.record.tags && p.post.record.tags.includes(filterTag.value)
  )
})

const fetchPosts = async () => {
  loading.value = true
  try {
    const repo = currentRepo.value
    // Fetch posts + settings for the requested repo.
    const postsPromise = atproto.getPosts(repo)
    const settingsPromise = atproto.getSettings(repo)
    // fetch profile via the public API host to avoid auth errors
    const profilePromise = fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(repo)}`
    )
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)

    const [blogPosts, blogSettings, profile] = await Promise.all([
      postsPromise,
      settingsPromise.catch(err => {
        console.warn('Failed to load settings for', repo, err)
        return null
      }),
      profilePromise
    ])

    posts.value = blogPosts.filter(p => !p.post.record.isDraft || isOwner.value)

    // apply settings if we got them, otherwise fallback to generic title
    if (blogSettings) {
      settings.value = blogSettings
    } else {
      settings.value = {
        title: repo === blogOwner ? settings.value.title : `${repo}'s posts`,
        description: repo === blogOwner ? settings.value.description : ''
      }
    }

    if (profile) {
      repoProfile.value = profile
    }
    // if (profile && profile.data) {
    // } else {
    //   repoProfile.value = { handle: repo, avatar: '' }
    // }
  } catch (error) {
    console.error('Failed to fetch posts or settings:', error)
    posts.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchPosts)

// also refetch if tag, repo parameter changes, or login status changes
watch([filterTag, isOwner], fetchPosts)

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
  let text = ''
  const { record } = item.post
  if (record.blocks) {
    const contentBlock = record.blocks.find(b => ['text', 'quote', 'code', 'h1', 'h2', 'h3'].includes(b.type))
    if (contentBlock) text = contentBlock.value
  } else {
    text = record.text || ''
  }
  return text
    .replace(/^> (.*$)/gim, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/\_\_([\s\S]*?)\_\_/g, '$1')
    .replace(/~~([\s\S]*?)~~/g, '$1')
    .replace(/\*([\s\S]*?)\*/g, '$1')
}
</script>

<template>
  <div class="feed-container py-12">
    <header class="blog-header mb-32 text-center pb-16 border-b">
      <div v-if="!loading">
        <template v-if="repoProfile.avatar">
          <v-avatar size="64" class="mb-4 mx-auto">
            <v-img :src="repoProfile.avatar" cover></v-img>
          </v-avatar>
        </template>
        <h1 class="text-h1 font-weight-black mb-6 blog-title">{{ settings.title }}</h1>
        <p class="text-h5 text-secondary font-weight-medium blog-description max-w-2xl mx-auto">
          {{ settings.description }}
        </p>
      </div>
      <div v-else class="py-12">
        <v-progress-circular indeterminate color="primary" size="48" width="3"></v-progress-circular>
      </div>
    </header>
    
    <div v-if="filterTag" class="filter-header mb-12 d-flex align-center">
      <span class="text-h6 text-secondary">Showing stories tagged: <span class="text-primary font-weight-black">{{ filterTag }}</span></span>
      <v-btn icon="mdi-close" variant="text" size="small" class="ml-2" @click="filterTag = ''"></v-btn>
    </div>

    <div v-if="loading" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" size="48" width="3"></v-progress-circular>
    </div>

    <div v-else-if="filteredPosts.length > 0" class="posts-list pt-10">
      <article v-for="item in filteredPosts" :key="item.post.cid" class="post-item mb-12">
        <v-row no-gutters align="center">
          <v-col class="pr-8">
            <div class="d-flex align-center mb-3">
              <span class="text-caption text-secondary">{{ formatDate(item.post.indexedAt) }}</span>
            </div>

            <router-link 
              :to="item.post.author.handle === blogOwner || item.post.author.did === blogOwner
                ? { name: 'post-detail-owner', params: { rkey: item.post.uri.split('/').pop() } }
                : { name: 'post-detail', params: { repo: item.post.author.handle, rkey: item.post.uri.split('/').pop() } }"
              class="text-decoration-none"
            >
              <h3 class="text-h5 font-weight-black mb-2 post-title">
                {{ item.post.record.title || 'Untitled Story' }}
                <v-chip v-if="item.post.record.isDraft" size="x-small" color="warning" variant="flat" class="ml-2 font-weight-bold" style="letter-spacing: 0.15em;">DRAFT</v-chip>
              </h3>
              <p class="text-body-1 text-secondary line-clamp-2 mb-4 post-snippet">
                {{ getSnippet(item) }}
              </p>
            </router-link>

            <div class="d-flex align-center flex-wrap ga-3 mt-4">
              <v-chip
                v-for="tag in item.post.record.tags"
                :key="tag"
                size="x-small"
                variant="flat"
                color="grey-lighten-4"
                class="px-2 tag-chip text-secondary text-uppercase font-weight-bold"
                style="letter-spacing: 0.05em; font-size: 0.65rem;"
                @click.stop="filterTag = tag"
              >
                {{ tag }}
              </v-chip>
              <span v-if="item.post.record.tags?.length > 0" class="text-caption text-secondary opacity-30">|</span>
              <span class="text-caption text-secondary font-weight-medium">5 min read</span>
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

.post-item:not(:first-child) {
  padding-top: 48px;
}
</style>
