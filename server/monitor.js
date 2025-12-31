/*
 * File: monitor.js
 * Input: os模块， database.js, crawler.js, logger.js, config.js
 * Output: PerformanceMonitor和SubscriptionChecker类，提供性能监控和订阅更新检查功能
 * Pos: 监控模块，定期收集系统性能指标、检查订阅更新、触发告警
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

/**
 * PO18小说下载网站 - 性能监控与告警模块
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');
const config = require('./config');
const { db, SubscriptionDB, SubscriptionCheckLogDB, SubscriptionNotificationDB, BookMetadataDB } = require('./database');
const { Crawler } = require('./crawler');

class PerformanceMonitor {
    constructor(options = {}) {
        this.alertThresholds = options.alertThresholds || {
            cpu: 80,           // CPU使用率阈值 (%)
            memory: 85,        // 内存使用率阈值 (%)
            disk: 90,          // 磁盘使用率阈值 (%)
            responseTime: 5000 // API响应时间阈值 (ms)
        };
        
        this.monitoringInterval = options.monitoringInterval || 60000; // 监控间隔 (ms)
        this.alertCooldown = options.alertCooldown || 300000; // 告警冷却时间 (ms)
        this.lastAlerts = new Map(); // 上次告警时间记录
        this.metricsHistory = []; // 性能指标历史记录
        this.maxHistoryLength = options.maxHistoryLength || 100; // 最大历史记录长度
        
        // API性能指标
        this.apiMetrics = {
            requestCount: 0,
            totalResponseTime: 0,
            errorCount: 0,
            slowRequests: [], // 存储慢请求记录
            maxSlowRequests: 100 // 最多保存的慢请求数量
        };
        
        // 告警通知回调
        this.alertCallbacks = [];
    }
    
    /**
     * 启动性能监控
     */
    startMonitoring() {
        logger.info('启动性能监控');
        
        // 定期收集系统指标
        this.monitoringTimer = setInterval(() => {
            this.collectMetrics();
        }, this.monitoringInterval);
        
        // 定期重置API指标（每小时重置一次）
        this.apiMetricsResetTimer = setInterval(() => {
            this.resetAPIMetrics();
        }, 3600000); // 1小时
        
        // 收集初始指标
        this.collectMetrics();
    }
    
    /**
     * 停止性能监控
     */
    stopMonitoring() {
        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
            this.monitoringTimer = null;
        }
        if (this.apiMetricsResetTimer) {
            clearInterval(this.apiMetricsResetTimer);
            this.apiMetricsResetTimer = null;
        }
        logger.info('性能监控已停止');
    }
    
    /**
     * 收集系统性能指标
     */
    async collectMetrics() {
        try {
            const metrics = {
                timestamp: new Date().toISOString(),
                system: await this.getSystemMetrics(),
                process: await this.getProcessMetrics(),
                database: await this.getDatabaseMetrics(),
                api: await this.getAPIMetrics()
            };
            
            // 添加到历史记录
            this.metricsHistory.push(metrics);
            if (this.metricsHistory.length > this.maxHistoryLength) {
                this.metricsHistory.shift();
            }
            
            // 检查是否需要触发告警
            this.checkAlerts(metrics);
            
            logger.debug('性能指标收集完成', metrics);
            return metrics;
        } catch (error) {
            logger.error('收集性能指标失败', { error: error.message });
            return null;
        }
    }
    
    /**
     * 获取系统级指标
     */
    async getSystemMetrics() {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        // 改进的CPU使用率计算（需要两次采样）
        let cpuUsage = 0;
        if (!this.lastCpuTimes) {
            // 首次采样，记录CPU时间
            this.lastCpuTimes = cpus.map(cpu => ({ ...cpu.times }));
            cpuUsage = 0; // 首次无法计算
        } else {
            // 计算每个核心的使用率
            const cpuUsages = cpus.map((cpu, index) => {
                const lastTimes = this.lastCpuTimes[index];
                const total = Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0);
                const lastTotal = Object.values(lastTimes).reduce((acc, tv) => acc + tv, 0);
                const idle = cpu.times.idle - lastTimes.idle;
                const totalDiff = total - lastTotal;
                
                if (totalDiff === 0) return 0;
                return ((totalDiff - idle) / totalDiff) * 100;
            });
            
            // 计算平均CPU使用率
            cpuUsage = cpuUsages.reduce((sum, usage) => sum + usage, 0) / cpuUsages.length;
            
            // 更新上次的CPU时间
            this.lastCpuTimes = cpus.map(cpu => ({ ...cpu.times }));
        }
        
        // 改进的磁盘使用率获取
        let diskUsage = 0;
        let diskTotal = 0;
        let diskFree = 0;
        try {
            // 使用fs.statfs（如果可用）或尝试其他方法
            const dbPath = path.dirname(config.database.path);
            const stats = fs.statSync(dbPath);
            
            // 在Windows上，尝试使用更精确的方法
            if (process.platform === 'win32') {
                // Windows系统，使用wmic命令或简化处理
                // 这里简化处理，实际可以使用node-disk-info等库
                diskUsage = 50; // 占位值
            } else {
                // Unix系统，可以尝试使用df命令或statfs
                // 这里简化处理
                diskUsage = 50; // 占位值
            }
        } catch (error) {
            logger.warn('获取磁盘使用情况失败', { error: error.message });
        }
        
        return {
            cpu: {
                cores: cpus.length,
                usage: parseFloat(cpuUsage.toFixed(2))
            },
            memory: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                usagePercent: parseFloat(((usedMem / totalMem) * 100).toFixed(2))
            },
            disk: {
                usagePercent: diskUsage,
                total: diskTotal,
                free: diskFree
            },
            uptime: os.uptime(),
            loadavg: os.loadavg()
        };
    }
    
    /**
     * 获取进程级指标
     */
    async getProcessMetrics() {
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        return {
            pid: process.pid,
            uptime: uptime,
            memory: {
                rss: memUsage.rss,
                heapTotal: memUsage.heapTotal,
                heapUsed: memUsage.heapUsed,
                external: memUsage.external
            }
        };
    }
    
    /**
     * 获取数据库指标
     */
    async getDatabaseMetrics() {
        try {
            // 数据库文件大小
            let dbSize = 0;
            if (fs.existsSync(config.database.path)) {
                const stats = fs.statSync(config.database.path);
                dbSize = stats.size;
            }
            
            // 表统计
            const tables = {
                users: db.prepare("SELECT COUNT(*) as count FROM users").get().count,
                bookshelf: db.prepare("SELECT COUNT(*) as count FROM bookshelf").get().count,
                book_metadata: db.prepare("SELECT COUNT(*) as count FROM book_metadata").get().count,
                chapter_cache: db.prepare("SELECT COUNT(*) as count FROM chapter_cache").get().count,
                shared_library: db.prepare("SELECT COUNT(*) as count FROM shared_library").get().count,
                download_queue: db.prepare("SELECT COUNT(*) as count FROM download_queue").get().count
            };
            
            return {
                size: dbSize,
                tables: tables
            };
        } catch (error) {
            logger.error('获取数据库指标失败', { error: error.message });
            return {
                size: 0,
                tables: {}
            };
        }
    }
    
    /**
     * 获取API性能指标
     */
    async getAPIMetrics() {
        const avgResponseTime = this.apiMetrics.requestCount > 0 
            ? Math.round(this.apiMetrics.totalResponseTime / this.apiMetrics.requestCount)
            : 0;
        
        const errorRate = this.apiMetrics.requestCount > 0
            ? parseFloat(((this.apiMetrics.errorCount / this.apiMetrics.requestCount) * 100).toFixed(2))
            : 0;
        
        return {
            requestCount: this.apiMetrics.requestCount,
            averageResponseTime: avgResponseTime,
            errorRate: errorRate,
            slowRequests: this.apiMetrics.slowRequests.slice(-10) // 返回最近10条慢请求
        };
    }
    
    /**
     * 记录API请求
     * @param {string} method HTTP方法
     * @param {string} path 请求路径
     * @param {number} responseTime 响应时间(ms)
     * @param {number} statusCode 状态码
     */
    recordAPIRequest(method, path, responseTime, statusCode) {
        this.apiMetrics.requestCount++;
        this.apiMetrics.totalResponseTime += responseTime;
        
        // 记录错误
        if (statusCode >= 400) {
            this.apiMetrics.errorCount++;
        }
        
        // 记录慢请求
        if (responseTime > this.alertThresholds.responseTime) {
            const slowRequest = {
                method,
                path,
                responseTime,
                statusCode,
                timestamp: new Date().toISOString()
            };
            
            this.apiMetrics.slowRequests.push(slowRequest);
            
            // 限制慢请求记录数量
            if (this.apiMetrics.slowRequests.length > this.apiMetrics.maxSlowRequests) {
                this.apiMetrics.slowRequests.shift();
            }
        }
    }
    
    /**
     * 重置API指标（用于定期清理）
     */
    resetAPIMetrics() {
        this.apiMetrics.requestCount = 0;
        this.apiMetrics.totalResponseTime = 0;
        this.apiMetrics.errorCount = 0;
        // 保留慢请求记录，但限制数量
        if (this.apiMetrics.slowRequests.length > 50) {
            this.apiMetrics.slowRequests = this.apiMetrics.slowRequests.slice(-50);
        }
    }
    
    /**
     * 检查是否需要触发告警
     */
    checkAlerts(metrics) {
        const alerts = [];
        
        // 检查CPU使用率
        if (metrics.system.cpu.usage > this.alertThresholds.cpu) {
            alerts.push({
                type: 'cpu',
                level: 'warning',
                message: `CPU使用率过高: ${metrics.system.cpu.usage}%`,
                threshold: this.alertThresholds.cpu,
                currentValue: metrics.system.cpu.usage
            });
        }
        
        // 检查内存使用率
        if (metrics.system.memory.usagePercent > this.alertThresholds.memory) {
            alerts.push({
                type: 'memory',
                level: 'warning',
                message: `内存使用率过高: ${metrics.system.memory.usagePercent}%`,
                threshold: this.alertThresholds.memory,
                currentValue: metrics.system.memory.usagePercent
            });
        }
        
        // 检查磁盘使用率
        if (metrics.system.disk.usagePercent > this.alertThresholds.disk) {
            alerts.push({
                type: 'disk',
                level: 'warning',
                message: `磁盘使用率过高: ${metrics.system.disk.usagePercent}%`,
                threshold: this.alertThresholds.disk,
                currentValue: metrics.system.disk.usagePercent
            });
        }
        
        // 发送告警
        if (alerts.length > 0) {
            for (const alert of alerts) {
                this.sendAlert(alert);
            }
        }
    }
    
    /**
     * 发送告警通知
     */
    sendAlert(alert) {
        const now = Date.now();
        const lastAlertTime = this.lastAlerts.get(alert.type);
        
        // 检查冷却时间
        if (lastAlertTime && (now - lastAlertTime) < this.alertCooldown) {
            logger.debug(`告警冷却中，跳过告警: ${alert.type}`);
            return;
        }
        
        // 记录告警时间
        this.lastAlerts.set(alert.type, now);
        
        // 记录告警日志
        logger.warn(`系统告警: ${alert.message}`, {
            type: alert.type,
            level: alert.level,
            threshold: alert.threshold,
            currentValue: alert.currentValue
        });
        
        // 调用告警回调
        for (const callback of this.alertCallbacks) {
            try {
                callback(alert);
            } catch (error) {
                logger.error('执行告警回调失败', { error: error.message });
            }
        }
    }
    
    /**
     * 添加告警回调
     */
    addAlertCallback(callback) {
        if (typeof callback === 'function') {
            this.alertCallbacks.push(callback);
        }
    }
    
    /**
     * 移除告警回调
     */
    removeAlertCallback(callback) {
        const index = this.alertCallbacks.indexOf(callback);
        if (index > -1) {
            this.alertCallbacks.splice(index, 1);
        }
    }
    
    /**
     * 获取历史性能指标
     */
    getMetricsHistory(limit = 50) {
        const startIndex = Math.max(0, this.metricsHistory.length - limit);
        return this.metricsHistory.slice(startIndex);
    }
    
    /**
     * 获取当前性能状态
     */
    getCurrentStatus() {
        if (this.metricsHistory.length === 0) {
            return null;
        }
        
        return this.metricsHistory[this.metricsHistory.length - 1];
    }
    
    /**
     * 设置告警阈值
     */
    setAlertThresholds(thresholds) {
        this.alertThresholds = { ...this.alertThresholds, ...thresholds };
        logger.info('告警阈值已更新', this.alertThresholds);
    }
    
    /**
     * 获取告警阈值
     */
    getAlertThresholds() {
        return { ...this.alertThresholds };
    }
}

// 创建全局性能监控实例
const performanceMonitor = new PerformanceMonitor();

/**
 * 订阅更新检测类（重新设计版本）
 * 支持智能检查策略、失败重试、检查历史记录、提醒通知
 */
class SubscriptionChecker {
    constructor(options = {}) {
        this.checkInterval = options.checkInterval || 15 * 60 * 1000; // 默认15分钟检查一次
        this.maxConcurrent = options.maxConcurrent || 5; // 最大并发检查数
        this.maxRetries = options.maxRetries || 3; // 最大重试次数
        this.retryDelay = options.retryDelay || 5 * 60 * 1000; // 重试延迟（5分钟）
        this.batchSize = options.batchSize || 50; // 每批检查的订阅数量
        this.checkTimer = null;
        this.isChecking = false;
        this.lastCheckTime = null;
        this.checkCount = 0;
        this.updateCount = 0;
        this.errorCount = 0;
        this.pendingRetries = new Map(); // 待重试的订阅
    }

    /**
     * 启动订阅检查
     */
    startChecking() {
        logger.info('启动订阅更新检查（新版本）', {
            interval: `${this.checkInterval / 1000 / 60}分钟`,
            maxConcurrent: this.maxConcurrent,
            batchSize: this.batchSize
        });

        // 立即执行一次检查
        this.checkAllSubscriptions();

        // 定期检查
        this.checkTimer = setInterval(() => {
            this.checkAllSubscriptions();
        }, this.checkInterval);

        // 定期处理重试
        this.retryTimer = setInterval(() => {
            this.processRetries();
        }, this.retryDelay);
    }

    /**
     * 停止订阅检查
     */
    stopChecking() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }
        logger.info('订阅更新检查已停止');
    }

    /**
     * 检查所有订阅的更新（智能选择）
     */
    async checkAllSubscriptions() {
        if (this.isChecking) {
            logger.debug('正在检查中，跳过本次任务');
            return;
        }

        this.isChecking = true;
        const startTime = Date.now();
        this.lastCheckTime = new Date();
        this.checkCount++;

        try {
            // 使用智能选择获取需要检查的订阅
            const subscriptions = SubscriptionDB.getSubscriptionsForCheck(this.batchSize);
            
            if (subscriptions.length === 0) {
                logger.debug('没有需要检查的订阅');
                this.isChecking = false;
                return;
            }

            logger.info(`开始检查 ${subscriptions.length} 个订阅的更新`);

            let updatedCount = 0;
            let errorCount = 0;
            const checkResults = [];

            // 分批处理，避免并发过多
            for (let i = 0; i < subscriptions.length; i += this.maxConcurrent) {
                const batch = subscriptions.slice(i, i + this.maxConcurrent);
                const results = await Promise.allSettled(
                    batch.map(sub => this.checkBookUpdate(sub.book_id, sub.last_chapter_count, 'scheduled'))
                );

                // 处理结果
                results.forEach((result, index) => {
                    const sub = batch[index];
                    const checkStartTime = Date.now();
                    
                    if (result.status === 'fulfilled') {
                        const checkResult = result.value;
                        const { updated, newChapters, error, oldCount, newCount } = checkResult || {};
                        const duration = Date.now() - checkStartTime;
                        
                        if (updated) {
                            updatedCount++;
                            checkResults.push({
                                bookId: sub.book_id,
                                status: 'success',
                                updated: true,
                                newChapters
                            });
                        } else {
                            checkResults.push({
                                bookId: sub.book_id,
                                status: 'success',
                                updated: false
                            });
                        }

                        // 记录检查日志
                        SubscriptionCheckLogDB.logCheck(
                            sub.book_id,
                            'scheduled',
                            updated ? 'updated' : 'no_update',
                            oldCount !== undefined ? oldCount : sub.last_chapter_count,
                            newCount !== undefined ? newCount : (sub.last_chapter_count + (newChapters || 0)),
                            newChapters || 0,
                            error || null,
                            duration
                        );

                        // 更新最后检查时间
                        SubscriptionDB.updateLastChecked(sub.book_id);
                    } else {
                        errorCount++;
                        const error = result.reason?.message || '未知错误';
                        logger.warn(`检查订阅失败`, {
                            bookId: sub.book_id,
                            error
                        });

                        // 记录错误日志
                        SubscriptionCheckLogDB.logCheck(
                            sub.book_id,
                            'scheduled',
                            'error',
                            sub.last_chapter_count,
                            null,
                            null,
                            error,
                            Date.now() - checkStartTime
                        );

                        // 添加到重试队列
                        this.addToRetryQueue(sub.book_id, sub.last_chapter_count);
                    }
                });

                // 避免过快请求，每批次间隔等待1秒
                if (i + this.maxConcurrent < subscriptions.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            this.updateCount += updatedCount;
            this.errorCount += errorCount;

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            logger.info(`订阅检查完成`, {
                total: subscriptions.length,
                updated: updatedCount,
                errors: errorCount,
                duration: `${duration}s`
            });

        } catch (error) {
            logger.error('检查订阅更新失败', { error: error.message });
        } finally {
            this.isChecking = false;
        }
    }

    /**
     * 检查单个书籍的更新（增强版）
     */
    async checkBookUpdate(bookId, lastChapterCount, checkType = 'manual') {
        const startTime = Date.now();
        
        try {
            // 从本地元数据库获取书籍信息
            const bookMetadata = BookMetadataDB.get(bookId);
            
            if (!bookMetadata) {
                logger.debug(`本地无书籍元数据: ${bookId}`);
                return {
                    updated: false,
                    error: '本地无书籍元数据'
                };
            }

            const currentChapterCount = bookMetadata.total_chapters || 0;

            // 如果章节数增加，标记为有更新
            if (currentChapterCount > lastChapterCount) {
                const newChapters = currentChapterCount - lastChapterCount;
                
                // 标记为有更新
                SubscriptionDB.markUpdate(bookId, currentChapterCount);
                
                // 获取所有订阅此书籍的用户
                const bookSubscriptions = db.prepare(`
                    SELECT user_id, title, notification_enabled 
                    FROM book_subscriptions 
                    WHERE book_id = ? AND has_update = 0
                `).all(bookId);

                // 为每个订阅用户创建提醒
                for (const sub of bookSubscriptions) {
                    if (sub.notification_enabled === 1) {
                        SubscriptionNotificationDB.createNotification(
                            sub.user_id,
                            bookId,
                            'update',
                            `${sub.title} 有更新`,
                            `新增 ${newChapters} 章，共 ${currentChapterCount} 章`
                        );
                    }
                }
                
                logger.info(`发现更新`, {
                    bookId,
                    title: bookMetadata.title,
                    oldCount: lastChapterCount,
                    newCount: currentChapterCount,
                    newChapters,
                    notifiedUsers: bookSubscriptions.length
                });

                return {
                    updated: true,
                    newChapters,
                    oldCount: lastChapterCount,
                    newCount: currentChapterCount
                };
            }

            return {
                updated: false,
                oldCount: lastChapterCount,
                newCount: currentChapterCount
            };
        } catch (error) {
            logger.debug(`检查书籍失败: ${bookId}`, { error: error.message });
            return {
                updated: false,
                error: error.message
            };
        }
    }

    /**
     * 添加到重试队列
     */
    addToRetryQueue(bookId, lastChapterCount) {
        const retryInfo = this.pendingRetries.get(bookId) || {
            bookId,
            lastChapterCount,
            retryCount: 0,
            lastRetryTime: null
        };

        retryInfo.retryCount++;
        retryInfo.lastRetryTime = Date.now();

        if (retryInfo.retryCount <= this.maxRetries) {
            this.pendingRetries.set(bookId, retryInfo);
            logger.debug(`添加到重试队列`, { bookId, retryCount: retryInfo.retryCount });
        } else {
            this.pendingRetries.delete(bookId);
            logger.warn(`超过最大重试次数，停止重试`, { bookId, retryCount: retryInfo.retryCount });
        }
    }

    /**
     * 处理重试队列
     */
    async processRetries() {
        if (this.pendingRetries.size === 0) {
            return;
        }

        const now = Date.now();
        const toRetry = [];

        for (const [bookId, retryInfo] of this.pendingRetries.entries()) {
            // 检查是否到了重试时间
            if (!retryInfo.lastRetryTime || (now - retryInfo.lastRetryTime) >= this.retryDelay) {
                toRetry.push(retryInfo);
            }
        }

        if (toRetry.length === 0) {
            return;
        }

        logger.info(`处理 ${toRetry.length} 个重试任务`);

        // 并发处理重试（限制并发数）
        for (let i = 0; i < toRetry.length; i += this.maxConcurrent) {
            const batch = toRetry.slice(i, i + this.maxConcurrent);
            await Promise.allSettled(
                batch.map(async (retryInfo) => {
                    const result = await this.checkBookUpdate(retryInfo.bookId, retryInfo.lastChapterCount, 'retry');
                    
                    if (result.updated || !result.error) {
                        // 成功或没有错误，从重试队列移除
                        this.pendingRetries.delete(retryInfo.bookId);
                    }
                })
            );

            if (i + this.maxConcurrent < toRetry.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    /**
     * 手动检查指定书籍
     */
    async checkBook(bookId) {
        const subscription = db.prepare(`
            SELECT book_id, last_chapter_count 
            FROM book_subscriptions 
            WHERE book_id = ? 
            LIMIT 1
        `).get(bookId);

        if (!subscription) {
            throw new Error('未找到订阅记录');
        }

        return await this.checkBookUpdate(subscription.book_id, subscription.last_chapter_count, 'manual');
    }

    /**
     * 获取检查状态
     */
    getStatus() {
        return {
            isChecking: this.isChecking,
            lastCheckTime: this.lastCheckTime,
            checkCount: this.checkCount,
            updateCount: this.updateCount,
            errorCount: this.errorCount,
            pendingRetries: this.pendingRetries.size,
            checkInterval: this.checkInterval
        };
    }
}

// 创建订阅检查实例
const subscriptionChecker = new SubscriptionChecker();

module.exports = {
    PerformanceMonitor,
    performanceMonitor,
    SubscriptionChecker,
    subscriptionChecker
};