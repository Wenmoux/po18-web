/*
 * File: database.js
 * Input: better-sqlite3, config.js, logger.js
 * Output: 数据库实例和所有数据表的CRUD操作类（UserDB, LibraryDB, QueueDB等）
 * Pos: 数据持久化层，封装所有SQLite数据库操作，管理用户、书库、队列、订阅等数据
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

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

    // 系统配置表
    db.exec(`
        CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
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

    // 书架分类表
    db.exec(`
        CREATE TABLE IF NOT EXISTS bookshelf_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            color TEXT,
            icon TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, name)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_bookshelf_categories_user_id ON bookshelf_categories(user_id);
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
            category_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (category_id) REFERENCES bookshelf_categories(id) ON DELETE SET NULL,
            UNIQUE(user_id, book_id)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_bookshelf_user_id ON bookshelf(user_id);
        CREATE INDEX IF NOT EXISTS idx_bookshelf_last_read ON bookshelf(last_read_at);
    `);
    
    // 迁移：为现有bookshelf表添加category_id字段（如果不存在）
    try {
        // 检查字段是否已存在
        const tableInfo = db.prepare("PRAGMA table_info(bookshelf)").all();
        const hasCategoryId = tableInfo.some(col => col.name === 'category_id');
        
        if (!hasCategoryId) {
            db.exec(`ALTER TABLE bookshelf ADD COLUMN category_id INTEGER`);
            logger.info('已为bookshelf表添加category_id字段');
        }
        
        // 创建category_id索引（如果字段存在）
        if (hasCategoryId || !hasCategoryId) { // 无论是否新添加，都尝试创建索引
            try {
                db.exec(`CREATE INDEX IF NOT EXISTS idx_bookshelf_category_id ON bookshelf(category_id)`);
            } catch (e) {
                // 索引可能已存在，忽略错误
                logger.debug('创建category_id索引时出错（可能已存在）', { error: e.message });
            }
        }
    } catch (e) {
        // 字段已存在或其他错误，记录日志
        logger.warn('处理category_id字段时出错', { error: e.message });
        // 即使出错，也尝试创建索引（字段可能已存在）
        try {
            db.exec(`CREATE INDEX IF NOT EXISTS idx_bookshelf_category_id ON bookshelf(category_id)`);
        } catch (e2) {
            logger.debug('创建category_id索引失败', { error: e2.message });
        }
    }

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

    // 书单表
    db.exec(`
        CREATE TABLE IF NOT EXISTS book_lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            cover TEXT,
            is_public INTEGER DEFAULT 1,
            book_count INTEGER DEFAULT 0,
            collect_count INTEGER DEFAULT 0,
            view_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 书单书籍关联表
    db.exec(`
        CREATE TABLE IF NOT EXISTS book_list_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            title TEXT NOT NULL,
            author TEXT,
            cover TEXT,
            note TEXT,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (list_id) REFERENCES book_lists(id) ON DELETE CASCADE,
            UNIQUE(list_id, book_id)
        )
    `);

    // 书单收藏表
    db.exec(`
        CREATE TABLE IF NOT EXISTS book_list_collects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (list_id) REFERENCES book_lists(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(list_id, user_id)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_book_lists_user ON book_lists(user_id);
        CREATE INDEX IF NOT EXISTS idx_book_lists_public ON book_lists(is_public);
        CREATE INDEX IF NOT EXISTS idx_book_list_items_list ON book_list_items(list_id);
        CREATE INDEX IF NOT EXISTS idx_book_list_collects_user ON book_list_collects(user_id);
        CREATE INDEX IF NOT EXISTS idx_book_list_collects_list ON book_list_collects(list_id);
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

    // 纠错记录表
    db.exec(`
        CREATE TABLE IF NOT EXISTS corrections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            original_text TEXT NOT NULL,
            corrected_text TEXT NOT NULL,
            status TEXT DEFAULT 'pending', -- pending/approved/rejected
            reviewer_id INTEGER,
            review_time DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_corrections_user ON corrections(user_id);
        CREATE INDEX IF NOT EXISTS idx_corrections_status ON corrections(status);
        CREATE INDEX IF NOT EXISTS idx_corrections_book ON corrections(book_id);
    `);

    // 书评表
    db.exec(`
        CREATE TABLE IF NOT EXISTS book_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT NOT NULL,
            book_title TEXT,
            book_cover TEXT,
            book_author TEXT,
            rating INTEGER DEFAULT 5,
            content TEXT NOT NULL,
            likes INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 书评点赞记录表
    db.exec(`
        CREATE TABLE IF NOT EXISTS review_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            review_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(review_id, user_id),
            FOREIGN KEY (review_id) REFERENCES book_reviews(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_reviews_user ON book_reviews(user_id);
        CREATE INDEX IF NOT EXISTS idx_reviews_book ON book_reviews(book_id);
        CREATE INDEX IF NOT EXISTS idx_reviews_rating ON book_reviews(rating);
        CREATE INDEX IF NOT EXISTS idx_reviews_created ON book_reviews(created_at);
        CREATE INDEX IF NOT EXISTS idx_review_likes_review ON review_likes(review_id);
        CREATE INDEX IF NOT EXISTS idx_review_likes_user ON review_likes(user_id);
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON book_subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_update ON book_subscriptions(has_update);
        CREATE INDEX IF NOT EXISTS idx_user_actions_user_id ON user_actions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_actions_action ON user_actions(action);
        CREATE INDEX IF NOT EXISTS idx_user_actions_created_at ON user_actions(created_at);
    `);

    // ==================== 游戏系统表 ====================
    // 用户游戏数据表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_game_data (
            user_id INTEGER PRIMARY KEY,
            level INTEGER DEFAULT 1,
            exp INTEGER DEFAULT 0,
            total_read_words INTEGER DEFAULT 0,
            total_read_time INTEGER DEFAULT 0,
            last_read_time DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 碎片背包表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_fragments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            fragment_type TEXT NOT NULL,
            fragment_id TEXT NOT NULL,
            quantity INTEGER DEFAULT 1,
            obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, fragment_type, fragment_id)
        )
    `);

    // 道具背包表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            item_type TEXT NOT NULL,
            item_id TEXT NOT NULL,
            quantity INTEGER DEFAULT 1,
            obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, item_type, item_id)
        )
    `);

    // 功法表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_techniques (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            technique_id TEXT NOT NULL,
            level INTEGER DEFAULT 1,
            exp INTEGER DEFAULT 0,
            is_equipped INTEGER DEFAULT 0,
            unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, technique_id)
        )
    `);

    // 阅读记录表（用于计算奖励）
    db.exec(`
        CREATE TABLE IF NOT EXISTS reading_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT,
            chapter_id TEXT,
            words_read INTEGER DEFAULT 0,
            reading_time INTEGER DEFAULT 0,
            fragments_obtained TEXT,
            exp_gained INTEGER DEFAULT 0,
            session_start DATETIME,
            session_end DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 签到表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_daily_signin (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            signin_date DATE NOT NULL,
            consecutive_days INTEGER DEFAULT 1,
            reward_exp INTEGER DEFAULT 0,
            reward_items TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, signin_date)
        )
    `);

    // 成就表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            achievement_id TEXT NOT NULL,
            achievement_type TEXT NOT NULL,
            progress INTEGER DEFAULT 0,
            target INTEGER DEFAULT 1,
            completed INTEGER DEFAULT 0,
            completed_at DATETIME,
            reward_claimed INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, achievement_id)
        )
    `);

    // 每日任务表
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_daily_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            task_id TEXT NOT NULL,
            task_type TEXT NOT NULL,
            task_name TEXT NOT NULL,
            task_desc TEXT,
            progress INTEGER DEFAULT 0,
            target INTEGER DEFAULT 1,
            reward_exp INTEGER DEFAULT 0,
            reward_items TEXT,
            difficulty TEXT DEFAULT 'easy',
            completed INTEGER DEFAULT 0,
            completed_at DATETIME,
            task_date DATE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, task_id, task_date)
        )
    `);

    // 游戏配置表（后台可修改）
    db.exec(`
        CREATE TABLE IF NOT EXISTS game_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            config_key TEXT NOT NULL UNIQUE,
            config_value TEXT NOT NULL,
            config_desc TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 阅读会话记录表（防刷机制）
    db.exec(`
        CREATE TABLE IF NOT EXISTS reading_session_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            book_id TEXT,
            chapter_id TEXT,
            words_read INTEGER DEFAULT 0,
            reading_time INTEGER DEFAULT 0,
            session_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(session_hash)
        )
    `);

    // 藏品模板表（后台配置，定义所有可获得的藏品）
    db.exec(`
        CREATE TABLE IF NOT EXISTS collection_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            quality TEXT NOT NULL DEFAULT 'common',
            rarity INTEGER NOT NULL DEFAULT 1,
            max_quantity INTEGER NOT NULL DEFAULT 0,
            current_quantity INTEGER DEFAULT 0,
            drop_rate REAL NOT NULL DEFAULT 0.01,
            effect_type TEXT,
            effect_value TEXT,
            effect_description TEXT,
            allowed_book_ids TEXT,
            allowed_categories TEXT,
            icon TEXT,
            color TEXT,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 用户藏品表（每个藏品有唯一ID，服务器生成）
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id TEXT NOT NULL UNIQUE,
            template_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            obtained_from_book_id TEXT,
            obtained_from_chapter_id TEXT,
            is_tradable INTEGER DEFAULT 1,
            transaction_id TEXT,
            FOREIGN KEY (template_id) REFERENCES collection_templates(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // 藏品交易记录表（为后期交易功能准备）
    db.exec(`
        CREATE TABLE IF NOT EXISTS collection_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id TEXT NOT NULL UNIQUE,
            collection_id TEXT NOT NULL,
            from_user_id INTEGER,
            to_user_id INTEGER NOT NULL,
            transaction_type TEXT NOT NULL,
            price INTEGER,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            FOREIGN KEY (collection_id) REFERENCES user_collections(collection_id),
            FOREIGN KEY (from_user_id) REFERENCES users(id),
            FOREIGN KEY (to_user_id) REFERENCES users(id)
        )
    `);

    // 游戏系统索引
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_fragments_user ON user_fragments(user_id);
        CREATE INDEX IF NOT EXISTS idx_items_user ON user_items(user_id);
        CREATE INDEX IF NOT EXISTS idx_techniques_user ON user_techniques(user_id);
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_user ON reading_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_time ON reading_sessions(session_start);
        CREATE INDEX IF NOT EXISTS idx_signin_user_date ON user_daily_signin(user_id, signin_date);
        CREATE INDEX IF NOT EXISTS idx_achievements_user ON user_achievements(user_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON user_daily_tasks(user_id, task_date);
        CREATE INDEX IF NOT EXISTS idx_session_logs_hash ON reading_session_logs(session_hash);
        CREATE INDEX IF NOT EXISTS idx_session_logs_user_time ON reading_session_logs(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_collections_user ON user_collections(user_id);
        CREATE INDEX IF NOT EXISTS idx_collections_template ON user_collections(template_id);
        CREATE INDEX IF NOT EXISTS idx_collections_id ON user_collections(collection_id);
        CREATE INDEX IF NOT EXISTS idx_collection_templates_active ON collection_templates(is_active);
        CREATE INDEX IF NOT EXISTS idx_collection_transactions_id ON collection_transactions(transaction_id);
    `);

    // 初始化游戏配置默认值
    const defaultConfigs = [
        { key: "fragment_drop_rate", value: "0.3", desc: "碎片基础掉落率（0-1）" },
        { key: "fragment_drop_rate_with_pill", value: "0.5", desc: "使用悟道丹后的碎片掉落率" },
        { key: "min_reading_time_per_1000_words", value: "30", desc: "每1000字最少阅读时间（秒）" },
        { key: "max_words_per_request", value: "5000", desc: "单次请求最大字数" },
        { key: "min_reading_time_ratio", value: "0.5", desc: "最小阅读时间比例（阅读时间/字数*1000，秒/千字）" },
        { key: "collection_drop_rate_base", value: "0.05", desc: "藏品基础掉落率（0-1），每1000字" },
        { key: "collection_drop_interval_words", value: "1000", desc: "藏品掉落检查间隔（字数）" }
    ];
    
    defaultConfigs.forEach(config => {
        const existing = db.prepare("SELECT * FROM game_config WHERE config_key = ?").get(config.key);
        if (!existing) {
            db.prepare("INSERT INTO game_config (config_key, config_value, config_desc) VALUES (?, ?, ?)")
                .run(config.key, config.value, config.desc);
        }
    });

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

        // 用户积分字段
        if (!usersColumns.includes("points")) {
            db.exec("ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0");
            console.log("迁移: 添加 users.points 列");
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
        
        // 添加 weekly_popularity 列（周人气）
        if (!columns.includes("weekly_popularity")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN weekly_popularity INTEGER DEFAULT 0");
            console.log("迁移: 添加 weekly_popularity 列");
        }
        
        // 添加 readers_count 列（阅读人数）
        if (!columns.includes("readers_count")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN readers_count INTEGER DEFAULT 0");
            console.log("迁移: 添加 readers_count 列");
        }
        
        // 添加 daily_popularity 列（日人气）
        if (!columns.includes("daily_popularity")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN daily_popularity INTEGER DEFAULT 0");
            console.log("迁移: 添加 daily_popularity 列");
        }
        
        // 添加 purchase_count 列（POPO订购数）
        if (!columns.includes("purchase_count")) {
            db.exec("ALTER TABLE book_metadata ADD COLUMN purchase_count INTEGER DEFAULT 0");
            console.log("迁移: 添加 purchase_count 列");
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
                        favorites_count = ?, comments_count = ?, monthly_popularity = ?, weekly_popularity = ?, daily_popularity = ?, total_popularity = ?, purchase_count = ?, readers_count = ?,
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
                    book.weeklyPopularity || 0,
                    book.dailyPopularity || 0,
                    book.totalPopularity || 0,
                    book.purchaseCount || 0,
                    book.readersCount || 0,
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
                            favorites_count = ?, comments_count = ?, monthly_popularity = ?, weekly_popularity = ?, daily_popularity = ?, total_popularity = ?, purchase_count = ?, readers_count = ?,
                            detail_url = ?, uploader = ?, uploaderId = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `);
                    return updateStmt.run(
                        book.title,
                        book.author || "",
                        book.cover || "",
                        book.descriptionHTML || book.description || "",
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
                        book.weeklyPopularity || 0,
                        book.dailyPopularity || 0,
                        book.totalPopularity || 0,
                        book.purchaseCount || 0,
                        book.readersCount || 0,
                        book.detailUrl || "",
                        book.uploader || "unknown_user",
                        book.uploaderId || "unknown",
                        existingByBookId.id
                    );
                }

                // 插入新记录
                const insertStmt = db.prepare(`
                    INSERT INTO book_metadata 
                    (book_id, title, author, cover, description, tags, category, word_count, free_chapters, paid_chapters, total_chapters, subscribed_chapters, status, latest_chapter_name, latest_chapter_date, platform, favorites_count, comments_count, monthly_popularity, weekly_popularity, daily_popularity, total_popularity, purchase_count, readers_count, detail_url, uploader, uploaderId)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                return insertStmt.run(
                    book.bookId,
                    book.title,
                    book.author || "",
                    book.cover || "",
                    book.descriptionHTML || book.description || "",
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
                    book.weeklyPopularity || 0,
                    book.dailyPopularity || 0,
                    book.totalPopularity || 0,
                    book.purchaseCount || 0,
                    book.readersCount || 0,
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
        const stmt = db.prepare(`
            SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon
            FROM bookshelf b
            LEFT JOIN bookshelf_categories c ON b.category_id = c.id
            WHERE b.user_id = ? AND b.book_id = ?
        `);
        return stmt.get(userId, bookId);
    },
    
    // 更新书籍分类
    updateCategory(userId, bookId, categoryId) {
        const stmt = db.prepare(`
            UPDATE bookshelf 
            SET category_id = ? 
            WHERE user_id = ? AND book_id = ?
        `);
        return stmt.run(categoryId || null, userId, bookId);
    },
    
    // 批量更新分类
    batchUpdateCategory(userId, bookIds, categoryId) {
        const placeholders = bookIds.map(() => '?').join(',');
        const stmt = db.prepare(`
            UPDATE bookshelf 
            SET category_id = ? 
            WHERE user_id = ? AND book_id IN (${placeholders})
        `);
        return stmt.run(categoryId || null, userId, ...bookIds);
    }
};

// 书架分类数据库操作
const BookshelfCategoryDB = {
    // 获取用户的所有分类
    getByUser(userId) {
        const stmt = db.prepare(`
            SELECT * FROM bookshelf_categories 
            WHERE user_id = ? 
            ORDER BY sort_order ASC, created_at ASC
        `);
        return stmt.all(userId);
    },
    
    // 创建分类
    create(userId, name, color, icon, sortOrder) {
        const stmt = db.prepare(`
            INSERT INTO bookshelf_categories (user_id, name, color, icon, sort_order)
            VALUES (?, ?, ?, ?, ?)
        `);
        return stmt.run(userId, name, color || null, icon || null, sortOrder || 0);
    },
    
    // 更新分类
    update(categoryId, userId, name, color, icon, sortOrder) {
        const stmt = db.prepare(`
            UPDATE bookshelf_categories 
            SET name = ?, color = ?, icon = ?, sort_order = ?
            WHERE id = ? AND user_id = ?
        `);
        return stmt.run(name, color || null, icon || null, sortOrder || 0, categoryId, userId);
    },
    
    // 删除分类
    delete(categoryId, userId) {
        // 先检查是否有书籍使用此分类
        const countStmt = db.prepare(`
            SELECT COUNT(*) as count FROM bookshelf 
            WHERE category_id = ? AND user_id = ?
        `);
        const count = countStmt.get(categoryId, userId).count;
        
        if (count > 0) {
            // 将使用此分类的书籍分类设为NULL
            const updateStmt = db.prepare(`
                UPDATE bookshelf 
                SET category_id = NULL 
                WHERE category_id = ? AND user_id = ?
            `);
            updateStmt.run(categoryId, userId);
        }
        
        // 删除分类
        const deleteStmt = db.prepare(`
            DELETE FROM bookshelf_categories 
            WHERE id = ? AND user_id = ?
        `);
        return deleteStmt.run(categoryId, userId);
    },
    
    // 获取单个分类
    get(categoryId, userId) {
        const stmt = db.prepare(`
            SELECT * FROM bookshelf_categories 
            WHERE id = ? AND user_id = ?
        `);
        return stmt.get(categoryId, userId);
    },
    
    // 检查分类名称是否已存在
    exists(userId, name, excludeId = null) {
        let stmt;
        if (excludeId) {
            stmt = db.prepare(`
                SELECT COUNT(*) as count FROM bookshelf_categories 
                WHERE user_id = ? AND name = ? AND id != ?
            `);
            return stmt.get(userId, name, excludeId).count > 0;
        } else {
            stmt = db.prepare(`
                SELECT COUNT(*) as count FROM bookshelf_categories 
                WHERE user_id = ? AND name = ?
            `);
            return stmt.get(userId, name).count > 0;
        }
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

// 书单数据库操作
const BookListDB = {
    // 创建书单
    create(userId, name, description = '', cover = '', isPublic = 1) {
        const stmt = db.prepare(`
            INSERT INTO book_lists (user_id, name, description, cover, is_public)
            VALUES (?, ?, ?, ?, ?)
        `);
        const result = stmt.run(userId, name, description, cover, isPublic);
        return result.lastInsertRowid;
    },

    // 获取用户的书单列表
    getByUser(userId) {
        const stmt = db.prepare(`
            SELECT * FROM book_lists 
            WHERE user_id = ? 
            ORDER BY updated_at DESC
        `);
        return stmt.all(userId);
    },

    // 获取单个书单详情
    getById(listId) {
        const stmt = db.prepare('SELECT * FROM book_lists WHERE id = ?');
        return stmt.get(listId);
    },

    // 更新书单
    update(listId, userId, name, description, cover, isPublic) {
        const stmt = db.prepare(`
            UPDATE book_lists 
            SET name = ?, description = ?, cover = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
        `);
        return stmt.run(name, description, cover, isPublic, listId, userId);
    },

    // 删除书单
    delete(listId, userId) {
        const stmt = db.prepare('DELETE FROM book_lists WHERE id = ? AND user_id = ?');
        return stmt.run(listId, userId);
    },

    // 添加书籍到书单
    addBook(listId, bookId, title, author, cover, note = '') {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO book_list_items (list_id, book_id, title, author, cover, note)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(listId, bookId, title, author, cover, note);
        
        if (result.changes > 0) {
            // 更新书单的书籍数量
            db.prepare('UPDATE book_lists SET book_count = book_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(listId);
        }
        
        return result.changes > 0;
    },

    // 从书单移除书籍
    removeBook(listId, bookId) {
        const stmt = db.prepare('DELETE FROM book_list_items WHERE list_id = ? AND book_id = ?');
        const result = stmt.run(listId, bookId);
        
        if (result.changes > 0) {
            db.prepare('UPDATE book_lists SET book_count = book_count - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(listId);
        }
        
        return result.changes > 0;
    },

    // 获取书单中的书籍
    getBooks(listId) {
        const stmt = db.prepare(`
            SELECT * FROM book_list_items 
            WHERE list_id = ? 
            ORDER BY added_at DESC
        `);
        return stmt.all(listId);
    },

    // 获取公开的书单广场（按热度排序）
    getPublicLists(page = 1, pageSize = 20, sortBy = 'hot') {
        const offset = (page - 1) * pageSize;
        let orderBy = 'view_count DESC'; // 默认按热度
        
        if (sortBy === 'new') {
            orderBy = 'created_at DESC';
        } else if (sortBy === 'collect') {
            orderBy = 'collect_count DESC';
        }
        
        const stmt = db.prepare(`
            SELECT bl.*, u.username as creator_name
            FROM book_lists bl
            LEFT JOIN users u ON bl.user_id = u.id
            WHERE bl.is_public = 1
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `);
        return stmt.all(pageSize, offset);
    },

    // 搜索书单
    search(keyword, page = 1, pageSize = 20) {
        const offset = (page - 1) * pageSize;
        const stmt = db.prepare(`
            SELECT bl.*, u.username as creator_name
            FROM book_lists bl
            LEFT JOIN users u ON bl.user_id = u.id
            WHERE bl.is_public = 1 AND (bl.name LIKE ? OR bl.description LIKE ?)
            ORDER BY bl.view_count DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(`%${keyword}%`, `%${keyword}%`, pageSize, offset);
    },

    // 增加浏览量
    incrementViewCount(listId) {
        const stmt = db.prepare('UPDATE book_lists SET view_count = view_count + 1 WHERE id = ?');
        return stmt.run(listId);
    },

    // 收藏书单
    collect(listId, userId) {
        try {
            const stmt = db.prepare('INSERT INTO book_list_collects (list_id, user_id) VALUES (?, ?)');
            const result = stmt.run(listId, userId);
            
            if (result.changes > 0) {
                db.prepare('UPDATE book_lists SET collect_count = collect_count + 1 WHERE id = ?').run(listId);
            }
            
            return result.changes > 0;
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT') {
                return false; // 已经收藏过
            }
            throw error;
        }
    },

    // 取消收藏
    uncollect(listId, userId) {
        const stmt = db.prepare('DELETE FROM book_list_collects WHERE list_id = ? AND user_id = ?');
        const result = stmt.run(listId, userId);
        
        if (result.changes > 0) {
            db.prepare('UPDATE book_lists SET collect_count = collect_count - 1 WHERE id = ?').run(listId);
        }
        
        return result.changes > 0;
    },

    // 检查是否已收藏
    isCollected(listId, userId) {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM book_list_collects WHERE list_id = ? AND user_id = ?');
        return stmt.get(listId, userId).count > 0;
    },

    // 获取用户收藏的书单
    getCollectedLists(userId) {
        const stmt = db.prepare(`
            SELECT bl.*, u.username as creator_name
            FROM book_lists bl
            INNER JOIN book_list_collects blc ON bl.id = blc.list_id
            LEFT JOIN users u ON bl.user_id = u.id
            WHERE blc.user_id = ?
            ORDER BY blc.collected_at DESC
        `);
        return stmt.all(userId);
    }
};

// 书单评论数据库操作
const BookListCommentDB = {
    // 创建评论表
    init() {
        db.exec(`
            CREATE TABLE IF NOT EXISTS book_list_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                list_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                rating INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (list_id) REFERENCES book_lists(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
    },

    // 添加评论
    addComment(listId, userId, content, rating = null) {
        const stmt = db.prepare(`
            INSERT INTO book_list_comments (list_id, user_id, content, rating)
            VALUES (?, ?, ?, ?)
        `);
        return stmt.run(listId, userId, content, rating);
    },

    // 获取书单的评论
    getComments(listId, page = 1, pageSize = 20) {
        const offset = (page - 1) * pageSize;
        const stmt = db.prepare(`
            SELECT blc.*, u.username as user_name
            FROM book_list_comments blc
            LEFT JOIN users u ON blc.user_id = u.id
            WHERE blc.list_id = ?
            ORDER BY blc.created_at DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(listId, pageSize, offset);
    },

    // 获取书单的平均评分
    getAverageRating(listId) {
        const stmt = db.prepare('SELECT AVG(rating) as avg_rating FROM book_list_comments WHERE list_id = ? AND rating IS NOT NULL');
        const result = stmt.get(listId);
        return result.avg_rating ? parseFloat(result.avg_rating.toFixed(1)) : null;
    },

    // 获取书单的评论数量
    getCommentCount(listId) {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM book_list_comments WHERE list_id = ?');
        return stmt.get(listId).count;
    },

    // 删除评论
    deleteComment(commentId, userId) {
        const stmt = db.prepare('DELETE FROM book_list_comments WHERE id = ? AND user_id = ?');
        return stmt.run(commentId, userId);
    }
};

// 初始化书单评论表
BookListCommentDB.init();

// ==================== 游戏系统数据库操作 ====================
const GameDB = {
    // 获取或创建用户游戏数据
    getUserGameData(userId) {
        let data = db.prepare("SELECT * FROM user_game_data WHERE user_id = ?").get(userId);
        if (!data) {
            // 创建初始数据
            db.prepare("INSERT INTO user_game_data (user_id, level, exp) VALUES (?, 1, 0)").run(userId);
            data = db.prepare("SELECT * FROM user_game_data WHERE user_id = ?").get(userId);
        }
        return data;
    },

    // 更新用户游戏数据
    updateUserGameData(userId, updates) {
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(updates)) {
            if (key !== "user_id") {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }
        values.push(userId);
        const sql = `UPDATE user_game_data SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`;
        return db.prepare(sql).run(...values);
    },

    /**
     * 计算达到指定等级所需的总修为（动态算法）
     * @param {number} level - 目标等级（1-80，每个境界10层）
     * @returns {number} 所需总修为
     */
    getExpRequiredForLevel(level) {
        if (level <= 1) return 0;
        
        let totalExp = 0;
        // 每个境界有10层，共8个境界（80级）
        for (let l = 1; l < level; l++) {
            const realmIndex = Math.floor((l - 1) / 10); // 境界索引（0-7）
            const layerInRealm = ((l - 1) % 10) + 1; // 境界内的层数（1-10）
            
            // 每个境界的基础修为需求（指数增长）
            // 炼气期: 1000, 筑基期: 2000, 金丹期: 4000, 元婴期: 8000...
            const baseExp = 1000 * Math.pow(2, realmIndex);
            
            // 每层递增：第1层=1.0倍，第2层=1.1倍，第3层=1.2倍...第10层=1.9倍
            const layerMultiplier = 1 + (layerInRealm - 1) * 0.1;
            
            // 当前层所需修为
            const expForThisLevel = Math.floor(baseExp * layerMultiplier);
            totalExp += expForThisLevel;
        }
        
        return totalExp;
    },

    /**
     * 根据总修为计算当前等级
     * @param {number} totalExp - 总修为
     * @returns {number} 当前等级
     */
    getLevelFromExp(totalExp) {
        if (totalExp <= 0) return 1;
        
        // 使用二分查找提高效率
        let left = 1;
        let right = 80;
        let level = 1;
        
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const expRequired = this.getExpRequiredForLevel(mid + 1);
            
            if (totalExp < expRequired) {
                level = mid;
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        
        return Math.min(level, 80); // 最高等级80
    },

    /**
     * 获取当前等级到下一级所需修为
     * @param {number} level - 当前等级
     * @returns {number} 所需修为
     */
    getExpToNextLevel(level) {
        if (level >= 80) return 0; // 已满级
        
        const expForCurrent = this.getExpRequiredForLevel(level);
        const expForNext = this.getExpRequiredForLevel(level + 1);
        return expForNext - expForCurrent;
    },

    // 增加修为
    addExp(userId, exp) {
        const data = this.getUserGameData(userId);
        const newExp = data.exp + exp;
        const oldLevel = data.level;
        
        // 使用动态算法计算新等级
        const newLevel = this.getLevelFromExp(newExp);
        
        // 检查是否升级
        const leveledUp = newLevel > oldLevel;
        
        this.updateUserGameData(userId, { exp: newExp, level: newLevel });
        return { 
            exp: newExp, 
            level: newLevel, 
            leveledUp, 
            oldLevel 
        };
    },

    // 增加阅读字数
    addReadWords(userId, words) {
        const data = this.getUserGameData(userId);
        const newWords = data.total_read_words + words;
        this.updateUserGameData(userId, { total_read_words: newWords });
        return newWords;
    },

    // 增加阅读时长
    addReadTime(userId, seconds) {
        const data = this.getUserGameData(userId);
        const newTime = data.total_read_time + seconds;
        this.updateUserGameData(userId, { total_read_time: newTime, last_read_time: new Date().toISOString() });
        return newTime;
    },

    // 添加碎片
    addFragment(userId, fragmentType, fragmentId, quantity = 1) {
        const existing = db
            .prepare("SELECT * FROM user_fragments WHERE user_id = ? AND fragment_type = ? AND fragment_id = ?")
            .get(userId, fragmentType, fragmentId);
        if (existing) {
            const stmt = db.prepare(
                "UPDATE user_fragments SET quantity = quantity + ? WHERE user_id = ? AND fragment_type = ? AND fragment_id = ?"
            );
            return stmt.run(quantity, userId, fragmentType, fragmentId);
        } else {
            const stmt = db.prepare(
                "INSERT INTO user_fragments (user_id, fragment_type, fragment_id, quantity) VALUES (?, ?, ?, ?)"
            );
            return stmt.run(userId, fragmentType, fragmentId, quantity);
        }
    },

    // 获取用户所有碎片
    getUserFragments(userId) {
        return db.prepare("SELECT * FROM user_fragments WHERE user_id = ? ORDER BY fragment_type, fragment_id").all(userId);
    },

    // 合成碎片（收集10个解锁对应物品）
    synthesizeFragment(userId, fragmentType, fragmentId) {
        const fragment = db
            .prepare("SELECT * FROM user_fragments WHERE user_id = ? AND fragment_type = ? AND fragment_id = ?")
            .get(userId, fragmentType, fragmentId);
        
        if (!fragment || fragment.quantity < 10) {
            return { success: false, message: "碎片不足，需要10个" };
        }

        // 扣除10个碎片
        const newQuantity = fragment.quantity - 10;
        if (newQuantity === 0) {
            db.prepare("DELETE FROM user_fragments WHERE user_id = ? AND fragment_type = ? AND fragment_id = ?").run(userId, fragmentType, fragmentId);
        } else {
            db.prepare("UPDATE user_fragments SET quantity = ? WHERE user_id = ? AND fragment_type = ? AND fragment_id = ?").run(newQuantity, userId, fragmentType, fragmentId);
        }

        // 根据碎片类型解锁对应物品
        if (fragmentType === "technique") {
            // 解锁功法
            this.unlockTechnique(userId, fragmentId);
            return { success: true, type: "technique", itemId: fragmentId, message: `成功解锁功法：${fragmentId}` };
        } else if (fragmentType === "pill") {
            // 获得对应丹药
            this.addItem(userId, "pill", fragmentId, 5); // 合成获得5个丹药
            return { success: true, type: "pill", itemId: fragmentId, message: `成功合成丹药：${fragmentId} ×5` };
        } else if (fragmentType === "artifact") {
            // 获得对应法宝
            this.addItem(userId, "artifact", fragmentId, 1);
            return { success: true, type: "artifact", itemId: fragmentId, message: `成功合成法宝：${fragmentId}` };
        } else if (fragmentType === "beast") {
            // 解锁灵兽（暂时作为道具）
            this.addItem(userId, "beast", fragmentId, 1);
            return { success: true, type: "beast", itemId: fragmentId, message: `成功解锁灵兽：${fragmentId}` };
        }

        return { success: false, message: "未知的碎片类型" };
    },

    // 添加道具
    addItem(userId, itemType, itemId, quantity = 1) {
        const existing = db.prepare("SELECT * FROM user_items WHERE user_id = ? AND item_type = ? AND item_id = ?").get(userId, itemType, itemId);
        if (existing) {
            const stmt = db.prepare("UPDATE user_items SET quantity = quantity + ? WHERE user_id = ? AND item_type = ? AND item_id = ?");
            return stmt.run(quantity, userId, itemType, itemId);
        } else {
            const stmt = db.prepare("INSERT INTO user_items (user_id, item_type, item_id, quantity) VALUES (?, ?, ?, ?)");
            return stmt.run(userId, itemType, itemId, quantity);
        }
    },

    // 使用道具
    useItem(userId, itemType, itemId, quantity = 1) {
        const existing = db.prepare("SELECT * FROM user_items WHERE user_id = ? AND item_type = ? AND item_id = ?").get(userId, itemType, itemId);
        if (!existing || existing.quantity < quantity) {
            return false;
        }
        if (existing.quantity === quantity) {
            db.prepare("DELETE FROM user_items WHERE user_id = ? AND item_type = ? AND item_id = ?").run(userId, itemType, itemId);
        } else {
            db.prepare("UPDATE user_items SET quantity = quantity - ? WHERE user_id = ? AND item_type = ? AND item_id = ?").run(quantity, userId, itemType, itemId);
        }
        return true;
    },

    // 获取用户所有道具
    getUserItems(userId) {
        return db.prepare("SELECT * FROM user_items WHERE user_id = ? ORDER BY item_type, item_id").all(userId);
    },

    // 解锁功法
    unlockTechnique(userId, techniqueId) {
        const existing = db.prepare("SELECT * FROM user_techniques WHERE user_id = ? AND technique_id = ?").get(userId, techniqueId);
        if (!existing) {
            const stmt = db.prepare("INSERT INTO user_techniques (user_id, technique_id, level, exp) VALUES (?, ?, 1, 0)");
            return stmt.run(userId, techniqueId);
        }
        return null;
    },

    // 装备/卸下功法（只能装备一个，装备新功法时自动卸下其他）
    toggleTechniqueEquip(userId, techniqueId) {
        const technique = db.prepare("SELECT * FROM user_techniques WHERE user_id = ? AND technique_id = ?").get(userId, techniqueId);
        if (!technique) return false;
        
        const newEquip = technique.is_equipped ? 0 : 1;
        
        // 如果装备新功法，先卸下所有其他功法
        if (newEquip === 1) {
            db.prepare("UPDATE user_techniques SET is_equipped = 0 WHERE user_id = ?").run(userId);
        }
        
        // 设置当前功法状态
        db.prepare("UPDATE user_techniques SET is_equipped = ? WHERE user_id = ? AND technique_id = ?").run(newEquip, userId, techniqueId);
        return newEquip === 1;
    },

    // 获取用户所有功法
    getUserTechniques(userId) {
        return db.prepare("SELECT * FROM user_techniques WHERE user_id = ? ORDER BY is_equipped DESC, unlocked_at DESC").all(userId);
    },

    // 记录阅读会话
    recordReadingSession(userId, sessionData) {
        const stmt = db.prepare(`
            INSERT INTO reading_sessions 
            (user_id, book_id, chapter_id, words_read, reading_time, fragments_obtained, exp_gained, session_start, session_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            userId,
            sessionData.bookId || null,
            sessionData.chapterId || null,
            sessionData.wordsRead || 0,
            sessionData.readingTime || 0,
            JSON.stringify(sessionData.fragmentsObtained || []),
            sessionData.expGained || 0,
            sessionData.sessionStart || new Date().toISOString(),
            sessionData.sessionEnd || new Date().toISOString()
        );
    },

    // ==================== 签到系统 ====================
    
    // 获取签到信息
    getSigninInfo(userId) {
        const today = new Date().toISOString().split('T')[0];
        const todaySignin = db.prepare("SELECT * FROM user_daily_signin WHERE user_id = ? AND signin_date = ?").get(userId, today);
        
        // 获取最近一次签到
        const lastSignin = db.prepare(`
            SELECT * FROM user_daily_signin 
            WHERE user_id = ? 
            ORDER BY signin_date DESC 
            LIMIT 1
        `).get(userId);
        
        // 获取本月签到记录
        const thisMonth = new Date().toISOString().substring(0, 7);
        const monthSignins = db.prepare(`
            SELECT signin_date, consecutive_days, reward_exp 
            FROM user_daily_signin 
            WHERE user_id = ? AND signin_date LIKE ?
            ORDER BY signin_date
        `).all(userId, `${thisMonth}%`);
        
        return {
            todaySigned: !!todaySignin,
            consecutiveDays: lastSignin ? lastSignin.consecutive_days : 0,
            monthSignins: monthSignins.map(s => s.signin_date),
            lastSigninDate: lastSignin ? lastSignin.signin_date : null
        };
    },

    // 签到
    signin(userId) {
        const today = new Date().toISOString().split('T')[0];
        
        // 检查今天是否已签到
        const todaySignin = db.prepare("SELECT * FROM user_daily_signin WHERE user_id = ? AND signin_date = ?").get(userId, today);
        if (todaySignin) {
            return { success: false, message: "今天已经签到过了" };
        }
        
        // 获取最近一次签到
        const lastSignin = db.prepare(`
            SELECT * FROM user_daily_signin 
            WHERE user_id = ? 
            ORDER BY signin_date DESC 
            LIMIT 1
        `).get(userId);
        
        // 计算连续天数
        let consecutiveDays = 1;
        if (lastSignin) {
            const lastDate = new Date(lastSignin.signin_date);
            const todayDate = new Date(today);
            const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 1) {
                // 连续签到
                consecutiveDays = lastSignin.consecutive_days + 1;
            } else if (diffDays > 1) {
                // 中断了，重新开始
                consecutiveDays = 1;
            }
        }
        
        // 计算奖励
        let rewardExp = 50;
        const rewardItems = [];
        
        if (consecutiveDays >= 3) {
            rewardExp = 100;
            rewardItems.push({ type: "fragment", id: "随机碎片", quantity: 1 });
        }
        if (consecutiveDays >= 7) {
            rewardExp = 200;
            rewardItems.push({ type: "item", id: "聚灵丹", quantity: 1 });
        }
        if (consecutiveDays >= 15) {
            rewardExp = 500;
            rewardItems.push({ type: "item", id: "回神丹", quantity: 1 });
        }
        if (consecutiveDays >= 30) {
            rewardExp = 1000;
            rewardItems.push({ type: "title", id: "签到达人", quantity: 1 });
        }
        
        // 插入签到记录
        const stmt = db.prepare(`
            INSERT INTO user_daily_signin 
            (user_id, signin_date, consecutive_days, reward_exp, reward_items)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(userId, today, consecutiveDays, rewardExp, JSON.stringify(rewardItems));
        
        // 发放奖励
        this.addExp(userId, rewardExp);
        rewardItems.forEach(item => {
            if (item.type === "fragment") {
                const types = ["technique", "pill", "artifact", "beast"];
                const type = types[Math.floor(Math.random() * types.length)];
                const names = {
                    technique: ["清心诀", "凝神诀", "悟道诀", "静心诀"],
                    pill: ["回神丹", "悟道丹", "清心丹", "聚灵丹"],
                    artifact: ["书签法宝", "护眼法宝", "记忆法宝", "专注法宝"],
                    beast: ["灵狐", "仙鹤", "神龙", "凤凰"]
                };
                const id = names[type][Math.floor(Math.random() * names[type].length)];
                this.addFragment(userId, type, id, item.quantity);
            } else if (item.type === "item") {
                this.addItem(userId, "pill", item.id, item.quantity);
            }
        });
        
        return {
            success: true,
            consecutiveDays,
            rewardExp,
            rewardItems
        };
    },

    // ==================== 成就系统 ====================
    
    // 获取或初始化成就
    getOrInitAchievement(userId, achievementId, achievementType, target) {
        let achievement = db.prepare(`
            SELECT * FROM user_achievements 
            WHERE user_id = ? AND achievement_id = ?
        `).get(userId, achievementId);
        
        if (!achievement) {
            db.prepare(`
                INSERT INTO user_achievements 
                (user_id, achievement_id, achievement_type, target)
                VALUES (?, ?, ?, ?)
            `).run(userId, achievementId, achievementType, target);
            achievement = db.prepare(`
                SELECT * FROM user_achievements 
                WHERE user_id = ? AND achievement_id = ?
            `).get(userId, achievementId);
        }
        
        return achievement;
    },

    // 更新成就进度
    updateAchievementProgress(userId, achievementId, progress) {
        // 根据成就ID确定类型和目标值
        const achievementConfig = {
            // 阅读相关成就
            "read_10k": { type: "reading", target: 10000 },
            "read_100k": { type: "reading", target: 100000 },
            "read_1m": { type: "reading", target: 1000000 },
            "read_10m": { type: "reading", target: 10000000 },
            "read_7days": { type: "reading", target: 7 },
            "read_30days": { type: "reading", target: 30 },
            "read_50k_day": { type: "reading", target: 50000 },
            // 境界相关成就
            "realm_qi": { type: "realm", target: 1 },
            "realm_zhu": { type: "realm", target: 1 },
            "realm_jin": { type: "realm", target: 1 },
            "realm_yuan": { type: "realm", target: 1 },
            "realm_hua": { type: "realm", target: 1 },
            "level_10": { type: "level", target: 10 },
            "level_20": { type: "level", target: 20 },
            "level_30": { type: "level", target: 30 },
            "level_50": { type: "level", target: 50 },
            "level_80": { type: "level", target: 80 },
            // 碎片道具相关成就
            "fragments_100": { type: "collection", target: 100 },
            "techniques_10": { type: "collection", target: 10 },
            "items_50": { type: "collection", target: 50 },
            // 共享相关成就
            "share_1": { type: "sharing", target: 1 },
            "share_10": { type: "sharing", target: 10 },
            "share_50": { type: "sharing", target: 50 },
            "share_100": { type: "sharing", target: 100 },
            // 纠错相关成就
            "correction_1": { type: "correction", target: 1 },
            "correction_10": { type: "correction", target: 10 },
            "correction_50": { type: "correction", target: 50 },
            "correction_100": { type: "correction", target: 100 },
            // 藏品相关成就
            "collection_1": { type: "collection", target: 1 },
            "collection_5": { type: "collection", target: 5 },
            "collection_10": { type: "collection", target: 10 },
            "collection_20": { type: "collection", target: 20 },
            // 特殊成就
            "realm_5_day": { type: "special", target: 5 },
            "exp_1000": { type: "special", target: 1000 },
            "fragments_3": { type: "special", target: 3 }
        };
        
        const config = achievementConfig[achievementId] || { type: "reading", target: 1 };
        const achievement = this.getOrInitAchievement(userId, achievementId, config.type, config.target);
        if (achievement.completed) return achievement;
        
        const newProgress = Math.max(achievement.progress, progress);
        const completed = newProgress >= achievement.target ? 1 : 0;
        
        db.prepare(`
            UPDATE user_achievements 
            SET progress = ?, completed = ?, completed_at = ?
            WHERE user_id = ? AND achievement_id = ?
        `).run(
            newProgress,
            completed,
            completed ? new Date().toISOString() : null,
            userId,
            achievementId
        );
        
        return { ...achievement, progress: newProgress, completed: completed === 1 };
    },

    // 领取成就奖励
    claimAchievementReward(userId, achievementId) {
        const achievement = db.prepare(`
            SELECT * FROM user_achievements 
            WHERE user_id = ? AND achievement_id = ?
        `).get(userId, achievementId);
        
        if (!achievement || !achievement.completed || achievement.reward_claimed) {
            return { success: false, message: "成就未完成或已领取" };
        }
        
        // 根据成就ID计算奖励
        const rewards = this.getAchievementReward(achievementId);
        
        // 发放奖励
        if (rewards.exp > 0) {
            this.addExp(userId, rewards.exp);
        }
        if (rewards.items) {
            rewards.items.forEach(item => {
                this.addItem(userId, item.type, item.id, item.quantity);
            });
        }
        
        // 标记已领取
        db.prepare(`
            UPDATE user_achievements 
            SET reward_claimed = 1 
            WHERE user_id = ? AND achievement_id = ?
        `).run(userId, achievementId);
        
        return { success: true, rewards };
    },

    // 获取成就奖励配置
    getAchievementReward(achievementId) {
        const rewards = {
            // 阅读相关成就奖励
            "read_10k": { exp: 100, items: [] },
            "read_100k": { exp: 500, items: [{ type: "pill", id: "聚灵丹", quantity: 1 }] },
            "read_1m": { exp: 2000, items: [{ type: "pill", id: "回神丹", quantity: 3 }] },
            "read_10m": { exp: 10000, items: [{ type: "pill", id: "悟道丹", quantity: 5 }] },
            "read_7days": { exp: 300, items: [] },
            "read_30days": { exp: 1000, items: [{ type: "pill", id: "清心丹", quantity: 2 }] },
            "read_50k_day": { exp: 500, items: [] },
            // 境界相关成就奖励
            "realm_qi": { exp: 200, items: [] },
            "realm_zhu": { exp: 500, items: [] },
            "realm_jin": { exp: 1000, items: [] },
            "realm_yuan": { exp: 2000, items: [] },
            "realm_hua": { exp: 5000, items: [] },
            "level_10": { exp: 300, items: [] },
            "level_20": { exp: 800, items: [{ type: "pill", id: "聚灵丹", quantity: 2 }] },
            "level_30": { exp: 1500, items: [{ type: "pill", id: "回神丹", quantity: 2 }] },
            "level_50": { exp: 3000, items: [{ type: "pill", id: "悟道丹", quantity: 3 }] },
            "level_80": { exp: 8000, items: [{ type: "pill", id: "悟道丹", quantity: 10 }] },
            // 碎片道具相关成就奖励
            "fragments_100": { exp: 800, items: [] },
            "techniques_10": { exp: 1000, items: [] },
            "items_50": { exp: 1500, items: [] },
            // 共享相关成就奖励
            "share_1": { exp: 50, items: [] },
            "share_10": { exp: 200, items: [] },
            "share_50": { exp: 500, items: [{ type: "pill", id: "聚灵丹", quantity: 1 }] },
            "share_100": { exp: 1000, items: [{ type: "pill", id: "回神丹", quantity: 2 }] },
            // 纠错相关成就奖励
            "correction_1": { exp: 30, items: [] },
            "correction_10": { exp: 150, items: [] },
            "correction_50": { exp: 400, items: [] },
            "correction_100": { exp: 800, items: [{ type: "pill", id: "清心丹", quantity: 1 }] },
            // 藏品相关成就奖励
            "collection_1": { exp: 100, items: [] },
            "collection_5": { exp: 300, items: [] },
            "collection_10": { exp: 600, items: [{ type: "pill", id: "聚灵丹", quantity: 1 }] },
            "collection_20": { exp: 1200, items: [{ type: "pill", id: "回神丹", quantity: 2 }] },
            // 特殊成就奖励
            "realm_5_day": { exp: 2000, items: [] },
            "exp_1000": { exp: 500, items: [] },
            "fragments_3": { exp: 200, items: [] }
        };
        return rewards[achievementId] || { exp: 100, items: [] };
    },

    // 获取所有成就
    getAllAchievements(userId) {
        return db.prepare(`
            SELECT * FROM user_achievements 
            WHERE user_id = ? 
            ORDER BY completed DESC, created_at
        `).all(userId);
    },

    // ==================== 每日任务系统 ====================
    
    // 生成每日任务
    generateDailyTasks(userId, date) {
        const dateStr = date || new Date().toISOString().split('T')[0];
        
        // 检查今天是否已生成任务
        const existing = db.prepare(`
            SELECT COUNT(*) as count FROM user_daily_tasks 
            WHERE user_id = ? AND task_date = ?
        `).get(userId, dateStr);
        
        if (existing.count > 0) {
            return db.prepare(`
                SELECT * FROM user_daily_tasks 
                WHERE user_id = ? AND task_date = ?
                ORDER BY difficulty, created_at
            `).all(userId, dateStr);
        }
        
        // 任务模板
        const taskTemplates = [
            { id: "read_5k", type: "reading", name: "阅读5000字", desc: "今日阅读5000字", target: 5000, reward: 50, difficulty: "easy" },
            { id: "read_30min", type: "reading", name: "阅读30分钟", desc: "今日阅读30分钟", target: 1800, reward: 30, difficulty: "easy" },
            { id: "read_chapter", type: "reading", name: "完成1个章节", desc: "完成阅读1个章节", target: 1, reward: 20, difficulty: "easy" },
            { id: "use_item", type: "cultivation", name: "使用1个道具", desc: "使用任意道具1次", target: 1, reward: 20, difficulty: "easy" },
            { id: "equip_technique", type: "cultivation", name: "装备功法阅读", desc: "装备功法并阅读", target: 1, reward: 30, difficulty: "easy" },
            { id: "synthesize_fragment", type: "cultivation", name: "合成1个碎片", desc: "合成任意碎片", target: 1, reward: 50, difficulty: "medium" },
            { id: "read_10k", type: "challenge", name: "单次阅读1万字", desc: "单次阅读达到1万字", target: 10000, reward: 100, difficulty: "hard" },
            { id: "get_5_fragments", type: "challenge", name: "获得5个碎片", desc: "今日获得5个碎片", target: 5, reward: 80, difficulty: "medium" },
            { id: "level_up", type: "challenge", name: "提升1个境界", desc: "提升任意境界", target: 1, reward: 200, difficulty: "hard" }
        ];
        
        // 随机选择3-5个任务
        const selectedTasks = [];
        const shuffled = [...taskTemplates].sort(() => Math.random() - 0.5);
        const count = 3 + Math.floor(Math.random() * 3); // 3-5个任务
        
        for (let i = 0; i < count && i < shuffled.length; i++) {
            const template = shuffled[i];
            const stmt = db.prepare(`
                INSERT INTO user_daily_tasks 
                (user_id, task_id, task_type, task_name, task_desc, target, reward_exp, difficulty, task_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(
                userId,
                template.id,
                template.type,
                template.name,
                template.desc,
                template.target,
                template.reward,
                template.difficulty,
                dateStr
            );
            selectedTasks.push({
                task_id: template.id,
                task_type: template.type,
                task_name: template.name,
                task_desc: template.desc,
                target: template.target,
                reward_exp: template.reward,
                difficulty: template.difficulty,
                progress: 0,
                completed: 0
            });
        }
        
        return selectedTasks;
    },

    // 获取每日任务
    getDailyTasks(userId, date) {
        const dateStr = date || new Date().toISOString().split('T')[0];
        
        // 确保任务已生成
        this.generateDailyTasks(userId, dateStr);
        
        return db.prepare(`
            SELECT * FROM user_daily_tasks 
            WHERE user_id = ? AND task_date = ?
            ORDER BY difficulty, created_at
        `).all(userId, dateStr);
    },

    // 更新任务进度
    updateTaskProgress(userId, taskType, progress, date) {
        const dateStr = date || new Date().toISOString().split('T')[0];
        const tasks = db.prepare(`
            SELECT * FROM user_daily_tasks 
            WHERE user_id = ? AND task_date = ? AND task_type = ? AND completed = 0
        `).all(userId, dateStr, taskType);
        
        const updatedTasks = [];
        tasks.forEach(task => {
            let newProgress = task.progress;
            
            // 根据任务ID更新进度
            if (task.task_id === "read_5k" || task.task_id === "read_10k") {
                newProgress = Math.min(task.progress + (progress.wordsRead || 0), task.target);
            } else if (task.task_id === "read_30min") {
                newProgress = Math.min(task.progress + (progress.readingTime || 0), task.target);
            } else if (task.task_id === "read_chapter") {
                newProgress = Math.min(task.progress + (progress.chaptersRead || 0), task.target);
            } else if (task.task_id === "use_item") {
                newProgress = Math.min(task.progress + (progress.itemsUsed || 0), task.target);
            } else if (task.task_id === "equip_technique") {
                if (progress.techniqueEquipped) newProgress = Math.min(task.progress + 1, task.target);
            } else if (task.task_id === "synthesize_fragment") {
                newProgress = Math.min(task.progress + (progress.fragmentsSynthesized || 0), task.target);
            } else if (task.task_id === "get_5_fragments") {
                newProgress = Math.min(task.progress + (progress.fragmentsObtained || 0), task.target);
            } else if (task.task_id === "level_up") {
                if (progress.leveledUp) newProgress = Math.min(task.progress + 1, task.target);
            }
            
            const completed = newProgress >= task.target ? 1 : 0;
            
            db.prepare(`
                UPDATE user_daily_tasks 
                SET progress = ?, completed = ?, completed_at = ?
                WHERE id = ?
            `).run(
                newProgress,
                completed,
                completed ? new Date().toISOString() : null,
                task.id
            );
            
            // 如果完成，发放奖励
            if (completed && !task.completed) {
                this.addExp(userId, task.reward_exp);
                updatedTasks.push({ ...task, progress: newProgress, completed: 1, reward: task.reward_exp });
            }
        });
        
        return updatedTasks;
    },

    // 领取任务奖励（已完成的任务）
    claimTaskReward(userId, taskId, date) {
        const dateStr = date || new Date().toISOString().split('T')[0];
        const task = db.prepare(`
            SELECT * FROM user_daily_tasks 
            WHERE user_id = ? AND task_id = ? AND task_date = ?
        `).get(userId, taskId, dateStr);
        
        if (!task || !task.completed) {
            return { success: false, message: "任务未完成" };
        }
        
        // 奖励已在完成时发放，这里只是标记
        return { success: true, reward: task.reward_exp };
    },

    // ==================== 游戏配置管理 ====================
    
    // 获取游戏配置
    getGameConfig(configKey, defaultValue = null) {
        const config = db.prepare("SELECT * FROM game_config WHERE config_key = ?").get(configKey);
        if (!config) return defaultValue;
        
        // 尝试转换为数字
        const numValue = parseFloat(config.config_value);
        if (!isNaN(numValue) && isFinite(numValue)) {
            return numValue;
        }
        return config.config_value;
    },

    // 获取所有游戏配置
    getAllGameConfigs() {
        return db.prepare("SELECT * FROM game_config ORDER BY config_key").all();
    },

    // 更新游戏配置
    updateGameConfig(configKey, configValue, configDesc = null) {
        const existing = db.prepare("SELECT * FROM game_config WHERE config_key = ?").get(configKey);
        if (existing) {
            if (configDesc) {
                db.prepare(`
                    UPDATE game_config 
                    SET config_value = ?, config_desc = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE config_key = ?
                `).run(configValue, configDesc, configKey);
            } else {
                db.prepare(`
                    UPDATE game_config 
                    SET config_value = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE config_key = ?
                `).run(configValue, configKey);
            }
        } else {
            db.prepare(`
                INSERT INTO game_config (config_key, config_value, config_desc) 
                VALUES (?, ?, ?)
            `).run(configKey, configValue, configDesc || "");
        }
        return { success: true };
    },

    // ==================== 防刷机制 ====================
    
    // 生成会话哈希（用于防重复提交）
    generateSessionHash(userId, bookId, chapterId, wordsRead, timestamp) {
        const crypto = require('crypto');
        const hashString = `${userId}_${bookId}_${chapterId}_${wordsRead}_${timestamp}`;
        return crypto.createHash('md5').update(hashString).digest('hex');
    },

    // 检查会话是否已存在（防重复提交）
    checkSessionExists(sessionHash) {
        const existing = db.prepare("SELECT * FROM reading_session_logs WHERE session_hash = ?").get(sessionHash);
        return !!existing;
    },

    // 记录阅读会话（防刷）
    logReadingSession(userId, bookId, chapterId, wordsRead, readingTime, sessionHash) {
        try {
            db.prepare(`
                INSERT INTO reading_session_logs 
                (user_id, book_id, chapter_id, words_read, reading_time, session_hash)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(userId, bookId, chapterId, wordsRead, readingTime, sessionHash);
            return true;
        } catch (error) {
            // 如果插入失败（可能是重复），返回false
            return false;
        }
    },

    // 清理旧的会话记录（保留最近7天）
    cleanOldSessionLogs() {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        db.prepare(`
            DELETE FROM reading_session_logs 
            WHERE created_at < ?
        `).run(sevenDaysAgo.toISOString());
    }
};

// ==================== 藏品系统 ====================
const CollectionDB = {
    // 生成唯一藏品ID（参考区块链，不可增发）
    generateCollectionId() {
        const crypto = require('crypto');
        const timestamp = Date.now();
        const random = crypto.randomBytes(16).toString('hex');
        return `COL-${timestamp}-${random}`.toUpperCase();
    },

    // ==================== 藏品模板管理 ====================
    
    // 获取所有藏品模板
    getAllTemplates(includeInactive = false) {
        if (includeInactive) {
            return db.prepare("SELECT * FROM collection_templates ORDER BY rarity DESC, id ASC").all();
        }
        return db.prepare("SELECT * FROM collection_templates WHERE is_active = 1 ORDER BY rarity DESC, id ASC").all();
    },

    // 根据ID获取模板
    getTemplateById(templateId) {
        return db.prepare("SELECT * FROM collection_templates WHERE id = ?").get(templateId);
    },

    // 创建藏品模板
    createTemplate(templateData) {
        const {
            name, description, quality, rarity, max_quantity, drop_rate,
            effect_type, effect_value, effect_description,
            allowed_book_ids, allowed_categories, icon, color
        } = templateData;

        const result = db.prepare(`
            INSERT INTO collection_templates (
                name, description, quality, rarity, max_quantity, drop_rate,
                effect_type, effect_value, effect_description,
                allowed_book_ids, allowed_categories, icon, color
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            name, description || '', quality || 'common', rarity || 1, max_quantity || 0, drop_rate || 0.01,
            effect_type || null, effect_value || null, effect_description || null,
            allowed_book_ids || null, allowed_categories || null, icon || null, color || null
        );

        return { success: true, id: result.lastInsertRowid };
    },

    // 更新藏品模板
    updateTemplate(templateId, templateData) {
        const fields = [];
        const values = [];
        
        const allowedFields = [
            'name', 'description', 'quality', 'rarity', 'max_quantity', 'drop_rate',
            'effect_type', 'effect_value', 'effect_description',
            'allowed_book_ids', 'allowed_categories', 'icon', 'color', 'is_active'
        ];

        for (const [key, value] of Object.entries(templateData)) {
            if (allowedFields.includes(key)) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }

        if (fields.length === 0) {
            return { success: false, message: "没有可更新的字段" };
        }

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(templateId);

        db.prepare(`
            UPDATE collection_templates 
            SET ${fields.join(', ')} 
            WHERE id = ?
        `).run(...values);

        return { success: true };
    },

    // 删除藏品模板（软删除）
    deleteTemplate(templateId) {
        db.prepare("UPDATE collection_templates SET is_active = 0 WHERE id = ?").run(templateId);
        return { success: true };
    },

    // ==================== 用户藏品管理 ====================
    
    // 获取用户的所有藏品
    getUserCollections(userId) {
        return db.prepare(`
            SELECT 
                uc.*,
                ct.name, ct.description, ct.quality, ct.rarity,
                ct.effect_type, ct.effect_value, ct.effect_description,
                ct.icon, ct.color
            FROM user_collections uc
            JOIN collection_templates ct ON uc.template_id = ct.id
            WHERE uc.user_id = ?
            ORDER BY ct.rarity DESC, uc.obtained_at DESC
        `).all(userId);
    },

    // 根据藏品ID获取藏品信息
    getCollectionById(collectionId) {
        return db.prepare(`
            SELECT 
                uc.*,
                ct.name, ct.description, ct.quality, ct.rarity,
                ct.effect_type, ct.effect_value, ct.effect_description,
                ct.icon, ct.color
            FROM user_collections uc
            JOIN collection_templates ct ON uc.template_id = ct.id
            WHERE uc.collection_id = ?
        `).get(collectionId);
    },

    // 检查模板是否已达到最大数量
    checkTemplateQuantity(templateId) {
        const template = db.prepare("SELECT max_quantity, current_quantity FROM collection_templates WHERE id = ?").get(templateId);
        if (!template) return { available: false, reason: "模板不存在" };
        
        if (template.max_quantity > 0 && template.current_quantity >= template.max_quantity) {
            return { available: false, reason: "已达到最大数量" };
        }
        
        return { available: true };
    },

    // 创建用户藏品（服务器端生成唯一ID）
    createUserCollection(userId, templateId, bookId = null, chapterId = null) {
        // 检查用户是否已经拥有该模板的藏品（防止重复获得）
        const existing = db.prepare(`
            SELECT * FROM user_collections 
            WHERE user_id = ? AND template_id = ?
        `).get(userId, templateId);
        
        if (existing) {
            return { 
                success: false, 
                message: "您已经拥有该藏品，无法重复获得" 
            };
        }

        // 检查数量限制
        const quantityCheck = this.checkTemplateQuantity(templateId);
        if (!quantityCheck.available) {
            return { success: false, message: quantityCheck.reason };
        }

        // 生成唯一ID
        const collectionId = this.generateCollectionId();

        // 创建藏品
        db.prepare(`
            INSERT INTO user_collections (
                collection_id, template_id, user_id,
                obtained_from_book_id, obtained_from_chapter_id
            ) VALUES (?, ?, ?, ?, ?)
        `).run(collectionId, templateId, userId, bookId, chapterId);

        // 更新模板当前数量
        db.prepare(`
            UPDATE collection_templates 
            SET current_quantity = current_quantity + 1 
            WHERE id = ?
        `).run(templateId);

        // 获取完整信息
        const collection = this.getCollectionById(collectionId);
        return { success: true, collection };
    },

    // 检查书籍是否符合掉落条件
    checkBookEligibility(template, bookId, bookCategories = []) {
        // 如果没有任何限制，所有书都可以
        if (!template.allowed_book_ids && !template.allowed_categories) {
            return true;
        }

        let bookIdMatch = false;
        let categoryMatch = false;

        // 检查书籍ID限制
        if (template.allowed_book_ids) {
            const allowedIds = template.allowed_book_ids.split(',').map(id => id.trim());
            bookIdMatch = allowedIds.includes(bookId);
        } else {
            // 如果没有书籍ID限制，视为匹配
            bookIdMatch = true;
        }

        // 检查分类限制
        if (template.allowed_categories) {
            if (bookCategories.length === 0) {
                // 没有分类信息，无法匹配
                categoryMatch = false;
            } else {
                const allowedCategories = template.allowed_categories.split(',').map(cat => cat.trim());
                // 创建繁简体映射表（常见分类）
                const tradSimpMap = {
                    '仙俠': '仙侠', '仙侠': '仙俠',
                    '武俠': '武侠', '武侠': '武俠',
                    '玄幻': '玄幻',
                    '都市': '都市',
                    '言情': '言情',
                    '歷史': '历史', '历史': '歷史',
                    '軍事': '军事', '军事': '軍事',
                    '科幻': '科幻',
                    '遊戲': '游戏', '游戏': '遊戲',
                    '競技': '竞技', '竞技': '競技',
                    '輕小說': '轻小说', '轻小说': '輕小說'
                };
                
                // 检查是否有匹配（包括繁简体转换）
                categoryMatch = bookCategories.some(bookCat => {
                    // 直接匹配
                    if (allowedCategories.includes(bookCat)) {
                        return true;
                    }
                    // 繁简体转换匹配
                    const converted = tradSimpMap[bookCat] || bookCat;
                    if (allowedCategories.includes(converted)) {
                        return true;
                    }
                    // 反向匹配（模板中的分类转换为书籍分类）
                    return allowedCategories.some(allowedCat => {
                        const allowedConverted = tradSimpMap[allowedCat] || allowedCat;
                        return allowedConverted === bookCat || allowedConverted === converted;
                    });
                });
            }
        } else {
            // 如果没有分类限制，视为匹配
            categoryMatch = true;
        }

        // 如果同时指定了书籍ID和分类，需要同时满足（AND关系）
        // 如果只指定了其中一个，只需要满足那一个即可
        return bookIdMatch && categoryMatch;

        // 检查分类（支持繁简体匹配）
        if (template.allowed_categories && bookCategories.length > 0) {
            const allowedCategories = template.allowed_categories.split(',').map(cat => cat.trim());
            // 创建繁简体映射表（常见分类）
            const tradSimpMap = {
                '仙俠': '仙侠', '仙侠': '仙俠',
                '武俠': '武侠', '武侠': '武俠',
                '玄幻': '玄幻',
                '都市': '都市',
                '言情': '言情',
                '歷史': '历史', '历史': '歷史',
                '軍事': '军事', '军事': '軍事',
                '科幻': '科幻',
                '遊戲': '游戏', '游戏': '遊戲',
                '競技': '竞技', '竞技': '競技',
                '輕小說': '轻小说', '轻小说': '輕小說'
            };
            
            // 检查是否有匹配（包括繁简体转换）
            const hasMatch = bookCategories.some(bookCat => {
                // 直接匹配
                if (allowedCategories.includes(bookCat)) {
                    return true;
                }
                // 繁简体转换匹配
                const converted = tradSimpMap[bookCat] || bookCat;
                if (allowedCategories.includes(converted)) {
                    return true;
                }
                // 反向匹配（模板中的分类转换为书籍分类）
                return allowedCategories.some(allowedCat => {
                    const allowedConverted = tradSimpMap[allowedCat] || allowedCat;
                    return allowedConverted === bookCat || allowedConverted === converted;
                });
            });
            
            if (hasMatch) {
                return true;
            }
        }

        return false;
    },

    // 尝试掉落藏品（阅读时调用）
    tryDropCollection(userId, bookId, chapterId, wordsRead, bookCategories = []) {
        // 获取基础掉落率配置
        const baseDropRate = GameDB.getGameConfig("collection_drop_rate_base", 0.05);
        const dropInterval = GameDB.getGameConfig("collection_drop_interval_words", 1000);
        
        // 计算本次阅读的掉落检查次数（每1000字检查一次）
        const checkCount = Math.floor(wordsRead / dropInterval);
        if (checkCount <= 0) {
            return { dropped: false };
        }

        // 获取用户已拥有的模板ID（防止重复获得）
        const userOwnedTemplates = db.prepare(`
            SELECT DISTINCT template_id FROM user_collections WHERE user_id = ?
        `).all(userId).map(row => row.template_id);

        // 获取所有活跃的模板
        const templates = db.prepare(`
            SELECT * FROM collection_templates 
            WHERE is_active = 1 AND (max_quantity = 0 OR current_quantity < max_quantity)
            ORDER BY rarity DESC
        `).all();

        if (templates.length === 0) {
            return { dropped: false };
        }

        // 筛选符合条件的模板（排除用户已拥有的）
        const eligibleTemplates = templates.filter(template => {
            // 排除用户已拥有的模板
            if (userOwnedTemplates.includes(template.id)) {
                return false;
            }
            // 检查书籍是否符合条件
            return this.checkBookEligibility(template, bookId, bookCategories);
        });

        if (eligibleTemplates.length === 0) {
            return { dropped: false };
        }

        // 每次检查都有概率掉落
        for (let i = 0; i < checkCount; i++) {
            // 计算总掉落率（所有符合条件的模板）
            const totalDropRate = eligibleTemplates.reduce((sum, t) => sum + (t.drop_rate || 0), 0);
            const shouldDrop = Math.random() < (baseDropRate * totalDropRate);

            if (shouldDrop) {
                // 根据掉落率权重随机选择一个模板
                const random = Math.random() * totalDropRate;
                let cumulative = 0;
                let selectedTemplate = null;

                for (const template of eligibleTemplates) {
                    cumulative += (template.drop_rate || 0);
                    if (random <= cumulative) {
                        selectedTemplate = template;
                        break;
                    }
                }

                if (selectedTemplate) {
                    const result = this.createUserCollection(userId, selectedTemplate.id, bookId, chapterId);
                    if (result.success) {
                        return { dropped: true, collection: result.collection };
                    }
                }
            }
        }

        return { dropped: false };
    },

    // ==================== 藏品排行 ====================
    
    // 获取藏品排行（按稀有度和顺序）
    getCollectionRanking(limit = 100) {
        const results = db.prepare(`
            SELECT 
                uc.collection_id,
                uc.user_id,
                u.username,
                ct.name,
                ct.quality,
                ct.rarity,
                ct.color,
                uc.obtained_at
            FROM user_collections uc
            JOIN collection_templates ct ON uc.template_id = ct.id
            JOIN users u ON uc.user_id = u.id
            ORDER BY ct.rarity DESC, uc.obtained_at ASC
            LIMIT ?
        `).all(limit);
        
        // 手动添加排名（因为SQLite版本可能不支持ROW_NUMBER）
        return results.map((item, index) => ({
            ...item,
            rank: index + 1
        }));
    },

    // 获取用户藏品统计
    getUserCollectionStats(userId) {
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT template_id) as unique_types,
                SUM(CASE WHEN ct.rarity >= 5 THEN 1 ELSE 0 END) as legendary_count,
                SUM(CASE WHEN ct.rarity >= 4 THEN 1 ELSE 0 END) as epic_count,
                SUM(CASE WHEN ct.rarity >= 3 THEN 1 ELSE 0 END) as rare_count
            FROM user_collections uc
            JOIN collection_templates ct ON uc.template_id = ct.id
            WHERE uc.user_id = ?
        `).get(userId);

        return stats || { total: 0, unique_types: 0, legendary_count: 0, epic_count: 0, rare_count: 0 };
    },

    // ==================== 交易系统（预留） ====================
    
    // 创建交易记录
    createTransaction(collectionId, fromUserId, toUserId, transactionType, price = null) {
        const crypto = require('crypto');
        const transactionId = `TXN-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`.toUpperCase();

        db.prepare(`
            INSERT INTO collection_transactions (
                transaction_id, collection_id, from_user_id, to_user_id,
                transaction_type, price, status
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `).run(transactionId, collectionId, fromUserId, toUserId, transactionType, price);

        return { success: true, transaction_id: transactionId };
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
    BookshelfCategoryDB,
    ReadingStatsDB,
    SubscriptionDB,
    BookListDB,
    BookListCommentDB,
    GameDB,
    CollectionDB
};
