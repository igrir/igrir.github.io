import axios from 'axios';

const CLIENT_ID = import.meta.env.VITE_IGDB_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_IGDB_CLIENT_SECRET;

let accessToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpiry) {
        return accessToken;
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
        console.error('[IGDB] Missing VITE_IGDB_CLIENT_ID or VITE_IGDB_CLIENT_SECRET in .env');
        return null;
    }

    try {
        console.log('[IGDB] Requesting new access token...');
        // Use URLSearchParams for clean encoding
        const params = new URLSearchParams();
        params.append('client_id', CLIENT_ID);
        params.append('client_secret', CLIENT_SECRET);
        params.append('grant_type', 'client_credentials');

        const response = await axios.post('/api/twitch/oauth2/token', params);

        accessToken = response.data.access_token;
        tokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000;
        console.log('[IGDB] New access token acquired.');
        return accessToken;
    } catch (error: any) {
        console.error('[IGDB] Error fetching access token:', error.response?.data || error.message);
        return null;
    }
}

export interface IGDBGame {
    id: number;
    name: string;
    first_release_date?: number;
    platforms?: { name: string }[];
    cover?: { url: string };
    summary?: string;
    url?: string;
}

export const searchGames = async (query: string): Promise<IGDBGame[]> => {
    const token = await getAccessToken();
    if (!token) {
        console.error('[IGDB] Cannot search without access token.');
        return [];
    }

    try {
        const escapedQuery = query.replace(/"/g, '\\"');
        console.log(`[IGDB] Searching for: "${escapedQuery}"`);
        const response = await axios.post(
            '/api/igdb/v4/games',
            `search "${escapedQuery}"; fields name, first_release_date, platforms.name, cover.url, summary, url; limit 10;`,
            {
                headers: {
                    'Client-ID': CLIENT_ID,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'text/plain',
                },
            }
        );

        console.log(`[IGDB] Found ${response.data.length} results.`);
        return response.data;
    } catch (error: any) {
        console.error('[IGDB] Search error:', error.response?.data || error.message);
        return [];
    }
};

export const formatCoverUrl = (url: string | undefined) => {
    if (!url) return '';
    // Convert thumb to cover_big or 720p
    return 'https:' + url.replace('t_thumb', 't_cover_big');
};
