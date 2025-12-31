/*
 * File: routes.js
 * Input: Express Router, database.js, crawler.js, webdav.js, config.js, logger.js, backup.js, monitor.js
 * Output: Express路由实例，定义所有RESTful API端点
 * Pos: API路由层，处理所有HTTP请求，调用对应的业务逻辑模块
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

/**
 * PO18小说下载网站 - API路由模块
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const { parseStringPromise } = require("xml2js");

const {
    db,
    UserDB,
    LibraryDB,
    QueueDB,
    PurchasedDB,
    SharedDB,
    HistoryDB,
    BookMetadataDB,
    WebDAVConfigDB,
    ChapterCacheDB,
    BookshelfDB,
    BookshelfCategoryDB,
    ReadingStatsDB,
    SubscriptionDB,
    BookListDB,
    BookListCommentDB,
    GameDB
} = require("./database");
const { NovelCrawler, ContentFormatter, EpubGenerator } = require("./crawler");
const WebDAVClient = require("./webdav");
const config = require("./config");
const { logger } = require("./logger");
const { databaseBackup } = require("./backup");
const { performanceMonitor } = require("./monitor");

// ==================== ID遍历爬取状态 ====================
const crawlerState = {
    isRunning: false,
    startId: 0,
    endId: 0,
    currentId: 0,
    successCount: 0,
    failCount: 0,
    totalProcessed: 0,
    startTime: null,
    logs: [],
    abortController: null,
    // 并发相关
    concurrency: 1, // 并发线程数
    activeThreads: 0, // 当前活跃线程数
    pendingQueue: [], // 待处理ID队列

    addLog(message, type = "info") {
        const log = {
            time: new Date().toLocaleTimeString(),
            message,
            type
        };
        this.logs.unshift(log);
        // 只保留最新100条日志
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(0, 100);
        }
        console.log(`[Crawler] ${message}`);
        
        // 记录到系统日志
        logger.log(type, `[Crawler] ${message}`);
    },

    reset() {
        this.isRunning = false;
        this.currentId = 0;
        this.successCount = 0;
        this.failCount = 0;
        this.totalProcessed = 0;
        this.startTime = null;
        this.logs = [];
        this.abortController = null;
        this.concurrency = 1;
        this.activeThreads = 0;
        this.pendingQueue = [];
    },

    getStatus() {
        const elapsed = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
        const totalIds = this.endId - this.startId + 1;
        const avgSpeed = elapsed > 0 ? Math.round((this.totalProcessed / elapsed) * 60) : 0; // 每分钟处理数

        return {
            isRunning: this.isRunning,
            startId: this.startId,
            endId: this.endId,
            currentId: this.currentId,
            successCount: this.successCount,
            failCount: this.failCount,
            totalProcessed: this.totalProcessed,
            progress: totalIds > 0 ? Math.round((this.totalProcessed / totalIds) * 100) : 0,
            elapsedSeconds: elapsed,
            concurrency: this.concurrency,
            activeThreads: this.activeThreads,
            pendingCount: this.pendingQueue.length,
            avgSpeed: avgSpeed,
            estimatedRemaining: avgSpeed > 0 ? Math.round((totalIds - this.totalProcessed) / avgSpeed) : 0, // 预计剩余分钟数
            logs: this.logs.slice(0, 20)
        };
    }
};

// 中间件：检查登录状态（包含单点登录验证）
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        logger.warn("未登录访问受保护资源", { url: req.url, ip: req.ip });
        return res.status(401).json({ error: "请先登录" });
    }

    // 单点登录验证：检查 session token 是否有效
    if (req.session.sessionToken) {
        const isValid = UserDB.validateSessionToken(req.session.userId, req.session.sessionToken);
        if (!isValid) {
            logger.info("用户会话已失效", { userId: req.session.userId });
            req.session.destroy();
            return res.status(401).json({
                error: "您的账号已在其他设备登录，当前会话已失效",
                code: "SESSION_KICKED"
            });
        }
    }

    next();
};

// 中间件：记录用户操作日志
const logUserAction = (action) => {
    return (req, res, next) => {
        // 在响应结束后记录操作日志
        res.on('finish', function() {
            if (req.session.userId) {
                logger.logUserAction(req.session.userId, action, {
                    url: req.url,
                    method: req.method,
                    statusCode: res.statusCode,
                    userAgent: req.get('User-Agent'),
                    ip: req.ip || req.connection.remoteAddress
                });
            }
        });
        next();
    };
};
// 中间件：记录管理员操作日志
const logAdminAction = (action) => {
    return (req, res, next) => {
        // 在响应结束后记录操作日志
        res.on('finish', function() {
            if (req.session.userId) {
                logger.logAdminAction(req.session.userId, action, {
                    url: req.url,
                    method: req.method,
                    statusCode: res.statusCode,
                    userAgent: req.get('User-Agent'),
                    ip: req.ip || req.connection.remoteAddress
                });
            }
        });
        next();
    };
};// ==================== 用户认证 API ====================

// 注册
router.post("/auth/register", async (req, res) => {
    try {
        // 检查注册是否开放
        if (!config.getRegistrationEnabled()) {
            return res.status(403).json({ error: "注册功能已关闭，请联系管理员" });
        }

        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: "用户名和密码不能为空" });
        }

        if (username.length < 3 || password.length < 6) {
            return res.status(400).json({ error: "用户名至少3位，密码至少6位" });
        }

        // 检查用户名是否存在
        const existing = UserDB.findByUsername(username);
        if (existing) {
            return res.status(400).json({ error: "用户名已存在" });
        }

        // 创建用户（生产环境应该加密密码）
        const result = UserDB.create(username, password);

        // 生成单点登录 token
        const sessionToken = uuidv4();
        UserDB.updateSessionToken(result.lastInsertRowid, sessionToken);

        // 自动登录
        req.session.userId = result.lastInsertRowid;
        req.session.username = username;
        req.session.sessionToken = sessionToken;

        res.json({ success: true, message: "注册成功" });
    } catch (error) {
        console.error("注册失败:", error);
        res.status(500).json({ error: "注册失败" });
    }
});

// 登录
router.post("/auth/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = UserDB.findByUsername(username);
        if (!user || user.password !== password) {
            return res.status(401).json({ error: "用户名或密码错误" });
        }

        // 生成新的 session token（单点登录：会使其他设备的 token 失效）
        const sessionToken = uuidv4();
        UserDB.updateSessionToken(user.id, sessionToken);

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.sessionToken = sessionToken;

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                shareEnabled: user.share_enabled === 1,
                sharedBooksCount: user.shared_books_count
            }
        });
    } catch (error) {
        console.error("登录失败:", error);
        res.status(500).json({ error: "登录失败" });
    }
});

// 登出
router.post("/auth/logout", (req, res) => {
    // 清除数据库中的 session token
    if (req.session.userId) {
        UserDB.clearSessionToken(req.session.userId);
    }
    req.session.destroy();
    res.json({ success: true });
});

// 获取当前用户信息
router.get("/auth/me", requireLogin, (req, res) => {
    const user = UserDB.findById(req.session.userId);
    if (!user) {
        return res.status(404).json({ error: "用户不存在" });
    }

    res.json({
        id: user.id,
        username: user.username,
        hasPo18Cookie: !!user.po18_cookie,
        hasWebDAV: !!user.webdav_config,
        shareEnabled: user.share_enabled === 1,
        sharedBooksCount: user.shared_books_count,
        canAccessShared: UserDB.canAccessSharedLibrary(user.id),
        hasCacheAuth: UserDB.hasCacheAuth(user.id), // 全站书库权限
        hasLibraryAuth: UserDB.hasLibraryAuth(user.id) // 云端书库权限
    });
});

// ==================== PO18 Cookie 管理 ====================

// 获取PO18 Cookie
router.get("/po18/cookie", requireLogin, (req, res) => {
    try {
        const user = UserDB.findById(req.session.userId);
        res.json({
            cookie: user?.po18_cookie || "",
            hasCookie: !!user?.po18_cookie
        });
    } catch (error) {
        res.status(500).json({ error: "获取Cookie失败" });
    }
});

// 设置PO18 Cookie
router.post("/po18/cookie", requireLogin, async (req, res) => {
    try {
        let { cookie } = req.body;

        if (!cookie) {
            return res.status(400).json({ error: "Cookie不能为空" });
        }

        // 清理cookie中的非法字符
        if (typeof cookie === "string") {
            cookie = cookie.trim().replace(/[\r\n]+/g, "");
        }

        // 验证Cookie
        const crawler = new NovelCrawler(cookie);
        const isValid = await crawler.validateCookie();

        if (!isValid) {
            return res.status(400).json({ error: "Cookie无效或已过期" });
        }

        // 保存清理后的Cookie
        UserDB.updatePo18Cookie(req.session.userId, cookie);

        res.json({ success: true, message: "Cookie设置成功" });
    } catch (error) {
        console.error("设置Cookie失败:", error);
        res.status(500).json({ error: "设置Cookie失败" });
    }
});

// 验证PO18 Cookie
router.get("/po18/validate", requireLogin, async (req, res) => {
    try {
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.json({ valid: false, message: "未设置Cookie" });
        }

        const crawler = new NovelCrawler(user.po18_cookie);
        const isValid = await crawler.validateCookie();

        res.json({ valid: isValid });
    } catch (error) {
        res.json({ valid: false, message: "验证失败" });
    }
});

// 批量保存书籍元信息（用于油猴脚本）
router.post("/metadata/batch", async (req, res) => {
    try {
        const { books } = req.body;

        if (!books || !Array.isArray(books)) {
            return res.status(400).json({
                success: false,
                error: "参数错误：books必须是数组"
            });
        }

        if (books.length === 0) {
            return res.json({
                success: true,
                stats: { success: 0, failed: 0, errors: [] }
            });
        }

        console.log(`收到批量元信息请求，共 ${books.length} 本书籍`);

        const results = {
            success: 0,
            failed: 0,
            errors: []
        };

        for (const book of books) {
            try {
                // 验证必填字段
                if (!book.bookId || !book.title) {
                    results.failed++;
                    results.errors.push(`书籍缺少必填字段: ${JSON.stringify(book)}`);
                    continue;
                }

                // 保存到数据库（字段统一）
                BookMetadataDB.upsert({
                    bookId: book.bookId,
                    title: book.title,
                    author: book.author || "",
                    cover: book.cover || "",
                    description: book.descriptionHTML || book.description || "",  // 优先使用HTML版本
                    descriptionHTML: book.descriptionHTML || book.description || "",  // 添加HTML版本
                    tags: book.tags || "",
                    category: book.tags ? book.tags.split("·")[0] : "",
                    status: book.status || "unknown",
                    wordCount: book.wordCount || 0,
                    freeChapters: book.freeChapters || 0,
                    paidChapters: book.paidChapters || 0,
                    totalChapters: book.totalChapters || book.chapterCount || 0,
                    subscribedChapters: book.subscribedChapters || book.chapterCount || 0,
                    latestChapterName: book.latestChapterName || "",
                    latestChapterDate: book.latestChapterDate || "",
                    platform: book.platform || "po18",
                    favoritesCount: book.favoritesCount || 0,
                    commentsCount: book.commentsCount || 0,
                    monthlyPopularity: book.monthlyPopularity || 0,
                    weeklyPopularity: book.weeklyPopularity || 0,
                    dailyPopularity: book.dailyPopularity || 0,
                    totalPopularity: book.totalPopularity || 0,
                    purchaseCount: book.purchaseCount || 0,
                    readersCount: book.readersCount || 0,
                    detailUrl: book.detailUrl || (book.platform === 'popo' ? `https://www.popo.tw/books/${book.bookId}` : `https://www.po18.tw/books/${book.bookId}/articles`),
                    uploader: book.uploader || "unknown_user",  // 添加上传者用户名
                    uploaderId: book.uploaderId || "unknown"  // 添加上传者ID
                });

                results.success++;
                console.log(`✓ 保存成功: ${book.title} (ID: ${book.bookId})`);
            } catch (error) {
                results.failed++;
                results.errors.push(`保存失败 ${book.title}: ${error.message}`);
                console.error(`✗ 保存失败: ${book.title}`, error);
            }
        }

        console.log(`批量保存完成: 成功 ${results.success} 本，失败 ${results.failed} 本`);

        res.json({
            success: true,
            stats: results
        });
    } catch (error) {
        console.error("批量保存元信息失败:", error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 删除书籍的所有章节缓存（用于修复错误数据）
router.delete("/chapters/:bookId", async (req, res) => {
    try {
        const { bookId } = req.params;

        if (!bookId) {
            return res.status(400).json({ success: false, error: "缺少书籍ID" });
        }

        const db = require("better-sqlite3")("./data/po18.db");

        // 获取该书籍的章节数
        const countResult = db.prepare("SELECT COUNT(*) as count FROM chapter_cache WHERE book_id = ?").get(bookId);
        const chapterCount = countResult?.count || 0;

        // 删除该书籍的所有章节
        const result = db.prepare("DELETE FROM chapter_cache WHERE book_id = ?").run(bookId);

        console.log(`[删除章节] 书籍ID: ${bookId}, 删除了 ${result.changes} 章`);

        res.json({
            success: true,
            message: `已删除 ${result.changes} 章缓存`,
            deletedCount: result.changes
        });
    } catch (error) {
        console.error("删除章节失败:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 删除指定章节缓存
router.delete("/chapters/:bookId/:chapterId", async (req, res) => {
    try {
        const { bookId, chapterId } = req.params;

        const db = require("better-sqlite3")("./data/po18.db");
        const result = db
            .prepare("DELETE FROM chapter_cache WHERE book_id = ? AND chapter_id = ?")
            .run(bookId, chapterId);

        console.log(`[删除章节] 书籍ID: ${bookId}, 章节ID: ${chapterId}`);

        res.json({
            success: true,
            deleted: result.changes > 0
        });
    } catch (error) {
        console.error("删除章节失败:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== 个人WebDAV 配置 ====================

// 获取个人WebDAV配置
// ==================== WebDAV配置 API ====================

// 获取用户WebDAV配置列表
router.get("/webdav/configs", requireLogin, (req, res) => {
    try {
        const configs = WebDAVConfigDB.getAll(req.session.userId);
        res.json(
            configs.map((c) => ({
                id: c.id,
                name: c.name,
                url: c.url,
                username: c.username,
                basePath: c.base_path,
                isDefault: c.is_default === 1,
                isEnabled: c.is_enabled === 1,
                createdAt: c.created_at
            }))
        );
    } catch (error) {
        res.status(500).json({ error: "获取配置失败" });
    }
});

// 添加WebDAV配置
router.post("/webdav/configs", requireLogin, (req, res) => {
    try {
        const { name, url, username, password, basePath, isDefault } = req.body;

        if (!name || !url || !username || !password) {
            return res.status(400).json({ error: "请填写完整配置" });
        }

        const result = WebDAVConfigDB.add(req.session.userId, {
            name,
            url,
            username,
            password,
            basePath: basePath || "/",
            isDefault: isDefault || false
        });

        // 如果设置为默认，更新其他配置
        if (isDefault) {
            WebDAVConfigDB.setDefault(req.session.userId, result.lastInsertRowid);
        }

        res.json({ success: true, message: "配置已添加", id: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: "添加配置失败: " + error.message });
    }
});

// 更新WebDAV配置
router.put("/webdav/configs/:id", requireLogin, (req, res) => {
    try {
        const { id } = req.params;
        const { name, url, username, password, basePath, isDefault, isEnabled } = req.body;

        WebDAVConfigDB.update(parseInt(id), {
            name,
            url,
            username,
            password,
            basePath,
            isDefault,
            isEnabled
        });

        if (isDefault) {
            WebDAVConfigDB.setDefault(req.session.userId, parseInt(id));
        }

        res.json({ success: true, message: "配置已更新" });
    } catch (error) {
        res.status(500).json({ error: "更新配置失败" });
    }
});

// 设置默认WebDAV
router.post("/webdav/configs/:id/set-default", requireLogin, (req, res) => {
    try {
        const { id } = req.params;
        WebDAVConfigDB.setDefault(req.session.userId, parseInt(id));
        res.json({ success: true, message: "已设置为默认" });
    } catch (error) {
        res.status(500).json({ error: "设置失败" });
    }
});

// 切换WebDAV启用状态
router.post("/webdav/configs/:id/toggle", requireLogin, (req, res) => {
    try {
        const { id } = req.params;
        WebDAVConfigDB.toggleEnabled(parseInt(id));
        res.json({ success: true, message: "状态已更新" });
    } catch (error) {
        res.status(500).json({ error: "更新失败" });
    }
});

// 删除WebDAV配置
router.delete("/webdav/configs/:id", requireLogin, (req, res) => {
    try {
        const { id } = req.params;
        WebDAVConfigDB.delete(parseInt(id));
        res.json({ success: true, message: "配置已删除" });
    } catch (error) {
        res.status(500).json({ error: "删除失败" });
    }
});

// 测试WebDAV连接
router.post("/webdav/test", requireLogin, async (req, res) => {
    try {
        const { url, username, password } = req.body;

        if (!url || !username || !password) {
            return res.status(400).json({ error: "请填写完整配置" });
        }

        const client = new WebDAVClient({ url, username, password });
        const result = await client.testConnection();

        res.json(result);
    } catch (error) {
        res.status(400).json({ error: "连接失败: " + error.message });
    }
});

// ==================== 搜索 API ====================

// 搜索小说
// 获取预设字体列表
router.get("/fonts", async (req, res) => {
    try {
        const fontsDir = path.join(__dirname, "../data/fonts");
        const fontFiles = [];
        
        // 检查目录是否存在
        if (!fs.existsSync(fontsDir)) {
            return res.json({ fonts: [] });
        }
        
        // 读取目录中的所有文件
        const files = fs.readdirSync(fontsDir);
        const validExtensions = ['.ttf', '.otf', '.woff', '.woff2'];
        
        for (const file of files) {
            const filePath = path.join(fontsDir, file);
            const stat = fs.statSync(filePath);
            
            // 只处理文件（不包括目录和 README.md）
            if (stat.isFile() && file !== 'README.md') {
                const ext = path.extname(file).toLowerCase();
                if (validExtensions.includes(ext)) {
                    const fontName = path.basename(file, ext);
                    fontFiles.push({
                        name: fontName,
                        filename: file,
                        url: `/data/fonts/${file}`,
                        format: ext.substring(1) // 移除点号
                    });
                }
            }
        }
        
        res.json({ fonts: fontFiles });
    } catch (error) {
        console.error("获取字体列表失败:", error);
        logger.error("获取字体列表失败", { error: error.message });
        res.status(500).json({ error: "获取字体列表失败" });
    }
});

// 搜索书籍（从元信息数据库搜索，关联共享书库）
router.get("/search", requireLogin, async (req, res) => {
    try {
        const { keyword } = req.query;

        if (!keyword) {
            return res.status(400).json({ error: "请输入搜索关键词" });
        }

        // 从元信息数据库搜索，限制前20条
        const metaResults = BookMetadataDB.search(keyword).slice(0, 20);

        if (metaResults.length === 0) {
            return res.json({ books: [], message: "未找到相关书籍" });
        }

        // 获取共享书库中的对应书籍
        const sharedBooks = SharedDB.getAll();

        // 组合结果，按书籍ID分组
        const bookMap = new Map();

        for (const meta of metaResults) {
            const key = meta.book_id;
            if (!bookMap.has(key)) {
                bookMap.set(key, {
                    bookId: meta.book_id,
                    title: meta.title,
                    author: meta.author,
                    cover: meta.cover,
                    tags: meta.tags,
                    status: meta.status,
                    versions: []
                });
            }

            // 查找该版本在共享书库中的文件
            const sharedFiles = sharedBooks.filter(
                (s) => s.book_id === meta.book_id && s.chapter_count === meta.subscribed_chapters
            );

            bookMap.get(key).versions.push({
                totalChapters: meta.total_chapters,
                subscribedChapters: meta.subscribed_chapters,
                wordCount: meta.word_count,
                sharedFiles: sharedFiles.map((s) => ({
                    id: s.id,
                    format: s.format,
                    downloadCount: s.download_count,
                    webdavPath: s.webdav_path
                }))
            });
        }

        res.json({ books: Array.from(bookMap.values()) });
    } catch (error) {
        console.error("搜索失败:", error);
        res.status(500).json({ error: "搜索失败" });
    }
});

// 根据ID或链接获取书籍信息（必须在 /book/:bookId 之前，避免路由冲突）
router.get("/book/parse", requireLogin, async (req, res) => {
    console.log("===== PARSE API 被调用 =====");
    try {
        const { input } = req.query;
        console.log("解析书籍请求:", input);

        const bookId = parseBookIdOrUrl(input);
        console.log("解析得到bookId:", bookId);
        if (!bookId) {
            return res.status(400).json({ error: "无效的书籍ID或链接" });
        }

        console.log("解析得到bookId:", bookId);

        // 先从数据库缓存获取（使用get获取单个记录）
        try {
            const cached = BookMetadataDB.get(bookId);
            if (cached) {
                console.log("从缓存获取书籍信息:", cached.title);
                return res.json({
                    bookId: cached.book_id,
                    title: cached.title,
                    author: cached.author,
                    cover: cached.cover,
                    description: cached.description,
                    tags: cached.tags,
                    category: cached.category,
                    chapterCount: cached.total_chapters || cached.subscribed_chapters,
                    wordCount: cached.word_count,
                    freeChapters: cached.free_chapters,
                    paidChapters: cached.paid_chapters,
                    status: cached.status,
                    latestChapterName: cached.latest_chapter_name,
                    latestChapterDate: cached.latest_chapter_date,
                    platform: cached.platform,
                    favoritesCount: cached.favorites_count,
                    commentsCount: cached.comments_count,
                    monthlyPopularity: cached.monthly_popularity,
                    totalPopularity: cached.total_popularity,
                    detailUrl: cached.detail_url || (cached.platform === 'popo' ? `https://www.popo.tw/books/${bookId}` : `https://www.po18.tw/books/${bookId}/articles`),
                    fromCache: true
                });
            }
        } catch (cacheErr) {
            console.error("查询缓存失败:", cacheErr.message);
        }

        // 获取当前用户的Cookie（必须有）
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: "请先设置PO18 Cookie才能解析书籍" });
        }

        const crawler = new NovelCrawler(user.po18_cookie);

        const detail = await crawler.getDetail(bookId);

        // 检查是否解析成功
        if (detail.error) {
            return res.json({
                bookId: bookId,
                title: detail.title,
                author: detail.author,
                fromCache: false,
                hasError: true,
                error: detail.error
            });
        }

        // 保存元信息到缓存（仅在解析成功时）
        if (detail.title && !detail.title.startsWith("书籍 ") && !detail.error) {
            try {
                BookMetadataDB.upsert({
                    bookId: bookId,
                    title: detail.title,
                    author: detail.author || "",
                    cover: detail.cover || "",
                    description: detail.description || "",
                    tags: detail.tags || "",
                    category: detail.tags ? detail.tags.split("·")[0] : "",
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    status: detail.status || "unknown",
                    latestChapterName: detail.latestChapterName || "",
                    latestChapterDate: detail.latestChapterDate || "",
                    platform: detail.platform || "po18",
                    favoritesCount: detail.favoritesCount || 0,
                    commentsCount: detail.commentsCount || 0,
                    monthlyPopularity: detail.monthlyPopularity || 0,
                    totalPopularity: detail.totalPopularity || 0,
                    detailUrl: detail.detailUrl || ""
                });
                console.log("书籍信息已缓存:", detail.title);
            } catch (cacheErr) {
                console.error("缓存书籍信息失败:", cacheErr.message);
            }
        }

        // 返回结果
        res.json({
            bookId: bookId,
            title: detail.title,
            author: detail.author,
            cover: detail.cover,
            description: detail.description,
            tags: detail.tags,
            category: detail.tags ? detail.tags.split("·")[0] : "",
            chapterCount: detail.chapterCount,
            wordCount: detail.wordCount,
            freeChapters: detail.freeChapters,
            paidChapters: detail.paidChapters,
            status: detail.status,
            detailUrl: detail.detailUrl,
            fromCache: false,
            hasError: false
        });
    } catch (error) {
        console.error("解析书籍失败:", error);
        res.status(500).json({ error: "解析书籍失败: " + error.message });
    }
});

// 获取小说详情
router.get("/book/:bookId", async (req, res) => {
    try {
        const { bookId } = req.params;

        // 优先从数据库缓存获取
        const cached = BookMetadataDB.get(bookId);
        if (cached) {
            console.log(`[书籍详情] 从数据库读取: ${cached.title}`);
            return res.json({
                bookId: cached.book_id,
                title: cached.title,
                author: cached.author,
                cover: cached.cover,
                description: cached.description,
                tags: cached.tags,
                category: cached.category,
                chapterCount: cached.total_chapters || cached.subscribed_chapters || 0,
                wordCount: cached.word_count || 0,
                freeChapters: cached.free_chapters || 0,
                paidChapters: cached.paid_chapters || 0,
                status: cached.status || "unknown",
                latestChapterName: cached.latest_chapter_name || "",
                latestChapterDate: cached.latest_chapter_date || "",
                favoritesCount: cached.favorites_count || 0,
                commentsCount: cached.comments_count || 0,
                monthlyPopularity: cached.monthly_popularity || 0,
                fromCache: true
            });
        }

        console.log(`[书籍详情] 数据库无缓存，尝试爬取: ${bookId}`);

        // 获取用户Cookie（如果已登录）
        let cookie = null;
        if (req.session.userId) {
            const user = UserDB.findById(req.session.userId);
            cookie = user?.po18_cookie;
        }

        const crawler = new NovelCrawler(cookie);
        const detail = await crawler.getDetail(bookId);

        res.json(detail);
    } catch (error) {
        console.error("获取详情失败:", error);
        res.status(500).json({ error: "获取详情失败" });
    }
});

// ==================== 已购书籍 API ====================

// 获取已购书籍列表
router.get("/purchased", requireLogin, async (req, res) => {
    try {
        const { refresh } = req.query;
        const user = UserDB.findById(req.session.userId);

        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: "请先设置PO18 Cookie" });
        }

        // 如果不需要刷新，先从缓存获取
        if (!refresh) {
            let cached = PurchasedDB.getByUser(req.session.userId);
            if (cached.length > 0) {
                // 从元信息数据库补充cover等详细信息
                cached = cached.map((book) => {
                    const meta = BookMetadataDB.get(book.bookId || book.book_id);
                    if (meta) {
                        return {
                            ...book,
                            cover: meta.cover,
                            tags: meta.tags,
                            wordCount: meta.wordCount,
                            chapterCount: meta.totalChapters,
                            status: meta.status
                        };
                    }
                    return book;
                });
                return res.json({ books: cached, fromCache: true });
            }
        }

        // 从PO18获取
        const crawler = new NovelCrawler(user.po18_cookie);
        let books = await crawler.getPurchasedBooks();

        // 从元信息数据库补充cover等详细信息
        books = books.map((book) => {
            const meta = BookMetadataDB.get(book.bookId || book.book_id);
            if (meta) {
                return {
                    ...book,
                    cover: meta.cover,
                    tags: meta.tags,
                    wordCount: meta.wordCount,
                    chapterCount: meta.totalChapters,
                    status: meta.status
                };
            }
            return book;
        });

        // 清除旧缓存并保存新数据
        PurchasedDB.clearByUser(req.session.userId);
        for (const book of books) {
            PurchasedDB.upsert(req.session.userId, book);
        }

        res.json({ books, fromCache: false });
    } catch (error) {
        console.error("获取已购书籍失败:", error);
        res.status(500).json({ error: "获取已购书籍失败" });
    }
});

// ==================== 下载队列 API ====================

// 获取下载队列
router.get("/queue", requireLogin, (req, res) => {
    const queue = QueueDB.getByUser(req.session.userId);
    res.json(queue);
});

// 获取下载队列结果（完整数据）
router.get("/queue/:id/result", requireLogin, (req, res) => {
    console.log(`获取下载结果请求: queueId=${req.params.id}, userId=${req.session.userId}`);
    try {
        const queueId = parseInt(req.params.id);
        const queueItem = QueueDB.findById(queueId);

        console.log("队列项:", queueItem);

        if (!queueItem || queueItem.user_id !== req.session.userId) {
            console.log("队列不存在或权限不足");
            return res.status(404).json({ error: "队列不存在" });
        }

        if (queueItem.status !== "completed") {
            console.log(`下载未完成: status=${queueItem.status}`);
            return res.status(400).json({ error: "下载未完成" });
        }

        // 从数据库获取书籍详情
        const detail = BookMetadataDB.get(queueItem.book_id);
        if (!detail) {
            console.log(`书籍详情不存在: bookId=${queueItem.book_id}`);
            return res.status(404).json({ error: "书籍详情不存在" });
        }

        // 检查云端缓存权限，决定是否使用共享缓存
        const hasCacheAuth = UserDB.hasCacheAuth(req.session.userId);

        // 获取缓存章节（根据权限决定是否使用共享缓存）
        let cachedChapters = [];
        if (hasCacheAuth) {
            // 有权限，使用全局缓存
            cachedChapters = ChapterCacheDB.getByBook(queueItem.book_id);
            console.log(`[云端缓存] 缓存章节数: ${cachedChapters.length}`);
        } else {
            // 无权限，只能使用自己账号订阅的章节（需要重新下载）
            console.log(`[无云端权限] 无法使用共享缓存，返回空章节`);
        }

        // 生成文件名
        const sanitizedTitle = detail.title.replace(/[\\/:*?"<>|]/g, "_");
        const fileName = `${sanitizedTitle}.${queueItem.format}`;

        const responseData = {
            fileName,
            chapterCount: cachedChapters.length,
            detail: {
                title: detail.title,
                author: detail.author,
                cover: detail.cover,
                description: detail.description,
                tags: detail.tags ? detail.tags.split(",") : [],
                bookId: queueItem.book_id
            },
            chapters: cachedChapters.map((c, i) => ({
                index: i,
                title: c.title || `第${i + 1}章`,
                html: c.html || "",
                text: c.text || "",
                error: false
            }))
        };

        console.log(`返回数据: fileName=${fileName}, chapters=${responseData.chapters.length}`);
        res.json(responseData);
    } catch (error) {
        console.error("获取下载结果失败:", error);
        res.status(500).json({ error: error.message });
    }
});

// 添加到下载队列
router.post("/queue", requireLogin, async (req, res) => {
    try {
        const { bookId, format = "txt", autoShare = false } = req.body;
        console.error("保存元信息失败:", req.body);
        if (!bookId) {
            return res.status(400).json({ error: "书籍ID不能为空" });
        }

        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: "请先设置PO18 Cookie" });
        }

        // 获取书籍信息
        const crawler = new NovelCrawler(user.po18_cookie);
        const detail = await crawler.getDetail(bookId);

        // 保存元信息到数据库
        if (detail.title && !detail.title.startsWith("书籍 ")) {
            try {
                BookMetadataDB.upsert({
                    bookId: bookId,
                    title: detail.title,
                    author: detail.author || "",
                    cover: detail.cover || "",
                    description: detail.description || "",
                    tags: detail.tags || "",
                    category: detail.tags ? detail.tags.split("·")[0] : "",
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    status: detail.status || "unknown",
                    detailUrl: detail.detailUrl || ""
                });
            } catch (e) {
                console.error("保存元信息失败:", e.message);
            }
        }

        // 添加到队列
        const result = QueueDB.add(req.session.userId, {
            bookId,
            title: detail.title,
            author: detail.author,
            cover: detail.cover,
            format,
            autoShare: autoShare ? 1 : 0
        });

        res.json({ success: true, queueId: result.lastInsertRowid });
    } catch (error) {
        console.error("添加到队列失败:", error);
        res.status(500).json({ error: "添加到队列失败" });
    }
});

// 清空已完成的队列（必须在 /queue/:id 之前）
router.delete("/queue/completed", requireLogin, (req, res) => {
    QueueDB.clearCompleted(req.session.userId);
    res.json({ success: true });
});

// 从队列中删除
router.delete("/queue/:id", requireLogin, (req, res) => {
    const { id } = req.params;
    QueueDB.delete(req.session.userId, parseInt(id));
    res.json({ success: true });
});

// ==================== 下载 API ====================

// 下载进度SSE连接管理
const downloadProgressClients = new Map();

// SSE: 订阅下载进度
// SSE: 订阅下载进度 (不需要登录验证，因为EventSource不支持credentials)
router.get("/download/progress/:queueId", (req, res) => {
    const { queueId } = req.params;
    console.log("SSE连接请求, queueId:", queueId);

    // 通过queueId获取队列项来验证
    const queueItem = QueueDB.getById(parseInt(queueId));

    if (!queueItem) {
        // 队列项不存在，返回SSE错误消息后关闭
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.flushHeaders();
        res.write(`data: ${JSON.stringify({ type: "error", error: "队列项不存在" })}\n\n`);
        res.end();
        return;
    }

    const userId = queueItem.user_id;

    // 设置SSE头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // 发送初始连接消息
    res.write(`data: ${JSON.stringify({ type: "connected", queueId })}

`);

    // 保存连接
    const clientKey = `${userId}_${queueId}`;
    downloadProgressClients.set(clientKey, res);

    // 客户端断开时清理
    req.on("close", () => {
        downloadProgressClients.delete(clientKey);
    });
});

// 发送进度更新的辅助函数
function sendProgressUpdate(userId, queueId, data) {
    const clientKey = `${userId}_${queueId}`;
    const client = downloadProgressClients.get(clientKey);
    if (client) {
        try {
            client.write(`data: ${JSON.stringify(data)}

`);
        } catch (e) {
            downloadProgressClients.delete(clientKey);
        }
    }
}

// 开始下载（服务器端生成文件）
router.post("/download/start", requireLogin, async (req, res) => {
    try {
        const { queueId } = req.body;

        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: "请先设置PO18 Cookie" });
        }

        // 获取队列项
        const queue = QueueDB.getByUser(req.session.userId);
        const queueItem = queue.find((q) => q.id === queueId);

        if (!queueItem) {
            return res.status(404).json({ error: "队列项不存在" });
        }

        // 更新状态为下载中
        QueueDB.updateStatus(queueId, "downloading");

        // 开始下载
        const crawler = new NovelCrawler(user.po18_cookie);
        const detail = await crawler.getDetail(queueItem.book_id);

        // 检查详情是否有效
        if (detail.error) {
            console.error("获取书籍详情失败:", detail.error);
            throw new Error("获取书籍详情失败: " + detail.error);
        }

        // 获取章节列表
        const chapters = await crawler.getChapterList(queueItem.book_id, detail.pageNum);

        // 检查是否有可下载的章节
        if (!chapters || chapters.length === 0) {
            throw new Error("没有可下载的章节，可能需要在PO18网站购买后再下载");
        }

        QueueDB.updateStatus(queueId, "downloading", { totalChapters: chapters.length });

        // 发送开始下载的SSE消息
        sendProgressUpdate(req.session.userId, queueId, {
            type: "start",
            title: detail.title,
            totalChapters: chapters.length
        });

        // 下载所有章节（优先从数据库缓存读取）
        const contents = await crawler.downloadAllChapters(
            chapters,
            config.po18.concurrency,
            (completed, total) => {
                QueueDB.updateStatus(queueId, "downloading", {
                    progress: completed,
                    totalChapters: total
                });
                // 发送进度更新
                sendProgressUpdate(req.session.userId, queueId, {
                    type: "progress",
                    completed,
                    total,
                    percent: Math.round((completed / total) * 100)
                });
            },
            ChapterCacheDB
        );

        // 检查下载内容
        if (!contents || contents.length === 0) {
            throw new Error("章节内容下载失败");
        }

        // **新增：直接返回章节数据，由前端生成文件**
        const format = queueItem.format || "txt";
        const fileName = `${detail.title}_${queueItem.book_id}.${format}`;

        // 如果启用了WebDAV，服务器端生成并上传
        let webdavPath = null;
        const webdavConfig = WebDAVConfigDB.getDefault(req.session.userId);

        if (webdavConfig && webdavConfig.url) {
            // 生成文件并上传到WebDAV
            let fileContent, epubBuffer;

            if (format === "txt") {
                fileContent = ContentFormatter.toTxt(detail, contents);
            } else if (format === "epub") {
                epubBuffer = await EpubGenerator.generate(detail, contents);
            } else {
                fileContent = ContentFormatter.toHtml(detail, contents);
            }

            const tempDir = path.join(config.download.tempDir);
            fs.mkdirSync(tempDir, { recursive: true });
            const uploadFilePath = path.join(tempDir, fileName);

            if (format === "epub") {
                fs.writeFileSync(uploadFilePath, epubBuffer);
            } else {
                fs.writeFileSync(uploadFilePath, fileContent, "utf-8");
            }

            const client = new WebDAVClient({
                url: webdavConfig.url,
                username: webdavConfig.username,
                password: webdavConfig.password,
                path: webdavConfig.base_path
            });

            const uploadResult = await client.uploadBook(uploadFilePath, {
                title: detail.title,
                bookId: queueItem.book_id
            });

            if (uploadResult.success) {
                webdavPath = uploadResult.remotePath;
                console.log("WebDAV上传成功:", webdavPath);
            }

            // 删除临时文件
            try {
                fs.unlinkSync(uploadFilePath);
            } catch (e) {
                console.log("删除临时文件失败:", e.message);
            }
        }

        // 更新队列状态
        QueueDB.updateStatus(queueId, "completed", {
            totalChapters: chapters.length,
            webdavPath: webdavPath
        });

        // 添加到下载历史
        try {
            HistoryDB.add(req.session.userId, {
                bookId: queueItem.book_id,
                title: detail.title,
                author: detail.author,
                format: format,
                fileSize: 0, // 前端生成时不知道大小
                duration: 0,
                chapterCount: chapters.length
            });
        } catch (historyError) {
            console.error("添加下载历史失败:", historyError.message);
        }

        // **发送章节数据，不发送文件内容**
        sendProgressUpdate(req.session.userId, queueId, {
            type: "completed",
            fileName,
            chapterCount: chapters.length,
            // 返回章节数据和详情，由前端生成文件
            detail: {
                title: detail.title,
                author: detail.author,
                cover: detail.cover,
                description: detail.description,
                tags: detail.tags,
                bookId: queueItem.book_id
            },
            chapters: contents.map((c, i) => ({
                index: i,
                title: c.title || c.originalTitle || `第${i + 1}章`,
                html: c.html || "",
                text: c.text || "",
                error: c.error || false
            }))
        });

        res.json({
            success: true,
            fileName,
            chapterCount: chapters.length
        });
    } catch (error) {
        console.error("下载失败:", error);

        // 发送失败的SSE消息
        if (req.body.queueId) {
            sendProgressUpdate(req.session.userId, req.body.queueId, {
                type: "error",
                error: error.message
            });
            QueueDB.updateStatus(req.body.queueId, "failed", { errorMessage: error.message });
        }
        res.status(500).json({ error: "下载失败: " + error.message });
    }
});

// 下载文件
router.get("/download/file/:id", requireLogin, async (req, res) => {
    try {
        // URL解码，获取真实路径
        const id = decodeURIComponent(req.params.id);
        console.log("[WebDAV下载] 收到请求 ID:", id);

        // 从 WebDAV 获取书库列表
        const webdavConfigs = WebDAVConfigDB.getEnabled(req.session.userId);
        let book = null;
        let webdavClient = null;

        // 遍历所有启用的 WebDAV 配置
        for (const config of webdavConfigs) {
            try {
                const client = new WebDAVClient({
                    url: config.url,
                    username: config.username,
                    password: config.password,
                    path: config.base_path
                });

                const books = await client.getLibraryBooks();
                const found = books.find((b) => b.id === id || b.path === id);

                if (found) {
                    book = found;
                    webdavClient = client;
                    console.log("[WebDAV下载] 找到文件:", book.path);
                    break;
                }
            } catch (error) {
                console.error(`从 WebDAV "${config.name}" 查找书籍失败:`, error.message);
            }
        }

        if (!book) {
            console.error("[WebDAV下载] 未找到文件:", id);
            return res.status(404).json({ error: "文件不存在" });
        }

        // 从 WebDAV 下载文件
        console.log("[WebDAV下载] 开始下载:", book.path);
        const fileBuffer = await webdavClient.downloadFile(book.path);

        console.log("[WebDAV下载] 下载完成，类型:", typeof fileBuffer, "大小:", fileBuffer?.length);

        if (!fileBuffer) {
            return res.status(500).json({ error: "文件下载失败：无数据" });
        }

        const fileName = `${book.title}.${book.format}`;

        // 设置响应头
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        res.setHeader("Content-Length", fileBuffer.length);

        // 发送文件内容
        res.send(fileBuffer);
        console.log("[WebDAV下载] 发送完成");
    } catch (error) {
        console.error("[WebDAV下载] 错误:", error);
        res.status(500).json({ error: "下载文件失败: " + error.message });
    }
});

// ==================== 书库 API ====================

// 获取书库中的所有标签和作者 - 必须在 /library/:id 之前
router.get("/library/filters", requireLogin, (req, res) => {
    const books = LibraryDB.getByUser(req.session.userId);

    const tags = new Set();
    const authors = new Set();
    const formats = new Set();

    books.forEach((book) => {
        if (book.tags) {
            book.tags.split("·").forEach((t) => t.trim() && tags.add(t.trim()));
        }
        if (book.author) {
            authors.add(book.author);
        }
        if (book.format) {
            formats.add(book.format);
        }
    });

    res.json({
        tags: Array.from(tags).sort(),
        authors: Array.from(authors).sort(),
        formats: Array.from(formats)
    });
});

// 获取PO18分类标签列表
router.get("/library/categories", (req, res) => {
    const categories = [
        "高H",
        "1V1",
        "HNP",
        "HN",
        "PSM",
        "BG",
        "BL",
        "同人",
        "同性愛",
        "futa",
        "古代",
        "現代",
        "校園",
        "H校園",
        "都會",
        "奇幻",
        "仙俠",
        "末世",
        "玄幻",
        "科幻",
        "未來世界",
        "年上",
        "年下",
        "羅曼史",
        "網遊",
        "人獸",
        "娛樂圈",
        "狗血",
        "系統",
        "女尊",
        "強強",
        "肉文",
        "爽文",
        "虐心",
        "悲劇",
        "暗黑",
        "甜文",
        "喜劇",
        "萌文",
        "輕鬆",
        "清水",
        "快穿",
        "穿越",
        "重生",
        "星際",
        "冒險",
        "金手指",
        "女性向",
        "男性向",
        "輕小說",
        "耕美",
        "百合",
        "不限",
        "療癒",
        "青梅竹馬",
        "心情抒發",
        "靈異神怪",
        "二創",
        "異國",
        "骨科"
    ];
    res.json(categories);
});

// 获取我的书库（只使用WebDAV）
router.get("/library", requireLogin, async (req, res) => {
    try {
        const { tag, author, format, category } = req.query;

        // 获取用户已启用的WebDAV配置列表
        const webdavConfigs = WebDAVConfigDB.getEnabled(req.session.userId);

        // 未配置WebDAV，返回空列表
        if (!webdavConfigs || webdavConfigs.length === 0) {
            return res.json([]);
        }

        let allBooks = [];

        // 从所有已启用的WebDAV加载书籍
        for (const config of webdavConfigs) {
            try {
                const client = new WebDAVClient({
                    url: config.url,
                    username: config.username,
                    password: config.password,
                    path: config.base_path
                });

                const books = await client.getLibraryBooks();

                // 添加书库名称标识
                const booksWithSource = books.map((book) => ({
                    ...book,
                    sourceName: config.name,
                    sourceId: config.id
                }));

                allBooks = allBooks.concat(booksWithSource);
            } catch (error) {
                console.error(`从WebDAV "${config.name}" 加载失败:`, error.message);
            }
        }

        // 从元信息数据库补充详细信息
        allBooks = allBooks.map((book) => {
            const meta = BookMetadataDB.get(book.bookId);
            if (meta) {
                return {
                    ...book,
                    author: meta.author,
                    tags: meta.tags,
                    cover: meta.cover,
                    wordCount: meta.word_count,
                    status: meta.status
                };
            }
            return book;
        });

        // 标签/分类筛选
        if (tag) {
            allBooks = allBooks.filter((book) => book.tags && book.tags.includes(tag));
        }

        // 分类筛选
        if (category) {
            allBooks = allBooks.filter((book) => book.tags && book.tags.includes(category));
        }

        // 作者筛选
        if (author) {
            allBooks = allBooks.filter((book) => book.author && book.author.includes(author));
        }

        // 格式筛选
        if (format) {
            allBooks = allBooks.filter((book) => book.format === format);
        }

        res.json(
            allBooks.map((book) => ({
                ...book,
                fileSize: formatFileSize(book.size || book.file_size)
            }))
        );
    } catch (error) {
        console.error("获取书库失败:", error.message);
        res.status(500).json({ error: "获取书库失败: " + error.message });
    }
});

// 从书库删除
router.delete("/library/:id", requireLogin, async (req, res) => {
    try {
        const { id } = req.params;

        // 获取WebDAV配置
        const user = UserDB.findById(req.session.userId);
        const webdavConfig = user?.webdav_config ? JSON.parse(user.webdav_config) : null;

        if (!webdavConfig || !webdavConfig.url) {
            return res.status(400).json({ error: "未配置WebDAV" });
        }

        // 从WebDAV获取书籍信息
        const client = new WebDAVClient(webdavConfig);
        const books = await client.getLibraryBooks();
        const book = books.find((b) => b.id === id);

        if (!book) {
            return res.status(404).json({ error: "书籍不存在" });
        }

        // 从WebDAV删除文件
        await client.deleteFile(book.path);

        res.json({ success: true });
    } catch (error) {
        console.error("删除失败:", error);
        res.status(500).json({ error: "删除失败: " + error.message });
    }
});

// 匹配书籍（从元信息重新生成文件）
router.post("/library/match", requireLogin, async (req, res) => {
    try {
        const { libraryId, bookId } = req.body;

        if (!libraryId || !bookId) {
            return res.status(400).json({ error: "缺少参数" });
        }

        // 获取用户WebDAV配置
        const user = UserDB.findById(req.session.userId);
        const webdavConfig = user?.webdav_config ? JSON.parse(user.webdav_config) : null;

        if (!webdavConfig || !webdavConfig.url) {
            return res.status(400).json({ error: "未配置WebDAV" });
        }

        // 从WebDAV获取书库列表
        const client = new WebDAVClient(webdavConfig);
        const books = await client.getLibraryBooks();
        const book = books.find((b) => b.id === libraryId);

        if (!book) {
            return res.status(404).json({ error: "书籍不存在" });
        }

        // 从元信息数据库获取书籍信息
        const meta = BookMetadataDB.get(bookId);
        if (!meta) {
            return res.status(404).json({ error: "未找到书籍元信息" });
        }

        // 下载原文件到临时目录
        const tempDir = path.join(__dirname, "../temp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const oldFilePath = path.join(tempDir, book.filename);
        const fileBuffer = await client.downloadFile(book.path);
        fs.writeFileSync(oldFilePath, fileBuffer);

        // 生成新文件名：书名_ID.格式
        const format = path.extname(book.filename).substring(1);
        const newFilename = `${meta.title}_${bookId}.${format}`;
        const newFilePath = path.join(tempDir, newFilename);

        // 复制并重命名文件
        fs.copyFileSync(oldFilePath, newFilePath);
        fs.unlinkSync(oldFilePath);

        // 上传新文件到WebDAV
        const uploadResult = await client.uploadBook(newFilePath, {
            title: meta.title,
            bookId: bookId
        });

        if (!uploadResult.success) {
            throw new Error("上传失败");
        }

        // 删除WebDAV中的旧文件
        await client.deleteFile(book.path);

        // 删除临时文件
        fs.unlinkSync(newFilePath);

        res.json({
            success: true,
            message: "匹配成功",
            newFilename: newFilename
        });
    } catch (error) {
        console.error("匹配失败:", error);
        res.status(500).json({ error: "匹配失败: " + error.message });
    }
});

// ==================== 共享书库 API ====================

// WebDAV辅助函数 - 获取文件列表
async function getWebDAVFileList() {
    try {
        const { url, username, password, basePath } = config.sharedWebDAV;
        const fullUrl = url.replace(/\/$/, "") + basePath;

        const auth = Buffer.from(`${username}:${password}`).toString("base64");

        const response = await axios({
            method: "PROPFIND",
            url: fullUrl,
            headers: {
                Authorization: `Basic ${auth}`,
                Depth: "1",
                "Content-Type": "application/xml"
            },
            data: `<?xml version="1.0" encoding="utf-8"?>
                <D:propfind xmlns:D="DAV:">
                    <D:prop>
                        <D:displayname/>
                        <D:getcontentlength/>
                        <D:getlastmodified/>
                        <D:resourcetype/>
                    </D:prop>
                </D:propfind>`
        });

        const result = await parseStringPromise(response.data);
        const files = [];

        const responses = result["D:multistatus"]?.["D:response"] || result["d:multistatus"]?.["d:response"] || [];

        for (const res of responses) {
            const href = res["D:href"]?.[0] || res["d:href"]?.[0] || "";
            const propstat = res["D:propstat"]?.[0] || res["d:propstat"]?.[0] || {};
            const prop = propstat["D:prop"]?.[0] || propstat["d:prop"]?.[0] || {};

            const isCollection =
                prop["D:resourcetype"]?.[0]?.["D:collection"] || prop["d:resourcetype"]?.[0]?.["d:collection"];

            if (!isCollection && href !== basePath) {
                const name = decodeURIComponent(href.split("/").pop());
                const size = parseInt(prop["D:getcontentlength"]?.[0] || prop["d:getcontentlength"]?.[0] || "0");
                const lastModified = prop["D:getlastmodified"]?.[0] || prop["d:getlastmodified"]?.[0] || "";

                if (name && (name.endsWith(".txt") || name.endsWith(".html") || name.endsWith(".epub"))) {
                    files.push({
                        name,
                        path: href,
                        size,
                        lastModified,
                        format: name.split(".").pop()
                    });
                }
            }
        }

        return files;
    } catch (error) {
        console.error("WebDAV获取文件列表失败:", error.message);
        return [];
    }
}

// WebDAV辅助函数 - 下载文件
async function downloadFromWebDAV(filePath) {
    try {
        const { url, username, password } = config.sharedWebDAV;
        const fullUrl = url.replace(/\/$/, "") + filePath;
        const auth = Buffer.from(`${username}:${password}`).toString("base64");

        console.log("WebDAV下载:", fullUrl);

        const response = await axios({
            method: "GET",
            url: fullUrl,
            headers: {
                Authorization: `Basic ${auth}`
            },
            responseType: "arraybuffer",
            timeout: 20000
        });

        // 确保返回的是Buffer
        if (response.data) {
            const data = response.data;
            // 如果是ArrayBuffer，转换为Buffer
            if (data instanceof ArrayBuffer) {
                const buffer = Buffer.from(data);
                console.log("WebDAV下载成功 (ArrayBuffer), 大小:", buffer.length);
                return buffer;
            }
            // 如果已经是Buffer
            if (Buffer.isBuffer(data)) {
                console.log("WebDAV下载成功 (Buffer), 大小:", data.length);
                return data;
            }
            // 其他情况尝试转换
            console.log("WebDAV数据类型:", typeof data, data.constructor?.name);
            const buffer = Buffer.from(data);
            console.log("WebDAV下载成功 (转换), 大小:", buffer.length);
            return buffer;
        } else {
            console.error("WebDAV返回空数据");
            return null;
        }
    } catch (error) {
        console.error("WebDAV下载失败:", error.message);
        throw error;
    }
}

// 启用共享功能
router.post("/share/enable", requireLogin, (req, res) => {
    UserDB.enableSharing(req.session.userId);
    res.json({ success: true, message: "共享功能已启用" });
});

// 禁用共享功能
router.post("/share/disable", requireLogin, (req, res) => {
    UserDB.disableSharing(req.session.userId);
    res.json({ success: true, message: "共享功能已禁用" });
});

// WebDAV上传函数
async function uploadToWebDAV(filePath, remotePath) {
    try {
        const { url, username, password } = config.sharedWebDAV;
        const fullUrl = url.replace(/\/$/, "") + remotePath;
        const auth = Buffer.from(`${username}:${password}`).toString("base64");

        const fileContent = fs.readFileSync(filePath);
        console.log("WebDAV上传:", fullUrl, ", 大小:", fileContent.length);

        await axios({
            method: "PUT",
            url: fullUrl,
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/octet-stream"
            },
            data: fileContent,
            timeout: 60000
        });

        console.log("WebDAV上传成功:", remotePath);
        return true;
    } catch (error) {
        console.error("WebDAV上传失败:", error.message);
        throw error;
    }
}

// 上传到共享书库
router.post("/share/upload", requireLogin, async (req, res) => {
    try {
        const { libraryId } = req.body;
        const user = UserDB.findById(req.session.userId);

        if (!user.share_enabled) {
            return res.status(400).json({ error: "请先启用共享功能" });
        }

        // 获取用户默认WebDAV配置
        const webdavConfig = WebDAVConfigDB.getDefault(req.session.userId);

        if (!webdavConfig) {
            return res.status(400).json({ error: "未配置WebDAV" });
        }

        // 从WebDAV获取书库列表
        const client = new WebDAVClient({
            url: webdavConfig.url,
            username: webdavConfig.username,
            password: webdavConfig.password,
            path: webdavConfig.base_path
        });
        const books = await client.getLibraryBooks();
        const book = books.find((b) => b.id === libraryId);

        if (!book) {
            return res.status(404).json({ error: "书籍不存在" });
        }

        // 从元信息获取详细信息
        const meta = BookMetadataDB.get(book.bookId);
        const title = meta?.title || book.title;
        const author = meta?.author || book.author || "未知";
        const cover = meta?.cover || book.cover;
        const tags = meta?.tags || book.tags;
        const chapterCount = meta?.subscribed_chapters || book.chapterCount || 0;

        // 下载文件到临时目录
        const tempDir = path.join(__dirname, "../temp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempFilePath = path.join(tempDir, book.filename);
        const fileBuffer = await client.downloadFile(book.path);
        fs.writeFileSync(tempFilePath, fileBuffer);

        // 生成共享文件路径（包含书名和章节数以区分版本）
        // 格式: {bookId}_{title}_{chapterCount}ch.{format}
        const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").substring(0, 50);
        const fileName = `${book.bookId}_${safeTitle}_${chapterCount}ch.${book.format}`;

        // 确保共享目录存在
        const sharedDir = path.join(__dirname, "..", config.sharedLibrary.path);
        if (!fs.existsSync(sharedDir)) {
            fs.mkdirSync(sharedDir, { recursive: true });
        }

        const sharedFilePath = path.join(sharedDir, fileName);

        // 复制文件到共享目录
        try {
            fs.copyFileSync(tempFilePath, sharedFilePath);
        } catch (copyError) {
            // 删除临时文件
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
            return res.status(500).json({ error: "文件复制失败: " + copyError.message });
        }

        // 删除临时文件
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }

        // 添加到共享书库数据库
        SharedDB.add(req.session.userId, {
            bookId: book.bookId,
            title: title,
            author: author,
            cover: cover,
            tags: tags,
            format: book.format,
            filePath: sharedFilePath,
            fileSize: book.size,
            chapterCount: chapterCount
        });

        // 同时添加到书籍元信息（如果不存在）
        try {
            BookMetadataDB.upsert({
                bookId: book.bookId,
                title: title,
                author: author,
                cover: cover,
                tags: tags,
                subscribedChapters: chapterCount,
                totalChapters: chapterCount // 默认等于已订阅
            });
        } catch (e) {
            console.error("保存元信息失败:", e.message);
        }

        // 增加用户共享计数
        UserDB.incrementSharedBooks(req.session.userId);

        res.json({ success: true, message: "上传成功" });
    } catch (error) {
        console.error("上传失败:", error);
        res.status(500).json({ error: "上传失败" });
    }
});

// 获取共享书库列表
router.get("/share/library", requireLogin, async (req, res) => {
    // 检查用户是否有权限访问共享书库
    if (!UserDB.canAccessSharedLibrary(req.session.userId)) {
        return res.status(403).json({
            error: "需要启用共享并上传至少3本书才能访问共享书库",
            required: config.sharedLibrary.minBooksRequired
        });
    }

    try {
        // 从数据库获取共享书籍列表
        const dbBooks = SharedDB.getAll();

        // 从元信息数据库补充详细信息
        const books = dbBooks.map((book) => {
            const meta = BookMetadataDB.get(book.book_id);
            if (meta) {
                return {
                    ...book,
                    title: meta.title || book.title,
                    author: meta.author || book.author,
                    cover: meta.cover || book.cover,
                    tags: meta.tags || book.tags,
                    uploaderName: book.uploader_name || "未知",
                    downloadCount: book.download_count || 0,
                    fileSize: formatFileSize(book.file_size || 0),
                    fileExists: book.file_path && fs.existsSync(book.file_path)
                };
            }
            return {
                ...book,
                uploaderName: book.uploader_name || "未知",
                downloadCount: book.download_count || 0,
                fileSize: formatFileSize(book.file_size || 0),
                fileExists: book.file_path && fs.existsSync(book.file_path)
            };
        });

        res.json(books);
    } catch (error) {
        console.error("获取共享书库失败:", error);
        res.status(500).json({ error: "获取共享书库失败" });
    }
});

// 搜索共享书库
router.get("/share/search", requireLogin, (req, res) => {
    if (!UserDB.canAccessSharedLibrary(req.session.userId)) {
        return res.status(403).json({ error: "无权访问共享书库" });
    }

    const { keyword } = req.query;
    let books = keyword ? SharedDB.search(keyword) : SharedDB.getAll();

    // 从元信息数据库补充详细信息
    books = books.map((book) => {
        const meta = BookMetadataDB.get(book.book_id);
        if (meta) {
            return {
                ...book,
                title: meta.title || book.title,
                author: meta.author || book.author,
                cover: meta.cover || book.cover,
                tags: meta.tags || book.tags,
                word_count: meta.word_count,
                status: meta.status
            };
        }
        return book;
    });

    res.json(books);
});

// 下载共享书籍
router.get("/share/download/:id", requireLogin, async (req, res) => {
    try {
        if (!UserDB.canAccessSharedLibrary(req.session.userId)) {
            return res.status(403).json({ error: "无权访问共享书库" });
        }

        const { id } = req.params;
        console.log("下载共享书籍, ID:", id);

        const book = SharedDB.getById(parseInt(id));

        if (!book) {
            return res.status(404).json({ error: "书籍不存在" });
        }

        // 先更新下载次数
        try {
            SharedDB.incrementDownload(parseInt(id));
            console.log("下载次数已更新, ID:", id);
        } catch (e) {
            console.error("更新下载次数失败:", e.message);
        }

        const fileName = `${book.title}.${book.format}`;

        // 从共享目录读取文件
        if (book.file_path && fs.existsSync(book.file_path)) {
            console.log("从共享目录下载:", book.file_path);
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
            return res.sendFile(path.resolve(book.file_path));
        } else {
            // 文件不存在，删除共享记录
            console.log("文件不存在，删除共享记录:", book.title);
            SharedDB.delete(parseInt(id));
            res.status(404).json({ error: "文件不存在，已从共享库中移除" });
        }
    } catch (error) {
        console.error("下载失败:", error);
        res.status(500).json({ error: "下载失败" });
    }
});

// ==================== 书籍ID/链接下载 API ====================

// 解析书籍ID或链接
function parseBookIdOrUrl(input) {
    console.log("!!! parseBookIdOrUrl 被调用 !!! 输入:", JSON.stringify(input));

    if (!input) return null;

    input = input.toString().trim();

    // 如果是纯ID（数字）
    if (/^\d+$/.test(input)) {
        console.log("匹配纯数字ID:", input);
        return input;
    }

    // 如果是链接，尝试提取ID
    const match = input.match(/\/books\/(\d+)/);
    if (match) {
        console.log("匹配链接格式:", match[1]);
        return match[1];
    }

    // 尝试其他链接格式
    const altMatch = input.match(/book(?:Id)?[=/](\d+)/i);
    if (altMatch) {
        console.log("匹配替代格式:", altMatch[1]);
        return altMatch[1];
    }

    return null;
}

// 根据ID或链接直接添加到下载队列
router.post("/book/quick-download", requireLogin, async (req, res) => {
    try {
        const { input, format = "txt" } = req.body;

        const bookId = parseBookIdOrUrl(input);
        if (!bookId) {
            return res.status(400).json({ error: "无效的书籍ID或链接" });
        }

        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: "请先设置PO18 Cookie" });
        }

        // 获取书籍信息
        const crawler = new NovelCrawler(user.po18_cookie);
        const detail = await crawler.getDetail(bookId);

        // 检查是否解析成功
        if (detail.error) {
            throw new Error(`获取书籍详情失败: ${detail.error}`);
        }

        // 保存元信息到数据库
        if (detail.title && !detail.title.startsWith("书籍 ")) {
            try {
                BookMetadataDB.upsert({
                    bookId: bookId,
                    title: detail.title,
                    author: detail.author || "",
                    cover: detail.cover || "",
                    description: detail.description || "",
                    tags: detail.tags || "",
                    category: detail.tags ? detail.tags.split("·")[0] : "",
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    status: detail.status || "unknown",
                    detailUrl: detail.detailUrl || ""
                });
            } catch (e) {
                console.error("保存元信息失败:", e.message);
            }
        }

        // 添加到队列
        const result = QueueDB.add(req.session.userId, {
            bookId,
            title: detail.title,
            author: detail.author,
            cover: detail.cover,
            format
        });

        res.json({
            success: true,
            queueId: result.lastInsertRowid,
            bookInfo: {
                bookId,
                title: detail.title,
                author: detail.author,
                cover: detail.cover
            }
        });
    } catch (error) {
        console.error("添加到队列失败:", error);
        res.status(500).json({ error: "添加到队列失败: " + error.message });
    }
});

// ==================== 下载历史 API ====================

// 获取下载历史（从队列表查询已完成的）
router.get("/history", requireLogin, (req, res) => {
    const queue = QueueDB.getByUser(req.session.userId);
    // 只返回已完成的记录
    const history = queue.filter((item) => item.status === "completed");
    res.json(history);
});

// 清空下载历史（删除已完成的记录）
router.delete("/history", requireLogin, (req, res) => {
    QueueDB.clearCompleted(req.session.userId);
    res.json({ success: true });
});

// ==================== 辅助函数 ====================

function formatFileSize(bytes) {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// ==================== 后台管理 API ====================

// 管理员权限中间件
const requireAdmin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: "请先登录" });
    }
    const user = UserDB.findById(req.session.userId);
    if (!user || !config.sharing.privilegedUsers.includes(user.username)) {
        return res.status(403).json({ error: "无管理员权限" });
    }
    next();
};

// 检查管理员权限
router.get("/admin/check", requireLogin, (req, res) => {
    const user = UserDB.findById(req.session.userId);
    const isAdmin = config.sharing.privilegedUsers.includes(user.username);
    res.json({ isAdmin, user: { id: user.id, username: user.username } });
});

// 获取系统配置（注册开关）
router.get("/admin/config", requireAdmin, (req, res) => {
    res.json({
        registrationEnabled: config.getRegistrationEnabled()
    });
});

// 切换注册开关
router.post("/admin/config/registration", requireAdmin, (req, res) => {
    const { enabled } = req.body;
    const success = config.setRegistrationEnabled(enabled === true);
    if (success) {
        res.json({
            success: true,
            registrationEnabled: config.getRegistrationEnabled()
        });
    } else {
        res.status(500).json({ error: "保存配置失败" });
    }
});

// 统计数据
router.get("/admin/stats", requireAdmin, (req, res) => {
    try {
        const db = require("better-sqlite3")("./data/po18.db");

        const usersCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
        const booksCount = db.prepare("SELECT COUNT(*) as count FROM book_metadata").get().count;
        const sharedCount = db.prepare("SELECT COUNT(*) as count FROM shared_library").get().count;
        const downloadsCount = db.prepare("SELECT SUM(download_count) as total FROM shared_library").get().total || 0;

        // 统计总章节数（所有书籍的total_chapters之和）
        const totalChaptersResult = db.prepare("SELECT SUM(total_chapters) as total FROM book_metadata").get();
        const totalChapters = totalChaptersResult.total || 0;

        // 统计已缓存章节数
        const cachedChaptersCount = db.prepare("SELECT COUNT(*) as count FROM chapter_cache").get().count;

        res.json({
            users: usersCount,
            books: booksCount,
            shared: sharedCount,
            downloads: downloadsCount,
            totalChapters: totalChapters,
            cachedChapters: cachedChaptersCount
        });
    } catch (error) {
        console.error("获取统计失败:", error);
        res.status(500).json({ error: "获取统计失败" });
    }
});

// ========== 用户管理 ==========

// 获取简化用户列表（用于分析面板）
router.get("/admin/users/list", requireAdmin, (req, res) => {
    try {
        const db = require("better-sqlite3")("./data/po18.db");
        
        const users = db.prepare(`
            SELECT id, username, created_at
            FROM users
            ORDER BY created_at DESC
        `).all();
        
        res.json({
            success: true,
            data: users
        });
    } catch (error) {
        logger.error("获取用户列表失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "获取用户列表失败: " + error.message 
        });
    }
});

// 获取用户列表
router.get("/admin/users", requireAdmin, (req, res) => {    try {
        const { page = 1, pageSize = 20, keyword = "" } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        const db = require("better-sqlite3")("./data/po18.db");

        let countSql = "SELECT COUNT(*) as total FROM users";
        let querySql = "SELECT * FROM users";
        const params = [];

        if (keyword) {
            const where = " WHERE username LIKE ?";
            countSql += where;
            querySql += where;
            params.push(`%${keyword}%`);
        }

        querySql += " ORDER BY id DESC LIMIT ? OFFSET ?";

        const total = db.prepare(countSql).get(...params).total;
        const users = db.prepare(querySql).all(...params, parseInt(pageSize), offset);

        // 移除密码字段
        users.forEach((u) => delete u.password);

        res.json({ users, total });
    } catch (error) {
        res.status(500).json({ error: "获取用户列表失败" });
    }
});

// 获取单个用户
router.get("/admin/users/:id", requireAdmin, (req, res) => {
    try {
        const user = UserDB.findById(parseInt(req.params.id));
        if (!user) {
            return res.status(404).json({ error: "用户不存在" });
        }
        delete user.password;
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: "获取用户失败" });
    }
});

// 更新用户
router.put("/admin/users/:id", requireAdmin, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { password, po18_cookie, share_enabled, cache_auth, library_auth } = req.body;

        const db = require("better-sqlite3")("./data/po18.db");

        if (password) {
            db.prepare("UPDATE users SET password = ? WHERE id = ?").run(password, id);
        }
        if (po18_cookie !== undefined) {
            db.prepare("UPDATE users SET po18_cookie = ? WHERE id = ?").run(po18_cookie, id);
        }
        if (share_enabled !== undefined) {
            db.prepare("UPDATE users SET share_enabled = ? WHERE id = ?").run(share_enabled, id);
        }
        if (cache_auth !== undefined) {
            db.prepare("UPDATE users SET cache_auth = ? WHERE id = ?").run(cache_auth, id);
        }
        if (library_auth !== undefined) {
            db.prepare("UPDATE users SET library_auth = ? WHERE id = ?").run(library_auth, id);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "更新用户失败" });
    }
});

// 删除用户
router.delete("/admin/users/:id", requireAdmin, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const db = require("better-sqlite3")("./data/po18.db");

        // 先删除所有关联数据（按外键约束顺序）
        db.prepare("DELETE FROM webdav_configs WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM library WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM download_queue WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM purchased_books WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM shared_library WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM download_history WHERE user_id = ?").run(id);
        db.prepare("DELETE FROM bookshelf WHERE user_id = ?").run(id);

        // 最后删除用户
        db.prepare("DELETE FROM users WHERE id = ?").run(id);

        res.json({ success: true });
    } catch (error) {
        console.error("删除用户失败:", error);
        res.status(500).json({ error: "删除用户失败: " + error.message });
    }
});

// ========== 书籍元信息管理 ==========

// 获取书籍列表
router.get("/admin/books", requireAdmin, (req, res) => {
    try {
        const { page = 1, pageSize = 20, keyword = "" } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        const db = require("better-sqlite3")("./data/po18.db");

        let countSql = "SELECT COUNT(*) as total FROM book_metadata";
        let querySql = "SELECT * FROM book_metadata";
        const params = [];

        if (keyword) {
            const where = " WHERE title LIKE ? OR author LIKE ?";
            countSql += where;
            querySql += where;
            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        querySql += " ORDER BY id DESC LIMIT ? OFFSET ?";

        const total = db.prepare(countSql).get(...params).total;
        const books = db.prepare(querySql).all(...params, parseInt(pageSize), offset);

        res.json({ books, total });
    } catch (error) {
        res.status(500).json({ error: "获取书籍列表失败" });
    }
});

// 获取单本书籍
router.get("/admin/books/:bookId", requireAdmin, (req, res) => {
    try {
        const book = BookMetadataDB.get(req.params.bookId);
        if (!book) {
            return res.status(404).json({ error: "书籍不存在" });
        }
        res.json(book);
    } catch (error) {
        res.status(500).json({ error: "获取书籍失败" });
    }
});

// 更新书籍
router.put("/admin/books/:bookId", requireAdmin, (req, res) => {
    try {
        const bookId = req.params.bookId;
        const {
            title,
            author,
            tags,
            word_count,
            total_chapters,
            free_chapters,
            paid_chapters,
            status,
            latest_chapter_name,
            latest_chapter_date,
            platform,
            description,
            cover
        } = req.body;

        const db = require("better-sqlite3")("./data/po18.db");
        db.prepare(
            `
            UPDATE book_metadata SET 
                title = ?, author = ?, tags = ?, word_count = ?, 
                total_chapters = ?, free_chapters = ?, paid_chapters = ?,
                status = ?, latest_chapter_name = ?, latest_chapter_date = ?, 
                platform = ?, description = ?, cover = ?, 
                updated_at = CURRENT_TIMESTAMP
            WHERE book_id = ?
        `
        ).run(
            title,
            author,
            tags,
            word_count,
            total_chapters,
            free_chapters,
            paid_chapters,
            status,
            latest_chapter_name,
            latest_chapter_date,
            platform,
            description,
            cover,
            bookId
        );

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "更新书籍失败" });
    }
});

// 删除书籍元信息
router.delete("/admin/books/:bookId", requireAdmin, (req, res) => {
    try {
        const db = require("better-sqlite3")("./data/po18.db");
        db.prepare("DELETE FROM book_metadata WHERE book_id = ?").run(req.params.bookId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "删除书籍失败" });
    }
});

// ========== 排行榜 ==========

// 获取排行榜
router.get("/rankings/:type", (req, res) => {
    try {
        const { type } = req.params;
        const { limit = 100 } = req.query;

        const validTypes = ["favorites", "comments", "monthly", "total", "wordcount", "latest"];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: "无效的排行榜类型" });
        }

        const rankings = BookMetadataDB.getRankings(type, parseInt(limit));
        res.json(rankings);
    } catch (error) {
        console.error("获取排行榜失败:", error);
        res.status(500).json({ error: "获取排行榜失败" });
    }
});

// ==================== 全站书库 API ====================

// 获取全站书库（仅授权用户，支持分页）
router.get("/global-library", requireLogin, async (req, res) => {
    try {
        const user = UserDB.findById(req.session.userId);

        // 检查用户是否有云端缓存权限
        if (user.cache_auth !== 1) {
            return res.status(403).json({ error: "需要云端缓存权限" });
        }

        const { tag, sortBy = "latest", minWords, maxWords, page = 1, pageSize = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        const db = require("better-sqlite3")("./data/po18.db");

        // 构建基础查询条件
        const conditions = [];
        const params = [];

        // 标签筛选
        if (tag) {
            conditions.push("m.tags LIKE ?");
            params.push(`%${tag}%`);
        }

        // 字数筛选
        if (minWords) {
            conditions.push("m.word_count >= ?");
            params.push(parseInt(minWords));
        }
        if (maxWords) {
            conditions.push("m.word_count <= ?");
            params.push(parseInt(maxWords));
        }

        const whereClause = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

        // 排序字段
        let orderBy;
        switch (sortBy) {
            case "latest":
                orderBy = "m.latest_chapter_date DESC";
                break;
            case "favorites":
                orderBy = "m.favorites_count DESC"; // 修复：使用正确的字段名 favorites_count
                break;
            case "comments":
                orderBy = "m.comments_count DESC"; // 修复：使用正确的字段名 comments_count
                break;
            case "wordcount":
                orderBy = "m.word_count DESC";
                break;
            case "cached":
                orderBy = "cached_chapters DESC";
                break;
            default:
                orderBy = "m.updated_at DESC";
        }

        // 查询有缓存章节的书籍（分页）
        const sql = `
            SELECT 
                m.*,
                COUNT(DISTINCT c.chapter_id) as cached_chapters
            FROM book_metadata m
            INNER JOIN chapter_cache c ON m.book_id = c.book_id
            ${whereClause}
            GROUP BY m.book_id HAVING cached_chapters > 0
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `;

        const books = db.prepare(sql).all(...params, parseInt(pageSize), offset);

        // 获取筛选后的总数
        const countSql = `
            SELECT COUNT(*) as count FROM (
                SELECT m.book_id
                FROM book_metadata m
                INNER JOIN chapter_cache c ON m.book_id = c.book_id
                ${whereClause}
                GROUP BY m.book_id HAVING COUNT(DISTINCT c.chapter_id) > 0
            ) sub
        `;
        const filteredCount = db.prepare(countSql).get(...params).count;

        // 获取全局统计信息（首页加载时获取，后续分页不重复查询）
        let stats = { filteredCount };
        if (parseInt(page) === 1) {
            const totalBooks = db
                .prepare(
                    `
                SELECT COUNT(DISTINCT m.book_id) as count
                FROM book_metadata m
                INNER JOIN chapter_cache c ON m.book_id = c.book_id
            `
                )
                .get().count;

            const totalChapters = db
                .prepare(
                    `
                SELECT COUNT(*) as count FROM chapter_cache
            `
                )
                .get().count;

            stats.totalBooks = totalBooks;
            stats.totalChapters = totalChapters;
        }

        res.json({
            books,
            stats,
            pagination: {
                page: parseInt(page),
                pageSize: parseInt(pageSize),
                total: filteredCount,
                hasMore: offset + books.length < filteredCount
            }
        });
    } catch (error) {
        console.error("获取全站书库失败:", error);
        res.status(500).json({ error: "获取失败" });
    }
});

// 获取全站书库标签列表
router.get("/global-library/tags", requireLogin, (req, res) => {
    try {
        const user = UserDB.findById(req.session.userId);
        if (user.cache_auth !== 1) {
            return res.status(403).json({ error: "需要云端缓存权限" });
        }

        const db = require("better-sqlite3")("./data/po18.db");
        const books = db
            .prepare(
                `
            SELECT DISTINCT m.tags 
            FROM book_metadata m
            INNER JOIN chapter_cache c ON m.book_id = c.book_id
            WHERE m.tags IS NOT NULL AND m.tags != ''
        `
            )
            .all();

        const tagsSet = new Set();
        books.forEach((book) => {
            if (book.tags) {
                book.tags.split("·").forEach((t) => {
                    const tag = t.trim();
                    if (tag) tagsSet.add(tag);
                });
            }
        });

        res.json(Array.from(tagsSet).sort());
    } catch (error) {
        res.status(500).json({ error: "获取标签失败" });
    }
});

// 获取用户统计数据
router.get("/user/stats", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;

        // 共享书籍数
        const sharedCount =
            db.prepare("SELECT COUNT(*) as count FROM shared_library WHERE user_id = ?").get(userId)?.count || 0;

        // 获取用户分享统计（包括共享章节数）
        const shareStats = SharedDB.getUserShareStats(userId);
        const sharedChapters = shareStats.total_shared_chapters || 0;

        // 阅读时长（分钟）
        const readingTime =
            db.prepare("SELECT SUM(reading_time) as total FROM bookshelf WHERE user_id = ?").get(userId)?.total || 0;

        // 书架书籍数
        const bookshelfCount =
            db.prepare("SELECT COUNT(*) as count FROM bookshelf WHERE user_id = ?").get(userId)?.count || 0;

        // 下载次数
        const downloadCount =
            db
                .prepare("SELECT COUNT(*) as count FROM download_queue WHERE user_id = ? AND status = 'completed'")
                .get(userId)?.count || 0;

        // 看过总数（阅读超过20分钟的书籍）
        const readBooksCount =
            db.prepare("SELECT COUNT(*) as count FROM bookshelf WHERE user_id = ? AND reading_time >= 20").get(userId)?.count || 0;

        res.json({
            sharedBooks: sharedCount,
            sharedChapters: sharedChapters,
            readingMinutes: readingTime,
            bookshelfBooks: bookshelfCount,
            downloads: downloadCount,
            totalBooks: readBooksCount  // 改为看过总数
        });
    } catch (error) {
        console.error("获取用户统计失败:", error);
        res.status(500).json({ error: "获取统计失败", details: error.message });
    }
});

// 系统监控 - 获取系统状态
router.get("/admin/monitor/system", requireAdmin, (req, res) => {
    try {
        const os = require("os");
        const process = require("process");

        // CPU信息
        const cpus = os.cpus();
        const cpuUsage = process.cpuUsage();

        // 内存信息
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        // 进程内存
        const memUsage = process.memoryUsage();

        // 运行时间
        const uptime = process.uptime();
        const sysUptime = os.uptime();

        res.json({
            cpu: {
                cores: cpus.length,
                model: cpus[0]?.model || "未知",
                usage: cpuUsage
            },
            memory: {
                total: totalMem,
                free: freeMem,
                used: usedMem,
                usagePercent: ((usedMem / totalMem) * 100).toFixed(2)
            },
            process: {
                memory: {
                    rss: memUsage.rss,
                    heapTotal: memUsage.heapTotal,
                    heapUsed: memUsage.heapUsed,
                    external: memUsage.external
                },
                uptime: uptime,
                pid: process.pid
            },
            system: {
                platform: os.platform(),
                arch: os.arch(),
                hostname: os.hostname(),
                uptime: sysUptime
            }
        });
    } catch (error) {
        console.error("获取系统状态失败:", error);
        res.status(500).json({ error: "获取系统状态失败" });
    }
});

// 系统监控 - 获取数据库统计
router.get("/admin/monitor/database", requireAdmin, (req, res) => {
    try {
        const fs = require("fs");
        const path = require("path");

        // 数据库文件大小
        const dbPath = "./data/po18.db";
        let dbSize = 0;
        if (fs.existsSync(dbPath)) {
            const stats = fs.statSync(dbPath);
            dbSize = stats.size;
        }

        // 表统计
        const tables = {
            users: db.prepare("SELECT COUNT(*) as count FROM users").get().count,
            bookshelf: db.prepare("SELECT COUNT(*) as count FROM bookshelf").get().count,
            book_metadata: db.prepare("SELECT COUNT(*) as count FROM book_metadata").get().count,
            chapter_cache: db.prepare("SELECT COUNT(*) as count FROM chapter_cache").get().count,
            shared_library: db.prepare("SELECT COUNT(*) as count FROM shared_library").get().count,
            download_queue: db.prepare("SELECT COUNT(*) as count FROM download_queue").get().count,
            reading_daily_stats: db.prepare("SELECT COUNT(*) as count FROM reading_daily_stats").get().count
        };

        res.json({
            size: dbSize,
            tables: tables
        });
    } catch (error) {
        console.error("获取数据库统计失败:", error);
        res.status(500).json({ error: "获取数据库统计失败" });
    }
});

// 系统监控 - 获取用户活跃度
router.get("/admin/monitor/activity", requireAdmin, (req, res) => {
    try {
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // 24小时内活跃用户（根据阅读记录）
        const activeToday = db
            .prepare(
                `
            SELECT COUNT(DISTINCT user_id) as count 
            FROM bookshelf 
            WHERE last_read_at >= ?
        `
            )
            .get(oneDayAgo.toISOString()).count;

        // 7天内活跃
        const activeWeek = db
            .prepare(
                `
            SELECT COUNT(DISTINCT user_id) as count 
            FROM bookshelf 
            WHERE last_read_at >= ?
        `
            )
            .get(oneWeekAgo.toISOString()).count;

        // 30天内活跃
        const activeMonth = db
            .prepare(
                `
            SELECT COUNT(DISTINCT user_id) as count 
            FROM bookshelf 
            WHERE last_read_at >= ?
        `
            )
            .get(oneMonthAgo.toISOString()).count;

        // 总用户数
        const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;

        // 今日阅读统计
        const today = now.toISOString().split("T")[0];
        const todayStats = db
            .prepare(
                `
            SELECT 
                COUNT(DISTINCT user_id) as users,
                SUM(reading_minutes) as minutes,
                SUM(chapters_read) as chapters
            FROM reading_daily_stats 
            WHERE date = ?
        `
            )
            .get(today);

        res.json({
            active: {
                today: activeToday,
                week: activeWeek,
                month: activeMonth,
                total: totalUsers
            },
            todayReading: {
                users: todayStats.users || 0,
                minutes: todayStats.minutes || 0,
                chapters: todayStats.chapters || 0
            }
        });
    } catch (error) {
        console.error("获取用户活跃度失败:", error);
        res.status(500).json({ error: "获取活跃度统计失败" });
    }
});

// ========== 共享书库管理 ==========

// 获取共享书籍列表
router.get("/admin/shared", requireAdmin, (req, res) => {
    try {
        const { page = 1, pageSize = 20, keyword = "" } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        const db = require("better-sqlite3")("./data/po18.db");

        let countSql = "SELECT COUNT(*) as total FROM shared_library";
        let querySql = `
            SELECT s.*, u.username as uploader_name 
            FROM shared_library s 
            LEFT JOIN users u ON s.user_id = u.id
        `;
        const params = [];

        if (keyword) {
            const where = " WHERE s.title LIKE ?";
            countSql += where.replace("s.", "");
            querySql += where;
            params.push(`%${keyword}%`);
        }

        querySql += " ORDER BY s.id DESC LIMIT ? OFFSET ?";

        const total = db.prepare(countSql).get(...params).total;
        const books = db.prepare(querySql).all(...params, parseInt(pageSize), offset);

        res.json({ books, total });
    } catch (error) {
        res.status(500).json({ error: "获取共享书籍列表失败" });
    }
});

// 删除共享书籍
router.delete("/admin/shared/:id", requireAdmin, (req, res) => {
    try {
        const db = require("better-sqlite3")("./data/po18.db");
        db.prepare("DELETE FROM shared_library WHERE id = ?").run(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "删除共享书籍失败" });
    }
});

// ========== 书库导出 ==========

// 获取可导出的书籍列表（包含章节信息）
router.get("/admin/export/books", requireAdmin, (req, res) => {
    try {
        const { page = 1, pageSize = 50, keyword = "" } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        const db = require("better-sqlite3")("./data/po18.db");

        // 查询书籍元信息和缓存章节数
        let countSql = "SELECT COUNT(DISTINCT book_id) as total FROM book_metadata";
        let querySql = `
            SELECT 
                m.*,
                COUNT(DISTINCT c.chapter_id) as cached_chapters
            FROM book_metadata m
            LEFT JOIN chapter_cache c ON m.book_id = c.book_id
        `;
        const params = [];

        if (keyword) {
            const where = " WHERE m.title LIKE ? OR m.author LIKE ?";
            countSql = "SELECT COUNT(DISTINCT book_id) as total FROM book_metadata m" + where;
            querySql += where;
            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        querySql += " GROUP BY m.book_id ORDER BY cached_chapters DESC, m.updated_at DESC LIMIT ? OFFSET ?";

        const total = db.prepare(countSql).get(...params).total;
        const books = db.prepare(querySql).all(...params, parseInt(pageSize), offset);

        res.json({ books, total });
    } catch (error) {
        console.error("获取导出书籍列表失败:", error);
        res.status(500).json({ error: "获取书籍列表失败" });
    }
});

// 导出单本书籍
router.get("/admin/export/book/:bookId", requireAdmin, async (req, res) => {
    try {
        const { bookId } = req.params;
        const { format = "txt" } = req.query;

        console.log(`[导出] 开始导出 bookId=${bookId}, format=${format}`);

        // 获取书籍元信息
        const detail = BookMetadataDB.get(bookId);
        if (!detail) {
            console.error(`[导出] 书籍不存在: ${bookId}`);
            return res.status(404).json({ error: "书籍不存在" });
        }

        console.log(`[导出] 书籍信息: ${detail.title}`);

        // 从缓存获取章节列表
        const db = require("better-sqlite3")("./data/po18.db");
        const cachedChapters = db
            .prepare("SELECT * FROM chapter_cache WHERE book_id = ? ORDER BY CAST(chapter_id AS INTEGER)")
            .all(bookId);

        if (!cachedChapters || cachedChapters.length === 0) {
            console.error(`[导出] 没有缓存章节: ${bookId}`);
            return res.status(400).json({ error: "该书籍没有已缓存的章节" });
        }

        console.log(`[导出] 缓存章节数: ${cachedChapters.length}`);

        // 转换为章节数据格式（与downloadAllChapters返回格式一致）
        const chapters = cachedChapters.map((c, index) => ({
            index: index,
            title: c.title || "未知章节",
            text: c.text || "", // 使用 text 字段
            html: c.html || "", // 使用 html 字段
            fromCache: true
        }));

        // 生成文件
        const bookData = {
            title: detail.title,
            author: detail.author || "未知",
            cover: detail.cover || "",
            description: detail.description || "",
            tags: detail.tags || "",
            bookId: bookId
        };

        let fileBuffer;
        let fileName;

        if (format === "epub") {
            console.log(`[导出] 生成EPUB...`);
            // 生成EPUB - EpubGenerator 是对象不是类
            fileBuffer = await EpubGenerator.generate(bookData, chapters, bookId);
            fileName = `${detail.title}_${bookId}.epub`;
        } else {
            console.log(`[导出] 生成TXT...`);
            // 生成TXT
            const crawler = require("./crawler");
            const txtContent = crawler.ContentFormatter.toTxt(bookData, chapters);
            fileBuffer = Buffer.from(txtContent, "utf-8");
            fileName = `${detail.title}_${bookId}.txt`;
        }

        console.log(`[导出] 文件生成完成: ${fileName}, 大小: ${fileBuffer.length} bytes`);

        // 返回文件
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        res.setHeader("Content-Length", fileBuffer.length);
        res.send(fileBuffer);
    } catch (error) {
        console.error("[导出] 失败:", error);
        res.status(500).json({ error: "导出失败: " + error.message });
    }
});

// ==================== ID遍历爬取 API ====================

// 获取遍历状态
router.get("/admin/crawler/status", requireAdmin, (req, res) => {
    res.json(crawlerState.getStatus());
});

// 启动遍历
router.post("/admin/crawler/start", requireAdmin, async (req, res) => {
    try {
        if (crawlerState.isRunning) {
            return res.status(400).json({ error: "遍历已在运行中" });
        }

        const { mode = "database", startId, endId, delay = 2000, concurrency = 1 } = req.body;

        let bookIds = [];

        if (mode === "database") {
            // 数据库模式：从 book_metadata 表获取所有 book_id
            bookIds = BookMetadataDB.getAllBookIds();

            if (bookIds.length === 0) {
                return res.status(400).json({ error: "数据库中没有书籍元信息，请先使用油猴脚本收集数据" });
            }

            crawlerState.addLog(`从数据库加载 ${bookIds.length} 个书籍ID`);
        } else {
            // 范围模式：使用 startId - endId 范围
            if (!startId || !endId) {
                return res.status(400).json({ error: "请指定开始ID和结束ID" });
            }

            const start = parseInt(startId);
            const end = parseInt(endId);

            if (isNaN(start) || isNaN(end) || start > end || start < 1) {
                return res.status(400).json({ error: "无效的ID范围" });
            }

            for (let id = start; id <= end; id++) {
                bookIds.push(id.toString());
            }

            crawlerState.addLog(`ID范围模式: ${start} - ${end}`);
        }

        const concurrent = Math.min(Math.max(1, parseInt(concurrency) || 1), 100); // 限制在1-100

        // 初始化状态
        crawlerState.reset();
        crawlerState.isRunning = true;
        crawlerState.startId = bookIds[0];
        crawlerState.endId = bookIds[bookIds.length - 1];
        crawlerState.currentId = bookIds[0];
        crawlerState.startTime = Date.now();
        crawlerState.concurrency = concurrent;

        // 初始化待处理队列
        crawlerState.pendingQueue = [...bookIds];

        // 获取管理员的Cookie用于爬取（必须有）
        const adminUser = UserDB.findById(req.session.userId);
        if (!adminUser || !adminUser.po18_cookie) {
            crawlerState.isRunning = false;
            return res.status(400).json({ error: "请先在设置中配置PO18 Cookie才能使用遍历功能" });
        }

        const modeText = mode === "database" ? "数据库模式" : "ID范围模式";
        const concurrencyText = concurrent === 1 ? "单线程模式" : `并发模式 (${concurrent}个线程)`;
        crawlerState.addLog(`开始遍历 [${modeText}], 共 ${bookIds.length} 个书籍, ${concurrencyText}`);
        res.json({ success: true, message: "遍历已启动" });

        // 异步执行遍历
        const delayMs = Math.max(100, parseInt(delay) || 2000);

        if (concurrent === 1) {
            // 单线程模式（原来的逻辑）
            runSingleThreadCrawler(adminUser.po18_cookie, delayMs);
        } else {
            // 并发模式
            runConcurrentCrawler(adminUser.po18_cookie, concurrent, delayMs);
        }
    } catch (error) {
        console.error("[遍历启动] 错误:", error);
        crawlerState.isRunning = false;
        res.status(500).json({ error: "启动失败: " + error.message });
    }
});

// 单线程爬虫（原来的逻辑）
async function runSingleThreadCrawler(cookie, delayMs) {
    const crawler = new NovelCrawler(cookie);

    while (crawlerState.pendingQueue.length > 0 && crawlerState.isRunning) {
        const id = crawlerState.pendingQueue.shift();
        crawlerState.currentId = id;
        crawlerState.activeThreads = 1;

        await processSingleBook(crawler, id);

        // 延迟避免请求过快
        if (crawlerState.pendingQueue.length > 0 && crawlerState.isRunning) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    crawlerState.activeThreads = 0;

    if (crawlerState.isRunning) {
        crawlerState.addLog(`遍历完成！成功: ${crawlerState.successCount}, 失败: ${crawlerState.failCount}`);
    } else {
        crawlerState.addLog(`遍历已停止。成功: ${crawlerState.successCount}, 失败: ${crawlerState.failCount}`);
    }

    crawlerState.isRunning = false;
}

// 并发爬虫
async function runConcurrentCrawler(cookie, concurrency, delayMs) {
    const workers = [];

    // 创建多个工作线程
    for (let i = 0; i < concurrency; i++) {
        workers.push(crawlerWorker(cookie, i, delayMs));
    }

    // 等待所有工作线程完成
    await Promise.all(workers);

    if (crawlerState.isRunning) {
        crawlerState.addLog(`并发遍历完成！成功: ${crawlerState.successCount}, 失败: ${crawlerState.failCount}`);
    } else {
        crawlerState.addLog(`遍历已停止。成功: ${crawlerState.successCount}, 失败: ${crawlerState.failCount}`);
    }

    crawlerState.isRunning = false;
}

// 工作线程（从队列中取ID并处理）
async function crawlerWorker(cookie, workerId, delayMs) {
    const crawler = new NovelCrawler(cookie);

    while (crawlerState.isRunning) {
        // 从队列中获取下一个ID
        const id = crawlerState.pendingQueue.shift();

        if (id === undefined) {
            // 队列为空，退出
            break;
        }

        crawlerState.activeThreads++;
        crawlerState.currentId = id; // 直接使用ID，支持字符串

        await processSingleBook(crawler, id);

        crawlerState.activeThreads--;

        // 并发模式下，延迟可以更短
        if (crawlerState.pendingQueue.length > 0 && crawlerState.isRunning) {
            await new Promise((resolve) => setTimeout(resolve, delayMs / 2));
        }
    }
}

// 处理单本书籍（提取为公共函数）
async function processSingleBook(crawler, id) {
    try {
        const detail = await crawler.getDetail(id.toString());

        // 检查是否获取到有效信息（排除“书籍 xxx”和“未知标题”）
        const isValid =
            detail &&
            detail.title &&
            !detail.title.startsWith("书籍 ") &&
            detail.title !== "未知标题" &&
            detail.author !== "未知作者" &&
            !detail.error;

        if (isValid) {
            // 保存到元信息数据库
            try {
                BookMetadataDB.upsert({
                    bookId: id.toString(),
                    title: detail.title,
                    author: detail.author || "",
                    cover: detail.cover || "",
                    description: detail.description || "",
                    tags: detail.tags || "",
                    category: detail.tags ? detail.tags.split("·")[0] : "",
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    status: detail.status || "unknown",
                    latestChapterName: detail.latestChapterName || "",
                    latestChapterDate: detail.latestChapterDate || "",
                    platform: detail.platform || "po18",
                    favoritesCount: detail.favoritesCount || 0,
                    commentsCount: detail.commentsCount || 0,
                    monthlyPopularity: detail.monthlyPopularity || 0,
                    totalPopularity: detail.totalPopularity || 0,
                    detailUrl: detail.detailUrl || ""
                });

                crawlerState.successCount++;
                crawlerState.addLog(`✓ ID ${id}: ${detail.title} - ${detail.author}`, "success");
            } catch (dbErr) {
                // 数据库错误仍算成功（可能是重复数据）
                crawlerState.successCount++;
                crawlerState.addLog(`✓ ID ${id}: ${detail.title} (已存在)`, "success");
            }
        } else {
            crawlerState.failCount++;
            crawlerState.addLog(`✗ ID ${id}: 无效或不存在`, "warn");
        }
    } catch (err) {
        crawlerState.failCount++;
        crawlerState.addLog(`✗ ID ${id}: ${err.message}`, "error");
    }

    crawlerState.totalProcessed++;
}

// 停止遍历
router.post("/admin/crawler/stop", requireAdmin, (req, res) => {
    if (!crawlerState.isRunning) {
        return res.status(400).json({ error: "遍历未在运行" });
    }

    crawlerState.isRunning = false;
    crawlerState.addLog("用户请求停止遍历...");
    res.json({ success: true, message: "正在停止遍历..." });
});

// 清空日志
router.post("/admin/crawler/clear-logs", requireAdmin, (req, res) => {
    crawlerState.logs = [];
    res.json({ success: true });
});

// ==================== 书籍详情页 API ====================

// 获取书籍详情（从数据库，不需要登录）
router.get("/books/:id", async (req, res) => {
    try {
        const bookId = req.params.id;

        if (!bookId) {
            return res.status(400).json({ error: "缺少书籍ID" });
        }

        // 从数据库获取
        const cached = BookMetadataDB.get(bookId);
        if (cached) {
            return res.json({
                bookId: cached.book_id,
                title: cached.title,
                author: cached.author,
                cover: cached.cover,
                description: cached.description,
                tags: cached.tags,
                category: cached.category,
                chapterCount: cached.total_chapters || cached.subscribed_chapters,
                totalChapters: cached.total_chapters,
                subscribedChapters: cached.subscribed_chapters,
                wordCount: cached.word_count,
                freeChapters: cached.free_chapters,
                paidChapters: cached.paid_chapters,
                status: cached.status,
                latestChapterName: cached.latest_chapter_name,
                latestChapterDate: cached.latest_chapter_date,
                platform: cached.platform || 'po18',
                favoritesCount: cached.favorites_count,
                commentsCount: cached.comments_count,
                monthlyPopularity: cached.monthly_popularity,
                totalPopularity: cached.total_popularity,
                detailUrl: (cached.platform === 'popo' ? `https://www.popo.tw/books/${bookId}` : `https://www.po18.tw/books/${bookId}/articles`),
                fromCache: true
            });
        }

        // 数据库中没有，返回 404
        return res.status(404).json({ 
            error: "书籍信息不存在，请使用解析功能或油猴脚本上传",
            needParse: true
        });
    } catch (error) {
        console.error("获取书籍详情失败:", error);
        res.status(500).json({ error: error.message });
    }
});

// 获取书籍详情（POST方式）
router.post("/parse/book", requireLogin, async (req, res) => {
    try {
        const { bookId } = req.body;

        if (!bookId) {
            return res.status(400).json({ error: "缺少书籍ID" });
        }

        // 先从数据库缓存获取（字段统一）
        let platform = 'po18';  // 默认为po18
        try {
            const cached = BookMetadataDB.get(bookId);
            if (cached) {
                return res.json({
                    bookId: cached.book_id,
                    title: cached.title,
                    author: cached.author,
                    cover: cached.cover,
                    description: cached.description,
                    tags: cached.tags,
                    category: cached.category,
                    chapterCount: cached.total_chapters || cached.subscribed_chapters,
                    totalChapters: cached.total_chapters,
                    subscribedChapters: cached.subscribed_chapters,
                    wordCount: cached.word_count,
                    freeChapters: cached.free_chapters,
                    paidChapters: cached.paid_chapters,
                    status: cached.status,
                    latestChapterName: cached.latest_chapter_name,
                    latestChapterDate: cached.latest_chapter_date,
                    platform: cached.platform,
                    favoritesCount: cached.favorites_count,
                    commentsCount: cached.comments_count,
                    monthlyPopularity: cached.monthly_popularity,
                    totalPopularity: cached.total_popularity,
                    detailUrl: cached.platform === 'popo' ? `https://www.popo.tw/books/${bookId}` : `https://www.po18.tw/books/${bookId}/articles`,
                    fromCache: true
                });
            } else {
                // 如果数据库中没有，但有platform参数，使用传入的platform
                if (req.body.platform) {
                    platform = req.body.platform;
                }
            }
        } catch (cacheErr) {
            console.error("查询缓存失败:", cacheErr.message);
            // 如果数据库查询失败，但有platform参数，使用传入的platform
            if (req.body.platform) {
                platform = req.body.platform;
            }
        }

        // 从网站解析
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: "请先设置PO18 Cookie" });
        }

        // 根据platform创建对应的crawler
        const crawler = new NovelCrawler(user.po18_cookie, platform);
        const detail = await crawler.getDetail(bookId);

        if (detail.error) {
            return res.status(500).json({ error: `解析失败: ${detail.error}` });
        }

        // 保存到数据库
        if (detail.title && !detail.title.startsWith("书籍 ")) {
            try {
                BookMetadataDB.upsert({
                    bookId: bookId,
                    title: detail.title,
                    author: detail.author || "",
                    cover: detail.cover || "",
                    description: detail.description || "",
                    tags: detail.tags || "",
                    category: detail.tags ? detail.tags.split("·")[0] : "",
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    status: detail.status || "unknown",
                    latestChapterName: detail.latestChapterName || "",
                    latestChapterDate: detail.latestChapterDate || "",
                    platform: detail.platform || "po18",
                    favoritesCount: detail.favoritesCount || 0,
                    commentsCount: detail.commentsCount || 0,
                    monthlyPopularity: detail.monthlyPopularity || 0,
                    totalPopularity: detail.totalPopularity || 0,
                    detailUrl: detail.detailUrl || ""
                });
            } catch (err) {
                console.error("保存元信息失败:", err);
            }
        }

        res.json({
            bookId: bookId,
            title: detail.title,
            author: detail.author,
            cover: detail.cover,
            description: detail.description,
            tags: detail.tags,
            category: detail.tags ? detail.tags.split("·")[0] : "",
            chapterCount: detail.chapterCount,
            totalChapters: detail.chapterCount,
            subscribedChapters: detail.chapterCount,
            wordCount: detail.wordCount,
            freeChapters: detail.freeChapters,
            paidChapters: detail.paidChapters,
            status: detail.status,
            latestChapterName: detail.latestChapterName,
            latestChapterDate: detail.latestChapterDate,
            platform: detail.platform || "po18",
            favoritesCount: detail.favoritesCount || 0,
            commentsCount: detail.commentsCount || 0,
            monthlyPopularity: detail.monthlyPopularity || 0,
            totalPopularity: detail.totalPopularity || 0,
            detailUrl: detail.platform === 'popo' ? `https://www.popo.tw/books/${bookId}` : `https://www.po18.tw/books/${bookId}/articles`,
            fromCache: false
        });
    } catch (error) {
        console.error("获取书籍详情失败:", error);
        res.status(500).json({ error: error.message });
    }
});

// 获取书籍评论
router.post("/parse/comments", async (req, res) => {
    try {
        const { bookId, page = 1 } = req.body;

        if (!bookId) {
            return res.status(400).json({ error: "缺少书籍ID" });
        }

        const user = req.session.userId ? UserDB.findById(req.session.userId) : null;

        // 无Cookie时返回空评论
        if (!user || !user.po18_cookie) {
            return res.json({ comments: [], totalPages: 0, currentPage: page });
        }

        const crawler = new NovelCrawler(user.po18_cookie);
        const comments = await crawler.getComments(bookId, page);

        res.json({
            comments: comments.comments || [],
            totalPages: comments.totalPages || 1,
            currentPage: page
        });
    } catch (error) {
        console.error("获取评论失败:", error);
        res.json({ comments: [], totalPages: 0, currentPage: 1 });
    }
});

// 获取章节列表（默认只读缓存，预加载时才访问网站）
router.post("/parse/chapters", async (req, res) => {
    try {
        const { bookId, cacheOnly } = req.body;

        if (!bookId) {
            return res.status(400).json({ error: "缺少书籍ID" });
        }

        // 检查云端缓存权限
        const hasCacheAuth = UserDB.hasCacheAuth(req.session.userId);

        // 默认只读缓存
        if (cacheOnly !== false) {
            console.log(`只读缓存，查询书籍${bookId}的缓存章节`);

            let formattedChapters = [];
            if (hasCacheAuth) {
                // 有权限，读取共享缓存
                const cachedChapters = ChapterCacheDB.getByBook(bookId);
                formattedChapters = cachedChapters.map((cached, index) => ({
                    index: index,
                    chapterId: cached.chapter_id,
                    title: cached.title,
                    isPaid: false,
                    isPurchased: true,
                    isLocked: false,
                    hasCached: true
                }));
                console.log(`[云端缓存] 返回${formattedChapters.length}个缓存章节`);
            } else {
                console.log(`[无云端权限] 无法读取共享缓存`);
            }

            return res.json({ chapters: formattedChapters });
        }

        // 预加载时才访问网站
        const user = req.session.userId ? UserDB.findById(req.session.userId) : null;

        if (!user || !user.po18_cookie) {
            return res.status(401).json({ error: "需要设置PO18 Cookie才能预加载" });
        }

        const crawler = new NovelCrawler(user.po18_cookie);
        const chapters = await crawler.getChapters(bookId);

        if (!chapters || chapters.length === 0) {
            return res.json({ chapters: [] });
        }

        // 转换为前端需要的格式，并标记缓存状态
        const formattedChapters = chapters.map((chapter, index) => {
            // 根据权限检查是否有缓存
            let cached = null;
            if (hasCacheAuth) {
                cached = ChapterCacheDB.get(bookId, chapter.chapterId);
            }

            return {
                index: index,
                chapterId: chapter.chapterId,
                title: chapter.title,
                isPaid: chapter.isPaid || false,
                isPurchased: chapter.isPurchased || false,
                isLocked: (chapter.isPaid && !chapter.isPurchased && !cached) || false, // 有缓存则不锁定
                hasCached: !!cached
            };
        });

        res.json({ chapters: formattedChapters });
    } catch (error) {
        console.error("获取章节列表失败:", error);

        // 友好的错误提示
        if (error.message && error.message.includes("无法解析书籍信息")) {
            return res.status(401).json({ error: "Cookie已过期或无效，请在设置页重新设置PO18 Cookie" });
        }

        res.status(500).json({ error: error.message });
    }
});

// 获取章节内容（允许访问缓存，无需登录）
router.post("/parse/chapter-content", async (req, res) => {
    try {
        const { bookId, chapterId, html, text, title, fromUserScript, cacheOnly, uploader, uploaderId } = req.body;

        if (!bookId || !chapterId) {
            return res.status(400).json({ error: "缺少参数" });
        }

        // 如果是从 UserScript 上传章节内容
        if (fromUserScript && html && text) {
            try {
                console.log(`[UserScript上传] 保存章节: ${bookId}/${chapterId}, title=${title}, uploader=${uploader || 'unknown'}, uploaderId=${uploaderId || 'unknown'}`);

                // 从 chapterId 提取数字作为排序
                const chapterOrder = parseInt(chapterId) || 0;
                ChapterCacheDB.save(bookId, chapterId, title || "", html || "", text || "", chapterOrder, uploader || 'unknown_user', uploaderId || 'unknown');
                
                // 记录章节分享（如果提供了uploaderId）
                if (uploaderId && uploaderId !== 'unknown') {
                    try {
                        SharedDB.recordChapterShare(uploaderId, bookId, chapterId, title || "", uploaderId);
                        console.log(`[OK] 章节分享已记录: ${bookId}/${chapterId}, 用户ID: ${uploaderId}`);
                    } catch (shareErr) {
                        console.error("记录章节分享失败:", shareErr.message);
                    }
                }
                
                console.log(`[OK] 章节已缓存: ${bookId}/${chapterId}`);
                return res.json({
                    html: html,
                    text: text,
                    title: title,
                    fromCache: false,
                    uploaded: true
                });
            } catch (err) {
                console.error("✗ 保存UserScript上传的章节失败:", err);
                return res.status(500).json({ error: "保存失败: " + err.message });
            }
        }

        // 先从缓存获取（跨用户共享，不需要Cookie）
        const cached = ChapterCacheDB.get(bookId, chapterId);
        if (cached) {
            console.log(`[Cache] 从缓存读取章节: ${bookId}/${chapterId}`);
            return res.json({
                html: cached.html || "",
                text: cached.text || "",
                title: cached.title || "",
                fromCache: true
            });
        }

        // 缓存不存在
        // 如果明确请求只读缓存，返回404
        if (cacheOnly === true) {
            return res.status(404).json({ error: "章节未缓存", fromCache: false });
        }

        // 需要Cookie才能从网站解析
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: "该章节未缓存，需要设置PO18 Cookie后才能读取" });
        }

        const crawler = new NovelCrawler(user.po18_cookie);
        const content = await crawler.getChapterContent(bookId, chapterId);

        if (content.error) {
            return res.status(500).json({ error: content.error });
        }

        // 保存到缓存
        try {
            console.log(
                `[Prepare] 准备缓存章节: ${bookId}/${chapterId}, title=${content.title}, html长度=${content.html?.length}, text长度=${content.text?.length}`
            );
            // 从 chapterId 提取数字作为排序
            const chapterOrder = parseInt(chapterId) || 0;
            // 获取当前用户名和用户ID作为上传者
            const uploader = user.username || 'unknown_user';
            const uploaderId = req.session.userId || 'unknown';
            ChapterCacheDB.save(
                bookId,
                chapterId,
                content.title || "",
                content.html || "",
                content.text || "",
                chapterOrder,
                uploader,
                uploaderId
            );
            console.log(`[OK] 章节已缓存: ${bookId}/${chapterId} (上传者: ${uploader}, ID: ${uploaderId})`);
            
            // 记录章节分享（如果提供了uploaderId）
            if (uploaderId && uploaderId !== 'unknown') {
                try {
                    SharedDB.recordChapterShare(uploaderId, bookId, chapterId, content.title || "", uploaderId);
                    console.log(`[OK] 章节分享已记录: ${bookId}/${chapterId}, 用户ID: ${uploaderId}`);
                } catch (shareErr) {
                    console.error("记录章节分享失败:", shareErr.message);
                }
            }
        } catch (err) {
            console.error("✗ 保存章节缓存失败:", err);
        }

        res.json({
            html: content.html || "",
            text: content.text || "",
            title: content.title || "",
            fromCache: false
        });
    } catch (error) {
        console.error("获取章节内容失败:", error);
        res.status(500).json({ error: error.message });
    }
});

// 预加载书籍所有章节
router.post("/parse/preload-chapters", requireLogin, async (req, res) => {
    try {
        const { bookId } = req.body;

        if (!bookId) {
            return res.status(400).json({ error: "缺少书籍ID" });
        }

        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: "请先设置PO18 Cookie" });
        }

        // 检查云端缓存权限
        const hasCacheAuth = UserDB.hasCacheAuth(req.session.userId);

        // 异步处理，立即返回
        res.json({ success: true, message: "预加载已开始" });

        // 后台处理预加载
        (async () => {
            try {
                const crawler = new NovelCrawler(user.po18_cookie);

                // 获取章节列表
                const chapters = await crawler.getChapters(bookId);
                console.log(`开始预加载书籍 ${bookId} 的 ${chapters.length} 个章节`);

                let cached = 0;
                let downloaded = 0;

                // 串行处理，避免并发过高
                for (const chapter of chapters) {
                    // 跳过未购买的章节
                    if (chapter.isPaid && !chapter.isPurchased) {
                        continue;
                    }

                    // 根据权限检查是否已缓存
                    let alreadyCached = false;
                    if (hasCacheAuth) {
                        alreadyCached = ChapterCacheDB.exists(bookId, chapter.chapterId);
                    }

                    if (alreadyCached) {
                        cached++;
                        console.log(`[云端缓存] 章节已缓存，跳过: ${chapter.chapterId}`);
                        continue;
                    }

                    try {
                        // 下载章节内容
                        const content = await crawler.getChapterContent(bookId, chapter.chapterId);

                        if (!content.error) {
                            ChapterCacheDB.save(
                                bookId,
                                chapter.chapterId,
                                content.title || chapter.title,
                                content.html || "",
                                content.text || ""
                            );
                            downloaded++;
                            console.log(`预加载进度: ${downloaded + cached}/${chapters.length}`);
                        }

                        // 小延迟避免请求过快
                        await new Promise((resolve) => setTimeout(resolve, 500));
                    } catch (err) {
                        console.error(`预加载章节失败: ${chapter.chapterId}`, err.message);
                    }
                }

                console.log(`预加载完成: 缓存 ${cached} 个, 新下载 ${downloaded} 个`);
            } catch (error) {
                console.error("预加载失败:", error);
            }
        })();
    } catch (error) {
        console.error("启动预加载失败:", error);
        res.status(500).json({ error: error.message });
    }
});

// 获取缓存统计
router.get("/parse/cache-stats/:bookId", requireLogin, async (req, res) => {
    try {
        const { bookId } = req.params;
        const stats = ChapterCacheDB.getStats(bookId);
        res.json(stats);
    } catch (error) {
        console.error("获取缓存统计失败:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

// 停止遍历
router.post("/admin/crawler/stop", requireAdmin, (req, res) => {
    if (!crawlerState.isRunning) {
        return res.status(400).json({ error: "遍历未在运行" });
    }

    crawlerState.isRunning = false;
    crawlerState.addLog("用户请求停止遍历...");
    res.json({ success: true, message: "正在停止遍历..." });
});

// 清空日志
router.post("/admin/crawler/clear-logs", requireAdmin, (req, res) => {
    crawlerState.logs = [];
    res.json({ success: true });
});
// ==================== 详情页下载功能（纯服务器端）====================

// 从数据库下载书籍（不请求PO18站）
router.get("/download/book/:bookId", requireLogin, async (req, res) => {
    try {
        const { bookId } = req.params;
        const { format = "txt" } = req.query;

        console.log(`[下载] bookId=${bookId}, format=${format}`);

        // 获取书籍元信息
        const detail = BookMetadataDB.get(bookId);
        if (!detail) {
            console.error(`[下载] 书籍不存在: ${bookId}`);
            return res.status(404).json({ error: "书籍不存在，请先预加载书籍章节" });
        }

        console.log(`[下载] 书籍: ${detail.title}`);

        // 从缓存获取章节
        const db = require("better-sqlite3")("./data/po18.db");
        const cachedChapters = db
            .prepare("SELECT * FROM chapter_cache WHERE book_id = ? ORDER BY CAST(chapter_id AS INTEGER)")
            .all(bookId);

        if (!cachedChapters || cachedChapters.length === 0) {
            console.error(`[下载] 没有缓存章节: ${bookId}`);
            return res.status(400).json({ error: "该书籍没有已缓存的章节，请先预加载章节" });
        }

        console.log(`[下载] 缓存章节数: ${cachedChapters.length}`);

        // 转换为章节数据格式
        const chapters = cachedChapters.map((c, index) => ({
            index: index,
            title: c.title || "未知章节",
            text: c.text || "",
            html: c.html || "",
            fromCache: true
        }));

        // 生成文件
        const bookData = {
            title: detail.title,
            author: detail.author || "未知",
            cover: detail.cover || "",
            description: detail.description || "",
            tags: detail.tags || "",
            bid: bookId,
            bookId: bookId
        };

        let fileBuffer;
        let fileName;

        if (format === "epub") {
            console.log(`[下载] 生成EPUB...`);
            fileBuffer = await EpubGenerator.generate(bookData, chapters, bookId);
            fileName = `${detail.title}_${bookId}.epub`;
        } else {
            console.log(`[下载] 生成TXT...`);
            const txtContent = ContentFormatter.toTxt(bookData, chapters);
            fileBuffer = Buffer.from(txtContent, "utf-8");
            fileName = `${detail.title}_${bookId}.txt`;
        }

        console.log(`[下载] 文件生成完成: ${fileName}, 大小: ${fileBuffer.length} bytes`);

        // 返回文件
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        res.setHeader("Content-Length", fileBuffer.length);
        res.send(fileBuffer);
    } catch (error) {
        console.error("[下载] 失败:", error);
        res.status(500).json({ error: "下载失败: " + error.message });
    }
});

// ==================== 书库EPUB下载功能 ====================

// 检查书库中是否有EPUB文件
router.get("/library/check-epub/:bookId", requireLogin, async (req, res) => {
    try {
        const { bookId } = req.params;

        // 获取所有已启用的WebDAV配置
        const webdavConfigs = WebDAVConfigDB.getEnabled(req.session.userId);

        if (!webdavConfigs || webdavConfigs.length === 0) {
            return res.json({ hasEpub: false });
        }

        // 遍历所有WebDAV配置，查找匹配的EPUB文件
        for (const config of webdavConfigs) {
            try {
                const client = new WebDAVClient({
                    url: config.url,
                    username: config.username,
                    password: config.password,
                    basePath: config.base_path || "/"
                });

                const books = await client.getLibraryBooks();

                // 查找包含bookId的EPUB文件
                const epubBook = books.find((b) => b.bookId === bookId && b.format === "epub");

                if (epubBook) {
                    return res.json({
                        hasEpub: true,
                        filename: epubBook.filename,
                        path: epubBook.path,
                        configId: config.id,
                        configName: config.name
                    });
                }
            } catch (err) {
                console.error(`检查WebDAV ${config.name} 失败:`, err.message);
                continue;
            }
        }

        res.json({ hasEpub: false });
    } catch (error) {
        console.error("检查EPUB失败:", error);
        res.status(500).json({ error: error.message });
    }
});

// 从书库下载EPUB文件
router.get("/library/download-epub/:bookId", requireLogin, async (req, res) => {
    try {
        const { bookId } = req.params;
        const { configId } = req.query;

        if (!configId) {
            return res.status(400).json({ error: "缺少WebDAV配置ID" });
        }

        // 获取WebDAV配置
        const config = WebDAVConfigDB.findById(parseInt(configId));
        if (!config || config.user_id !== req.session.userId) {
            return res.status(404).json({ error: "WebDAV配置不存在" });
        }

        const client = new WebDAVClient({
            url: config.url,
            username: config.username,
            password: config.password,
            basePath: config.base_path || "/"
        });

        const books = await client.getLibraryBooks();
        const epubBook = books.find((b) => b.bookId === bookId && b.format === "epub");

        if (!epubBook) {
            return res.status(404).json({ error: "EPUB文件不存在" });
        }

        // 下载文件
        const fileBuffer = await client.downloadFile(epubBook.path);

        // 设置响应头
        res.setHeader("Content-Type", "application/epub+zip");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(epubBook.filename)}"`);
        res.setHeader("Content-Length", fileBuffer.length);

        res.send(fileBuffer);
    } catch (error) {
        console.error("下载EPUB失败:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== 书架API ====================

// 获取用户书架
router.get("/bookshelf", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const bookshelves = BookshelfDB.getByUser(userId);
        res.json(bookshelves);
    } catch (error) {
        console.error("获取书架失败:", error);
        res.status(500).json({ error: "获取书架失败" });
    }
});

// 检查书籍是否在书架中
router.get("/bookshelf/check/:bookId", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;
        const inBookshelf = BookshelfDB.exists(userId, bookId);
        res.json({ inBookshelf });
    } catch (error) {
        console.error("检查书架状态失败:", error);
        res.status(500).json({ error: "检查失败" });
    }
});

// 添加到书架
router.post("/bookshelf", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId, title, author, cover, totalChapters } = req.body;

        if (!bookId || !title) {
            return res.status(400).json({ error: "缺少必要参数" });
        }

        // 检查是否已存在
        if (BookshelfDB.exists(userId, bookId)) {
            return res.status(400).json({ error: "书籍已在书架中" });
        }

        BookshelfDB.add(userId, bookId, title, author, cover, totalChapters || 0);
        res.json({ success: true, message: "添加成功" });
    } catch (error) {
        console.error("添加到书架失败:", error);
        res.status(500).json({ error: "添加失败" });
    }
});

// 从书架移除
router.delete("/bookshelf/:bookId", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;

        BookshelfDB.remove(userId, bookId);
        res.json({ success: true, message: "移除成功" });
    } catch (error) {
        console.error("从书架移除失败:", error);
        res.status(500).json({ error: "移除失败" });
    }
});

// 统一更新进度和时长（无参数路由，需要放在前面）
router.put("/bookshelf/progress", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId, currentChapter, totalChapters, readingMinutes } = req.body;

        if (!bookId) {
            return res.status(400).json({ error: "缺少bookId" });
        }

        // 更新进度
        BookshelfDB.updateProgress(userId, bookId, currentChapter, totalChapters);

        // 更新时长
        if (readingMinutes > 0) {
            BookshelfDB.updateReadingTime(userId, bookId, readingMinutes);
            // 同时更新每日阅读统计（用于热力图）
            ReadingStatsDB.updateToday(userId, readingMinutes);
        }

        res.json({ success: true });
    } catch (error) {
        console.error("更新书架失败:", error);
        res.status(500).json({ error: "更新失败" });
    }
});

// 更新阅读进度（带bookId参数）
router.put("/bookshelf/:bookId/progress", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;
        const { currentChapter, totalChapters } = req.body;

        BookshelfDB.updateProgress(userId, bookId, currentChapter, totalChapters);
        res.json({ success: true });
    } catch (error) {
        console.error("更新阅读进度失败:", error);
        res.status(500).json({ error: "更新失败" });
    }
});

// 更新阅读时长
router.put("/bookshelf/:bookId/reading-time", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;
        const { minutes } = req.body;

        BookshelfDB.updateReadingTime(userId, bookId, minutes || 0);
        // 同时更新每日阅读统计
        if (minutes > 0) {
            ReadingStatsDB.updateToday(userId, minutes);
        }
        res.json({ success: true });
    } catch (error) {
        console.error("更新阅读时长失败:", error);
        res.status(500).json({ error: "更新失败" });
    }
});

// ==================== 书架分类管理 API ====================

// 获取用户的所有分类
router.get("/bookshelf/categories", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const categories = BookshelfCategoryDB.getByUser(userId);
        res.json({ success: true, data: categories });
    } catch (error) {
        logger.error("获取分类列表失败", { error: error.message });
        res.status(500).json({ success: false, error: "获取分类列表失败" });
    }
});

// 创建分类
router.post("/bookshelf/categories", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { name, color, icon, sortOrder } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: "分类名称不能为空" });
        }
        
        // 检查分类名称是否已存在
        if (BookshelfCategoryDB.exists(userId, name.trim())) {
            return res.status(400).json({ success: false, error: "分类名称已存在" });
        }
        
        const result = BookshelfCategoryDB.create(userId, name.trim(), color, icon, sortOrder);
        res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (error) {
        logger.error("创建分类失败", { error: error.message });
        res.status(500).json({ success: false, error: "创建分类失败" });
    }
});

// 更新分类
router.put("/bookshelf/categories/:categoryId", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { categoryId } = req.params;
        const { name, color, icon, sortOrder } = req.body;
        
        // 检查分类是否存在
        const category = BookshelfCategoryDB.get(parseInt(categoryId), userId);
        if (!category) {
            return res.status(404).json({ success: false, error: "分类不存在" });
        }
        
        // 如果修改了名称，检查新名称是否已存在
        if (name && name.trim() !== category.name) {
            if (BookshelfCategoryDB.exists(userId, name.trim(), parseInt(categoryId))) {
                return res.status(400).json({ success: false, error: "分类名称已存在" });
            }
        }
        
        BookshelfCategoryDB.update(
            parseInt(categoryId),
            userId,
            name ? name.trim() : category.name,
            color !== undefined ? color : category.color,
            icon !== undefined ? icon : category.icon,
            sortOrder !== undefined ? sortOrder : category.sort_order
        );
        
        res.json({ success: true });
    } catch (error) {
        logger.error("更新分类失败", { error: error.message });
        res.status(500).json({ success: false, error: "更新分类失败" });
    }
});

// 删除分类
router.delete("/bookshelf/categories/:categoryId", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { categoryId } = req.params;
        
        // 检查分类是否存在
        const category = BookshelfCategoryDB.get(parseInt(categoryId), userId);
        if (!category) {
            return res.status(404).json({ success: false, error: "分类不存在" });
        }
        
        BookshelfCategoryDB.delete(parseInt(categoryId), userId);
        res.json({ success: true });
    } catch (error) {
        logger.error("删除分类失败", { error: error.message });
        res.status(500).json({ success: false, error: "删除分类失败" });
    }
});

// 更新书籍分类
router.put("/bookshelf/:bookId/category", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;
        const { categoryId } = req.body;
        
        // 如果提供了categoryId，验证分类是否存在且属于当前用户
        if (categoryId !== null && categoryId !== undefined) {
            const category = BookshelfCategoryDB.get(parseInt(categoryId), userId);
            if (!category) {
                return res.status(404).json({ success: false, error: "分类不存在" });
            }
        }
        
        BookshelfDB.updateCategory(userId, bookId, categoryId ? parseInt(categoryId) : null);
        res.json({ success: true });
    } catch (error) {
        logger.error("更新书籍分类失败", { error: error.message });
        res.status(500).json({ success: false, error: "更新书籍分类失败" });
    }
});

// 批量更新书籍分类
router.put("/bookshelf/batch/category", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookIds, categoryId } = req.body;
        
        if (!Array.isArray(bookIds) || bookIds.length === 0) {
            return res.status(400).json({ success: false, error: "请选择至少一本书" });
        }
        
        // 如果提供了categoryId，验证分类是否存在且属于当前用户
        if (categoryId !== null && categoryId !== undefined) {
            const category = BookshelfCategoryDB.get(parseInt(categoryId), userId);
            if (!category) {
                return res.status(404).json({ success: false, error: "分类不存在" });
            }
        }
        
        BookshelfDB.batchUpdateCategory(userId, bookIds, categoryId ? parseInt(categoryId) : null);
        res.json({ success: true });
    } catch (error) {
        logger.error("批量更新书籍分类失败", { error: error.message });
        res.status(500).json({ success: false, error: "批量更新书籍分类失败" });
    }
});

// 获取阅读统计数据（热力图）
router.get("/user/reading-stats", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const days = parseInt(req.query.days) || 365;

        // 获取每日阅读数据
        const dailyStats = ReadingStatsDB.getStats(userId, days);

        // 获取概要统计
        const summary = ReadingStatsDB.getSummary(userId);

        // 获取连续阅读天数
        const streak = ReadingStatsDB.getStreak(userId);

        res.json({
            dailyStats,
            summary: {
                totalDays: summary.total_days || 0,
                totalMinutes: summary.total_minutes || 0,
                maxMinutes: summary.max_minutes || 0
            },
            streak
        });
    } catch (error) {
        console.error("获取阅读统计失败:", error);
        res.status(500).json({ error: "获取统计失败" });
    }
});

// ==================== 书籍订阅API ====================

// 获取订阅列表
router.get("/subscriptions", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const subscriptions = SubscriptionDB.getByUser(userId);
        const updateCount = SubscriptionDB.getUpdateCount(userId);

        res.json({
            subscriptions,
            updateCount
        });
    } catch (error) {
        console.error("获取订阅列表失败:", error);
        res.status(500).json({ error: "获取订阅列表失败" });
    }
});

// 获取有更新的订阅
router.get("/subscriptions/updates", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const updates = SubscriptionDB.getUpdated(userId);

        res.json({ updates });
    } catch (error) {
        console.error("获取更新失败:", error);
        res.status(500).json({ error: "获取更新失败" });
    }
});

// 订阅书籍
router.post("/subscriptions/:bookId", requireLogin, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;
        const { title, author, cover, chapterCount } = req.body;

        SubscriptionDB.subscribe(userId, bookId, title, author, cover, chapterCount || 0);

        res.json({ success: true, message: "订阅成功" });
    } catch (error) {
        console.error("订阅失败:", error);
        res.status(500).json({ error: "订阅失败" });
    }
});

// 取消订阅
router.delete("/subscriptions/:bookId", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;

        SubscriptionDB.unsubscribe(userId, bookId);

        res.json({ success: true, message: "已取消订阅" });
    } catch (error) {
        console.error("取消订阅失败:", error);
        res.status(500).json({ error: "取消订阅失败" });
    }
});

// 检查是否已订阅
router.get("/subscriptions/:bookId/status", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;

        const isSubscribed = SubscriptionDB.isSubscribed(userId, bookId);

        res.json({ isSubscribed });
    } catch (error) {
        console.error("检查订阅状态失败:", error);
        res.status(500).json({ error: "检查失败" });
    }
});

// 清除更新标记
router.post("/subscriptions/:bookId/clear-update", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;

        SubscriptionDB.clearUpdate(userId, bookId);

        res.json({ success: true });
    } catch (error) {
        console.error("清除更新标记失败:", error);
        res.status(500).json({ error: "操作失败" });
    }
});

// ==================== 数据库备份与恢复 API ====================

// 创建数据库备份
router.post("/admin/backup", requireAdmin, logAdminAction("创建数据库备份"), async (req, res) => {
    try {
        const { type = "full", options = {} } = req.body;
        
        const result = await databaseBackup.createBackup(type, options);
        
        res.json({
            success: true,
            message: "备份创建成功",
            data: result
        });
    } catch (error) {
        logger.error("创建数据库备份失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "备份创建失败: " + error.message 
        });
    }
});

// 获取备份列表
router.get("/admin/backups", requireAdmin, logAdminAction("查看备份列表"), async (req, res) => {
    try {
        const backups = await databaseBackup.listBackups();
        
        res.json({
            success: true,
            data: backups
        });
    } catch (error) {
        logger.error("获取备份列表失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "获取备份列表失败: " + error.message 
        });
    }
});

// 恢复数据库备份
router.post("/admin/backup/restore", requireAdmin, logAdminAction("恢复数据库备份"), async (req, res) => {
    try {
        const { fileName, options = {} } = req.body;
        
        if (!fileName) {
            return res.status(400).json({ 
                success: false, 
                error: "缺少备份文件名参数" 
            });
        }
        
        const backupPath = path.join("./backups", fileName);
        const result = await databaseBackup.restoreBackup(backupPath, options);
        
        res.json({
            success: true,
            message: "数据库恢复成功",
            data: result
        });
    } catch (error) {
        logger.error("恢复数据库备份失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "数据库恢复失败: " + error.message 
        });
    }
});

// 删除备份文件
router.delete("/admin/backup/:fileName", requireAdmin, logAdminAction("删除备份文件"), async (req, res) => {
    try {
        const { fileName } = req.params;
        
        const result = await databaseBackup.deleteBackup(fileName);
        
        res.json({
            success: true,
            message: "备份文件删除成功",
            data: result
        });
    } catch (error) {
        logger.error("删除备份文件失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "删除备份文件失败: " + error.message 
        });
    }
});

// 压缩备份文件
router.post("/admin/backup/compress", requireAdmin, logAdminAction("压缩备份文件"), async (req, res) => {
    try {
        const { fileName } = req.body;
        
        if (!fileName) {
            return res.status(400).json({ 
                success: false, 
                error: "缺少备份文件名参数" 
            });
        }
        
        const result = await databaseBackup.compressBackup(fileName);
        
        res.json({
            success: true,
            message: "备份文件压缩成功",
            data: result
        });
    } catch (error) {
        logger.error("压缩备份文件失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "压缩备份文件失败: " + error.message 
        });
    }
});

// 更新章节数并检查是否有更新
router.post("/subscriptions/:bookId/update-count", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { bookId } = req.params;
        const { chapterCount } = req.body;
        // 检查是否已订阅
        if (!SubscriptionDB.isSubscribed(userId, bookId)) {
            return res.json({ updated: false, subscribed: false });
        }

        // 获取当前订阅信息
        const subscriptions = SubscriptionDB.getByUser(userId);
        const sub = subscriptions.find((s) => s.book_id === bookId);

        if (!sub) {
            return res.json({ updated: false, subscribed: false });
        }

        const oldCount = sub.last_chapter_count || 0;
        const newCount = chapterCount || 0;

        // 如果章节数增加了，标记为有更新
        if (newCount > oldCount) {
            SubscriptionDB.markUpdate(bookId, newCount);

            res.json({
                updated: true,
                subscribed: true,
                oldCount,
                newCount,
                newChapters: newCount - oldCount
            });
        } else {
            // 章节数没变，更新最后检查时间
            res.json({
                updated: false,
                subscribed: true,
                currentCount: newCount
            });
        }
    } catch (error) {
        console.error("更新章节数失败:", error);
        res.status(500).json({ error: "操作失败" });
    }
});

// 手动触发订阅检查（立即检查所有订阅）
router.post("/subscriptions/check-updates", requireLogin, async (req, res) => {
    try {
        const { subscriptionChecker } = require('./monitor');
        
        // 如果正在检查中，返回提示
        if (subscriptionChecker.isChecking) {
            return res.json({
                success: false,
                message: '正在检查中，请稍后...',
                status: subscriptionChecker.getStatus()
            });
        }
        
        // 触发检查（不等待完成，异步执行）
        subscriptionChecker.checkAllSubscriptions();
        
        res.json({
            success: true,
            message: '已开始检查订阅更新',
            status: subscriptionChecker.getStatus()
        });
    } catch (error) {
        console.error("触发订阅检查失败:", error);
        res.status(500).json({ error: "操作失败" });
    }
});

// ==================== 数据库备份与恢复 API ====================

// 创建数据库备份
router.post("/admin/backup", requireAdmin, logAdminAction("创建数据库备份"), async (req, res) => {
    try {
        const { type = "full", options = {} } = req.body;
        
        const result = await databaseBackup.createBackup(type, options);
        
        res.json({
            success: true,
            message: "备份创建成功",
            data: result
        });
    } catch (error) {
        logger.error("创建数据库备份失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "备份创建失败: " + error.message 
        });
    }
});

// 获取备份列表
router.get("/admin/backups", requireAdmin, logAdminAction("查看备份列表"), async (req, res) => {
    try {
        const backups = await databaseBackup.listBackups();
        
        res.json({
            success: true,
            data: backups
        });
    } catch (error) {
        logger.error("获取备份列表失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "获取备份列表失败: " + error.message 
        });
    }
});

// 恢复数据库备份
router.post("/admin/backup/restore", requireAdmin, logAdminAction("恢复数据库备份"), async (req, res) => {
    try {
        const { fileName, options = {} } = req.body;
        
        if (!fileName) {
            return res.status(400).json({ 
                success: false, 
                error: "缺少备份文件名参数" 
            });
        }
        
        const backupPath = path.join("./backups", fileName);
        const result = await databaseBackup.restoreBackup(backupPath, options);
        
        res.json({
            success: true,
            message: "数据库恢复成功",
            data: result
        });
    } catch (error) {
        logger.error("恢复数据库备份失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "数据库恢复失败: " + error.message 
        });
    }
});

// 删除备份文件
router.delete("/admin/backup/:fileName", requireAdmin, logAdminAction("删除备份文件"), async (req, res) => {
    try {
        const { fileName } = req.params;
        
        const result = await databaseBackup.deleteBackup(fileName);
        
        res.json({
            success: true,
            message: "备份文件删除成功",
            data: result
        });
    } catch (error) {
        logger.error("删除备份文件失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "删除备份文件失败: " + error.message 
        });
    }
});

// 压缩备份文件
router.post("/admin/backup/compress", requireAdmin, logAdminAction("压缩备份文件"), async (req, res) => {
    try {
        const { fileName } = req.body;
        
        if (!fileName) {
            return res.status(400).json({ 
                success: false, 
                error: "缺少备份文件名参数" 
            });
        }
        
        const result = await databaseBackup.compressBackup(fileName);
        
        res.json({
            success: true,
            message: "备份文件压缩成功",
            data: result
        });
    } catch (error) {
        logger.error("压缩备份文件失败", { error: error.message });
        res.status(500).json({ 
            success: false, 
            error: "压缩备份文件失败: " + error.message 
        });
    }
});

// ==================== 性能监控 API ====================

// 获取系统监控数据
router.get("/admin/monitor/system-stats", requireLogin, async (req, res) => {
    try {
        // 使用性能监控器获取实时数据
        const currentStatus = performanceMonitor.getCurrentStatus();
        
        if (!currentStatus) {
            // 如果还没有收集到数据，立即收集一次
            await performanceMonitor.collectMetrics();
            const status = performanceMonitor.getCurrentStatus();
            
            if (!status) {
                return res.status(503).json({ error: "性能监控数据尚未就绪" });
            }
            
            return res.json({
                timestamp: status.timestamp,
                cpu: status.system.cpu,
                memory: status.system.memory,
                disk: status.system.disk,
                process: status.process,
                database: status.database,
                api: status.api,
                uptime: status.system.uptime,
                loadavg: status.system.loadavg
            });
        }
        
        res.json({
            timestamp: currentStatus.timestamp,
            cpu: currentStatus.system.cpu,
            memory: currentStatus.system.memory,
            disk: currentStatus.system.disk,
            process: currentStatus.process,
            database: currentStatus.database,
            api: currentStatus.api,
            uptime: currentStatus.system.uptime,
            loadavg: currentStatus.system.loadavg
        });
    } catch (error) {
        logger.error("获取系统监控数据失败", { error: error.message });
        res.status(500).json({ error: "获取系统监控数据失败" });
    }
});

// 获取告警配置
router.get("/admin/monitor/alert-config", requireLogin, (req, res) => {
    try {
        // 从性能监控器获取当前告警阈值
        const thresholds = performanceMonitor.getAlertThresholds();
        
        res.json({
            cpuThreshold: thresholds.cpu,
            memoryThreshold: thresholds.memory,
            diskThreshold: thresholds.disk,
            responseTimeThreshold: thresholds.responseTime
        });
    } catch (error) {
        logger.error("获取告警配置失败", { error: error.message });
        res.status(500).json({ error: "获取告警配置失败" });
    }
});

// 保存告警配置
router.post("/admin/monitor/alert-config", requireLogin, (req, res) => {
    try {
        const { cpuThreshold, memoryThreshold, diskThreshold, responseTimeThreshold } = req.body;
        
        // 验证参数
        if (cpuThreshold !== undefined && (cpuThreshold < 0 || cpuThreshold > 100)) {
            return res.status(400).json({ error: "CPU阈值必须在0-100之间" });
        }
        if (memoryThreshold !== undefined && (memoryThreshold < 0 || memoryThreshold > 100)) {
            return res.status(400).json({ error: "内存阈值必须在0-100之间" });
        }
        if (diskThreshold !== undefined && (diskThreshold < 0 || diskThreshold > 100)) {
            return res.status(400).json({ error: "磁盘阈值必须在0-100之间" });
        }
        if (responseTimeThreshold !== undefined && responseTimeThreshold < 0) {
            return res.status(400).json({ error: "响应时间阈值必须大于0" });
        }
        
        // 更新性能监控器的告警阈值
        const thresholds = {};
        if (cpuThreshold !== undefined) thresholds.cpu = cpuThreshold;
        if (memoryThreshold !== undefined) thresholds.memory = memoryThreshold;
        if (diskThreshold !== undefined) thresholds.disk = diskThreshold;
        if (responseTimeThreshold !== undefined) thresholds.responseTime = responseTimeThreshold;
        
        performanceMonitor.setAlertThresholds(thresholds);
        
        res.json({ success: true, message: "告警配置保存成功" });
    } catch (error) {
        logger.error("保存告警配置失败", { error: error.message });
        res.status(500).json({ error: "保存告警配置失败" });
    }
});

// 获取数据库监控数据
router.get("/admin/monitor/database", requireLogin, (req, res) => {
    try {
        // 使用性能监控器获取数据库指标
        const currentStatus = performanceMonitor.getCurrentStatus();
        
        if (currentStatus && currentStatus.database) {
            return res.json({
                ...currentStatus.database,
                timestamp: currentStatus.timestamp
            });
        }
        
        // 如果监控器还没有数据，直接查询
        const dbPath = config.database.path;
        const stats = fs.statSync(dbPath);
        const dbSize = stats.size;
        
        // 获取各表记录数
        const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
        const bookshelfCount = db.prepare("SELECT COUNT(*) as count FROM bookshelf").get().count;
        const bookMetadataCount = db.prepare("SELECT COUNT(*) as count FROM book_metadata").get().count;
        const chapterCacheCount = db.prepare("SELECT COUNT(*) as count FROM chapter_cache").get().count;
        
        res.json({
            size: dbSize,
            tables: {
                users: userCount,
                bookshelf: bookshelfCount,
                book_metadata: bookMetadataCount,
                chapter_cache: chapterCacheCount,
                reading_daily_stats: readingStatsCount
            }
        });
    } catch (error) {
        logger.error("获取数据库监控数据失败", { error: error.message });
        res.status(500).json({ error: "获取数据库监控数据失败" });
    }
});

// 获取概览页监控数据
router.get("/admin/monitor/dashboard", requireLogin, (req, res) => {
    try {
        // 获取活动统计
        const today = new Date().toISOString().split('T')[0];
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const monthAgo = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
        
        const todayActive = db.prepare(`
            SELECT COUNT(DISTINCT user_id) as count 
            FROM reading_daily_stats 
            WHERE date = ?
        `).get(today).count;
        
        const weekActive = db.prepare(`
            SELECT COUNT(DISTINCT user_id) as count 
            FROM reading_daily_stats 
            WHERE date >= ?
        `).get(weekAgo).count;
        
        const monthActive = db.prepare(`
            SELECT COUNT(DISTINCT user_id) as count 
            FROM reading_daily_stats 
            WHERE date >= ?
        `).get(monthAgo).count;
        
        const totalActive = db.prepare(`
            SELECT COUNT(DISTINCT user_id) as count 
            FROM reading_daily_stats
        `).get().count;
        
        // 获取数据库统计
        const dbPath = config.database.path;
        const dbStats = fs.statSync(dbPath);
        const dbSize = dbStats.size;
        
        const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
        const bookshelfCount = db.prepare("SELECT COUNT(*) as count FROM bookshelf").get().count;
        const chapterCacheCount = db.prepare("SELECT COUNT(*) as count FROM chapter_cache").get().count;
        
        res.json({
            activity: {
                active: {
                    today: todayActive,
                    week: weekActive,
                    month: monthActive,
                    total: totalActive
                }
            },
            database: {
                size: dbSize,
                tables: {
                    users: userCount,
                    bookshelf: bookshelfCount,
                    chapter_cache: chapterCacheCount
                }
            }
        });
    } catch (error) {
        logger.error("获取概览页监控数据失败", { error: error.message });
        res.status(500).json({ error: "获取概览页监控数据失败" });
    }
});

// ==================== 用户分享统计 API ====================

// 获取当前用户的分享统计
router.get("/user/share-stats", requireLogin, (req, res) => {
    try {
        const stats = SharedDB.getUserShareStats(req.session.userId);
        logger.info("获取用户分享统计", { userId: req.session.userId, stats });
        res.json(stats);
    } catch (error) {
        logger.error("获取用户分享统计失败", { error: error.message, userId: req.session.userId });
        res.status(500).json({ error: "获取分享统计失败" });
    }
});

// 获取当前用户的章节分享列表
router.get("/user/chapter-shares", requireLogin, (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const shares = SharedDB.getUserChapterShares(req.session.userId, parseInt(limit), parseInt(offset));
        res.json(shares);
    } catch (error) {
        logger.error("获取用户章节分享列表失败", { error: error.message, userId: req.session.userId });
        res.status(500).json({ error: "获取章节分享列表失败" });
    }
});

// 获取分享排行榜
router.get("/share-rankings", requireLogin, (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const rankings = SharedDB.getShareRankings(parseInt(limit));
        res.json(rankings);
    } catch (error) {
        logger.error("获取分享排行榜失败", { error: error.message });
        res.status(500).json({ error: "获取排行榜失败" });
    }
});

// ==================== 章节分享 API ====================

// 分享章节
router.post("/share/chapter", requireLogin, async (req, res) => {
    try {
        const { bookId, chapterId, chapterTitle } = req.body;
        
        // 验证参数
        if (!bookId || !chapterId || !chapterTitle) {
            return res.status(400).json({ error: "缺少必要参数" });
        }
        
        // 记录章节分享
        SharedDB.recordChapterShare(req.session.userId, bookId, chapterId, chapterTitle);
        
        res.json({ success: true, message: "章节分享成功" });
    } catch (error) {
        logger.error("分享章节失败", { error: error.message, userId: req.session.userId, body: req.body });
        res.status(500).json({ error: "分享章节失败" });
    }
});

// 预加载完成后自动分享章节
router.post("/share/preload-chapters", requireLogin, async (req, res) => {
    try {
        const { bookId, chapters } = req.body;
        
        // 验证参数
        if (!bookId || !chapters || !Array.isArray(chapters)) {
            return res.status(400).json({ error: "缺少必要参数" });
        }
        
        // 为每个章节记录分享
        for (const chapter of chapters) {
            if (chapter.hasCached) {
                // 获取当前用户ID作为上传者ID
                const uploaderId = req.session.userId;
                SharedDB.recordChapterShare(req.session.userId, bookId, chapter.id, chapter.title, uploaderId);
            }
        }
        
        res.json({ success: true, message: "章节分享记录成功" });
    } catch (error) {
        logger.error("预加载章节分享记录失败", { error: error.message, userId: req.session.userId, body: req.body });
        res.status(500).json({ error: "章节分享记录失败" });
    }
});

// 获取分享排行榜
let shareRankingCache = null;
let shareRankingCacheTime = null;
const SHARE_RANKING_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时

router.get("/share/ranking", requireLogin, async (req, res) => {
    try {
        // 检查缓存
        if (shareRankingCache && shareRankingCacheTime && 
            (Date.now() - shareRankingCacheTime < SHARE_RANKING_CACHE_DURATION)) {
            return res.json(shareRankingCache);
        }
        
        // 从数据库获取排行榜
        const rankings = db.prepare(`
            SELECT 
                u.username,
                COALESCE(uss.total_shared_books, 0) as sharedBooks,
                COALESCE(uss.total_shared_chapters, 0) as sharedChapters
            FROM users u
            LEFT JOIN user_share_stats uss ON u.id = uss.user_id
            WHERE u.share_enabled = 1 
              AND COALESCE(uss.total_shared_books, 0) > 0
            ORDER BY sharedBooks DESC, sharedChapters DESC
            LIMIT 100
        `).all();
        
        const result = { ranking: rankings };
        
        // 更新缓存
        shareRankingCache = result;
        shareRankingCacheTime = Date.now();
        
        res.json(result);
    } catch (error) {
        logger.error("获取分享排行榜失败", { error: error.message });
        res.status(500).json({ error: "获取排行榜失败" });
    }
});

// 定时清空排行榜缓存（每天凌晨1点）
function scheduleRankingCacheClear() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 1, 0, 0);
    const timeUntilClear = tomorrow - now;
    
    setTimeout(() => {
        shareRankingCache = null;
        shareRankingCacheTime = null;
        logger.info("分享排行榜缓存已清空");
        
        // 设置每24小时清空一次
        setInterval(() => {
            shareRankingCache = null;
            shareRankingCacheTime = null;
            logger.info("分享排行榜缓存已清空");
        }, 24 * 60 * 60 * 1000);
    }, timeUntilClear);
}

// 启动定时任务
scheduleRankingCacheClear();

// ==================== 用户行为分析 API ====================

// 记录用户行为

// 调试端点：获取指定用户的分享统计
router.get("/debug/user/:userId/share-stats", (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        if (isNaN(userId)) {
            return res.status(400).json({ error: "无效的用户ID" });
        }
        
        const stats = SharedDB.getUserShareStats(userId);
        logger.info("调试获取用户分享统计", { userId, stats });
        res.json({ userId, stats });
    } catch (error) {
        logger.error("调试获取用户分享统计失败", { error: error.message, userId: req.params.userId });
        res.status(500).json({ error: "获取分享统计失败" });
    }
});

// 调试端点：检查当前会话
router.get("/debug/session", (req, res) => {
    res.json({
        session: req.session,
        cookies: req.cookies,
        userId: req.session?.userId,
        isAuthenticated: !!req.session?.userId
    });
});

// ==================== 书单功能 API ====================

// 创建书单
router.post("/book-lists", requireLogin, (req, res) => {
    try {
        const { name, description, cover, isPublic } = req.body;
        
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: "书单名称不能为空" });
        }
        
        const listId = BookListDB.create(
            req.session.userId,
            name.trim(),
            description || '',
            cover || '',
            isPublic !== false ? 1 : 0
        );
        
        logger.info("创建书单成功", { userId: req.session.userId, listId, name });
        res.json({ success: true, listId });
    } catch (error) {
        logger.error("创建书单失败", { error: error.message });
        res.status(500).json({ error: "创建书单失败" });
    }
});

// 获取用户的书单列表
router.get("/book-lists/my", requireLogin, (req, res) => {
    try {
        const lists = BookListDB.getByUser(req.session.userId);
        res.json(lists);
    } catch (error) {
        logger.error("获取用户书单失败", { error: error.message });
        res.status(500).json({ error: "获取书单失败" });
    }
});

// 获取单个书单详情
router.get("/book-lists/:id", requireLogin, (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        const list = BookListDB.getById(listId);
        
        if (!list) {
            return res.status(404).json({ error: "书单不存在" });
        }
        
        // 检查权限：公开书单或自己的书单
        if (list.is_public === 0 && list.user_id !== req.session.userId) {
            return res.status(403).json({ error: "无权访问私有书单" });
        }
        
        // 获取书单中的书籍
        const books = BookListDB.getBooks(listId);
        
        // 增加浏览量（不是自己的书单）
        if (list.user_id !== req.session.userId) {
            BookListDB.incrementViewCount(listId);
        }
        
        // 检查是否已收藏
        const isCollected = BookListDB.isCollected(listId, req.session.userId);
        
        res.json({
            ...list,
            books,
            isCollected
        });
    } catch (error) {
        logger.error("获取书单详情失败", { error: error.message });
        res.status(500).json({ error: "获取书单详情失败" });
    }
});

// 更新书单
router.put("/book-lists/:id", requireLogin, (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        const { name, description, cover, isPublic } = req.body;
        
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: "书单名称不能为空" });
        }
        
        const result = BookListDB.update(
            listId,
            req.session.userId,
            name.trim(),
            description || '',
            cover || '',
            isPublic !== false ? 1 : 0
        );
        
        if (result.changes === 0) {
            return res.status(403).json({ error: "无权修改此书单" });
        }
        
        logger.info("更新书单成功", { userId: req.session.userId, listId, name });
        res.json({ success: true });
    } catch (error) {
        logger.error("更新书单失败", { error: error.message });
        res.status(500).json({ error: "更新书单失败" });
    }
});

// 删除书单
router.delete("/book-lists/:id", requireLogin, (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        const result = BookListDB.delete(listId, req.session.userId);
        
        if (result.changes === 0) {
            return res.status(403).json({ error: "无权删除此书单" });
        }
        
        logger.info("删除书单成功", { userId: req.session.userId, listId });
        res.json({ success: true });
    } catch (error) {
        logger.error("删除书单失败", { error: error.message });
        res.status(500).json({ error: "删除书单失败" });
    }
});

// 添加书籍到书单
router.post("/book-lists/:id/books", requireLogin, (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        const { bookId, title, author, cover, note } = req.body;
        
        if (!bookId || !title) {
            return res.status(400).json({ error: "书籍ID和标题不能为空" });
        }
        
        // 检查书单所有者
        const list = BookListDB.getById(listId);
        if (!list || list.user_id !== req.session.userId) {
            return res.status(403).json({ error: "无权修改此书单" });
        }
        
        const added = BookListDB.addBook(listId, bookId, title, author || '', cover || '', note || '');
        
        if (!added) {
            return res.json({ success: false, message: "书籍已存在于书单中" });
        }
        
        logger.info("添加书籍到书单", { userId: req.session.userId, listId, bookId, title });
        res.json({ success: true });
    } catch (error) {
        logger.error("添加书籍到书单失败", { error: error.message });
        res.status(500).json({ error: "添加书籍失败" });
    }
});

// 从书单移除书籍
router.delete("/book-lists/:id/books/:bookId", requireLogin, (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        const bookId = req.params.bookId;
        
        // 检查书单所有者
        const list = BookListDB.getById(listId);
        if (!list || list.user_id !== req.session.userId) {
            return res.status(403).json({ error: "无权修改此书单" });
        }
        
        const removed = BookListDB.removeBook(listId, bookId);
        
        if (!removed) {
            return res.status(404).json({ error: "书籍不在书单中" });
        }
        
        logger.info("从书单移除书籍", { userId: req.session.userId, listId, bookId });
        res.json({ success: true });
    } catch (error) {
        logger.error("移除书籍失败", { error: error.message });
        res.status(500).json({ error: "移除书籍失败" });
    }
});

// 书单广场（获取公开书单）
router.get("/book-lists/square/list", (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 20;
        const sortBy = req.query.sortBy || 'hot'; // hot, new, collect
        
        const lists = BookListDB.getPublicLists(page, pageSize, sortBy);
        res.json(lists);
    } catch (error) {
        logger.error("获取书单广场失败", { error: error.message });
        res.status(500).json({ error: "获取书单广场失败" });
    }
});

// 搜索书单
router.get("/book-lists/square/search", (req, res) => {
    try {
        const keyword = req.query.keyword || '';
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 20;
        
        if (!keyword.trim()) {
            return res.json([]);
        }
        
        const lists = BookListDB.search(keyword.trim(), page, pageSize);
        res.json(lists);
    } catch (error) {
        logger.error("搜索书单失败", { error: error.message });
        res.status(500).json({ error: "搜索书单失败" });
    }
});

// 收藏书单
router.post("/book-lists/:id/collect", requireLogin, (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        const list = BookListDB.getById(listId);
        
        if (!list) {
            return res.status(404).json({ error: "书单不存在" });
        }
        
        if (list.user_id === req.session.userId) {
            return res.status(400).json({ error: "不能收藏自己的书单" });
        }
        
        const collected = BookListDB.collect(listId, req.session.userId);
        
        if (!collected) {
            return res.json({ success: false, message: "已经收藏过此书单" });
        }
        
        logger.info("收藏书单", { userId: req.session.userId, listId });
        res.json({ success: true });
    } catch (error) {
        logger.error("收藏书单失败", { error: error.message });
        res.status(500).json({ error: "收藏书单失败" });
    }
});

// 取消收藏书单
router.delete("/book-lists/:id/collect", requireLogin, (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        const uncollected = BookListDB.uncollect(listId, req.session.userId);
        
        if (!uncollected) {
            return res.status(404).json({ error: "未收藏此书单" });
        }
        
        logger.info("取消收藏书单", { userId: req.session.userId, listId });
        res.json({ success: true });
    } catch (error) {
        logger.error("取消收藏书单失败", { error: error.message });
        res.status(500).json({ error: "取消收藏书单失败" });
    }
});

// 获取用户收藏的书单
router.get("/book-lists/collected/list", requireLogin, (req, res) => {
    try {
        const lists = BookListDB.getCollectedLists(req.session.userId);
        res.json(lists);
    } catch (error) {
        logger.error("获取收藏书单失败", { error: error.message });
        res.status(500).json({ error: "获取收藏书单失败" });
    }
});

// ==================== 书单评论 API ====================

// 添加书单评论
router.post("/book-lists/:id/comments", requireLogin, (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        const { content, rating } = req.body;
        
        if (!content || content.trim().length < 1) {
            return res.status(400).json({ error: "评论内容不能为空" });
        }
        
        if (rating !== null && rating !== undefined && (rating < 1 || rating > 5)) {
            return res.status(400).json({ error: "评分必须在1-5之间" });
        }
        
        // 检查书单是否存在
        const list = BookListDB.getById(listId);
        if (!list) {
            return res.status(404).json({ error: "书单不存在" });
        }
        
        // 添加评论
        BookListCommentDB.addComment(listId, req.session.userId, content.trim(), rating);
        
        logger.info("添加书单评论", { userId: req.session.userId, listId, rating });
        res.json({ success: true });
    } catch (error) {
        logger.error("添加书单评论失败", { error: error.message });
        res.status(500).json({ error: "添加评论失败" });
    }
});

// 获取书单评论
router.get("/book-lists/:id/comments", (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 20;
        
        // 检查书单是否存在
        const list = BookListDB.getById(listId);
        if (!list) {
            return res.status(404).json({ error: "书单不存在" });
        }
        
        const comments = BookListCommentDB.getComments(listId, page, pageSize);
        
        res.json(comments);
    } catch (error) {
        logger.error("获取书单评论失败", { error: error.message });
        res.status(500).json({ error: "获取评论失败" });
    }
});

// 获取书单评分统计
router.get("/book-lists/:id/rating", (req, res) => {
    try {
        const listId = parseInt(req.params.id);
        
        // 检查书单是否存在
        const list = BookListDB.getById(listId);
        if (!list) {
            return res.status(404).json({ error: "书单不存在" });
        }
        
        const avgRating = BookListCommentDB.getAverageRating(listId);
        const commentCount = BookListCommentDB.getCommentCount(listId);
        
        res.json({
            averageRating: avgRating,
            commentCount: commentCount
        });
    } catch (error) {
        logger.error("获取书单评分统计失败", { error: error.message });
        res.status(500).json({ error: "获取评分统计失败" });
    }
});

// ==================== 纠错功能 API ====================

// 检查是否是管理员
router.get("/auth/check-admin", requireLogin, (req, res) => {
    try {
        const user = UserDB.findById(req.session.userId);
        res.json({ isAdmin: user && user.username === 'admin' });
    } catch (error) {
        res.json({ isAdmin: false });
    }
});

// 提交纠错
router.post("/corrections", requireLogin, (req, res) => {
    try {
        const { bookId, chapterId, originalText, correctedText } = req.body;
        
        if (!bookId || !chapterId || !originalText || !correctedText) {
            return res.status(400).json({ error: "缺少必要参数" });
        }
        
        if (originalText === correctedText) {
            return res.status(400).json({ error: "原文和修正内容相同" });
        }
        
        const db = require("better-sqlite3")("./data/po18.db");
        db.prepare(`
            INSERT INTO corrections (user_id, book_id, chapter_id, original_text, corrected_text)
            VALUES (?, ?, ?, ?, ?)
        `).run(req.session.userId, bookId, chapterId, originalText, correctedText);
        
        logger.info("提交纠错", { userId: req.session.userId, bookId, chapterId });
        res.json({ success: true, message: "纠错已提交，等待审核" });
    } catch (error) {
        logger.error("提交纠错失败", { error: error.message });
        res.status(500).json({ error: "提交失败" });
    }
});

// 获取用户的纠错记录
router.get("/corrections/my", requireLogin, (req, res) => {
    try {
        const db = require("better-sqlite3")("./data/po18.db");
        const corrections = db.prepare(`
            SELECT c.*, m.title as book_title
            FROM corrections c
            LEFT JOIN book_metadata m ON c.book_id = m.book_id
            WHERE c.user_id = ?
            ORDER BY c.created_at DESC
        `).all(req.session.userId);
        
        res.json(corrections);
    } catch (error) {
        res.status(500).json({ error: "获取失败" });
    }
});

// 获取所有纠错列表（管理员）
router.get("/admin/corrections", requireAdmin, (req, res) => {
    try {
        const { status = 'pending', page = 1, pageSize = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);
        
        const db = require("better-sqlite3")("./data/po18.db");
        
        // 获取各状态统计
        const stats = {
            pending: db.prepare("SELECT COUNT(*) as count FROM corrections WHERE status = 'pending'").get().count,
            approved: db.prepare("SELECT COUNT(*) as count FROM corrections WHERE status = 'approved'").get().count,
            rejected: db.prepare("SELECT COUNT(*) as count FROM corrections WHERE status = 'rejected'").get().count
        };
        
        const total = stats[status] || 0;
        
        const corrections = db.prepare(`
            SELECT c.*, u.username, m.title as book_title
            FROM corrections c
            LEFT JOIN users u ON c.user_id = u.id
            LEFT JOIN book_metadata m ON c.book_id = m.book_id
            WHERE c.status = ?
            ORDER BY c.created_at DESC
            LIMIT ? OFFSET ?
        `).all(status, parseInt(pageSize), offset);
        
        res.json({ corrections, total, stats });
    } catch (error) {
        logger.error("获取纠错列表失败", { error: error.message });
        res.status(500).json({ error: "获取失败" });
    }
});

// 审核纠错（管理员）
router.post("/admin/corrections/:id/review", requireAdmin, (req, res) => {
    try {
        const correctionId = parseInt(req.params.id);
        const { action } = req.body; // 'approve' or 'reject'
        
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: "无效的操作" });
        }
        
        const db = require("better-sqlite3")("./data/po18.db");
        
        // 获取纠错记录
        const correction = db.prepare("SELECT * FROM corrections WHERE id = ?").get(correctionId);
        if (!correction) {
            return res.status(404).json({ error: "纠错记录不存在" });
        }
        
        if (correction.status !== 'pending') {
            return res.status(400).json({ error: "该纠错已被处理" });
        }
        
        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        
        // 更新纠错状态
        db.prepare(`
            UPDATE corrections SET status = ?, reviewer_id = ?, review_time = datetime('now')
            WHERE id = ?
        `).run(newStatus, req.session.userId, correctionId);
        
        // 如果审核通过，更新章节内容并给用户加积分
        if (action === 'approve') {
            // 更新章节内容
            const chapter = db.prepare(`
                SELECT * FROM chapter_cache WHERE book_id = ? AND chapter_id = ?
            `).get(correction.book_id, correction.chapter_id);
            
            if (chapter) {
                const newText = chapter.text.replace(correction.original_text, correction.corrected_text);
                const newHtml = chapter.html ? chapter.html.replace(correction.original_text, correction.corrected_text) : null;
                
                db.prepare(`
                    UPDATE chapter_cache SET text = ?, html = ?, updated_at = datetime('now')
                    WHERE book_id = ? AND chapter_id = ?
                `).run(newText, newHtml, correction.book_id, correction.chapter_id);
            }
            
            // 给用户加积分
            db.prepare(`
                UPDATE users SET points = COALESCE(points, 0) + 1 WHERE id = ?
            `).run(correction.user_id);
            
            logger.info("纠错审核通过", { correctionId, userId: correction.user_id });
        }
        
        res.json({ success: true, message: action === 'approve' ? '已通过并更新内容' : '已拒绝' });
    } catch (error) {
        logger.error("审核纠错失败", { error: error.message });
        res.status(500).json({ error: "审核失败" });
    }
});

// ==================== 书籍删除 API ====================

// 删除书籍（可选删除全部或仅章节）
router.delete("/books/:bookId", requireAdmin, (req, res) => {
    try {
        const { bookId } = req.params;
        const { deleteType = 'all' } = req.query; // 'all' or 'chapters'
        
        const db = require("better-sqlite3")("./data/po18.db");
        
        // 删除章节缓存
        const chapterResult = db.prepare("DELETE FROM chapter_cache WHERE book_id = ?").run(bookId);
        
        let metadataDeleted = 0;
        if (deleteType === 'all') {
            // 删除书籍元信息
            const metaResult = db.prepare("DELETE FROM book_metadata WHERE book_id = ?").run(bookId);
            metadataDeleted = metaResult.changes;
            
            // 删除相关纠错记录
            db.prepare("DELETE FROM corrections WHERE book_id = ?").run(bookId);
        }
        
        logger.info("删除书籍", { bookId, deleteType, chaptersDeleted: chapterResult.changes, metadataDeleted });
        res.json({ 
            success: true, 
            chaptersDeleted: chapterResult.changes,
            metadataDeleted,
            message: deleteType === 'all' ? '已删除全部数据' : '已删除章节数据'
        });
    } catch (error) {
        logger.error("删除书籍失败", { error: error.message });
        res.status(500).json({ error: "删除失败" });
    }
});

// 获取用户积分
router.get("/user/points", requireLogin, (req, res) => {
    try {
        const db = require("better-sqlite3")("./data/po18.db");
        const user = db.prepare("SELECT points FROM users WHERE id = ?").get(req.session.userId);
        res.json({ points: user?.points || 0 });
    } catch (error) {
        res.status(500).json({ error: "获取失败" });
    }
});

// ==================== 书评功能 API ====================

// 获取书评列表
router.get("/reviews", (req, res) => {
    try {
        const { sort = 'latest', page = 1, pageSize = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);
        
        let orderBy = 'r.created_at DESC';
        if (sort === 'hot') {
            orderBy = 'r.likes DESC, r.created_at DESC';
        } else if (sort === 'rating') {
            orderBy = 'r.rating DESC, r.created_at DESC';
        }
        
        const total = db.prepare("SELECT COUNT(*) as count FROM book_reviews").get().count;
        
        const reviews = db.prepare(`
            SELECT r.*, u.username
            FROM book_reviews r
            LEFT JOIN users u ON r.user_id = u.id
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `).all(parseInt(pageSize), offset);
        
        // 如果用户已登录，检查是否已点赞
        if (req.session && req.session.userId) {
            const likedIds = db.prepare(`
                SELECT review_id FROM review_likes WHERE user_id = ?
            `).all(req.session.userId).map(l => l.review_id);
            
            reviews.forEach(r => {
                r.hasLiked = likedIds.includes(r.id);
            });
        }
        
        res.json({ reviews, total, page: parseInt(page), pageSize: parseInt(pageSize) });
    } catch (error) {
        logger.error("获取书评列表失败", { error: error.message, stack: error.stack });
        res.status(500).json({ error: "获取失败: " + error.message });
    }
});

// 发表书评
router.post("/reviews", requireLogin, (req, res) => {
    try {
        const { bookId, bookTitle, bookCover, bookAuthor, rating, content } = req.body;
        
        if (!bookId || !content) {
            return res.status(400).json({ error: "缺少必要参数" });
        }
        
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ error: "评分必须在1-5之间" });
        }
        
        // 检查是否已经评论过这本书
        const existing = db.prepare(`
            SELECT id FROM book_reviews WHERE user_id = ? AND book_id = ?
        `).get(req.session.userId, bookId);
        
        if (existing) {
            return res.status(400).json({ error: "你已经评论过这本书了" });
        }
        
        const result = db.prepare(`
            INSERT INTO book_reviews (user_id, book_id, book_title, book_cover, book_author, rating, content)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(req.session.userId, bookId, bookTitle, bookCover, bookAuthor, rating, content);
        
        logger.info("发表书评", { userId: req.session.userId, bookId, rating });
        res.json({ success: true, reviewId: result.lastInsertRowid, message: "书评发表成功" });
    } catch (error) {
        logger.error("发表书评失败", { error: error.message });
        res.status(500).json({ error: "发表失败" });
    }
});

// 点赞/取消点赞书评
router.post("/reviews/:id/like", requireLogin, (req, res) => {
    try {
        const reviewId = parseInt(req.params.id);
        
        // 检查是否已点赞
        const existing = db.prepare(`
            SELECT id FROM review_likes WHERE review_id = ? AND user_id = ?
        `).get(reviewId, req.session.userId);
        
        if (existing) {
            // 取消点赞
            db.prepare("DELETE FROM review_likes WHERE id = ?").run(existing.id);
            db.prepare("UPDATE book_reviews SET likes = likes - 1 WHERE id = ?").run(reviewId);
            res.json({ success: true, liked: false, message: "已取消点赞" });
        } else {
            // 点赞
            db.prepare(`
                INSERT INTO review_likes (review_id, user_id) VALUES (?, ?)
            `).run(reviewId, req.session.userId);
            db.prepare("UPDATE book_reviews SET likes = likes + 1 WHERE id = ?").run(reviewId);
            res.json({ success: true, liked: true, message: "点赞成功" });
        }
    } catch (error) {
        logger.error("点赞操作失败", { error: error.message });
        res.status(500).json({ error: "操作失败" });
    }
});

// 搜索书籍（用于写书评时选择书籍）
router.get("/books/search", (req, res) => {
    try {
        const { keyword } = req.query;
        if (!keyword || keyword.length < 2) {
            return res.json([]);
        }
        
        const books = db.prepare(`
            SELECT book_id, title, author, cover
            FROM book_metadata
            WHERE title LIKE ? OR author LIKE ?
            LIMIT 10
        `).all(`%${keyword}%`, `%${keyword}%`);
        
        res.json(books);
    } catch (error) {
        res.status(500).json({ error: "搜索失败" });
    }
});

// 删除书评（仅作者或管理员）
router.delete("/reviews/:id", requireLogin, (req, res) => {
    try {
        const reviewId = parseInt(req.params.id);
        
        const review = db.prepare("SELECT * FROM book_reviews WHERE id = ?").get(reviewId);
        if (!review) {
            return res.status(404).json({ error: "书评不存在" });
        }
        
        // 检查权限
        const user = UserDB.findById(req.session.userId);
        if (review.user_id !== req.session.userId && user.username !== 'admin') {
            return res.status(403).json({ error: "无权删除" });
        }
        
        // 删除点赞记录
        db.prepare("DELETE FROM review_likes WHERE review_id = ?").run(reviewId);
        // 删除书评
        db.prepare("DELETE FROM book_reviews WHERE id = ?").run(reviewId);
        
        res.json({ success: true, message: "删除成功" });
    } catch (error) {
        logger.error("删除书评失败", { error: error.message });
        res.status(500).json({ error: "删除失败" });
    }
});

// ==================== 游戏系统API ====================

// 获取用户游戏数据
router.get("/game/data", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const gameData = GameDB.getUserGameData(userId);
        const fragments = GameDB.getUserFragments(userId);
        const items = GameDB.getUserItems(userId);
        const techniques = GameDB.getUserTechniques(userId);

        // 境界名称映射
        const levelNames = [
            "炼气期", "筑基期", "金丹期", "元婴期", "化神期", 
            "合体期", "大乘期", "渡劫期"
        ];
        const levelIndex = Math.min(Math.floor((gameData.level - 1) / 10), levelNames.length - 1);
        const levelName = levelNames[levelIndex];
        const levelLayer = ((gameData.level - 1) % 10) + 1;

        // 计算今日阅读统计
        const today = new Date().toISOString().split('T')[0];
        const todaySessions = db.prepare(`
            SELECT SUM(words_read) as words, SUM(reading_time) as time
            FROM reading_sessions
            WHERE user_id = ? AND DATE(session_start) = ?
        `).get(userId, today);
        
        const todayWords = todaySessions?.words || 0;
        const todayTime = todaySessions?.time || 0;

        // 使用动态算法计算到下一级所需修为
        const expForCurrentLevel = GameDB.getExpRequiredForLevel(gameData.level);
        const expForNextLevel = GameDB.getExpRequiredForLevel(gameData.level + 1);
        const expToNextLevel = expForNextLevel - expForCurrentLevel; // 当前层所需的总修为
        const currentLevelExp = gameData.exp - expForCurrentLevel; // 当前层已获得的修为
        const expToNext = Math.max(0, expToNextLevel - currentLevelExp); // 当前层还需的修为

        res.json({
            success: true,
            data: {
                level: gameData.level,
                levelName,
                levelLayer,
                exp: gameData.exp,
                expToNext, // 当前层还需的修为
                expForCurrentLevel, // 达到当前等级所需的总修为（累计）
                expToNextLevel, // 当前层所需的总修为（用于进度条计算）
                totalReadWords: gameData.total_read_words,
                totalReadTime: gameData.total_read_time,
                todayReadWords: todayWords,
                todayReadTime: todayTime,
                fragments,
                items,
                techniques
            }
        });
    } catch (error) {
        logger.error("获取游戏数据失败", { error: error.message });
        res.status(500).json({ error: "获取游戏数据失败" });
    }
});

// 记录阅读并计算奖励
router.post("/game/reading", requireLogin, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { wordsRead, readingTime, bookId, chapterId } = req.body;

        if (!wordsRead || wordsRead <= 0) {
            return res.json({ success: true, data: { expGained: 0, fragments: [] } });
        }

        // 计算修为（每1000字 = 10-20修为，根据境界调整）
        const gameData = GameDB.getUserGameData(userId);
        let expPerThousand = 10 + Math.floor(gameData.level / 5); // 境界越高，每千字获得的修为越多
        
        // 应用装备功法的加成
        const techniques = GameDB.getUserTechniques(userId);
        const equippedTechniques = techniques.filter(t => t.is_equipped);
        let expMultiplier = 1.0;
        
        equippedTechniques.forEach(tech => {
            // 根据功法名称计算加成
            if (tech.technique_id === "清心诀") expMultiplier += 0.10;
            else if (tech.technique_id === "凝神诀") expMultiplier += 0.15;
            else if (tech.technique_id === "悟道诀") expMultiplier += 0.20;
            else if (tech.technique_id === "静心诀") expMultiplier += 0.12;
        });
        
        const expGained = Math.floor((wordsRead / 1000) * expPerThousand * expMultiplier);

        // 增加修为和阅读数据
        const { exp, level, leveledUp, oldLevel } = GameDB.addExp(userId, expGained);
        GameDB.addReadWords(userId, wordsRead);
        if (readingTime) {
            GameDB.addReadTime(userId, readingTime);
        }

        // 更新成就进度（需要重新获取更新后的数据）
        const updatedGameData = GameDB.getUserGameData(userId);
        const totalWords = updatedGameData.total_read_words;
        GameDB.updateAchievementProgress(userId, "read_10k", totalWords);
        GameDB.updateAchievementProgress(userId, "read_100k", totalWords);
        GameDB.updateAchievementProgress(userId, "read_1m", totalWords);
        GameDB.updateAchievementProgress(userId, "read_10m", totalWords);
        GameDB.updateAchievementProgress(userId, "read_50k_day", wordsRead);
        
        // 检查境界成就
        const levelNames = ["炼气期", "筑基期", "金丹期", "元婴期", "化神期"];
        const realmIndex = Math.min(Math.floor((level - 1) / 10), levelNames.length - 1);
        if (realmIndex >= 0) {
            const realmIds = ["realm_qi", "realm_zhu", "realm_jin", "realm_yuan", "realm_hua"];
            for (let i = 0; i <= realmIndex; i++) {
                GameDB.updateAchievementProgress(userId, realmIds[i], 1);
            }
        }
        
        // 碎片掉落（每章有概率掉落1-3个碎片）
        const fragmentsObtained = [];
        const fragmentTypes = ["technique", "pill", "artifact", "beast"];
        const fragmentNames = {
            technique: ["清心诀", "凝神诀", "悟道诀", "静心诀"],
            pill: ["回神丹", "悟道丹", "清心丹", "聚灵丹"],
            artifact: ["书签法宝", "护眼法宝", "记忆法宝", "专注法宝"],
            beast: ["灵狐", "仙鹤", "神龙", "凤凰"]
        };

        // 计算碎片掉落率（基础30%，装备悟道丹可提升）
        let fragmentDropRate = 0.3;
        const items = GameDB.getUserItems(userId);
        const hasWudaoPill = items.some(item => item.item_type === "pill" && item.item_id === "悟道丹");
        if (hasWudaoPill) {
            fragmentDropRate = 0.5; // 悟道丹提升到50%
        }

        // 每阅读一章，有概率掉落碎片
        if (chapterId && Math.random() < fragmentDropRate) {
            const fragmentCount = Math.floor(Math.random() * 3) + 1; // 1-3个
            for (let i = 0; i < fragmentCount; i++) {
                const type = fragmentTypes[Math.floor(Math.random() * fragmentTypes.length)];
                const names = fragmentNames[type];
                const fragmentId = names[Math.floor(Math.random() * names.length)];
                
                GameDB.addFragment(userId, type, fragmentId, 1);
                fragmentsObtained.push({ type, id: fragmentId, name: fragmentId });
            }
        }

        // 记录阅读会话
        GameDB.recordReadingSession(userId, {
            bookId,
            chapterId,
            wordsRead,
            readingTime: readingTime || 0,
            fragmentsObtained,
            expGained,
            sessionStart: new Date().toISOString(),
            sessionEnd: new Date().toISOString()
        });

        // 更新任务进度
        GameDB.updateTaskProgress(userId, "reading", {
            wordsRead,
            readingTime: readingTime || 0,
            chaptersRead: chapterId ? 1 : 0,
            leveledUp: leveledUp || false,
            fragmentsObtained: fragmentsObtained.length
        });

        res.json({
            success: true,
            data: {
                expGained,
                exp,
                level,
                leveledUp: leveledUp || false,
                oldLevel: oldLevel || level,
                fragments: fragmentsObtained
            }
        });
    } catch (error) {
        logger.error("记录阅读失败", { error: error.message });
        res.status(500).json({ error: "记录阅读失败" });
    }
});

// 使用道具
router.post("/game/items/use", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { itemType, itemId, quantity = 1 } = req.body;

        const success = GameDB.useItem(userId, itemType, itemId, quantity);
        if (!success) {
            return res.status(400).json({ error: "道具不足" });
        }

        // 更新任务进度
        GameDB.updateTaskProgress(userId, "cultivation", {
            itemsUsed: 1
        });

        // 道具效果（暂时只记录使用，效果在阅读时计算）
        let effect = "";
        if (itemId === "回神丹") {
            effect = "下次阅读时修为+50%";
        } else if (itemId === "悟道丹") {
            effect = "碎片掉落率提升至50%（持续1小时）";
        } else if (itemId === "清心丹") {
            effect = "阅读时专注度提升";
        } else if (itemId === "聚灵丹") {
            effect = "立即获得100修为";
            GameDB.addExp(userId, 100);
        }

        res.json({ success: true, message: "使用成功", effect });
    } catch (error) {
        logger.error("使用道具失败", { error: error.message });
        res.status(500).json({ error: "使用道具失败" });
    }
});

// 装备/卸下功法
router.post("/game/techniques/toggle", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { techniqueId } = req.body;

        const isEquipped = GameDB.toggleTechniqueEquip(userId, techniqueId);
        
        // 如果装备新功法，更新任务进度
        if (isEquipped) {
            GameDB.updateTaskProgress(userId, "cultivation", {
                techniqueEquipped: true
            });
        }
        
        res.json({ success: true, isEquipped });
    } catch (error) {
        logger.error("切换功法装备状态失败", { error: error.message });
        res.status(500).json({ error: "操作失败" });
    }
});

// 合成碎片
router.post("/game/fragments/synthesize", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { fragmentType, fragmentId } = req.body;

        const result = GameDB.synthesizeFragment(userId, fragmentType, fragmentId);
        if (!result.success) {
            return res.status(400).json({ error: result.message });
        }

        // 更新任务进度
        GameDB.updateTaskProgress(userId, "cultivation", {
            fragmentsSynthesized: 1
        });

        res.json({ success: true, data: result });
    } catch (error) {
        logger.error("合成碎片失败", { error: error.message });
        res.status(500).json({ error: "合成失败" });
    }
});

// 获取离线收益
router.get("/game/offline-reward", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const gameData = GameDB.getUserGameData(userId);
        
        if (!gameData.last_read_time) {
            return res.json({ success: true, data: { offlineTime: 0, expGained: 0 } });
        }

        const lastReadTime = new Date(gameData.last_read_time);
        const now = new Date();
        const offlineSeconds = Math.floor((now - lastReadTime) / 1000);
        
        // 最多计算24小时的离线收益
        const maxOfflineSeconds = 24 * 60 * 60;
        const actualOfflineSeconds = Math.min(offlineSeconds, maxOfflineSeconds);
        
        // 离线收益：每分钟1修为（根据境界调整）
        const expPerMinute = 1 + Math.floor(gameData.level / 10);
        const expGained = Math.floor((actualOfflineSeconds / 60) * expPerMinute);
        
        if (expGained > 0) {
            GameDB.addExp(userId, expGained);
            GameDB.updateUserGameData(userId, { last_read_time: now.toISOString() });
        }

        res.json({
            success: true,
            data: {
                offlineTime: actualOfflineSeconds,
                offlineHours: Math.floor(actualOfflineSeconds / 3600),
                offlineMinutes: Math.floor((actualOfflineSeconds % 3600) / 60),
                expGained
            }
        });
    } catch (error) {
        logger.error("计算离线收益失败", { error: error.message });
        res.status(500).json({ error: "计算失败" });
    }
});

// ==================== 签到系统 ====================

// 获取签到信息
router.get("/game/signin/info", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const signinInfo = GameDB.getSigninInfo(userId);
        res.json({ success: true, data: signinInfo });
    } catch (error) {
        logger.error("获取签到信息失败", { error: error.message });
        res.status(500).json({ error: "获取失败" });
    }
});

// 签到
router.post("/game/signin", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const result = GameDB.signin(userId);
        if (result.success) {
            res.json({ success: true, data: result });
        } else {
            res.status(400).json({ success: false, message: result.message });
        }
    } catch (error) {
        logger.error("签到失败", { error: error.message });
        res.status(500).json({ error: "签到失败" });
    }
});

// ==================== 成就系统 ====================

// 获取所有成就
router.get("/game/achievements", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const achievements = GameDB.getAllAchievements(userId);
        
        // 获取成就配置
        const achievementConfig = {
            "read_10k": { name: "初入仙途", desc: "累计阅读1万字", type: "reading" },
            "read_100k": { name: "书山有路", desc: "累计阅读10万字", type: "reading" },
            "read_1m": { name: "博览群书", desc: "累计阅读100万字", type: "reading" },
            "read_10m": { name: "阅读达人", desc: "累计阅读1000万字", type: "reading" },
            "read_7days": { name: "夜读仙君", desc: "连续7天阅读", type: "reading" },
            "read_30days": { name: "持之以恒", desc: "连续30天阅读", type: "reading" },
            "read_50k_day": { name: "一日千里", desc: "单日阅读5万字", type: "reading" },
            "realm_qi": { name: "初窥门径", desc: "达到炼气期", type: "realm" },
            "realm_zhu": { name: "筑基成功", desc: "达到筑基期", type: "realm" },
            "realm_jin": { name: "金丹大道", desc: "达到金丹期", type: "realm" },
            "realm_yuan": { name: "元婴老祖", desc: "达到元婴期", type: "realm" },
            "realm_hua": { name: "化神大能", desc: "达到化神期", type: "realm" },
            "fragments_100": { name: "碎片收集者", desc: "收集100个碎片", type: "collection" },
            "techniques_10": { name: "功法大师", desc: "解锁10种功法", type: "collection" },
            "items_50": { name: "道具收藏家", desc: "拥有50种道具", type: "collection" },
            "realm_5_day": { name: "破境如喝水", desc: "一天内提升5个境界", type: "special" },
            "exp_1000": { name: "修为暴涨", desc: "单次获得1000修为", type: "special" },
            "fragments_3": { name: "欧皇附体", desc: "连续3次掉落碎片", type: "special" }
        };
        
        const achievementsWithConfig = achievements.map(ach => ({
            ...ach,
            ...achievementConfig[ach.achievement_id],
            reward: GameDB.getAchievementReward(ach.achievement_id)
        }));
        
        res.json({ success: true, data: achievementsWithConfig });
    } catch (error) {
        logger.error("获取成就失败", { error: error.message });
        res.status(500).json({ error: "获取失败" });
    }
});

// 领取成就奖励
router.post("/game/achievements/claim", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { achievementId } = req.body;
        const result = GameDB.claimAchievementReward(userId, achievementId);
        res.json(result);
    } catch (error) {
        logger.error("领取成就奖励失败", { error: error.message });
        res.status(500).json({ error: "领取失败" });
    }
});

// ==================== 每日任务系统 ====================

// 获取每日任务
router.get("/game/tasks", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const tasks = GameDB.getDailyTasks(userId);
        res.json({ success: true, data: tasks });
    } catch (error) {
        logger.error("获取任务失败", { error: error.message });
        res.status(500).json({ error: "获取失败" });
    }
});

// 更新任务进度（内部调用，阅读时自动更新）
router.post("/game/tasks/update", requireLogin, (req, res) => {
    try {
        const userId = req.session.userId;
        const { taskType, progress } = req.body;
        const completedTasks = GameDB.updateTaskProgress(userId, taskType, progress);
        res.json({ success: true, data: { completedTasks } });
    } catch (error) {
        logger.error("更新任务进度失败", { error: error.message });
        res.status(500).json({ error: "更新失败" });
    }
});

module.exports = router;