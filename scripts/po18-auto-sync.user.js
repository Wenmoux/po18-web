// ==UserScript==
// @name         PO18书籍元信息自动同步
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  自动遍历PO18找书页面，收集书籍元信息并上传到本地数据库（支持ID缓存去重）
// @author       You
// @match        https://www.po18.tw/findbooks/*
// @match        https://www.po18.tw/books/*/articles
// @icon         https://www.po18.tw/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        apiUrl: GM_getValue('apiUrl', 'http://localhost:3000'),
        autoSync: GM_getValue('autoSync', false),
        syncOnLoad: GM_getValue('syncOnLoad', true),
        batchMode: GM_getValue('batchMode', false),  // 默认改为false，解析一本上传一本
        delay: GM_getValue('delay', 1500),  // 页面切换延迟（毫秒），减少到500ms提高效率
        maxRetries: 3  // 最大重试次数
    };

    // ==================== 状态管理 ====================
    const state = {
        isRunning: false,
        collectedBooks: [],
        currentPage: 1,
        totalPages: 0,
        successCount: 0,
        failCount: 0,
        skippedCount: 0,  // 跳过的已处理书籍数量
        processedIds: GM_getValue('processedBookIds', [])  // 已处理的书籍ID缓存
    };

    // ==================== 样式 ====================
    GM_addStyle(`
        #po18-sync-panel {
            position: fixed;
            top: 80px;
            right: 20px;
            width: 350px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .po18-sync-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px;
            border-radius: 12px 12px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .po18-sync-header h3 {
            margin: 0;
            font-size: 16px;
        }

        .po18-sync-close {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            line-height: 24px;
        }

        .po18-sync-body {
            padding: 15px;
        }

        .po18-sync-config {
            margin-bottom: 15px;
        }

        .po18-sync-config label {
            display: block;
            margin-bottom: 5px;
            font-size: 13px;
            color: #666;
        }

        .po18-sync-config input[type="text"] {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 13px;
            box-sizing: border-box;
        }

        .po18-sync-stats {
            background: #f8f9fa;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 15px;
        }

        .po18-sync-stat {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 13px;
        }

        .po18-sync-stat:last-child {
            margin-bottom: 0;
        }

        .po18-sync-stat-label {
            color: #666;
        }

        .po18-sync-stat-value {
            font-weight: bold;
            color: #333;
        }

        .po18-sync-buttons {
            display: flex;
            gap: 8px;
        }

        .po18-sync-btn {
            flex: 1;
            padding: 10px;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s;
        }

        .po18-sync-btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }

        .po18-sync-btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .po18-sync-btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .po18-sync-btn-secondary {
            background: #f5f5f5;
            color: #333;
        }

        .po18-sync-btn-secondary:hover {
            background: #e0e0e0;
        }

        .po18-sync-logs {
            margin-top: 15px;
            max-height: 200px;
            overflow-y: auto;
            background: #1a1a2e;
            color: #eee;
            padding: 10px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 11px;
        }

        .po18-sync-log {
            margin-bottom: 4px;
        }

        .po18-sync-log-time {
            color: #888;
        }

        .po18-sync-log-success {
            color: #4CAF50;
        }

        .po18-sync-log-error {
            color: #f44336;
        }

        .po18-sync-log-info {
            color: #eee;
        }

        .po18-sync-toggle {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            z-index: 9999;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        }

        .po18-sync-progress {
            height: 4px;
            background: #e0e0e0;
            border-radius: 2px;
            margin-bottom: 15px;
            overflow: hidden;
        }

        .po18-sync-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            width: 0%;
            transition: width 0.3s;
        }
    `);

    // ==================== UI ====================
    function createUI() {
        // 切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'po18-sync-toggle';
        toggleBtn.className = 'po18-sync-toggle';
        toggleBtn.textContent = '📚 元信息同步';
        toggleBtn.onclick = togglePanel;
        document.body.appendChild(toggleBtn);

        // 主面板
        const panel = document.createElement('div');
        panel.id = 'po18-sync-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
            <div class="po18-sync-header">
                <h3>📚 元信息同步工具</h3>
                <button class="po18-sync-close" onclick="this.closest('#po18-sync-panel').style.display='none'">×</button>
            </div>
            <div class="po18-sync-body">
                <div class="po18-sync-config">
                    <label>本地API地址</label>
                    <input type="text" id="po18-api-url" value="${CONFIG.apiUrl}" placeholder="http://localhost:3000">
                </div>
                
                <div class="po18-sync-config">
                    <label>起始页码（默认从当前页开始）</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="number" id="po18-start-page" min="1" max="${state.totalPages || 822}" placeholder="当前页" 
                               style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
                        <input type="number" id="po18-end-page" min="1" max="${state.totalPages || 822}" placeholder="结束页" 
                               style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
                    </div>
                </div>

                <div class="po18-sync-progress">
                    <div class="po18-sync-progress-bar" id="po18-progress-bar"></div>
                </div>

                <div class="po18-sync-stats">
                    <div class="po18-sync-stat">
                        <span class="po18-sync-stat-label">已收集</span>
                        <span class="po18-sync-stat-value" id="po18-collected">0</span>
                    </div>
                    <div class="po18-sync-stat">
                        <span class="po18-sync-stat-label">已跳过</span>
                        <span class="po18-sync-stat-value" id="po18-skipped">0</span>
                    </div>
                    <div class="po18-sync-stat">
                        <span class="po18-sync-stat-label">已上传</span>
                        <span class="po18-sync-stat-value" id="po18-success">0</span>
                    </div>
                    <div class="po18-sync-stat">
                        <span class="po18-sync-stat-label">失败</span>
                        <span class="po18-sync-stat-value" id="po18-fail">0</span>
                    </div>
                    <div class="po18-sync-stat">
                        <span class="po18-sync-stat-label">当前页/总页数</span>
                        <span class="po18-sync-stat-value" id="po18-page">-</span>
                    </div>
                    <div class="po18-sync-stat">
                        <span class="po18-sync-stat-label">缓存书籍</span>
                        <span class="po18-sync-stat-value" id="po18-cached">0</span>
                    </div>
                </div>

                <div class="po18-sync-buttons">
                    <button class="po18-sync-btn po18-sync-btn-primary" id="po18-start-btn">开始同步</button>
                    <button class="po18-sync-btn po18-sync-btn-secondary" id="po18-upload-btn">批量上传</button>
                </div>
                <div class="po18-sync-buttons" style="margin-top: 8px;">
                    <button class="po18-sync-btn po18-sync-btn-secondary" id="po18-clear-btn">清空数据</button>
                    <button class="po18-sync-btn po18-sync-btn-secondary" id="po18-clear-cache-btn">清空缓存</button>
                </div>

                <div class="po18-sync-logs" id="po18-logs">
                    <div class="po18-sync-log po18-sync-log-info">
                        <span class="po18-sync-log-time">[就绪]</span> 准备开始同步...
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定事件
        document.getElementById('po18-start-btn').onclick = startSync;
        document.getElementById('po18-upload-btn').onclick = uploadBatch;
        document.getElementById('po18-clear-btn').onclick = clearData;
        document.getElementById('po18-clear-cache-btn').onclick = clearCache;
        document.getElementById('po18-api-url').onchange = (e) => {
            CONFIG.apiUrl = e.target.value;
            GM_setValue('apiUrl', e.target.value);
        };

        // 更新缓存统计
        updateStats();
    }

    function togglePanel() {
        const panel = document.getElementById('po18-sync-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    function addLog(message, type = 'info') {
        const logsContainer = document.getElementById('po18-logs');
        if (!logsContainer) return;

        const time = new Date().toLocaleTimeString();
        const log = document.createElement('div');
        log.className = `po18-sync-log po18-sync-log-${type}`;
        log.innerHTML = `<span class="po18-sync-log-time">[${time}]</span> ${message}`;

        logsContainer.insertBefore(log, logsContainer.firstChild);

        // 只保留最新50条
        while (logsContainer.children.length > 50) {
            logsContainer.removeChild(logsContainer.lastChild);
        }
    }

    function updateStats() {
        document.getElementById('po18-collected').textContent = state.collectedBooks.length;
        document.getElementById('po18-skipped').textContent = state.skippedCount;
        document.getElementById('po18-success').textContent = state.successCount;
        document.getElementById('po18-fail').textContent = state.failCount;
        document.getElementById('po18-page').textContent = state.totalPages > 0
            ? `${state.currentPage}/${state.totalPages}`
            : state.currentPage;
        document.getElementById('po18-cached').textContent = state.processedIds.length;
    }

    function updateProgress() {
        if (state.totalPages === 0) return;
        const progress = (state.currentPage / state.totalPages) * 100;
        document.getElementById('po18-progress-bar').style.width = progress + '%';
    }

    // ==================== 书籍信息解析 ====================

    /**
     * 从书籍详情页解析信息
     */
    function parseBookFromDetailPage() {
        try {
            // 从URL获取bookId
            const match = window.location.pathname.match(/\/books\/(\d+)/);
            if (!match) {
                addLog('无法从URL获取书籍ID', 'error');
                return null;
            }
            const bookId = match[1];

            // 解析书名
            const titleEl = document.querySelector('h1.book-title, h1, .book-name');
            const title = titleEl ? titleEl.textContent.trim() : '';

            // 解析作者
            const authorEl = document.querySelector('.author-name, .book-author, a[href*="/users/"]');
            const author = authorEl ? authorEl.textContent.replace(/作者[：:]/g, '').trim() : '';

            // 解析封面
            const coverEl = document.querySelector('.book-cover img, .cover img, img[src*="cover"]');
            const cover = coverEl ? coverEl.src : '';

            // 解析简介
            const descEl = document.querySelector('.book-intro, .book-description, .description');
            const description = descEl ? descEl.textContent.trim() : '';

            // 解析标签
            const tagEls = document.querySelectorAll('.tag, .label, .book-tag');
            const tags = Array.from(tagEls).map(el => el.textContent.trim()).join('·');

            // 解析章节信息
            const chapterEls = document.querySelectorAll('.chapter-item, .chapter, li[class*="chapter"]');
            const totalChapters = chapterEls.length;

            // 解析字数
            const wordCountEl = document.querySelector('.word-count, .book-words');
            const wordCountMatch = wordCountEl ? wordCountEl.textContent.match(/(\d+)/) : null;
            const wordCount = wordCountMatch ? parseInt(wordCountMatch[1]) : 0;

            const bookInfo = {
                bookId,
                title,
                author,
                cover,
                description,
                tags,
                totalChapters,
                wordCount,
                detailUrl: window.location.href
            };

            addLog(`✓ 解析书籍: ${title}`, 'success');
            return bookInfo;

        } catch (error) {
            addLog(`✗ 解析失败: ${error.message}`, 'error');
            return null;
        }
    }

    /**
     * 从搜索/找书页面解析书籍列表（使用PO18实际HTML结构）
     */
    function parseBookListFromSearchPage() {
        return parseBookListFromHTML(document.documentElement.outerHTML);
    }

    /**
     * 获取总页数（从分页链接中提取）
     */
    function getTotalPages() {
        try {
            // PO18实际分页结构：<div class="pagenum"> 中的链接包含 page= 参数
            const pageLinks = document.querySelectorAll('.pagenum .num');
            let maxPage = 1;

            pageLinks.forEach(link => {
                const match = link.href.match(/page=(\d+)/);
                if (match) {
                    const page = parseInt(match[1]);
                    if (page > maxPage) maxPage = page;
                }
            });

            addLog(`检测到总页数: ${maxPage}`, 'info');
            return maxPage;
        } catch (error) {
            addLog('无法获取总页数，默认为1', 'error');
            return 1;
        }
    }

    /**
     * 获取书籍详情（从详情页解析完整信息）
     */
    async function fetchBookDetail(bookId) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://www.po18.tw/books/${bookId}`,
                timeout: 15000,
                onload: function(response) {
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        
                        // 解析封面
                        const coverEl = doc.querySelector('.book_cover img');
                        const cover = coverEl ? coverEl.src : '';
                        
                        // 解析简介
                        const descEl = doc.querySelector('.B_I_content');
                        const description = descEl ? descEl.textContent.trim() : '';
                        
                        // 解析字数和章节数
                        let wordCount = 0;
                        let totalChapters = 0;
                        let freeChapters = 0;
                        let paidChapters = 0;
                        
                        doc.querySelectorAll('table.book_data tbody tr').forEach(row => {
                            const th = row.querySelector('th');
                            const td = row.querySelector('td');
                            if (!th || !td) return;
                            
                            const label = th.textContent.trim();
                            const value = td.textContent.trim();
                            
                            if (label.includes('總字數') || label.includes('总字数')) {
                                wordCount = parseInt(value.replace(/,/g, '')) || 0;
                            } else if (label.includes('免費章回') || label.includes('免费章回')) {
                                freeChapters = parseInt(value) || 0;
                            } else if (label.includes('付費章回') || label.includes('付费章回')) {
                                paidChapters = parseInt(value) || 0;
                            }
                        });
                        
                        totalChapters = freeChapters + paidChapters;
                        
                        // 解析最新章回信息
                        let latestChapterName = '';
                        let latestChapterDate = '';
                        const newChapter = doc.querySelector('.new_chapter');
                        if (newChapter) {
                            const chapterTitle = newChapter.querySelector('h4');
                            if (chapterTitle) {
                                latestChapterName = chapterTitle.textContent.trim();
                            }
                            const dateDiv = newChapter.querySelector('.date');
                            if (dateDiv) {
                                const dateText = dateDiv.textContent.trim();
                                const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
                                if (dateMatch) {
                                    latestChapterDate = dateMatch[1];
                                }
                            }
                        }
                        
                        resolve({
                            cover,
                            description,
                            wordCount,
                            freeChapters,
                            paidChapters,
                            totalChapters,
                            subscribedChapters: totalChapters,
                            latestChapterName,
                            latestChapterDate,
                            platform: 'po18'
                        });
                    } catch (e) {
                        reject(new Error(`解析详情失败: ${e.message}`));
                    }
                },
                onerror: function() {
                    reject(new Error('请求详情失败'));
                },
                ontimeout: function() {
                    reject(new Error('请求超时'));
                }
            });
        });
    }
    
    /**
     * 获取CREF Token
     */
    function getCrefToken() {
        try {
            const crefInput = document.querySelector('input[name="_po18rf-tk001"]');
            if (crefInput) {
                const token = crefInput.value;
                addLog(`✓ 获取到CREF Token: ${token.substring(0, 20)}...`, 'info');
                return token;
            }
            addLog('⚠ 未找到CREF Token', 'error');
            return null;
        } catch (error) {
            addLog(`获取CREF失败: ${error.message}`, 'error');
            return null;
        }
    }

    /**
     * 通过POST请求获取指定页面的HTML（不跳转页面）
     */
    async function fetchPageContent(pageNum) {
        return new Promise((resolve, reject) => {
            const crefToken = getCrefToken();
            if (!crefToken) {
                reject(new Error('无法获取CREF Token'));
                return;
            }

            // 获取当前表单的所有参数
            const formData = new URLSearchParams();
            formData.append('_po18rf-tk001', crefToken);
            formData.append('tag', 'all');
            formData.append('words', 'all');
            formData.append('status', 'all');
            formData.append('sort', 'time');
            formData.append('new', 'all');
            formData.append('tid', '');
            formData.append('page', pageNum);

            addLog(`正在请求第 ${pageNum} 页数据...`, 'info');

            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://www.po18.tw/findbooks/index',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'text/html,application/xhtml+xml,application/xml',
                },
                data: formData.toString(),
                timeout: 30000,
                onload: function(response) {
                    if (response.status === 200) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`请求失败: ${response.status}`));
                    }
                },
                onerror: function() {
                    reject(new Error('网络请求失败'));
                },
                ontimeout: function() {
                    reject(new Error('请求超时'));
                }
            });
        });
    }

    /**
     * 从HTML字符串中解析书籍列表
     */
    function parseBookListFromHTML(html) {
        try {
            // 创建临时DOM来解析HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const books = [];
            let skipped = 0;

            const rows = doc.querySelectorAll('.row');

            if (rows.length === 0) {
                addLog('⚠ 未找到书籍列表', 'error');
                return [];
            }

            rows.forEach((row) => {
                try {
                    const bookLink = row.querySelector('.l_bookname');
                    if (!bookLink) return;

                    const match = bookLink.href.match(/\/books\/(\d+)/);
                    if (!match) return;
                    const bookId = match[1];

                    // 检查是否已处理过此书籍ID
                    if (state.processedIds.includes(bookId)) {
                        skipped++;
                        return;
                    }

                    const title = bookLink.textContent.trim();
                    const authorLink = row.querySelector('.l_author');
                    const author = authorLink ? authorLink.textContent.trim() : '';
                    const tagEls = row.querySelectorAll('.tag');
                    const tags = Array.from(tagEls)
                        .map(tag => tag.textContent.trim())
                        .filter(t => t)
                        .join('·');
                    const chapterLink = row.querySelector('.l_chaptname');
                    const latestChapter = chapterLink ? chapterLink.textContent.trim() : '';
                    const dateEl = row.querySelector('.l_date');
                    const updateTime = dateEl ? dateEl.textContent.trim() : '';
                    const statusEl = row.querySelector('.statu-b');
                    const status = statusEl ? statusEl.textContent.trim() : '';

                    if (bookId && title) {
                        books.push({
                            bookId,
                            title,
                            author,
                            tags,
                            latestChapter,
                            updateTime,
                            status,
                            detailUrl: `https://www.po18.tw/books/${bookId}/articles`,
                            // 添加占位字段
                            cover: '',
                            description: '',
                            wordCount: 0,
                            totalChapters: 0,
                            subscribedChapters: 0
                        });
                    }
                } catch (err) {
                    console.error('解析书籍元素失败:', err);
                }
            });

            state.skippedCount += skipped;
            addLog(`✓ 解析到 ${books.length} 本新书籍，跳过 ${skipped} 本已处理`, 'success');
            return books;

        } catch (error) {
            addLog(`✗ 解析HTML失败: ${error.message}`, 'error');
            return [];
        }
    }

    /**
     * 将书籍ID添加到已处理缓存
     */
    function addToProcessedCache(bookIds) {
        if (!Array.isArray(bookIds)) {
            bookIds = [bookIds];
        }

        bookIds.forEach(bookId => {
            if (!state.processedIds.includes(bookId)) {
                state.processedIds.push(bookId);
            }
        });

        GM_setValue('processedBookIds', state.processedIds);
        updateStats();
    }

    // ==================== 数据上传 ====================

    /**
     * 上传单本书籍
     */
    async function uploadSingleBook(book) {
        return new Promise((resolve, reject) => {
            addLog(`正在上传: ${book.title}...`, 'info');

            GM_xmlhttpRequest({
                method: 'POST',
                url: `${CONFIG.apiUrl}/api/metadata/batch`,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({ books: [book] }),
                timeout: 30000,
                onload: function(response) {
                    // 打印响应状态和内容，方便调试
                    console.log('Response status:', response.status);
                    console.log('Response text:', response.responseText);

                    if (response.status !== 200) {
                        addLog(`✗ 服务器错误: ${book.title} - HTTP ${response.status}`, 'error');
                        addLog(`  响应内容: ${response.responseText.substring(0, 200)}`, 'error');
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }

                    try {
                        const result = JSON.parse(response.responseText);
                        if (result.success) {
                            addLog(`✓ 上传成功: ${book.title} (ID: ${book.bookId})`, 'success');
                            // 上传成功后立即加入缓存
                            addToProcessedCache(book.bookId);
                            resolve(result);
                        } else {
                            addLog(`✗ 上传失败: ${book.title} - ${result.error || '未知错误'}`, 'error');
                            reject(new Error(result.error || '上传失败'));
                        }
                    } catch (e) {
                        addLog(`✗ 解析响应失败: ${book.title}`, 'error');
                        addLog(`  原始响应: ${response.responseText.substring(0, 200)}`, 'error');
                        addLog(`  解析错误: ${e.message}`, 'error');
                        reject(new Error('解析响应失败'));
                    }
                },
                onerror: function(error) {
                    addLog(`✗ 网络请求失败: ${book.title}`, 'error');
                    console.error('Network error:', error);
                    reject(new Error('网络请求失败'));
                },
                ontimeout: function() {
                    addLog(`✗ 请求超时: ${book.title}`, 'error');
                    reject(new Error('请求超时'));
                }
            });
        });
    }

    /**
     * 批量上传书籍
     */
    async function uploadBatch() {
        if (state.collectedBooks.length === 0) {
            addLog('⚠ 没有可上传的数据', 'error');
            return;
        }

        const btn = document.getElementById('po18-upload-btn');
        btn.disabled = true;
        btn.textContent = '上传中...';

        addLog(`开始批量上传 ${state.collectedBooks.length} 本书籍...`, 'info');

        try {
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${CONFIG.apiUrl}/api/metadata/batch`,
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify({ books: state.collectedBooks }),
                    timeout: 60000,
                    onload: function(response) {
                        try {
                            const result = JSON.parse(response.responseText);
                            resolve(result);
                        } catch (e) {
                            reject(new Error('解析响应失败'));
                        }
                    },
                    onerror: function() {
                        reject(new Error('网络请求失败'));
                    },
                    ontimeout: function() {
                        reject(new Error('请求超时'));
                    }
                });
            });

            if (response.success) {
                state.successCount += response.stats.success;
                state.failCount += response.stats.failed;

                addLog(`✓ 上传成功！成功: ${response.stats.success}, 失败: ${response.stats.failed}`, 'success');

                // 上传成功后，将书籍ID添加到缓存
                const successIds = state.collectedBooks.map(book => book.bookId);
                addToProcessedCache(successIds);
                addLog(`已将 ${successIds.length} 个书籍ID加入缓存`, 'info');

                if (response.stats.errors && response.stats.errors.length > 0) {
                    response.stats.errors.forEach(err => {
                        addLog(`  ✗ ${err}`, 'error');
                    });
                }
            } else {
                addLog(`✗ 上传失败: ${response.error}`, 'error');
            }

        } catch (error) {
            addLog(`✗ 上传出错: ${error.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '批量上传';
            updateStats();
        }
    }

    // ==================== 主流程 ====================

    /**
     * 开始同步
     */
    async function startSync() {
        if (state.isRunning) {
            addLog('⚠ 同步正在进行中...', 'error');
            return;
        }

        // 检测当前页面类型
        const isDetailPage = window.location.pathname.includes('/books/') && window.location.pathname.includes('/articles');
        const isFindBooksPage = window.location.pathname.includes('/findbooks');
        const isSearchPage = window.location.pathname.includes('/search') ||
                           window.location.pathname.includes('/category') ||
                           window.location.pathname.includes('/tags');

        if (!isDetailPage && !isFindBooksPage && !isSearchPage) {
            addLog('⚠ 请在书籍详情页或找书页面运行', 'error');
            addLog(`当前路径: ${window.location.pathname}`, 'info');
            return;
        }

        state.isRunning = true;
        const btn = document.getElementById('po18-start-btn');
        btn.disabled = true;
        btn.textContent = '同步中...';

        try {
            if (isDetailPage) {
                // 单本书籍详情页
                addLog('检测到书籍详情页，解析当前书籍...', 'info');
                const book = parseBookFromDetailPage();

                if (book) {
                    state.collectedBooks.push(book);
                    updateStats();

                    if (CONFIG.batchMode) {
                        addLog('✓ 已添加到批量队列，点击"批量上传"提交', 'success');
                    } else {
                        await uploadSingleBook(book);
                        state.successCount++;
                        updateStats();
                    }
                }
            } else if (isFindBooksPage || isSearchPage) {
                // 找书/搜索页面 - 自动遍历所有页面（通过POST请求）
                addLog('检测到找书页面，开始遍历...', 'info');
                addLog('模式：解析一本立即上传一本', 'info');

                state.totalPages = getTotalPages();
                
                // 获取用户自定义页码
                const startPageInput = document.getElementById('po18-start-page');
                const endPageInput = document.getElementById('po18-end-page');
                
                let startPage, endPage;
                
                if (startPageInput && startPageInput.value) {
                    startPage = parseInt(startPageInput.value);
                    if (startPage < 1) startPage = 1;
                    if (startPage > state.totalPages) startPage = state.totalPages;
                } else {
                    const urlMatch = window.location.search.match(/page=(\d+)/);
                    startPage = urlMatch ? parseInt(urlMatch[1]) : 1;
                }
                
                if (endPageInput && endPageInput.value) {
                    endPage = parseInt(endPageInput.value);
                    if (endPage < startPage) endPage = startPage;
                    if (endPage > state.totalPages) endPage = state.totalPages;
                } else {
                    endPage = state.totalPages;
                }
                
                state.currentPage = startPage;

                addLog(`总页数: ${state.totalPages}, 起始: 第${startPage}页, 结束: 第${endPage}页`, 'info');
                addLog(`已缓存书籍: ${state.processedIds.length} 本`, 'info');
                updateStats();
                updateProgress();

                // 如果起始页就是当前页，解析并上传当前页
                if (startPage === (window.location.search.match(/page=(\d+)/) ? parseInt(window.location.search.match(/page=(\d+)/)[1]) : 1)) {
                    addLog(`开始处理第 ${state.currentPage} 页...`, 'info');
                    const currentBooks = parseBookListFromSearchPage();

                    for (const book of currentBooks) {
                        try {
                            // 请求详情页获取完整信息
                            addLog(`正在获取详情: ${book.title}...`, 'info');
                            const detail = await fetchBookDetail(book.bookId);
                            
                            // 合并详情信息
                            Object.assign(book, detail);
                            
                            await uploadSingleBook(book);
                            state.successCount++;
                            updateStats();
                            await new Promise(resolve => setTimeout(resolve, 300)); // 每本书之间延迟300ms
                        } catch (error) {
                            addLog(`✗ 处理失败: ${book.title} - ${error.message}`, 'error');
                            state.failCount++;
                            updateStats();
                        }
                    }
                    addLog(`✓ 第 ${state.currentPage} 页处理完成`, 'success');
                    startPage++; // 当前页处理完，从下一页开始
                }

                // 使用POST请求遍历剩余页面
                for (let page = startPage; page <= endPage; page++) {
                    try {
                        state.currentPage = page;
                        updateStats();
                        updateProgress();

                        addLog(`正在请求第 ${page} 页...`, 'info');
                        await new Promise(resolve => setTimeout(resolve, CONFIG.delay));

                        const html = await fetchPageContent(page);
                        const books = parseBookListFromHTML(html);

                        addLog(`第 ${page} 页解析到 ${books.length} 本新书`, books.length > 0 ? 'success' : 'info');

                        // 立即上传每一本书
                        for (const book of books) {
                            try {
                                // 请求详情页获取完整信息
                                const detail = await fetchBookDetail(book.bookId);
                                Object.assign(book, detail);
                                
                                await uploadSingleBook(book);
                                state.successCount++;
                                updateStats();
                                await new Promise(resolve => setTimeout(resolve, 300));
                            } catch (error) {
                                addLog(`✗ 处理失败: ${book.title}`, 'error');
                                state.failCount++;
                                updateStats();
                            }
                        }

                        addLog(`✓ 第 ${page} 页处理完成 (进度: ${page}/${endPage})`, 'success');

                    } catch (error) {
                        addLog(`✗ 获取第${page}页失败: ${error.message}`, 'error');
                    }
                }

                addLog('🎉 所有页面遍历完成！', 'success');
                addLog(`总计：成功 ${state.successCount} 本，跳过 ${state.skippedCount} 本，失败 ${state.failCount} 本`, 'success');
            }

        } catch (error) {
            addLog(`✗ 同步出错: ${error.message}`, 'error');
        } finally {
            state.isRunning = false;
            btn.disabled = false;
            btn.textContent = '开始同步';
        }
    }

    /**
     * 清空数据
     */
    function clearData() {
        if (confirm('确定要清空已收集的数据吗？（不会清除缓存）')) {
            state.collectedBooks = [];
            state.successCount = 0;
            state.failCount = 0;
            state.skippedCount = 0;
            state.currentPage = 1;
            updateStats();
            addLog('✓ 已清空数据', 'info');
        }
    }

    /**
     * 清空缓存
     */
    function clearCache() {
        if (confirm(`确定要清空书籍ID缓存吗？\n当前缓存了 ${state.processedIds.length} 个书籍ID`)) {
            state.processedIds = [];
            GM_setValue('processedBookIds', []);
            updateStats();
            addLog('✓ 已清空缓存', 'info');
        }
    }

    // ==================== 初始化 ====================

    function init() {
        // 创建UI
        createUI();

        addLog('📚 元信息同步工具已就绪', 'success');
        addLog(`API地址: ${CONFIG.apiUrl}`, 'info');
        addLog(`缓存书籍: ${state.processedIds.length} 个`, 'info');
        addLog('模式：解析一本立即上传一本（自动跳过已缓存）', 'info');
        addLog('提示: 在找书页面点击"开始同步"自动遍历所有页面', 'info');
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
