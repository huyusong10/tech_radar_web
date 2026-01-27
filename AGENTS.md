# AGENTS.md - Tech Radar Weekly Agent Guide

Essential information for AI agents working on the Tech Radar Weekly project.

## Project Overview

Cyberpunk-style tech newsletter SPA with content-presentation separation. All content in Markdown, dynamically loaded.

**Core Stack:**
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (no frameworks)
- **Markdown**: Marked.js, js-yaml, Highlight.js
- **Server**: Node.js + Express (optional)
- **Fonts**: Inter, JetBrains Mono

## Cursor and Copilot Rules

No `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` files found in the repository. Follow the conventions in this guide and CLAUDE.md.

## Build, Lint, and Test Commands

### Package Scripts
```bash
npm start          # Start Node.js server (port 5090)
```

### Development Servers (Static)
```bash
python3 -m http.server 8000
npx serve
php -S localhost:8000
```

### Linting and Formatting
*Not configured.* Suggested:
```bash
npm install --save-dev eslint prettier
npm run lint      # Would run ESLint
npm run format    # Would run Prettier
```

### Testing
*Not configured.* Suggested:
```bash
npm install --save-dev jest
npm test          # Run all tests
npm test -- --testNamePattern="pattern"  # Run single test (Jest)
npm test -- --watch  # Watch mode
```

## Code Style Guidelines

### General Principles
- Vanilla JavaScript, no frameworks unless necessary
- Modern ES6+: async/await, arrow functions, classes, destructuring
- Always use try-catch for async operations
- Avoid global pollution (use IIFEs/modules)
- Implement caching, debouncing, request deduplication

### JavaScript Conventions

#### Imports/Exports
```javascript
// Server (CommonJS)
const express = require('express');
// Client (ES modules)
import { parseFrontmatter } from './utils.js';
```

#### Naming
- Variables: `camelCase` (`currentVol`, `archiveList`)
- Constants: `UPPER_SNAKE_CASE` (`CONFIG`, `MAX_RETRIES`)
- Classes: `PascalCase` (`Cache`, `AsyncMutex`)
- Functions: `camelCase`, descriptive (`fetchWithRetry`, `loadMarkdown`)
- Private members: Prefix `_` (`_internalMethod()`)

#### Error Handling
```javascript
async function loadMarkdown(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Failed to load ${path}`);
        return await response.text();
    } catch (error) {
        console.error('Error loading markdown:', error);
        return null;
    }
}
```

#### Async/Await
```javascript
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fetch(url, options);
        } catch (error) {
            lastError = error;
            await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
        }
    }
    throw lastError || new Error('Max retries exceeded');
}
```

### HTML/CSS Conventions
- **HTML**: Semantic tags, accessibility attributes, responsive images with `srcset`
- **CSS**: Use CSS variables from `:root`, mobile-first responsive design, BEM-like naming optional
- **CSS Variables** (key ones):
  ```css
  --bg-primary: #0a0a0a; --bg-secondary: #151515; --bg-card: #1a1a1a;
  --accent-cyan: #00f3ff; --accent-pink: #ff00ff; --accent-green: #00ff88;
  --font-main: 'Inter', sans-serif; --font-mono: 'JetBrains Mono', monospace;
  ```

### Markdown Conventions
- **Frontmatter** (YAML at file start):
  ```markdown
  ---
  vol: "001"
  date: "2026.01.27"
  editors: [...]
  ---
  ```
- **Badge Categories**: Use `[分类]` in heading (maps to CSS classes):
  - `[架构决策]` → `.badge.architecture` (cyan)
  - `[债务预警]` → `.badge.debt` (orange)
  - `[工具推荐]` → `.badge.tool` (green)
  - `[安全更新]` → `.badge.security` (pink)
- **Code Blocks**: Always specify language identifier
- **Images**: Relative paths (`./diagram.svg`)

## File Structure

```
tech_radar_web/
├── index.html              # Dynamic loading version
├── server.js               # Node.js server (API, concurrency)
├── site.config.js          # Site configuration
├── package.json            # Dependencies and scripts
├── README.md, CLAUDE.md, AGENTS.md
├── contents/
│   ├── published/          # Published volumes (vol-001, vol-002...)
│   ├── draft/              # Draft volumes
│   ├── shared/             # Shared config (authors.md, config.md, submit-guide.md)
│   ├── assets/             # Static assets
│   └── data/               # Runtime data (likes.json, views.json)
└── node_modules/
```

## Development Workflow

### Adding a New Volume
1. `mkdir -p contents/published/vol-XXX/contributions`
2. `cp contents/published/vol-001/radar.md contents/published/vol-XXX/radar.md`
3. Edit `radar.md` frontmatter (`vol`, `date`, `editors`) and content
4. Create contribution articles in `contributions/`
5. `npm start` to regenerate `archive.json`

### Adding a New Badge Type
1. Add CSS in `index.html`:
   ```css
   .badge.newtype { background: rgba(R,G,B,0.2); color: var(--accent-color); }
   ```
2. Use `### [新类型] 标题内容` in Markdown.

### Adding New Authors
Edit `contents/shared/authors.md`:
```markdown
---
authors:
  - id: "username"
    name: "@display_name"
    team: "Team Name"
    avatar: "/assets/images/avatars/username.jpg"
    role: "Senior Developer"
---
```

## Important Constraints
- Must be served via HTTP server (no `file://`)
- File naming: numeric prefixes (`01-`, `02-`), lowercase with hyphens, no spaces
- Frontmatter must be at file beginning; YAML syntax strict
- Images < 500KB, code blocks < 30 lines, 2-6 contributions per volume

## Browser Compatibility
Chrome 90+, Firefox 88+, Safari 14+, Edge 90+. Requires CSS Grid, CSS Custom Properties, ES6+, Fetch API.

## Git Practices
- Concise, descriptive commit messages
- Ignored: `node_modules/`, `contents/data/`, auto-generated `archive.json`
- Main branch for stable releases

## Agent-Specific Notes
1. Read CLAUDE.md first for comprehensive understanding
2. Follow existing patterns in `server.js` and `index.html` JavaScript
3. Keep content in `contents/`, code in root
4. Test changes with both static server (`npx serve`) and Node server (`npm start`)
5. Verify responsive design on mobile and desktop

## Troubleshooting
- **Server not starting**: Check port 5090, verify `site.config.js`
- **Markdown not loading**: Ensure HTTP server running, check browser console
- **Styles not applying**: Verify CSS variables defined in `:root`
- **Archive not updating**: Restart server to regenerate `archive.json`

---

**Last Updated**: 2026.01.27  
**Based on**: CLAUDE.md, package.json, server.js, index.html