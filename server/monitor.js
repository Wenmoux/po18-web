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
const { db, SubscriptionDB, BookMetadataDB } = require('./database');
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
            logger.info('性能监控已停止');
        }
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
        
        // 计算CPU使用率
        let cpuUsage = 0;
        if (cpus.length > 0) {
            const cpu = cpus[0];
            const total = Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0);
            const idle = cpu.times.idle;
            cpuUsage = ((total - idle) / total) * 100;
        }
        
        // 获取磁盘使用情况
        let diskUsage = 0;
        try {
            const dbPath = path.dirname(config.database.path);
            const diskStats = fs.statSync(dbPath);
            // 这里简化处理，实际应该使用更精确的方法获取磁盘使用率
            diskUsage = 50; // 示例值
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
                usagePercent: diskUsage
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
        // 这里需要从实际的API请求中收集指标
        // 在实际应用中，可以通过中间件来收集API响应时间等指标
        return {
            requestCount: 0,
            averageResponseTime: 0,
            errorRate: 0,
            slowRequests: []
        };
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
 * 订阅更新检测类
 */
class SubscriptionChecker {
    constructor(options = {}) {
        this.checkInterval = options.checkInterval || 30 * 60 * 1000; // 默认30分钟检查一次
        this.maxConcurrent = options.maxConcurrent || 5; // 最大并发检查数
        this.checkTimer = null;
        this.isChecking = false;
        this.lastCheckTime = null;
        this.checkCount = 0;
        this.updateCount = 0;
    }

    /**
     * 启动订阅检查
     */
    startChecking() {
        logger.info('启动订阅更新检查', {
            interval: `${this.checkInterval / 1000 / 60}分钟`,
            maxConcurrent: this.maxConcurrent
        });

        // 立即执行一次检查
        this.checkAllSubscriptions();

        // 定期检查
        this.checkTimer = setInterval(() => {
            this.checkAllSubscriptions();
        }, this.checkInterval);
    }

    /**
     * 停止订阅检查
     */
    stopChecking() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
            logger.info('订阅更新检查已停止');
        }
    }

    /**
     * 检查所有订阅的更新
     */
    async checkAllSubscriptions() {
        if (this.isChecking) {
            logger.debug('正在检查中，跳过本次任务');
            return;
        }

        this.isChecking = true;
        this.lastCheckTime = new Date();
        this.checkCount++;

        try {
            // 获取所有需要检查的订阅
            const subscriptions = SubscriptionDB.getAllForCheck();
            
            if (subscriptions.length === 0) {
                logger.debug('没有需要检查的订阅');
                this.isChecking = false;
                return;
            }

            logger.info(`开始检查 ${subscriptions.length} 个订阅的更新`);

            let updatedCount = 0;
            let errorCount = 0;

            // 分批处理，避免并发过多
            for (let i = 0; i < subscriptions.length; i += this.maxConcurrent) {
                const batch = subscriptions.slice(i, i + this.maxConcurrent);
                const results = await Promise.allSettled(
                    batch.map(sub => this.checkBookUpdate(sub.book_id, sub.last_chapter_count))
                );

                // 统计结果
                results.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value) {
                        updatedCount++;
                    } else if (result.status === 'rejected') {
                        errorCount++;
                        logger.warn(`检查订阅失败`, {
                            bookId: batch[index].book_id,
                            error: result.reason?.message
                        });
                    }
                });

                // 避免过快请求，每批次间隔等待2秒
                if (i + this.maxConcurrent < subscriptions.length) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            this.updateCount += updatedCount;

            logger.info(`订阅检查完成`, {
                total: subscriptions.length,
                updated: updatedCount,
                errors: errorCount,
                duration: `${(Date.now() - this.lastCheckTime.getTime()) / 1000}s`
            });

        } catch (error) {
            logger.error('检查订阅更新失败', { error: error.message });
        } finally {
            this.isChecking = false;
        }
    }

    /**
     * 检查单个书籍的更新
     * 修改为检查用户订阅数据和服务器元数据之间的差异，不访问网站
     */
    async checkBookUpdate(bookId, lastChapterCount) {
        try {
            // 从本地元数据库获取书籍信息
            const bookMetadata = BookMetadataDB.get(bookId);
            
            if (!bookMetadata) {
                logger.debug(`本地无书籍元数据: ${bookId}`);
                return false;
            }

            const currentChapterCount = bookMetadata.total_chapters || 0;

            // 如果章节数增加，标记为有更新
            if (currentChapterCount > lastChapterCount) {
                SubscriptionDB.markUpdate(bookId, currentChapterCount);
                
                const newChapters = currentChapterCount - lastChapterCount;
                logger.info(`发现更新`, {
                    bookId,
                    title: bookMetadata.title,
                    oldCount: lastChapterCount,
                    newCount: currentChapterCount,
                    newChapters
                });

                return true;
            }

            return false;
        } catch (error) {
            logger.debug(`检查书籍失败: ${bookId}`, { error: error.message });
            throw error;
        }
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