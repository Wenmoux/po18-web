/*
 * rate-limiter模块单元测试
 */

const { RateLimiter } = require('../rate-limiter');

// Mock logger
jest.mock('../logger', () => ({
    logger: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn()
    }
}));

describe('RateLimiter', () => {
    let rateLimiter;

    beforeEach(() => {
        // 每个测试前创建新的实例
        rateLimiter = new RateLimiter();
    });

    afterEach(() => {
        // 清理定时器
        if (rateLimiter.cleanupInterval) {
            clearInterval(rateLimiter.cleanupInterval);
        }
        rateLimiter.requests.clear();
    });

    describe('构造函数', () => {
        test('应该创建空的请求记录Map', () => {
            expect(rateLimiter.requests).toBeDefined();
            expect(rateLimiter.requests.size).toBe(0);
        });

        test('应该创建清理定时器', () => {
            expect(rateLimiter.cleanupInterval).toBeDefined();
        });
    });

    describe('getClientIp', () => {
        test('应该从x-forwarded-for获取IP', () => {
            const req = {
                headers: {
                    'x-forwarded-for': '192.168.1.1, 10.0.0.1'
                },
                ip: '127.0.0.1'
            };
            const ip = rateLimiter.getClientIp(req);
            expect(ip).toBe('192.168.1.1');
        });

        test('应该从x-real-ip获取IP', () => {
            const req = {
                headers: {
                    'x-real-ip': '192.168.1.2'
                },
                ip: '127.0.0.1'
            };
            const ip = rateLimiter.getClientIp(req);
            expect(ip).toBe('192.168.1.2');
        });

        test('应该从req.ip获取IP', () => {
            const req = {
                ip: '192.168.1.3'
            };
            const ip = rateLimiter.getClientIp(req);
            expect(ip).toBe('192.168.1.3');
        });

        test('应该返回unknown如果无法获取IP', () => {
            const req = {};
            const ip = rateLimiter.getClientIp(req);
            expect(ip).toBe('unknown');
        });
    });

    describe('createLimiter', () => {
        test('应该创建中间件函数', () => {
            const limiter = rateLimiter.createLimiter({
                windowMs: 60000,
                maxRequests: 10
            });
            expect(typeof limiter).toBe('function');
        });

        test('应该使用默认配置', () => {
            const limiter = rateLimiter.createLimiter();
            expect(typeof limiter).toBe('function');
        });
    });

    describe('blockIp', () => {
        test('应该封禁IP', () => {
            rateLimiter.blockIp('192.168.1.100', 60000);
            const status = rateLimiter.getIpStatus('192.168.1.100');
            expect(status).not.toBeNull();
            expect(status.blocked).toBe(true);
            expect(status.blockUntil).toBeGreaterThan(Date.now());
        });

        test('应该清空IP的请求记录', () => {
            rateLimiter.requests.set('192.168.1.100', {
                requests: [Date.now()],
                blocked: false,
                blockUntil: null
            });
            rateLimiter.blockIp('192.168.1.100', 60000);
            const status = rateLimiter.getIpStatus('192.168.1.100');
            expect(status.requests).toBe(0);
        });
    });

    describe('unblockIp', () => {
        test('应该解封IP', () => {
            rateLimiter.blockIp('192.168.1.100', 60000);
            rateLimiter.unblockIp('192.168.1.100');
            const status = rateLimiter.getIpStatus('192.168.1.100');
            if (status) {
                expect(status.blocked).toBe(false);
            } else {
                // 如果没有记录，也是正常的（可能被cleanup清除了）
                expect(status).toBeNull();
            }
        });

        test('解封不存在的IP不应该报错', () => {
            expect(() => {
                rateLimiter.unblockIp('192.168.1.999');
            }).not.toThrow();
        });
    });

    describe('getIpStatus', () => {
        test('应该返回null对于不存在的IP', () => {
            const status = rateLimiter.getIpStatus('192.168.1.100');
            expect(status).toBeNull();
        });

        test('应该返回IP状态信息', () => {
            rateLimiter.requests.set('192.168.1.100', {
                requests: [Date.now(), Date.now()],
                blocked: false,
                blockUntil: null
            });
            const status = rateLimiter.getIpStatus('192.168.1.100');
            expect(status).toHaveProperty('ip');
            expect(status).toHaveProperty('requests');
            expect(status).toHaveProperty('blocked');
            expect(status).toHaveProperty('blockUntil');
            expect(status.requests).toBe(2);
        });
    });

    describe('getStats', () => {
        test('应该返回统计信息', () => {
            rateLimiter.requests.set('192.168.1.1', {
                requests: [Date.now()],
                blocked: false,
                blockUntil: null
            });
            rateLimiter.requests.set('192.168.1.2', {
                requests: [Date.now(), Date.now()],
                blocked: true,
                blockUntil: Date.now() + 60000
            });

            const stats = rateLimiter.getStats();
            expect(stats).toHaveProperty('totalIps');
            expect(stats).toHaveProperty('totalRequests');
            expect(stats).toHaveProperty('blockedCount');
            expect(stats.totalIps).toBe(2);
            expect(stats.totalRequests).toBe(3);
            expect(stats.blockedCount).toBe(1);
        });
    });

    describe('reset', () => {
        test('应该清空所有记录', () => {
            rateLimiter.requests.set('192.168.1.1', {
                requests: [Date.now()],
                blocked: false,
                blockUntil: null
            });
            rateLimiter.reset();
            expect(rateLimiter.requests.size).toBe(0);
        });
    });

    describe('cleanup', () => {
        test('应该清理过期的请求记录', () => {
            const now = Date.now();
            const oldTime = now - 120000; // 2分钟前
            
            rateLimiter.requests.set('192.168.1.1', {
                requests: [oldTime, now - 30000], // 一个是旧的，一个是30秒前
                blocked: false,
                blockUntil: null
            });

            rateLimiter.cleanup();

            const status = rateLimiter.getIpStatus('192.168.1.1');
            // 应该只保留30秒前的请求（在1分钟窗口内）
            expect(status.requests).toBe(1);
        });

        test('应该清除过期封禁', () => {
            const now = Date.now();
            const expiredTime = now - 60000; // 已过期
            
            rateLimiter.requests.set('192.168.1.1', {
                requests: [],
                blocked: true,
                blockUntil: expiredTime
            });

            rateLimiter.cleanup();

            const status = rateLimiter.getIpStatus('192.168.1.1');
            expect(status.blocked).toBe(false);
        });
    });
});

