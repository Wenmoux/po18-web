/*
 * File: logger.js
 * Input: date-fns, 本地文件系统
 * Output: Logger类，提供多级别日志记录（error/warn/info/debug）和日志查询功能
 * Pos: 日志系统，记录用户操作、管理员操作、API请求、系统错误等日志，支持文件持久化
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

/**
 * PO18小说下载网站 - 日志管理模块
 */

const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

class Logger {
    constructor(options = {}) {
        this.logDir = options.logDir || './logs';
        this.logLevel = options.logLevel || 'info';
        
        // 确保日志目录存在
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        
        // 日志级别映射
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }
    
    /**
     * 记录日志
     * @param {string} level 日志级别
     * @param {string} message 日志消息
     * @param {object} metadata 元数据
     */
    log(level, message, metadata = {}) {
        // 检查日志级别
        if (this.levels[level] > this.levels[this.logLevel]) {
            return;
        }
        
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            metadata,
            pid: process.pid
        };
        
        // 控制台输出
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, metadata);
        
        // 写入文件
        this.writeToFile(logEntry);
        
        // 如果是错误日志，额外写入错误日志文件
        if (level === 'error') {
            this.writeToErrorFile(logEntry);
        }
    }
    
    /**
     * 写入通用日志文件
     */
    writeToFile(logEntry) {
        const date = format(new Date(), 'yyyy-MM-dd');
        const logFile = path.join(this.logDir, `app-${date}.log`);
        const logLine = JSON.stringify(logEntry) + '\n';
        
        fs.appendFileSync(logFile, logLine);
    }
    
    /**
     * 写入错误日志文件
     */
    writeToErrorFile(logEntry) {
        const date = format(new Date(), 'yyyy-MM-dd');
        const errorFile = path.join(this.logDir, `error-${date}.log`);
        const logLine = JSON.stringify(logEntry) + '\n';
        
        fs.appendFileSync(errorFile, logLine);
    }
    
    /**
     * 记录错误日志
     */
    error(message, metadata) {
        this.log('error', message, metadata);
    }
    
    /**
     * 记录警告日志
     */
    warn(message, metadata) {
        this.log('warn', message, metadata);
    }
    
    /**
     * 记录信息日志
     */
    info(message, metadata) {
        this.log('info', message, metadata);
    }
    
    /**
     * 记录调试日志
     */
    debug(message, metadata) {
        this.log('debug', message, metadata);
    }
    
    /**
     * 记录API请求日志
     */
    logRequest(req, res, next) {
        const startTime = Date.now();
        
        // 响应结束后记录日志
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            const logData = {
                method: req.method,
                url: req.url,
                statusCode: res.statusCode,
                duration: `${duration}ms`,
                userAgent: req.get('User-Agent'),
                ip: req.ip || req.connection.remoteAddress,
                userId: req.session?.userId || null
            };
            
            if (res.statusCode >= 400) {
                this.warn(`API请求: ${req.method} ${req.url}`, logData);
            } else {
                this.info(`API请求: ${req.method} ${req.url}`, logData);
            }
        });
        
        next();
    }    
    /**
     * 记录用户操作日志
     */
    logUserAction(userId, action, details = {}) {
        const logData = {
            userId,
            action,
            ...details
        };
        
        this.info(`用户操作: ${action}`, logData);
    }
    
    /**
     * 记录管理员操作日志
     */
    logAdminAction(userId, action, details = {}) {
        const logData = {
            userId,
            action,
            ...details
        };
        
        this.info(`管理员操作: ${action}`, logData);
    }
    
    /**
     * 记录系统事件日志
     */
    logSystemEvent(event, details = {}) {
        const logData = {
            event,
            ...details
        };
        
        this.info(`系统事件: ${event}`, logData);
    }
    
    /**
     * 查询日志
     */
    queryLogs(options = {}) {
        const {
            level = 'info',
            startDate,
            endDate,
            limit = 100,
            offset = 0
        } = options;
        
        // 实现日志查询逻辑
        // 这里只是一个简单的示例，实际应用中可能需要更复杂的查询逻辑
        const date = format(new Date(), 'yyyy-MM-dd');
        const logFile = path.join(this.logDir, `app-${date}.log`);
        
        if (!fs.existsSync(logFile)) {
            return [];
        }
        
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.split('\n').filter(line => line.trim() !== '');
        
        let logs = lines.map(line => {
            try {
                return JSON.parse(line);
            } catch (e) {
                return null;
            }
        }).filter(log => log !== null);
        
        // 根据级别过滤
        if (this.levels[level] < this.levels['debug']) {
            logs = logs.filter(log => this.levels[log.level] <= this.levels[level]);
        }
        
        // 根据日期过滤
        if (startDate) {
            logs = logs.filter(log => new Date(log.timestamp) >= new Date(startDate));
        }
        
        if (endDate) {
            logs = logs.filter(log => new Date(log.timestamp) <= new Date(endDate));
        }
        
        // 分页
        logs = logs.slice(offset, offset + limit);
        
        return logs;
    }
    
    /**
     * 导出日志为CSV格式
     */
    exportLogsToCSV(options = {}) {
        const logs = this.queryLogs(options);
        let csv = 'Timestamp,Level,Message,Metadata\n';
        
        logs.forEach(log => {
            const metadata = JSON.stringify(log.metadata).replace(/"/g, '""');
            csv += `"${log.timestamp}","${log.level}","${log.message.replace(/"/g, '""')}","${metadata}"\n`;
        });
        
        return csv;
    }
}

// 创建全局日志实例
const logger = new Logger();

module.exports = {
    Logger,
    logger
};