<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { atproto } from '../services/atproto'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const title = ref('')
const blocks = ref([
  { id: Date.now(), type: 'text', value: '' }
])
const loading = ref(false)
const error = ref('')
const isEdit = ref(false)
const rkey = ref('')
const originalCreatedAt = ref('')
const tags = ref([])
const tagInput = ref('')

const loadPost = async () => {
  const queryRkey = route.query.rkey
  
  if (!queryRkey) {
    // Reset for new post
    isEdit.value = false
    rkey.value = ''
    title.value = ''
    tags.value = []
    tagInput.value = ''
    blocks.value = [
      { id: Date.now(), type: 'text', value: '' }
    ]
    error.value = ''
    return
  }

  isEdit.value = true
  rkey.value = queryRkey
  loading.value = true
  error.value = ''
  
  try {
    const actor = auth.user.did || auth.user.handle
    const uri = `at://${actor}/xyz.atoblog.post/${queryRkey}`
    const { post } = await atproto.getPost(uri)
    
    title.value = post.record.title
    originalCreatedAt.value = post.record.createdAt
    tags.value = post.record.tags || []
    
    if (post.record.blocks) {
      blocks.value = post.record.blocks.map((b, index) => ({
        id: Date.now() + index,
        type: b.type,
        value: b.value || '',
        blob: b.blob || null,
        preview: b.type === 'image' ? getExistingImageUrl(post.author.did, b.blob) : ''
      }))
    } else {
      // Migration for legacy posts
      blocks.value = [
        { id: Date.now(), type: 'text', value: post.record.text || '' }
      ]
      if (post.record.image) {
        blocks.value.unshift({
          id: Date.now() - 1,
          type: 'image',
          blob: post.record.image,
          preview: getExistingImageUrl(post.author.did, post.record.image)
        })
      }
    }
  } catch (err) {
    error.value = 'Failed to load post for editing.'
    console.error(err)
  } finally {
    loading.value = false
  }
}

onMounted(loadPost)
watch(() => route.query.rkey, loadPost)

const getExistingImageUrl = (did, blob) => {
  if (!blob) return ''
  const cid = blob.ref.$link || blob.ref
  const ext = blob.mimeType.split('/').pop()
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@${ext}`
}

const addTextBlock = (index) => {
  blocks.value.splice(index + 1, 0, { id: Date.now(), type: 'text', value: '' })
}

const addImageBlock = (index) => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    blocks.value.splice(index + 1, 0, {
      id: Date.now(),
      type: 'image',
      file: file,
      preview: URL.createObjectURL(file)
    })
  }
  input.click()
}

const removeBlock = (index) => {
  if (blocks.value.length > 1) {
    blocks.value.splice(index, 1)
  } else {
    blocks.value[0] = { id: Date.now(), type: 'text', value: '' }
  }
}

const moveBlock = (index, direction) => {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= blocks.value.length) return
  const temp = blocks.value[index]
  blocks.value[index] = blocks.value[newIndex]
  blocks.value[newIndex] = temp
}

const addTag = (e) => {
  if (e && (e.key === ' ' || e.key === ',')) {
    e.preventDefault()
  }
  const tag = tagInput.value.trim().replace(/,$/, '').toLowerCase()
  if (tag && !tags.value.includes(tag)) {
    tags.value.push(tag)
  }
  tagInput.value = ''
}

const removeTag = (tag) => {
  tags.value = tags.value.filter(t => t !== tag)
}

const lastFocusedIndex = ref(0)

const handlePaste = (e) => {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile()
      if (file) {
        // Insert after the last focused block or at the end
        const insertIndex = lastFocusedIndex.value + 1
        blocks.value.splice(insertIndex, 0, {
          id: Date.now(),
          type: 'image',
          file: file,
          preview: URL.createObjectURL(file)
        })
      }
    }
  }
}

const handlePublish = async () => {
  if (!title.value.trim()) {
    error.value = 'Please enter a title.'
    return
  }
  
  loading.value = true
  error.value = ''
  
  try {
    const finalBlocks = []
    
    for (const block of blocks.value) {
      if (block.type === 'text') {
        if (block.value.trim()) {
          finalBlocks.push({ type: 'text', value: block.value })
        }
      } else if (block.type === 'image') {
        if (block.file) {
          const blob = await atproto.uploadBlob(block.file)
          finalBlocks.push({ type: 'image', blob: blob })
        } else if (block.blob) {
          finalBlocks.push({ type: 'image', blob: block.blob })
        }
      }
    }
    
    if (finalBlocks.length === 0) {
      error.value = 'Please add some content to your story.'
      loading.value = false
      return
    }

    if (isEdit.value) {
      // Collect existing URIs
      const { post } = await atproto.getPost(`at://${auth.user.handle}/xyz.atoblog.post/${rkey.value}`)
      const uris = post.record.blueskyUris || []
      if (post.record.blueskyUri && !uris.includes(post.record.blueskyUri)) {
          uris.push(post.record.blueskyUri)
      }

      await atproto.updatePost(
        rkey.value,
        title.value,
        finalBlocks,
        originalCreatedAt.value,
        uris,
        tags.value
      )
    } else {
      await atproto.createPost(title.value, finalBlocks, tags.value)
    }
    router.push('/')
  } catch (err) {
    if (err.status === 401 || err.message?.includes('Authentication')) {
      error.value = 'Your session has expired. Please log in again to publish your story.'
      auth.user = null
    } else {
      error.value = `Failed to ${isEdit.value ? 'update' : 'publish'} post. ${err.message}`
    }
    console.error(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-row justify="center" class="py-12 bg-white min-h-screen">
    <v-col cols="12" md="10" lg="8" class="editor-col" @paste="handlePaste">
      <div class="d-flex align-center mb-12">
        <v-btn to="/" icon="mdi-close" variant="text" class="mr-4"></v-btn>
        <span class="text-subtitle-1 text-secondary">{{ isEdit ? 'Edit Draft' : 'Draft' }}</span>
        <v-spacer></v-spacer>
        <v-btn
          color="success"
          flat
          class="rounded-pill px-6 font-weight-bold"
          :loading="loading"
          :disabled="!title.trim() || loading"
          @click="handlePublish"
        >
          Publish
        </v-btn>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" class="mb-8 rounded-lg">
        <div class="d-flex align-center">
          <span>{{ error }}</span>
          <v-spacer></v-spacer>
          <v-btn v-if="error.includes('log in again')" to="/login" color="error" variant="flat" size="small" class="rounded-pill ml-4">Go to Login</v-btn>
        </div>
      </v-alert>

      <v-text-field
        v-model="title"
        placeholder="Title"
        variant="plain"
        class="title-input mb-2"
        :disabled="loading"
        hide-details
      ></v-text-field>

      <div class="tags-input-container mb-12">
        <div class="d-flex flex-wrap ga-3 mb-3">
          <v-fade-transition group>
            <v-chip
              v-for="tag in tags"
              :key="tag"
              closable
              size="small"
              variant="flat"
              color="grey-lighten-4"
              class="tag-pill text-secondary text-uppercase font-weight-bold px-3"
              style="letter-spacing: 0.05em; font-size: 0.7rem;"
              @click:close="removeTag(tag)"
            >
              {{ tag }}
            </v-chip>
          </v-fade-transition>
        </div>
        <v-text-field
          v-model="tagInput"
          placeholder="Add a tag..."
          variant="plain"
          density="compact"
          hide-details
          class="tag-field"
          @keydown.enter.prevent="addTag"
          @keydown.space="addTag"
          @keydown.comma="addTag"
          @blur="addTag"
        ></v-text-field>
      </div>

      <div class="blocks-container">
        <div v-for="(block, index) in blocks" :key="block.id" class="block-wrapper mb-4">
          <div class="d-flex align-start">
            <!-- side control -->
            <div class="side-controls d-flex flex-column align-center mr-4">
               <v-btn icon="mdi-plus-circle-outline" variant="text" size="small" color="secondary" @click="addTextBlock(index)" title="Add Text"></v-btn>
               <v-btn icon="mdi-camera-outline" variant="text" size="small" color="secondary" @click="addImageBlock(index)" title="Add Image"></v-btn>
               <v-divider class="my-1 w-50"></v-divider>
               <v-btn v-if="index > 0" icon="mdi-chevron-up" variant="text" size="small" color="secondary" @click="moveBlock(index, -1)" title="Move Up"></v-btn>
               <v-btn v-if="index < blocks.length - 1" icon="mdi-chevron-down" variant="text" size="small" color="secondary" @click="moveBlock(index, 1)" title="Move Down"></v-btn>
               <v-btn icon="mdi-trash-can-outline" variant="text" size="small" color="error" class="opacity-60" @click="removeBlock(index)" title="Remove Block"></v-btn>
            </div>

            <div class="flex-grow-1">
              <v-textarea
                v-if="block.type === 'text'"
                v-model="block.value"
                placeholder="Tell your story..."
                variant="plain"
                auto-grow
                rows="1"
                class="text-block-input text-serif"
                :disabled="loading"
                hide-details
                @focus="lastFocusedIndex = index"
              ></v-textarea>
              
              <div v-if="block.type === 'image' && block.preview" class="image-block-container position-relative mb-6">
                <v-img :src="block.preview" max-height="800" class="rounded-sm bg-grey-lighten-4 mx-auto"></v-img>
                <div class="image-overlay d-flex align-center justify-center">
                  <v-btn icon="mdi-close" color="white" variant="flat" size="small" class="rounded-pill" @click="removeBlock(index)"></v-btn>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </v-col>
  </v-row>
</template>

<style scoped>
.editor-col {
  max-width: 720px !important;
}

.title-input :deep(input) {
  font-size: 3rem !important;
  font-weight: 800 !important;
  line-height: 1.2 !important;
  color: #242424 !important;
  font-family: var(--medium-font-sans) !important;
}

.title-input :deep(input)::placeholder {
  color: #B3B3B1 !important;
}

.text-block-input :deep(textarea) {
  font-size: 1.3rem !important;
  line-height: 1.6 !important;
  font-weight: 400 !important;
  color: #242424 !important;
}

.text-block-input :deep(textarea)::placeholder {
  color: #B3B3B1 !important;
}

.block-wrapper {
  position: relative;
}

.side-controls {
  opacity: 0;
  transition: opacity 0.2s ease;
  width: 40px;
}

.block-wrapper:hover .side-controls {
  opacity: 0.6;
}

.side-controls:hover {
  opacity: 1 !important;
}

.image-block-container:hover .image-overlay {
  opacity: 1;
}

.image-overlay {
  position: absolute;
  top: 10px;
  right: 10px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.tags-input-container {
  display: flex;
  flex-direction: column;
}

.tag-field :deep(input) {
  font-size: 1rem !important;
  color: #6B6B6B !important;
  padding-left: 0 !important;
}

.tag-field :deep(.v-field__outline) {
  display: none;
}

.tag-pill {
  font-weight: 600 !important;
  letter-spacing: 0.02em;
}

.min-height-screen {
  min-height: 100vh;
}
</style>
