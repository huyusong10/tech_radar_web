/**
 * Site Configuration
 *
 * This file defines the content directory paths for the Tech Radar site.
 * Modify these paths to point to your content location.
 *
 * Content and code are separated - you can:
 * 1. Keep content in a different repository
 * 2. Use symlinks to point to external content
 * 3. Change paths without modifying application code
 */

const config = {
    // Main content directory (published content)
    contentDir: './content',

    // Draft content directory (pre-publication preview)
    draftContentDir: './content-draft',

    // Shared resources directory (authors, config, submit-guide)
    sharedDir: './shared',

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
