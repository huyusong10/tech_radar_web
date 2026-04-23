const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
    canvasToPngBlob,
    getExportFilename,
    prepareExportSave,
    savePngBlob
} = require('../assets/js/export-utils');

describe('Image export utilities', () => {
    test('builds a stable PNG filename from the selected volume', () => {
        assert.equal(getExportFilename('?vol=002'), 'tech-radar-vol-002.png');
        assert.equal(getExportFilename(''), 'tech-radar-vol-001.png');
        assert.equal(getExportFilename('?vol=../bad/name'), 'tech-radar-vol-..-bad-name.png');
    });

    test('converts a canvas to a PNG blob through a rejecting promise', async () => {
        const blob = new Blob(['png'], { type: 'image/png' });
        const canvas = {
            toBlob(callback, type) {
                assert.equal(type, 'image/png');
                callback(blob);
            }
        };

        assert.equal(await canvasToPngBlob(canvas), blob);

        await assert.rejects(
            canvasToPngBlob({ toBlob: callback => callback(null) }),
            /Failed to create image blob/
        );

        await assert.rejects(
            canvasToPngBlob({ toBlob: () => { throw new Error('tainted canvas'); } }),
            /tainted canvas/
        );
    });

    test('reserves a Chrome file handle when available and treats user cancel as neutral', async () => {
        const handle = { createWritable() {} };
        const pickerCalls = [];
        const windowRef = {
            async showSaveFilePicker(options) {
                pickerCalls.push(options);
                return handle;
            }
        };

        const prepared = await prepareExportSave('tech-radar-vol-002.png', windowRef);
        assert.deepEqual(prepared, { cancelled: false, handle });
        assert.equal(pickerCalls[0].suggestedName, 'tech-radar-vol-002.png');
        assert.deepEqual(pickerCalls[0].types[0].accept, { 'image/png': ['.png'] });

        const cancelled = await prepareExportSave('tech-radar-vol-002.png', {
            async showSaveFilePicker() {
                const error = new Error('cancelled');
                error.name = 'AbortError';
                throw error;
            }
        });
        assert.deepEqual(cancelled, { cancelled: true, handle: null });

        const fallback = await prepareExportSave('tech-radar-vol-002.png', {
            async showSaveFilePicker() {
                const error = new Error('blocked by browser policy');
                error.name = 'SecurityError';
                throw error;
            }
        });
        assert.deepEqual(fallback, { cancelled: false, handle: null });
    });

    test('saves through a prepared file handle before falling back to anchor download', async () => {
        const blob = new Blob(['png'], { type: 'image/png' });
        const writes = [];
        const handle = {
            async createWritable() {
                return {
                    async write(value) {
                        writes.push(value);
                    },
                    async close() {
                        writes.push('closed');
                    }
                };
            }
        };

        assert.equal(await savePngBlob(blob, 'image.png', { handle }), true);
        assert.deepEqual(writes, [blob, 'closed']);

        const clicks = [];
        const appended = [];
        const removed = [];
        const documentRef = {
            body: {
                appendChild(node) {
                    appended.push(node);
                },
                removeChild(node) {
                    removed.push(node);
                }
            },
            createElement(tagName) {
                assert.equal(tagName, 'a');
                return {
                    style: {},
                    click() {
                        clicks.push(this.href);
                    }
                };
            }
        };
        const URLRef = {
            createObjectURL(value) {
                assert.equal(value, blob);
                return 'blob:test';
            },
            revokeObjectURL() {}
        };

        assert.equal(await savePngBlob(blob, 'image.png', null, { documentRef, URLRef }), true);
        assert.equal(appended[0].download, 'image.png');
        assert.deepEqual(clicks, ['blob:test']);
        assert.deepEqual(removed, appended);

        assert.equal(await savePngBlob(blob, 'image.png', { cancelled: true }), false);
    });
});
