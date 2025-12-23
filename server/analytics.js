/**
 * PO18小说下载网站 - 用户行为分析与推荐系统
 */

const { db } = require('./database');
const { logger } = require('./logger');

class UserAnalytics {
    constructor(options = {}) {
        this.analysisInterval = options.analysisInterval || 3600000; // 分析间隔 (ms) - 默认1小时
        this.recommendationCacheTime = options.recommendationCacheTime || 1800000; // 推荐缓存时间 (ms) - 默认30分钟
        this.recommendationCache = new Map(); // 推荐结果缓存
    }
    
    /**
     * 记录用户行为
     * @param {number} userId 用户ID
     * @param {string} action 行为类型
     * @param {object} details 行为详情
     */
    async logUserAction(userId, action, details = {}) {
        try {
            // 记录到数据库
            const stmt = db.prepare(`
                INSERT INTO user_actions (user_id, action, details, created_at)
                VALUES (?, ?, ?, datetime('now'))
            `);
            
            stmt.run(userId, action, JSON.stringify(details));
            
            // 实时更新用户画像
            await this.updateUserProfile(userId, action, details);
            
            logger.debug(`用户行为记录: ${userId} - ${action}`, details);
        } catch (error) {
            logger.error('记录用户行为失败', { error: error.message, userId, action, details });
        }
    }
    
    /**
     * 更新用户画像
     * @param {number} userId 用户ID
     * @param {string} action 行为类型
     * @param {object} details 行为详情
     */
    async updateUserProfile(userId, action, details) {
        try {
            // 获取用户当前画像
            let profile = await this.getUserProfile(userId);
            if (!profile) {
                profile = {
                    userId: userId,
                    readingPreferences: {},
                    favoriteGenres: [],
                    readingHabits: {
                        preferredTime: [],
                        readingDuration: 0,
                        dailyReadingCount: 0
                    },
                    activityScore: 0
                };
            }
            
            // 根据行为更新画像
            switch (action) {
                case 'book_view':
                    // 记录书籍浏览
                    await this.updateGenrePreferences(profile, details.genre, 1);
                    break;
                    
                case 'book_download':
                    // 记录书籍下载
                    await this.updateGenrePreferences(profile, details.genre, 3);
                    profile.activityScore += 5;
                    break;
                    
                case 'book_read':
                    // 记录书籍阅读
                    await this.updateGenrePreferences(profile, details.genre, 2);
                    profile.activityScore += 3;
                    
                    // 更新阅读习惯
                    if (details.readingTime) {
                        const hour = new Date(details.readingTime).getHours();
                        if (!profile.readingHabits.preferredTime.includes(hour)) {
                            profile.readingHabits.preferredTime.push(hour);
                        }
                    }
                    if (details.duration) {
                        profile.readingHabits.readingDuration += details.duration;
                        profile.readingHabits.dailyReadingCount++;
                    }
                    break;
                    
                case 'search':
                    // 记录搜索行为
                    profile.activityScore += 1;
                    break;
                    
                case 'bookmark_add':
                    // 记录书签添加
                    profile.activityScore += 2;
                    break;
                    
                case 'rating':
                    // 记录评分行为
                    profile.activityScore += 3;
                    break;
            }
            
            // 保存更新后的画像
            await this.saveUserProfile(profile);
        } catch (error) {
            logger.error('更新用户画像失败', { error: error.message, userId, action, details });
        }
    }
    
    /**
     * 更新类型偏好
     * @param {object} profile 用户画像
     * @param {string} genre 类型
     * @param {number} weight 权重
     */
    async updateGenrePreferences(profile, genre, weight) {
        if (!genre) return;
        
        if (!profile.readingPreferences[genre]) {
            profile.readingPreferences[genre] = 0;
        }
        profile.readingPreferences[genre] += weight;
        
        // 更新最爱类型列表
        if (!profile.favoriteGenres.includes(genre)) {
            profile.favoriteGenres.push(genre);
        }
        
        // 按偏好度排序
        profile.favoriteGenres.sort((a, b) => 
            (profile.readingPreferences[b] || 0) - (profile.readingPreferences[a] || 0)
        );
        
        // 限制最爱类型数量
        if (profile.favoriteGenres.length > 10) {
            profile.favoriteGenres = profile.favoriteGenres.slice(0, 10);
        }
    }
    
    /**
     * 获取用户画像
     * @param {number} userId 用户ID
     * @returns {Promise<object>} 用户画像
     */
    async getUserProfile(userId) {
        try {
            const stmt = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?');
            const row = stmt.get(userId);
            
            if (row) {
                return {
                    userId: row.user_id,
                    readingPreferences: JSON.parse(row.reading_preferences || '{}'),
                    favoriteGenres: JSON.parse(row.favorite_genres || '[]'),
                    readingHabits: JSON.parse(row.reading_habits || '{}'),
                    activityScore: row.activity_score || 0,
                    lastUpdated: row.updated_at
                };
            }
            
            return null;
        } catch (error) {
            logger.error('获取用户画像失败', { error: error.message, userId });
            return null;
        }
    }
    
    /**
     * 保存用户画像
     * @param {object} profile 用户画像
     */
    async saveUserProfile(profile) {
        try {
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO user_profiles 
                (user_id, reading_preferences, favorite_genres, reading_habits, activity_score, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            `);
            
            stmt.run(
                profile.userId,
                JSON.stringify(profile.readingPreferences),
                JSON.stringify(profile.favoriteGenres),
                JSON.stringify(profile.readingHabits),
                profile.activityScore
            );
        } catch (error) {
            logger.error('保存用户画像失败', { error: error.message, profile });
        }
    }
    
    /**
     * 分析用户阅读习惯
     * @param {number} userId 用户ID
     * @returns {Promise<object>} 阅读习惯分析结果
     */
    async analyzeReadingHabits(userId) {
        try {
            // 获取用户最近30天的阅读记录
            const stmt = db.prepare(`
                SELECT * FROM reading_daily_stats 
                WHERE user_id = ? AND date >= date('now', '-30 days')
                ORDER BY date DESC
            `);
            
            const records = stmt.all(userId);
            
            if (records.length === 0) {
                return {
                    userId: userId,
                    habitAnalysis: {
                        consistency: 0,
                        preferredDays: [],
                        preferredHours: [],
                        averageDailyReading: 0,
                        totalReadingTime: 0
                    }
                };
            }
            
            // 分析习惯
            const habitAnalysis = {
                consistency: this.calculateReadingConsistency(records),
                preferredDays: this.findPreferredDays(records),
                preferredHours: this.findPreferredHours(records),
                averageDailyReading: this.calculateAverageDailyReading(records),
                totalReadingTime: records.reduce((sum, record) => sum + (record.reading_minutes || 0), 0)
            };
            
            return {
                userId: userId,
                habitAnalysis: habitAnalysis
            };
        } catch (error) {
            logger.error('分析用户阅读习惯失败', { error: error.message, userId });
            return null;
        }
    }
    
    /**
     * 计算阅读连续性
     * @param {Array} records 阅读记录
     * @returns {number} 连续性评分 (0-100)
     */
    calculateReadingConsistency(records) {
        if (records.length === 0) return 0;
        
        // 计算连续阅读天数
        let maxStreak = 0;
        let currentStreak = 0;
        
        // 按日期排序
        records.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        for (let i = 0; i < records.length; i++) {
            if (records[i].reading_minutes > 0) {
                currentStreak++;
                maxStreak = Math.max(maxStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        }
        
        // 转换为0-100评分
        return Math.min(100, Math.round((maxStreak / 30) * 100));
    }
    
    /**
     * 找出偏好的星期几
     * @param {Array} records 阅读记录
     * @returns {Array} 偏好的星期几
     */
    findPreferredDays(records) {
        const dayCounts = {};
        
        records.forEach(record => {
            if (record.reading_minutes > 0) {
                const dayOfWeek = new Date(record.date).getDay();
                dayCounts[dayOfWeek] = (dayCounts[dayOfWeek] || 0) + 1;
            }
        });
        
        // 返回阅读次数最多的前3个星期几
        return Object.entries(dayCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)
            .map(([day]) => parseInt(day));
    }
    
    /**
     * 找出偏好的小时
     * @param {Array} records 阅读记录
     * @returns {Array} 偏好的小时
     */
    findPreferredHours(records) {
        // 这里需要从用户行为日志中提取阅读时间信息
        // 简化实现，实际应该从更详细的行为日志中分析
        return [];
    }
    
    /**
     * 计算平均每日阅读时间
     * @param {Array} records 阅读记录
     * @returns {number} 平均每日阅读时间(分钟)
     */
    calculateAverageDailyReading(records) {
        if (records.length === 0) return 0;
        
        const totalMinutes = records.reduce((sum, record) => sum + (record.reading_minutes || 0), 0);
        return Math.round(totalMinutes / records.length);
    }
    
    /**
     * 生成热门书籍推荐
     * @param {number} userId 用户ID
     * @param {number} limit 推荐数量
     * @returns {Promise<Array>} 推荐书籍列表
     */
    async generatePopularRecommendations(userId, limit = 10) {
        try {
            // 检查缓存
            const cacheKey = `popular_${userId}`;
            const cached = this.recommendationCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.recommendationCacheTime) {
                return cached.data.slice(0, limit);
            }
            
            // 获取热门书籍（按下载次数和评分排序）
            const stmt = db.prepare(`
                SELECT bm.*, 
                       COUNT(dq.id) as download_count,
                       COUNT(sl.id) as share_count
                FROM book_metadata bm
                LEFT JOIN download_queue dq ON bm.book_id = dq.book_id AND dq.status = 'completed'
                LEFT JOIN shared_library sl ON bm.book_id = sl.book_id
                WHERE bm.status = 'completed'
                GROUP BY bm.book_id
                ORDER BY (COUNT(dq.id) * 2 + COUNT(sl.id)) DESC
                LIMIT ?
            `);
            
            const books = stmt.all(limit * 2); // 获取更多书籍以便过滤
            
            // 过滤用户已下载或已拥有的书籍
            const userBooks = await this.getUserBooks(userId);
            const userBookIds = new Set(userBooks.map(b => b.book_id));
            
            const recommendations = books
                .filter(book => !userBookIds.has(book.book_id))
                .slice(0, limit);
            
            // 缓存结果
            this.recommendationCache.set(cacheKey, {
                data: recommendations,
                timestamp: Date.now()
            });
            
            return recommendations;
        } catch (error) {
            logger.error('生成热门推荐失败', { error: error.message, userId, limit });
            return [];
        }
    }
    
    /**
     * 生成个性化推荐
     * @param {number} userId 用户ID
     * @param {number} limit 推荐数量
     * @returns {Promise<Array>} 推荐书籍列表
     */
    async generatePersonalizedRecommendations(userId, limit = 10) {
        try {
            // 检查缓存
            const cacheKey = `personal_${userId}`;
            const cached = this.recommendationCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.recommendationCacheTime) {
                return cached.data.slice(0, limit);
            }
            
            // 获取用户画像
            const profile = await this.getUserProfile(userId);
            if (!profile || Object.keys(profile.readingPreferences).length === 0) {
                // 如果没有足够的用户数据，返回热门推荐
                return await this.generatePopularRecommendations(userId, limit);
            }
            
            // 根据用户偏好类型推荐书籍
            const preferredGenres = profile.favoriteGenres.slice(0, 3); // 取前3个偏好类型
            
            // 构建查询条件
            const genreConditions = preferredGenres.map((_, index) => `tags LIKE ?`).join(' OR ');
            const genreParams = preferredGenres.map(genre => `%${genre}%`);
            
            const stmt = db.prepare(`
                SELECT *, 
                       COUNT(dq.id) as download_count,
                       COUNT(sl.id) as share_count
                FROM book_metadata bm
                LEFT JOIN download_queue dq ON bm.book_id = dq.book_id AND dq.status = 'completed'
                LEFT JOIN shared_library sl ON bm.book_id = sl.book_id
                WHERE bm.status = 'completed' 
                AND (${genreConditions})
                GROUP BY bm.book_id
                ORDER BY (COUNT(dq.id) * 2 + COUNT(sl.id)) DESC
                LIMIT ?
            `);
            
            const books = stmt.all(...genreParams, limit * 2);
            
            // 过滤用户已下载或已拥有的书籍
            const userBooks = await this.getUserBooks(userId);
            const userBookIds = new Set(userBooks.map(b => b.book_id));
            
            const recommendations = books
                .filter(book => !userBookIds.has(book.book_id))
                .slice(0, limit);
            
            // 缓存结果
            this.recommendationCache.set(cacheKey, {
                data: recommendations,
                timestamp: Date.now()
            });
            
            return recommendations;
        } catch (error) {
            logger.error('生成个性化推荐失败', { error: error.message, userId, limit });
            return [];
        }
    }
    
    /**
     * 获取用户已有的书籍
     * @param {number} userId 用户ID
     * @returns {Promise<Array>} 书籍列表
     */
    async getUserBooks(userId) {
        try {
            const stmt = db.prepare(`
                SELECT book_id FROM (
                    SELECT book_id FROM download_queue WHERE user_id = ? AND status = 'completed'
                    UNION
                    SELECT book_id FROM shared_library WHERE user_id = ?
                    UNION
                    SELECT book_id FROM bookshelf WHERE user_id = ?
                )
            `);
            
            return stmt.all(userId, userId, userId);
        } catch (error) {
            logger.error('获取用户书籍失败', { error: error.message, userId });
            return [];
        }
    }
    
    /**
     * 获取用户阅读统计
     * @param {number} userId 用户ID
     * @returns {Promise<object>} 阅读统计
     */
    async getUserReadingStats(userId) {
        try {
            // 获取基本统计
            const statsStmt = db.prepare(`
                SELECT 
                    COUNT(DISTINCT book_id) as total_books,
                    SUM(reading_time) as total_reading_time,
                    COUNT(*) as total_sessions
                FROM bookshelf 
                WHERE user_id = ?
            `);
            
            const basicStats = statsStmt.get(userId) || {};
            
            // 获取最近7天的阅读趋势
            const trendStmt = db.prepare(`
                SELECT date, reading_minutes
                FROM reading_daily_stats
                WHERE user_id = ? AND date >= date('now', '-7 days')
                ORDER BY date ASC
            `);
            
            const weeklyTrend = trendStmt.all(userId);
            
            return {
                userId: userId,
                basicStats: {
                    totalBooks: basicStats.total_books || 0,
                    totalReadingTime: basicStats.total_reading_time || 0,
                    totalSessions: basicStats.total_sessions || 0
                },
                weeklyTrend: weeklyTrend
            };
        } catch (error) {
            logger.error('获取用户阅读统计失败', { error: error.message, userId });
            return null;
        }
    }
    
    /**
     * 清理过期缓存
     */
    cleanExpiredCache() {
        const now = Date.now();
        for (const [key, value] of this.recommendationCache.entries()) {
            if ((now - value.timestamp) >= this.recommendationCacheTime) {
                this.recommendationCache.delete(key);
            }
        }
    }
    
    /**
     * 启动定期分析任务
     */
    startAnalysisTasks() {
        // 定期清理过期缓存
        this.cacheCleanupTimer = setInterval(() => {
            this.cleanExpiredCache();
        }, 300000); // 每5分钟清理一次
        
        logger.info('用户行为分析任务已启动');
    }
    
    /**
     * 停止分析任务
     */
    stopAnalysisTasks() {
        if (this.cacheCleanupTimer) {
            clearInterval(this.cacheCleanupTimer);
            this.cacheCleanupTimer = null;
        }
        
        logger.info('用户行为分析任务已停止');
    }
}

// 创建全局用户分析实例
const userAnalytics = new UserAnalytics();

module.exports = {
    UserAnalytics,
    userAnalytics
};