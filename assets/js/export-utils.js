(function(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.TechRadarExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const PNG_MIME_TYPE = 'image/png';
    const PNG_EXTENSION = '.png';

    function getExportFilename(search) {
        const params = new URLSearchParams(search || '');
        const vol = params.get('vol') || '001';
        const safeVol = vol.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || '001';
        return `tech-radar-vol-${safeVol}${PNG_EXTENSION}`;
    }

    function canvasToPngBlob(canvas) {
        return new Promise((resolve, reject) => {
            if (!canvas || typeof canvas.toBlob !== 'function') {
                reject(new Error('Canvas export is not supported'));
                return;
            }

            try {
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Failed to create image blob'));
                        return;
                    }
                    resolve(blob);
                }, PNG_MIME_TYPE);
            } catch (error) {
                reject(error);
            }
        });
    }

    async function prepareExportSave(filename, windowRef) {
        const browserWindow = windowRef || (typeof window !== 'undefined' ? window : undefined);
        if (!browserWindow || typeof browserWindow.showSaveFilePicker !== 'function') {
            return { cancelled: false, handle: null };
        }

        try {
            const handle = await browserWindow.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'PNG Image',
                    accept: { [PNG_MIME_TYPE]: [PNG_EXTENSION] }
                }]
            });
            return { cancelled: false, handle };
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return { cancelled: true, handle: null };
            }
            if (error && (error.name === 'SecurityError' || error.name === 'NotAllowedError')) {
                return { cancelled: false, handle: null };
            }
            throw error;
        }
    }

    async function writeBlobToHandle(blob, handle) {
        const writable = await handle.createWritable();
        try {
            await writable.write(blob);
        } finally {
            await writable.close();
        }
    }

    function downloadBlobWithAnchor(blob, filename, deps) {
        const browserDocument = deps?.documentRef || (typeof document !== 'undefined' ? document : undefined);
        const URLCtor = deps?.URLRef || (typeof URL !== 'undefined' ? URL : undefined);

        if (!browserDocument || !URLCtor || typeof URLCtor.createObjectURL !== 'function') {
            throw new Error('Browser download is not supported');
        }

        const url = URLCtor.createObjectURL(blob);
        const link = browserDocument.createElement('a');
        link.download = filename;
        link.href = url;
        link.style.display = 'none';
        browserDocument.body.appendChild(link);

        try {
            link.click();
        } finally {
            browserDocument.body.removeChild(link);
            setTimeout(() => URLCtor.revokeObjectURL(url), 1000);
        }
    }

    async function savePngBlob(blob, filename, saveTarget, deps) {
        if (saveTarget && saveTarget.cancelled) {
            return false;
        }

        if (saveTarget && saveTarget.handle) {
            await writeBlobToHandle(blob, saveTarget.handle);
            return true;
        }

        downloadBlobWithAnchor(blob, filename, deps);
        return true;
    }

    return {
        canvasToPngBlob,
        getExportFilename,
        prepareExportSave,
        savePngBlob
    };
});
