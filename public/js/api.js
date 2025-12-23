/**
 * PO18小说下载站 - API模块
 */

const API = {
    baseUrl: "/api",

    // ==================== 缓存系统 ====================

    _cache: new Map(),
    _cacheExpiry: new Map(),

    // 缓存配置（过期时间，单位：毫秒）
    cacheConfig: {
        globalLibraryTags: 30 * 60 * 1000, // 标签列表 30分钟
        userStats: 2 * 60 * 1000, // 用户统计 2分钟（缩短从5分钟）
        bookDetail: 10 * 60 * 1000, // 书籍详情 10分钟
        libraryFilters: 30 * 60 * 1000 // 书库筛选项 30分钟
    },

    // 设置缓存
    setCache(key, data, ttl) {
        this._cache.set(key, data);
        this._cacheExpiry.set(key, Date.now() + ttl);
    },

    // 获取缓存
    getCache(key) {
        const expiry = this._cacheExpiry.get(key);
        if (!expiry || Date.now() > expiry) {
            this._cache.delete(key);
            this._cacheExpiry.delete(key);
            return null;
        }
        return this._cache.get(key);
    },

    // 清除缓存
    clearCache(keyPattern) {
        if (keyPattern) {
            for (const key of this._cache.keys()) {
                if (key.includes(keyPattern)) {
                    this._cache.delete(key);
                    this._cacheExpiry.delete(key);
                }
            }
        } else {
            this._cache.clear();
            this._cacheExpiry.clear();
        }
    },

    // 带缓存的GET请求
    async getCached(url, params = {}, cacheKey = null, ttl = null) {
        const key = cacheKey || `${url}_${JSON.stringify(params)}`;
        const cached = this.getCache(key);

        if (cached) {
            return cached;
        }

        const data = await this.get(url, params);

        if (ttl) {
            this.setCache(key, data, ttl);
        }

        return data;
    },

    // 通用请求方法
    async request(url, options = {}) {
        const defaultOptions = {
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "include"
        };

        const mergedOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers
            }
        };

        if (mergedOptions.body && typeof mergedOptions.body === "object") {
            mergedOptions.body = JSON.stringify(mergedOptions.body);
        }

        try {
            // 添加超时控制
            const timeout = options.timeout || 60000; // 默认60秒
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            mergedOptions.signal = controller.signal;

            const response = await fetch(this.baseUrl + url, mergedOptions);
            clearTimeout(timeoutId);

            const data = await response.json();

            if (!response.ok) {
                // 检查是否是被踢出登录（单点登录）
                if (response.status === 401 && data.code === "SESSION_KICKED") {
                    // 触发全局事件，通知App处理
                    if (typeof App !== "undefined" && App.handleSessionKicked) {
                        App.handleSessionKicked();
                    }
                    throw new Error("您的账号已在其他设备登录，当前会话已失效");
                }
                throw new Error(data.error || "请求失败");
            }

            return data;
        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error("请求超时，请稍后重试");
            }
            console.error("API请求错误:", error);
            throw error;
        }
    },

    // GET请求
    get(url, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = queryString ? `${url}?${queryString}` : url;
        return this.request(fullUrl, { method: "GET" });
    },

    // POST请求
    post(url, data = {}) {
        return this.request(url, {
            method: "POST",
            body: data
        });
    },

    // DELETE请求
    delete(url) {
        return this.request(url, { method: "DELETE" });
    },

    // ==================== 认证API ====================

    auth: {
        register(username, password) {
            return API.post("/auth/register", { username, password });
        },

        login(username, password) {
            return API.post("/auth/login", { username, password });
        },

        logout() {
            return API.post("/auth/logout");
        },

        getMe() {
            return API.get("/auth/me");
        }
    },

    // ==================== PO18 Cookie ====================

    po18: {
        getCookie() {
            return API.get("/po18/cookie");
        },

        setCookie(cookie) {
            return API.post("/po18/cookie", { cookie });
        },

        validateCookie() {
            return API.get("/po18/validate");
        }
    },

    // ==================== 个人WebDAV ====================

    webdav: {
        getConfig() {
            return API.get("/webdav/configs");
        },

        saveConfig(config) {
            return API.post("/webdav/configs", config);
        },

        testConnection(config) {
            return API.post("/webdav/test", config);
        }
    },

    // ==================== 搜索API ====================

    search(keyword, page = 1) {
        return API.get("/search", { keyword, page });
    },

    getBookDetail(bookId) {
        return API.get(`/book/${bookId}`);
    },

    // 解析书籍ID或链接
    parseBookInput(input) {
        return API.get("/book/parse", { input });
    },

    // 快速下载（根据ID或链接）
    quickDownload(input, format = "txt") {
        return API.post("/book/quick-download", { input, format });
    },

    // ==================== 已购书籍API ====================

    purchased: {
        getList(refresh = false) {
            return API.get("/purchased", { refresh: refresh ? "true" : "" });
        }
    },

    // ==================== 下载队列API ====================

    queue: {
        getList() {
            return API.get("/queue");
        },

        add(bookId, format = "txt", autoShare = false) {
            return API.post("/queue", { bookId, format, autoShare });
        },

        remove(id) {
            return API.delete(`/queue/${id}`);
        },

        clearCompleted() {
            return API.delete("/queue/completed");
        },

        startDownload(queueId) {
            return API.post("/download/start", { queueId });
        },

        // 轮询获取下载进度 (替代SSE)
        subscribeProgress(queueId, onMessage) {
            let isRunning = true;
            let lastProgress = -1;

            const poll = async () => {
                while (isRunning) {
                    try {
                        const queue = await API.get("/queue");
                        const item = queue.find((q) => q.id === queueId);

                        if (item) {
                            const currentProgress = item.progress || 0;
                            const total = item.total_chapters || 0;

                            if (item.status === "downloading") {
                                if (currentProgress !== lastProgress) {
                                    lastProgress = currentProgress;
                                    onMessage({
                                        type: "progress",
                                        completed: currentProgress,
                                        total: total,
                                        percent: total > 0 ? Math.round((currentProgress / total) * 100) : 0
                                    });
                                }
                            } else if (item.status === "completed") {
                                // 获取完整的下载数据
                                try {
                                    const result = await API.get(`/queue/${queueId}/result`);
                                    onMessage({
                                        type: "completed",
                                        ...result
                                    });
                                } catch (e) {
                                    console.error("获取下载结果失败:", e);
                                    onMessage({ type: "completed" });
                                }
                                isRunning = false;
                                break;
                            } else if (item.status === "failed") {
                                onMessage({
                                    type: "error",
                                    error: item.error_message || "下载失败"
                                });
                                isRunning = false;
                                break;
                            }
                        }
                    } catch (e) {
                        console.warn("轮询进度失败:", e.message);
                    }

                    // 等待1秒后再查询
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            };

            // 开始轮询
            poll();

            // 返回一个可以停止轮询的对象
            return {
                close: () => {
                    isRunning = false;
                }
            };
        }
    },

    // ==================== 共享书库API ====================

    share: {
        enable() {
            return API.post("/share/enable");
        },

        disable() {
            return API.post("/share/disable");
        },

        upload(libraryId) {
            return API.post("/share/upload", { libraryId });
        },

        getList() {
            return API.get("/share/library");
        },

        search(keyword) {
            return API.get("/share/search", { keyword });
        },

        download(id) {
            return API.get(`/share/download/${id}`);
        }
    },

    // ==================== 历史记录API ====================

    history: {
        getList() {
            return API.get("/history");
        },

        clear() {
            return API.delete("/history");
        }
    },

    // ==================== 排行榜API ====================

    rankings: {
        get(type, limit = 100) {
            // 排行榜已经在 App.rankingCache 中实现了缓存
            return API.get(`/rankings/${type}`, { limit });
        }
    },

    // ==================== 全站书库API ====================

    globalLibrary: {
        getList(params = {}) {
            return API.get("/global-library", params);
        },
        getTags() {
            // 标签列表缓存30分钟
            return API.getCached("/global-library/tags", {}, "globalLibraryTags", API.cacheConfig.globalLibraryTags);
        }
    },

    // ==================== 用户统计API ====================

    userStats: {
        get() {
            // 用户统计缓存5分钟
            return API.getCached("/user/stats", {}, "userStats", API.cacheConfig.userStats);
        },
        // 刷新统计（跳过缓存）
        refresh() {
            API.clearCache("userStats");
            return API.get("/user/stats");
        },
        // 获取阅读统计（热力图）
        getReadingStats(days = 365) {
            return API.get("/user/reading-stats", { days });
        }
    },

    // ==================== 书库API ====================

    library: {
        getList(filters = {}) {
            return API.get("/library", filters);
        },

        getFilters() {
            // 筛选项缓存30分钟
            return API.getCached("/library/filters", {}, "libraryFilters", API.cacheConfig.libraryFilters);
        },

        remove(id) {
            return API.delete(`/library/${id}`);
        },

        getDownloadUrl(id) {
            // 对路径进行URL编码，防止特殊字符导致问题
            return `${API.baseUrl}/download/file/${encodeURIComponent(id)}`;
        },

        matchBook(libraryId, bookId) {
            return API.post("/library/match", { libraryId, bookId });
        }
    },

    // ==================== 订阅API ====================

    subscriptions: {
        // 获取订阅列表
        getList() {
            return API.get("/subscriptions");
        },

        // 获取有更新的订阅
        getUpdates() {
            return API.get("/subscriptions/updates");
        },

        // 订阅书籍
        subscribe(bookId, bookInfo) {
            return API.post(`/subscriptions/${bookId}`, bookInfo);
        },

        // 取消订阅
        unsubscribe(bookId) {
            return API.delete(`/subscriptions/${bookId}`);
        },

        // 检查订阅状态
        getStatus(bookId) {
            return API.get(`/subscriptions/${bookId}/status`);
        },

        // 清除更新标记
        clearUpdate(bookId) {
            return API.post(`/subscriptions/${bookId}/clear-update`);
        },

        // 更新章节数（检查是否有更新）
        updateChapterCount(bookId, chapterCount) {
            return API.post(`/subscriptions/${bookId}/update-count`, { chapterCount });
        }
    }
};
