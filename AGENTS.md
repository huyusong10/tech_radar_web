# AGENTS.md - Tech Radar Weekly Project Guidelines

## Build Commands
- `npm start`: Starts development server (port 5090) with hot reload via chokidar
- `npm run build`: Build assets (requires esbuild integration; no script currently, add to package.json)
- `node server.js`: Manual server start (development only)

## Linting & Code Style
- **No configured linter** (no eslint in dependencies). Follow existing code conventions:
  - 2-space indentation (no tabs)
  - Consistent `const`/`let` usage (no `var`)
  - Avoid global variables (e.g., `window.foo`)
  - Async operations must use `async/await` or `.then()` with error handling
  - Error messages must explain context (`try/catch` required for critical paths)

## Testing
- **No test framework configured**. To add:
  ```bash
  npm install --save-dev jest
  ```
  Add to `package.json`:
  ```json
  "scripts": {
    "test": "jest"
  }
  ```
- **Run single test**:
  ```bash
  npm test -- <test-file>
  ```

## Documentation Conventions
- **Markdown Frontmatter**: Always use two `---`:
  ```yaml
  ---
  vol: "002"
  date: "2024.05.20"
  authors:
    - id: "huyusong"
  ---
  ```
- **Code Blocks**: Specify language identifier:
  ```markdown
  ```javascript
  // code
  ```
  ```

## Project-Specific Rules
- **File Path Structure**:
  - `contents/published/vol-XXX/radar.md`
  - `contents/draft/vol-XXX/` (for preview)
- **Security**:
  - Never commit secrets (use environment variables)
  - All API routes are protected by rate limiting (240/min read)
- **Performance**:
  - Keep code blocks <30 lines
  - Images <500KB
  - Avoid `file://` URLs (CORS restrictions)

## Tools & Integrations
- **Hot Reload**: Server monitors `contents/` via chokidar
- **SSE**: Live updates via `/api/hot-reload` stream
- **Markdown**: Parse with `marked@11.1.1`
- **YAML**: Parse with `js-yaml@4.1.0`

## Cursor/Copilot Rules
- **No `.cursor/rules` or `.github/copilot-instructions.md` found**. When added:
  - Align with Express.js conventions
  - Match Markdown frontmatter patterns
  - Preserve code block language identifiers

## Critical Notes
1. **Browser Support**:
   Chrome 90+, Firefox 88+, Edge 90+
2. **Never** add `--no-verify` to `git commit`
3. **Always** use `async/await` for database operations
4. **Avoid** inline CSS; use CSS variables (e.g., `--accent-cyan`)
5. **File Names**:
   - Use `kebab-case` (e.g., `01-architecture.md`)
   - No spaces or special characters

## Existing Tools
- `express@4.18.2`: Server framework
- `chokidar@3.5.3`: File watcher
- `highlight.js@11.9.0`: Code highlighting (Tokyo Night Dark)
- `Marked.js@11.1.1`: Markdown parser