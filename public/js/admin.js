/**
 * PO18小说下载网站 - 后台管理模块
 */

const Admin = {
    baseUrl: '/api/admin',
    currentUser: null,
    
    // 分页状态
    pagination: {
        users: { page: 1, pageSize: 20, total: 0 },
        books: { page: 1, pageSize: 20, total: 0 },
        shared: { page: 1, pageSize: 20, total: 0 }
    },
    
    // 初始化
    async init() {
        try {
            // 验证权限
            const result = await this.request('/check');
            if (!result.isAdmin) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('no-access').style.display = 'block';
                return;
            }
            
            this.currentUser = result.user;
            document.getElementById('loading').style.display = 'none';
            document.getElementById('admin-main').style.display = 'block';
            
            // 绑定事件
            this.bindEvents();
            
            // 加载概览数据
            await this.loadDashboard();
        } catch (error) {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('no-access').style.display = 'block';
        }
    },
    
    // API请求
    async request(endpoint, options = {}) {
        const response = await fetch(this.baseUrl + endpoint, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || '请求失败');
        }
        return data;
    },
    
    // 显示提示
    showToast(message, type = 'info') {
        console.log(`[${type}] ${message}`);
        alert(message);
    },
    
    // 绑定事件
    bindEvents() {
        // 导航切换
        document.querySelectorAll('.admin-nav-btn[data-panel]').forEach(btn => {
            btn.addEventListener('click', () => {
                const panel = btn.dataset.panel;
                this.switchPanel(panel);
            });
        });
        
        // 用户编辑表单
        document.getElementById('user-edit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveUser();
        });
        
        // 书籍编辑表单
        document.getElementById('book-edit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveBook();
        });
        
        // 搜索回车
        document.getElementById('user-search').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchUsers();
        });
        document.getElementById('book-search').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchBooks();
        });
        document.getElementById('shared-search').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchShared();
        });
        
        // 点击弹窗外部关闭
        document.querySelectorAll('.edit-modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
    },
    
    // 切换面板
    async switchPanel(panel) {
        document.querySelectorAll('.admin-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.panel === panel);
        });
        document.querySelectorAll('.admin-panel').forEach(p => {
            p.classList.toggle('active', p.id === `panel-${panel}`);
        });
        
        // 加载对应数据
        switch (panel) {
            case 'dashboard':
                await this.loadDashboard();
                break;
            case 'users':
                await this.loadUsers();
                break;
            case 'books':
                await this.loadBooks();
                break;
            case 'shared':
                await this.loadShared();
                break;
        }
    },
    
    // 加载概览
    async loadDashboard() {
        try {
            const stats = await this.request('/stats');
            document.getElementById('stat-users').textContent = stats.users || 0;
            document.getElementById('stat-books').textContent = stats.books || 0;
            document.getElementById('stat-total-chapters').textContent = (stats.totalChapters || 0).toLocaleString();
            document.getElementById('stat-cached-chapters').textContent = (stats.cachedChapters || 0).toLocaleString();
            document.getElementById('stat-shared').textContent = stats.shared || 0;
            document.getElementById('stat-downloads').textContent = stats.downloads || 0;
        } catch (error) {
            this.showToast('加载统计失败: ' + error.message, 'error');
        }
    },
    
    // ==================== 用户管理 ====================
    
    async loadUsers(page = 1) {
        try {
            const keyword = document.getElementById('user-search').value;
            const result = await this.request(`/users?page=${page}&pageSize=20&keyword=${encodeURIComponent(keyword)}`);
            
            this.pagination.users = { page, pageSize: 20, total: result.total };
            this.renderUsersTable(result.users);
            this.renderPagination('users', result.total, page);
        } catch (error) {
            this.showToast('加载用户失败: ' + error.message, 'error');
        }
    },
    
    searchUsers() {
        this.loadUsers(1);
    },
    
    renderUsersTable(users) {
        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = users.map(user => `
            <tr>
                <td>${user.id}</td>
                <td><strong>${this.escapeHtml(user.username)}</strong></td>
                <td>${user.po18_cookie ? '✅ 已设置' : '❌ 未设置'}</td>
                <td>${user.share_enabled ? '✅ 已启用' : '❌ 未启用'}</td>
                <td>${user.cache_auth ? '✅ 已授权' : '❌ 未授权'}</td>
                <td>${user.shared_books_count || 0}</td>
                <td>${this.formatDate(user.created_at)}</td>
                <td class="actions">
                    <button class="btn-sm btn-edit" onclick="Admin.editUser(${user.id})">编辑</button>
                    <button class="btn-sm btn-delete" onclick="Admin.deleteUser(${user.id})">删除</button>
                </td>
            </tr>
        `).join('');
    },
    
    async editUser(id) {
        try {
            const user = await this.request(`/users/${id}`);
            document.getElementById('edit-user-id').value = user.id;
            document.getElementById('edit-user-username').value = user.username;
            document.getElementById('edit-user-password').value = '';
            document.getElementById('edit-user-cookie').value = user.po18_cookie || '';
            document.getElementById('edit-user-share').value = user.share_enabled ? '1' : '0';
            document.getElementById('edit-user-cache-auth').value = user.cache_auth ? '1' : '0';
            
            document.getElementById('user-edit-modal').classList.add('active');
        } catch (error) {
            this.showToast('获取用户信息失败: ' + error.message, 'error');
        }
    },
    
    async saveUser() {
        try {
            const id = document.getElementById('edit-user-id').value;
            const data = {
                password: document.getElementById('edit-user-password').value || undefined,
                po18_cookie: document.getElementById('edit-user-cookie').value,
                share_enabled: parseInt(document.getElementById('edit-user-share').value),
                cache_auth: parseInt(document.getElementById('edit-user-cache-auth').value)
            };
            
            await this.request(`/users/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            
            this.closeModal('user-edit-modal');
            this.showToast('用户保存成功', 'success');
            await this.loadUsers(this.pagination.users.page);
        } catch (error) {
            this.showToast('保存失败: ' + error.message, 'error');
        }
    },
    
    async deleteUser(id) {
        if (!confirm('确定要删除此用户吗？此操作不可恢复！')) return;
        
        try {
            await this.request(`/users/${id}`, { method: 'DELETE' });
            this.showToast('用户已删除', 'success');
            await this.loadUsers(this.pagination.users.page);
        } catch (error) {
            this.showToast('删除失败: ' + error.message, 'error');
        }
    },
    
    // ==================== 书籍管理 ====================
    
    async loadBooks(page = 1) {
        try {
            const keyword = document.getElementById('book-search').value;
            const result = await this.request(`/books?page=${page}&pageSize=20&keyword=${encodeURIComponent(keyword)}`);
            
            this.pagination.books = { page, pageSize: 20, total: result.total };
            this.renderBooksTable(result.books);
            this.renderPagination('books', result.total, page);
        } catch (error) {
            this.showToast('加载书籍失败: ' + error.message, 'error');
        }
    },
    
    searchBooks() {
        this.loadBooks(1);
    },
    
    renderBooksTable(books) {
        const tbody = document.getElementById('books-table-body');
        tbody.innerHTML = books.map(book => {
            // 状态显示
            const statusText = {
                'completed': '完结',
                'ongoing': '连载中',
                'unknown': '未知'
            }[book.status] || book.status || '-';
                
            // 格式化字数
            const wordCount = book.word_count ? book.word_count.toLocaleString() : '-';
                
            return `
                <tr>
                    <td>${book.book_id}</td>
                    <td><img src="${book.cover || '/img/no-cover.png'}" style="width:36px;height:50px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'"></td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(book.title || '未知')}"><strong>${this.escapeHtml(book.title || '未知')}</strong></td>
                    <td>${this.escapeHtml(book.author || '未知')}</td>
                    <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(book.tags || '')}">
                        ${this.escapeHtml((book.tags || '').split('·')[0] || '-')}
                    </td>
                    <td style="text-align:center;">${book.total_chapters || book.subscribed_chapters || '-'}</td>
                    <td style="text-align:center;">${book.free_chapters || '-'}</td>
                    <td style="text-align:center;">${book.paid_chapters || '-'}</td>
                    <td style="text-align:right;">${wordCount}</td>
                    <td style="text-align:center;">${statusText}</td>
                    <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(book.latest_chapter_name || '')}">
                        ${this.escapeHtml(book.latest_chapter_name || '-')}
                    </td>
                    <td>${book.latest_chapter_date || '-'}</td>
                    <td class="actions">
                        <button class="btn-sm btn-edit" onclick="Admin.editBook('${book.book_id}')">编辑</button>
                        <button class="btn-sm btn-delete" onclick="Admin.deleteBook('${book.book_id}')">删除</button>
                    </td>
                </tr>
            `;
        }).join('');
    },
    
    async editBook(bookId) {
        try {
            const book = await this.request(`/books/${bookId}`);
            document.getElementById('edit-book-id').value = book.id;
            document.getElementById('edit-book-bid').value = book.book_id;
            document.getElementById('edit-book-title').value = book.title || '';
            document.getElementById('edit-book-author').value = book.author || '';
            document.getElementById('edit-book-tags').value = book.tags || '';
            document.getElementById('edit-book-wordcount').value = book.word_count || '';
            document.getElementById('edit-book-total-chapters').value = book.total_chapters || '';
            document.getElementById('edit-book-free-chapters').value = book.free_chapters || '';
            document.getElementById('edit-book-paid-chapters').value = book.paid_chapters || '';
            document.getElementById('edit-book-status').value = book.status || 'unknown';
            document.getElementById('edit-book-latest-chapter').value = book.latest_chapter_name || '';
            document.getElementById('edit-book-latest-date').value = book.latest_chapter_date || '';
            document.getElementById('edit-book-platform').value = book.platform || 'po18';
            document.getElementById('edit-book-description').value = book.description || '';
            document.getElementById('edit-book-cover').value = book.cover || '';
            
            document.getElementById('book-edit-modal').classList.add('active');
        } catch (error) {
            this.showToast('获取书籍信息失败: ' + error.message, 'error');
        }
    },
    
    async saveBook() {
        try {
            const bookId = document.getElementById('edit-book-bid').value;
            const data = {
                title: document.getElementById('edit-book-title').value,
                author: document.getElementById('edit-book-author').value,
                tags: document.getElementById('edit-book-tags').value,
                word_count: parseInt(document.getElementById('edit-book-wordcount').value) || 0,
                total_chapters: parseInt(document.getElementById('edit-book-total-chapters').value) || 0,
                free_chapters: parseInt(document.getElementById('edit-book-free-chapters').value) || 0,
                paid_chapters: parseInt(document.getElementById('edit-book-paid-chapters').value) || 0,
                status: document.getElementById('edit-book-status').value,
                latest_chapter_name: document.getElementById('edit-book-latest-chapter').value,
                latest_chapter_date: document.getElementById('edit-book-latest-date').value,
                platform: document.getElementById('edit-book-platform').value,
                description: document.getElementById('edit-book-description').value,
                cover: document.getElementById('edit-book-cover').value
            };
            
            await this.request(`/books/${bookId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            
            this.closeModal('book-edit-modal');
            this.showToast('书籍保存成功', 'success');
            await this.loadBooks(this.pagination.books.page);
        } catch (error) {
            this.showToast('保存失败: ' + error.message, 'error');
        }
    },
    
    async deleteBook(bookId) {
        if (!confirm('确定要删除此书籍元信息吗？')) return;
        
        try {
            await this.request(`/books/${bookId}`, { method: 'DELETE' });
            this.showToast('书籍已删除', 'success');
            await this.loadBooks(this.pagination.books.page);
        } catch (error) {
            this.showToast('删除失败: ' + error.message, 'error');
        }
    },
    
    // ==================== 共享书库管理 ====================
    
    async loadShared(page = 1) {
        try {
            const keyword = document.getElementById('shared-search').value;
            const result = await this.request(`/shared?page=${page}&pageSize=20&keyword=${encodeURIComponent(keyword)}`);
            
            this.pagination.shared = { page, pageSize: 20, total: result.total };
            this.renderSharedTable(result.books);
            this.renderPagination('shared', result.total, page);
        } catch (error) {
            this.showToast('加载共享书库失败: ' + error.message, 'error');
        }
    },
    
    searchShared() {
        this.loadShared(1);
    },
    
    renderSharedTable(books) {
        const tbody = document.getElementById('shared-table-body');
        tbody.innerHTML = books.map(book => `
            <tr>
                <td>${book.id}</td>
                <td><strong>${this.escapeHtml(book.title || '未知')}</strong></td>
                <td>${this.escapeHtml(book.author || '未知')}</td>
                <td>${book.format || '-'}</td>
                <td>${this.escapeHtml(book.uploader_name || '未知')}</td>
                <td>${book.download_count || 0}</td>
                <td>${this.formatDate(book.created_at)}</td>
                <td class="actions">
                    <button class="btn-sm btn-view" onclick="Admin.downloadShared(${book.id})">下载</button>
                    <button class="btn-sm btn-delete" onclick="Admin.deleteShared(${book.id})">删除</button>
                </td>
            </tr>
        `).join('');
    },
    
    downloadShared(id) {
        window.open(`/api/share/download/${id}`, '_blank');
    },
    
    async deleteShared(id) {
        if (!confirm('确定要删除此共享书籍吗？')) return;
        
        try {
            await this.request(`/shared/${id}`, { method: 'DELETE' });
            this.showToast('共享书籍已删除', 'success');
            await this.loadShared(this.pagination.shared.page);
        } catch (error) {
            this.showToast('删除失败: ' + error.message, 'error');
        }
    },
    
    // ==================== 工具方法 ====================
    
    renderPagination(type, total, currentPage) {
        const pageSize = 20;
        const totalPages = Math.ceil(total / pageSize);
        const container = document.getElementById(`${type}-pagination`);
        
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let html = '';
        html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="Admin.load${type.charAt(0).toUpperCase() + type.slice(1)}(${currentPage - 1})">上一页</button>`;
        
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
                html += `<button class="${i === currentPage ? 'active' : ''}" onclick="Admin.load${type.charAt(0).toUpperCase() + type.slice(1)}(${i})">${i}</button>`;
            } else if (i === currentPage - 3 || i === currentPage + 3) {
                html += '<button disabled>...</button>';
            }
        }
        
        html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="Admin.load${type.charAt(0).toUpperCase() + type.slice(1)}(${currentPage + 1})">下一页</button>`;
        
        container.innerHTML = html;
    },
    
    closeModal(id) {
        document.getElementById(id).classList.remove('active');
    },
    
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        setTimeout(() => toast.classList.remove('show'), 3000);
    },
    
    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    
    formatDate(dateStr) {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('zh-CN');
    },
    
    // ==================== ID遍历控制 ====================
    
    crawlerPollingInterval: null,
    
    // 切换爬虫模式
    toggleCrawlerMode() {
        const mode = document.querySelector('input[name="crawler-mode"]:checked').value;
        const startIdInput = document.getElementById('crawler-start-id');
        const endIdInput = document.getElementById('crawler-end-id');
        
        if (mode === 'database') {
            // 数据库模式：禁用ID输入
            startIdInput.disabled = true;
            endIdInput.disabled = true;
            startIdInput.value = '';
            endIdInput.value = '';
        } else {
            // ID范围模式：启用ID输入
            startIdInput.disabled = false;
            endIdInput.disabled = false;
        }
    },
    
    async startCrawler() {
        const mode = document.querySelector('input[name="crawler-mode"]:checked').value;
        const startId = document.getElementById('crawler-start-id').value;
        const endId = document.getElementById('crawler-end-id').value;
        const delay = document.getElementById('crawler-delay').value;
        const concurrency = document.getElementById('crawler-concurrency').value;
        
        // 只有ID范围模式需要验证ID
        if (mode === 'range' && (!startId || !endId)) {
            this.showToast('请输入开始ID和结束ID', 'error');
            return;
        }
        
        try {
            const body = { mode, delay, concurrency };
            if (mode === 'range') {
                body.startId = startId;
                body.endId = endId;
            }
            
            const response = await fetch('/api/admin/crawler/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                this.showToast(result.error || '启动失败', 'error');
                return;
            }
            
            const modeText = concurrency > 1 ? `并发模式 (${concurrency}个线程)` : '单线程模式';
            this.showToast(`遍历已启动 - ${modeText}`, 'success');
            document.getElementById('crawler-start-btn').disabled = true;
            document.getElementById('crawler-stop-btn').disabled = false;
            
            // 开始轮询状态
            this.startCrawlerPolling();
        } catch (error) {
            this.showToast('启动失败: ' + error.message, 'error');
        }
    },
    
    async stopCrawler() {
        try {
            const response = await fetch('/api/admin/crawler/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showToast('正在停止遍历...', 'info');
            } else {
                this.showToast(result.error || '停止失败', 'error');
            }
        } catch (error) {
            this.showToast('停止失败: ' + error.message, 'error');
        }
    },
    
    startCrawlerPolling() {
        // 清除旧的轮询
        if (this.crawlerPollingInterval) {
            clearInterval(this.crawlerPollingInterval);
        }
        
        // 立即获取一次
        this.fetchCrawlerStatus();
        
        // 每秒轮询
        this.crawlerPollingInterval = setInterval(() => {
            this.fetchCrawlerStatus();
        }, 1000);
    },
    
    stopCrawlerPolling() {
        if (this.crawlerPollingInterval) {
            clearInterval(this.crawlerPollingInterval);
            this.crawlerPollingInterval = null;
        }
    },
    
    async fetchCrawlerStatus() {
        try {
            const response = await fetch('/api/admin/crawler/status');
            const status = await response.json();
            
            this.updateCrawlerUI(status);
            
            // 如果不再运行，停止轮询
            if (!status.isRunning) {
                this.stopCrawlerPolling();
                document.getElementById('crawler-start-btn').disabled = false;
                document.getElementById('crawler-stop-btn').disabled = true;
            }
        } catch (error) {
            console.error('获取遍历状态失败:', error);
        }
    },
    
    updateCrawlerUI(status) {
        // 更新状态
        document.getElementById('crawler-state').textContent = status.isRunning ? '运行中' : '已停止';
        document.getElementById('crawler-state').style.color = status.isRunning ? '#4CAF50' : '#666';
        
        // 更新进度
        document.getElementById('crawler-current-id').textContent = status.currentId || '-';
        document.getElementById('crawler-progress').textContent = status.progress + '%';
        document.getElementById('crawler-progress-bar').style.width = status.progress + '%';
        
        // 更新统计
        document.getElementById('crawler-success').textContent = status.successCount;
        document.getElementById('crawler-fail').textContent = status.failCount;
        document.getElementById('crawler-processed').textContent = status.totalProcessed;
        document.getElementById('crawler-elapsed').textContent = this.formatElapsed(status.elapsedSeconds);
        
        // 更新并发相关信息
        if (status.concurrency !== undefined) {
            document.getElementById('crawler-concurrency-display').textContent = status.concurrency;
        }
        if (status.activeThreads !== undefined) {
            document.getElementById('crawler-active-threads').textContent = status.activeThreads;
        }
        if (status.pendingCount !== undefined) {
            document.getElementById('crawler-pending').textContent = status.pendingCount;
        }
        if (status.avgSpeed !== undefined) {
            document.getElementById('crawler-speed').textContent = status.avgSpeed;
        }
        if (status.estimatedRemaining !== undefined) {
            const eta = status.estimatedRemaining > 0 ? status.estimatedRemaining + ' 分钟' : '-';
            document.getElementById('crawler-eta').textContent = eta;
        }
        
        // 更新日志
        if (status.logs && status.logs.length > 0) {
            const logsContainer = document.getElementById('crawler-logs');
            logsContainer.innerHTML = status.logs.map(log => {
                let color = '#eee';
                if (log.type === 'success') color = '#4CAF50';
                else if (log.type === 'error') color = '#f44336';
                else if (log.type === 'warn') color = '#ff9800';
                
                return `<div style="color: ${color}; margin-bottom: 4px;">
                    <span style="color: #888;">[${log.time}]</span> ${this.escapeHtml(log.message)}
                </div>`;
            }).join('');
        }
    },
    
    formatElapsed(seconds) {
        if (!seconds) return '0s';
        if (seconds < 60) return seconds + 's';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins < 60) return `${mins}m ${secs}s`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ${mins % 60}m`;
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => Admin.init());
