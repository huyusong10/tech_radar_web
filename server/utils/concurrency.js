const fsPromises = require('fs').promises;

// ==================== CONCURRENCY CONFIGURATION ====================
// These defaults can be overridden but are central to the concurrency logic
const DEFAULTS = {
    LOCK_TIMEOUT: 5000,
    WRITE_DEBOUNCE: 100,
    MAX_CONCURRENT_WRITES: 10,
    RATE_LIMIT: {
        windowMs: 60000,
        maxRequests: {
            read: 240,
            write: 20
        }
    }
};

// ==================== IN-MEMORY CACHE ====================
class Cache {
    constructor() {
        this.store = new Map();
    }

    get(key) {
        const item = this.store.get(key);
        if (!item) return null;
        if (Date.now() > item.expiry) {
            this.store.delete(key);
            return null;
        }
        return item.value;
    }

    set(key, value, ttl) {
        this.store.set(key, {
            value,
            expiry: Date.now() + ttl
        });
    }

    invalidate(key) {
        this.store.delete(key);
    }

    invalidatePattern(pattern) {
        for (const key of this.store.keys()) {
            if (key.includes(pattern)) {
                this.store.delete(key);
            }
        }
    }
}

// ==================== ASYNC MUTEX IMPLEMENTATION ====================
class AsyncMutex {
    constructor(lockTimeout = DEFAULTS.LOCK_TIMEOUT) {
        this.locks = new Map();
        this.lockTimeout = lockTimeout;
    }

    async acquire(resource, timeout) {
        const effectiveTimeout = timeout || this.lockTimeout;
        const startTime = Date.now();

        while (this.locks.has(resource)) {
            if (Date.now() - startTime > effectiveTimeout) {
                throw new Error(`Lock timeout for resource: ${resource}`);
            }
            // Wait for the existing lock's promise to resolve
            await this.locks.get(resource).promise;
        }

        // Create a new lock with a resolvable promise
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        this.locks.set(resource, { promise, resolve });

        return () => {
            const lock = this.locks.get(resource);
            if (lock) {
                this.locks.delete(resource);
                lock.resolve();
            }
        };
    }
}

// ==================== RATE LIMITER ====================
class RateLimiter {
    constructor(config = DEFAULTS.RATE_LIMIT) {
        this.requests = new Map();
        this.config = config;
        // Clean up old entries every minute
        setInterval(() => this.cleanup(), 60000);
    }

    isAllowed(ip, type = 'read') {
        const key = `${ip}:${type}`;
        const now = Date.now();
        const windowStart = now - this.config.windowMs;

        if (!this.requests.has(key)) {
            this.requests.set(key, []);
        }

        const timestamps = this.requests.get(key);
        // Remove old timestamps
        const recent = timestamps.filter(t => t > windowStart);
        this.requests.set(key, recent);

        const maxRequests = this.config.maxRequests[type] || this.config.maxRequests.read;

        if (recent.length >= maxRequests) {
            return false;
        }

        recent.push(now);
        return true;
    }

    cleanup() {
        const now = Date.now();
        const windowStart = now - this.config.windowMs;

        for (const [key, timestamps] of this.requests.entries()) {
            const recent = timestamps.filter(t => t > windowStart);
            if (recent.length === 0) {
                this.requests.delete(key);
            } else {
                this.requests.set(key, recent);
            }
        }
    }
}

// ==================== DEBOUNCED WRITE QUEUE ====================
class WriteQueue {
    constructor(config = {}) {
        this.pendingWrites = new Map();
        this.writeCount = 0;
        this.maxConcurrent = config.maxConcurrent || DEFAULTS.MAX_CONCURRENT_WRITES;
        this.debounceTime = config.debounceTime || DEFAULTS.WRITE_DEBOUNCE;
    }

    async scheduleWrite(filePath, data) {
        // Cancel any pending write for this file
        if (this.pendingWrites.has(filePath)) {
            clearTimeout(this.pendingWrites.get(filePath).timeout);
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(async () => {
                this.pendingWrites.delete(filePath);
                try {
                    // Wait if too many concurrent writes
                    while (this.writeCount >= this.maxConcurrent) {
                        await new Promise(r => setTimeout(r, 10));
                    }
                    this.writeCount++;
                    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2));
                    this.writeCount--;
                    resolve();
                } catch (error) {
                    this.writeCount--;
                    reject(error);
                }
            }, this.debounceTime);

            this.pendingWrites.set(filePath, { timeout, resolve, reject });
        });
    }
}

module.exports = {
    Cache,
    AsyncMutex,
    RateLimiter,
    WriteQueue,
    DEFAULTS
};
