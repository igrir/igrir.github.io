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
const isDraft = ref(false)

const loadPost = async () => {
  const queryRkey = route.query.rkey
  
  if (!queryRkey) {
    // Reset for new post
    isEdit.value = false
    rkey.value = ''
    title.value = ''
    tags.value = []
    tagInput.value = ''
    isDraft.value = false
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
    isDraft.value = !!post.record.isDraft
    
    if (post.record.blocks) {
      blocks.value = post.record.blocks.map((b, index) => ({
        id: Date.now() + index,
        type: b.type,
        value: b.value || '',
        blob: b.blob || null,
        language: b.language || 'javascript',
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

const addQuoteBlock = (index) => {
  blocks.value.splice(index + 1, 0, { id: Date.now(), type: 'quote', value: '' })
}

const addCodeBlock = (index) => {
  blocks.value.splice(index + 1, 0, { id: Date.now(), type: 'code', value: '', language: 'javascript' })
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

const handleTab = (e, block) => {
  const el = e.target
  const start = el.selectionStart
  const end = el.selectionEnd
  const value = block.value

  // Use 2 spaces for tab
  block.value = value.substring(0, start) + '  ' + value.substring(end)

  // Put caret at right position again (next tick)
  setTimeout(() => {
    el.selectionStart = el.selectionEnd = start + 2
  }, 0)
}

const wrapText = (e, block, wrapStr) => {
  const el = e.target
  const start = el.selectionStart
  const end = el.selectionEnd
  const value = block.value
  
  if (start !== end) {
    const selectedText = value.substring(start, end)
    block.value = value.substring(0, start) + wrapStr + selectedText + wrapStr + value.substring(end)
    setTimeout(() => {
      el.selectionStart = start + wrapStr.length
      el.selectionEnd = end + wrapStr.length
      el.focus()
    }, 0)
  } else {
    block.value = value.substring(0, start) + wrapStr + wrapStr + value.substring(end)
    setTimeout(() => {
      el.selectionStart = start + wrapStr.length
      el.selectionEnd = start + wrapStr.length
      el.focus()
    }, 0)
  }
}

const applyFormat = (e, block, wrapStr, index) => {
  const wrappers = document.querySelectorAll('.block-wrapper')
  if (wrappers[index]) {
    const el = wrappers[index].querySelector('textarea')
    if (el) {
      const start = el.selectionStart
      const end = el.selectionEnd
      const value = block.value
      
      if (start !== end) {
        const selectedText = value.substring(start, end)
        block.value = value.substring(0, start) + wrapStr + selectedText + wrapStr + value.substring(end)
        setTimeout(() => {
          el.selectionStart = start + wrapStr.length
          el.selectionEnd = end + wrapStr.length
          el.focus()
        }, 0)
      } else {
        block.value = value.substring(0, start) + wrapStr + wrapStr + value.substring(end)
        setTimeout(() => {
          el.selectionStart = start + wrapStr.length
          el.selectionEnd = start + wrapStr.length
          el.focus()
        }, 0)
      }
    }
  }
}

const applyPrefixFormat = (e, block, prefixStr, index) => {
  const wrappers = document.querySelectorAll('.block-wrapper')
  if (wrappers[index]) {
    const el = wrappers[index].querySelector('textarea')
    if (el) {
      const start = el.selectionStart
      const end = el.selectionEnd
      const value = block.value
      
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      
      block.value = value.substring(0, lineStart) + prefixStr + value.substring(lineStart)
      setTimeout(() => {
        el.selectionStart = start + prefixStr.length
        el.selectionEnd = end + prefixStr.length
        el.focus()
      }, 0)
    }
  }
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

const lastFocusedIndex = ref(0) // keep this for paste handling

const formatToolbar = ref({
  visible: false,
  top: 0,
  left: 0,
  blockIndex: -1,
  showLinkInput: false,
  linkUrl: ''
})

const checkSelection = (e, index) => {
  const el = e.target
  setTimeout(() => {
    if (el && el.selectionStart !== el.selectionEnd) {
      const rect = el.getBoundingClientRect()
      let top = rect.top - 45
      let left = rect.left + (rect.width / 2) - 80
      
      if (e.type === 'mouseup') {
        top = e.clientY - 55
        left = e.clientX - 80
      }
      
      if (!formatToolbar.value.visible || formatToolbar.value.blockIndex !== index || !formatToolbar.value.showLinkInput) {
        formatToolbar.value = {
          visible: true,
          top,
          left,
          blockIndex: index,
          showLinkInput: false,
          linkUrl: ''
        }
      }
    } else {
      setTimeout(() => {
        if (!formatToolbar.value.showLinkInput) {
          formatToolbar.value.visible = false
        }
      }, 150)
    }
  }, 10)
}

const handleToolbarFormat = (wrapStr) => {
  const index = formatToolbar.value.blockIndex
  if (index >= 0 && blocks.value[index]) {
    applyFormat(null, blocks.value[index], wrapStr, index)
    formatToolbar.value.visible = false
  }
}

const handleToolbarPrefix = (prefixStr) => {
  const index = formatToolbar.value.blockIndex
  if (index >= 0 && blocks.value[index]) {
    applyPrefixFormat(null, blocks.value[index], prefixStr, index)
    formatToolbar.value.visible = false
  }
}

const handleToolbarLink = () => {
  formatToolbar.value.showLinkInput = true
  formatToolbar.value.linkUrl = ''
  setTimeout(() => {
    const input = document.getElementById('toolbar-link-input')
    if (input) input.focus()
  }, 50)
}

const applyLink = () => {
  const index = formatToolbar.value.blockIndex
  const url = formatToolbar.value.linkUrl || 'https://'
  if (index >= 0 && blocks.value[index]) {
    const wrappers = document.querySelectorAll('.block-wrapper')
    if (wrappers[index]) {
      const el = wrappers[index].querySelector('textarea')
      if (el) {
        const start = el.selectionStart
        const end = el.selectionEnd
        const value = blocks.value[index].value
        
        if (start !== end) {
          const selectedText = value.substring(start, end)
          blocks.value[index].value = value.substring(0, start) + `[${selectedText}](${url})` + value.substring(end)
          setTimeout(() => {
            const newPos = start + selectedText.length + url.length + 4
            el.selectionStart = newPos
            el.selectionEnd = newPos
            el.focus()
          }, 0)
        } else {
          blocks.value[index].value = value.substring(0, start) + `[text](${url})` + value.substring(end)
          setTimeout(() => {
            el.selectionStart = start + 1
            el.selectionEnd = start + 5
            el.focus()
          }, 0)
        }
      }
    }
  }
  formatToolbar.value.visible = false
  formatToolbar.value.showLinkInput = false
}

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

const handlePublish = async (saveAsDraft = false) => {
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
      } else if (block.type === 'quote') {
        if (block.value.trim()) {
          finalBlocks.push({ type: 'quote', value: block.value })
        }
      } else if (block.type === 'code') {
        if (block.value.trim()) {
          finalBlocks.push({ 
            type: 'code', 
            value: block.value, 
            language: block.language || 'javascript' 
          })
        }
      }
    }
    
    if (finalBlocks.length === 0) {
      error.value = 'Please add some content to your story.'
      loading.value = false
      return
    }

    let publishedRkey = rkey.value
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
        tags.value,
        saveAsDraft
      )
    } else {
      const response = await atproto.createPost(title.value, finalBlocks, tags.value, saveAsDraft)
      // Extract rkey from uri (at://did:plc:xxx/collection/rkey)
      publishedRkey = response.data.uri.split('/').pop()
    }
    
    // Redirect to the post detail page
    router.push({ 
      name: 'post-detail', 
      params: { 
        repo: auth.user.handle, 
        rkey: publishedRkey 
      } 
    })
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
    <div v-if="formatToolbar.visible" class="format-toolbar-floating" :style="{ top: formatToolbar.top + 'px', left: formatToolbar.left + 'px' }" @mousedown.stop>
      <template v-if="!formatToolbar.showLinkInput">
        <v-btn icon="mdi-format-bold" variant="text" size="small" color="white" @mousedown.prevent="handleToolbarFormat('**')" title="Bold (Ctrl+B)"></v-btn>
        <v-btn icon="mdi-format-italic" variant="text" size="small" color="white" @mousedown.prevent="handleToolbarFormat('*')" title="Italic (Ctrl+I)"></v-btn>
        <v-btn icon="mdi-format-underline" variant="text" size="small" color="white" @mousedown.prevent="handleToolbarFormat('__')" title="Underline (Ctrl+U)"></v-btn>
        <v-btn icon="mdi-format-strikethrough" variant="text" size="small" color="white" @mousedown.prevent="handleToolbarFormat('~~')" title="Strikethrough"></v-btn>
        <v-btn icon="mdi-format-quote-open" variant="text" size="small" color="white" @mousedown.prevent="handleToolbarPrefix('> ')" title="Blockquote"></v-btn>
        <div class="mx-1 my-auto" style="height: 16px; width: 1px; background-color: rgba(255,255,255,0.2);"></div>
        <v-btn icon="mdi-link" variant="text" size="small" color="white" @mousedown.prevent="handleToolbarLink" title="Add Link"></v-btn>
      </template>
      <template v-else>
        <div class="d-flex align-center px-2 py-1" style="min-width: 250px;">
          <input 
            id="toolbar-link-input"
            v-model="formatToolbar.linkUrl" 
            type="text" 
            class="link-input w-100 mr-2" 
            placeholder="Paste or type a link..."
            @keydown.enter.prevent="applyLink"
            @keydown.esc.prevent="formatToolbar.showLinkInput = false"
          />
          <v-btn icon="mdi-close" variant="text" size="x-small" color="white" class="opacity-70" @mousedown.prevent="formatToolbar.showLinkInput = false"></v-btn>
        </div>
      </template>
    </div>
    <v-col cols="12" md="10" lg="8" class="editor-col" @paste="handlePaste">
      <div class="d-flex align-center mb-12" style="gap: 16px;">
        <v-btn 
          :to="isEdit ? { name: 'post-detail', params: { repo: auth.user?.handle, rkey: rkey } } : '/'" 
          icon="mdi-close" 
          variant="text" 
        ></v-btn>
        <span class="text-subtitle-1 text-secondary mb-0">{{ isEdit ? 'Edit Draft' : 'Draft' }}</span>
        <v-spacer></v-spacer>
        <v-btn
          color="secondary"
          variant="outlined"
          class="rounded-pill px-5"
          :loading="loading"
          :disabled="!title.trim() || loading"
          @click="handlePublish(true)"
        >
          Save Draft
        </v-btn>
        <v-btn
          color="success"
          flat
          class="rounded-pill px-6 font-weight-bold"
          :loading="loading"
          :disabled="!title.trim() || loading"
          @click="handlePublish(false)"
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
              :closable="!loading"
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
          :disabled="loading"
          @keydown.enter.prevent="addTag"
          @keydown.space="addTag"
          @keydown.comma="addTag"
          @blur="addTag"
        ></v-text-field>
      </div>

      <div class="blocks-container">
        <div v-for="(block, index) in blocks" :key="block.id" class="block-wrapper mb-8">
          <div class="d-flex align-start position-relative">
            <!-- Left Side Controls (Move/Delete) -->
            <div class="side-controls d-flex flex-column align-center mr-4">
              <v-btn v-if="index > 0" icon="mdi-chevron-up" variant="text" size="x-small" color="secondary" class="mb-1" @click="moveBlock(index, -1)" title="Move Up" :disabled="loading"></v-btn>
              <v-btn v-if="index < blocks.length - 1" icon="mdi-chevron-down" variant="text" size="x-small" color="secondary" class="mb-1" @click="moveBlock(index, 1)" title="Move Down" :disabled="loading"></v-btn>
              <v-btn icon="mdi-trash-can-outline" variant="text" size="x-small" color="error" class="opacity-60" @click="removeBlock(index)" title="Remove Block" :disabled="loading"></v-btn>
            </div>

            <div class="flex-grow-1">
              <div class="block-content-area">
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
                  @mouseup="checkSelection($event, index)"
                  @keyup="checkSelection($event, index)"
                  @blur="formatToolbar.showLinkInput ? null : (formatToolbar.visible = false)"
                  @keydown.tab.prevent="handleTab($event, block)"
                  @keydown.meta.b.prevent="wrapText($event, block, '**')"
                  @keydown.ctrl.b.prevent="wrapText($event, block, '**')"
                  @keydown.meta.i.prevent="wrapText($event, block, '*')"
                  @keydown.ctrl.i.prevent="wrapText($event, block, '*')"
                  @keydown.meta.u.prevent="wrapText($event, block, '__')"
                  @keydown.ctrl.u.prevent="wrapText($event, block, '__')"
                ></v-textarea>
                
                <v-textarea
                  v-if="block.type === 'quote'"
                  v-model="block.value"
                  placeholder="Enter a quote..."
                  variant="plain"
                  auto-grow
                  rows="1"
                  class="quote-block-input text-serif"
                  :disabled="loading"
                  hide-details
                  @keydown.tab.prevent="handleTab($event, block)"
                ></v-textarea>

                <div v-if="block.type === 'code'" class="code-block-editor position-relative">
                  <v-select
                    v-model="block.language"
                    :items="['javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'csharp', 'gdscript']"
                    density="compact"
                    variant="plain"
                    class="code-lang-selector"
                    :disabled="loading"
                    hide-details
                  ></v-select>
                  <v-textarea
                    v-model="block.value"
                    placeholder="Paste your code here..."
                    variant="plain"
                    auto-grow
                    rows="2"
                    class="code-block-input font-mono"
                    :disabled="loading"
                    hide-details
                    @keydown.tab.prevent="handleTab($event, block)"
                  ></v-textarea>
                </div>
                
                <div v-if="block.type === 'image' && block.preview" class="image-block-container position-relative mb-2">
                  <v-img :src="block.preview" max-height="800" class="rounded-sm bg-grey-lighten-4 mx-auto"></v-img>
                  <div class="image-overlay d-flex align-center justify-center">
                    <v-btn icon="mdi-close" color="white" variant="flat" size="small" class="rounded-pill" @click="removeBlock(index)" :disabled="loading"></v-btn>
                  </div>
                </div>
              </div>

              <!-- Bottom Add Content Bar -->
              <div class="add-content-bar d-flex align-center justify-center mt-2">
                <div class="add-buttons-container d-flex align-center ga-2">
                  <v-btn icon="mdi-plus" variant="text" size="x-small" color="secondary" class="add-btn" @click="addTextBlock(index)" title="Add Text" :disabled="loading"></v-btn>
                  <v-btn icon="mdi-format-quote-close" variant="text" size="x-small" color="secondary" class="add-btn" @click="addQuoteBlock(index)" title="Add Quote" :disabled="loading"></v-btn>
                  <v-btn icon="mdi-code-tags" variant="text" size="x-small" color="secondary" class="add-btn" @click="addCodeBlock(index)" title="Add Code" :disabled="loading"></v-btn>
                  <v-btn icon="mdi-camera-plus-outline" variant="text" size="x-small" color="secondary" class="add-btn" @click="addImageBlock(index)" title="Add Image" :disabled="loading"></v-btn>
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

.quote-block-input :deep(textarea) {
  font-size: 1.8rem !important;
  line-height: 1.4 !important;
  font-weight: 400 !important;
  font-style: italic !important;
  color: #242424 !important;
  border-left: 3px solid #242424 !important;
  padding-left: 24px !important;
}

.quote-block-input :deep(textarea)::placeholder {
  color: #B3B3B1 !important;
}

.code-block-editor {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.code-lang-selector {
  width: 120px;
  position: absolute;
  top: 4px;
  right: 12px;
  z-index: 10;
}

.code-lang-selector :deep(.v-field__input) {
  font-size: 0.75rem !important;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #6B6B6B !important;
  min-height: 32px !important;
}

.code-block-input :deep(textarea) {
  font-family: 'Fira Code', 'Roboto Mono', monospace !important;
  font-size: 0.95rem !important;
  line-height: 1.5 !important;
  color: #242424 !important;
  padding-top: 24px !important;
}

.code-block-input :deep(textarea)::placeholder {
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

.add-content-bar {
  position: relative;
  opacity: 0;
  transition: opacity 0.2s ease;
  height: 32px;
  margin-bottom: -16px;
  z-index: 100;
}

.block-wrapper:hover {
  z-index: 10;
}

.block-wrapper:hover .add-content-bar {
  opacity: 0.6;
}

.add-content-bar:hover {
  opacity: 1 !important;
}

.add-buttons-container {
  background: #FFFFFF;
  padding: 2px 12px;
  border-radius: 24px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.add-btn {
  opacity: 0.7;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.add-btn:hover {
  opacity: 1;
  transform: scale(1.1);
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

.block-content-area {
  position: relative;
}

.format-toolbar-floating {
  position: fixed;
  background: #242424;
  border-radius: 8px;
  padding: 4px;
  display: flex;
  gap: 2px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  z-index: 1000;
  transform: translateY(-5px);
  animation: fadeUp 0.15s ease-out forwards;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(0); }
  to { opacity: 1; transform: translateY(-5px); }
}

.format-toolbar-floating .v-btn {
  opacity: 0.8;
}

.format-toolbar-floating .v-btn:hover {
  opacity: 1;
}

.link-input {
  background: transparent;
  border: none;
  outline: none;
  color: white;
  font-size: 0.9rem;
  padding: 4px 8px;
}

.link-input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}
</style>
