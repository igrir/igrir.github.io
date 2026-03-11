import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

/**
 * Simple .env parser to avoid extra dependencies
 */
const getEnvVar = (name) => {
  // Priority 1: System environment variables (Netlify/CI)
  if (process.env[name]) return process.env[name];
  
  // Priority 2: .env file
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const lines = envContent.split(/\r?\n/);
    for (const line of lines) {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (key === name) return value;
      }
    }
  }
  return null;
};

// Determine base URL
let baseUrl = getEnvVar('VITE_BASE_URL') || 'http://127.0.0.1:5173';

// Ensure protocol
if (!baseUrl.startsWith('http')) {
    baseUrl = 'https://' + baseUrl;
}

// Normalize trailing slash
const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

const metadata = {
    client_id: `${normalizedBaseUrl}/client-metadata.json`,
    client_name: "Brot!",
    client_uri: normalizedBaseUrl,
    logo_uri: `${normalizedBaseUrl}/blogat.png`,
    redirect_uris: [
        `${normalizedBaseUrl}/`
    ],
    scope: "atproto transition:generic repo:xyz.atoblog.settings repo:xyz.atoblog.post",
    grant_types: [
        "authorization_code",
        "refresh_token"
    ],
    response_types: [
        "code"
    ],
    token_endpoint_auth_method: "none",
    application_type: "native",
    dpop_bound_access_tokens: true
};

const outputPath = path.resolve(__dirname, '../public/client-metadata.json');

// Ensure directory exists
const publicDir = path.dirname(outputPath);
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2));
console.log(`Successfully generated client-metadata.json for: ${normalizedBaseUrl}`);
