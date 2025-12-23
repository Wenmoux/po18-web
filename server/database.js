/**
 * PO18小说下载网站 - 数据库模块
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const config = require("./config");
const { logger } = require("./logger");

// 确保数据目录存在
const dataDir = path.dirname(config.database.path);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(config.database.path);

// 初始化数据库表
function initDatabase() {
    // 用户表
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            po18_cookie TEXT,
            webdav_config TEXT,
            share_enabled INTEGER DEFAULT 0,
            shared_books_count INTEGER DEFAULT 0,
            cache_auth INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // WebDAV配置表（支持多个书库）
    db.exec(`
        CREATE TABLE IF NOT EXISTS webdav_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            base_path TEXT DEFAULT '/',
            is_default INTEGER DEFAULT 0,
            is_enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 书库表（用户本地书库）
    db.exec(`
        CREATE TABLE IF NOT EXISTS library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            tags TEXT,
            format TEXT DEFAULT 'txt',
            file_path TEXT,
            file_size INTEGER,
            chapter_count INTEGER,
            downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, book_id, format)
        )
    `);

    // 下载队列表（合并了历史记录）
    db.exec(`
        CREATE TABLE IF NOT EXISTS download_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            format TEXT DEFAULT 'txt',
            status TEXT DEFAULT 'pending',
            progress INTEGER DEFAULT 0,
            total_chapters INTEGER DEFAULT 0,
            file_size TEXT,
            duration REAL,
            webdav_path TEXT,
            shared BOOLEAN DEFAULT 0,
            error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME,
            completed_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 已购书籍缓存表
    db.exec(`
        CREATE TABLE IF NOT EXISTS purchased_books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            tags TEXT,
            status TEXT,
            buy_time TEXT,
            latest_time TEXT,
            available_chapters INTEGER DEFAULT 0,
            purchased_chapters INTEGER DEFAULT 0,
            year INTEGER,
            detail_url TEXT,
            cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, book_id)
        )
    `);

    // 检查并迁移 purchased_books 表结构
    const purchasedColumns = db
        .prepare("PRAGMA table_info(purchased_books)")
        .all()
        .map((c) => c.name);
    if (!purchasedColumns.includes("status")) {
        console.log("正在迁移 purchased_books 表结构...");
        db.exec(`
            CREATE TABLE IF NOT EXISTS purchased_books_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                book_id TEXT NOT NULL,
                title TEXT NOT NULL,
                author TEXT,
                cover TEXT,
                tags TEXT,
                status TEXT,
                buy_time TEXT,
                latest_time TEXT,
                available_chapters INTEGER DEFAULT 0,
                purchased_chapters INTEGER DEFAULT 0,
                year INTEGER,
                detail_url TEXT,
                cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, book_id)
            );
            
            INSERT INTO purchased_books_new (id, user_id, book_id, title, author, cover, tags, year, detail_url, cached_at)
            SELECT id, user_id, book_id, title, author, cover, tags, year, detail_url, cached_at FROM purchased_books;
            
            DROP TABLE purchased_books;
            ALTER TABLE purchased_books_new RENAME TO purchased_books;
        `);
        console.log("purchased_books 表迁移完成");
    }

    // 共享书库表
    db.exec(`
        CREATE TABLE IF NOT EXISTS shared_library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            tags TEXT,
            format TEXT DEFAULT 'epub',
            webdav_path TEXT NOT NULL,
            file_size INTEGER,
            chapter_count INTEGER,
            download_count INTEGER DEFAULT 0,
            shared_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(book_id, format)
        )
    `);

    // 下载历史记录表
    db.exec(`
        CREATE TABLE IF NOT EXISTS download_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            format TEXT,
            file_size TEXT,
            duration REAL,
            chapter_count INTEGER,
            downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 书籍元信息缓存表 - 支持多版本
    db.exec(`
        CREATE TABLE IF NOT EXISTS book_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            description TEXT,
            tags TEXT,
            category TEXT,
            word_count INTEGER DEFAULT 0,
            free_chapters INTEGER DEFAULT 0,
            paid_chapters INTEGER DEFAULT 0,
            total_chapters INTEGER DEFAULT 0,
            subscribed_chapters INTEGER DEFAULT 0,
            status TEXT DEFAULT 'unknown',
            latest_chapter_name TEXT,
            latest_chapter_date TEXT,
            platform TEXT DEFAULT 'po18',
            favorites_count INTEGER DEFAULT 0,
            comments_count INTEGER DEFAULT 0,
            monthly_popularity INTEGER DEFAULT 0,
            total_popularity INTEGER DEFAULT 0,
            detail_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(book_id, subscribed_chapters)
        )
    `);

    // 章节内容缓存表
    db.exec(`
        CREATE TABLE IF NOT EXISTS chapter_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            title TEXT,
            html TEXT,
            text TEXT,
            chapter_order INTEGER DEFAULT 0,
            uploader TEXT DEFAULT 'unknown_user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(book_id, chapter_id)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chapter_cache_book_id ON chapter_cache(book_id);
        CREATE INDEX IF NOT EXISTS idx_chapter_cache_chapter_id ON chapter_cache(chapter_id);
    `);

    // 书架表
    db.exec(`
        CREATE TABLE IF NOT EXISTS bookshelf (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            current_chapter INTEGER DEFAULT 0,
            total_chapters INTEGER DEFAULT 0,
            reading_time INTEGER DEFAULT 0,
            last_read_at DATETIME,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, book_id)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_bookshelf_user_id ON bookshelf(user_id);
        CREATE INDEX IF NOT EXISTS idx_bookshelf_last_read ON bookshelf(last_read_at);
    `);

    // 每日阅读统计表（用于热力图）
    db.exec(`
        CREATE TABLE IF NOT EXISTS reading_daily_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            reading_minutes INTEGER DEFAULT 0,
            books_read INTEGER DEFAULT 0,
            chapters_read INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, date)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_reading_daily_user_date ON reading_daily_stats(user_id, date);
    `);

    // 书籍订阅表（更新通知）
    db.exec(`
        CREATE TABLE IF NOT EXISTS book_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            last_chapter_count INTEGER DEFAULT 0,
            last_checked_at DATETIME,
            has_update INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, book_id)
        )
    `);

    // 共享书籍表 - 添加上传者ID字段
    db.exec(`
        CREATE TABLE IF NOT EXISTS shared_books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            uploader_id INTEGER,  -- 上传者ID
            book_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover_url TEXT,
            description TEXT,
            tags TEXT,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            upload_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            download_count INTEGER DEFAULT 0,
            UNIQUE(book_id, uploader_id)  -- 防止同一用户重复上传同一书籍
        )
    `);

    // 章节分享统计表
    db.exec(`
        CREATE TABLE IF NOT EXISTS chapter_shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,  -- 分享者ID
            uploader_id INTEGER,       -- 上传者ID（如果在详情页预加载上传）
            book_id INTEGER NOT NULL,
            chapter_id INTEGER NOT NULL,
            chapter_title TEXT NOT NULL,
            share_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(chapter_id, user_id)  -- 防止同一用户重复分享同一章节
        )
    `);

    // 用户分享统计表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_share_stats (
            user_id INTEGER PRIMARY KEY,
            total_shared_chapters INTEGER DEFAULT 0,
            total_shared_books INTEGER DEFAULT 0,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // ==================== 新增表 ====================
    
    // 用户行为日志表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    
    // 用户画像表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id INTEGER PRIMARY KEY,
            reading_preferences TEXT, -- JSON格式存储类型偏好
            favorite_genres TEXT, -- JSON格式存储最爱类型
            reading_habits TEXT, -- JSON格式存储阅读习惯
            activity_score INTEGER DEFAULT 0, -- 活跃度评分
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON book_subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_update ON book_subscriptions(has_update);
        CREATE INDEX IF NOT EXISTS idx_user_actions_user_id ON user_actions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_actions_action ON user_actions(action);
        CREATE INDEX IF NOT EXISTS idx_user_actions_created_at ON user_actions(created_at);
    `);

    console.log("数据库初始化完成");

    // 数据库迁移 - 添加缺少的列
    try {
        // 检查并添加 users 表的新列
        const usersTableInfo = db.prepare("PRAGMA table_info(users)").all();
        const usersColumns = usersTableInfo.map((col) => col.name);

        if (!usersColumns.includes("cache_auth")) {
            db.exec("ALTER TABLE users ADD COLUMN cache_auth INTEGER DEFAULT 0");
            console.log("迁移: 添加 users.cache_auth 列");
        }

        // 单点登录支持：添加 session_token 字段
        if (!usersColumns.includes("session_token")) {
            db.exec("ALTER TABLE users ADD COLUMN session_token TEXT");
            console.log("迁移: 添加 users.session_token 列（单点登录）");
        }

        // 检查并添加 download_queue 表的新列
        const queueTableInfo = db.prepare("PRAGMA table_info(download_queue)").all();
        const queueColumns = queueTableInfo.map((col) => col.name);

        if (!queueColumns.includes("file_size")) {
            db.exec("ALTER TABLE download_queue ADD COLUMN file_size TEXT");
            console.log("迁移: 添加 download_queue.file_size 列");
        }
        if (!queueColumns.includes("duration")) {
            db.exec("ALTER TABLE download_queue ADD COLUMN duration REAL");
            console.log("迁移: 添加 download_queue.duration 列");
        }
        if (!queueColumns.includes("webdav_path")) {
            db.exec("ALTER TABLE download_queue ADD COLUMN webdav_path TEXT");
            console.log("迁移: 添加 download_queue.webdav_path 列");
        }
        if (!queueColumns.includes("shared")) {
            db.exec("ALTER TABLE download_queue ADD COLUMN shared BOOLEAN DEFAULT 0");
            console.log("迁移: 添加 download_queue.shared 列");
        }

        // 检查并添加 book_metadata 表的新列
        const tableInfo = db.prepare("PRAGMA table_info(book_metadata)").all();
        const columns = tableInfo.map((col) => col.name);

        if (!columns.includes("total_chapters")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN total_chapters INTEGER DEFAULT 0");
            console.log("迁移: 添加 total_chapters 列");
        }
        if (!columns.includes("subscribed_chapters")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN subscribed_chapters INTEGER DEFAULT 0");
            console.log("迁移: 添加 subscribed_chapters 列");
        }
        if (!columns.includes("category")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN category TEXT");
            console.log("迁移: 添加 category 列");
        }
        if (!columns.includes("word_count")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN word_count INTEGER DEFAULT 0");
            console.log("迁移: 添加 word_count 列");
        }
        if (!columns.includes("free_chapters")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN free_chapters INTEGER DEFAULT 0");
            console.log("迁移: 添加 free_chapters 列");
        }
        if (!columns.includes("paid_chapters")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN paid_chapters INTEGER DEFAULT 0");
            console.log("迁移: 添加 paid_chapters 列");
        }
        if (!columns.includes("status")) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN status TEXT DEFAULT "unknown"');
            console.log("迁移: 添加 status 列");
        }
        if (!columns.includes("latest_chapter_name")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN latest_chapter_name TEXT");
            console.log("迁移: 添加 latest_chapter_name 列");
        }
        if (!columns.includes("latest_chapter_date")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN latest_chapter_date TEXT");
            console.log("迁移: 添加 latest_chapter_date 列");
        }
        if (!columns.includes("platform")) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN platform TEXT DEFAULT "po18"');
            console.log("迁移: 添加 platform 列");
        }
        if (!columns.includes("favorites_count")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN favorites_count INTEGER DEFAULT 0");
            console.log("迁移: 添加 favorites_count 列");
        }
        if (!columns.includes("comments_count")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN comments_count INTEGER DEFAULT 0");
            console.log("迁移: 添加 comments_count 列");
        }
        if (!columns.includes("monthly_popularity")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN monthly_popularity INTEGER DEFAULT 0");
            console.log("迁移: 添加 monthly_popularity 列");
        }
        if (!columns.includes("total_popularity")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN total_popularity INTEGER DEFAULT 0");
            console.log("迁移: 添加 total_popularity 列");
        }
        
        // 添加 uploader 列（如果不存在）
        if (!columns.includes("uploader")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN uploader TEXT DEFAULT 'unknown_user'");
            console.log("迁移: 添加 uploader 列");
        }
        
        // 添加 uploaderId 列（如果不存在）
        if (!columns.includes("uploaderId")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN uploaderId TEXT DEFAULT 'unknown'");
            console.log("迁移: 添加 uploaderId 列");
        }

        // 检查并添加 chapter_cache 表的 chapter_order 列
        const chapterCacheColumns = db
            .prepare("PRAGMA table_info(chapter_cache)")
            .all()
            .map((c) => c.name);
        if (!chapterCacheColumns.includes("chapter_order")) {
            db.exec("ALTER TABLE chapter_cache ADD COLUMN chapter_order INTEGER DEFAULT 0");
            console.log("迁移: 添加 chapter_cache.chapter_order 列");
        }
        
        // 检查并添加 chapter_cache 表的 uploader 列
        if (!chapterCacheColumns.includes("uploader")) {
            db.exec("ALTER TABLE chapter_cache ADD COLUMN uploader TEXT DEFAULT 'unknown_user'");
            console.log("迁移: 添加 chapter_cache.uploader 列");
        }
        
        // 检查并添加 chapter_cache 表的 uploaderId 列
        if (!chapterCacheColumns.includes("uploaderId")) {
            db.exec("ALTER TABLE chapter_cache ADD COLUMN uploaderId TEXT DEFAULT 'unknown'");
            console.log("迁移: 添加 chapter_cache.uploaderId 列");
        }

        // 检查并添加 shared_library 表的新列
        const sharedTableInfo = db.prepare("PRAGMA table_info(shared_library)").all();
        const sharedColumns = sharedTableInfo.map((col) => col.name);

        // 检查并添加 users 表的 library_auth 列（云端书库权限）
        const userColumns = db
            .prepare("PRAGMA table_info(users)")
            .all()
            .map((c) => c.name);
        if (!userColumns.includes("library_auth")) {
            db.exec("ALTER TABLE users ADD COLUMN library_auth INTEGER DEFAULT 0");
            console.log("迁移: 添加 users.library_auth 列");
        }

        if (sharedColumns.includes("webdav_path") && !sharedColumns.includes("file_path")) {
            // 将 webdav_path 重命名为 file_path（SQLite不支持RENAME COLUMN，需要重建表）
            db.exec(`
                CREATE TABLE IF NOT EXISTS shared_library_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    book_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    author TEXT,
                    cover TEXT,
                    tags TEXT,
                    format TEXT DEFAULT 'epub',
                    file_path TEXT NOT NULL,
                    file_size INTEGER,
                    chapter_count INTEGER,
                    download_count INTEGER DEFAULT 0,
                    shared_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    UNIQUE(book_id, format)
                );
                INSERT INTO shared_library_new SELECT id, user_id, book_id, title, author, cover, tags, format, webdav_path, file_size, chapter_count, download_count, shared_at FROM shared_library;
                DROP TABLE shared_library;
                ALTER TABLE shared_library_new RENAME TO shared_library;
            `);
            console.log("迁移: shared_library.webdav_path -> file_path");
        } else if (!sharedColumns.includes("file_path")) {
            db.exec("ALTER TABLE shared_library ADD COLUMN file_path TEXT");
            console.log("迁移: 添加 shared_library.file_path 列");
        }
    } catch (migrateErr) {
        console.error("数据库迁移失败:", migrateErr.message);
    }
}

// 用户相关操作
const UserDB = {
    create(username, password) {
        const stmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
        return stmt.run(username, password);
    },

    findByUsername(username) {
        const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
        return stmt.get(username);
    },

    findById(id) {
        const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
        return stmt.get(id);
    },

    updatePo18Cookie(userId, cookie) {
        const stmt = db.prepare("UPDATE users SET po18_cookie = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        return stmt.run(cookie, userId);
    },

    updateWebDAVConfig(userId, config) {
        const stmt = db.prepare("UPDATE users SET webdav_config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        return stmt.run(JSON.stringify(config), userId);
    },

    enableSharing(userId) {
        const stmt = db.prepare("UPDATE users SET share_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        return stmt.run(userId);
    },

    disableSharing(userId) {
        const stmt = db.prepare("UPDATE users SET share_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        return stmt.run(userId);
    },

    incrementSharedBooks(userId) {
        const stmt = db.prepare(
            "UPDATE users SET shared_books_count = shared_books_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        );
        return stmt.run(userId);
    },

    // 启用云端缓存授权
    enableCacheAuth(userId) {
        const stmt = db.prepare("UPDATE users SET cache_auth = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        return stmt.run(userId);
    },

    // 禁用云端缓存授权
    disableCacheAuth(userId) {
        const stmt = db.prepare("UPDATE users SET cache_auth = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        return stmt.run(userId);
    },

    // 检查是否有全站书库权限 (cache_auth)
    hasCacheAuth(userId) {
        const user = this.findById(userId);
        if (!user) return false;

        // admin用户始终有权限
        if (user.username === "admin") {
            return true;
        }

        return user.cache_auth === 1;
    },

    // 检查是否有云端书库权限 (library_auth)
    hasLibraryAuth(userId) {
        const user = this.findById(userId);
        if (!user) return false;

        // admin用户始终有权限
        if (user.username === "admin") {
            return true;
        }

        return user.library_auth === 1;
    },

    canAccessSharedLibrary(userId) {
        const user = this.findById(userId);
        if (!user) return false;

        // admin用户始终有权限
        if (user.username === "admin") {
            return true;
        }

        // 检查是否是特权用户
        if (config.sharing.privilegedUsers && config.sharing.privilegedUsers.includes(user.username)) {
            return true;
        }

        // 普通用户需要启用共享并上传足够数量的书籍
        return user.share_enabled === 1 && user.shared_books_count >= config.sharing.minBooksRequired;
    },

    // 检查用户是否是特权用户
    isPrivileged(userId) {
        const user = this.findById(userId);
        return user && config.sharing.privilegedUsers && config.sharing.privilegedUsers.includes(user.username);
    },

    // 单点登录：更新session token
    updateSessionToken(userId, token) {
        const stmt = db.prepare("UPDATE users SET session_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        return stmt.run(token, userId);
    },

    // 单点登录：验证session token
    validateSessionToken(userId, token) {
        const user = this.findById(userId);
        if (!user) return false;
        return user.session_token === token;
    },

    // 单点登录：清除session token（登出时使用）
    clearSessionToken(userId) {
        const stmt = db.prepare("UPDATE users SET session_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        return stmt.run(userId);
    }
};

// 书库相关操作
const LibraryDB = {
    add(userId, book) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO library 
            (user_id, book_id, title, author, cover, tags, format, file_path, file_size, chapter_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            userId,
            book.bookId,
            book.title,
            book.author,
            book.cover,
            book.tags,
            book.format,
            book.filePath,
            book.fileSize,
            book.chapterCount
        );
    },

    getByUser(userId) {
        const stmt = db.prepare("SELECT * FROM library WHERE user_id = ? ORDER BY downloaded_at DESC");
        return stmt.all(userId);
    },

    getByBookId(userId, bookId) {
        const stmt = db.prepare("SELECT * FROM library WHERE user_id = ? AND book_id = ?");
        return stmt.get(userId, bookId);
    },

    delete(userId, id) {
        const stmt = db.prepare("DELETE FROM library WHERE user_id = ? AND id = ?");
        return stmt.run(userId, id);
    }
};

// 下载队列相关操作
const QueueDB = {
    add(userId, book) {
        const stmt = db.prepare(`
            INSERT INTO download_queue 
            (user_id, book_id, title, author, cover, format, status)
            VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `);
        return stmt.run(userId, book.bookId, book.title, book.author, book.cover, book.format);
    },

    getByUser(userId) {
        const stmt = db.prepare("SELECT * FROM download_queue WHERE user_id = ? ORDER BY created_at DESC");
        return stmt.all(userId);
    },

    getById(id) {
        const stmt = db.prepare("SELECT * FROM download_queue WHERE id = ?");
        return stmt.get(id);
    },

    // 别名，与其他DB保持一致
    findById(id) {
        return this.getById(id);
    },

    getPending(userId) {
        const stmt = db.prepare(
            "SELECT * FROM download_queue WHERE user_id = ? AND status = 'pending' ORDER BY created_at ASC"
        );
        return stmt.all(userId);
    },

    updateStatus(id, status, extra = {}) {
        let sql = "UPDATE download_queue SET status = ?";
        const params = [status];

        if (extra.progress !== undefined) {
            sql += ", progress = ?";
            params.push(extra.progress);
        }
        if (extra.totalChapters !== undefined) {
            sql += ", total_chapters = ?";
            params.push(extra.totalChapters);
        }
        if (extra.errorMessage !== undefined) {
            sql += ", error_message = ?";
            params.push(extra.errorMessage);
        }
        if (extra.fileSize !== undefined) {
            sql += ", file_size = ?";
            params.push(extra.fileSize);
        }
        if (extra.duration !== undefined) {
            sql += ", duration = ?";
            params.push(extra.duration);
        }
        if (extra.webdavPath !== undefined) {
            sql += ", webdav_path = ?";
            params.push(extra.webdavPath);
        }
        if (extra.shared !== undefined) {
            sql += ", shared = ?";
            params.push(extra.shared ? 1 : 0);
        }
        if (status === "downloading") {
            sql += ", started_at = CURRENT_TIMESTAMP";
        }
        if (status === "completed" || status === "failed") {
            sql += ", completed_at = CURRENT_TIMESTAMP";
        }

        sql += " WHERE id = ?";
        params.push(id);

        const stmt = db.prepare(sql);
        return stmt.run(...params);
    },

    delete(userId, id) {
        const stmt = db.prepare("DELETE FROM download_queue WHERE user_id = ? AND id = ?");
        return stmt.run(userId, id);
    },

    clearCompleted(userId) {
        const stmt = db.prepare("DELETE FROM download_queue WHERE user_id = ? AND status IN ('completed', 'failed')");
        return stmt.run(userId);
    }
};

// 已购书籍相关操作
const PurchasedDB = {
    upsert(userId, book) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO purchased_books 
            (user_id, book_id, title, author, cover, tags, status, buy_time, latest_time, available_chapters, purchased_chapters, year, detail_url, cached_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        return stmt.run(
            userId,
            book.bookId,
            book.title,
            book.author,
            book.cover,
            book.tags,
            book.status || "",
            book.buyTime || "",
            book.latestTime || "",
            book.availableChapters || 0,
            book.purchasedChapters || 0,
            book.year,
            book.detailUrl
        );
    },

    getByUser(userId) {
        const stmt = db.prepare("SELECT * FROM purchased_books WHERE user_id = ? ORDER BY year DESC, cached_at DESC");
        return stmt.all(userId);
    },

    clearByUser(userId) {
        const stmt = db.prepare("DELETE FROM purchased_books WHERE user_id = ?");
        return stmt.run(userId);
    }
};

// 共享书库相关操作
class SharedDB {
    // 添加共享书籍
    static addBook(userId, bookData, uploaderId = null) {
        try {
            // 检查是否已存在相同的书籍和上传者组合
            const existing = db.prepare(`
                SELECT id FROM shared_books 
                WHERE book_id = ? AND (uploader_id = ? OR (? IS NULL AND uploader_id IS NULL))
            `).get(bookData.bookId, uploaderId, uploaderId);
            
            if (existing) {
                // 如果已存在，更新现有记录
                const result = db.prepare(`
                    UPDATE shared_books 
                    SET title = ?, author = ?, cover_url = ?, description = ?, tags = ?, 
                        file_path = ?, file_size = ?, upload_time = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(
                    bookData.title, bookData.author, bookData.coverUrl, bookData.description,
                    JSON.stringify(bookData.tags), bookData.filePath, bookData.fileSize, existing.id
                );
                
                return existing.id;
            } else {
                // 插入新记录
                const result = db.prepare(`
                    INSERT INTO shared_books (
                        user_id, uploader_id, book_id, title, author, cover_url, 
                        description, tags, file_path, file_size
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    userId, uploaderId, bookData.bookId, bookData.title, bookData.author,
                    bookData.coverUrl, bookData.description, JSON.stringify(bookData.tags),
                    bookData.filePath, bookData.fileSize
                );
                
                // 更新用户分享统计
                this.updateUserShareStats(userId, true, false);
                
                return result.lastInsertRowid;
            }
        } catch (error) {
            logger.error("添加共享书籍失败", { error: error.message, userId, bookData });
            throw error;
        }
    }
    
    // 记录章节分享
    static recordChapterShare(userId, bookId, chapterId, chapterTitle, uploaderId = null) {
        try {
            // 检查是否已存在相同的章节和用户组合
            const existing = db.prepare(`
                SELECT id FROM chapter_shares 
                WHERE chapter_id = ? AND user_id = ?
            `).get(chapterId, userId);
            
            if (!existing) {
                // 只有当章节未被该用户分享过时才记录
                const result = db.prepare(`
                    INSERT INTO chapter_shares (
                        user_id, uploader_id, book_id, chapter_id, chapter_title
                    ) VALUES (?, ?, ?, ?, ?)
                `).run(userId, uploaderId, bookId, chapterId, chapterTitle);
                
                // 更新用户分享统计
                this.updateUserShareStats(userId, false, true);
                
                return result.lastInsertRowid;
            }
            
            return existing.id;
        } catch (error) {
            logger.error("记录章节分享失败", { error: error.message, userId, bookId, chapterId });
            throw error;
        }
    }
    
    // 更新用户分享统计
    static updateUserShareStats(userId, isBook = false, isChapter = false) {
        try {
            // 检查用户统计记录是否存在
            const existing = db.prepare(`
                SELECT user_id FROM user_share_stats WHERE user_id = ?
            `).get(userId);
            
            if (existing) {
                // 更新现有记录
                let updateQuery = "UPDATE user_share_stats SET last_updated = CURRENT_TIMESTAMP";
                const params = [];
                
                if (isBook) {
                    updateQuery += ", total_shared_books = total_shared_books + 1";
                }
                
                if (isChapter) {
                    updateQuery += ", total_shared_chapters = total_shared_chapters + 1";
                }
                
                updateQuery += " WHERE user_id = ?";
                params.push(userId);
                
                db.prepare(updateQuery).run(...params);
            } else {
                // 插入新记录
                const bookCount = isBook ? 1 : 0;
                const chapterCount = isChapter ? 1 : 0;
                
                db.prepare(`
                    INSERT INTO user_share_stats (
                        user_id, total_shared_books, total_shared_chapters
                    ) VALUES (?, ?, ?)
                `).run(userId, bookCount, chapterCount);
            }
        } catch (error) {
            logger.error("更新用户分享统计失败", { error: error.message, userId });
            throw error;
        }
    }
    
    // 获取用户分享统计
    static getUserShareStats(userId) {
        try {
            const stats = db.prepare(`
                SELECT total_shared_books, total_shared_chapters 
                FROM user_share_stats 
                WHERE user_id = ?
            `).get(userId);
            
            return stats || { total_shared_books: 0, total_shared_chapters: 0 };
        } catch (error) {
            logger.error("获取用户分享统计失败", { error: error.message, userId });
            return { total_shared_books: 0, total_shared_chapters: 0 };
        }
    }
    
    // 获取用户的章节分享列表
    static getUserChapterShares(userId, limit = 50, offset = 0) {
        try {
            const shares = db.prepare(`
                SELECT cs.*, sb.title as book_title, u.username as uploader_name
                FROM chapter_shares cs
                LEFT JOIN shared_books sb ON cs.book_id = sb.book_id
                LEFT JOIN users u ON cs.uploader_id = u.id
                WHERE cs.user_id = ?
                ORDER BY cs.share_time DESC
                LIMIT ? OFFSET ?
            `).all(userId, limit, offset);
            
            return shares;
        } catch (error) {
            logger.error("获取用户章节分享列表失败", { error: error.message, userId });
            return [];
        }
    }
    
    // 获取用户分享的书籍列表
    static getUserSharedBooks(userId, limit = 50, offset = 0) {
        try {
            const books = db.prepare(`
                SELECT *, user_id as sharer_id
                FROM shared_books 
                WHERE user_id = ?
                ORDER BY upload_time DESC
                LIMIT ? OFFSET ?
            `).all(userId, limit, offset);
            
            return books;
        } catch (error) {
            logger.error("获取用户分享书籍列表失败", { error: error.message, userId });
            return [];
        }
    }
    
    // 获取所有用户的分享排行榜
    static getShareRankings(limit = 20) {
        try {
            const rankings = db.prepare(`
                SELECT 
                    u.id as user_id,
                    u.username,
                    COALESCE(uss.total_shared_chapters, 0) as chapters_shared,
                    COALESCE(uss.total_shared_books, 0) as books_shared,
                    (COALESCE(uss.total_shared_chapters, 0) + COALESCE(uss.total_shared_books, 0) * 10) as score
                FROM users u
                LEFT JOIN user_share_stats uss ON u.id = uss.user_id
                WHERE COALESCE(uss.total_shared_chapters, 0) > 0 OR COALESCE(uss.total_shared_books, 0) > 0
                ORDER BY score DESC
                LIMIT ?
            `).all(limit);
            
            return rankings;
        } catch (error) {
            logger.error("获取分享排行榜失败", { error: error.message });
            return [];
        }
    }
    
    static getAll() {
        const stmt = db.prepare(`
            SELECT sl.*, u.username as uploader_name 
            FROM shared_library sl 
            LEFT JOIN users u ON sl.user_id = u.id 
            ORDER BY sl.shared_at DESC
        `);
        return stmt.all();
    }

    static search(keyword) {
        const stmt = db.prepare(`
            SELECT sl.*, u.username as uploader_name 
            FROM shared_library sl 
            LEFT JOIN users u ON sl.user_id = u.id 
            WHERE sl.title LIKE ? OR sl.author LIKE ? OR sl.tags LIKE ?
            ORDER BY sl.download_count DESC, sl.shared_at DESC
        `);
        const pattern = `%${keyword}%`;
        return stmt.all(pattern, pattern, pattern);
    }

    static incrementDownload(id) {
        const stmt = db.prepare("UPDATE shared_library SET download_count = download_count + 1 WHERE id = ?");
        return stmt.run(id);
    }

    static getByBookId(bookId) {
        const stmt = db.prepare(`
            SELECT sl.*, u.username as uploader_name 
            FROM shared_library sl 
            LEFT JOIN users u ON sl.user_id = u.id 
            WHERE sl.book_id = ?
        `);
        return stmt.all(bookId);
    }

    static getById(id) {
        const stmt = db.prepare(`
            SELECT sl.*, u.username as uploader_name 
            FROM shared_library sl 
            LEFT JOIN users u ON sl.user_id = u.id 
            WHERE sl.id = ?
        `);
        return stmt.get(id);
    }

    static delete(id) {
        const stmt = db.prepare("DELETE FROM shared_library WHERE id = ?");
        return stmt.run(id);
    }

    static deleteByBookId(bookId) {
        const stmt = db.prepare("DELETE FROM shared_library WHERE book_id = ?");
        return stmt.run(bookId);
    }

    // 清理所有文件不存在的记录
    static cleanupMissingFiles() {
        const allBooks = this.getAll();
        let deletedCount = 0;

        for (const book of allBooks) {
            if (!book.file_path || !fs.existsSync(book.file_path)) {
                this.delete(book.id);
                deletedCount++;
                console.log(`已删除不存在的共享书籍: ${book.title} (${book.file_path || "无路径"})`);
            }
        }

        return deletedCount;
    }
}

// 章节分享统计相关操作
const ChapterShareDB = {
    // 记录章节分享
    recordShare(userId, bookId, chapterId, chapterTitle, uploaderId = null) {
        try {
            // 检查是否已存在相同的章节和用户组合
            const existing = db.prepare(`
                SELECT id FROM chapter_shares 
                WHERE chapter_id = ? AND user_id = ?
            `).get(chapterId, userId);
            
            if (!existing) {
                // 只有当章节未被该用户分享过时才记录
                const result = db.prepare(`
                    INSERT INTO chapter_shares (
                        user_id, uploader_id, book_id, chapter_id, chapter_title
                    ) VALUES (?, ?, ?, ?, ?)
                `).run(userId, uploaderId, bookId, chapterId, chapterTitle);
                
                // 更新用户分享统计
                this.updateUserShareStats(userId, false, true);
                
                return result.lastInsertRowid;
            }
            
            return existing.id;
        } catch (error) {
            logger.error("记录章节分享失败", { error: error.message, userId, bookId, chapterId });
            throw error;
        }
    },
    
    // 更新用户分享统计
    updateUserShareStats(userId, isBook = false, isChapter = false) {
        try {
            // 检查用户统计记录是否存在
            const existing = db.prepare(`
                SELECT user_id FROM user_share_stats WHERE user_id = ?
            `).get(userId);
            
            if (existing) {
                // 更新现有记录
                let updateQuery = "UPDATE user_share_stats SET last_updated = CURRENT_TIMESTAMP";
                const params = [];
                
                if (isBook) {
                    updateQuery += ", total_shared_books = total_shared_books + 1";
                }
                
                if (isChapter) {
                    updateQuery += ", total_shared_chapters = total_shared_chapters + 1";
                }
                
                updateQuery += " WHERE user_id = ?";
                params.push(userId);
                
                db.prepare(updateQuery).run(...params);
            } else {
                // 插入新记录
                const bookCount = isBook ? 1 : 0;
                const chapterCount = isChapter ? 1 : 0;
                
                db.prepare(`
                    INSERT INTO user_share_stats (
                        user_id, total_shared_books, total_shared_chapters
                    ) VALUES (?, ?, ?)
                `).run(userId, bookCount, chapterCount);
            }
        } catch (error) {
            logger.error("更新用户分享统计失败", { error: error.message, userId });
            throw error;
        }
    },
    
    // 获取用户分享统计
    getUserShareStats(userId) {
        try {
            const stats = db.prepare(`
                SELECT total_shared_books, total_shared_chapters 
                FROM user_share_stats 
                WHERE user_id = ?
            `).get(userId);
            
            return stats || { total_shared_books: 0, total_shared_chapters: 0 };
        } catch (error) {
            logger.error("获取用户分享统计失败", { error: error.message, userId });
            return { total_shared_books: 0, total_shared_chapters: 0 };
        }
    },
    
    // 获取用户的章节分享列表
    getUserChapterShares(userId, limit = 50, offset = 0) {
        try {
            const shares = db.prepare(`
                SELECT cs.*, sb.title as book_title, u.username as uploader_name
                FROM chapter_shares cs
                LEFT JOIN shared_books sb ON cs.book_id = sb.book_id
                LEFT JOIN users u ON cs.uploader_id = u.id
                WHERE cs.user_id = ?
                ORDER BY cs.share_time DESC
                LIMIT ? OFFSET ?
            `).all(userId, limit, offset);
            
            return shares;
        } catch (error) {
            logger.error("获取用户章节分享列表失败", { error: error.message, userId });
            return [];
        }
    },
    
    // 获取所有用户的分享排行榜
    getShareRankings(limit = 20) {
        try {
            const rankings = db.prepare(`
                SELECT 
                    u.id as user_id,
                    u.username,
                    COALESCE(uss.total_shared_chapters, 0) as chapters_shared,
                    COALESCE(uss.total_shared_books, 0) as books_shared,
                    (COALESCE(uss.total_shared_chapters, 0) + COALESCE(uss.total_shared_books, 0) * 10) as score
                FROM users u
                LEFT JOIN user_share_stats uss ON u.id = uss.user_id
                WHERE COALESCE(uss.total_shared_chapters, 0) > 0 OR COALESCE(uss.total_shared_books, 0) > 0
                ORDER BY score DESC
                LIMIT ?
            `).all(limit);
            
            return rankings;
        } catch (error) {
            logger.error("获取分享排行榜失败", { error: error.message });
            return [];
        }
    }
};

// 下载历史相关操作
const HistoryDB = {
    add(userId, record) {
        // 先检查是否已经存在相同的下载记录（同一本书、同一格式）
        const existing = db
            .prepare(
                "SELECT id FROM download_history WHERE user_id = ? AND book_id = ? AND format = ? ORDER BY downloaded_at DESC LIMIT 1"
            )
            .get(userId, record.bookId, record.format);

        // 如果存在且是最近一小时内的记录，则更新而不是新增
        if (existing) {
            const existingRecord = db.prepare("SELECT * FROM download_history WHERE id = ?").get(existing.id);
            const timeDiff = Date.now() - new Date(existingRecord.downloaded_at).getTime();

            // 如果是1分钟内的重复下载，则更新现有记录
            if (timeDiff < 60000) {
                const stmt = db.prepare(`
                    UPDATE download_history 
                    SET file_size = ?, duration = ?, chapter_count = ?, downloaded_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `);
                return stmt.run(record.fileSize, record.duration, record.chapterCount, existing.id);
            }
        }

        // 否则新增记录
        const stmt = db.prepare(`
            INSERT INTO download_history 
            (user_id, book_id, title, author, format, file_size, duration, chapter_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            userId,
            record.bookId,
            record.title,
            record.author,
            record.format,
            record.fileSize,
            record.duration,
            record.chapterCount
        );
    },

    getByUser(userId, limit = 50) {
        const stmt = db.prepare("SELECT * FROM download_history WHERE user_id = ? ORDER BY downloaded_at DESC LIMIT ?");
        return stmt.all(userId, limit);
    },

    clear(userId) {
        const stmt = db.prepare("DELETE FROM download_history WHERE user_id = ?");
        return stmt.run(userId);
    }
};

// 书籍元信息缓存操作 - 支持多版本
const BookMetadataDB = {
    // 添加或更新书籍信息（根据已订阅章节数区分版本）
    upsert(book) {
        try {
            // 先查找是否存在相同版本
            const existing = db
                .prepare("SELECT id FROM book_metadata WHERE book_id = ? AND subscribed_chapters = ?")
                .get(book.bookId, book.subscribedChapters || 0);

            if (existing) {
                // 更新现有记录
                const updateStmt = db.prepare(`
                    UPDATE book_metadata SET
                        title = ?, author = ?, cover = ?, description = ?, tags = ?,
                        category = ?, word_count = ?, free_chapters = ?, paid_chapters = ?, total_chapters = ?, status = ?,
                        latest_chapter_name = ?, latest_chapter_date = ?, platform = ?,
                        favorites_count = ?, comments_count = ?, monthly_popularity = ?, total_popularity = ?,
                        detail_url = ?, uploader = ?, uploaderId = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `);
                return updateStmt.run(
                    book.title,
                    book.author || "",
                    book.cover || "",
                    book.description || "",
                    book.tags || "",
                    book.category || "",
                    book.wordCount || 0,
                    book.freeChapters || 0,
                    book.paidChapters || 0,
                    book.totalChapters || 0,
                    book.status || "unknown",
                    book.latestChapterName || "",
                    book.latestChapterDate || "",
                    book.platform || "po18",
                    book.favoritesCount || 0,
                    book.commentsCount || 0,
                    book.monthlyPopularity || 0,
                    book.totalPopularity || 0,
                    book.detailUrl || "",
                    book.uploader || "unknown_user",
                    book.uploaderId || "unknown",
                    existing.id
                );
            } else {
                // 检查是否存在相同book_id的记录（旧数据库可能只有book_id索引）
                const existingByBookId = db
                    .prepare("SELECT id, subscribed_chapters FROM book_metadata WHERE book_id = ?")
                    .get(book.bookId);

                if (existingByBookId) {
                    // 如果已存在相同book_id但不同版本，更新该记录
                    const updateStmt = db.prepare(`
                        UPDATE book_metadata SET
                            title = ?, author = ?, cover = ?, description = ?, tags = ?,
                            category = ?, word_count = ?, free_chapters = ?, paid_chapters = ?, total_chapters = ?, status = ?,
                            latest_chapter_name = ?, latest_chapter_date = ?, platform = ?,
                            favorites_count = ?, comments_count = ?, monthly_popularity = ?, total_popularity = ?,
                            detail_url = ?, uploader = ?, uploaderId = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `);
                    return updateStmt.run(
                        book.title,
                        book.author || "",
                        book.cover || "",
                        book.description || "",
                        book.tags || "",
                        book.category || "",
                        book.wordCount || 0,
                        book.freeChapters || 0,
                        book.paidChapters || 0,
                        book.totalChapters || 0,
                        book.status || "unknown",
                        book.latestChapterName || "",
                        book.latestChapterDate || "",
                        book.platform || "po18",
                        book.favoritesCount || 0,
                        book.commentsCount || 0,
                        book.monthlyPopularity || 0,
                        book.totalPopularity || 0,
                        book.detailUrl || "",
                        book.uploader || "unknown_user",
                        book.uploaderId || "unknown",
                        existingByBookId.id
                    );
                }

                // 插入新记录
                const insertStmt = db.prepare(`
                    INSERT INTO book_metadata 
                    (book_id, title, author, cover, description, tags, category, word_count, free_chapters, paid_chapters, total_chapters, subscribed_chapters, status, latest_chapter_name, latest_chapter_date, platform, favorites_count, comments_count, monthly_popularity, total_popularity, detail_url, uploader, uploaderId)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                return insertStmt.run(
                    book.bookId,
                    book.title,
                    book.author || "",
                    book.cover || "",
                    book.description || "",
                    book.tags || "",
                    book.category || "",
                    book.wordCount || 0,
                    book.freeChapters || 0,
                    book.paidChapters || 0,
                    book.totalChapters || 0,
                    book.subscribedChapters || 0,
                    book.status || "unknown",
                    book.latestChapterName || "",
                    book.latestChapterDate || "",
                    book.platform || "po18",
                    book.favoritesCount || 0,
                    book.commentsCount || 0,
                    book.monthlyPopularity || 0,
                    book.totalPopularity || 0,
                    book.detailUrl || "",
                    book.uploader || "unknown_user",
                    book.uploaderId || "unknown"
                );
            }
        } catch (err) {
            console.error("BookMetadataDB.upsert 失败:", err.message);
            throw err;
        }
    },

    // 根据书籍ID获取所有版本
    findByBookId(bookId) {
        const stmt = db.prepare("SELECT * FROM book_metadata WHERE book_id = ? ORDER BY subscribed_chapters DESC");
        return stmt.all(bookId);
    },

    // 获取单个版本
    get(bookId) {
        const stmt = db.prepare(
            "SELECT * FROM book_metadata WHERE book_id = ? ORDER BY subscribed_chapters DESC LIMIT 1"
        );
        return stmt.get(bookId);
    },

    // 搜索书籍（返回所有版本）
    search(keyword) {
        // 支持空格分词和模糊匹配
        const keywords = keyword.trim().split(/\s+/);

        if (keywords.length === 1) {
            // 单个关键词，使用原来的逻辑
            const stmt = db.prepare(`
                SELECT * FROM book_metadata 
                WHERE title LIKE ? OR author LIKE ? OR tags LIKE ? OR book_id LIKE ?
                ORDER BY book_id, subscribed_chapters DESC
            `);
            const pattern = `%${keyword}%`;
            return stmt.all(pattern, pattern, pattern, pattern);
        } else {
            // 多个关键词，支持分词匹配
            const conditions = keywords
                .map(() => "(title LIKE ? OR author LIKE ? OR tags LIKE ? OR book_id LIKE ?)")
                .join(" AND ");

            const stmt = db.prepare(`
                SELECT * FROM book_metadata 
                WHERE ${conditions}
                ORDER BY book_id, subscribed_chapters DESC
            `);

            const params = [];
            keywords.forEach((kw) => {
                const pattern = `%${kw}%`;
                params.push(pattern, pattern, pattern, pattern);
            });

            return stmt.all(...params);
        }
    },

    // 搜索并关联共享书库
    searchWithShared(keyword) {
        const stmt = db.prepare(`
            SELECT m.*, s.id as shared_id, s.format as shared_format, s.download_count, s.webdav_path
            FROM book_metadata m
            LEFT JOIN shared_library s ON m.book_id = s.book_id AND m.subscribed_chapters = s.chapter_count
            WHERE m.title LIKE ? OR m.author LIKE ? OR m.tags LIKE ?
            ORDER BY m.book_id, m.subscribed_chapters DESC
        `);
        const pattern = `%${keyword}%`;
        return stmt.all(pattern, pattern, pattern);
    },

    // 根据分类获取
    getByCategory(category) {
        const stmt = db.prepare("SELECT * FROM book_metadata WHERE category LIKE ? ORDER BY updated_at DESC");
        return stmt.all(`%${category}%`);
    },

    // 根据标签获取
    getByTag(tag) {
        const stmt = db.prepare("SELECT * FROM book_metadata WHERE tags LIKE ? ORDER BY updated_at DESC");
        return stmt.all(`%${tag}%`);
    },

    // 获取所有分类和标签
    getAllTagsAndCategories() {
        const books = db.prepare("SELECT tags, category FROM book_metadata").all();
        const tags = new Set();
        const categories = new Set();

        books.forEach((book) => {
            if (book.tags) {
                book.tags.split("·").forEach((t) => t.trim() && tags.add(t.trim()));
            }
            if (book.category) {
                categories.add(book.category);
            }
        });

        return {
            tags: Array.from(tags),
            categories: Array.from(categories)
        };
    },

    // 获取所有书籍ID（去重）
    getAllBookIds() {
        const stmt = db.prepare("SELECT DISTINCT book_id FROM book_metadata ORDER BY book_id");
        return stmt.all().map((row) => row.book_id);
    },

    // 排行榜查询
    getRankings(type, limit = 100) {
        let orderBy = "updated_at DESC";

        switch (type) {
            case "favorites":
                orderBy = "favorites_count DESC, updated_at DESC";
                break;
            case "comments":
                orderBy = "comments_count DESC, updated_at DESC";
                break;
            case "monthly":
                orderBy = "monthly_popularity DESC, updated_at DESC";
                break;
            case "total":
                orderBy = "total_popularity DESC, updated_at DESC";
                break;
            case "wordcount":
                orderBy = "word_count DESC, updated_at DESC";
                break;
            case "latest":
                orderBy = "latest_chapter_date DESC, updated_at DESC";
                break;
            default:
                orderBy = "updated_at DESC";
        }

        // 使用子查询获取每个book_id的最新版本（按subscribed_chapters最大）
        const stmt = db.prepare(`
            SELECT book_id, title, author, cover, tags, 
                word_count, total_chapters, free_chapters, paid_chapters, status,
                latest_chapter_name, latest_chapter_date,
                favorites_count, comments_count, monthly_popularity, total_popularity,
                platform, detail_url, updated_at
            FROM book_metadata
            WHERE (book_id, subscribed_chapters) IN (
                SELECT book_id, MAX(subscribed_chapters)
                FROM book_metadata
                WHERE title IS NOT NULL AND title != '' 
                    AND title NOT LIKE '书籍 %'
                GROUP BY book_id
            )
            ORDER BY ${orderBy}
            LIMIT ?
        `);

        return stmt.all(limit);
    }
};

// 初始化数据库
initDatabase();

// WebDAV配置管理
const WebDAVConfigDB = {
    // 添加配置
    add(userId, config) {
        const stmt = db.prepare(`
            INSERT INTO webdav_configs (user_id, name, url, username, password, base_path, is_default, is_enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            userId,
            config.name,
            config.url,
            config.username,
            config.password,
            config.basePath || "/",
            config.isDefault ? 1 : 0,
            1
        );
    },

    // 获取用户所有配置
    getAll(userId) {
        const stmt = db.prepare(
            "SELECT * FROM webdav_configs WHERE user_id = ? ORDER BY is_default DESC, created_at ASC"
        );
        return stmt.all(userId);
    },

    // 获取用户启用的配置
    getEnabled(userId) {
        const stmt = db.prepare(
            "SELECT * FROM webdav_configs WHERE user_id = ? AND is_enabled = 1 ORDER BY is_default DESC, created_at ASC"
        );
        return stmt.all(userId);
    },

    // 获取默认配置
    getDefault(userId) {
        const stmt = db.prepare("SELECT * FROM webdav_configs WHERE user_id = ? AND is_default = 1 LIMIT 1");
        let config = stmt.get(userId);
        if (!config) {
            // 如果没有默认配置，返回第一个
            const allStmt = db.prepare(
                "SELECT * FROM webdav_configs WHERE user_id = ? ORDER BY created_at ASC LIMIT 1"
            );
            config = allStmt.get(userId);
        }
        return config;
    },

    // 更新配置
    update(id, config) {
        const stmt = db.prepare(`
            UPDATE webdav_configs 
            SET name = ?, url = ?, username = ?, password = ?, base_path = ?, is_default = ?, is_enabled = ?
            WHERE id = ?
        `);
        return stmt.run(
            config.name,
            config.url,
            config.username,
            config.password,
            config.basePath,
            config.isDefault ? 1 : 0,
            config.isEnabled ? 1 : 0,
            id
        );
    },

    // 设置为默认
    setDefault(userId, id) {
        db.prepare("UPDATE webdav_configs SET is_default = 0 WHERE user_id = ?").run(userId);
        db.prepare("UPDATE webdav_configs SET is_default = 1 WHERE id = ?").run(id);
    },

    // 切换启用状态
    toggleEnabled(id) {
        const stmt = db.prepare("UPDATE webdav_configs SET is_enabled = NOT is_enabled WHERE id = ?");
        return stmt.run(id);
    },

    // 删除配置
    delete(id) {
        const stmt = db.prepare("DELETE FROM webdav_configs WHERE id = ?");
        return stmt.run(id);
    }
};

// 章节缓存数据库操作
const ChapterCacheDB = {
    // 获取缓存的章节内容
    get(bookId, chapterId) {
        const stmt = db.prepare("SELECT * FROM chapter_cache WHERE book_id = ? AND chapter_id = ?");
        return stmt.get(bookId, chapterId);
    },

    // 保存章节内容
    save(bookId, chapterId, title, html, text, chapterOrder = 0, uploader = 'unknown_user', uploaderId = 'unknown') {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO chapter_cache (book_id, chapter_id, title, html, text, chapter_order, uploader, uploaderId, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        return stmt.run(bookId, chapterId, title, html, text, chapterOrder, uploader, uploaderId);
    },

    // 批量保存章节
    saveBatch(chapters) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO chapter_cache (book_id, chapter_id, title, html, text, chapter_order, uploader, uploaderId, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        const insert = db.transaction((items) => {
            for (const item of items) {
                stmt.run(item.bookId, item.chapterId, item.title, item.html, item.text, item.chapterOrder || 0, item.uploader || 'unknown_user', item.uploaderId || 'unknown');
            }
        });

        return insert(chapters);
    },

    // 获取书籍的所有缓存章节
    getByBook(bookId) {
        const stmt = db.prepare(
            "SELECT * FROM chapter_cache WHERE book_id = ? ORDER BY chapter_order ASC, CAST(chapter_id AS INTEGER) ASC"
        );
        return stmt.all(bookId);
    },

    // 检查章节是否已缓存
    exists(bookId, chapterId) {
        const stmt = db.prepare("SELECT COUNT(*) as count FROM chapter_cache WHERE book_id = ? AND chapter_id = ?");
        const result = stmt.get(bookId, chapterId);
        return result.count > 0;
    },

    // 删除书籍的所有缓存
    deleteByBook(bookId) {
        const stmt = db.prepare("DELETE FROM chapter_cache WHERE book_id = ?");
        return stmt.run(bookId);
    },

    // 获取缓存统计信息
    getStats(bookId) {
        const stmt = db.prepare("SELECT COUNT(*) as count FROM chapter_cache WHERE book_id = ?");
        return stmt.get(bookId);
    }
};

// 书架数据库操作
const BookshelfDB = {
    // 获取用户书架
    getByUser(userId) {
        const stmt = db.prepare(`
            SELECT * FROM bookshelf 
            WHERE user_id = ? 
            ORDER BY CASE WHEN last_read_at IS NULL THEN 1 ELSE 0 END, last_read_at DESC, added_at DESC
        `);
        return stmt.all(userId);
    },

    // 检查书籍是否在书架中
    exists(userId, bookId) {
        const stmt = db.prepare("SELECT COUNT(*) as count FROM bookshelf WHERE user_id = ? AND book_id = ?");
        const result = stmt.get(userId, bookId);
        return result.count > 0;
    },

    // 添加到书架
    add(userId, bookId, title, author, cover, totalChapters) {
        const stmt = db.prepare(`
            INSERT INTO bookshelf (user_id, book_id, title, author, cover, total_chapters)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(userId, bookId, title, author, cover, totalChapters);
    },

    // 从书架移除
    remove(userId, bookId) {
        const stmt = db.prepare("DELETE FROM bookshelf WHERE user_id = ? AND book_id = ?");
        return stmt.run(userId, bookId);
    },

    // 更新阅读进度
    updateProgress(userId, bookId, currentChapter, totalChapters) {
        const stmt = db.prepare(`
            UPDATE bookshelf 
            SET current_chapter = ?, 
                total_chapters = ?,
                last_read_at = CURRENT_TIMESTAMP 
            WHERE user_id = ? AND book_id = ?
        `);
        return stmt.run(currentChapter, totalChapters, userId, bookId);
    },

    // 更新阅读时长
    updateReadingTime(userId, bookId, additionalMinutes) {
        const stmt = db.prepare(`
            UPDATE bookshelf 
            SET reading_time = reading_time + ?,
                last_read_at = CURRENT_TIMESTAMP 
            WHERE user_id = ? AND book_id = ?
        `);
        return stmt.run(additionalMinutes, userId, bookId);
    },

    // 获取单个书架项
    get(userId, bookId) {
        const stmt = db.prepare("SELECT * FROM bookshelf WHERE user_id = ? AND book_id = ?");
        return stmt.get(userId, bookId);
    }
};

// 阅读统计数据库操作（热力图）
const ReadingStatsDB = {
    // 更新今日阅读统计
    updateToday(userId, additionalMinutes) {
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        const stmt = db.prepare(`
            INSERT INTO reading_daily_stats (user_id, date, reading_minutes, books_read)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(user_id, date) DO UPDATE SET 
                reading_minutes = reading_minutes + ?,
                updated_at = CURRENT_TIMESTAMP
        `);
        return stmt.run(userId, today, additionalMinutes, additionalMinutes);
    },

    // 获取用户阅读统计（最近N天）
    getStats(userId, days = 365) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split("T")[0];

        const stmt = db.prepare(`
            SELECT date, reading_minutes, books_read, chapters_read
            FROM reading_daily_stats
            WHERE user_id = ? AND date >= ?
            ORDER BY date ASC
        `);
        return stmt.all(userId, startDateStr);
    },

    // 获取统计摘要
    getSummary(userId) {
        const stmt = db.prepare(`
            SELECT 
                COUNT(*) as total_days,
                SUM(reading_minutes) as total_minutes,
                MAX(reading_minutes) as max_minutes
            FROM reading_daily_stats
            WHERE user_id = ?
        `);
        return stmt.get(userId);
    },

    // 计算连续阅读天数
    getStreak(userId) {
        // 获取所有有阅读记录的日期
        const stmt = db.prepare(`
            SELECT date FROM reading_daily_stats
            WHERE user_id = ? AND reading_minutes > 0
            ORDER BY date DESC
        `);
        const dates = stmt.all(userId).map((r) => r.date);

        if (dates.length === 0) {
            return { current: 0, longest: 0 };
        }

        let currentStreak = 0;
        let longestStreak = 0;
        let tempStreak = 1;

        const today = new Date().toISOString().split("T")[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

        // 检查今天或昨天是否有阅读
        if (dates[0] === today || dates[0] === yesterday) {
            currentStreak = 1;

            for (let i = 1; i < dates.length; i++) {
                const prevDate = new Date(dates[i - 1]);
                const currDate = new Date(dates[i]);
                const diffDays = (prevDate - currDate) / (1000 * 60 * 60 * 24);

                if (diffDays === 1) {
                    currentStreak++;
                } else {
                    break;
                }
            }
        }

        // 计算最长连续
        for (let i = 1; i < dates.length; i++) {
            const prevDate = new Date(dates[i - 1]);
            const currDate = new Date(dates[i]);
            const diffDays = (prevDate - currDate) / (1000 * 60 * 60 * 24);

            if (diffDays === 1) {
                tempStreak++;
            } else {
                longestStreak = Math.max(longestStreak, tempStreak);
                tempStreak = 1;
            }
        }
        longestStreak = Math.max(longestStreak, tempStreak, currentStreak);

        return { current: currentStreak, longest: longestStreak };
    }
};

// 书籍订阅数据库操作
const SubscriptionDB = {
    // 订阅书籍
    subscribe(userId, bookId, title, author, cover, chapterCount) {
        const stmt = db.prepare(`
            INSERT INTO book_subscriptions (user_id, book_id, title, author, cover, last_chapter_count, last_checked_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, book_id) DO UPDATE SET
                title = ?,
                author = ?,
                cover = ?,
                last_chapter_count = ?,
                has_update = 0,
                last_checked_at = CURRENT_TIMESTAMP
        `);
        return stmt.run(userId, bookId, title, author, cover, chapterCount, title, author, cover, chapterCount);
    },

    // 取消订阅
    unsubscribe(userId, bookId) {
        const stmt = db.prepare("DELETE FROM book_subscriptions WHERE user_id = ? AND book_id = ?");
        return stmt.run(userId, bookId);
    },

    // 检查是否已订阅
    isSubscribed(userId, bookId) {
        const stmt = db.prepare("SELECT COUNT(*) as count FROM book_subscriptions WHERE user_id = ? AND book_id = ?");
        return stmt.get(userId, bookId).count > 0;
    },

    // 获取用户订阅列表
    getByUser(userId) {
        const stmt = db.prepare(`
            SELECT * FROM book_subscriptions 
            WHERE user_id = ? 
            ORDER BY has_update DESC, last_checked_at DESC
        `);
        return stmt.all(userId);
    },

    // 获取有更新的订阅
    getUpdated(userId) {
        const stmt = db.prepare(`
            SELECT * FROM book_subscriptions 
            WHERE user_id = ? AND has_update = 1
            ORDER BY last_checked_at DESC
        `);
        return stmt.all(userId);
    },

    // 标记为有更新
    markUpdate(bookId, newChapterCount) {
        const stmt = db.prepare(`
            UPDATE book_subscriptions 
            SET has_update = 1, last_chapter_count = ?
            WHERE book_id = ?
        `);
        return stmt.run(newChapterCount, bookId);
    },

    // 清除更新标记
    clearUpdate(userId, bookId) {
        const stmt = db.prepare(`
            UPDATE book_subscriptions 
            SET has_update = 0, last_checked_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND book_id = ?
        `);
        return stmt.run(userId, bookId);
    },

    // 获取所有需要检查更新的书籍
    getAllForCheck() {
        const stmt = db.prepare(`
            SELECT DISTINCT book_id, last_chapter_count 
            FROM book_subscriptions
        `);
        return stmt.all();
    },

    // 获取用户更新数量
    getUpdateCount(userId) {
        const stmt = db.prepare(
            "SELECT COUNT(*) as count FROM book_subscriptions WHERE user_id = ? AND has_update = 1"
        );
        return stmt.get(userId).count;
    }
};

module.exports = {
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
    ReadingStatsDB,
    SubscriptionDB
};
