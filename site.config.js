/**
 * Site Configuration
 *
 * Configure the contents directory path. The directory should follow
 * the standardized structure:
 *
 * contents/
 * ├── published/          # Published volumes (vol-001, vol-002, ...)
 * ├── draft/              # Draft volumes for preview
 * ├── shared/             # Shared config (authors.md, config.md, submit-guide.md)
 * ├── assets/             # Static assets (images, avatars, etc.)
 * └── data/               # Runtime data (likes.json, views.json)
 *
 * You can use relative or absolute paths.
 * Example: contentsDir: '/data/my-team/tech-radar-contents'
 *
 * When upgrading code, your contents directory (with all data) remains untouched.
 */

const config = {
    // Contents directory (contains published/, draft/, shared/, assets/, data/)
    contentsDir: './contents',

    // Server configuration
    server: {
        port: 5090,
        // Set to true when behind a reverse proxy (nginx, cloudflare, etc.)
        // This enables reading client IP from X-Forwarded-For and X-Real-IP headers
        trustProxy: true
    }
};

// For Node.js (server.js)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = config;
}

// For browser (will be loaded via script tag or API)
if (typeof window !== 'undefined') {
    window.SITE_CONFIG = config;
}
