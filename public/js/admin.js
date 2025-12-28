/**
 * PO18小说下载网站 - 后台管理模块
 */

const Admin = {
    baseUrl: "/api/admin",
    currentUser: null,
    
    // 性能监控状态
    monitoringState: {
        charts: {},
        alertConfig: {
            cpuThreshold: 80,
            memoryThreshold: 85,
            diskThreshold: 90
        }
    },

    // 分页状态
    pagination: {
        users: { page: 1, pageSize: 20, total: 0 },
        books: { page: 1, pageSize: 20, total: 0 },
        shared: { page: 1, pageSize: 20, total: 0 },
        export: { page: 1, pageSize: 50, total: 0 }
    },

    // 导出相关状态
    exportState: {
        selectedBooks: new Set(),
        isExporting: false
    },
    
    // 备份管理状态
    backupState: {
        selectedBackup: null,
        backups: []
    },
    

    // 初始化
    init() {
        this.checkAuth(); // 改为调用权限检查函数
    },

    // 检查权限
    async checkAuth() {
        try {
            // 验证权限
            const result = await this.request("/check");
            if (!result.isAdmin) {
                document.getElementById("loading").style.display = "none";
                document.getElementById("no-access").style.display = "block";
                return;
            }

            this.currentUser = result.user;
            document.getElementById("loading").style.display = "none";
            document.getElementById("admin-main").style.display = "block";

            // 绑定事件
            this.bindEvents();

            // 加载概览数据
            await this.loadDashboard();
        } catch (error) {
            document.getElementById("loading").style.display = "none";
            document.getElementById("no-access").style.display = "block";
        }
    },

    // API请求
    async request(endpoint, options = {}) {
        const response = await fetch(this.baseUrl + endpoint, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...options.headers
            }
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "请求失败");
        }
        return data;
    },

    // 绑定事件
    bindEvents() {
        // 导航切换
        document.querySelectorAll('.admin-nav-btn[data-panel]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const panel = e.target.dataset.panel;
                this.switchPanel(panel);
            });
        });

        // 注册开关事件
        const registrationToggle = document.getElementById('registration-toggle');
        if (registrationToggle) {
            registrationToggle.addEventListener('change', () => {
                this.toggleRegistration();
            });
        }

        // 面板切换
        document.querySelectorAll('.admin-panel').forEach(panel => {
            panel.style.display = 'none';
        });
        document.getElementById('panel-dashboard').style.display = 'block';
        document.querySelector('.admin-nav-btn[data-panel="dashboard"]').classList.add('active');
    },

    // 切换面板
    switchPanel(panelName) {
        // 隐藏所有面板
        document.querySelectorAll('.admin-panel').forEach(panel => {
            panel.style.display = 'none';
        });

        // 移除所有激活状态
        document.querySelectorAll('.admin-nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // 显示目标面板
        document.getElementById(`panel-${panelName}`).style.display = 'block';

        // 激活导航按钮
        document.querySelector(`.admin-nav-btn[data-panel="${panelName}"]`).classList.add('active');

        // 根据面板执行相应操作
        switch (panelName) {
            case 'monitor':
                this.loadMonitor();
                break;
            case 'users':
                this.loadUsers();
                break;
            case 'books':
                this.loadBooks();
                break;
            case 'shared':
                this.loadShared();
                break;
            case 'export':
                this.loadExportBooks();
                break;
            case 'crawler':
                this.fetchCrawlerStatus();
                break;
            case 'backup':
                this.refreshBackups();
                break;
            case 'monitoring':
                this.initMonitoring();
                break;
            case 'settings':
                // 系统设置面板不需要特殊加载操作
                break;
            case 'corrections':
                this.loadCorrections();
                break;
        }
    },

    // 初始化性能监控面板
    async initMonitoring() {
        // 初始化图表
        this.initCharts();
        
        // 加载告警配置
        await this.loadAlertConfig();
        
        // 开始实时监控
        this.startRealTimeMonitoring();
        
        // 绑定事件
        this.bindMonitoringEvents();
    },

    // 开始实时监控
    startRealTimeMonitoring() {
        // 每5秒更新一次监控数据
        setInterval(async () => {
            try {
                const response = await fetch('/api/admin/monitor/system-stats');
                if (response.ok) {
                    const stats = await response.json();
                    this.updateCharts(stats);
                }
            } catch (error) {
                console.warn('获取系统监控数据失败:', error);
            }
        }, 5000);
        
        // 立即获取一次数据
        setTimeout(async () => {
            try {
                const response = await fetch('/api/admin/monitor/system-stats');
                if (response.ok) {
                    const stats = await response.json();
                    this.updateCharts(stats);
                }
            } catch (error) {
                console.warn('获取系统监控数据失败:', error);
            }
        }, 100);
    },

    // 初始化图表
    initCharts() {
        // 这里我们会使用Chart.js来绘制图表
        // 由于Chart.js已经在HTML中引入，我们可以直接使用
        
        const cpuCtx = document.getElementById('cpuChart').getContext('2d');
        const memoryCtx = document.getElementById('memoryChart').getContext('2d');
        const networkCtx = document.getElementById('networkChart').getContext('2d');
        
        // 销毁已存在的图表（如果有的话）
        if (this.monitoringState.charts.cpu) {
            this.monitoringState.charts.cpu.destroy();
        }
        if (this.monitoringState.charts.memory) {
            this.monitoringState.charts.memory.destroy();
        }
        if (this.monitoringState.charts.network) {
            this.monitoringState.charts.network.destroy();
        }
        
        // 初始化CPU使用率图表
        this.monitoringState.charts.cpu = new Chart(cpuCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'CPU使用率 (%)',
                    data: [],
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        min: 0,
                        max: 100
                    }
                }
            }
        });
        
        // 初始化内存使用率图表
        this.monitoringState.charts.memory = new Chart(memoryCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: '内存使用率 (%)',
                    data: [],
                    borderColor: 'rgb(54, 162, 235)',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        min: 0,
                        max: 100
                    }
                }
            }
        });
        
        // 初始化网络流量图表
        this.monitoringState.charts.network = new Chart(networkCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: '网络流入 (KB/s)',
                    data: [],
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.1
                }, {
                    label: '网络流出 (KB/s)',
                    data: [],
                    borderColor: 'rgb(153, 102, 255)',
                    backgroundColor: 'rgba(153, 102, 255, 0.2)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    },

    // 加载告警配置
    async loadAlertConfig() {
        try {
            const response = await fetch('/api/admin/monitor/alert-config');
            if (response.ok) {
                const config = await response.json();
                this.monitoringState.alertConfig = config;
                
                // 更新UI
                document.getElementById('cpuThreshold').value = config.cpuThreshold;
                document.getElementById('memoryThreshold').value = config.memoryThreshold;
                document.getElementById('diskThreshold').value = config.diskThreshold;
            }
        } catch (error) {
            console.warn('加载告警配置失败:', error);
        }
    },



    // 更新图表
    updateCharts(stats) {
        const now = new Date().toLocaleTimeString();
        
        // 更新CPU图表
        if (this.monitoringState.charts.cpu) {
            const cpuData = this.monitoringState.charts.cpu.data;
            cpuData.labels.push(now);
            cpuData.datasets[0].data.push(stats.cpu.usage);
            
            // 只保留最近20个数据点
            if (cpuData.labels.length > 20) {
                cpuData.labels.shift();
                cpuData.datasets[0].data.shift();
            }
            
            this.monitoringState.charts.cpu.update();
        }
        
        // 更新内存图表
        if (this.monitoringState.charts.memory) {
            const memoryData = this.monitoringState.charts.memory.data;
            memoryData.labels.push(now);
            memoryData.datasets[0].data.push(stats.memory.usagePercent);
            
            // 只保留最近20个数据点
            if (memoryData.labels.length > 20) {
                memoryData.labels.shift();
                memoryData.datasets[0].data.shift();
            }
            
            this.monitoringState.charts.memory.update();
        }
        
        // 更新网络图表
        if (this.monitoringState.charts.network) {
            const networkData = this.monitoringState.charts.network.data;
            networkData.labels.push(now);
            networkData.datasets[0].data.push(Math.round(stats.network.rx_bytes / 1024));
            networkData.datasets[1].data.push(Math.round(stats.network.tx_bytes / 1024));
            
            // 只保留最近20个数据点
            if (networkData.labels.length > 20) {
                networkData.labels.shift();
                networkData.datasets[0].data.shift();
                networkData.datasets[1].data.shift();
            }
            
            this.monitoringState.charts.network.update();
        }
        
        // 检查是否需要触发告警
        this.checkAlerts(stats);
    },

    // 检查告警
    checkAlerts(stats) {
        const config = this.monitoringState.alertConfig;
        const alerts = [];
        
        // 检查CPU使用率
        if (stats.cpu.usage > config.cpuThreshold) {
            alerts.push({
                time: new Date().toISOString(),
                type: 'CPU使用率过高',
                level: 'warning',
                detail: `CPU使用率达到 ${stats.cpu.usage}%，超过阈值 ${config.cpuThreshold}%`
            });
        }
        
        // 检查内存使用率
        if (stats.memory.usagePercent > config.memoryThreshold) {
            alerts.push({
                time: new Date().toISOString(),
                type: '内存使用率过高',
                level: 'warning',
                detail: `内存使用率达到 ${stats.memory.usagePercent}%，超过阈值 ${config.memoryThreshold}%`
            });
        }
        
        // 检查磁盘使用率
        if (stats.disk.usagePercent > config.diskThreshold) {
            alerts.push({
                time: new Date().toISOString(),
                type: '磁盘使用率过高',
                level: 'warning',
                detail: `磁盘使用率达到 ${stats.disk.usagePercent}%，超过阈值 ${config.diskThreshold}%`
            });
        }
        
        // 如果有告警，显示通知
        if (alerts.length > 0) {
            alerts.forEach(alert => {
                this.showToast(`${alert.type}: ${alert.detail}`, 'warning');
            });
        }
    },

    // 绑定监控面板事件
    bindMonitoringEvents() {
        // 保存告警配置按钮
        const saveBtn = document.getElementById('saveAlertConfig');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveAlertConfig();
            });
        }
    },

    // 保存告警配置
    async saveAlertConfig() {
        try {
            const config = {
                cpuThreshold: parseInt(document.getElementById('cpuThreshold').value),
                memoryThreshold: parseInt(document.getElementById('memoryThreshold').value),
                diskThreshold: parseInt(document.getElementById('diskThreshold').value)
            };
            
            const response = await fetch('/api/admin/monitor/alert-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
            
            if (response.ok) {
                this.monitoringState.alertConfig = config;
                this.showToast('告警配置保存成功', 'success');
            } else {
                this.showToast('保存告警配置失败', 'error');
            }
        } catch (error) {
            this.showToast('保存告警配置失败: ' + error.message, 'error');
        }
    },

    // 加载概览
    async loadDashboard() {
        try {
            // 显示加载状态
            this.showLoading();
            
            // 并行加载所有数据
            const [stats, config, monitorData] = await Promise.all([
                this.request("/stats"),
                this.request("/config"),
                this.request("/monitor/dashboard")
            ]);
            
            // 更新统计数据
            document.getElementById("stat-users").textContent = stats.users || 0;
            document.getElementById("stat-books").textContent = stats.books || 0;
            document.getElementById("stat-total-chapters").textContent = (stats.totalChapters || 0).toLocaleString();
            document.getElementById("stat-cached-chapters").textContent = (stats.cachedChapters || 0).toLocaleString();
            document.getElementById("stat-shared").textContent = stats.shared || 0;
            document.getElementById("stat-downloads").textContent = stats.downloads || 0;
            
            // 更新系统配置
            const toggle = document.getElementById("registration-toggle");
            const status = document.getElementById("registration-status");
            toggle.checked = config.registrationEnabled;
            status.textContent = config.registrationEnabled ? "当前状态：开放" : "当前状态：关闭";
            status.style.color = config.registrationEnabled ? "#4CAF50" : "#f44336";
            
            // 更新监控数据
            document.getElementById("monitor-active-today").textContent = monitorData.activity.active.today;
            document.getElementById("monitor-active-week").textContent = monitorData.activity.active.week;
            document.getElementById("monitor-active-month").textContent = monitorData.activity.active.month;
            document.getElementById("monitor-active-total").textContent = monitorData.activity.active.total;
            
            document.getElementById("monitor-db-size").textContent = this.formatBytes(monitorData.database.size);
            document.getElementById("monitor-table-users").textContent = monitorData.database.tables.users.toLocaleString();
            document.getElementById("monitor-table-bookshelf").textContent = monitorData.database.tables.bookshelf.toLocaleString();
            document.getElementById("monitor-table-chapters").textContent = monitorData.database.tables.chapter_cache.toLocaleString();
            
            // 更新最后刷新时间
            const now = new Date();
            document.getElementById("dashboard-last-update").textContent = `最后更新: ${now.toLocaleTimeString()}`;
            
            // 隐藏加载状态
            this.hideLoading();
        } catch (error) {
            this.hideLoading();
            this.showToast("加载统计失败: " + error.message, "error");
        }
    },

    // 切换注册开关
    async toggleRegistration() {
        try {
            const toggle = document.getElementById("registration-toggle");
            const enabled = toggle.checked;

            const result = await this.request("/config/registration", {
                method: "POST",
                body: JSON.stringify({ enabled })
            });

            const status = document.getElementById("registration-status");
            status.textContent = result.registrationEnabled ? "当前状态：开放" : "当前状态：关闭";
            status.style.color = result.registrationEnabled ? "#4CAF50" : "#f44336";

            this.showToast(result.registrationEnabled ? "已开放注册" : "已关闭注册", "success");
        } catch (error) {
            // 出错时恢复复选框状态
            const toggle = document.getElementById("registration-toggle");
            toggle.checked = !toggle.checked;
            this.showToast("切换失败: " + error.message, "error");
        }
    },

    // ==================== 用户管理 ====================

    async loadUsers(page = 1) {
        try {
            const keyword = document.getElementById("user-search").value;
            const result = await this.request(`/users?page=${page}&pageSize=20&keyword=${encodeURIComponent(keyword)}`);

            this.pagination.users = { page, pageSize: 20, total: result.total };
            this.renderUsersTable(result.users);
            this.renderPagination("users", result.total, page);
        } catch (error) {
            this.showToast("加载用户失败: " + error.message, "error");
        }
    },

    searchUsers() {
        this.loadUsers(1);
    },

    renderUsersTable(users) {
        const tbody = document.getElementById("users-table-body");
        tbody.innerHTML = users
            .map(
                (user) => `
            <tr>
                <td>${user.id}</td>
                <td><strong>${this.escapeHtml(user.username)}</strong></td>
                <td>${user.po18_cookie ? "✅ 已设置" : "❌ 未设置"}</td>
                <td>${user.share_enabled ? "✅ 已启用" : "❌ 未启用"}</td>
                <td>${user.cache_auth ? "✅ 已授权" : "❌ 未授权"}</td>
                <td>${user.library_auth ? "✅ 已授权" : "❌ 未授权"}</td>
                <td>${user.shared_books_count || 0}</td>
                <td>${this.formatDate(user.created_at)}</td>
                <td class="actions">
                    <button class="btn-sm btn-edit" onclick="Admin.editUser(${user.id})">编辑</button>
                    <button class="btn-sm btn-delete" onclick="Admin.deleteUser(${user.id})">删除</button>
                </td>
            </tr>
        `
            )
            .join("");
    },

    async editUser(id) {
        try {
            const user = await this.request(`/users/${id}`);
            document.getElementById("edit-user-id").value = user.id;
            document.getElementById("edit-user-username").value = user.username;
            document.getElementById("edit-user-password").value = "";
            document.getElementById("edit-user-cookie").value = user.po18_cookie || "";
            document.getElementById("edit-user-share").value = user.share_enabled ? "1" : "0";
            document.getElementById("edit-user-cache-auth").value = user.cache_auth ? "1" : "0";
            document.getElementById("edit-user-library-auth").value = user.library_auth ? "1" : "0";

            document.getElementById("user-edit-modal").classList.add("active");
        } catch (error) {
            this.showToast("获取用户信息失败: " + error.message, "error");
        }
    },

    async saveUser() {
        try {
            const id = document.getElementById("edit-user-id").value;
            const data = {
                password: document.getElementById("edit-user-password").value || undefined,
                po18_cookie: document.getElementById("edit-user-cookie").value,
                share_enabled: parseInt(document.getElementById("edit-user-share").value),
                cache_auth: parseInt(document.getElementById("edit-user-cache-auth").value),
                library_auth: parseInt(document.getElementById("edit-user-library-auth").value)
            };

            await this.request(`/users/${id}`, {
                method: "PUT",
                body: JSON.stringify(data)
            });

            this.closeModal("user-edit-modal");
            this.showToast("用户保存成功", "success");
            await this.loadUsers(this.pagination.users.page);
        } catch (error) {
            this.showToast("保存失败: " + error.message, "error");
        }
    },

    async deleteUser(id) {
        if (!confirm("确定要删除此用户吗？此操作不可恢复！")) return;

        try {
            await this.request(`/users/${id}`, { method: "DELETE" });
            this.showToast("用户已删除", "success");
            await this.loadUsers(this.pagination.users.page);
        } catch (error) {
            this.showToast("删除失败: " + error.message, "error");
        }
    },

    // ==================== 书籍管理 ====================

    async loadBooks(page = 1) {
        try {
            const keyword = document.getElementById("book-search").value;
            const result = await this.request(`/books?page=${page}&pageSize=20&keyword=${encodeURIComponent(keyword)}`);

            this.pagination.books = { page, pageSize: 20, total: result.total };
            this.renderBooksTable(result.books);
            this.renderPagination("books", result.total, page);
        } catch (error) {
            this.showToast("加载书籍失败: " + error.message, "error");
        }
    },

    searchBooks() {
        this.loadBooks(1);
    },

    renderBooksTable(books) {
        const tbody = document.getElementById("books-table-body");
        tbody.innerHTML = books
            .map((book) => {
                // 状态显示
                const statusText =
                    {
                        completed: "完结",
                        ongoing: "连载中",
                        unknown: "未知"
                    }[book.status] ||
                    book.status ||
                    "-";

                // 格式化字数
                const wordCount = book.word_count ? book.word_count.toLocaleString() : "-";

                return `
                <tr>
                    <td>${book.book_id}</td>
                    <td><img src="${book.cover || "/img/no-cover.png"}" style="width:36px;height:50px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'"></td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(book.title || "未知")}"><strong>${this.escapeHtml(book.title || "未知")}</strong></td>
                    <td>${this.escapeHtml(book.author || "未知")}</td>
                    <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(book.tags || "")}">
                        ${this.escapeHtml((book.tags || "").split("·")[0] || "-")}
                    </td>
                    <td style="text-align:center;">${book.total_chapters || book.subscribed_chapters || "-"}</td>
                    <td style="text-align:center;">${book.free_chapters || "-"}</td>
                    <td style="text-align:center;">${book.paid_chapters || "-"}</td>
                    <td style="text-align:right;">${wordCount}</td>
                    <td style="text-align:center;">${statusText}</td>
                    <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(book.latest_chapter_name || "")}">
                        ${this.escapeHtml(book.latest_chapter_name || "-")}
                    </td>
                    <td>${book.latest_chapter_date || "-"}</td>
                    <td class="actions">
                        <button class="btn-sm btn-edit" onclick="Admin.editBook('${book.book_id}')">编辑</button>
                        <button class="btn-sm btn-delete" onclick="Admin.deleteBook('${book.book_id}')">删除</button>
                    </td>
                </tr>
            `;
            })
            .join("");
    },

    async editBook(bookId) {
        try {
            const book = await this.request(`/books/${bookId}`);
            document.getElementById("edit-book-id").value = book.id;
            document.getElementById("edit-book-bid").value = book.book_id;
            document.getElementById("edit-book-title").value = book.title || "";
            document.getElementById("edit-book-author").value = book.author || "";
            document.getElementById("edit-book-tags").value = book.tags || "";
            document.getElementById("edit-book-wordcount").value = book.word_count || "";
            document.getElementById("edit-book-total-chapters").value = book.total_chapters || "";
            document.getElementById("edit-book-free-chapters").value = book.free_chapters || "";
            document.getElementById("edit-book-paid-chapters").value = book.paid_chapters || "";
            document.getElementById("edit-book-status").value = book.status || "unknown";
            document.getElementById("edit-book-latest-chapter").value = book.latest_chapter_name || "";
            document.getElementById("edit-book-latest-date").value = book.latest_chapter_date || "";
            document.getElementById("edit-book-platform").value = book.platform || "po18";
            document.getElementById("edit-book-description").value = book.description || "";
            document.getElementById("edit-book-cover").value = book.cover || "";

            document.getElementById("book-edit-modal").classList.add("active");
        } catch (error) {
            this.showToast("获取书籍信息失败: " + error.message, "error");
        }
    },

    async saveBook() {
        try {
            const bookId = document.getElementById("edit-book-bid").value;
            const data = {
                title: document.getElementById("edit-book-title").value,
                author: document.getElementById("edit-book-author").value,
                tags: document.getElementById("edit-book-tags").value,
                word_count: parseInt(document.getElementById("edit-book-wordcount").value) || 0,
                total_chapters: parseInt(document.getElementById("edit-book-total-chapters").value) || 0,
                free_chapters: parseInt(document.getElementById("edit-book-free-chapters").value) || 0,
                paid_chapters: parseInt(document.getElementById("edit-book-paid-chapters").value) || 0,
                status: document.getElementById("edit-book-status").value,
                latest_chapter_name: document.getElementById("edit-book-latest-chapter").value,
                latest_chapter_date: document.getElementById("edit-book-latest-date").value,
                platform: document.getElementById("edit-book-platform").value,
                description: document.getElementById("edit-book-description").value,
                cover: document.getElementById("edit-book-cover").value
            };

            await this.request(`/books/${bookId}`, {
                method: "PUT",
                body: JSON.stringify(data)
            });

            this.closeModal("book-edit-modal");
            this.showToast("书籍保存成功", "success");
            await this.loadBooks(this.pagination.books.page);
        } catch (error) {
            this.showToast("保存失败: " + error.message, "error");
        }
    },

    async deleteBook(bookId) {
        if (!confirm("确定要删除此书籍元信息吗？")) return;

        try {
            await this.request(`/books/${bookId}`, { method: "DELETE" });
            this.showToast("书籍已删除", "success");
            await this.loadBooks(this.pagination.books.page);
        } catch (error) {
            this.showToast("删除失败: " + error.message, "error");
        }
    },

    // ==================== 共享书库管理 ====================

    async loadShared(page = 1) {
        try {
            const keyword = document.getElementById("shared-search").value;
            const result = await this.request(
                `/shared?page=${page}&pageSize=20&keyword=${encodeURIComponent(keyword)}`
            );

            this.pagination.shared = { page, pageSize: 20, total: result.total };
            this.renderSharedTable(result.books);
            this.renderPagination("shared", result.total, page);
        } catch (error) {
            this.showToast("加载共享书库失败: " + error.message, "error");
        }
    },

    searchShared() {
        this.loadShared(1);
    },

    renderSharedTable(books) {
        const tbody = document.getElementById("shared-table-body");
        tbody.innerHTML = books
            .map(
                (book) => `
            <tr>
                <td>${book.id}</td>
                <td><strong>${this.escapeHtml(book.title || "未知")}</strong></td>
                <td>${this.escapeHtml(book.author || "未知")}</td>
                <td>${book.format || "-"}</td>
                <td>${this.escapeHtml(book.uploader_name || "未知")}</td>
                <td>${book.download_count || 0}</td>
                <td>${this.formatDate(book.created_at)}</td>
                <td class="actions">
                    <button class="btn-sm btn-view" onclick="Admin.downloadShared(${book.id})">下载</button>
                    <button class="btn-sm btn-delete" onclick="Admin.deleteShared(${book.id})">删除</button>
                </td>
            </tr>
        `
            )
            .join("");
    },

    downloadShared(id) {
        window.open(`/api/share/download/${id}`, "_blank");
    },

    async deleteShared(id) {
        if (!confirm("确定要删除此共享书籍吗？")) return;

        try {
            await this.request(`/shared/${id}`, { method: "DELETE" });
            this.showToast("共享书籍已删除", "success");
            await this.loadShared(this.pagination.shared.page);
        } catch (error) {
            this.showToast("删除失败: " + error.message, "error");
        }
    },

    // ==================== 书库导出 ====================

    async loadExportBooks(page = 1) {
        try {
            const keyword = document.getElementById("export-search").value;
            const result = await this.request(
                `/export/books?page=${page}&pageSize=50&keyword=${encodeURIComponent(keyword)}`
            );

            console.log("导出书籍数据:", result);

            this.pagination.export = { page, pageSize: 50, total: result.total };
            this.renderExportBooksTable(result.books);
            this.renderPagination("export", result.total, page);
        } catch (error) {
            console.error("加载导出书籍失败:", error);
            this.showToast("加载书籍列表失败: " + error.message, "error");
        }
    },

    searchExportBooks() {
        this.loadExportBooks(1);
    },

    renderExportBooksTable(books) {
        const tbody = document.getElementById("export-books-table-body");

        if (!books || books.length === 0) {
            tbody.innerHTML =
                '<tr><td colspan="10" style="text-align:center;padding:40px;color:#666;">暂无书籍数据</td></tr>';
            return;
        }

        console.log("渲染书籍数据，总数:", books.length);

        tbody.innerHTML = books
            .map((book) => {
                const statusText =
                    {
                        completed: "完结",
                        ongoing: "连载中",
                        unknown: "未知"
                    }[book.status] ||
                    book.status ||
                    "-";

                const isSelected = this.exportState.selectedBooks.has(book.book_id);

                return `
                <tr>
                    <td style="width:50px;text-align:center;padding:8px;"><input type="checkbox" class="book-checkbox" data-book-id="${book.book_id}" ${isSelected ? "checked" : ""} onchange="Admin.toggleBookSelection('${book.book_id}', this.checked)" style="width:18px;height:18px;cursor:pointer;"></td>
                    <td>${book.book_id}</td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(book.title || "未知")}">
                        <strong>${this.escapeHtml(book.title || "未知")}</strong>
                    </td>
                    <td>${this.escapeHtml(book.author || "未知")}</td>
                    <td style="text-align:center;"><strong style="color: #4CAF50;">${book.cached_chapters || 0}</strong></td>
                    <td style="text-align:center;">${book.total_chapters || "-"}</td>
                    <td style="text-align:center;">${book.free_chapters || "-"}</td>
                    <td style="text-align:center;">${book.paid_chapters || "-"}</td>
                    <td style="text-align:center;">${statusText}</td>
                    <td>${book.latest_chapter_date || "-"}</td>
                </tr>
            `;
            })
            .join("");

        console.log("表格渲染完成");
    },

    toggleBookSelection(bookId, checked) {
        if (checked) {
            this.exportState.selectedBooks.add(bookId);
        } else {
            this.exportState.selectedBooks.delete(bookId);
            document.getElementById("select-all-books").checked = false;
        }
    },

    toggleAllBooks(checked) {
        document.querySelectorAll(".book-checkbox").forEach((checkbox) => {
            checkbox.checked = checked;
            const bookId = checkbox.dataset.bookId;
            if (checked) {
                this.exportState.selectedBooks.add(bookId);
            } else {
                this.exportState.selectedBooks.delete(bookId);
            }
        });
    },

    selectAllBooks() {
        document.getElementById("select-all-books").checked = true;
        this.toggleAllBooks(true);
    },

    deselectAllBooks() {
        document.getElementById("select-all-books").checked = false;
        this.toggleAllBooks(false);
    },

    async startExport() {
        if (this.exportState.isExporting) {
            this.showToast("正在导出中，请稍后...", "warning");
            return;
        }

        const selectedBooks = Array.from(this.exportState.selectedBooks);
        if (selectedBooks.length === 0) {
            this.showToast("请至少选择一本书", "warning");
            return;
        }

        const exportTxt = document.getElementById("export-format-txt").checked;
        const exportEpub = document.getElementById("export-format-epub").checked;

        if (!exportTxt && !exportEpub) {
            this.showToast("请至少选择一种导出格式", "warning");
            return;
        }

        const formats = [];
        if (exportTxt) formats.push("txt");
        if (exportEpub) formats.push("epub");

        this.exportState.isExporting = true;
        document.getElementById("export-progress").style.display = "block";
        document.getElementById("export-total").textContent = selectedBooks.length * formats.length;
        document.getElementById("export-current").textContent = "0";
        document.getElementById("export-progress-bar").style.width = "0%";

        try {
            let completed = 0;
            const total = selectedBooks.length * formats.length;

            for (const bookId of selectedBooks) {
                for (const format of formats) {
                    document.getElementById("export-status").textContent = `正在导出 ${bookId} (${format})…`;

                    try {
                        // 调用导出接口
                        const response = await fetch(`${this.baseUrl}/export/book/${bookId}?format=${format}`);

                        if (response.ok) {
                            const blob = await response.blob();
                            const disposition = response.headers.get("Content-Disposition");
                            let filename = `${bookId}.${format}`;

                            if (disposition) {
                                const match = disposition.match(/filename\*=UTF-8''(.+)/);
                                if (match) {
                                    filename = decodeURIComponent(match[1]);
                                }
                            }

                            // 下载文件
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            window.URL.revokeObjectURL(url);

                            // 等待一下，避免浏览器阻止多文件下载
                            await new Promise((resolve) => setTimeout(resolve, 500));
                        } else {
                            console.error(`导出 ${bookId} (${format}) 失败`);
                        }
                    } catch (err) {
                        console.error(`导出 ${bookId} (${format}) 错误:`, err);
                    }

                    completed++;
                    const percent = Math.round((completed / total) * 100);
                    document.getElementById("export-current").textContent = completed;
                    document.getElementById("export-progress-bar").style.width = percent + "%";
                }
            }

            document.getElementById("export-status").textContent = "导出完成！";
            this.showToast(`成功导出 ${selectedBooks.length} 本书！`, "success");

            setTimeout(() => {
                document.getElementById("export-progress").style.display = "none";
            }, 3000);
        } catch (error) {
            this.showToast("导出失败: " + error.message, "error");
            document.getElementById("export-progress").style.display = "none";
        } finally {
            this.exportState.isExporting = false;
        }
    },

    // ==================== 工具方法 ====================

    renderPagination(type, total, currentPage) {
        const pageSize = type === "export" ? 50 : 20;
        const totalPages = Math.ceil(total / pageSize);
        const container = document.getElementById(`${type}-pagination`);

        if (totalPages <= 1) {
            container.innerHTML = "";
            return;
        }

        let html = "";
        const funcName = type === "export" ? "loadExportBooks" : `load${type.charAt(0).toUpperCase() + type.slice(1)}`;
        html += `<button ${currentPage === 1 ? "disabled" : ""} onclick="Admin.${funcName}(${currentPage - 1})">上一页</button>`;

        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
                html += `<button class="${i === currentPage ? "active" : ""}" onclick="Admin.${funcName}(${i})">${i}</button>`;
            } else if (i === currentPage - 3 || i === currentPage + 3) {
                html += "<button disabled>...</button>";
            }
        }

        html += `<button ${currentPage === totalPages ? "disabled" : ""} onclick="Admin.${funcName}(${currentPage + 1})">下一页</button>`;

        container.innerHTML = html;
    },

    closeModal(id) {
        document.getElementById(id).classList.remove("active");
    },

    showToast(message, type = "info") {
        const toast = document.getElementById("toast");
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        setTimeout(() => toast.classList.remove("show"), 3000);
    },

    escapeHtml(str) {
        if (!str) return "";
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },

    formatDate(dateStr) {
        if (!dateStr) return "-";
        const date = new Date(dateStr);
        return date.toLocaleDateString("zh-CN");
    },

    // ==================== ID遍历控制 ====================

    crawlerPollingInterval: null,

    // 切换爬虫模式
    toggleCrawlerMode() {
        const mode = document.querySelector('input[name="crawler-mode"]:checked').value;
        const startIdInput = document.getElementById("crawler-start-id");
        const endIdInput = document.getElementById("crawler-end-id");

        if (mode === "database") {
            // 数据库模式：禁用ID输入
            startIdInput.disabled = true;
            endIdInput.disabled = true;
            startIdInput.value = "";
            endIdInput.value = "";
        } else {
            // ID范围模式：启用ID输入
            startIdInput.disabled = false;
            endIdInput.disabled = false;
        }
    },

    async startCrawler() {
        const mode = document.querySelector('input[name="crawler-mode"]:checked').value;
        const startId = document.getElementById("crawler-start-id").value;
        const endId = document.getElementById("crawler-end-id").value;
        const delay = document.getElementById("crawler-delay").value;
        const concurrency = document.getElementById("crawler-concurrency").value;

        // 只有ID范围模式需要验证ID
        if (mode === "range" && (!startId || !endId)) {
            this.showToast("请输入开始ID和结束ID", "error");
            return;
        }

        try {
            const body = { mode, delay, concurrency };
            if (mode === "range") {
                body.startId = startId;
                body.endId = endId;
            }

            const response = await fetch("/api/admin/crawler/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });

            const result = await response.json();

            if (!response.ok) {
                this.showToast(result.error || "启动失败", "error");
                return;
            }

            const modeText = concurrency > 1 ? `并发模式 (${concurrency}个线程)` : "单线程模式";
            this.showToast(`遍历已启动 - ${modeText}`, "success");
            document.getElementById("crawler-start-btn").disabled = true;
            document.getElementById("crawler-stop-btn").disabled = false;

            // 开始轮询状态
            this.startCrawlerPolling();
        } catch (error) {
            this.showToast("启动失败: " + error.message, "error");
        }
    },

    async stopCrawler() {
        try {
            const response = await fetch("/api/admin/crawler/stop", {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });

            const result = await response.json();

            if (response.ok) {
                this.showToast("正在停止遍历...", "info");
            } else {
                this.showToast(result.error || "停止失败", "error");
            }
        } catch (error) {
            this.showToast("停止失败: " + error.message, "error");
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
            const response = await fetch("/api/admin/crawler/status");
            const status = await response.json();

            this.updateCrawlerUI(status);

            // 如果不再运行，停止轮询
            if (!status.isRunning) {
                this.stopCrawlerPolling();
                document.getElementById("crawler-start-btn").disabled = false;
                document.getElementById("crawler-stop-btn").disabled = true;
            }
        } catch (error) {
            console.error("获取遍历状态失败:", error);
        }
    },

    updateCrawlerUI(status) {
        // 更新状态
        document.getElementById("crawler-state").textContent = status.isRunning ? "运行中" : "已停止";
        document.getElementById("crawler-state").style.color = status.isRunning ? "#4CAF50" : "#666";

        // 更新进度
        document.getElementById("crawler-current-id").textContent = status.currentId || "-";
        document.getElementById("crawler-progress").textContent = status.progress + "%";
        document.getElementById("crawler-progress-bar").style.width = status.progress + "%";

        // 更新统计
        document.getElementById("crawler-success").textContent = status.successCount;
        document.getElementById("crawler-fail").textContent = status.failCount;
        document.getElementById("crawler-processed").textContent = status.totalProcessed;
        document.getElementById("crawler-elapsed").textContent = this.formatElapsed(status.elapsedSeconds);

        // 更新并发相关信息
        if (status.concurrency !== undefined) {
            document.getElementById("crawler-concurrency-display").textContent = status.concurrency;
        }
        if (status.activeThreads !== undefined) {
            document.getElementById("crawler-active-threads").textContent = status.activeThreads;
        }
        if (status.pendingCount !== undefined) {
            document.getElementById("crawler-pending").textContent = status.pendingCount;
        }
        if (status.avgSpeed !== undefined) {
            document.getElementById("crawler-speed").textContent = status.avgSpeed;
        }
        if (status.estimatedRemaining !== undefined) {
            const eta = status.estimatedRemaining > 0 ? status.estimatedRemaining + " 分钟" : "-";
            document.getElementById("crawler-eta").textContent = eta;
        }

        // 更新日志
        if (status.logs && status.logs.length > 0) {
            const logsContainer = document.getElementById("crawler-logs");
            logsContainer.innerHTML = status.logs
                .map((log) => {
                    let color = "#eee";
                    if (log.type === "success") color = "#4CAF50";
                    else if (log.type === "error") color = "#f44336";
                    else if (log.type === "warn") color = "#ff9800";

                    return `<div style="color: ${color}; margin-bottom: 4px;">
                    <span style="color: #888;">[${log.time}]</span> ${this.escapeHtml(log.message)}
                </div>`;
                })
                .join("");
        }
    },

    formatElapsed(seconds) {
        if (!seconds) return "0s";
        if (seconds < 60) return seconds + "s";
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins < 60) return `${mins}m ${secs}s`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ${mins % 60}m`;
    },

    // ==================== 系统监控 ====================

    async loadMonitor() {
        try {
            await Promise.all([this.loadSystemStatus(), this.loadActivityStats()]);
            
            // 更新最后刷新时间
            const now = new Date();
            document.getElementById("monitor-last-update").textContent = `最后更新: ${now.toLocaleTimeString()}`;
        } catch (error) {
            this.showToast("加载监控数据失败: " + error.message, "error");
        }
    },
    
    async loadSystemStatus() {
        const data = await this.request("/monitor/system");
        
        // CPU
        document.getElementById("monitor-cpu-cores").textContent = data.cpu.cores;
        
        // 内存
        document.getElementById("monitor-mem-percent").textContent = data.memory.usagePercent + "%";
        document.getElementById("monitor-mem-used").textContent = this.formatBytes(data.memory.used);
        
        // 运行时间
        document.getElementById("monitor-sys-uptime").textContent = this.formatUptime(data.system.uptime);
        document.getElementById("monitor-process-uptime").textContent = this.formatUptime(data.process.uptime);
        
        // 进程内存
        document.getElementById("monitor-process-mem").textContent = this.formatBytes(data.process.memory.heapUsed);
        
        // 系统信息
        document.getElementById("monitor-platform").textContent = data.system.platform;
        document.getElementById("monitor-arch").textContent = data.system.arch;
        document.getElementById("monitor-hostname").textContent = data.system.hostname;
    },
    
    async loadActivityStats() {
        const data = await this.request("/monitor/activity");
        
        document.getElementById("monitor-active-today").textContent = data.active.today;
        document.getElementById("monitor-active-week").textContent = data.active.week;
        document.getElementById("monitor-active-month").textContent = data.active.month;
        document.getElementById("monitor-active-total").textContent = data.active.total;
        
        document.getElementById("monitor-today-users").textContent = data.todayReading.users;
        document.getElementById("monitor-today-minutes").textContent = data.todayReading.minutes + " 分钟";
    },

    async refreshMonitor() {
        await this.loadMonitor();
        this.showToast("监控数据已刷新", "success");
    },

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    formatUptime(seconds) {
        const days = Math.floor(seconds / (24 * 3600));
        const hours = Math.floor((seconds % (24 * 3600)) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);

        if (days > 0) return `${days}天 ${hours}小时`;
        if (hours > 0) return `${hours}小时 ${mins}分钟`;
        return `${mins}分钟`;
    },
    
    // ==================== 备份管理 ====================
    
    async createFullBackup() {
        if (!confirm("确定要创建完整数据库备份吗？")) return;
        
        try {
            this.showLoading();
            const result = await this.request("/backup", {
                method: "POST",
                body: JSON.stringify({ type: "full" })
            });
            
            if (result.success) {
                this.showToast("完整备份创建成功", "success");
                await this.refreshBackups();
            } else {
                this.showToast("备份创建失败: " + result.error, "error");
            }
        } catch (error) {
            this.showToast("备份创建失败: " + error.message, "error");
        } finally {
            this.hideLoading();
        }
    },
    
    async createIncrementalBackup() {
        if (!confirm("确定要创建增量数据库备份吗？")) return;
        
        try {
            this.showLoading();
            const result = await this.request("/backup", {
                method: "POST",
                body: JSON.stringify({ type: "incremental" })
            });
            
            if (result.success) {
                this.showToast("增量备份创建成功", "success");
                await this.refreshBackups();
            } else {
                this.showToast("备份创建失败: " + result.error, "error");
            }
        } catch (error) {
            this.showToast("备份创建失败: " + error.message, "error");
        } finally {
            this.hideLoading();
        }
    },
    
    async refreshBackups() {
        try {
            this.showLoading();
            const result = await this.request("/backups");
            
            if (result.success) {
                this.backupState.backups = result.data;
                this.renderBackupsTable();
                this.showToast("备份列表已刷新", "success");
            } else {
                this.showToast("获取备份列表失败: " + result.error, "error");
            }
        } catch (error) {
            this.showToast("获取备份列表失败: " + error.message, "error");
        } finally {
            this.hideLoading();
        }
    },
    
    renderBackupsTable() {
        const tbody = document.getElementById("backup-table-body");
        
        if (this.backupState.backups.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">暂无备份文件</td></tr>';
            return;
        }
        
        tbody.innerHTML = this.backupState.backups.map(backup => `
            <tr>
                <td><input type="radio" name="backup-select" value="${backup.fileName}" 
                    onchange="Admin.selectBackup('${backup.fileName}')"></td>
                <td>${backup.fileName}</td>
                <td>${this.formatBytes(backup.size)}</td>
                <td>${new Date(backup.createdAt).toLocaleString()}</td>
                <td>${backup.type === 'full' ? '完整备份' : '增量备份'}</td>
                <td>
                    <button class="btn-sm btn-view" onclick="Admin.downloadBackup('${backup.fileName}')">下载</button>
                    <button class="btn-sm btn-edit" onclick="Admin.restoreBackup('${backup.fileName}')">恢复</button>
                    <button class="btn-sm btn-delete" onclick="Admin.deleteBackup('${backup.fileName}')">删除</button>
                </td>
            </tr>
        `).join('');
    },
    
    selectBackup(fileName) {
        this.backupState.selectedBackup = fileName;
        document.getElementById("delete-selected-btn").disabled = false;
        document.getElementById("restore-selected-btn").disabled = false;
        document.getElementById("backup-name-input").value = fileName;
    },
    
    async downloadBackup(fileName) {
        try {
            const response = await fetch(`${this.baseUrl}/backup/download/${fileName}`);
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            } else {
                this.showToast("下载备份文件失败", "error");
            }
        } catch (error) {
            this.showToast("下载备份文件失败: " + error.message, "error");
        }
    },
    
    async restoreBackup(fileName) {
        if (!confirm(`确定要恢复备份文件 ${fileName} 吗？这将覆盖当前数据库！`)) return;
        
        try {
            this.showLoading();
            const result = await this.request("/backup/restore", {
                method: "POST",
                body: JSON.stringify({ fileName: fileName })
            });
            
            if (result.success) {
                this.showToast("数据库恢复成功", "success");
            } else {
                this.showToast("数据库恢复失败: " + result.error, "error");
            }
        } catch (error) {
            this.showToast("数据库恢复失败: " + error.message, "error");
        } finally {
            this.hideLoading();
        }
    },
    
    async deleteBackup(fileName) {
        if (!confirm(`确定要删除备份文件 ${fileName} 吗？`)) return;
        
        try {
            this.showLoading();
            const result = await this.request(`/backup/${fileName}`, {
                method: "DELETE"
            });
            
            if (result.success) {
                this.showToast("备份文件删除成功", "success");
                await this.refreshBackups();
            } else {
                this.showToast("删除备份文件失败: " + result.error, "error");
            }
        } catch (error) {
            this.showToast("删除备份文件失败: " + error.message, "error");
        } finally {
            this.hideLoading();
        }
    },
    
    async compressBackup() {
        const fileName = document.getElementById("backup-name-input").value;
        if (!fileName) {
            this.showToast("请输入备份文件名", "error");
            return;
        }
        
        try {
            this.showLoading();
            const result = await this.request("/backup/compress", {
                method: "POST",
                body: JSON.stringify({ fileName: fileName })
            });
            
            if (result.success) {
                this.showToast("备份文件压缩成功", "success");
                await this.refreshBackups();
            } else {
                this.showToast("备份文件压缩失败: " + result.error, "error");
            }
        } catch (error) {
            this.showToast("备份文件压缩失败: " + error.message, "error");
        } finally {
            this.hideLoading();
        }
    },
    
    async deleteSelectedBackups() {
        if (!this.backupState.selectedBackup) {
            this.showToast("请先选择要删除的备份文件", "error");
            return;
        }
        
        await this.deleteBackup(this.backupState.selectedBackup);
    },
    
    async restoreSelectedBackup() {
        if (!this.backupState.selectedBackup) {
            this.showToast("请先选择要恢复的备份文件", "error");
            return;
        }
        
        await this.restoreBackup(this.backupState.selectedBackup);
    },
    
    
    // 显示加载状态
    showLoading() {
        // 这里可以实现加载状态的显示
        console.log("Loading...");
    },

    // 隐藏加载状态
    hideLoading() {
        // 这里可以实现加载状态的隐藏
        console.log("Loading hidden");
    },

    // ==================== 纠错审核 ====================

    // 加载纠错列表
    async loadCorrections() {
        try {
            const status = document.getElementById('correction-status-filter')?.value || 'pending';
            const response = await fetch(`/api/admin/corrections?status=${status}`);
            
            if (!response.ok) {
                throw new Error('获取纠错列表失败');
            }
            
            const data = await response.json();
            
            // 更新统计数据
            document.getElementById('correction-pending-count').textContent = data.stats?.pending || 0;
            document.getElementById('correction-approved-count').textContent = data.stats?.approved || 0;
            document.getElementById('correction-rejected-count').textContent = data.stats?.rejected || 0;
            
            // 渲染表格
            this.renderCorrectionsTable(data.corrections || []);
        } catch (error) {
            console.error('加载纠错列表失败:', error);
            this.showToast('加载纠错列表失败: ' + error.message, 'error');
        }
    },

    // 渲染纠错表格
    renderCorrectionsTable(corrections) {
        const tbody = document.getElementById('corrections-table-body');
        
        if (!corrections || corrections.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#666;">暂无纠错记录</td></tr>';
            return;
        }
        
        tbody.innerHTML = corrections.map(item => {
            const statusText = {
                'pending': '<span style="color:#ff9800;">待审核</span>',
                'approved': '<span style="color:#4CAF50;">已通过</span>',
                'rejected': '<span style="color:#f44336;">已拒绝</span>'
            }[item.status] || item.status;
            
            const actions = item.status === 'pending' ? `
                <button class="btn-sm btn-edit" onclick="Admin.reviewCorrection(${item.id}, 'approve')">✅ 通过</button>
                <button class="btn-sm btn-delete" onclick="Admin.reviewCorrection(${item.id}, 'reject')">❌ 拒绝</button>
            ` : '-';
            
            return `
                <tr>
                    <td>${item.id}</td>
                    <td>${this.escapeHtml(item.username || '未知用户')}</td>
                    <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(item.book_title || '')}">
                        ${this.escapeHtml(item.book_title || item.book_id)}
                    </td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(item.original_text || '')}">
                        ${this.escapeHtml((item.original_text || '').substring(0, 50))}${(item.original_text || '').length > 50 ? '...' : ''}
                    </td>
                    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(item.corrected_text || '')}">
                        ${this.escapeHtml((item.corrected_text || '').substring(0, 50))}${(item.corrected_text || '').length > 50 ? '...' : ''}
                    </td>
                    <td>${this.formatDate(item.created_at)}</td>
                    <td>${statusText}</td>
                    <td class="actions">${actions}</td>
                </tr>
            `;
        }).join('');
    },

    // 审核纠错
    async reviewCorrection(id, action) {
        const actionText = action === 'approve' ? '通过' : '拒绝';
        if (!confirm(`确定要${actionText}这条纠错吗？`)) return;
        
        try {
            const response = await fetch(`/api/admin/corrections/${id}/review`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action })
            });
            
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || '审核失败');
            }
            
            const result = await response.json();
            this.showToast(result.message || `纠错已${actionText}`, 'success');
            
            // 重新加载列表
            this.loadCorrections();
        } catch (error) {
            console.error('审核纠错失败:', error);
            this.showToast('审核失败: ' + error.message, 'error');
        }
    },

    // 筛选纠错状态
    filterCorrections() {
        this.loadCorrections();
    }
};
// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", () => Admin.init());
