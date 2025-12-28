/*
 * File: rate-limiter.js
 * Input: Express request, config.js
 * Output: Express中间件，提供API限流功能，防止恶意请求和DoS攻击
 * Pos: 安全中间件层，在路由处理前进行请求频率限制
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

/**
 * API限流中间件
 * 基于内存存储的滑动窗口算法实现限流
 */

const { logger } = require("./logger");

class RateLimiter {
    constructor() {
        // 存储每个IP的请求记录
        // 格式: { ip: { requests: [timestamp1, timestamp2, ...], blocked: boolean, blockUntil: timestamp } }
        this.requests = new Map();
        
        // 定期清理过期记录（每5分钟）
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
    }

    /**
     * 清理过期的请求记录
     */
    cleanup() {
        const now = Date.now();
        const windowMs = 60 * 1000; // 1分钟窗口

        for (const [ip, data] of this.requests.entries()) {
            // 清理过期的请求时间戳
            data.requests = data.requests.filter(timestamp => now - timestamp < windowMs);
            
            // 如果请求记录为空且没有被封禁，删除该IP记录
            if (data.requests.length === 0 && (!data.blocked || data.blockUntil < now)) {
                this.requests.delete(ip);
            }
            
            // 如果封禁已过期，清除封禁状态
            if (data.blocked && data.blockUntil < now) {
                data.blocked = false;
                data.blockUntil = null;
                logger.info("IP封禁已解除", { ip });
            }
        }
    }

    /**
     * 创建限流中间件
     * @param {Object} options - 限流配置
     * @param {number} options.windowMs - 时间窗口（毫秒）
     * @param {number} options.maxRequests - 最大请求数
     * @param {number} options.blockDurationMs - 封禁时长（毫秒）
     * @param {boolean} options.skipSuccessfulRequests - 是否跳过成功请求
     * @param {boolean} options.skipFailedRequests - 是否跳过失败请求
     * @returns {Function} Express中间件
     */
    createLimiter(options = {}) {
        const {
            windowMs = 60 * 1000, // 默认1分钟
            maxRequests = 60, // 默认每分钟60次
            blockDurationMs = 15 * 60 * 1000, // 默认封禁15分钟
            skipSuccessfulRequests = false,
            skipFailedRequests = false
        } = options;

        return (req, res, next) => {
            const ip = this.getClientIp(req);
            const now = Date.now();

            // 获取或创建该IP的记录
            if (!this.requests.has(ip)) {
                this.requests.set(ip, {
                    requests: [],
                    blocked: false,
                    blockUntil: null
                });
            }

            const ipData = this.requests.get(ip);

            // 检查是否被封禁
            if (ipData.blocked && ipData.blockUntil > now) {
                const remainingSeconds = Math.ceil((ipData.blockUntil - now) / 1000);
                logger.warn("请求被限流拦截", {
                    ip,
                    url: req.url,
                    method: req.method,
                    remainingSeconds
                });

                res.status(429).json({
                    error: "请求过于频繁，请稍后再试",
                    code: "RATE_LIMIT_EXCEEDED",
                    retryAfter: remainingSeconds
                });
                return;
            }

            // 清除过期的请求记录
            ipData.requests = ipData.requests.filter(timestamp => now - timestamp < windowMs);

            // 检查是否超过限制
            if (ipData.requests.length >= maxRequests) {
                // 封禁该IP
                ipData.blocked = true;
                ipData.blockUntil = now + blockDurationMs;
                ipData.requests = []; // 清空请求记录

                logger.warn("IP被封禁", {
                    ip,
                    url: req.url,
                    method: req.method,
                    blockDuration: blockDurationMs / 1000 / 60 + "分钟"
                });

                res.status(429).json({
                    error: "请求过于频繁，IP已被临时封禁",
                    code: "RATE_LIMIT_EXCEEDED",
                    retryAfter: Math.ceil(blockDurationMs / 1000)
                });
                return;
            }

            // 记录本次请求
            const shouldRecord = () => {
                if (skipSuccessfulRequests && res.statusCode < 400) return false;
                if (skipFailedRequests && res.statusCode >= 400) return false;
                return true;
            };

            // 使用响应结束事件来记录（可以知道状态码）
            const originalEnd = res.end;
            res.end = function(...args) {
                if (shouldRecord.call({ res })) {
                    ipData.requests.push(now);
                }
                originalEnd.apply(this, args);
            };

            next();
        };
    }

    /**
     * 获取客户端IP地址
     * @param {Object} req - Express请求对象
     * @returns {string} IP地址
     */
    getClientIp(req) {
        return (
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
            req.headers["x-real-ip"] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.ip ||
            "unknown"
        );
    }

    /**
     * 手动封禁IP
     * @param {string} ip - IP地址
     * @param {number} durationMs - 封禁时长（毫秒）
     */
    blockIp(ip, durationMs = 60 * 60 * 1000) {
        if (!this.requests.has(ip)) {
            this.requests.set(ip, {
                requests: [],
                blocked: false,
                blockUntil: null
            });
        }

        const ipData = this.requests.get(ip);
        ipData.blocked = true;
        ipData.blockUntil = Date.now() + durationMs;
        ipData.requests = [];

        logger.warn("手动封禁IP", { ip, duration: durationMs / 1000 / 60 + "分钟" });
    }

    /**
     * 手动解封IP
     * @param {string} ip - IP地址
     */
    unblockIp(ip) {
        if (this.requests.has(ip)) {
            const ipData = this.requests.get(ip);
            ipData.blocked = false;
            ipData.blockUntil = null;
            logger.info("手动解封IP", { ip });
        }
    }

    /**
     * 获取IP的限流状态
     * @param {string} ip - IP地址
     * @returns {Object|null} 限流状态信息
     */
    getIpStatus(ip) {
        if (!this.requests.has(ip)) {
            return null;
        }

        const ipData = this.requests.get(ip);
        const now = Date.now();

        return {
            ip,
            requests: ipData.requests.length,
            blocked: ipData.blocked && ipData.blockUntil > now,
            blockUntil: ipData.blockUntil,
            remainingBlockTime: ipData.blockUntil && ipData.blockUntil > now
                ? Math.ceil((ipData.blockUntil - now) / 1000)
                : 0
        };
    }

    /**
     * 获取所有IP的统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        const now = Date.now();
        let totalRequests = 0;
        let blockedCount = 0;

        for (const [ip, data] of this.requests.entries()) {
            totalRequests += data.requests.length;
            if (data.blocked && data.blockUntil > now) {
                blockedCount++;
            }
        }

        return {
            totalIps: this.requests.size,
            totalRequests,
            blockedCount
        };
    }

    /**
     * 获取所有IP的详细状态列表
     * @returns {Array} IP状态列表
     */
    getAllIpStatus() {
        const now = Date.now();
        const ipList = [];

        for (const [ip, data] of this.requests.entries()) {
            // 清理过期的请求记录
            const validRequests = data.requests.filter(timestamp => {
                // 假设默认窗口为15分钟（用于显示）
                return now - timestamp < 15 * 60 * 1000;
            });

            const isBlocked = data.blocked && data.blockUntil > now;
            const remainingBlockTime = isBlocked && data.blockUntil
                ? Math.ceil((data.blockUntil - now) / 1000)
                : 0;

            ipList.push({
                ip,
                requestCount: validRequests.length,
                blocked: isBlocked,
                blockUntil: data.blockUntil,
                remainingBlockTime,
                lastRequestTime: validRequests.length > 0 
                    ? Math.max(...validRequests) 
                    : null
            });
        }

        // 按封禁状态和最后请求时间排序
        return ipList.sort((a, b) => {
            // 先按封禁状态排序（封禁的在前面）
            if (a.blocked !== b.blocked) {
                return b.blocked ? 1 : -1;
            }
            // 再按最后请求时间排序（最近的在前）
            const timeA = a.lastRequestTime || 0;
            const timeB = b.lastRequestTime || 0;
            return timeB - timeA;
        });
    }

    /**
     * 清理所有记录（用于测试或重置）
     */
    reset() {
        this.requests.clear();
        logger.info("限流器已重置");
    }

    /**
     * 销毁限流器（清理定时器）
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.requests.clear();
    }
}

// 创建全局实例
const rateLimiter = new RateLimiter();

module.exports = {
    rateLimiter,
    RateLimiter
};

