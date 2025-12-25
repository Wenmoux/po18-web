/*
 * File: config.js
 * Input: 环境变量process.env
 * Output: 全局配置对象，包含服务器、Session、PO18、数据库、下载、共享等配置
 * Pos: 全局配置中心，为所有服务端模块提供统一的配置参数
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

/**
 * PO18小说下载网站 - 配置文件
 */

module.exports = {
    // 服务器配置
    server: {
        port: process.env.PORT || 3000,
        host: "0.0.0.0"
    },

    // Session配置
    session: {
        secret: "po18-novel-downloader-secret-key-2024",
        resave: false,
        saveUninitialized: true,
        cookie: {
            secure: false, // 生产环境设为true
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7天
        }
    },

    // PO18网站配置
    po18: {
        baseUrl: "https://www.po18.tw",
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            "Sec-Ch-Ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
            Referer: "https://www.po18.tw/"
        },
        // 请求间隔（毫秒）- 优化：去除延迟，依靠并发控制
        requestDelay: 0,
        // 并发下载数 - 优化：参考1.js默认线程数
        concurrency: 8
    },

    // 共享书库配置（服务器本地目录）
    sharedLibrary: {
        path: "./shared", // 共享书库本地路径
        maxFileSize: 50, // 最大文件大小(MB)
        minBooksRequired: 3 // 需要上传多少本书才能访问
    },

    // 共享功能配置
    sharing: {
        privilegedUsers: ["admin"] // 管理员用户名列表
    },

    // 注册配置
    registration: {
        enabled: true // 默认值，会从数据库读取实际值
    },

    // 获取注册状态（从数据库读取）
    getRegistrationEnabled() {
        try {
            const db = require('better-sqlite3')('./data/po18.db');
            const result = db.prepare("SELECT value FROM system_config WHERE key = 'registration_enabled'").get();
            if (result) {
                return result.value === '1' || result.value === 'true';
            }
            return this.registration.enabled; // 如果数据库中没有，返回默认值
        } catch (error) {
            console.error('读取注册配置失败:', error);
            return this.registration.enabled;
        }
    },

    // 设置注册状态（保存到数据库）
    setRegistrationEnabled(enabled) {
        try {
            const db = require('better-sqlite3')('./data/po18.db');
            db.prepare(`
                INSERT INTO system_config (key, value, updated_at) 
                VALUES ('registration_enabled', ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
            `).run(enabled ? '1' : '0', enabled ? '1' : '0');
            this.registration.enabled = enabled;
            return true;
        } catch (error) {
            console.error('保存注册配置失败:', error);
            return false;
        }
    },

    // 数据库配置
    database: {
        path: "./data/po18.db"
    },

    // 下载配置
    download: {
        // 临时文件目录
        tempDir: "./temp",
        // 下载文件目录
        downloadDir: "./downloads",
        // 支持的格式
        formats: ["txt", "html", "epub"]
    }
};
