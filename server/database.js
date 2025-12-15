/**
 * PO18小说下载网站 - 数据库模块
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

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
    const purchasedColumns = db.prepare("PRAGMA table_info(purchased_books)").all().map(c => c.name);
    if (!purchasedColumns.includes('status')) {
        console.log('正在迁移 purchased_books 表结构...');
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
        console.log('purchased_books 表迁移完成');
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(book_id, chapter_id)
        )
    `);
    
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chapter_cache_book_id ON chapter_cache(book_id);
        CREATE INDEX IF NOT EXISTS idx_chapter_cache_chapter_id ON chapter_cache(chapter_id);
    `);
    
    console.log('数据库初始化完成');
    
    // 数据库迁移 - 添加缺少的列
    try {
        // 检查并添加 users 表的新列
        const usersTableInfo = db.prepare("PRAGMA table_info(users)").all();
        const usersColumns = usersTableInfo.map(col => col.name);
        
        if (!usersColumns.includes('cache_auth')) {
            db.exec('ALTER TABLE users ADD COLUMN cache_auth INTEGER DEFAULT 0');
            console.log('迁移: 添加 users.cache_auth 列');
        }
        
        // 检查并添加 download_queue 表的新列
        const queueTableInfo = db.prepare("PRAGMA table_info(download_queue)").all();
        const queueColumns = queueTableInfo.map(col => col.name);
        
        if (!queueColumns.includes('file_size')) {
            db.exec('ALTER TABLE download_queue ADD COLUMN file_size TEXT');
            console.log('迁移: 添加 download_queue.file_size 列');
        }
        if (!queueColumns.includes('duration')) {
            db.exec('ALTER TABLE download_queue ADD COLUMN duration REAL');
            console.log('迁移: 添加 download_queue.duration 列');
        }
        if (!queueColumns.includes('webdav_path')) {
            db.exec('ALTER TABLE download_queue ADD COLUMN webdav_path TEXT');
            console.log('迁移: 添加 download_queue.webdav_path 列');
        }
        if (!queueColumns.includes('shared')) {
            db.exec('ALTER TABLE download_queue ADD COLUMN shared BOOLEAN DEFAULT 0');
            console.log('迁移: 添加 download_queue.shared 列');
        }
        
        // 检查并添加 book_metadata 表的新列
        const tableInfo = db.prepare("PRAGMA table_info(book_metadata)").all();
        const columns = tableInfo.map(col => col.name);
        
        if (!columns.includes('total_chapters')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN total_chapters INTEGER DEFAULT 0');
            console.log('迁移: 添加 total_chapters 列');
        }
        if (!columns.includes('subscribed_chapters')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN subscribed_chapters INTEGER DEFAULT 0');
            console.log('迁移: 添加 subscribed_chapters 列');
        }
        if (!columns.includes('category')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN category TEXT');
            console.log('迁移: 添加 category 列');
        }
        if (!columns.includes('word_count')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN word_count INTEGER DEFAULT 0');
            console.log('迁移: 添加 word_count 列');
        }
        if (!columns.includes('free_chapters')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN free_chapters INTEGER DEFAULT 0');
            console.log('迁移: 添加 free_chapters 列');
        }
        if (!columns.includes('paid_chapters')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN paid_chapters INTEGER DEFAULT 0');
            console.log('迁移: 添加 paid_chapters 列');
        }
        if (!columns.includes('status')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN status TEXT DEFAULT "unknown"');
            console.log('迁移: 添加 status 列');
        }
        if (!columns.includes('latest_chapter_name')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN latest_chapter_name TEXT');
            console.log('迁移: 添加 latest_chapter_name 列');
        }
        if (!columns.includes('latest_chapter_date')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN latest_chapter_date TEXT');
            console.log('迁移: 添加 latest_chapter_date 列');
        }
        if (!columns.includes('platform')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN platform TEXT DEFAULT "po18"');
            console.log('迁移: 添加 platform 列');
        }
        if (!columns.includes('favorites_count')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN favorites_count INTEGER DEFAULT 0');
            console.log('迁移: 添加 favorites_count 列');
        }
        if (!columns.includes('comments_count')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN comments_count INTEGER DEFAULT 0');
            console.log('迁移: 添加 comments_count 列');
        }
        if (!columns.includes('monthly_popularity')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN monthly_popularity INTEGER DEFAULT 0');
            console.log('迁移: 添加 monthly_popularity 列');
        }
        if (!columns.includes('total_popularity')) {
            db.exec('ALTER TABLE book_metadata ADD COLUMN total_popularity INTEGER DEFAULT 0');
            console.log('迁移: 添加 total_popularity 列');
        }
        
        // 检查并添加 shared_library 表的新列
        const sharedTableInfo = db.prepare("PRAGMA table_info(shared_library)").all();
        const sharedColumns = sharedTableInfo.map(col => col.name);
        
        if (sharedColumns.includes('webdav_path') && !sharedColumns.includes('file_path')) {
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
            console.log('迁移: shared_library.webdav_path -> file_path');
        } else if (!sharedColumns.includes('file_path')) {
            db.exec('ALTER TABLE shared_library ADD COLUMN file_path TEXT');
            console.log('迁移: 添加 shared_library.file_path 列');
        }
    } catch (migrateErr) {
        console.error('数据库迁移失败:', migrateErr.message);
    }
}

// 用户相关操作
const UserDB = {
    create(username, password) {
        const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
        return stmt.run(username, password);
    },
    
    findByUsername(username) {
        const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        return stmt.get(username);
    },
    
    findById(id) {
        const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
        return stmt.get(id);
    },
    
    updatePo18Cookie(userId, cookie) {
        const stmt = db.prepare('UPDATE users SET po18_cookie = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(cookie, userId);
    },
    
    updateWebDAVConfig(userId, config) {
        const stmt = db.prepare('UPDATE users SET webdav_config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(JSON.stringify(config), userId);
    },
    
    enableSharing(userId) {
        const stmt = db.prepare('UPDATE users SET share_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(userId);
    },
    
    disableSharing(userId) {
        const stmt = db.prepare('UPDATE users SET share_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(userId);
    },
    
    incrementSharedBooks(userId) {
        const stmt = db.prepare('UPDATE users SET shared_books_count = shared_books_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(userId);
    },
    
    // 启用云端缓存授权
    enableCacheAuth(userId) {
        const stmt = db.prepare('UPDATE users SET cache_auth = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(userId);
    },
    
    // 禁用云端缓存授权
    disableCacheAuth(userId) {
        const stmt = db.prepare('UPDATE users SET cache_auth = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(userId);
    },
    
    // 检查是否有云端缓存权限
    hasCacheAuth(userId) {
        const user = this.findById(userId);
        if (!user) return false;
        
        // admin用户始终有权限
        if (user.username === 'admin') {
            return true;
        }
        
        return user.cache_auth === 1;
    },
    
    canAccessSharedLibrary(userId) {
        const user = this.findById(userId);
        if (!user) return false;
        
        // admin用户始终有权限
        if (user.username === 'admin') {
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
        return stmt.run(userId, book.bookId, book.title, book.author, book.cover, book.tags, book.format, book.filePath, book.fileSize, book.chapterCount);
    },
    
    getByUser(userId) {
        const stmt = db.prepare('SELECT * FROM library WHERE user_id = ? ORDER BY downloaded_at DESC');
        return stmt.all(userId);
    },
    
    getByBookId(userId, bookId) {
        const stmt = db.prepare('SELECT * FROM library WHERE user_id = ? AND book_id = ?');
        return stmt.get(userId, bookId);
    },
    
    delete(userId, id) {
        const stmt = db.prepare('DELETE FROM library WHERE user_id = ? AND id = ?');
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
        const stmt = db.prepare('SELECT * FROM download_queue WHERE user_id = ? ORDER BY created_at DESC');
        return stmt.all(userId);
    },
    
    getById(id) {
        const stmt = db.prepare('SELECT * FROM download_queue WHERE id = ?');
        return stmt.get(id);
    },
    
    // 别名，与其他DB保持一致
    findById(id) {
        return this.getById(id);
    },
    
    getPending(userId) {
        const stmt = db.prepare("SELECT * FROM download_queue WHERE user_id = ? AND status = 'pending' ORDER BY created_at ASC");
        return stmt.all(userId);
    },
    
    updateStatus(id, status, extra = {}) {
        let sql = 'UPDATE download_queue SET status = ?';
        const params = [status];
        
        if (extra.progress !== undefined) {
            sql += ', progress = ?';
            params.push(extra.progress);
        }
        if (extra.totalChapters !== undefined) {
            sql += ', total_chapters = ?';
            params.push(extra.totalChapters);
        }
        if (extra.errorMessage !== undefined) {
            sql += ', error_message = ?';
            params.push(extra.errorMessage);
        }
        if (extra.fileSize !== undefined) {
            sql += ', file_size = ?';
            params.push(extra.fileSize);
        }
        if (extra.duration !== undefined) {
            sql += ', duration = ?';
            params.push(extra.duration);
        }
        if (extra.webdavPath !== undefined) {
            sql += ', webdav_path = ?';
            params.push(extra.webdavPath);
        }
        if (extra.shared !== undefined) {
            sql += ', shared = ?';
            params.push(extra.shared ? 1 : 0);
        }
        if (status === 'downloading') {
            sql += ', started_at = CURRENT_TIMESTAMP';
        }
        if (status === 'completed' || status === 'failed') {
            sql += ', completed_at = CURRENT_TIMESTAMP';
        }
        
        sql += ' WHERE id = ?';
        params.push(id);
        
        const stmt = db.prepare(sql);
        return stmt.run(...params);
    },
    
    delete(userId, id) {
        const stmt = db.prepare('DELETE FROM download_queue WHERE user_id = ? AND id = ?');
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
            book.status || '',
            book.buyTime || '',
            book.latestTime || '',
            book.availableChapters || 0,
            book.purchasedChapters || 0,
            book.year, 
            book.detailUrl
        );
    },
    
    getByUser(userId) {
        const stmt = db.prepare('SELECT * FROM purchased_books WHERE user_id = ? ORDER BY year DESC, cached_at DESC');
        return stmt.all(userId);
    },
    
    clearByUser(userId) {
        const stmt = db.prepare('DELETE FROM purchased_books WHERE user_id = ?');
        return stmt.run(userId);
    }
};

// 共享书库相关操作
const SharedDB = {
    add(userId, book) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO shared_library 
            (user_id, book_id, title, author, cover, tags, format, file_path, file_size, chapter_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(userId, book.bookId, book.title, book.author, book.cover, book.tags, book.format, book.filePath, book.fileSize, book.chapterCount);
    },
    
    getAll() {
        const stmt = db.prepare(`
            SELECT sl.*, u.username as uploader_name 
            FROM shared_library sl 
            LEFT JOIN users u ON sl.user_id = u.id 
            ORDER BY sl.shared_at DESC
        `);
        return stmt.all();
    },
    
    search(keyword) {
        const stmt = db.prepare(`
            SELECT sl.*, u.username as uploader_name 
            FROM shared_library sl 
            LEFT JOIN users u ON sl.user_id = u.id 
            WHERE sl.title LIKE ? OR sl.author LIKE ? OR sl.tags LIKE ?
            ORDER BY sl.download_count DESC, sl.shared_at DESC
        `);
        const pattern = `%${keyword}%`;
        return stmt.all(pattern, pattern, pattern);
    },
    
    incrementDownload(id) {
        const stmt = db.prepare('UPDATE shared_library SET download_count = download_count + 1 WHERE id = ?');
        return stmt.run(id);
    },
    
    getByBookId(bookId) {
        const stmt = db.prepare(`
            SELECT sl.*, u.username as uploader_name 
            FROM shared_library sl 
            LEFT JOIN users u ON sl.user_id = u.id 
            WHERE sl.book_id = ?
        `);
        return stmt.all(bookId);
    },
    
    getById(id) {
        const stmt = db.prepare(`
            SELECT sl.*, u.username as uploader_name 
            FROM shared_library sl 
            LEFT JOIN users u ON sl.user_id = u.id 
            WHERE sl.id = ?
        `);
        return stmt.get(id);
    },
    
    delete(id) {
        const stmt = db.prepare('DELETE FROM shared_library WHERE id = ?');
        return stmt.run(id);
    },
    
    deleteByBookId(bookId) {
        const stmt = db.prepare('DELETE FROM shared_library WHERE book_id = ?');
        return stmt.run(bookId);
    },
    
    // 清理所有文件不存在的记录
    cleanupMissingFiles() {
        const allBooks = this.getAll();
        let deletedCount = 0;
        
        for (const book of allBooks) {
            if (!book.file_path || !fs.existsSync(book.file_path)) {
                this.delete(book.id);
                deletedCount++;
                console.log(`已删除不存在的共享书籍: ${book.title} (${book.file_path || '无路径'})`);
            }
        }
        
        return deletedCount;
    }
};

// 下载历史相关操作
const HistoryDB = {
    add(userId, record) {
        // 先检查是否已经存在相同的下载记录（同一本书、同一格式）
        const existing = db.prepare(
            'SELECT id FROM download_history WHERE user_id = ? AND book_id = ? AND format = ? ORDER BY downloaded_at DESC LIMIT 1'
        ).get(userId, record.bookId, record.format);
        
        // 如果存在且是最近一小时内的记录，则更新而不是新增
        if (existing) {
            const existingRecord = db.prepare('SELECT * FROM download_history WHERE id = ?').get(existing.id);
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
        return stmt.run(userId, record.bookId, record.title, record.author, record.format, record.fileSize, record.duration, record.chapterCount);
    },
    
    getByUser(userId, limit = 50) {
        const stmt = db.prepare('SELECT * FROM download_history WHERE user_id = ? ORDER BY downloaded_at DESC LIMIT ?');
        return stmt.all(userId, limit);
    },
    
    clear(userId) {
        const stmt = db.prepare('DELETE FROM download_history WHERE user_id = ?');
        return stmt.run(userId);
    }
};

// 书籍元信息缓存操作 - 支持多版本
const BookMetadataDB = {
    // 添加或更新书籍信息（根据已订阅章节数区分版本）
    upsert(book) {
        try {
            // 先查找是否存在相同版本
            const existing = db.prepare(
                'SELECT id FROM book_metadata WHERE book_id = ? AND subscribed_chapters = ?'
            ).get(book.bookId, book.subscribedChapters || 0);
            
            if (existing) {
                // 更新现有记录
                const updateStmt = db.prepare(`
                    UPDATE book_metadata SET
                        title = ?, author = ?, cover = ?, description = ?, tags = ?,
                        category = ?, word_count = ?, free_chapters = ?, paid_chapters = ?, total_chapters = ?, status = ?,
                        latest_chapter_name = ?, latest_chapter_date = ?, platform = ?,
                        favorites_count = ?, comments_count = ?, monthly_popularity = ?, total_popularity = ?,
                        detail_url = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `);
                return updateStmt.run(
                    book.title,
                    book.author || '',
                    book.cover || '',
                    book.description || '',
                    book.tags || '',
                    book.category || '',
                    book.wordCount || 0,
                    book.freeChapters || 0,
                    book.paidChapters || 0,
                    book.totalChapters || 0,
                    book.status || 'unknown',
                    book.latestChapterName || '',
                    book.latestChapterDate || '',
                    book.platform || 'po18',
                    book.favoritesCount || 0,
                    book.commentsCount || 0,
                    book.monthlyPopularity || 0,
                    book.totalPopularity || 0,
                    book.detailUrl || '',
                    existing.id
                );
            } else {
                // 检查是否存在相同book_id的记录（旧数据库可能只有book_id索引）
                const existingByBookId = db.prepare(
                    'SELECT id, subscribed_chapters FROM book_metadata WHERE book_id = ?'
                ).get(book.bookId);
                
                if (existingByBookId) {
                    // 如果已存在相同book_id但不同版本，更新该记录
                    const updateStmt = db.prepare(`
                        UPDATE book_metadata SET
                            title = ?, author = ?, cover = ?, description = ?, tags = ?,
                            category = ?, word_count = ?, free_chapters = ?, paid_chapters = ?, total_chapters = ?, status = ?,
                            latest_chapter_name = ?, latest_chapter_date = ?, platform = ?,
                            favorites_count = ?, comments_count = ?, monthly_popularity = ?, total_popularity = ?,
                            detail_url = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `);
                    return updateStmt.run(
                        book.title,
                        book.author || '',
                        book.cover || '',
                        book.description || '',
                        book.tags || '',
                        book.category || '',
                        book.wordCount || 0,
                        book.freeChapters || 0,
                        book.paidChapters || 0,
                        book.totalChapters || 0,
                        book.status || 'unknown',
                        book.latestChapterName || '',
                        book.latestChapterDate || '',
                        book.platform || 'po18',
                        book.favoritesCount || 0,
                        book.commentsCount || 0,
                        book.monthlyPopularity || 0,
                        book.totalPopularity || 0,
                        book.detailUrl || '',
                        existingByBookId.id
                    );
                }
                
                // 插入新记录
                const insertStmt = db.prepare(`
                    INSERT INTO book_metadata 
                    (book_id, title, author, cover, description, tags, category, word_count, free_chapters, paid_chapters, total_chapters, subscribed_chapters, status, latest_chapter_name, latest_chapter_date, platform, favorites_count, comments_count, monthly_popularity, total_popularity, detail_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                return insertStmt.run(
                    book.bookId,
                    book.title,
                    book.author || '',
                    book.cover || '',
                    book.description || '',
                    book.tags || '',
                    book.category || '',
                    book.wordCount || 0,
                    book.freeChapters || 0,
                    book.paidChapters || 0,
                    book.totalChapters || 0,
                    book.subscribedChapters || 0,
                    book.status || 'unknown',
                    book.latestChapterName || '',
                    book.latestChapterDate || '',
                    book.platform || 'po18',
                    book.favoritesCount || 0,
                    book.commentsCount || 0,
                    book.monthlyPopularity || 0,
                    book.totalPopularity || 0,
                    book.detailUrl || ''
                );
            }
        } catch (err) {
            console.error('BookMetadataDB.upsert 失败:', err.message);
            throw err;
        }
    },
    
    // 根据书籍ID获取所有版本
    findByBookId(bookId) {
        const stmt = db.prepare('SELECT * FROM book_metadata WHERE book_id = ? ORDER BY subscribed_chapters DESC');
        return stmt.all(bookId);
    },
    
    // 获取单个版本
    get(bookId) {
        const stmt = db.prepare('SELECT * FROM book_metadata WHERE book_id = ? ORDER BY subscribed_chapters DESC LIMIT 1');
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
            const conditions = keywords.map(() => 
                '(title LIKE ? OR author LIKE ? OR tags LIKE ? OR book_id LIKE ?)'
            ).join(' AND ');
            
            const stmt = db.prepare(`
                SELECT * FROM book_metadata 
                WHERE ${conditions}
                ORDER BY book_id, subscribed_chapters DESC
            `);
            
            const params = [];
            keywords.forEach(kw => {
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
        const stmt = db.prepare('SELECT * FROM book_metadata WHERE category LIKE ? ORDER BY updated_at DESC');
        return stmt.all(`%${category}%`);
    },
    
    // 根据标签获取
    getByTag(tag) {
        const stmt = db.prepare('SELECT * FROM book_metadata WHERE tags LIKE ? ORDER BY updated_at DESC');
        return stmt.all(`%${tag}%`);
    },
    
    // 获取所有分类和标签
    getAllTagsAndCategories() {
        const books = db.prepare('SELECT tags, category FROM book_metadata').all();
        const tags = new Set();
        const categories = new Set();
        
        books.forEach(book => {
            if (book.tags) {
                book.tags.split('·').forEach(t => t.trim() && tags.add(t.trim()));
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
        const stmt = db.prepare('SELECT DISTINCT book_id FROM book_metadata ORDER BY book_id');
        return stmt.all().map(row => row.book_id);
    },
    
    // 排行榜查询
    getRankings(type, limit = 100) {
        let orderBy = 'updated_at DESC';
        
        switch(type) {
            case 'favorites':
                orderBy = 'favorites_count DESC, updated_at DESC';
                break;
            case 'comments':
                orderBy = 'comments_count DESC, updated_at DESC';
                break;
            case 'monthly':
                orderBy = 'monthly_popularity DESC, updated_at DESC';
                break;
            case 'total':
                orderBy = 'total_popularity DESC, updated_at DESC';
                break;
            case 'wordcount':
                orderBy = 'word_count DESC, updated_at DESC';
                break;
            case 'latest':
                orderBy = 'latest_chapter_date DESC, updated_at DESC';
                break;
            default:
                orderBy = 'updated_at DESC';
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
        return stmt.run(userId, config.name, config.url, config.username, config.password, config.basePath || '/', config.isDefault ? 1 : 0, 1);
    },
    
    // 获取用户所有配置
    getAll(userId) {
        const stmt = db.prepare('SELECT * FROM webdav_configs WHERE user_id = ? ORDER BY is_default DESC, created_at ASC');
        return stmt.all(userId);
    },
    
    // 获取用户启用的配置
    getEnabled(userId) {
        const stmt = db.prepare('SELECT * FROM webdav_configs WHERE user_id = ? AND is_enabled = 1 ORDER BY is_default DESC, created_at ASC');
        return stmt.all(userId);
    },
    
    // 获取默认配置
    getDefault(userId) {
        const stmt = db.prepare('SELECT * FROM webdav_configs WHERE user_id = ? AND is_default = 1 LIMIT 1');
        let config = stmt.get(userId);
        if (!config) {
            // 如果没有默认配置，返回第一个
            const allStmt = db.prepare('SELECT * FROM webdav_configs WHERE user_id = ? ORDER BY created_at ASC LIMIT 1');
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
        return stmt.run(config.name, config.url, config.username, config.password, config.basePath, config.isDefault ? 1 : 0, config.isEnabled ? 1 : 0, id);
    },
    
    // 设置为默认
    setDefault(userId, id) {
        db.prepare('UPDATE webdav_configs SET is_default = 0 WHERE user_id = ?').run(userId);
        db.prepare('UPDATE webdav_configs SET is_default = 1 WHERE id = ?').run(id);
    },
    
    // 切换启用状态
    toggleEnabled(id) {
        const stmt = db.prepare('UPDATE webdav_configs SET is_enabled = NOT is_enabled WHERE id = ?');
        return stmt.run(id);
    },
    
    // 删除配置
    delete(id) {
        const stmt = db.prepare('DELETE FROM webdav_configs WHERE id = ?');
        return stmt.run(id);
    }
};

// 章节缓存数据库操作
const ChapterCacheDB = {
    // 获取缓存的章节内容
    get(bookId, chapterId) {
        const stmt = db.prepare('SELECT * FROM chapter_cache WHERE book_id = ? AND chapter_id = ?');
        return stmt.get(bookId, chapterId);
    },
    
    // 保存章节内容
    save(bookId, chapterId, title, html, text) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO chapter_cache (book_id, chapter_id, title, html, text, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        return stmt.run(bookId, chapterId, title, html, text);
    },
    
    // 批量保存章节
    saveBatch(chapters) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO chapter_cache (book_id, chapter_id, title, html, text, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const insert = db.transaction((items) => {
            for (const item of items) {
                stmt.run(item.bookId, item.chapterId, item.title, item.html, item.text);
            }
        });
        
        return insert(chapters);
    },
    
    // 获取书籍的所有缓存章节
    getByBook(bookId) {
        const stmt = db.prepare('SELECT * FROM chapter_cache WHERE book_id = ? ORDER BY chapter_id ASC');
        return stmt.all(bookId);
    },
    
    // 检查章节是否已缓存
    exists(bookId, chapterId) {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM chapter_cache WHERE book_id = ? AND chapter_id = ?');
        const result = stmt.get(bookId, chapterId);
        return result.count > 0;
    },
    
    // 删除书籍的所有缓存
    deleteByBook(bookId) {
        const stmt = db.prepare('DELETE FROM chapter_cache WHERE book_id = ?');
        return stmt.run(bookId);
    },
    
    // 获取缓存统计信息
    getStats(bookId) {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM chapter_cache WHERE book_id = ?');
        return stmt.get(bookId);
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
    ChapterCacheDB
};