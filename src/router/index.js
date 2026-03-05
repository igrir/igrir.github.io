import { createRouter, createWebHistory } from 'vue-router'
import FeedView from '../views/FeedView.vue'

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        {
            path: '/',
            name: 'feed',
            component: FeedView,
        },
        {
            path: '/p/:rkey',
            name: 'post-detail-owner',
            component: () => import('../views/PostDetailView.vue'),
        },
        {
            path: '/post/:repo/:rkey',
            name: 'post-detail',
            component: () => import('../views/PostDetailView.vue'),
        },
        // profile-specific feed (view all posts by a given handle)
        {
            path: '/post/:repo',
            name: 'user-feed',
            component: FeedView,
        },
        {
            path: '/new-post',
            name: 'new-post',
            component: () => import('../views/CreatePostView.vue'),
        },
        {
            path: '/login',
            name: 'login',
            component: () => import('../views/LoginView.vue'),
        },
        {
            path: '/settings',
            name: 'settings',
            component: () => import('../views/SettingsView.vue'),
        },
    ],
})

export default router
