// ==================== IP UTILITIES ====================

// Validate IP address format (IPv4 or IPv6)
function isValidIP(ip) {
    if (!ip || typeof ip !== 'string') return false;

    // IPv4 pattern
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 pattern (simplified, covers most cases including ::1)
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$|^::1$|^::$/;
    // IPv4-mapped IPv6 (::ffff:192.168.1.1)
    const ipv4MappedPattern = /^::ffff:(\d{1,3}\.){3}\d{1,3}$/i;

    if (ipv4Pattern.test(ip)) {
        // Validate each octet is 0-255
        const octets = ip.split('.').map(Number);
        return octets.every(o => o >= 0 && o <= 255);
    }

    return ipv6Pattern.test(ip) || ipv4MappedPattern.test(ip);
}

// Normalize IP address (extract IPv4 from IPv4-mapped IPv6, trim whitespace)
function normalizeIP(ip) {
    if (!ip) return null;

    ip = ip.trim();

    // Extract IPv4 from IPv4-mapped IPv6 format (::ffff:192.168.1.1)
    const ipv4MappedMatch = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (ipv4MappedMatch) {
        return ipv4MappedMatch[1];
    }

    // Handle localhost variations
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        return '127.0.0.1';
    }

    return ip;
}

function isTrustedProxyAddress(ip) {
    const normalizedIp = normalizeIP(ip);
    if (!normalizedIp) return false;

    if (normalizedIp === '127.0.0.1' || normalizedIp === '::1') {
        return true;
    }

    if (/^10\./.test(normalizedIp) || /^192\.168\./.test(normalizedIp)) {
        return true;
    }

    const match172 = normalizedIp.match(/^172\.(\d{1,3})\./);
    if (match172) {
        const secondOctet = Number(match172[1]);
        if (secondOctet >= 16 && secondOctet <= 31) {
            return true;
        }
    }

    return /^(fc|fd|fe80):/i.test(normalizedIp);
}

// Get client IP with improved security considerations
// Supports 'trust proxy' configuration indirectly via inspecting X-Forwarded-For carefully
function getClientIP(req, trustProxy = false) {
    const directConnectionIp = normalizeIP(
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        req.ip
    );
    let ip = null;

    // If trusting a local/private proxy, look at forwarding headers
    if (trustProxy && isTrustedProxyAddress(directConnectionIp)) {
        const xForwardedFor = req.headers['x-forwarded-for'];
        if (xForwardedFor) {
            // Take the first IP (client), but only if we trust the proxy chain
            // In a real production environment with Express 'trust proxy', req.ip is preferred
            // Here we manually parse for consistency if req.ip isn't fully configured
            ip = xForwardedFor.split(',')[0].trim();
        }

        if (!ip && req.headers['x-real-ip']) {
            ip = req.headers['x-real-ip'].trim();
        }
    }

    // Fallback to direct connection
    if (!ip) {
        ip = directConnectionIp;
    }

    // Normalize and validate
    ip = normalizeIP(ip);

    if (!ip || !isValidIP(ip)) {
        return null;
    }

    return ip;
}

module.exports = {
    isValidIP,
    normalizeIP,
    isTrustedProxyAddress,
    getClientIP
};
