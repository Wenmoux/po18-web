/**
 * PO18小说下载网站 - API路由模块
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');

const { UserDB, LibraryDB, QueueDB, PurchasedDB, SharedDB, HistoryDB, BookMetadataDB, WebDAVConfigDB, ChapterCacheDB } = require('./database');
const { NovelCrawler, ContentFormatter, EpubGenerator } = require('./crawler');
const WebDAVClient = require('./webdav');
const config = require('./config');

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
    concurrency: 1,           // 并发线程数
    activeThreads: 0,         // 当前活跃线程数
    pendingQueue: [],         // 待处理ID队列
    
    addLog(message, type = 'info') {
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
        const avgSpeed = elapsed > 0 ? Math.round(this.totalProcessed / elapsed * 60) : 0; // 每分钟处理数
        
        return {
            isRunning: this.isRunning,
            startId: this.startId,
            endId: this.endId,
            currentId: this.currentId,
            successCount: this.successCount,
            failCount: this.failCount,
            totalProcessed: this.totalProcessed,
            progress: totalIds > 0 ? 
                Math.round(this.totalProcessed / totalIds * 100) : 0,
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

// 中间件：检查登录状态
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '请先登录' });
    }
    next();
};

// ==================== 用户认证 API ====================

// 注册
router.post('/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }
        
        if (username.length < 3 || password.length < 6) {
            return res.status(400).json({ error: '用户名至少3位，密码至少6位' });
        }
        
        // 检查用户名是否存在
        const existing = UserDB.findByUsername(username);
        if (existing) {
            return res.status(400).json({ error: '用户名已存在' });
        }
        
        // 创建用户（生产环境应该加密密码）
        const result = UserDB.create(username, password);
        
        // 自动登录
        req.session.userId = result.lastInsertRowid;
        req.session.username = username;
        
        res.json({ success: true, message: '注册成功' });
    } catch (error) {
        console.error('注册失败:', error);
        res.status(500).json({ error: '注册失败' });
    }
});

// 登录
router.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = UserDB.findByUsername(username);
        if (!user || user.password !== password) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        
        req.session.userId = user.id;
        req.session.username = user.username;
        
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
        console.error('登录失败:', error);
        res.status(500).json({ error: '登录失败' });
    }
});

// 登出
router.post('/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// 获取当前用户信息
router.get('/auth/me', requireLogin, (req, res) => {
    const user = UserDB.findById(req.session.userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }
    
    res.json({
        id: user.id,
        username: user.username,
        hasPo18Cookie: !!user.po18_cookie,
        hasWebDAV: !!user.webdav_config,
        shareEnabled: user.share_enabled === 1,
        sharedBooksCount: user.shared_books_count,
        canAccessShared: UserDB.canAccessSharedLibrary(user.id)
    });
});

// ==================== PO18 Cookie 管理 ====================

// 获取PO18 Cookie
router.get('/po18/cookie', requireLogin, (req, res) => {
    try {
        const user = UserDB.findById(req.session.userId);
        res.json({ 
            cookie: user?.po18_cookie || '',
            hasCookie: !!user?.po18_cookie
        });
    } catch (error) {
        res.status(500).json({ error: '获取Cookie失败' });
    }
});

// 设置PO18 Cookie
router.post('/po18/cookie', requireLogin, async (req, res) => {
    try {
        let { cookie } = req.body;
        
        if (!cookie) {
            return res.status(400).json({ error: 'Cookie不能为空' });
        }
        
        // 清理cookie中的非法字符
        if (typeof cookie === 'string') {
            cookie = cookie.trim().replace(/[\r\n]+/g, '');
        }
        
        // 验证Cookie
        const crawler = new NovelCrawler(cookie);
        const isValid = await crawler.validateCookie();
        
        if (!isValid) {
            return res.status(400).json({ error: 'Cookie无效或已过期' });
        }
        
        // 保存清理后的Cookie
        UserDB.updatePo18Cookie(req.session.userId, cookie);
        
        res.json({ success: true, message: 'Cookie设置成功' });
    } catch (error) {
        console.error('设置Cookie失败:', error);
        res.status(500).json({ error: '设置Cookie失败' });
    }
});

// 验证PO18 Cookie
router.get('/po18/validate', requireLogin, async (req, res) => {
    try {
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.json({ valid: false, message: '未设置Cookie' });
        }
        
        const crawler = new NovelCrawler(user.po18_cookie);
        const isValid = await crawler.validateCookie();
        
        res.json({ valid: isValid });
    } catch (error) {
        res.json({ valid: false, message: '验证失败' });
    }
});

// 批量保存书籍元信息（用于油猴脚本）
router.post('/metadata/batch', async (req, res) => {
    try {
        const { books } = req.body;
        
        if (!books || !Array.isArray(books)) {
            return res.status(400).json({ 
                success: false, 
                error: '参数错误：books必须是数组' 
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
                    author: book.author || '',
                    cover: book.cover || '',
                    description: book.description || '',
                    tags: book.tags || '',
                    category: book.tags ? book.tags.split('·')[0] : '',
                    status: book.status || 'unknown',
                    wordCount: book.wordCount || 0,
                    freeChapters: book.freeChapters || 0,
                    paidChapters: book.paidChapters || 0,
                    totalChapters: book.totalChapters || book.chapterCount || 0,
                    subscribedChapters: book.subscribedChapters || book.chapterCount || 0,
                    latestChapterName: book.latestChapterName || '',
                    latestChapterDate: book.latestChapterDate || '',
                    platform: book.platform || 'po18',
                    favoritesCount: book.favoritesCount || 0,
                    commentsCount: book.commentsCount || 0,
                    monthlyPopularity: book.monthlyPopularity || 0,
                    totalPopularity: book.totalPopularity || 0,
                    detailUrl: book.detailUrl || `https://www.po18.tw/books/${book.bookId}/articles`
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
        console.error('批量保存元信息失败:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== 个人WebDAV 配置 ====================

// 获取个人WebDAV配置
// ==================== WebDAV配置 API ====================

// 获取用户WebDAV配置列表
router.get('/webdav/configs', requireLogin, (req, res) => {
    try {
        const configs = WebDAVConfigDB.getAll(req.session.userId);
        res.json(configs.map(c => ({
            id: c.id,
            name: c.name,
            url: c.url,
            username: c.username,
            basePath: c.base_path,
            isDefault: c.is_default === 1,
            isEnabled: c.is_enabled === 1,
            createdAt: c.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: '获取配置失败' });
    }
});

// 添加WebDAV配置
router.post('/webdav/configs', requireLogin, (req, res) => {
    try {
        const { name, url, username, password, basePath, isDefault } = req.body;
        
        if (!name || !url || !username || !password) {
            return res.status(400).json({ error: '请填写完整配置' });
        }
        
        const result = WebDAVConfigDB.add(req.session.userId, {
            name,
            url,
            username,
            password,
            basePath: basePath || '/',
            isDefault: isDefault || false
        });
        
        // 如果设置为默认，更新其他配置
        if (isDefault) {
            WebDAVConfigDB.setDefault(req.session.userId, result.lastInsertRowid);
        }
        
        res.json({ success: true, message: '配置已添加', id: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: '添加配置失败: ' + error.message });
    }
});

// 更新WebDAV配置
router.put('/webdav/configs/:id', requireLogin, (req, res) => {
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
        
        res.json({ success: true, message: '配置已更新' });
    } catch (error) {
        res.status(500).json({ error: '更新配置失败' });
    }
});

// 设置默认WebDAV
router.post('/webdav/configs/:id/set-default', requireLogin, (req, res) => {
    try {
        const { id } = req.params;
        WebDAVConfigDB.setDefault(req.session.userId, parseInt(id));
        res.json({ success: true, message: '已设置为默认' });
    } catch (error) {
        res.status(500).json({ error: '设置失败' });
    }
});

// 切换WebDAV启用状态
router.post('/webdav/configs/:id/toggle', requireLogin, (req, res) => {
    try {
        const { id } = req.params;
        WebDAVConfigDB.toggleEnabled(parseInt(id));
        res.json({ success: true, message: '状态已更新' });
    } catch (error) {
        res.status(500).json({ error: '更新失败' });
    }
});

// 删除WebDAV配置
router.delete('/webdav/configs/:id', requireLogin, (req, res) => {
    try {
        const { id } = req.params;
        WebDAVConfigDB.delete(parseInt(id));
        res.json({ success: true, message: '配置已删除' });
    } catch (error) {
        res.status(500).json({ error: '删除失败' });
    }
});

// 测试WebDAV连接
router.post('/webdav/test', requireLogin, async (req, res) => {
    try {
        const { url, username, password } = req.body;
        
        if (!url || !username || !password) {
            return res.status(400).json({ error: '请填写完整配置' });
        }
        
        const client = new WebDAVClient({ url, username, password });
        const result = await client.testConnection();
        
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: '连接失败: ' + error.message });
    }
});

// ==================== 搜索 API ====================

// 搜索小说
// 搜索书籍（从元信息数据库搜索，关联共享书库）
router.get('/search', requireLogin, async (req, res) => {
    try {
        const { keyword } = req.query;
        
        if (!keyword) {
            return res.status(400).json({ error: '请输入搜索关键词' });
        }
        
        // 从元信息数据库搜索，限制前20条
        const metaResults = BookMetadataDB.search(keyword).slice(0, 20);
        
        if (metaResults.length === 0) {
            return res.json({ books: [], message: '未找到相关书籍' });
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
            const sharedFiles = sharedBooks.filter(s => 
                s.book_id === meta.book_id && s.chapter_count === meta.subscribed_chapters
            );
            
            bookMap.get(key).versions.push({
                totalChapters: meta.total_chapters,
                subscribedChapters: meta.subscribed_chapters,
                wordCount: meta.word_count,
                sharedFiles: sharedFiles.map(s => ({
                    id: s.id,
                    format: s.format,
                    downloadCount: s.download_count,
                    webdavPath: s.webdav_path
                }))
            });
        }
        
        res.json({ books: Array.from(bookMap.values()) });
    } catch (error) {
        console.error('搜索失败:', error);
        res.status(500).json({ error: '搜索失败' });
    }
});

// 根据ID或链接获取书籍信息（必须在 /book/:bookId 之前，避免路由冲突）
router.get('/book/parse', requireLogin, async (req, res) => {
    console.log('===== PARSE API 被调用 =====');
    try {
        const { input } = req.query;
        console.log('解析书籍请求:', input);
        
        const bookId = parseBookIdOrUrl(input);
        console.log('解析得到bookId:', bookId);
        if (!bookId) {
            return res.status(400).json({ error: '无效的书籍ID或链接' });
        }
        
        console.log('解析得到bookId:', bookId);
        
        // 先从数据库缓存获取（使用get获取单个记录）
        try {
            const cached = BookMetadataDB.get(bookId);
            if (cached) {
                console.log('从缓存获取书籍信息:', cached.title);
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
                    detailUrl: cached.detail_url,
                    fromCache: true
                });
            }
        } catch (cacheErr) {
            console.error('查询缓存失败:', cacheErr.message);
        }
                         
        // 获取当前用户的Cookie（必须有）
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: '请先设置PO18 Cookie才能解析书籍' });
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
        if (detail.title && !detail.title.startsWith('书籍 ') && !detail.error) {
            try {
                BookMetadataDB.upsert({
                    bookId: bookId,
                    title: detail.title,
                    author: detail.author || '',
                    cover: detail.cover || '',
                    description: detail.description || '',
                    tags: detail.tags || '',
                    category: detail.tags ? detail.tags.split('·')[0] : '',
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    status: detail.status || 'unknown',
                    latestChapterName: detail.latestChapterName || '',
                    latestChapterDate: detail.latestChapterDate || '',
                    platform: detail.platform || 'po18',
                    favoritesCount: detail.favoritesCount || 0,
                    commentsCount: detail.commentsCount || 0,
                    monthlyPopularity: detail.monthlyPopularity || 0,
                    totalPopularity: detail.totalPopularity || 0,
                    detailUrl: detail.detailUrl || ''
                });
                console.log('书籍信息已缓存:', detail.title);
            } catch (cacheErr) {
                console.error('缓存书籍信息失败:', cacheErr.message);
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
            category: detail.tags ? detail.tags.split('·')[0] : '',
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
        console.error('解析书籍失败:', error);
        res.status(500).json({ error: '解析书籍失败: ' + error.message });
    }
});

// 获取小说详情
router.get('/book/:bookId', async (req, res) => {
    try {
        const { bookId } = req.params;
        
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
        console.error('获取详情失败:', error);
        res.status(500).json({ error: '获取详情失败' });
    }
});

// ==================== 已购书籍 API ====================

// 获取已购书籍列表
router.get('/purchased', requireLogin, async (req, res) => {
    try {
        const { refresh } = req.query;
        const user = UserDB.findById(req.session.userId);
        
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: '请先设置PO18 Cookie' });
        }
        
        // 如果不需要刷新，先从缓存获取
        if (!refresh) {
            let cached = PurchasedDB.getByUser(req.session.userId);
            if (cached.length > 0) {
                // 从元信息数据库补充cover等详细信息
                cached = cached.map(book => {
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
        books = books.map(book => {
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
        console.error('获取已购书籍失败:', error);
        res.status(500).json({ error: '获取已购书籍失败' });
    }
});

// ==================== 下载队列 API ====================

// 获取下载队列
router.get('/queue', requireLogin, (req, res) => {
    const queue = QueueDB.getByUser(req.session.userId);
    res.json(queue);
});

// 获取下载队列结果（完整数据）
router.get('/queue/:id/result', requireLogin, (req, res) => {
    console.log(`获取下载结果请求: queueId=${req.params.id}, userId=${req.session.userId}`);
    try {
        const queueId = parseInt(req.params.id);
        const queueItem = QueueDB.findById(queueId);
        
        console.log('队列项:', queueItem);
        
        if (!queueItem || queueItem.user_id !== req.session.userId) {
            console.log('队列不存在或权限不足');
            return res.status(404).json({ error: '队列不存在' });
        }
        
        if (queueItem.status !== 'completed') {
            console.log(`下载未完成: status=${queueItem.status}`);
            return res.status(400).json({ error: '下载未完成' });
        }
        
        // 从数据库获取书籍详情
        const detail = BookMetadataDB.get(queueItem.book_id);
        if (!detail) {
            console.log(`书籍详情不存在: bookId=${queueItem.book_id}`);
            return res.status(404).json({ error: '书籍详情不存在' });
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
        const sanitizedTitle = detail.title.replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `${sanitizedTitle}.${queueItem.format}`;
        
        const responseData = {
            fileName,
            chapterCount: cachedChapters.length,
            detail: {
                title: detail.title,
                author: detail.author,
                cover: detail.cover,
                description: detail.description,
                tags: detail.tags ? detail.tags.split(',') : [],
                bookId: queueItem.book_id
            },
            chapters: cachedChapters.map((c, i) => ({
                index: i,
                title: c.title || `第${i + 1}章`,
                html: c.html || '',
                text: c.text || '',
                error: false
            }))
        };
        
        console.log(`返回数据: fileName=${fileName}, chapters=${responseData.chapters.length}`);
        res.json(responseData);
    } catch (error) {
        console.error('获取下载结果失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 添加到下载队列
router.post('/queue', requireLogin, async (req, res) => {
    try {
        const { bookId, format = 'txt', autoShare = false } = req.body;
         console.error('保存元信息失败:', req.body);
        if (!bookId) {
            return res.status(400).json({ error: '书籍ID不能为空' });
        }
        
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: '请先设置PO18 Cookie' });
        }
        
        // 获取书籍信息
        const crawler = new NovelCrawler(user.po18_cookie);
        const detail = await crawler.getDetail(bookId);
        
        // 保存元信息到数据库
        if (detail.title && !detail.title.startsWith('书籍 ')) {
            try {
                BookMetadataDB.upsert({
                    bookId: bookId,
                    title: detail.title,
                    author: detail.author || '',
                    cover: detail.cover || '',
                    description: detail.description || '',
                    tags: detail.tags || '',
                    category: detail.tags ? detail.tags.split('·')[0] : '',
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    status: detail.status || 'unknown',
                    detailUrl: detail.detailUrl || ''
                });
            } catch (e) {
                console.error('保存元信息失败:', e.message);
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
        console.error('添加到队列失败:', error);
        res.status(500).json({ error: '添加到队列失败' });
    }
});

// 清空已完成的队列（必须在 /queue/:id 之前）
router.delete('/queue/completed', requireLogin, (req, res) => {
    QueueDB.clearCompleted(req.session.userId);
    res.json({ success: true });
});

// 从队列中删除
router.delete('/queue/:id', requireLogin, (req, res) => {
    const { id } = req.params;
    QueueDB.delete(req.session.userId, parseInt(id));
    res.json({ success: true });
});

// ==================== 下载 API ====================

// 下载进度SSE连接管理
const downloadProgressClients = new Map();

// SSE: 订阅下载进度
// SSE: 订阅下载进度 (不需要登录验证，因为EventSource不支持credentials)
router.get('/download/progress/:queueId', (req, res) => {
    const { queueId } = req.params;
    console.log('SSE连接请求, queueId:', queueId);
    
    // 通过queueId获取队列项来验证
    const queueItem = QueueDB.getById(parseInt(queueId));
    
    if (!queueItem) {
        // 队列项不存在，返回SSE错误消息后关闭
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.flushHeaders();
        res.write(`data: ${JSON.stringify({ type: 'error', error: '队列项不存在' })}\n\n`);
        res.end();
        return;
    }
    
    const userId = queueItem.user_id;
    
    // 设置SSE头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();
    
    // 发送初始连接消息
    res.write(`data: ${JSON.stringify({ type: 'connected', queueId })}

`);
    
    // 保存连接
    const clientKey = `${userId}_${queueId}`;
    downloadProgressClients.set(clientKey, res);
    
    // 客户端断开时清理
    req.on('close', () => {
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
router.post('/download/start', requireLogin, async (req, res) => {
    try {
        const { queueId } = req.body;
        
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: '请先设置PO18 Cookie' });
        }
        
        // 获取队列项
        const queue = QueueDB.getByUser(req.session.userId);
        const queueItem = queue.find(q => q.id === queueId);
        
        if (!queueItem) {
            return res.status(404).json({ error: '队列项不存在' });
        }
        
        // 更新状态为下载中
        QueueDB.updateStatus(queueId, 'downloading');
        
        // 开始下载
        const crawler = new NovelCrawler(user.po18_cookie);
        const detail = await crawler.getDetail(queueItem.book_id);
        
        // 检查详情是否有效
        if (detail.error) {
            console.error('获取书籍详情失败:', detail.error);
            throw new Error('获取书籍详情失败: ' + detail.error);
        }
        
        // 获取章节列表
        const chapters = await crawler.getChapterList(queueItem.book_id, detail.pageNum);
        
        // 检查是否有可下载的章节
        if (!chapters || chapters.length === 0) {
            throw new Error('没有可下载的章节，可能需要在PO18网站购买后再下载');
        }
        
        QueueDB.updateStatus(queueId, 'downloading', { totalChapters: chapters.length });
        
        // 发送开始下载的SSE消息
        sendProgressUpdate(req.session.userId, queueId, {
            type: 'start',
            title: detail.title,
            totalChapters: chapters.length
        });
        
        // 下载所有章节（优先从数据库缓存读取）
        const contents = await crawler.downloadAllChapters(chapters, config.po18.concurrency, (completed, total) => {
            QueueDB.updateStatus(queueId, 'downloading', { progress: completed, totalChapters: total });
            // 发送进度更新
            sendProgressUpdate(req.session.userId, queueId, {
                type: 'progress',
                completed,
                total,
                percent: Math.round((completed / total) * 100)
            });
        }, ChapterCacheDB);
        
        // 检查下载内容
        if (!contents || contents.length === 0) {
            throw new Error('章节内容下载失败');
        }
        
        // **新增：直接返回章节数据，由前端生成文件**
        const format = queueItem.format || 'txt';
        const fileName = `${detail.title}_${queueItem.book_id}.${format}`;
        
        // 如果启用了WebDAV，服务器端生成并上传
        let webdavPath = null;
        const webdavConfig = WebDAVConfigDB.getDefault(req.session.userId);
        
        if (webdavConfig && webdavConfig.url) {
            // 生成文件并上传到WebDAV
            let fileContent, epubBuffer;
            
            if (format === 'txt') {
                fileContent = ContentFormatter.toTxt(detail, contents);
            } else if (format === 'epub') {
                epubBuffer = await EpubGenerator.generate(detail, contents);
            } else {
                fileContent = ContentFormatter.toHtml(detail, contents);
            }
            
            const tempDir = path.join(config.download.tempDir);
            fs.mkdirSync(tempDir, { recursive: true });
            const uploadFilePath = path.join(tempDir, fileName);
            
            if (format === 'epub') {
                fs.writeFileSync(uploadFilePath, epubBuffer);
            } else {
                fs.writeFileSync(uploadFilePath, fileContent, 'utf-8');
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
                console.log('WebDAV上传成功:', webdavPath);
            }
            
            // 删除临时文件
            try {
                fs.unlinkSync(uploadFilePath);
            } catch (e) {
                console.log('删除临时文件失败:', e.message);
            }
        }
        
        // 更新队列状态
        QueueDB.updateStatus(queueId, 'completed', {
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
            console.error('添加下载历史失败:', historyError.message);
        }
        
        // **发送章节数据，不发送文件内容**
        sendProgressUpdate(req.session.userId, queueId, {
            type: 'completed',
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
                html: c.html || '',
                text: c.text || '',
                error: c.error || false
            }))
        });
        
        res.json({ 
            success: true, 
            fileName,
            chapterCount: chapters.length
        });
    } catch (error) {
        console.error('下载失败:', error);
        
        // 发送失败的SSE消息
        if (req.body.queueId) {
            sendProgressUpdate(req.session.userId, req.body.queueId, {
                type: 'error',
                error: error.message
            });
            QueueDB.updateStatus(req.body.queueId, 'failed', { errorMessage: error.message });
        }
        res.status(500).json({ error: '下载失败: ' + error.message });
    }
});

// 下载文件
router.get('/download/file/:id', requireLogin, async (req, res) => {
    try {
        // URL解码，获取真实路径
        const id = decodeURIComponent(req.params.id);
        console.log('[WebDAV下载] 收到请求 ID:', id);
        
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
                const found = books.find(b => b.id === id || b.path === id);
                
                if (found) {
                    book = found;
                    webdavClient = client;
                    console.log('[WebDAV下载] 找到文件:', book.path);
                    break;
                }
            } catch (error) {
                console.error(`从 WebDAV "${config.name}" 查找书籍失败:`, error.message);
            }
        }
        
        if (!book) {
            console.error('[WebDAV下载] 未找到文件:', id);
            return res.status(404).json({ error: '文件不存在' });
        }
        
        // 从 WebDAV 下载文件
        console.log('[WebDAV下载] 开始下载:', book.path);
        const fileBuffer = await webdavClient.downloadFile(book.path);
        
        console.log('[WebDAV下载] 下载完成，类型:', typeof fileBuffer, '大小:', fileBuffer?.length);
        
        if (!fileBuffer) {
            return res.status(500).json({ error: '文件下载失败：无数据' });
        }
        
        const fileName = `${book.title}.${book.format}`;
        
        // 设置响应头
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        res.setHeader('Content-Length', fileBuffer.length);
        
        // 发送文件内容
        res.send(fileBuffer);
        console.log('[WebDAV下载] 发送完成');
    } catch (error) {
        console.error('[WebDAV下载] 错误:', error);
        res.status(500).json({ error: '下载文件失败: ' + error.message });
    }
});

// ==================== 书库 API ====================

// 获取书库中的所有标签和作者 - 必须在 /library/:id 之前
router.get('/library/filters', requireLogin, (req, res) => {
    const books = LibraryDB.getByUser(req.session.userId);
    
    const tags = new Set();
    const authors = new Set();
    const formats = new Set();
    
    books.forEach(book => {
        if (book.tags) {
            book.tags.split('·').forEach(t => t.trim() && tags.add(t.trim()));
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
router.get('/library/categories', (req, res) => {
    const categories = [
        '高H', '1V1', 'HNP', 'HN', 'PSM', 'BG', 'BL', '同人', '同性愛', 'futa',
        '古代', '現代', '校園', 'H校園', '都會', '奇幻', '仙俠', '末世', '玄幻', '科幻', '未來世界',
        '年上', '年下', '羅曼史', '網遊', '人獸', '娛樂圈', '狗血', '系統', '女尊', '強強',
        '肉文', '爽文', '虐心', '悲劇', '暗黑', '甜文', '喜劇', '萌文', '輕鬆', '清水',
        '快穿', '穿越', '重生', '星際', '冒險', '金手指', '女性向', '男性向', '輕小說',
        '耕美', '百合', '不限', '療癒', '青梅竹馬', '心情抒發', '靈異神怪', '二創', '異國', '骨科'
    ];
    res.json(categories);
});

// 获取我的书库（只使用WebDAV）
router.get('/library', requireLogin, async (req, res) => {
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
                const booksWithSource = books.map(book => ({
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
        allBooks = allBooks.map(book => {
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
            allBooks = allBooks.filter(book => book.tags && book.tags.includes(tag));
        }
        
        // 分类筛选
        if (category) {
            allBooks = allBooks.filter(book => book.tags && book.tags.includes(category));
        }
        
        // 作者筛选
        if (author) {
            allBooks = allBooks.filter(book => book.author && book.author.includes(author));
        }
        
        // 格式筛选
        if (format) {
            allBooks = allBooks.filter(book => book.format === format);
        }
        
        res.json(allBooks.map(book => ({
            ...book,
            fileSize: formatFileSize(book.size || book.file_size)
        })));
    } catch (error) {
        console.error('获取书库失败:', error.message);
        res.status(500).json({ error: '获取书库失败: ' + error.message });
    }
});

// 从书库删除
router.delete('/library/:id', requireLogin, (req, res) => {
    try {
        const { id } = req.params;
        const books = LibraryDB.getByUser(req.session.userId);
        const book = books.find(b => b.id === parseInt(id));
        
        if (book && book.file_path && fs.existsSync(book.file_path)) {
            fs.unlinkSync(book.file_path);
        }
        
        LibraryDB.delete(req.session.userId, parseInt(id));
        res.json({ success: true });
    } catch (error) {
        console.error('删除失败:', error);
        res.status(500).json({ error: '删除失败' });
    }
});

// 匹配书籍（从元信息重新生成文件）
router.post('/library/match', requireLogin, async (req, res) => {
    try {
        const { libraryId, bookId } = req.body;
        
        if (!libraryId || !bookId) {
            return res.status(400).json({ error: '缺少参数' });
        }
        
        // 获取用户WebDAV配置
        const user = UserDB.findById(req.session.userId);
        const webdavConfig = user?.webdav_config ? JSON.parse(user.webdav_config) : null;
        
        if (!webdavConfig || !webdavConfig.url) {
            return res.status(400).json({ error: '未配置WebDAV' });
        }
        
        // 从WebDAV获取书库列表
        const client = new WebDAVClient(webdavConfig);
        const books = await client.getLibraryBooks();
        const book = books.find(b => b.id === libraryId);
        
        if (!book) {
            return res.status(404).json({ error: '书籍不存在' });
        }
        
        // 从元信息数据库获取书籍信息
        const meta = BookMetadataDB.get(bookId);
        if (!meta) {
            return res.status(404).json({ error: '未找到书籍元信息' });
        }
        
        // 下载原文件到临时目录
        const tempDir = path.join(__dirname, '../temp');
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
            throw new Error('上传失败');
        }
        
        // 删除WebDAV中的旧文件
        await client.deleteFile(book.path);
        
        // 删除临时文件
        fs.unlinkSync(newFilePath);
        
        res.json({ 
            success: true, 
            message: '匹配成功',
            newFilename: newFilename
        });
    } catch (error) {
        console.error('匹配失败:', error);
        res.status(500).json({ error: '匹配失败: ' + error.message });
    }
});

// ==================== 共享书库 API ====================

// WebDAV辅助函数 - 获取文件列表
async function getWebDAVFileList() {
    try {
        const { url, username, password, basePath } = config.sharedWebDAV;
        const fullUrl = url.replace(/\/$/, '') + basePath;
        
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        
        const response = await axios({
            method: 'PROPFIND',
            url: fullUrl,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Depth': '1',
                'Content-Type': 'application/xml'
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
        
        const responses = result['D:multistatus']?.['D:response'] || 
                          result['d:multistatus']?.['d:response'] || [];
        
        for (const res of responses) {
            const href = res['D:href']?.[0] || res['d:href']?.[0] || '';
            const propstat = res['D:propstat']?.[0] || res['d:propstat']?.[0] || {};
            const prop = propstat['D:prop']?.[0] || propstat['d:prop']?.[0] || {};
            
            const isCollection = prop['D:resourcetype']?.[0]?.['D:collection'] || 
                                 prop['d:resourcetype']?.[0]?.['d:collection'];
            
            if (!isCollection && href !== basePath) {
                const name = decodeURIComponent(href.split('/').pop());
                const size = parseInt(prop['D:getcontentlength']?.[0] || prop['d:getcontentlength']?.[0] || '0');
                const lastModified = prop['D:getlastmodified']?.[0] || prop['d:getlastmodified']?.[0] || '';
                
                if (name && (name.endsWith('.txt') || name.endsWith('.html') || name.endsWith('.epub'))) {
                    files.push({
                        name,
                        path: href,
                        size,
                        lastModified,
                        format: name.split('.').pop()
                    });
                }
            }
        }
        
        return files;
    } catch (error) {
        console.error('WebDAV获取文件列表失败:', error.message);
        return [];
    }
}

// WebDAV辅助函数 - 下载文件
async function downloadFromWebDAV(filePath) {
    try {
        const { url, username, password } = config.sharedWebDAV;
        const fullUrl = url.replace(/\/$/, '') + filePath;
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        
        console.log('WebDAV下载:', fullUrl);
        
        const response = await axios({
            method: 'GET',
            url: fullUrl,
            headers: {
                'Authorization': `Basic ${auth}`
            },
            responseType: 'arraybuffer',
            timeout: 20000
        });
        
        // 确保返回的是Buffer
        if (response.data) {
            const data = response.data;
            // 如果是ArrayBuffer，转换为Buffer
            if (data instanceof ArrayBuffer) {
                const buffer = Buffer.from(data);
                console.log('WebDAV下载成功 (ArrayBuffer), 大小:', buffer.length);
                return buffer;
            }
            // 如果已经是Buffer
            if (Buffer.isBuffer(data)) {
                console.log('WebDAV下载成功 (Buffer), 大小:', data.length);
                return data;
            }
            // 其他情况尝试转换
            console.log('WebDAV数据类型:', typeof data, data.constructor?.name);
            const buffer = Buffer.from(data);
            console.log('WebDAV下载成功 (转换), 大小:', buffer.length);
            return buffer;
        } else {
            console.error('WebDAV返回空数据');
            return null;
        }
    } catch (error) {
        console.error('WebDAV下载失败:', error.message);
        throw error;
    }
}

// 启用共享功能
router.post('/share/enable', requireLogin, (req, res) => {
    UserDB.enableSharing(req.session.userId);
    res.json({ success: true, message: '共享功能已启用' });
});

// 禁用共享功能
router.post('/share/disable', requireLogin, (req, res) => {
    UserDB.disableSharing(req.session.userId);
    res.json({ success: true, message: '共享功能已禁用' });
});

// WebDAV上传函数
async function uploadToWebDAV(filePath, remotePath) {
    try {
        const { url, username, password } = config.sharedWebDAV;
        const fullUrl = url.replace(/\/$/, '') + remotePath;
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        
        const fileContent = fs.readFileSync(filePath);
        console.log('WebDAV上传:', fullUrl, ', 大小:', fileContent.length);
        
        await axios({
            method: 'PUT',
            url: fullUrl,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/octet-stream'
            },
            data: fileContent,
            timeout: 60000
        });
        
        console.log('WebDAV上传成功:', remotePath);
        return true;
    } catch (error) {
        console.error('WebDAV上传失败:', error.message);
        throw error;
    }
}

// 上传到共享书库
router.post('/share/upload', requireLogin, async (req, res) => {
    try {
        const { libraryId } = req.body;
        const user = UserDB.findById(req.session.userId);
        
        if (!user.share_enabled) {
            return res.status(400).json({ error: '请先启用共享功能' });
        }
        
        // 获取用户默认WebDAV配置
        const webdavConfig = WebDAVConfigDB.getDefault(req.session.userId);
        
        if (!webdavConfig) {
            return res.status(400).json({ error: '未配置WebDAV' });
        }
        
        // 从WebDAV获取书库列表
        const client = new WebDAVClient({
            url: webdavConfig.url,
            username: webdavConfig.username,
            password: webdavConfig.password,
            path: webdavConfig.base_path
        });
        const books = await client.getLibraryBooks();
        const book = books.find(b => b.id === libraryId);
        
        if (!book) {
            return res.status(404).json({ error: '书籍不存在' });
        }
        
        // 从元信息获取详细信息
        const meta = BookMetadataDB.get(book.bookId);
        const title = meta?.title || book.title;
        const author = meta?.author || book.author || '未知';
        const cover = meta?.cover || book.cover;
        const tags = meta?.tags || book.tags;
        const chapterCount = meta?.subscribed_chapters || book.chapterCount || 0;
        
        // 下载文件到临时目录
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempFilePath = path.join(tempDir, book.filename);
        const fileBuffer = await client.downloadFile(book.path);
        fs.writeFileSync(tempFilePath, fileBuffer);
        
        // 生成共享文件路径（包含书名和章节数以区分版本）
        // 格式: {bookId}_{title}_{chapterCount}ch.{format}
        const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
        const fileName = `${book.bookId}_${safeTitle}_${chapterCount}ch.${book.format}`;
        
        // 确保共享目录存在
        const sharedDir = path.join(__dirname, '..', config.sharedLibrary.path);
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
            return res.status(500).json({ error: '文件复制失败: ' + copyError.message });
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
            console.error('保存元信息失败:', e.message);
        }
        
        // 增加用户共享计数
        UserDB.incrementSharedBooks(req.session.userId);
        
        res.json({ success: true, message: '上传成功' });
    } catch (error) {
        console.error('上传失败:', error);
        res.status(500).json({ error: '上传失败' });
    }
});

// 获取共享书库列表
router.get('/share/library', requireLogin, async (req, res) => {
    // 检查用户是否有权限访问共享书库
    if (!UserDB.canAccessSharedLibrary(req.session.userId)) {
        return res.status(403).json({ 
            error: '需要启用共享并上传至少3本书才能访问共享书库',
            required: config.sharedLibrary.minBooksRequired
        });
    }
    
    try {
        // 从数据库获取共享书籍列表
        const dbBooks = SharedDB.getAll();
        
        // 从元信息数据库补充详细信息
        const books = dbBooks.map(book => {
            const meta = BookMetadataDB.get(book.book_id);
            if (meta) {
                return {
                    ...book,
                    title: meta.title || book.title,
                    author: meta.author || book.author,
                    cover: meta.cover || book.cover,
                    tags: meta.tags || book.tags,
                    uploaderName: book.uploader_name || '未知',
                    downloadCount: book.download_count || 0,
                    fileSize: formatFileSize(book.file_size || 0),
                    fileExists: book.file_path && fs.existsSync(book.file_path)
                };
            }
            return {
                ...book,
                uploaderName: book.uploader_name || '未知',
                downloadCount: book.download_count || 0,
                fileSize: formatFileSize(book.file_size || 0),
                fileExists: book.file_path && fs.existsSync(book.file_path)
            };
        });
        
        res.json(books);
    } catch (error) {
        console.error('获取共享书库失败:', error);
        res.status(500).json({ error: '获取共享书库失败' });
    }
});

// 搜索共享书库
router.get('/share/search', requireLogin, (req, res) => {
    if (!UserDB.canAccessSharedLibrary(req.session.userId)) {
        return res.status(403).json({ error: '无权访问共享书库' });
    }
    
    const { keyword } = req.query;
    let books = keyword ? SharedDB.search(keyword) : SharedDB.getAll();
    
    // 从元信息数据库补充详细信息
    books = books.map(book => {
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
router.get('/share/download/:id', requireLogin, async (req, res) => {
    try {
        if (!UserDB.canAccessSharedLibrary(req.session.userId)) {
            return res.status(403).json({ error: '无权访问共享书库' });
        }
        
        const { id } = req.params;
        console.log('下载共享书籍, ID:', id);
        
        const book = SharedDB.getById(parseInt(id));
        
        if (!book) {
            return res.status(404).json({ error: '书籍不存在' });
        }
        
        // 先更新下载次数
        try {
            SharedDB.incrementDownload(parseInt(id));
            console.log('下载次数已更新, ID:', id);
        } catch (e) {
            console.error('更新下载次数失败:', e.message);
        }
        
        const fileName = `${book.title}.${book.format}`;
        
        // 从共享目录读取文件
        if (book.file_path && fs.existsSync(book.file_path)) {
            console.log('从共享目录下载:', book.file_path);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
            return res.sendFile(path.resolve(book.file_path));
        } else {
            // 文件不存在，删除共享记录
            console.log('文件不存在，删除共享记录:', book.title);
            SharedDB.delete(parseInt(id));
            res.status(404).json({ error: '文件不存在，已从共享库中移除' });
        }
    } catch (error) {
        console.error('下载失败:', error);
        res.status(500).json({ error: '下载失败' });
    }
});

// ==================== 书籍ID/链接下载 API ====================

// 解析书籍ID或链接
function parseBookIdOrUrl(input) {
    console.log('!!! parseBookIdOrUrl 被调用 !!! 输入:', JSON.stringify(input));
    
    if (!input) return null;
    
    input = input.toString().trim();
    
    // 如果是纯ID（数字）
    if (/^\d+$/.test(input)) {
        console.log('匹配纯数字ID:', input);
        return input;
    }
    
    // 如果是链接，尝试提取ID
    const match = input.match(/\/books\/(\d+)/);
    if (match) {
        console.log('匹配链接格式:', match[1]);
        return match[1];
    }
    
    // 尝试其他链接格式
    const altMatch = input.match(/book(?:Id)?[=\/](\d+)/i);
    if (altMatch) {
        console.log('匹配替代格式:', altMatch[1]);
        return altMatch[1];
    }
    
    return null;
}

// 根据ID或链接直接添加到下载队列
router.post('/book/quick-download', requireLogin, async (req, res) => {
    try {
        const { input, format = 'txt' } = req.body;
        
        const bookId = parseBookIdOrUrl(input);
        if (!bookId) {
            return res.status(400).json({ error: '无效的书籍ID或链接' });
        }
        
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: '请先设置PO18 Cookie' });
        }
        
        // 获取书籍信息
        const crawler = new NovelCrawler(user.po18_cookie);
        const detail = await crawler.getDetail(bookId);
        
        // 检查是否解析成功
        if (detail.error) {
            throw new Error(`获取书籍详情失败: ${detail.error}`);
        }
        
        // 保存元信息到数据库
        if (detail.title && !detail.title.startsWith('书籍 ')) {
            try {
                BookMetadataDB.upsert({
                    bookId: bookId,
                    title: detail.title,
                    author: detail.author || '',
                    cover: detail.cover || '',
                    description: detail.description || '',
                    tags: detail.tags || '',
                    category: detail.tags ? detail.tags.split('·')[0] : '',
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    status: detail.status || 'unknown',
                    detailUrl: detail.detailUrl || ''
                });
            } catch (e) {
                console.error('保存元信息失败:', e.message);
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
        console.error('添加到队列失败:', error);
        res.status(500).json({ error: '添加到队列失败: ' + error.message });
    }
});

// ==================== 下载历史 API ====================

// 获取下载历史（从队列表查询已完成的）
router.get('/history', requireLogin, (req, res) => {
    const queue = QueueDB.getByUser(req.session.userId);
    // 只返回已完成的记录
    const history = queue.filter(item => item.status === 'completed');
    res.json(history);
});

// 清空下载历史（删除已完成的记录）
router.delete('/history', requireLogin, (req, res) => {
    QueueDB.clearCompleted(req.session.userId);
    res.json({ success: true });
});

// ==================== 辅助函数 ====================

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==================== 后台管理 API ====================

// 管理员权限中间件
const requireAdmin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: '请先登录' });
    }
    const user = UserDB.findById(req.session.userId);
    if (!user || !config.sharing.privilegedUsers.includes(user.username)) {
        return res.status(403).json({ error: '无管理员权限' });
    }
    next();
};

// 检查管理员权限
router.get('/admin/check', requireLogin, (req, res) => {
    const user = UserDB.findById(req.session.userId);
    const isAdmin = config.sharing.privilegedUsers.includes(user.username);
    res.json({ isAdmin, user: { id: user.id, username: user.username } });
});

// 统计数据
router.get('/admin/stats', requireAdmin, (req, res) => {
    try {
        const db = require('better-sqlite3')('./data/po18.db');
        
        const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const booksCount = db.prepare('SELECT COUNT(*) as count FROM book_metadata').get().count;
        const sharedCount = db.prepare('SELECT COUNT(*) as count FROM shared_library').get().count;
        const downloadsCount = db.prepare('SELECT SUM(download_count) as total FROM shared_library').get().total || 0;
        
        // 统计总章节数（所有书籍的total_chapters之和）
        const totalChaptersResult = db.prepare('SELECT SUM(total_chapters) as total FROM book_metadata').get();
        const totalChapters = totalChaptersResult.total || 0;
        
        // 统计已缓存章节数
        const cachedChaptersCount = db.prepare('SELECT COUNT(*) as count FROM chapter_cache').get().count;
        
        res.json({
            users: usersCount,
            books: booksCount,
            shared: sharedCount,
            downloads: downloadsCount,
            totalChapters: totalChapters,
            cachedChapters: cachedChaptersCount
        });
    } catch (error) {
        console.error('获取统计失败:', error);
        res.status(500).json({ error: '获取统计失败' });
    }
});

// ========== 用户管理 ==========

// 获取用户列表
router.get('/admin/users', requireAdmin, (req, res) => {
    try {
        const { page = 1, pageSize = 20, keyword = '' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);
        
        const db = require('better-sqlite3')('./data/po18.db');
        
        let countSql = 'SELECT COUNT(*) as total FROM users';
        let querySql = 'SELECT * FROM users';
        const params = [];
        
        if (keyword) {
            const where = ' WHERE username LIKE ?';
            countSql += where;
            querySql += where;
            params.push(`%${keyword}%`);
        }
        
        querySql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        
        const total = db.prepare(countSql).get(...params).total;
        const users = db.prepare(querySql).all(...params, parseInt(pageSize), offset);
        
        // 移除密码字段
        users.forEach(u => delete u.password);
        
        res.json({ users, total });
    } catch (error) {
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

// 获取单个用户
router.get('/admin/users/:id', requireAdmin, (req, res) => {
    try {
        const user = UserDB.findById(parseInt(req.params.id));
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }
        delete user.password;
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: '获取用户失败' });
    }
});

// 更新用户
router.put('/admin/users/:id', requireAdmin, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { password, po18_cookie, share_enabled, cache_auth } = req.body;
        
        const db = require('better-sqlite3')('./data/po18.db');
        
        if (password) {
            db.prepare('UPDATE users SET password = ? WHERE id = ?').run(password, id);
        }
        if (po18_cookie !== undefined) {
            db.prepare('UPDATE users SET po18_cookie = ? WHERE id = ?').run(po18_cookie, id);
        }
        if (share_enabled !== undefined) {
            db.prepare('UPDATE users SET share_enabled = ? WHERE id = ?').run(share_enabled, id);
        }
        if (cache_auth !== undefined) {
            db.prepare('UPDATE users SET cache_auth = ? WHERE id = ?').run(cache_auth, id);
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '更新用户失败' });
    }
});

// 删除用户
router.delete('/admin/users/:id', requireAdmin, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const db = require('better-sqlite3')('./data/po18.db');
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '删除用户失败' });
    }
});

// ========== 书籍元信息管理 ==========

// 获取书籍列表
router.get('/admin/books', requireAdmin, (req, res) => {
    try {
        const { page = 1, pageSize = 20, keyword = '' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);
        
        const db = require('better-sqlite3')('./data/po18.db');
        
        let countSql = 'SELECT COUNT(*) as total FROM book_metadata';
        let querySql = 'SELECT * FROM book_metadata';
        const params = [];
        
        if (keyword) {
            const where = ' WHERE title LIKE ? OR author LIKE ?';
            countSql += where;
            querySql += where;
            params.push(`%${keyword}%`, `%${keyword}%`);
        }
        
        querySql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        
        const total = db.prepare(countSql).get(...params).total;
        const books = db.prepare(querySql).all(...params, parseInt(pageSize), offset);
        
        res.json({ books, total });
    } catch (error) {
        res.status(500).json({ error: '获取书籍列表失败' });
    }
});

// 获取单本书籍
router.get('/admin/books/:bookId', requireAdmin, (req, res) => {
    try {
        const book = BookMetadataDB.get(req.params.bookId);
        if (!book) {
            return res.status(404).json({ error: '书籍不存在' });
        }
        res.json(book);
    } catch (error) {
        res.status(500).json({ error: '获取书籍失败' });
    }
});

// 更新书籍
router.put('/admin/books/:bookId', requireAdmin, (req, res) => {
    try {
        const bookId = req.params.bookId;
        const { 
            title, author, tags, word_count, total_chapters, 
            free_chapters, paid_chapters, status, 
            latest_chapter_name, latest_chapter_date, platform,
            description, cover 
        } = req.body;
        
        const db = require('better-sqlite3')('./data/po18.db');
        db.prepare(`
            UPDATE book_metadata SET 
                title = ?, author = ?, tags = ?, word_count = ?, 
                total_chapters = ?, free_chapters = ?, paid_chapters = ?,
                status = ?, latest_chapter_name = ?, latest_chapter_date = ?, 
                platform = ?, description = ?, cover = ?, 
                updated_at = CURRENT_TIMESTAMP
            WHERE book_id = ?
        `).run(
            title, author, tags, word_count, 
            total_chapters, free_chapters, paid_chapters,
            status, latest_chapter_name, latest_chapter_date, 
            platform, description, cover, bookId
        );
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '更新书籍失败' });
    }
});

// 删除书籍元信息
router.delete('/admin/books/:bookId', requireAdmin, (req, res) => {
    try {
        const db = require('better-sqlite3')('./data/po18.db');
        db.prepare('DELETE FROM book_metadata WHERE book_id = ?').run(req.params.bookId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '删除书籍失败' });
    }
});

// ========== 排行榜 ==========

// 获取排行榜
router.get('/rankings/:type', (req, res) => {
    try {
        const { type } = req.params;
        const { limit = 100 } = req.query;
        
        const validTypes = ['favorites', 'comments', 'monthly', 'total', 'wordcount', 'latest'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ error: '无效的排行榜类型' });
        }
        
        const rankings = BookMetadataDB.getRankings(type, parseInt(limit));
        res.json(rankings);
    } catch (error) {
        console.error('获取排行榜失败:', error);
        res.status(500).json({ error: '获取排行榜失败' });
    }
});

// ========== 共享书库管理 ==========

// 获取共享书籍列表
router.get('/admin/shared', requireAdmin, (req, res) => {
    try {
        const { page = 1, pageSize = 20, keyword = '' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);
        
        const db = require('better-sqlite3')('./data/po18.db');
        
        let countSql = 'SELECT COUNT(*) as total FROM shared_library';
        let querySql = `
            SELECT s.*, u.username as uploader_name 
            FROM shared_library s 
            LEFT JOIN users u ON s.user_id = u.id
        `;
        const params = [];
        
        if (keyword) {
            const where = ' WHERE s.title LIKE ?';
            countSql += where.replace('s.', '');
            querySql += where;
            params.push(`%${keyword}%`);
        }
        
        querySql += ' ORDER BY s.id DESC LIMIT ? OFFSET ?';
        
        const total = db.prepare(countSql).get(...params).total;
        const books = db.prepare(querySql).all(...params, parseInt(pageSize), offset);
        
        res.json({ books, total });
    } catch (error) {
        res.status(500).json({ error: '获取共享书籍列表失败' });
    }
});

// 删除共享书籍
router.delete('/admin/shared/:id', requireAdmin, (req, res) => {
    try {
        const db = require('better-sqlite3')('./data/po18.db');
        db.prepare('DELETE FROM shared_library WHERE id = ?').run(parseInt(req.params.id));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '删除共享书籍失败' });
    }
});

// ==================== ID遍历爬取 API ====================

// 获取遍历状态
router.get('/admin/crawler/status', requireAdmin, (req, res) => {
    res.json(crawlerState.getStatus());
});

// 启动遍历
router.post('/admin/crawler/start', requireAdmin, async (req, res) => {
    try {
        if (crawlerState.isRunning) {
            return res.status(400).json({ error: '遍历已在运行中' });
        }
        
        const { mode = 'database', startId, endId, delay = 2000, concurrency = 1 } = req.body;
        
        let bookIds = [];
        
        if (mode === 'database') {
            // 数据库模式：从 book_metadata 表获取所有 book_id
            bookIds = BookMetadataDB.getAllBookIds();
            
            if (bookIds.length === 0) {
                return res.status(400).json({ error: '数据库中没有书籍元信息，请先使用油猴脚本收集数据' });
            }
            
            crawlerState.addLog(`从数据库加载 ${bookIds.length} 个书籍ID`);
        } else {
            // 范围模式：使用 startId - endId 范围
            if (!startId || !endId) {
                return res.status(400).json({ error: '请指定开始ID和结束ID' });
            }
            
            const start = parseInt(startId);
            const end = parseInt(endId);
            
            if (isNaN(start) || isNaN(end) || start > end || start < 1) {
                return res.status(400).json({ error: '无效的ID范围' });
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
            return res.status(400).json({ error: '请先在设置中配置PO18 Cookie才能使用遍历功能' });
        }
        
        const modeText = mode === 'database' ? '数据库模式' : 'ID范围模式';
        const concurrencyText = concurrent === 1 ? '单线程模式' : `并发模式 (${concurrent}个线程)`;
        crawlerState.addLog(`开始遍历 [${modeText}], 共 ${bookIds.length} 个书籍, ${concurrencyText}`);
        res.json({ success: true, message: '遍历已启动' });
        
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
        console.error('[遍历启动] 错误:', error);
        crawlerState.isRunning = false;
        res.status(500).json({ error: '启动失败: ' + error.message });
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
            await new Promise(resolve => setTimeout(resolve, delayMs));
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
            await new Promise(resolve => setTimeout(resolve, delayMs / 2));
        }
    }
}

// 处理单本书籍（提取为公共函数）
async function processSingleBook(crawler, id) {
    try {
        const detail = await crawler.getDetail(id.toString());
        
        // 检查是否获取到有效信息（排除“书籍 xxx”和“未知标题”）
        const isValid = detail && 
            detail.title && 
            !detail.title.startsWith('书籍 ') && 
            detail.title !== '未知标题' &&
            detail.author !== '未知作者' &&
            !detail.error;
        
        if (isValid) {
            // 保存到元信息数据库
            try {
                BookMetadataDB.upsert({
                    bookId: id.toString(),
                    title: detail.title,
                    author: detail.author || '',
                    cover: detail.cover || '',
                    description: detail.description || '',
                    tags: detail.tags || '',
                    category: detail.tags ? detail.tags.split('·')[0] : '',
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    status: detail.status || 'unknown',
                    latestChapterName: detail.latestChapterName || '',
                    latestChapterDate: detail.latestChapterDate || '',
                    platform: detail.platform || 'po18',
                    favoritesCount: detail.favoritesCount || 0,
                    commentsCount: detail.commentsCount || 0,
                    monthlyPopularity: detail.monthlyPopularity || 0,
                    totalPopularity: detail.totalPopularity || 0,
                    detailUrl: detail.detailUrl || ''
                });
                
                crawlerState.successCount++;
                crawlerState.addLog(`✓ ID ${id}: ${detail.title} - ${detail.author}`, 'success');
            } catch (dbErr) {
                // 数据库错误仍算成功（可能是重复数据）
                crawlerState.successCount++;
                crawlerState.addLog(`✓ ID ${id}: ${detail.title} (已存在)`, 'success');
            }
        } else {
            crawlerState.failCount++;
            crawlerState.addLog(`✗ ID ${id}: 无效或不存在`, 'warn');
        }
    } catch (err) {
        crawlerState.failCount++;
        crawlerState.addLog(`✗ ID ${id}: ${err.message}`, 'error');
    }
    
    crawlerState.totalProcessed++;
}

// 停止遍历
router.post('/admin/crawler/stop', requireAdmin, (req, res) => {
    if (!crawlerState.isRunning) {
        return res.status(400).json({ error: '遍历未在运行' });
    }
    
    crawlerState.isRunning = false;
    crawlerState.addLog('用户请求停止遍历...');
    res.json({ success: true, message: '正在停止遍历...' });
});

// 清空日志
router.post('/admin/crawler/clear-logs', requireAdmin, (req, res) => {
    crawlerState.logs = [];
    res.json({ success: true });
});

// ==================== 书籍详情页 API ====================

// 获取书籍详情（POST方式）
router.post('/parse/book', requireLogin, async (req, res) => {
    try {
        const { bookId } = req.body;
        
        if (!bookId) {
            return res.status(400).json({ error: '缺少书籍ID' });
        }
        
        // 先从数据库缓存获取（字段统一）
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
                    detailUrl: `https://www.po18.tw/books/${bookId}`,
                    fromCache: true
                });
            }
        } catch (cacheErr) {
            console.error('查询缓存失败:', cacheErr.message);
        }
        
        // 从网站解析
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: '请先设置PO18 Cookie' });
        }
        
        const crawler = new NovelCrawler(user.po18_cookie);
        const detail = await crawler.getDetail(bookId);
        
        if (detail.error) {
            return res.status(500).json({ error: `解析失败: ${detail.error}` });
        }
        
        // 保存到数据库
        if (detail.title && !detail.title.startsWith('书籍 ')) {
            try {
                BookMetadataDB.upsert({
                    bookId: bookId,
                    title: detail.title,
                    author: detail.author || '',
                    cover: detail.cover || '',
                    description: detail.description || '',
                    tags: detail.tags || '',
                    category: detail.tags ? detail.tags.split('·')[0] : '',
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    status: detail.status || 'unknown',
                    latestChapterName: detail.latestChapterName || '',
                    latestChapterDate: detail.latestChapterDate || '',
                    platform: detail.platform || 'po18',
                    favoritesCount: detail.favoritesCount || 0,
                    commentsCount: detail.commentsCount || 0,
                    monthlyPopularity: detail.monthlyPopularity || 0,
                    totalPopularity: detail.totalPopularity || 0,
                    detailUrl: detail.detailUrl || ''
                });
            } catch (err) {
                console.error('保存元信息失败:', err);
            }
        }
        
        res.json({
            bookId: bookId,
            title: detail.title,
            author: detail.author,
            cover: detail.cover,
            description: detail.description,
            tags: detail.tags,
            category: detail.tags ? detail.tags.split('·')[0] : '',
            chapterCount: detail.chapterCount,
            totalChapters: detail.chapterCount,
            subscribedChapters: detail.chapterCount,
            wordCount: detail.wordCount,
            freeChapters: detail.freeChapters,
            paidChapters: detail.paidChapters,
            status: detail.status,
            latestChapterName: detail.latestChapterName,
            latestChapterDate: detail.latestChapterDate,
            platform: detail.platform || 'po18',
            favoritesCount: detail.favoritesCount || 0,
            commentsCount: detail.commentsCount || 0,
            monthlyPopularity: detail.monthlyPopularity || 0,
            totalPopularity: detail.totalPopularity || 0,
            detailUrl: `https://www.po18.tw/books/${bookId}`,
            fromCache: false
        });
    } catch (error) {
        console.error('获取书籍详情失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 获取书籍评论
router.post('/parse/comments', async (req, res) => {
    try {
        const { bookId, page = 1 } = req.body;
        
        if (!bookId) {
            return res.status(400).json({ error: '缺少书籍ID' });
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
        console.error('获取评论失败:', error);
        res.json({ comments: [], totalPages: 0, currentPage: 1 });
    }
});

// 获取章节列表（默认只读缓存，预加载时才访问网站）
router.post('/parse/chapters', async (req, res) => {
    try {
        const { bookId, cacheOnly } = req.body;
        
        if (!bookId) {
            return res.status(400).json({ error: '缺少书籍ID' });
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
            return res.status(401).json({ error: '需要设置PO18 Cookie才能预加载' });
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
                isLocked: (chapter.isPaid && !chapter.isPurchased && !cached) || false,  // 有缓存则不锁定
                hasCached: !!cached
            };
        });
        
        res.json({ chapters: formattedChapters });
    } catch (error) {
        console.error('获取章节列表失败:', error);
        
        // 友好的错误提示
        if (error.message && error.message.includes('无法解析书籍信息')) {
            return res.status(401).json({ error: 'Cookie已过期或无效，请在设置页重新设置PO18 Cookie' });
        }
        
        res.status(500).json({ error: error.message });
    }
});

// 获取章节内容（允许访问缓存，无需登录）
router.post('/parse/chapter-content', async (req, res) => {
    try {
        const { bookId, chapterId } = req.body;
        
        if (!bookId || !chapterId) {
            return res.status(400).json({ error: '缺少参数' });
        }
        
        // 先从缓存获取（跨用户共享，不需要Cookie）
        const cached = ChapterCacheDB.get(bookId, chapterId);
        if (cached) {
            console.log(`从缓存读取章节: ${bookId}/${chapterId}`);
            return res.json({
                html: cached.html || '',
                text: cached.text || '',
                title: cached.title || '',
                fromCache: true
            });
        }
        
        // 缓存不存在，需要Cookie才能从网站解析
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: '该章节未缓存，需要设置PO18 Cookie后才能读取' });
        }
        
        const crawler = new NovelCrawler(user.po18_cookie);
        const content = await crawler.getChapterContent(bookId, chapterId);
        
        if (content.error) {
            return res.status(500).json({ error: content.error });
        }
        
        // 保存到缓存
        try {
            console.log(`准备缓存章节: ${bookId}/${chapterId}, title=${content.title}, html长度=${content.html?.length}, text长度=${content.text?.length}`);
            ChapterCacheDB.save(bookId, chapterId, content.title || '', content.html || '', content.text || '');
            console.log(`✓ 章节已缓存: ${bookId}/${chapterId}`);
        } catch (err) {
            console.error('✗ 保存章节缓存失败:', err);
        }
        
        res.json({
            html: content.html || '',
            text: content.text || '',
            title: content.title || '',
            fromCache: false
        });
    } catch (error) {
        console.error('获取章节内容失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 预加载书籍所有章节
router.post('/parse/preload-chapters', requireLogin, async (req, res) => {
    try {
        const { bookId } = req.body;
        
        if (!bookId) {
            return res.status(400).json({ error: '缺少书籍ID' });
        }
        
        const user = UserDB.findById(req.session.userId);
        if (!user || !user.po18_cookie) {
            return res.status(400).json({ error: '请先设置PO18 Cookie' });
        }
        
        // 检查云端缓存权限
        const hasCacheAuth = UserDB.hasCacheAuth(req.session.userId);
        
        // 异步处理，立即返回
        res.json({ success: true, message: '预加载已开始' });
        
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
                            ChapterCacheDB.save(bookId, chapter.chapterId, content.title || chapter.title, content.html || '', content.text || '');
                            downloaded++;
                            console.log(`预加载进度: ${downloaded + cached}/${chapters.length}`);
                        }
                        
                        // 小延迟避免请求过快
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (err) {
                        console.error(`预加载章节失败: ${chapter.chapterId}`, err.message);
                    }
                }
                
                console.log(`预加载完成: 缓存 ${cached} 个, 新下载 ${downloaded} 个`);
            } catch (error) {
                console.error('预加载失败:', error);
            }
        })();
    } catch (error) {
        console.error('启动预加载失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 获取缓存统计
router.get('/parse/cache-stats/:bookId', requireLogin, async (req, res) => {
    try {
        const { bookId } = req.params;
        const stats = ChapterCacheDB.getStats(bookId);
        res.json(stats);
    } catch (error) {
        console.error('获取缓存统计失败:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
// 处理单本书籍（提取为公共函数）
async function processSingleBook(crawler, id) {
    try {
        const detail = await crawler.getDetail(id.toString());
        
        // 检查是否获取到有效信息（排除“书籍 xxx”和“未知标题”）
        const isValid = detail && 
            detail.title && 
            !detail.title.startsWith('书籍 ') && 
            detail.title !== '未知标题' &&
            detail.author !== '未知作者' &&
            !detail.error;
        
        if (isValid) {
            // 保存到元信息数据库
            try {
                BookMetadataDB.upsert({
                    bookId: id.toString(),
                    title: detail.title,
                    author: detail.author || '',
                    cover: detail.cover || '',
                    description: detail.description || '',
                    tags: detail.tags || '',
                    category: detail.tags ? detail.tags.split('·')[0] : '',
                    wordCount: detail.wordCount || 0,
                    freeChapters: detail.freeChapters || 0,
                    paidChapters: detail.paidChapters || 0,
                    totalChapters: detail.chapterCount || 0,
                    subscribedChapters: detail.chapterCount || 0,
                    status: detail.status || 'unknown',
                    latestChapterName: detail.latestChapterName || '',
                    latestChapterDate: detail.latestChapterDate || '',
                    platform: detail.platform || 'po18',
                    favoritesCount: detail.favoritesCount || 0,
                    commentsCount: detail.commentsCount || 0,
                    monthlyPopularity: detail.monthlyPopularity || 0,
                    totalPopularity: detail.totalPopularity || 0,
                    detailUrl: detail.detailUrl || ''
                });
                
                crawlerState.successCount++;
                crawlerState.addLog(`✓ ID ${id}: ${detail.title} - ${detail.author}`, 'success');
            } catch (dbErr) {
                // 数据库错误仍算成功（可能是重复数据）
                crawlerState.successCount++;
                crawlerState.addLog(`✓ ID ${id}: ${detail.title} (已存在)`, 'success');
            }
        } else {
            crawlerState.failCount++;
            crawlerState.addLog(`✗ ID ${id}: 无效或不存在`, 'warn');
        }
    } catch (err) {
        crawlerState.failCount++;
        crawlerState.addLog(`✗ ID ${id}: ${err.message}`, 'error');
    }
    
    crawlerState.totalProcessed++;
}

// 停止遍历
router.post('/admin/crawler/stop', requireAdmin, (req, res) => {
    if (!crawlerState.isRunning) {
        return res.status(400).json({ error: '遍历未在运行' });
    }
    
    crawlerState.isRunning = false;
    crawlerState.addLog('用户请求停止遍历...');
    res.json({ success: true, message: '正在停止遍历...' });
});

// 清空日志
router.post('/admin/crawler/clear-logs', requireAdmin, (req, res) => {
    crawlerState.logs = [];
    res.json({ success: true });
});
// ==================== 书库EPUB下载功能 ====================

// 检查书库中是否有EPUB文件
router.get('/library/check-epub/:bookId', requireLogin, async (req, res) => {
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
                    basePath: config.base_path || '/'
                });
                
                const books = await client.getLibraryBooks();
                
                // 查找包含bookId的EPUB文件
                const epubBook = books.find(b => 
                    b.bookId === bookId && 
                    b.format === 'epub'
                );
                
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
        console.error('检查EPUB失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 从书库下载EPUB文件
router.get('/library/download-epub/:bookId', requireLogin, async (req, res) => {
    try {
        const { bookId } = req.params;
        const { configId } = req.query;
        
        if (!configId) {
            return res.status(400).json({ error: '缺少WebDAV配置ID' });
        }
        
        // 获取WebDAV配置
        const config = WebDAVConfigDB.findById(parseInt(configId));
        if (!config || config.user_id !== req.session.userId) {
            return res.status(404).json({ error: 'WebDAV配置不存在' });
        }
        
        const client = new WebDAVClient({
            url: config.url,
            username: config.username,
            password: config.password,
            basePath: config.base_path || '/'
        });
        
        const books = await client.getLibraryBooks();
        const epubBook = books.find(b => 
            b.bookId === bookId && 
            b.format === 'epub'
        );
        
        if (!epubBook) {
            return res.status(404).json({ error: 'EPUB文件不存在' });
        }
        
        // 下载文件
        const fileBuffer = await client.downloadFile(epubBook.path);
        
        // 设置响应头
        res.setHeader('Content-Type', 'application/epub+zip');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(epubBook.filename)}"`);
        res.setHeader('Content-Length', fileBuffer.length);
        
        res.send(fileBuffer);
    } catch (error) {
        console.error('下载EPUB失败:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
