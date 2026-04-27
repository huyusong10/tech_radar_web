const LOCAL_IMAGE_PATTERN = /(!\[[^\]]*]\()([^) \t]+)((?:\s+"[^"]*")?\))/g;

export function parseFrontmatter(raw) {
    const normalized = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

    if (!match) {
        return { metadata: {}, body: normalized };
    }

    return {
        metadata: globalThis.jsyaml?.load(match[1]) || {},
        body: match[2] || ''
    };
}

function isLocalReference(url) {
    if (!url || url.startsWith('#') || url.startsWith('/') || url.startsWith('//')) {
        return false;
    }
    return !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

function normalizeAssetPath(rawPath) {
    return String(rawPath || '')
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/^assets\//, '');
}

export function buildDraftAssetResolver(files = []) {
    const byPath = new Map();
    for (const file of files) {
        if (!file.assetUrl || file.path === 'index.md') continue;
        byPath.set(normalizeAssetPath(file.path), file.assetUrl);
        byPath.set(normalizeAssetPath(file.path).replace(/^assets\//, ''), file.assetUrl);
    }

    return rawPath => byPath.get(normalizeAssetPath(rawPath)) || rawPath;
}

export function buildLocalAssetResolver(files = []) {
    const byPath = new Map();
    for (const file of files) {
        if (!file.objectUrl || file.relativePath === 'index.md') continue;
        byPath.set(normalizeAssetPath(file.relativePath), file.objectUrl);
        byPath.set(normalizeAssetPath(file.name), file.objectUrl);
    }

    return rawPath => byPath.get(normalizeAssetPath(rawPath)) || rawPath;
}

function rewriteLocalImages(markdown, assetResolver) {
    if (!assetResolver) return markdown;
    return String(markdown || '').replace(LOCAL_IMAGE_PATTERN, (match, prefix, rawUrl, suffix) => {
        if (!isLocalReference(rawUrl)) return match;
        return `${prefix}${assetResolver(rawUrl)}${suffix}`;
    });
}

function isSafeUrl(value) {
    const url = String(value || '').trim();
    return (
        url === '' ||
        url.startsWith('#') ||
        url.startsWith('/') ||
        url.startsWith('./') ||
        url.startsWith('../') ||
        url.startsWith('blob:') ||
        /^https?:\/\//i.test(url) ||
        /^mailto:/i.test(url)
    );
}

function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    template.content.querySelectorAll('script, iframe, object, embed').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
        for (const attribute of [...node.attributes]) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value;
            if (name.startsWith('on')) {
                node.removeAttribute(attribute.name);
                continue;
            }
            if ((name === 'src' || name === 'href') && !isSafeUrl(value)) {
                node.removeAttribute(attribute.name);
            }
        }
    });

    return template.innerHTML;
}

export function renderPreview(container, indexContent, assetResolver, options = {}) {
    const { metadata, body } = parseFrontmatter(indexContent);
    const title = options.includeMetadataHeader && metadata.title ? `# ${metadata.title}\n\n` : '';
    const description = options.includeMetadataHeader && metadata.description ? `> ${metadata.description}\n\n` : '';
    const markdown = rewriteLocalImages(`${title}${description}${body}`, assetResolver);
    const html = globalThis.marked?.parse ? globalThis.marked.parse(markdown) : markdown;
    container.innerHTML = sanitizeHtml(html);

    if (globalThis.hljs) {
        container.querySelectorAll('pre code').forEach(block => {
            globalThis.hljs.highlightElement(block);
        });
    }
}
