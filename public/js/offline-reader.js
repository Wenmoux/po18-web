/**
 * 离线阅读功能模块
 * 提供离线模式、离线书籍管理、缓存管理等功能
 */

(function() {
    'use strict';

    const OFFLINE_DB_NAME = 'po18_offline_books';
    const OFFLINE_DB_VERSION = 1;
    const STORE_NAME = 'books';
    const CHAPTERS_STORE = 'chapters';
    const PROGRESS_STORE = 'reading_progress';

    let db = null;

    // 初始化IndexedDB
    async function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

            request.onerror = () => {
                console.error('[OfflineReader] IndexedDB打开失败:', request.error);
                // 尝试删除并重新创建数据库
                if (request.error.name === 'NotReadableError' || request.error.name === 'InvalidStateError') {
                    console.log('[OfflineReader] 检测到数据库损坏，尝试重建...');
                    indexedDB.deleteDatabase(OFFLINE_DB_NAME).onsuccess = () => {
                        console.log('[OfflineReader] 旧数据库已删除，重新初始化...');
                        // 重新打开
                        const retryRequest = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
                        retryRequest.onsuccess = () => {
                            db = retryRequest.result;
                            resolve(db);
                        };
                        retryRequest.onerror = () => {
                            console.error('[OfflineReader] 重建数据库失败:', retryRequest.error);
                            // 即使重建失败，也返回 null，让调用者知道数据库不可用
                            resolve(null);
                        };
                        retryRequest.onupgradeneeded = (event) => createStores(event.target.result);
                    };
                    indexedDB.deleteDatabase(OFFLINE_DB_NAME).onerror = () => {
                        console.error('[OfflineReader] 删除旧数据库失败');
                        // 即使删除失败，也返回 null
                        resolve(null);
                    };
                } else {
                    // 对于其他错误，也返回 null 而不是 reject
                    console.warn('[OfflineReader] IndexedDB 不可用，将使用其他存储方式');
                    resolve(null);
                }
            };
            
            request.onsuccess = () => {
                db = request.result;
                
                // 监听数据库错误
                db.onerror = (event) => {
                    const error = event.target.error;
                    console.error('[OfflineReader] IndexedDB错误:', error);
                    
                    // 如果是 NotReadableError，尝试重建数据库
                    if (error && (error.name === 'NotReadableError' || error.name === 'InvalidStateError')) {
                        console.log('[OfflineReader] 检测到数据库运行时错误，尝试重建...');
                        db.close();
                        db = null;
                        indexedDB.deleteDatabase(OFFLINE_DB_NAME).onsuccess = () => {
                            console.log('[OfflineReader] 数据库已重建，请刷新页面');
                        };
                    }
                };
                
                // 监听数据库关闭
                db.onclose = () => {
                    console.log('[OfflineReader] 数据库连接已关闭');
                    db = null;
                };
                
                resolve(db);
            };

            request.onupgradeneeded = (event) => {
                createStores(event.target.result);
            };
        });
    }
    
    // 创建存储对象
    function createStores(database) {
        // 书籍存储
        if (!database.objectStoreNames.contains(STORE_NAME)) {
            const bookStore = database.createObjectStore(STORE_NAME, { keyPath: 'bookId' });
            bookStore.createIndex('title', 'title', { unique: false });
            bookStore.createIndex('author', 'author', { unique: false });
            bookStore.createIndex('downloadedAt', 'downloadedAt', { unique: false });
        }

        // 章节存储
        if (!database.objectStoreNames.contains(CHAPTERS_STORE)) {
            const chapterStore = database.createObjectStore(CHAPTERS_STORE, { keyPath: ['bookId', 'chapterId'] });
            chapterStore.createIndex('bookId', 'bookId', { unique: false });
        }

        // 阅读进度存储
        if (!database.objectStoreNames.contains(PROGRESS_STORE)) {
            const progressStore = database.createObjectStore(PROGRESS_STORE, { keyPath: 'bookId' });
        }
    }

    // 获取数据库实例
    async function getDB() {
        if (!db) {
            db = await initDB();
        }
        // 如果数据库不可用，返回 null
        if (!db) {
            console.warn('[OfflineReader] 数据库不可用，某些功能可能受限');
        }
        return db;
    }

    // 检查离线模式状态
    function isOfflineMode() {
        return localStorage.getItem('offline_mode') === 'true';
    }

    // 设置离线模式
    function setOfflineMode(enabled) {
        localStorage.setItem('offline_mode', enabled ? 'true' : 'false');
        window.dispatchEvent(new CustomEvent('offlineModeChanged', { detail: { enabled } }));
    }

    // 下载书籍到本地（离线存储）
    async function downloadBookForOffline(bookId, bookInfo, chapters) {
        try {
            const database = await getDB();
            if (!database) {
                throw new Error('数据库不可用，无法下载书籍');
            }
            const transaction = database.transaction([STORE_NAME, CHAPTERS_STORE], 'readwrite');

            // 保存书籍信息
            const bookStore = transaction.objectStore(STORE_NAME);
            await bookStore.put({
                bookId,
                title: bookInfo.title,
                author: bookInfo.author || '未知',
                cover: bookInfo.cover || '',
                description: bookInfo.description || '',
                tags: bookInfo.tags || '',
                totalChapters: chapters.length,
                downloadedAt: new Date().toISOString(),
                format: 'offline'
            });

            // 保存章节内容
            const chapterStore = transaction.objectStore(CHAPTERS_STORE);
            for (let i = 0; i < chapters.length; i++) {
                const chapter = chapters[i];
                await chapterStore.put({
                    bookId,
                    chapterId: chapter.chapterId || chapter.id,
                    title: chapter.title,
                    content: chapter.html || chapter.text || '',
                    text: chapter.text || '',
                    index: chapter.index !== undefined ? chapter.index : i, // 保存章节索引用于排序
                    index: chapter.index || 0
                });
            }

            await transaction.complete;
            return true;
        } catch (error) {
            console.error('下载书籍失败:', error);
            throw error;
        }
    }

    // 获取离线书籍列表
    async function getOfflineBooks() {
        try {
            const database = await getDB();
            if (!database) {
                return [];
            }
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            
            return new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('获取离线书籍列表失败:', error);
            return [];
        }
    }

    // 获取离线章节内容
    async function getOfflineChapter(bookId, chapterId) {
        try {
            const database = await getDB();
            if (!database) {
                return null;
            }
            const transaction = database.transaction([CHAPTERS_STORE], 'readonly');
            const store = transaction.objectStore(CHAPTERS_STORE);
            const request = store.get([bookId, chapterId]);
            
            return new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('获取离线章节失败:', error);
            return null;
        }
    }

    // 获取书籍的所有离线章节
    async function getOfflineChapters(bookId) {
        try {
            const database = await getDB();
            if (!database) {
                return [];
            }
            const transaction = database.transaction([CHAPTERS_STORE], 'readonly');
            const store = transaction.objectStore(CHAPTERS_STORE);
            const index = store.index('bookId');
            const request = index.getAll(bookId);
            
            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const chapters = request.result || [];
                    // 按index排序，如果没有index则按chapterId排序
                    chapters.sort((a, b) => {
                        if (a.index !== undefined && b.index !== undefined) {
                            return a.index - b.index;
                        }
                        // 如果没有index，尝试从chapterId提取数字排序
                        const aNum = parseInt(a.chapterId) || 0;
                        const bNum = parseInt(b.chapterId) || 0;
                        return aNum - bNum;
                    });
                    resolve(chapters);
                };
                request.onerror = () => {
                    console.error('获取离线章节列表失败:', request.error);
                    resolve([]); // 失败时返回空数组而不是reject
                };
            });
        } catch (error) {
            console.error('获取离线章节列表失败:', error);
            return [];
        }
    }

    // 检查书籍是否已下载
    async function isBookDownloaded(bookId) {
        try {
            const database = await getDB();
            if (!database) {
                return false;
            }
            const transaction = database.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(bookId);
            
            return new Promise((resolve) => {
                request.onsuccess = () => resolve(!!request.result);
                request.onerror = () => resolve(false);
            });
        } catch (error) {
            return false;
        }
    }

    // 删除离线书籍
    async function deleteOfflineBook(bookId) {
        try {
            const database = await getDB();
            if (!database) {
                throw new Error('数据库不可用，无法删除书籍');
            }
            const transaction = database.transaction([STORE_NAME, CHAPTERS_STORE, PROGRESS_STORE], 'readwrite');

            // 删除书籍信息
            const bookStore = transaction.objectStore(STORE_NAME);
            await bookStore.delete(bookId);

            // 删除所有章节
            const chapterStore = transaction.objectStore(CHAPTERS_STORE);
            const index = chapterStore.index('bookId');
            const request = index.openKeyCursor(IDBKeyRange.only(bookId));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    chapterStore.delete(cursor.primaryKey);
                    cursor.continue();
                }
            };

            // 删除阅读进度
            const progressStore = transaction.objectStore(PROGRESS_STORE);
            await progressStore.delete(bookId);

            await transaction.complete;
            return true;
        } catch (error) {
            console.error('删除离线书籍失败:', error);
            throw error;
        }
    }

    // 保存阅读进度（离线）
    async function saveOfflineProgress(bookId, chapterIndex, chapterId) {
        try {
            const database = await getDB();
            if (!database) {
                return; // 数据库不可用时静默失败
            }
            const transaction = database.transaction([PROGRESS_STORE], 'readwrite');
            const store = transaction.objectStore(PROGRESS_STORE);
            
            await store.put({
                bookId,
                chapterIndex,
                chapterId,
                updatedAt: new Date().toISOString()
            });

            await transaction.complete;
        } catch (error) {
            console.error('保存离线进度失败:', error);
        }
    }

    // 获取阅读进度（离线）
    async function getOfflineProgress(bookId) {
        try {
            const database = await getDB();
            if (!database) {
                return null;
            }
            const transaction = database.transaction([PROGRESS_STORE], 'readonly');
            const store = transaction.objectStore(PROGRESS_STORE);
            const request = store.get(bookId);
            
            return new Promise((resolve) => {
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            });
        } catch (error) {
            return null;
        }
    }

    // 同步离线进度到服务器（联网时）
    async function syncOfflineProgress(bookId) {
        if (!navigator.onLine) return;

        try {
            const progress = await getOfflineProgress(bookId);
            if (!progress) return;

            const response = await fetch(`/api/bookshelf/${bookId}/progress`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    chapter: progress.chapterIndex,
                    chapterId: progress.chapterId
                })
            });

            if (response.ok) {
                console.log('离线进度已同步');
            }
        } catch (error) {
            console.error('同步离线进度失败:', error);
        }
    }

    // 获取缓存大小估算
    async function getCacheSize() {
        if (!navigator.storage || !navigator.storage.estimate) {
            return null;
        }

        try {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage || 0,
                quota: estimate.quota || 0,
                usagePercent: estimate.quota ? ((estimate.usage / estimate.quota) * 100).toFixed(2) : 0
            };
        } catch (error) {
            console.error('获取缓存大小失败:', error);
            return null;
        }
    }

    // 清理所有离线数据
    async function clearAllOfflineData() {
        try {
            const database = await getDB();
            if (!database) {
                throw new Error('数据库不可用，无法清理数据');
            }
            const transaction = database.transaction([STORE_NAME, CHAPTERS_STORE, PROGRESS_STORE], 'readwrite');

            await transaction.objectStore(STORE_NAME).clear();
            await transaction.objectStore(CHAPTERS_STORE).clear();
            await transaction.objectStore(PROGRESS_STORE).clear();

            await transaction.complete;
            return true;
        } catch (error) {
            console.error('清理离线数据失败:', error);
            throw error;
        }
    }

    // 导出到全局（立即导出，不等待初始化）
    window.OfflineReader = {
        init: initDB,
        isOfflineMode,
        setOfflineMode,
        downloadBookForOffline,
        getOfflineBooks,
        getOfflineChapter,
        getOfflineChapters,
        isBookDownloaded,
        deleteOfflineBook,
        saveOfflineProgress,
        getOfflineProgress,
        syncOfflineProgress,
        getCacheSize,
        clearAllOfflineData,
        _initialized: false
    };

    // 自动初始化（后台进行，不阻塞）
    const autoInit = () => {
        initDB()
            .then(() => {
                window.OfflineReader._initialized = true;
                console.log('[OfflineReader] 数据库初始化完成');
            })
            .catch(err => {
                console.error('[OfflineReader] 数据库初始化失败:', err);
            });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        // 如果文档已加载，立即初始化
        autoInit();
    }
})();

