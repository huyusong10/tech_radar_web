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
 * └── assets/             # Static assets (images, avatars, etc.)
 *
 * You can use relative or absolute paths.
 */

const config = {
    // Contents directory (contains published/, draft/, shared/, assets/)
    contentsDir: './contents',

    // Server configuration
    server: {
        port: 5090
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
