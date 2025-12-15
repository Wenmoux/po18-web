/**
 * PO18小说下载站 - 主应用模块
 */

const App = {
    currentUser: null,
    currentPage: localStorage.getItem('lastPage') || 'rankings', // 未登录默认显示排行榜
    isAuthMode: 'login', // 'login' or 'register'
    
    // 默认封面占位图 - 使用本地SVG数据代替外部服务
    defaultCover: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iMTEwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSI4MCIgaGVpZ2h0PSIxMTAiIGZpbGw9IiNGRkQwREMiLz48dGV4dCB4PSI0MCIgeT0iNTUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiBmaWxsPSIjRkY4QkE3IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Tm8gQ292ZXI8L3RleHQ+PC9zdmc+',
    
    // 初始化
    async init() {
        this.bindEvents();
        await this.checkAuth();
        this.initSettingsTabs();
        // 加载初始页面数据
        this.loadPageData(this.currentPage);
    },
    
    // 绑定事件
    bindEvents() {
        // 导航点击
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateTo(page);
            });
        });
        
        // 登录/注册按钮
        document.getElementById('btn-login')?.addEventListener('click', () => {
            this.showAuthModal('login');
        });
        
        document.getElementById('btn-register')?.addEventListener('click', () => {
            this.showAuthModal('register');
        });
        
        document.getElementById('purchased-login-btn')?.addEventListener('click', () => {
            this.showAuthModal('login');
        });
        
        // 登出按钮
        document.getElementById('btn-logout')?.addEventListener('click', async () => {
            await this.logout();
        });
        
        // 设置按钮
        document.getElementById('btn-settings')?.addEventListener('click', () => {
            this.showSettingsModal();
        });
        
        // 认证表单
        document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleAuth();
        });
        
        // 认证切换
        document.getElementById('auth-switch-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleAuthMode();
        });
        
        // 关闭弹窗
        document.getElementById('auth-modal-close')?.addEventListener('click', () => {
            this.hideModal('auth-modal');
        });
        
        document.getElementById('settings-modal-close')?.addEventListener('click', () => {
            this.hideModal('settings-modal');
        });
        
        document.getElementById('book-modal-close')?.addEventListener('click', () => {
            this.hideModal('book-modal');
        });
        
        // 点击遮罩关闭
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('active');
                }
            });
        });
        
        // 首页搜索事件已移除，因为首页已取消
        
        // 搜索页搜索
        
        // 刷新已购书籍
        document.getElementById('refresh-purchased')?.addEventListener('click', () => {
            this.loadPurchasedBooks(true);
        });
        
        // 清除已完成队列
        document.getElementById('clear-completed')?.addEventListener('click', async () => {
            await API.queue.clearCompleted();
            this.loadDownloads();
            this.showToast('已清除完成的任务', 'success');
        });
        
        // Cookie设置
        document.getElementById('save-cookie')?.addEventListener('click', async () => {
            const cookie = document.getElementById('po18-cookie').value.trim();
            await this.saveCookie(cookie);
        });
        
        document.getElementById('validate-cookie')?.addEventListener('click', async () => {
            await this.validateCookie();
        });
        
        // WebDAV设置
        document.getElementById('save-webdav')?.addEventListener('click', async () => {
            await this.saveWebDAVConfig();
        });
        
        document.getElementById('test-webdav')?.addEventListener('click', async () => {
            await this.testWebDAVConnection();
        });
        
        // 共享设置
        document.getElementById('save-share-settings')?.addEventListener('click', async () => {
            await this.saveShareSettings();
        });
        
        // 共享功能（使用事件委托处理动态创建的按钮）
        document.body.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'enable-share-btn') {
                e.preventDefault();
                this.enableShare();
            }
        });
        
        // 共享书库搜索
        document.getElementById('share-search-btn')?.addEventListener('click', () => {
            const keyword = document.getElementById('share-search-input').value.trim();
            this.loadSharedLibrary(keyword);
        });
        
        // 统一输入框的三个按钮
        // 1. 解析按钮
        document.getElementById('parse-book-btn')?.addEventListener('click', () => {
            this.handleParseBook();
        });
        
        // 2. 下载按钮（添加到队列）
        document.getElementById('quick-download-btn')?.addEventListener('click', () => {
            this.handleQuickDownload();
        });
        
        // 3. 搜索按钮
        document.getElementById('search-btn')?.addEventListener('click', () => {
            this.handleSearch();
        });
        
        // 回车键触发搜索
        document.getElementById('unified-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                // 默认触发搜索
                this.handleSearch();
            }
        });
        
        // 书库筛选器事件
        document.getElementById('library-category-filter')?.addEventListener('change', () => {
            this.loadLibrary();
        });
        document.getElementById('library-author-filter')?.addEventListener('change', () => {
            this.loadLibrary();
        });
        document.getElementById('library-format-filter')?.addEventListener('change', () => {
            this.loadLibrary();
        });
        document.getElementById('library-clear-filter')?.addEventListener('click', () => {
            document.getElementById('library-category-filter').value = '';
            document.getElementById('library-author-filter').value = '';
            document.getElementById('library-format-filter').value = '';
            this.loadLibrary();
        });
        
        // 共享书库筛选器事件
        document.getElementById('shared-category-filter')?.addEventListener('change', () => {
            this.loadSharedLibrary();
        });
        document.getElementById('shared-format-filter')?.addEventListener('change', () => {
            this.loadSharedLibrary();
        });
        document.getElementById('shared-clear-filter')?.addEventListener('click', () => {
            document.getElementById('shared-category-filter').value = '';
            document.getElementById('shared-format-filter').value = '';
            this.loadSharedLibrary();
        });
        
        // 清空下载记录
        document.getElementById('clear-history-btn')?.addEventListener('click', async () => {
            if (confirm('确定要清空所有下载记录吗？')) {
                await API.history.clear();
                this.loadDownloads();
                this.showToast('已清空下载记录', 'success');
            }
        });
        
        // 标签页切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                
                // 更新按钮状态
                btn.parentElement.querySelectorAll('.tab-btn').forEach(b => {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
                
                // 更新内容显示
                const parent = btn.closest('.page');
                parent.querySelectorAll('.tab-content').forEach(c => {
                    c.classList.remove('active');
                });
                parent.querySelector(`#tab-${tab}`)?.classList.add('active');
            });
        });
    },
    
    // 处理快速下载
    async handleQuickDownload() {
        const input = document.getElementById('unified-input')?.value.trim();
        const format = document.getElementById('quick-download-format')?.value || 'txt';
        
        if (!input) {
            this.showToast('请输入书籍ID或链接', 'error');
            return;
        }
        
        if (!this.currentUser) {
            this.showAuthModal('login');
            return;
        }
        
        const btn = document.getElementById('quick-download-btn');
        btn.disabled = true;
        btn.textContent = '解析中...';
        
        try {
            const result = await API.quickDownload(input, format);
            this.showToast(`已添加到下载队列：${result.bookInfo.title}`, 'success');
            document.getElementById('unified-input').value = '';
            
            // 显示书籍信息
            if (document.getElementById('parsed-book-info')) {
                document.getElementById('parsed-book-info').innerHTML = `
                    <div class="book-card">
                        <div class="book-card-body">
                            <img class="book-cover" src="${result.bookInfo.cover || App.defaultCover}" 
                                 alt="${result.bookInfo.title}" onerror="this.src=App.defaultCover">
                            <div class="book-info">
                                <div class="book-title">${result.bookInfo.title}</div>
                                <div class="book-author">作者：${result.bookInfo.author || '未知'}</div>
                                <div style="color: var(--success-color); margin-top: 10px;">✅ 已添加到下载队列</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            this.showToast('添加失败：' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '添加到队列';
        }
    },
    
    // 处理解析书籍
    async handleParseBook() {
        const input = document.getElementById('unified-input')?.value.trim();
        
        if (!input) {
            this.showToast('请输入书籍ID或链接', 'error');
            return;
        }
        
        const btn = document.getElementById('parse-book-btn');
        btn.disabled = true;
        btn.textContent = '解析中...';
        
        try {
            const book = await API.parseBookInput(input);
            
            if (document.getElementById('parsed-book-info')) {
                const warningMsg = book.hasError ? `<div style="color: #ff9800; font-size: 12px; margin-top: 5px;">⚠️ ${book.error || '获取详情失败，显示基本信息'}</div>` : '';
                
                // 构建状态显示
                const statusText = {
                    'completed': '完结',
                    'ongoing': '连载中',
                    'unknown': '未知'
                }[book.status] || '未知';
                
                // 构建详细信息
                const statsHtml = `
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 10px; font-size: 13px;">
                        <div><strong>状态:</strong> ${statusText}</div>
                        <div><strong>总字数:</strong> ${book.wordCount ? book.wordCount.toLocaleString() : '未知'}</div>
                        <div><strong>总章节:</strong> ${book.chapterCount || 0}</div>
                        <div><strong>免费章节:</strong> ${book.freeChapters || 0}</div>
                        <div><strong>付费章节:</strong> ${book.paidChapters || 0}</div>
                    </div>
                `;
                
                // 简介
                const descriptionHtml = book.description ? `
                    <div style="margin-top: 10px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-size: 13px;">
                        <strong>简介:</strong>
                        <div style="margin-top: 5px; color: #666; max-height: 100px; overflow-y: auto;">${book.description}</div>
                    </div>
                ` : '';
                
                document.getElementById('parsed-book-info').innerHTML = `
                    <div class="book-card" style="cursor: pointer;" onclick="window.location.href='/book-detail.html?id=${book.bookId}'">
                        <div class="book-card-body">
                            <img class="book-cover" src="${book.cover || App.defaultCover}" 
                                 alt="${book.title}" onerror="this.src=App.defaultCover">
                            <div class="book-info" style="flex: 1;">
                                <div class="book-title" style="cursor: pointer;">${book.title}</div>
                                <div class="book-author">作者：${book.author || '未知'}</div>
                                <div class="book-tags">${book.tags || ''}</div>
                                <div style="font-size: 12px; color: #888; margin-top: 5px;">ID: ${book.bookId}</div>
                                ${statsHtml}
                                ${descriptionHtml}
                                ${warningMsg}
                            </div>
                        </div>
                    </div>
                `;
            }
            
            this.showToast(book.hasError ? '解析完成（部分信息可能不完整）' : '解析成功', book.hasError ? 'warning' : 'success');
        } catch (error) {
            this.showToast('解析失败：' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '解析';
        }
    },
    
    // 处理搜索
    async handleSearch() {
        const input = document.getElementById('unified-input')?.value.trim();
        
        if (!input) {
            this.showToast('请输入搜索关键词', 'error');
            return;
        }
        
        await this.doSearch(input);
    },
    
    // 页面导航
    navigateTo(page) {
        this.currentPage = page;
        
        // 保存当前页面到本地存储
        localStorage.setItem('lastPage', page);
        
        // 更新导航状态
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });
        
        // 更新页面显示
        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === `page-${page}`);
        });
        
        // 加载页面数据
        this.loadPageData(page);
    },
    
    // 加载页面数据
    async loadPageData(page) {
        switch (page) {
            case 'download':
                // 快速下载页，加载共享书库部分
                this.loadSharedPage();
                break;
            case 'rankings':
                // 排行榜页
                this.loadRankings();
                break;
            case 'purchased':
                if (this.currentUser) {
                    this.loadPurchasedBooks();
                } else {
                    document.getElementById('purchased-login-required').style.display = 'block';
                    document.getElementById('purchased-list').innerHTML = '';
                }
                break;
            case 'downloads':
                // 下载管理页，加载统一列表
                this.loadDownloads();
                break;
            case 'library':
                this.loadLibrary();
                break;
        }
    },
    
    // 检查认证状态
    async checkAuth() {
        try {
            const user = await API.auth.getMe();
            this.currentUser = user;
            this.updateUserUI();
            
            // 如果当前在下载页面且未登录，跳转到排行榜
            if (!this.currentUser && this.currentPage === 'download') {
                this.navigateTo('rankings');
            }
        } catch (error) {
            this.currentUser = null;
            this.updateUserUI();
            
            // 未登录时，如果当前在下载页面，跳转到排行榜
            if (this.currentPage === 'download') {
                this.navigateTo('rankings');
            }
        }
    },
    
    // 更新用户UI
    updateUserUI() {
        const userArea = document.getElementById('user-area');
        const userInfo = document.getElementById('user-info');
        const usernameDisplay = document.getElementById('username-display');
        const adminLink = document.getElementById('admin-link');
        
        if (this.currentUser) {
            userArea.style.display = 'none';
            userInfo.style.display = 'flex';
            usernameDisplay.textContent = this.currentUser.username;
            
            // 显示管理员入口
            if (adminLink) {
                // admin用户显示管理入口
                adminLink.style.display = this.currentUser.username === 'admin' ? 'inline-block' : 'none';
            }
            
            // 更新已购书籍页面
            document.getElementById('purchased-login-required').style.display = 
                this.currentUser.hasPo18Cookie ? 'none' : 'block';
        } else {
            userArea.style.display = 'flex';
            userInfo.style.display = 'none';
            if (adminLink) adminLink.style.display = 'none';
        }
    },
    
    // 显示认证弹窗
    showAuthModal(mode) {
        this.isAuthMode = mode;
        this.updateAuthModalUI();
        this.showModal('auth-modal');
    },
    
    // 切换认证模式
    toggleAuthMode() {
        this.isAuthMode = this.isAuthMode === 'login' ? 'register' : 'login';
        this.updateAuthModalUI();
    },
    
    // 更新认证弹窗UI
    updateAuthModalUI() {
        const title = document.getElementById('auth-modal-title');
        const submitBtn = document.getElementById('auth-submit');
        const switchText = document.getElementById('auth-switch-text');
        const switchLink = document.getElementById('auth-switch-link');
        
        if (this.isAuthMode === 'login') {
            title.textContent = '登录';
            submitBtn.textContent = '登录';
            switchText.textContent = '还没有账号？';
            switchLink.textContent = '去注册';
        } else {
            title.textContent = '注册';
            submitBtn.textContent = '注册';
            switchText.textContent = '已有账号？';
            switchLink.textContent = '去登录';
        }
        
        document.getElementById('auth-error').textContent = '';
    },
    
    // 处理认证
    async handleAuth() {
        const username = document.getElementById('auth-username').value.trim();
        const password = document.getElementById('auth-password').value;
        const errorEl = document.getElementById('auth-error');
        
        try {
            if (this.isAuthMode === 'login') {
                await API.auth.login(username, password);
            } else {
                await API.auth.register(username, password);
            }
            
            this.hideModal('auth-modal');
            await this.checkAuth();
            this.showToast(this.isAuthMode === 'login' ? '登录成功' : '注册成功', 'success');
            
            // 清空表单
            document.getElementById('auth-username').value = '';
            document.getElementById('auth-password').value = '';
        } catch (error) {
            errorEl.textContent = error.message;
        }
    },
    
    // 登出
    async logout() {
        try {
            await API.auth.logout();
            this.currentUser = null;
            this.updateUserUI();
            this.navigateTo('shared');
            this.showToast('已登出', 'info');
        } catch (error) {
            this.showToast('登出失败', 'error');
        }
    },
    
    // 搜索
    async doSearch(keyword, page = 1) {
        const resultsContainer = document.getElementById('search-results');
        resultsContainer.innerHTML = '<p class="empty-message">搜索中...</p>';
        
        try {
            const result = await API.search(keyword, page);
            this.renderSearchResults(result);
        } catch (error) {
            resultsContainer.innerHTML = `<p class="empty-message">搜索失败：${error.message}</p>`;
        }
    },
    
    // 渲染搜索结果
    renderSearchResults(result) {
        const container = document.getElementById('search-results');
        
        if (!result.books || result.books.length === 0) {
            container.innerHTML = '<p class="empty-message">未找到相关小说</p>';
            return;
        }
        
        // 使用新的搜索结果卡片渲染（支持版本和共享库）
        container.innerHTML = result.books.map(book => this.renderSearchResultCard(book)).join('');
        this.bindSearchResultEvents();
    },
    
    // 渲染搜索结果卡片（支持版本和共享库下载）
    renderSearchResultCard(book) {
        const cover = book.cover || App.defaultCover;
        const tags = book.tags ? book.tags.split('·').filter(t => t).slice(0, 3).map(t => 
            `<span class="book-tag">${t.trim()}</span>`
        ).join('') : '';
        
        // 渲染版本列表
        let versionsHtml = '';
        if (book.versions && book.versions.length > 0) {
            versionsHtml = `
                <div class="book-versions">
                    <div class="versions-title">可用版本：</div>
                    ${book.versions.map(v => {
                        const hasShared = v.sharedFiles && v.sharedFiles.length > 0;
                        const sharedBtns = hasShared ? v.sharedFiles.map(sf => 
                            `<button class="btn btn-xs btn-primary download-shared-btn" data-id="${sf.id}" title="下载次数: ${sf.downloadCount || 0}">
                                下载${sf.format.toUpperCase()}
                            </button>`
                        ).join('') : '';
                        
                        return `
                            <div class="version-item">
                                <span class="version-info">
                                    <span class="chapter-count">${v.subscribedChapters || 0}章</span>
                                    ${v.totalChapters ? `<span class="total-chapters">(共${v.totalChapters}章)</span>` : ''}
                                </span>
                                <span class="version-actions">
                                    ${sharedBtns}
                                    ${hasShared ? '' : '<span class="no-shared">无共享</span>'}
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }
        
        return `
            <div class="book-card search-result-card" style="cursor: pointer;" onclick="window.location.href='/book-detail.html?id=${book.bookId}'">
                <div class="book-card-body">
                    <img class="book-cover" src="${cover}" alt="${book.title}" onerror="this.src=App.defaultCover">
                    <div class="book-info">
                        <div class="book-title">${book.title}</div>
                        <div class="book-author">作者：${book.author || '未知'}</div>
                        <div class="book-tags">${tags}</div>
                        ${versionsHtml}
                    </div>
                </div>
                <div class="book-card-footer" onclick="event.stopPropagation();">
                    <button class="btn btn-sm btn-outline view-detail-btn" data-book-id="${book.bookId}">详情</button>
                    <button class="btn btn-sm btn-primary add-queue-btn" data-book-id="${book.bookId}" title="下载自己订阅的章节">下载订阅</button>
                </div>
            </div>
        `;
    },
    
    // 绑定搜索结果事件
    bindSearchResultEvents() {
        // 查看详情 - 跳转到详情页
        document.querySelectorAll('.search-result-card .view-detail-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const bookId = btn.dataset.bookId;
                window.location.href = `/book-detail.html?id=${bookId}`;
            });
        });
        
        // 加入队列（下载自己订阅的章节）
        document.querySelectorAll('.search-result-card .add-queue-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!this.currentUser) {
                    this.showAuthModal('login');
                    return;
                }
                const bookId = btn.dataset.bookId;
                await this.addToQueue(bookId);
            });
        });
        
        // 下载共享文件
        document.querySelectorAll('.search-result-card .download-shared-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!this.currentUser) {
                    this.showAuthModal('login');
                    return;
                }
                const id = btn.dataset.id;
                await this.downloadSharedBook(id);
            });
        });
    },
    
    // 渲染书籍卡片
    renderBookCard(book, type = 'search') {
        const cover = book.cover || App.defaultCover;
        const tags = book.tags ? book.tags.split('·').filter(t => t).slice(0, 3).map(t => 
            `<span class="book-tag">${t.trim()}</span>`
        ).join('') : '';
        
        // 构建详细统计信息
        let statsInfo = '';
        if (type === 'search' || type === 'purchased') {
            const status = book.status || 'unknown';
            const statusText = {
                'completed': '完结',
                'ongoing': '连载中',
                '已完結': '完结',
                '連載中': '连载中',
                'unknown': ''
            }[status] || status;
            
            const wordCount = book.wordCount || book.word_count;
            const chapterCount = book.chapterCount || book.total_chapters || book.subscribed_chapters;
            
            // 已购书籍显示已购/可购章节
            const purchasedInfo = (type === 'purchased' && (book.available_chapters || book.purchased_chapters)) 
                ? `<span style="margin-left: 10px;">📚 已购 ${book.purchased_chapters || 0}/${book.available_chapters || 0}章</span>` 
                : '';
            
            statsInfo = `
                <div class="book-stats" style="font-size: 12px; color: #666; margin-top: 5px;">
                    ${statusText ? `<span>📖 ${statusText}</span>` : ''}
                    ${wordCount ? `<span style="margin-left: 10px;">📝 ${wordCount.toLocaleString()}字</span>` : ''}
                    ${chapterCount ? `<span style="margin-left: 10px;">📚 ${chapterCount}章</span>` : ''}
                    ${purchasedInfo}
                </div>
            `;
        }
        
        let actions = '';
        let extraInfo = '';
        
        if (type === 'search' || type === 'purchased') {
            actions = `
                <button class="btn btn-sm btn-outline view-detail-btn" data-book-id="${book.bookId || book.book_id}">详情</button>
                <button class="btn btn-sm btn-primary add-queue-btn" data-book-id="${book.bookId || book.book_id}">加入队列</button>
            `;
        } else if (type === 'library') {
            // 书库中的书籍，如果书名为空或未知，显示文件名
            const displayTitle = (book.title && book.title !== '未知') ? book.title : (book.filename || book.title || '未知书籍');
            const needsMatch = !book.title || book.title === '未知' || !book.author;
            
            actions = `
                <a href="${API.library.getDownloadUrl(book.id)}" class="btn btn-sm btn-primary" download>下载</a>
                ${needsMatch ? '<button class="btn btn-sm btn-outline match-book-btn" data-id="' + book.id + '" data-filename="' + (book.filename || '') + '">匹配</button>' : ''}
                <button class="btn btn-sm btn-outline share-book-btn" data-id="${book.id}">共享</button>
                <button class="btn btn-sm btn-outline delete-library-btn" data-id="${book.id}">删除</button>
            `;
            
            // 替换book.title用于显示
            book = {...book, title: displayTitle};
        } else if (type === 'shared') {
            // 共享书籍显示上传者和下载次数
            extraInfo = `
                <div class="book-share-info">
                    <span class="uploader">上传者: ${book.uploaderName || book.uploader_name || '未知'}</span>
                    <span class="download-count">下载: ${book.downloadCount || book.download_count || 0}次</span>
                </div>
            `;
            actions = `
                <button class="btn btn-sm btn-primary download-shared-btn" data-id="${book.id}">下载</button>
            `;
        }
        
        const bookIdValue = book.bookId || book.book_id;
        const titleElement = bookIdValue 
            ? `<a href="/book-detail.html?id=${bookIdValue}" class="book-title" style="text-decoration: none; color: inherit; cursor: pointer;">${book.title}</a>`
            : `<div class="book-title">${book.title}</div>`;
        
        return `
            <div class="book-card">
                <div class="book-card-body">
                    <img class="book-cover" src="${cover}" alt="${book.title}" onerror="this.src=App.defaultCover">
                    <div class="book-info">
                        ${titleElement}
                        <div class="book-author">作者：${book.author || '未知'}</div>
                        <div class="book-tags">${tags}</div>
                        ${statsInfo}
                        ${extraInfo}
                    </div>
                </div>
                <div class="book-card-footer">
                    ${actions}
                </div>
            </div>
        `;
    },
    
    // 绑定书籍卡片事件
    bindBookCardEvents() {
        // 查看详情 - 跳转到详情页
        document.querySelectorAll('.view-detail-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const bookId = btn.dataset.bookId;
                window.location.href = `/book-detail.html?id=${bookId}`;
            });
        });
        
        // 加入队列
        document.querySelectorAll('.add-queue-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!this.currentUser) {
                    this.showAuthModal('login');
                    return;
                }
                
                const bookId = btn.dataset.bookId;
                await this.addToQueue(bookId);
            });
        });
        
        // 删除书库
        document.querySelectorAll('.delete-library-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                if (confirm('确定要删除这本书吗？')) {
                    await API.library.remove(id);
                    this.loadLibrary();
                    this.showToast('已删除', 'success');
                }
            });
        });
        
        // 共享书籍
        document.querySelectorAll('.share-book-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                await this.shareBook(id);
            });
        });
        
        // 匹配书籍
        document.querySelectorAll('.match-book-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const filename = btn.dataset.filename;
                await this.matchBook(id, filename);
            });
        });
        
        // 下载共享书籍
        document.querySelectorAll('.download-shared-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                await this.downloadSharedBook(id);
            });
        });
    },
    
    // 显示书籍详情
    async showBookDetail(bookId) {
        try {
            const book = await API.getBookDetail(bookId);
            
            const modalBody = document.getElementById('book-modal-body');
            modalBody.innerHTML = `
                <div class="book-detail">
                    <div class="book-card-body" style="margin-bottom: 20px;">
                        <img class="book-cover" src="${book.cover || ''}" alt="${book.title}" style="width: 120px; height: 165px;">
                        <div class="book-info">
                            <div class="book-title" style="font-size: 20px;">${book.title}</div>
                            <div class="book-author" style="font-size: 15px;">作者：${book.author}</div>
                            <div class="book-tags" style="margin-top: 10px;">
                                ${book.tags ? book.tags.split('·').map(t => `<span class="book-tag">${t.trim()}</span>`).join('') : ''}
                            </div>
                            <div style="margin-top: 10px; color: var(--text-secondary);">
                                章节数：${book.chapterCount || '未知'}
                            </div>
                        </div>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin-bottom: 10px; color: var(--primary-dark);">简介</h4>
                        <p style="color: var(--text-secondary); line-height: 1.8;">${book.description || '暂无简介'}</p>
                    </div>
                    <div class="form-group">
                        <label>下载格式</label>
                        <select id="download-format" style="width: 100%; padding: 10px; border-radius: 8px; border: 2px solid var(--border-color);">
                            <option value="txt">TXT</option>
                            <option value="html">HTML</option>
                            <option value="epub">EPUB</option>
                        </select>
                    </div>
                    <div class="form-group" style="display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="share-after-download" style="width: auto;">
                        <label for="share-after-download" style="margin: 0; cursor: pointer;">下载完成后自动共享</label>
                    </div>
                    <button class="btn btn-primary btn-block" id="add-to-queue-modal" data-book-id="${bookId}">加入下载队列</button>
                </div>
            `;
            
            document.getElementById('book-modal-title').textContent = book.title;
            this.showModal('book-modal');
            
            // 绑定加入队列事件
            document.getElementById('add-to-queue-modal')?.addEventListener('click', async () => {
                const format = document.getElementById('download-format').value;
                const autoShare = document.getElementById('share-after-download')?.checked || false;
                await this.addToQueue(bookId, format, autoShare);
                this.hideModal('book-modal');
            });
        } catch (error) {
            this.showToast('获取详情失败：' + error.message, 'error');
        }
    },
    
    // 加入下载队列
    async addToQueue(bookId, format = 'txt', autoShare = false) {
        try {
            await API.queue.add(bookId, format, autoShare);
            const message = autoShare ? '已加入下载队列，完成后将自动共享' : '已加入下载队列';
            this.showToast(message, 'success');
            
            // 如果当前在下载管理页面，刷新
            if (this.currentPage === 'downloads') {
                this.loadDownloads();
            }
        } catch (error) {
            this.showToast('加入队列失败：' + error.message, 'error');
        }
    },
    
    // 加载已购书籍
    async loadPurchasedBooks(refresh = false) {
        if (!this.currentUser) return;
        
        const container = document.getElementById('purchased-list');
        const loginRequired = document.getElementById('purchased-login-required');
        
        if (!this.currentUser.hasPo18Cookie) {
            loginRequired.innerHTML = `
                <p>请先在设置中配置PO18 Cookie</p>
                <button class="btn btn-primary" onclick="App.showSettingsModal()">去设置</button>
            `;
            loginRequired.style.display = 'block';
            return;
        }
        
        loginRequired.style.display = 'none';
        container.innerHTML = '<p class="empty-message">加载中...</p>';
        
        try {
            const result = await API.purchased.getList(refresh);
            
            if (result.books.length === 0) {
                container.innerHTML = '<p class="empty-message">没有找到已购书籍</p>';
                return;
            }
            
            container.innerHTML = result.books.map(book => this.renderBookCard(book, 'purchased')).join('');
            this.bindBookCardEvents();
            
            if (result.fromCache) {
                this.showToast('从缓存加载，点击刷新获取最新数据', 'info');
            }
        } catch (error) {
            container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
        }
    },
    
    // 加载下载队列
    async loadQueue() {
        if (!this.currentUser) return;
        
        const container = document.getElementById('queue-list');
        
        try {
            const queue = await API.queue.getList();
            
            if (queue.length === 0) {
                container.innerHTML = '<p class="empty-message">下载队列为空</p>';
                return;
            }
            
            container.innerHTML = queue.map(item => this.renderQueueItem(item)).join('');
            this.bindQueueEvents();
        } catch (error) {
            container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
        }
    },
    
    // 渲染队列项
    renderQueueItem(item) {
        const statusText = {
            pending: '等待中',
            downloading: '下载中',
            completed: '已完成',
            failed: '失败'
        };
        
        const progress = item.total_chapters > 0 
            ? Math.round((item.progress / item.total_chapters) * 100) 
            : 0;
        
        return `
            <div class="queue-item">
                <div class="queue-item-header">
                    <span class="queue-item-title">${item.title}</span>
                    <span class="queue-status ${item.status}">${statusText[item.status] || item.status}</span>
                </div>
                ${item.status === 'downloading' ? `
                    <div class="queue-progress">
                        <div class="queue-progress-bar" style="width: ${progress}%"></div>
                    </div>
                    <div class="queue-progress-text">${item.progress}/${item.total_chapters} 章节 (${progress}%)</div>
                ` : ''}
                ${item.status === 'failed' ? `
                    <div style="color: var(--error-color); font-size: 13px; margin-top: 10px;">
                        错误：${item.error_message || '未知错误'}
                    </div>
                ` : ''}
                <div style="display: flex; gap: 10px; margin-top: 15px; justify-content: flex-end;">
                    ${item.status === 'pending' ? `
                        <button class="btn btn-sm btn-primary start-download-btn" data-id="${item.id}">开始下载</button>
                    ` : ''}
                    <button class="btn btn-sm btn-outline remove-queue-btn" data-id="${item.id}">移除</button>
                </div>
            </div>
        `;
    },
    
    // 绑定队列事件
    bindQueueEvents() {
        // 开始下载
        document.querySelectorAll('.start-download-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt(btn.dataset.id);
                const downloadItem = btn.closest('.download-item');
                if (!downloadItem) {
                    console.error('找不到下载项元素');
                    return;
                }
                
                btn.disabled = true;
                btn.textContent = '连接中...';
                
                // 创建或更新进度显示
                let progressContainer = downloadItem.querySelector('.queue-progress-container');
                if (!progressContainer) {
                    progressContainer = document.createElement('div');
                    progressContainer.className = 'queue-progress-container';
                    progressContainer.innerHTML = `
                        <div class="queue-progress">
                            <div class="queue-progress-bar" style="width: 0%"></div>
                        </div>
                        <div class="queue-progress-text">0%</div>
                    `;
                    // 将进度容器插入到下载项中
                    const titleDiv = downloadItem.querySelector('h4')?.parentElement;
                    if (titleDiv) {
                        titleDiv.after(progressContainer);
                    }
                }
                
                const progressBar = progressContainer.querySelector('.queue-progress-bar');
                const progressText = progressContainer.querySelector('.queue-progress-text');
                
                // 订阅进度更新 (轮询方式)
                const progressWatcher = API.queue.subscribeProgress(id, async (data) => {
                    switch (data.type) {
                        case 'progress':
                            btn.textContent = '下载中...';
                            progressBar.style.width = `${data.percent}%`;
                            progressText.textContent = `${data.completed}/${data.total} 章节 (${data.percent}%)`;
                            break;
                        case 'completed':
                            progressBar.style.width = '100%';
                            progressText.textContent = '生成文件中...';
                            
                            // **新版：在浏览器端生成文件**
                            if (data.chapters && data.detail) {
                                try {
                                    console.log('在浏览器端生成文件...', data);
                                    
                                    // 获取格式（从文件名提取）
                                    const format = data.fileName.split('.').pop().toLowerCase();
                                    let blob;
                                    
                                    if (format === 'epub') {
                                        // 生成 EPUB
                                        progressText.textContent = '生成EPUB中...';
                                        blob = await FileGenerator.generateEpub(data.detail, data.chapters);
                                    } else {
                                        // 生成 TXT
                                        progressText.textContent = '生成TXT中...';
                                        blob = FileGenerator.generateTxt(data.detail, data.chapters);
                                    }
                                    
                                    // 下载文件
                                    progressText.textContent = '下载完成!';
                                    FileGenerator.download(blob, data.fileName);
                                    
                                    const fileSize = FileGenerator.formatFileSize(blob.size);
                                    this.showToast(`下载完成！文件大小: ${fileSize}`, 'success');
                                    console.log('文件生成完成:', data.fileName, fileSize);
                                } catch (e) {
                                    console.error('生成文件失败:', e);
                                    this.showToast('生成文件失败: ' + e.message, 'error');
                                }
                            }
                            // **兼容旧版：base64数据**
                            else if (data.downloadData && data.fileName) {
                                try {
                                    const binaryString = atob(data.downloadData);
                                    const bytes = new Uint8Array(binaryString.length);
                                    for (let i = 0; i < binaryString.length; i++) {
                                        bytes[i] = binaryString.charCodeAt(i);
                                    }
                                    const blob = new Blob([bytes]);
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = data.fileName;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                    this.showToast('下载完成！', 'success');
                                } catch (e) {
                                    console.error('下载文件失败:', e);
                                    this.showToast('下载文件失败', 'error');
                                }
                            }
                            
                            progressWatcher.close();
                            
                            setTimeout(() => {
                                this.loadDownloads();
                                this.loadLibrary();
                            }, 1000);
                            break;
                        case 'error':
                            progressText.textContent = `失败: ${data.error}`;
                            progressText.style.color = 'var(--error-color)';
                            progressWatcher.close();
                            this.showToast('下载失败：' + data.error, 'error');
                            btn.disabled = false;
                            btn.textContent = '重试';
                            break;
                    }
                });
                
                // 开始下载请求
                try {
                    await API.queue.startDownload(id);
                } catch (error) {
                    progressWatcher.close();
                    this.showToast('下载失败：' + error.message, 'error');
                    btn.disabled = false;
                    btn.textContent = '重试';
                    progressText.textContent = `失败: ${error.message}`;
                    progressText.style.color = 'var(--error-color)';
                }
            });
        });
        
        // 移除队列
        document.querySelectorAll('.remove-queue-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                await API.queue.remove(id);
                this.loadDownloads();
            });
        });
    },
    
    // 加载书库
    async loadLibrary() {
        if (!this.currentUser) return;
        
        const container = document.getElementById('library-list');
        
        // 获取筛选条件
        const category = document.getElementById('library-category-filter')?.value || '';
        const author = document.getElementById('library-author-filter')?.value || '';
        const format = document.getElementById('library-format-filter')?.value || '';
        
        try {
            // 加载筛选器选项
            await this.loadLibraryFilters();
            
            const books = await API.library.getList({ category, author, format });
            
            if (books.length === 0) {
                container.innerHTML = '<p class="empty-message">书库为空，去下载一些小说吧</p>';
                return;
            }
            
            container.innerHTML = books.map(book => this.renderBookCard(book, 'library')).join('');
            this.bindBookCardEvents();
        } catch (error) {
            container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
        }
    },
    
    // 加载书库筛选器选项
    async loadLibraryFilters() {
        // 未登录时不加载筛选器
        if (!this.currentUser) return;
        
        try {
            const filters = await API.library.getFilters();
            
            // 分类已在HTML中静态设置，不需要动态加载
            
            // 更新作者筛选
            const authorSelect = document.getElementById('library-author-filter');
            const currentAuthor = authorSelect?.value || '';
            if (authorSelect && filters.authors) {
                authorSelect.innerHTML = '<option value="">所有作者</option>' +
                    filters.authors.map(a => `<option value="${a}" ${a === currentAuthor ? 'selected' : ''}>${a}</option>`).join('');
            }
            
            // 更新格式筛选
            const formatSelect = document.getElementById('library-format-filter');
            const currentFormat = formatSelect?.value || '';
            if (formatSelect && filters.formats) {
                formatSelect.innerHTML = '<option value="">所有格式</option>' +
                    filters.formats.map(f => `<option value="${f}" ${f === currentFormat ? 'selected' : ''}>${f.toUpperCase()}</option>`).join('');
            }
        } catch (e) {
            console.error('加载筛选器失败:', e);
        }
    },
    
    // 加载共享页（在快速下载页内嵌入）
    async loadSharedPage() {
        const sharedSection = document.getElementById('shared-section');
        if (!sharedSection) return;
        
        // 未登录时隐藏共享区
        if (!this.currentUser) {
            sharedSection.style.display = 'none';
            return;
        }
        
        // 已登录，显示共享区
        sharedSection.style.display = 'block';
        
        // 如果未启用共享，显示启用按钮
        if (!this.currentUser.shareEnabled) {
            document.getElementById('share-search').style.display = 'none';
            document.getElementById('shared-filter-bar').style.display = 'none';
            document.getElementById('share-info').style.display = 'block';
            document.getElementById('share-info').innerHTML = `
                <div class="share-notice">
                    <h3>📢 共享书库规则</h3>
                    <ul>
                        <li>启用共享功能后，您可以将书库中的书籍分享给其他用户</li>
                        <li>上传至少 <strong>3本书籍</strong> 后，即可访问其他用户的共享书库</li>
                        <li>当前已共享：<strong>${this.currentUser.sharedBooksCount || 0}</strong> 本</li>
                    </ul>
                    <button class="btn btn-primary" id="enable-share-btn">启用共享</button>
                </div>
            `;
            
            // 绑定启用按钮事件
            document.getElementById('enable-share-btn')?.addEventListener('click', () => {
                this.enableShare();
            });
            return;
        }
        
        // 已启用共享，显示共享书库（无论是否有权限访问其他人的共享）
        document.getElementById('share-info').style.display = 'none';
        document.getElementById('share-search').style.display = 'flex';
        document.getElementById('shared-filter-bar').style.display = 'flex';
        
        // 如果书籍不足，显示提示
        if (!this.currentUser.canAccessShared) {
            const sharedContainer = document.getElementById('shared-list');
            if (sharedContainer) {
                sharedContainer.innerHTML = `
                    <div class="share-notice" style="margin-top: 20px;">
                        <p>您已启用共享功能，但需要上传至少 <strong>3本书籍</strong> 才能访问其他用户的共享书库。</p>
                        <p>当前已共享：<strong>${this.currentUser.sharedBooksCount || 0}</strong> 本</p>
                    </div>
                `;
            }
        } else {
            // 有权限访问，加载共享书库
            this.loadSharedLibrary();
        }
    },
    
    // 加载共享书库
    async loadSharedLibrary(keyword = '') {
        const container = document.getElementById('shared-list');
        container.innerHTML = '<p class="empty-message">加载中...</p>';
        
        // 获取筛选条件
        const categoryFilter = document.getElementById('shared-category-filter')?.value || '';
        const formatFilter = document.getElementById('shared-format-filter')?.value || '';
        
        try {
            let books = keyword 
                ? await API.share.search(keyword) 
                : await API.share.getList();
            
            // 应用筛选
            if (categoryFilter) {
                books = books.filter(b => b.tags && b.tags.includes(categoryFilter));
            }
            if (formatFilter) {
                books = books.filter(b => b.format === formatFilter);
            }
            
            // 更新筛选器选项
            this.updateSharedFilters(books);
            
            if (books.length === 0) {
                container.innerHTML = '<p class="empty-message">共享书库为空</p>';
                return;
            }
            
            container.innerHTML = books.map(book => this.renderBookCard(book, 'shared')).join('');
            this.bindBookCardEvents();
        } catch (error) {
            container.innerHTML = `<p class="empty-message">${error.message}</p>`;
        }
    },
    
    // 更新共享书库筛选器
    updateSharedFilters(books) {
        const formats = new Set();
        
        books.forEach(book => {
            if (book.format) {
                formats.add(book.format);
            }
        });
        
        // 分类已在HTML中静态设置，只更新格式筛选器
        const formatSelect = document.getElementById('shared-format-filter');
        const currentFormat = formatSelect?.value || '';
        if (formatSelect) {
            formatSelect.innerHTML = '<option value="">所有格式</option>' +
                Array.from(formats).map(f => `<option value="${f}" ${f === currentFormat ? 'selected' : ''}>${f.toUpperCase()}</option>`).join('');
        }
    },
    
    // 加载下载记录
    async loadHistory() {
        if (!this.currentUser) {
            document.getElementById('history-list').innerHTML = '<p class="empty-message">请先登录</p>';
            return;
        }
        
        const container = document.getElementById('history-list');
        container.innerHTML = '<p class="empty-message">加载中...</p>';
        
        try {
            const history = await API.history.getList();
            
            if (history.length === 0) {
                container.innerHTML = '<p class="empty-message">暂无下载记录</p>';
                return;
            }
            
            container.innerHTML = history.map(item => `
                <div class="history-item">
                    <div class="history-info">
                        <div class="history-title">${item.title}</div>
                        <div class="history-meta">
                            <span>作者：${item.author || '未知'}</span>
                            <span>格式：${(item.format || 'txt').toUpperCase()}</span>
                            <span>大小：${item.file_size || '未知'}</span>
                            <span>总章节：${item.total_chapters || 0}</span>
                            ${item.webdav_path ? '<span style="color: #4CAF50;">✔ 已上传WebDAV</span>' : ''}
                            ${item.shared ? '<span style="color: #2196F3;">✔ 已共享</span>' : ''}
                        </div>
                    </div>
                    <div class="history-time">
                        ${this.formatTime(item.completed_at)}
                    </div>
                </div>
            `).join('');
        } catch (error) {
            container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
        }
    },
    
    // 加载下载管理（合并队列和历史）
    async loadDownloads() {
        if (!this.currentUser) {
            document.getElementById('download-list').innerHTML = '<p class="empty-message">请先登录</p>';
            return;
        }
        
        const container = document.getElementById('download-list');
        container.innerHTML = '<p class="empty-message">加载中...</p>';
        
        try {
            // 获取队列和历史
            const queue = await API.queue.getList();
            const history = await API.history.getList();
            
            // 合并并按时间排序
            const allDownloads = [
                ...queue.map(item => ({...item, source: 'queue'})),
                ...history.map(item => ({...item, source: 'history'}))
            ].sort((a, b) => {
                const timeA = new Date(a.created_at || a.completed_at || 0);
                const timeB = new Date(b.created_at || b.completed_at || 0);
                return timeB - timeA;
            });
            
            if (allDownloads.length === 0) {
                container.innerHTML = '<p class="empty-message">暂无下载记录</p>';
                return;
            }
            
            container.innerHTML = allDownloads.map(item => this.renderDownloadItem(item)).join('');
            this.bindQueueEvents();
        } catch (error) {
            container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
        }
    },
    
    // 渲染下载项（统一样式）
    renderDownloadItem(item) {
        const statusMap = {
            pending: { text: '等待中', color: '#757575', icon: '⏸️' },
            downloading: { text: '下载中', color: '#2196F3', icon: '⏬' },
            completed: { text: '已完成', color: '#4CAF50', icon: '✅' },
            failed: { text: '失败', color: '#f44336', icon: '❌' }
        };
        
        const status = item.source === 'history' ? 'completed' : (item.status || 'pending');
        const statusInfo = statusMap[status] || statusMap.pending;
        
        // 进度信息
        let progressInfo = '';
        if (status === 'downloading' && item.progress && item.total_chapters) {
            const percent = Math.round((item.progress / item.total_chapters) * 100);
            progressInfo = `
                <div class="progress-bar" style="margin-top: 10px;">
                    <div class="progress-fill" style="width: ${percent}%"></div>
                </div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">${item.progress}/${item.total_chapters} 章 (${percent}%)</div>
            `;
        }
        
        // 操作按钮
        let actions = '';
        if (status === 'pending') {
            actions = `
                <button class="btn btn-sm btn-primary start-download-btn" data-id="${item.id}">开始下载</button>
                <button class="btn btn-sm btn-outline remove-queue-btn" data-id="${item.id}">移除</button>
            `;
        } else if (status === 'failed') {
            actions = `
                <button class="btn btn-sm btn-primary start-download-btn" data-id="${item.id}">重试</button>
                <button class="btn btn-sm btn-outline remove-queue-btn" data-id="${item.id}">移除</button>
            `;
        }
        
        return `
            <div class="download-item" style="border: 1px solid #e0e0e0; padding: 15px; margin-bottom: 10px; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                            <h4 style="margin: 0; font-size: 16px;">${item.title}</h4>
                            <span style="background: ${statusInfo.color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
                                ${statusInfo.icon} ${statusInfo.text}
                            </span>
                        </div>
                        <div style="color: #666; font-size: 13px;">
                            <span>作者：${item.author || '未知'}</span>
                            <span style="margin-left: 15px;">格式：${(item.format || 'txt').toUpperCase()}</span>
                            ${item.file_size ? `<span style="margin-left: 15px;">大小：${item.file_size}</span>` : ''}
                            ${item.total_chapters ? `<span style="margin-left: 15px;">总章节：${item.total_chapters}</span>` : ''}
                        </div>
                        ${progressInfo}
                        ${item.error_message ? `<div style="color: #f44336; font-size: 12px; margin-top: 5px;">错误：${item.error_message}</div>` : ''}
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${actions}
                    </div>
                </div>
            </div>
        `;
    },
    
    // 格式化时间
    formatTime(dateStr) {
        if (!dateStr) return '未知';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
        
        return date.toLocaleDateString();
    },
    
    // 启用共享
    async enableShare() {
        try {
            await API.share.enable();
            await this.checkAuth();
            this.loadSharedPage();
            this.showToast('共享功能已启用', 'success');
        } catch (error) {
            this.showToast('启用失败：' + error.message, 'error');
        }
    },
    
    // 共享书籍
    async shareBook(libraryId) {
        try {
            await API.share.upload(libraryId);
            await this.checkAuth();
            this.showToast('书籍已共享', 'success');
        } catch (error) {
            this.showToast('共享失败：' + error.message, 'error');
        }
    },
    
    // 匹配书籍
    async matchBook(libraryId, filename) {
        try {
            // 提取文件名作为搜索关键词
            let keyword = filename;
            if (filename) {
                // 移除扩展名和_ID后缀
                keyword = filename.replace(/\.(epub|txt)$/i, '').replace(/_\d+$/, '');
            }
            
            // 弹出搜索对话框
            const searchKeyword = prompt('请输入搜索关键词：', keyword || '');
            if (!searchKeyword) return;
            
            // 搜索书籍
            this.showToast('正在搜索...', 'info');
            const result = await API.search(searchKeyword);
            const results = result.books || [];
            
            if (results.length === 0) {
                this.showToast('未找到匹配的书籍', 'error');
                return;
            }
            
            // 显示搜索结果供用户选择
            await this.showMatchResults(libraryId, results);
            
        } catch (error) {
            this.showToast('匹配失败：' + error.message, 'error');
        }
    },
    
    // 显示匹配结果
    async showMatchResults(libraryId, results) {
        const modalBody = document.getElementById('book-modal-body');
        modalBody.innerHTML = `
            <h3 style="margin-bottom: 15px;">选择要匹配的书籍</h3>
            <div class="match-results-list">
                ${results.map(book => `
                    <div class="match-result-item" style="border: 1px solid #ddd; padding: 15px; margin-bottom: 10px; border-radius: 8px; cursor: pointer;" data-book-id="${book.bookId}">
                        <div style="display: flex; gap: 15px;">
                            <img src="${book.cover || App.defaultCover}" style="width: 60px; height: 80px; object-fit: cover; border-radius: 4px;">
                            <div style="flex: 1;">
                                <h4 style="margin: 0 0 5px 0;">${book.title}</h4>
                                <p style="margin: 0; color: #666; font-size: 13px;">作者：${book.author || '未知'}</p>
                                <p style="margin: 5px 0 0 0; color: #666; font-size: 12px;">
                                    ${book.status === 'completed' ? '📖 完结' : '📖 连载中'}
                                    ${book.wordCount ? ` | 📝 ${book.wordCount.toLocaleString()}字` : ''}
                                    ${book.total_chapters ? ` | 📚 ${book.total_chapters}章` : ''}
                                </p>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        this.showModal('book-modal');
        
        // 绑定点击事件
        document.querySelectorAll('.match-result-item').forEach(item => {
            item.addEventListener('click', async () => {
                const bookId = item.dataset.bookId;
                await this.confirmMatch(libraryId, bookId);
            });
        });
    },
    
    // 确认匹配
    async confirmMatch(libraryId, bookId) {
        try {
            this.hideModal('book-modal');
            this.showToast('正在匹配并重新生成文件...', 'info');
            
            // 调用API匹配书籍
            await API.library.matchBook(libraryId, bookId);
            
            this.showToast('匹配成功！', 'success');
            this.loadLibrary();
        } catch (error) {
            this.showToast('匹配失败：' + error.message, 'error');
        }
    },
    
    // 下载共享书籍
    async downloadSharedBook(id) {
        try {
            // 直接通过链接下载
            const downloadUrl = `${API.baseUrl}/share/download/${id}`;
            
            // 创建临时链接并触发下载
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            this.showToast('开始下载...', 'success');
            
            // 延迟刷新列表以显示更新后的下载次数
            setTimeout(() => {
                this.loadSharedLibrary();
            }, 1000);
        } catch (error) {
            this.showToast('下载失败：' + error.message, 'error');
        }
    },
    
    // 保存Cookie
    async saveCookie(cookie) {
        try {
            await API.po18.setCookie(cookie);
            await this.checkAuth();
            this.showToast('Cookie保存成功', 'success');
            
            const statusEl = document.getElementById('cookie-status');
            statusEl.className = 'cookie-status success';
            statusEl.textContent = '✅ Cookie已保存并验证通过';
        } catch (error) {
            const statusEl = document.getElementById('cookie-status');
            statusEl.className = 'cookie-status error';
            statusEl.textContent = '❌ ' + error.message;
        }
    },
    
    // 验证Cookie
    async validateCookie() {
        try {
            const result = await API.po18.validateCookie();
            const statusEl = document.getElementById('cookie-status');
            
            if (result.valid) {
                statusEl.className = 'cookie-status success';
                statusEl.textContent = '✅ Cookie有效';
            } else {
                statusEl.className = 'cookie-status error';
                statusEl.textContent = '❌ Cookie无效或已过期';
            }
        } catch (error) {
            this.showToast('验证失败', 'error');
        }
    },
    
    // 显示设置弹窗
    showSettingsModal() {
        this.showModal('settings-modal');
        this.updateSettingsUI();
        this.loadSavedCookie();
        this.loadWebDAVConfig();
        this.loadShareSettings();
    },
    
    // 加载已保存的Cookie
    async loadSavedCookie() {
        try {
            const result = await API.po18.getCookie();
            const cookieInput = document.getElementById('po18-cookie');
            const statusEl = document.getElementById('cookie-status');
            
            if (result.cookie) {
                cookieInput.value = result.cookie;
                statusEl.className = 'cookie-status success';
                statusEl.textContent = '✅ 已保存Cookie';
            } else {
                cookieInput.value = '';
                statusEl.className = 'cookie-status';
                statusEl.textContent = '';
            }
        } catch (error) {
            console.error('加载Cookie失败:', error);
        }
    },
    
    // 加载WebDAV配置列表
    async loadWebDAVConfig() {
        try {
            const configs = await API.webdav.getConfig();
            const listContainer = document.getElementById('webdav-list');
            
            if (!configs || configs.length === 0) {
                listContainer.innerHTML = '<p style="color: #999;">还没有添加书库配置</p>';
                return;
            }
            
            listContainer.innerHTML = configs.map(config => `
                <div class="webdav-item" style="padding: 15px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>${config.name}</strong>
                            ${config.isDefault ? '<span style="color: var(--md-pink); margin-left: 8px;">★ 默认</span>' : ''}
                            ${!config.isEnabled ? '<span style="color: #999; margin-left: 8px;">(已禁用)</span>' : ''}
                            <div style="font-size: 12px; color: #666; margin-top: 5px;">
                                ${config.url} - ${config.basePath || '/'}
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-sm btn-outline" onclick="App.testWebDAVById(${config.id})">测试</button>
                            <button class="btn btn-sm btn-outline" onclick="App.editWebDAV(${config.id})">编辑</button>
                            ${!config.isDefault ? `<button class="btn btn-sm btn-outline" onclick="App.setDefaultWebDAV(${config.id})">设为默认</button>` : ''}
                            <button class="btn btn-sm btn-outline" onclick="App.toggleWebDAV(${config.id})">${config.isEnabled ? '禁用' : '启用'}</button>
                            <button class="btn btn-sm btn-outline" style="color: #f44336;" onclick="App.deleteWebDAV(${config.id})">删除</button>
                        </div>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('加载WebDAV配置失败:', error);
        }
    },
    
    // 保存WebDAV配置
    async saveWebDAVConfig() {
        try {
            const config = {
                name: document.getElementById('webdav-name')?.value.trim() || '默认书库',
                url: document.getElementById('webdav-url').value.trim(),
                username: document.getElementById('webdav-username').value.trim(),
                password: document.getElementById('webdav-password').value,
                basePath: document.getElementById('webdav-path')?.value.trim() || '/',
                isDefault: true
            };
            
            if (!config.url || !config.username) {
                this.showToast('请填写完整的WebDAV配置', 'error');
                return;
            }
            
            // 判断是编辑还是新增
            if (this.editingWebDAVId) {
                // 编辑模式
                if (!config.password) {
                    // 如果密码为空，不更新密码
                    delete config.password;
                }
                
                await API.put(`/webdav/configs/${this.editingWebDAVId}`, config);
                this.showToast('修改成功', 'success');
                this.cancelEditWebDAV();
            } else {
                // 新增模式
                if (!config.password) {
                    this.showToast('请填写密码', 'error');
                    return;
                }
                
                await API.webdav.saveConfig(config);
                this.showToast('书库已添加', 'success');
                
                // 清空表单
                document.getElementById('webdav-name').value = '';
                document.getElementById('webdav-url').value = '';
                document.getElementById('webdav-username').value = '';
                document.getElementById('webdav-password').value = '';
                document.getElementById('webdav-path').value = '';
            }
            
            // 重新加载列表
            await this.loadWebDAVConfig();
        } catch (error) {
            this.showToast('保存失败: ' + error.message, 'error');
        }
    },
    
    // 设置默认WebDAV
    async setDefaultWebDAV(id) {
        try {
            await API.post(`/webdav/configs/${id}/set-default`);
            this.showToast('已设为默认书库', 'success');
            await this.loadWebDAVConfig();
        } catch (error) {
            this.showToast('设置失败: ' + error.message, 'error');
        }
    },
    
    // 切换WebDAV启用状态
    async toggleWebDAV(id) {
        try {
            await API.post(`/webdav/configs/${id}/toggle`);
            this.showToast('状态已更新', 'success');
            await this.loadWebDAVConfig();
        } catch (error) {
            this.showToast('操作失败: ' + error.message, 'error');
        }
    },
    
    // 删除WebDAV配置
    async deleteWebDAV(id) {
        if (!confirm('确定要删除这个书库配置吗？')) return;
        
        try {
            await API.delete(`/webdav/configs/${id}`);
            this.showToast('已删除', 'success');
            await this.loadWebDAVConfig();
        } catch (error) {
            this.showToast('删除失败: ' + error.message, 'error');
        }
    },
    
    // 编辑WebDAV配置
    async editWebDAV(id) {
        try {
            const configs = await API.webdav.getConfig();
            const config = configs.find(c => c.id === id);
            
            if (!config) {
                this.showToast('配置不存在', 'error');
                return;
            }
            
            // 填充表单
            document.getElementById('webdav-name').value = config.name;
            document.getElementById('webdav-url').value = config.url;
            document.getElementById('webdav-username').value = config.username;
            document.getElementById('webdav-path').value = config.basePath || '/';
            document.getElementById('webdav-password').value = ''; // 密码不回显
            
            // 保存正在编辑的ID
            this.editingWebDAVId = id;
            
            // 更改按钮文本
            const saveBtn = document.getElementById('save-webdav');
            saveBtn.textContent = '保存修改';
            saveBtn.style.backgroundColor = 'var(--md-success)';
            
            // 添加取消按钮
            if (!document.getElementById('cancel-edit-webdav')) {
                const cancelBtn = document.createElement('button');
                cancelBtn.id = 'cancel-edit-webdav';
                cancelBtn.className = 'btn btn-outline';
                cancelBtn.textContent = '取消编辑';
                cancelBtn.onclick = () => this.cancelEditWebDAV();
                saveBtn.parentElement.insertBefore(cancelBtn, saveBtn);
            }
            
            this.showToast('请修改配置后点击“保存修改”', 'info');
        } catch (error) {
            this.showToast('加载配置失败: ' + error.message, 'error');
        }
    },
    
    // 取消编辑WebDAV
    cancelEditWebDAV() {
        this.editingWebDAVId = null;
        
        // 清空表单
        document.getElementById('webdav-name').value = '';
        document.getElementById('webdav-url').value = '';
        document.getElementById('webdav-username').value = '';
        document.getElementById('webdav-password').value = '';
        document.getElementById('webdav-path').value = '';
        
        // 恢复按钮
        const saveBtn = document.getElementById('save-webdav');
        saveBtn.textContent = '添加书库';
        saveBtn.style.backgroundColor = '';
        
        // 删除取消按钮
        const cancelBtn = document.getElementById('cancel-edit-webdav');
        if (cancelBtn) {
            cancelBtn.remove();
        }
    },
    
    // 按ID测试WebDAV连接
    async testWebDAVById(id) {
        try {
            const configs = await API.webdav.getConfig();
            const config = configs.find(c => c.id === id);
            
            if (!config) {
                this.showToast('配置不存在', 'error');
                return;
            }
            
            this.showToast('正在测试连接...', 'info');
            
            await API.webdav.testConnection({
                url: config.url,
                username: config.username,
                password: config.password || '' // 密码可能为空，使用已保存的
            });
            
            this.showToast('✅ 连接成功', 'success');
        } catch (error) {
            this.showToast('❗ 连接失败: ' + error.message, 'error');
        }
    },
    
    // 测试WebDAV连接
    async testWebDAVConnection() {
        try {
            const config = {
                url: document.getElementById('webdav-url').value.trim(),
                username: document.getElementById('webdav-username').value.trim(),
                password: document.getElementById('webdav-password').value
            };
            
            if (!config.url || !config.username || !config.password) {
                this.showToast('请填写完整配置', 'error');
                return;
            }
            
            const result = await API.webdav.testConnection(config);
            this.showToast('连接成功！', 'success');
        } catch (error) {
            this.showToast('连接失败: ' + error.message, 'error');
        }
    },
    
    // 加载共享设置
    async loadShareSettings() {
        try {
            const checkbox = document.getElementById('enable-share-checkbox');
            const statusText = document.getElementById('share-status-text');
            const sharedCount = document.getElementById('shared-count');
            const canAccessShared = document.getElementById('can-access-shared');
            
            if (this.currentUser) {
                checkbox.checked = this.currentUser.shareEnabled || false;
                statusText.textContent = this.currentUser.shareEnabled ? '已启用' : '未启用';
                statusText.style.color = this.currentUser.shareEnabled ? 'var(--md-success)' : 'var(--md-on-surface-variant)';
                
                sharedCount.textContent = this.currentUser.sharedBooksCount || 0;
                canAccessShared.textContent = this.currentUser.canAccessShared ? '是' : '否';
                canAccessShared.style.color = this.currentUser.canAccessShared ? 'var(--md-success)' : 'var(--md-on-surface-variant)';
            }
        } catch (error) {
            console.error('加载共享设置失败:', error);
        }
    },
    
    // 保存共享设置
    async saveShareSettings() {
        try {
            const checkbox = document.getElementById('enable-share-checkbox');
            const enabled = checkbox.checked;
            
            if (enabled && !this.currentUser.shareEnabled) {
                // 启用共享
                await API.share.enable();
                this.showToast('共享功能已启用', 'success');
            } else if (!enabled && this.currentUser.shareEnabled) {
                // 禁用共享
                await API.share.disable();
                this.showToast('共享功能已禁用', 'success');
            } else {
                this.showToast('设置未变更', 'info');
            }
            
            // 刷新用户信息
            await this.checkAuth();
            this.loadShareSettings();
            this.loadSharedPage();
        } catch (error) {
            this.showToast('保存失败: ' + error.message, 'error');
        }
    },
    
    // 更新设置UI
    updateSettingsUI() {
        if (this.currentUser) {
            document.getElementById('share-status-text').textContent = 
                this.currentUser.shareEnabled ? '已启用' : '未启用';
            document.getElementById('shared-count').textContent = 
                this.currentUser.sharedBooksCount;
            document.getElementById('can-access-shared').textContent = 
                this.currentUser.canAccessShared ? '是' : '否';
        }
    },
    
    // 初始化设置标签页
    initSettingsTabs() {
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                
                document.querySelectorAll('.settings-tab').forEach(t => {
                    t.classList.toggle('active', t === tab);
                });
                
                document.querySelectorAll('.settings-content').forEach(content => {
                    content.classList.toggle('active', content.id === `settings-${tabName}`);
                });
            });
        });
    },
    
    // 显示弹窗
    showModal(id) {
        document.getElementById(id)?.classList.add('active');
    },
    
    // 隐藏弹窗
    hideModal(id) {
        document.getElementById(id)?.classList.remove('active');
    },
    
    // 显示Toast
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    },
    
    // ==================== 排行榜 ====================
    
    currentRankingType: 'favorites',
    rankingCache: {},
    rankingRefreshTimer: null,
    
    async loadRankings(type = null) {
        if (type) {
            this.currentRankingType = type;
        }
        
        // 更新标签激活状态
        document.querySelectorAll('.ranking-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.type === this.currentRankingType);
        });
        
        // 如果有缓存且在6小时内，使用缓存
        const cacheKey = this.currentRankingType;
        const cached = this.rankingCache[cacheKey];
        const now = Date.now();
        
        if (cached && (now - cached.timestamp) < 6 * 60 * 60 * 1000) {
            this.renderRankings(cached.data);
            return;
        }
        
        // 显示加载中
        document.getElementById('ranking-list').innerHTML = '<p class="empty-message">加载中...</p>';
        
        try {
            const books = await API.rankings.get(this.currentRankingType, 100);
            this.rankingCache[cacheKey] = {
                data: books,
                timestamp: now
            };
            this.renderRankings(books);
            
            // 设置6小时后自动刷新
            this.scheduleRankingRefresh();
        } catch (error) {
            console.error('加载排行榜失败:', error);
            document.getElementById('ranking-list').innerHTML = '<p class="empty-message">加载失败</p>';
        }
    },
    
    renderRankings(books) {
        const container = document.getElementById('ranking-list');
        
        if (!books || books.length === 0) {
            container.innerHTML = '<p class="empty-message">暂无数据</p>';
            return;
        }
        
        const statLabels = {
            'favorites': '收藏',
            'comments': '留言',
            'monthly': '月人气',
            'total': '总人气',
            'wordcount': '字数',
            'latest': '更新时间'
        };
        
        const label = statLabels[this.currentRankingType] || '';
        
        container.innerHTML = books.map((book, index) => {
            const rank = index + 1;
            const rankClass = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
            
            let statValue = '';
            if (this.currentRankingType === 'favorites') {
                statValue = this.formatNumber(book.favorites_count);
            } else if (this.currentRankingType === 'comments') {
                statValue = this.formatNumber(book.comments_count);
            } else if (this.currentRankingType === 'monthly') {
                statValue = this.formatNumber(book.monthly_popularity);
            } else if (this.currentRankingType === 'total') {
                statValue = this.formatNumber(book.total_popularity);
            } else if (this.currentRankingType === 'wordcount') {
                statValue = this.formatNumber(book.word_count);
            } else if (this.currentRankingType === 'latest') {
                statValue = book.latest_chapter_date || '-';
            }
            
            const cover = book.cover || this.defaultCover;
            const detailUrl = `https://www.po18.tw/books/${book.book_id}`;
            const statusText = this.getStatusText(book.status);
            
            return `
                <div class="ranking-item">
                    <div class="ranking-number ${rankClass}">${rank}</div>
                    <img src="${cover}" class="ranking-cover" alt="${this.escapeHtml(book.title)}" 
                         onerror="this.src='${this.defaultCover}'"
                         style="cursor: pointer;"
                         onclick="window.location.href='/book-detail.html?id=${book.book_id}'">
                    <div class="ranking-info" style="cursor: pointer;" onclick="window.location.href='/book-detail.html?id=${book.book_id}'">
                        <div class="ranking-title">
                            ${this.escapeHtml(book.title)}
                        </div>
                        <div class="ranking-author">作者：${this.escapeHtml(book.author || '未知')}</div>
                        <div class="ranking-meta">
                            <span>${this.formatNumber(book.total_chapters || 0)} 章</span>
                            <span>${this.formatNumber(book.word_count || 0)} 字</span>
                            <span>${statusText}</span>
                            ${book.latest_chapter_name ? `<span>最新：${this.escapeHtml(book.latest_chapter_name)}</span>` : ''}
                        </div>
                    </div>
                    <div class="ranking-stats">
                        <div class="ranking-value">${statValue}</div>
                        <div class="ranking-label">${label}</div>
                    </div>
                </div>
            `;
        }).join('');
        
        // 绑定标签切换事件
        document.querySelectorAll('.ranking-tab').forEach(tab => {
            tab.onclick = () => this.loadRankings(tab.dataset.type);
        });
    },
    
    scheduleRankingRefresh() {
        if (this.rankingRefreshTimer) {
            clearTimeout(this.rankingRefreshTimer);
        }
        
        // 6小时后刷新
        this.rankingRefreshTimer = setTimeout(() => {
            if (this.currentPage === 'rankings') {
                this.rankingCache = {}; // 清除缓存
                this.loadRankings();
            }
        }, 6 * 60 * 60 * 1000);
    },
    
    getStatusText(status) {
        const map = {
            'completed': '完结',
            'ongoing': '连载',
            'unknown': '未知'
        };
        return map[status] || status || '未知';
    },
    
    // 格式化数字（超过1万显示为w）
    formatNumber(num) {
        if (!num) return '0';
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + 'w';
        }
        return num.toLocaleString();
    },
    
    // HTML转义
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
