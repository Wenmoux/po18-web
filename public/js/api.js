/**
 * PO18小说下载站 - API模块
 */

const API = {
    baseUrl: '/api',
    
    // 通用请求方法
    async request(url, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        };
        
        const mergedOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers
            }
        };
        
        if (mergedOptions.body && typeof mergedOptions.body === 'object') {
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
                throw new Error(data.error || '请求失败');
            }
            
            return data;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('请求超时，请稍后重试');
            }
            console.error('API请求错误:', error);
            throw error;
        }
    },
    
    // GET请求
    get(url, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = queryString ? `${url}?${queryString}` : url;
        return this.request(fullUrl, { method: 'GET' });
    },
    
    // POST请求
    post(url, data = {}) {
        return this.request(url, {
            method: 'POST',
            body: data
        });
    },
    
    // DELETE请求
    delete(url) {
        return this.request(url, { method: 'DELETE' });
    },
    
    // ==================== 认证API ====================
    
    auth: {
        register(username, password) {
            return API.post('/auth/register', { username, password });
        },
        
        login(username, password) {
            return API.post('/auth/login', { username, password });
        },
        
        logout() {
            return API.post('/auth/logout');
        },
        
        getMe() {
            return API.get('/auth/me');
        }
    },
    
    // ==================== PO18 Cookie ====================
    
    po18: {
        getCookie() {
            return API.get('/po18/cookie');
        },
        
        setCookie(cookie) {
            return API.post('/po18/cookie', { cookie });
        },
        
        validateCookie() {
            return API.get('/po18/validate');
        }
    },
    
    // ==================== 个人WebDAV ====================
    
    webdav: {
        getConfig() {
            return API.get('/webdav/configs');
        },
        
        saveConfig(config) {
            return API.post('/webdav/configs', config);
        },
        
        testConnection(config) {
            return API.post('/webdav/test', config);
        }
    },
    
    // ==================== 搜索API ====================
    
    search(keyword, page = 1) {
        return API.get('/search', { keyword, page });
    },
    
    getBookDetail(bookId) {
        return API.get(`/book/${bookId}`);
    },
    
    // 解析书籍ID或链接
    parseBookInput(input) {
        return API.get('/book/parse', { input });
    },
    
    // 快速下载（根据ID或链接）
    quickDownload(input, format = 'txt') {
        return API.post('/book/quick-download', { input, format });
    },
    
    // ==================== 已购书籍API ====================
    
    purchased: {
        getList(refresh = false) {
            return API.get('/purchased', { refresh: refresh ? 'true' : '' });
        }
    },
    
    // ==================== 下载队列API ====================
    
    queue: {
        getList() {
            return API.get('/queue');
        },
        
        add(bookId, format = 'txt', autoShare = false) {
            return API.post('/queue', { bookId, format, autoShare });
        },
        
        remove(id) {
            return API.delete(`/queue/${id}`);
        },
        
        clearCompleted() {
            return API.delete('/queue/completed');
        },
        
        startDownload(queueId) {
            return API.post('/download/start', { queueId });
        },
        
        // 轮询获取下载进度 (替代SSE)
        subscribeProgress(queueId, onMessage) {
            let isRunning = true;
            let lastProgress = -1;
            
            const poll = async () => {
                while (isRunning) {
                    try {
                        const queue = await API.get('/queue');
                        const item = queue.find(q => q.id === queueId);
                        
                        if (item) {
                            const currentProgress = item.progress || 0;
                            const total = item.total_chapters || 0;
                            
                            if (item.status === 'downloading') {
                                if (currentProgress !== lastProgress) {
                                    lastProgress = currentProgress;
                                    onMessage({
                                        type: 'progress',
                                        completed: currentProgress,
                                        total: total,
                                        percent: total > 0 ? Math.round((currentProgress / total) * 100) : 0
                                    });
                                }
                            } else if (item.status === 'completed') {
                                // 获取完整的下载数据
                                try {
                                    const result = await API.get(`/queue/${queueId}/result`);
                                    onMessage({ 
                                        type: 'completed',
                                        ...result
                                    });
                                } catch (e) {
                                    console.error('获取下载结果失败:', e);
                                    onMessage({ type: 'completed' });
                                }
                                isRunning = false;
                                break;
                            } else if (item.status === 'failed') {
                                onMessage({ type: 'error', error: item.error_message || '下载失败' });
                                isRunning = false;
                                break;
                            }
                        }
                    } catch (e) {
                        console.warn('轮询进度失败:', e.message);
                    }
                    
                    // 等待1秒后再查询
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            };
            
            // 开始轮询
            poll();
            
            // 返回一个可以停止轮询的对象
            return {
                close: () => { isRunning = false; }
            };
        }
    },
    
    // ==================== 书库API ====================
    
    library: {
        getList(filters = {}) {
            return API.get('/library', filters);
        },
        
        getFilters() {
            return API.get('/library/filters');
        },
        
        remove(id) {
            return API.delete(`/library/${id}`);
        },
        
        getDownloadUrl(id) {
            // 对路径进行URL编码，防止特殊字符导致问题
            return `${API.baseUrl}/download/file/${encodeURIComponent(id)}`;
        },
        
        matchBook(libraryId, bookId) {
            return API.post('/library/match', { libraryId, bookId });
        }
    },
    
    // ==================== 共享书库API ====================
    
    share: {
        enable() {
            return API.post('/share/enable');
        },
        
        disable() {
            return API.post('/share/disable');
        },
        
        upload(libraryId) {
            return API.post('/share/upload', { libraryId });
        },
        
        getList() {
            return API.get('/share/library');
        },
        
        search(keyword) {
            return API.get('/share/search', { keyword });
        },
        
        download(id) {
            return API.get(`/share/download/${id}`);
        }
    },
    
    // ==================== 历史记录API ====================
    
    history: {
        getList() {
            return API.get('/history');
        },
        
        clear() {
            return API.delete('/history');
        }
    },
    
    // ==================== 排行榜API ====================
    
    rankings: {
        get(type, limit = 100) {
            return API.get(`/rankings/${type}`, { limit });
        }
    }
};
