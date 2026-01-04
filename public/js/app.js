/*
 * File: app.js
 * Input: api.js, utils.js, 所有HTML页面元素
 * Output: App对象，管理应用状态、路由导航、用户认证、页面交互等核心功能
 * Pos: 前端应用入口和状态管理中心，协调所有功能模块
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和public/js/文件夹的README.md
 */

/**
 * PO18小说下载站 - 主应用模块
 */

const App = {
    currentUser: null,
    currentPage: localStorage.getItem("lastPage") || "rankings", // 未登录默认显示排行榜
    isAuthMode: "login", // 'login' or 'register'

    // 默认封面占位图 - 使用本地SVG数据代替外部服务
    defaultCover:
        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iMTEwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSI4MCIgaGVpZ2h0PSIxMTAiIGZpbGw9IiNGRkQwREMiLz48dGV4dCB4PSI0MCIgeT0iNTUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiBmaWxsPSIjRkY4QkE3IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Tm8gQ292ZXI8L3RleHQ+PC9zdmc+",

    // 初始化
    async init() {
        this.bindEvents();
        await this.checkAuth();
        this.initSettingsTabs();

        // 启用图片懒加载
        this.setupLazyLoading();

        // 初始化搜索历史
        this.initSearchHistory();

        // 初始化主题
        this.initTheme();
        
        // 初始化折叠卡片
        this.initCollapsibleCards();
        
        // 初始化设置项
        this.initSettingItems();
        
        // 加载精华过滤设置
        this.loadFilterSettings();
        
        // 启动定期检查订阅更新（即使未登录也启动，登录后会自动检查）
        if (this.subscriptionCheckInterval) {
            clearInterval(this.subscriptionCheckInterval);
        }
        // 优化：使用更智能的检查间隔，根据用户活跃度调整
        this.subscriptionCheckInterval = setInterval(() => {
            if (this.currentUser) {
                this.checkSubscriptionUpdates();
            }
        }, 3 * 60 * 1000); // 3分钟（更频繁的检查）

        // 启动提醒检查（检查未读提醒）
        if (this.notificationCheckInterval) {
            clearInterval(this.notificationCheckInterval);
        }
        this.notificationCheckInterval = setInterval(() => {
            if (this.currentUser) {
                this.checkNotifications();
            }
        }, 2 * 60 * 1000); // 2分钟检查一次提醒

        // 监听来自书籍详情页的订阅更新通知
        window.addEventListener('message', (event) => {
            // 验证消息来源
            if (event.origin !== window.location.origin) return;
            
            // 处理订阅更新消息
            if (event.data && event.data.type === 'subscription-updated') {
                console.log('[App] 收到订阅更新通知，刷新徽章');
                this.checkSubscriptionUpdates();
            }
        });

        // 检查URL参数或hash导航
        const urlParams = new URLSearchParams(window.location.search);
        const pageParam = urlParams.get("page");
        if (pageParam && ["download", "rankings", "purchased", "bookshelf", "downloads", "library", "global-library", "settings", "game", "subscriptions", "book-lists"].includes(pageParam)) {
            this.currentPage = pageParam;
        } else {
            const hash = window.location.hash.substring(1); // 去掉#
            if (
                hash &&
                [
                    "download",
                    "rankings",
                    "purchased",
                    "bookshelf",
                    "downloads",
                    "library",
                    "global-library",
                    "settings",
                    "game",
                    "subscriptions",
                    "book-lists"
                ].includes(hash)
            ) {
                this.currentPage = hash;
            }
        }

        // 初始化全站书库相关事件
        document.getElementById("global-filter-btn")?.addEventListener("click", () => {
            this.loadGlobalLibrary();
        });

        document.getElementById("global-reset-btn")?.addEventListener("click", () => {
            document.getElementById("global-tag-filter").value = "";
            document.getElementById("global-sort").value = "latest";
            document.getElementById("global-min-words").value = "";
            document.getElementById("global-max-words").value = "";
            this.loadGlobalLibrary();
        });

        // 加载全站书库标签
        this.loadGlobalLibraryTags();

        // 加载初始页面数据
        this.loadPageData(this.currentPage);

        // 更新导航状态
        document.querySelectorAll(".nav-link").forEach((link) => {
            link.classList.toggle("active", link.dataset.page === this.currentPage);
        });
        document.querySelectorAll(".page").forEach((p) => {
            p.classList.toggle("active", p.id === `page-${this.currentPage}`);
        });
    },

    // 绑定事件
    bindEvents() {
        // 导航点击
        document.querySelectorAll(".nav-link").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateTo(page);
            });
        });

        // 登录/注册按钮
        document.getElementById("btn-login")?.addEventListener("click", () => {
            this.showAuthModal("login");
        });

        document.getElementById("btn-register")?.addEventListener("click", () => {
            this.showAuthModal("register");
        });

        document.getElementById("purchased-login-btn")?.addEventListener("click", () => {
            this.showAuthModal("login");
        });

        // 登出按钮
        document.getElementById("btn-logout")?.addEventListener("click", async () => {
            await this.logout();
        });

        // 设置按钮 - 已移除
        // document.getElementById("btn-settings")?.addEventListener("click", () => {
        //     this.showSettingsModal();
        // });

        // 认证表单 - 添加表单验证
        const authForm = document.getElementById("auth-form");
        if (authForm) {
            // 初始化表单验证器
            this.authValidator = new Utils.FormValidator(authForm);
            this.authValidator
                .addRule("auth-username", [
                    { required: true, message: "用户名不能为空" },
                    { minLength: 3, message: "用户名至少 3 个字符" },
                    { maxLength: 20, message: "用户名最多 20 个字符" }
                ])
                .addRule("auth-password", [
                    { required: true, message: "密码不能为空" },
                    { minLength: 6, message: "密码至少 6 个字符" }
                ]);

            authForm.addEventListener("submit", async (e) => {
                e.preventDefault();

                // 验证表单
                const validation = this.authValidator.validate();
                if (!validation.isValid) {
                    return; // 验证失败，错误信息已显示
                }

                await this.handleAuth();
            });
        }

        // 认证切换
        document.getElementById("auth-switch-link")?.addEventListener("click", (e) => {
            e.preventDefault();
            this.toggleAuthMode();
        });

        // 关闭弹窗
        document.getElementById("auth-modal-close")?.addEventListener("click", () => {
            this.hideModal("auth-modal");
        });

        document.getElementById("settings-modal-close")?.addEventListener("click", () => {
            this.hideModal("settings-modal");
        });

        document.getElementById("book-modal-close")?.addEventListener("click", () => {
            this.hideModal("book-modal");
        });

        // 点击遮罩关闭
        document.querySelectorAll(".modal-overlay").forEach((overlay) => {
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove("active");
                }
            });
        });

        // 首页搜索事件已移除，因为首页已取消

        // 搜索页搜索

        // 刷新已购书籍
        document.getElementById("refresh-purchased")?.addEventListener("click", () => {
            this.loadPurchasedBooks(true);
        });

        // 清除已完成队列
        document.getElementById("clear-completed")?.addEventListener("click", async () => {
            await API.queue.clearCompleted();
            this.loadDownloads();
            this.showToast("已清除完成的任务", "success");
        });

        // Cookie设置
        document.getElementById("save-cookie")?.addEventListener("click", async () => {
            const cookie = document.getElementById("po18-cookie").value.trim();
            await this.saveCookie(cookie);
        });

        document.getElementById("validate-cookie")?.addEventListener("click", async () => {
            await this.validateCookie();
        });

        // WebDAV设置
        document.getElementById("save-webdav")?.addEventListener("click", async () => {
            await this.saveWebDAVConfig();
        });

        document.getElementById("test-webdav")?.addEventListener("click", async () => {
            await this.testWebDAVConnection();
        });

        // 共享设置
        document.getElementById("save-share-settings")?.addEventListener("click", async () => {
            await this.saveShareSettings();
        });

        // 共享功能（使用事件委托处理动态创建的按钮）
        document.body.addEventListener("click", (e) => {
            if (e.target && e.target.id === "enable-share-btn") {
                e.preventDefault();
                this.enableShare();
            }
        });

        // 共享书库搜索
        document.getElementById("share-search-btn")?.addEventListener("click", () => {
            const keyword = document.getElementById("share-search-input").value.trim();
            this.loadSharedLibrary(keyword);
        });

        // 统一输入框的三个按钮
        // 1. 解析按钮
        document.getElementById("parse-book-btn")?.addEventListener("click", () => {
            this.handleParseBook();
        });

        // 2. 下载按钮（添加到队列）
        document.getElementById("quick-download-btn")?.addEventListener("click", () => {
            this.handleQuickDownload();
        });

        // 3. 搜索按钮
        document.getElementById("search-btn")?.addEventListener("click", () => {
            this.handleSearch();
        });

        // 回车键触发搜索 + 输入防抖搜索
        const unifiedInput = document.getElementById("unified-input");
        if (unifiedInput) {
            unifiedInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    this.handleSearch();
                }
            });

            // 输入时自动搜索（防抖）- 保持this上下文
            const debouncedAutoSearch = Utils.debounce(() => {
                const value = unifiedInput.value.trim();
                if (value && value.length > 1 && !this.isBookIdOrUrl(value)) {
                    this.handleSearch();
                }
            }, 800);

            unifiedInput.addEventListener("input", debouncedAutoSearch);
        }

        // 书库筛选器事件
        document.getElementById("library-category-filter")?.addEventListener("change", () => {
            this.loadLibrary();
        });
        document.getElementById("library-author-filter")?.addEventListener("change", () => {
            this.loadLibrary();
        });
        document.getElementById("library-format-filter")?.addEventListener("change", () => {
            this.loadLibrary();
        });
        document.getElementById("library-clear-filter")?.addEventListener("click", () => {
            document.getElementById("library-category-filter").value = "";
            document.getElementById("library-author-filter").value = "";
            document.getElementById("library-format-filter").value = "";
            this.loadLibrary();
        });

        // 共享书库筛选器事件
        document.getElementById("shared-category-filter")?.addEventListener("change", () => {
            this.loadSharedLibrary();
        });
        document.getElementById("shared-format-filter")?.addEventListener("change", () => {
            this.loadSharedLibrary();
        });
        document.getElementById("shared-clear-filter")?.addEventListener("click", () => {
            document.getElementById("shared-category-filter").value = "";
            document.getElementById("shared-format-filter").value = "";
            this.loadSharedLibrary();
        });

        // 清空下载记录
        document.getElementById("clear-history-btn")?.addEventListener("click", async () => {
            if (confirm("确定要清空所有下载记录吗？")) {
                await API.history.clear();
                this.loadDownloads();
                this.showToast("已清空下载记录", "success");
            }
        });

        // 标签页切换
        document.querySelectorAll(".tab-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const tab = btn.dataset.tab;

                // 更新按钮状态
                btn.parentElement.querySelectorAll(".tab-btn").forEach((b) => {
                    b.classList.remove("active");
                });
                btn.classList.add("active");

                // 更新内容显示
                const parent = btn.closest(".page");
                parent.querySelectorAll(".tab-content").forEach((c) => {
                    c.classList.remove("active");
                });
                parent.querySelector(`#tab-${tab}`)?.classList.add("active");
            });
        });

        // 主题切换按钮
        document.getElementById("theme-toggle")?.addEventListener("click", () => {
            this.toggleTheme();
        });

        // 书单相关事件
        // 创建书单按钮
        document.getElementById("btn-create-list")?.addEventListener("click", () => {
            this.showCreateListModal();
        });

        // 书单表单提交
        document.getElementById("book-list-form")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            await this.saveBookList();
        });

        // 书单标签页切换
        document.querySelectorAll(".list-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                const tabName = tab.dataset.tab;
                this.switchBookListTab(tabName);
            });
        });

        // 书单广场排序
        document.querySelectorAll(".sort-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                const sortBy = tab.dataset.sort;
                this.loadSquareLists(sortBy);
                // 更新active状态
                document.querySelectorAll(".sort-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
            });
        });

        // 书单搜索
        document.getElementById("btn-search-lists")?.addEventListener("click", () => {
            this.searchBookLists();
        });

        // 回车搜索书单
        document.getElementById("list-search-input")?.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                this.searchBookLists();
            }
        });

        // 书评相关事件
        // 写书评按钮
        document.getElementById("btn-write-review")?.addEventListener("click", () => {
            this.showWriteReviewModal();
        });

        // 书评排序
        document.querySelectorAll(".reviews-sort-tabs .sort-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                const sortBy = tab.dataset.sort;
                this.loadReviews(sortBy);
            });
        });

        // 书评表单提交
        document.getElementById("review-form")?.addEventListener("submit", (e) => {
            this.submitReview(e);
        });

        // 书籍选择下拉框变化
        document.getElementById("review-book-select")?.addEventListener("change", () => {
            this.onBookSelectChange();
        });

        // 书评评分
        document.querySelectorAll("#review-rating .star").forEach(star => {
            star.addEventListener("click", () => {
                this.setReviewRating(parseInt(star.dataset.rating));
            });
            star.addEventListener("mouseenter", () => {
                const rating = parseInt(star.dataset.rating);
                document.querySelectorAll("#review-rating .star").forEach((s, i) => {
                    s.textContent = i < rating ? '★' : '☆';
                });
            });
        });
        document.getElementById("review-rating")?.addEventListener("mouseleave", () => {
            const currentRating = parseInt(document.getElementById("review-rating-value").value) || 0;
            document.querySelectorAll("#review-rating .star").forEach((s, i) => {
                s.textContent = i < currentRating ? '★' : '☆';
            });
        });
    },

    // 处理快速下载
    async handleQuickDownload() {
        const input = document.getElementById("unified-input")?.value.trim();
        const format = document.getElementById("quick-download-format")?.value || "txt";

        if (!input) {
            this.showToast("请输入书籍ID或链接", "error");
            return;
        }

        if (!this.currentUser) {
            this.showToast("请先登录后使用下载功能", "warning");
            return;
        }

        const btn = document.getElementById("quick-download-btn");
        btn.disabled = true;
        btn.textContent = "解析中...";

        try {
            const result = await API.quickDownload(input, format);
            this.showToast(`已添加到下载队列：${result.bookInfo.title}`, "success");
            document.getElementById("unified-input").value = "";

            // 显示书籍信息
            if (document.getElementById("parsed-book-info")) {
                document.getElementById("parsed-book-info").innerHTML = `
                    <div class="book-card">
                        <div class="book-card-body">
                            <img class="book-cover" src="${result.bookInfo.cover || App.defaultCover}" 
                                 alt="${result.bookInfo.title}" loading="lazy" onerror="this.src=App.defaultCover">
                            <div class="book-info">
                                <div class="book-title">${result.bookInfo.title}</div>
                                <div class="book-author">作者：${result.bookInfo.author || "未知"}</div>
                                <div style="color: var(--success-color); margin-top: 10px;">✅ 已添加到下载队列</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            this.showToast("添加失败：" + error.message, "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "添加到队列";
        }
    },

    // 检查输入是否是书籍ID或URL
    isBookIdOrUrl(value) {
        if (!value) return false;
        // 检查是否是纯数字（书籍ID）
        if (/^\d+$/.test(value)) {
            return true;
        }
        // 检查是否是URL
        if (/^https?:\/\//.test(value)) {
            return true;
        }
        return false;
    },

    // 处理解析书籍
    async handleParseBook() {
        const input = document.getElementById("unified-input")?.value.trim();

        if (!input) {
            this.showToast("请输入书籍ID或链接", "error");
            return;
        }

        const btn = document.getElementById("parse-book-btn");
        btn.disabled = true;
        btn.textContent = "解析中...";

        try {
            const book = await API.parseBookInput(input);

            if (document.getElementById("parsed-book-info")) {
                const warningMsg = book.hasError
                    ? `<div style="color: #ff9800; font-size: 12px; margin-top: 5px;">⚠️ ${book.error || "获取详情失败，显示基本信息"}</div>`
                    : "";

                // 构建状态显示
                const statusText =
                    {
                        completed: "完结",
                        ongoing: "连载中",
                        unknown: "未知"
                    }[book.status] || "未知";

                // 构建详细信息
                const statsHtml = `
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 10px; font-size: 13px;">
                        <div><strong>状态:</strong> ${statusText}</div>
                        <div><strong>总字数:</strong> ${book.wordCount ? book.wordCount.toLocaleString() : "未知"}</div>
                        <div><strong>总章节:</strong> ${book.chapterCount || 0}</div>
                        <div><strong>免费章节:</strong> ${book.freeChapters || 0}</div>
                        <div><strong>付费章节:</strong> ${book.paidChapters || 0}</div>
                    </div>
                `;

                // 简介
                const descriptionHtml = book.description
                    ? `
                    <div style="margin-top: 10px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-size: 13px;">
                        <strong>简介:</strong>
                        <div style="margin-top: 5px; color: #666; max-height: 100px; overflow-y: auto;">${book.description}</div>
                    </div>
                `
                    : "";

                document.getElementById("parsed-book-info").innerHTML = `
                    <div class="book-card" style="cursor: pointer;" onclick="window.location.href='/book-detail.html?id=${book.bookId}'">
                        <div class="book-card-body">
                            <img class="book-cover" src="${book.cover || App.defaultCover}" 
                                 alt="${book.title}" loading="lazy" onerror="this.src=App.defaultCover">
                            <div class="book-info" style="flex: 1;">
                                <div class="book-title" style="cursor: pointer;">${book.title}</div>
                                <div class="book-author">作者：${book.author || "未知"}</div>
                                <div class="book-tags">${book.tags || ""}</div>
                                <div style="font-size: 12px; color: #888; margin-top: 5px;">ID: ${book.bookId}</div>
                                ${statsHtml}
                                ${descriptionHtml}
                                ${warningMsg}
                            </div>
                        </div>
                    </div>
                `;
            }

            this.showToast(
                book.hasError ? "解析完成（部分信息可能不完整）" : "解析成功",
                book.hasError ? "warning" : "success"
            );
        } catch (error) {
            this.showToast("解析失败：" + error.message, "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "解析";
        }
    },

    // 处理搜索
    async handleSearch() {
        const input = document.getElementById("unified-input")?.value.trim();

        if (!input) {
            this.showToast("请输入搜索关键词", "error");
            return;
        }

        // 保存搜索历史
        this.addSearchHistory(input);
        // 隐藏历史记录下拉框
        this.hideSearchHistory();

        await this.doSearch(input);
    },

    // ==================== 搜索历史记录 ====================

    searchHistoryKey: "po18_search_history",
    maxSearchHistory: 10,

    // 获取搜索历史
    getSearchHistory() {
        try {
            const history = localStorage.getItem(this.searchHistoryKey);
            return history ? JSON.parse(history) : [];
        } catch {
            return [];
        }
    },

    // 添加搜索历史
    addSearchHistory(keyword) {
        if (!keyword || keyword.length < 2) return;

        let history = this.getSearchHistory();
        // 移除已存在的相同记录
        history = history.filter((h) => h !== keyword);
        // 添加到开头
        history.unshift(keyword);
        // 限制数量
        if (history.length > this.maxSearchHistory) {
            history = history.slice(0, this.maxSearchHistory);
        }

        localStorage.setItem(this.searchHistoryKey, JSON.stringify(history));
    },

    // 删除单条搜索历史
    removeSearchHistory(keyword) {
        let history = this.getSearchHistory();
        history = history.filter((h) => h !== keyword);
        localStorage.setItem(this.searchHistoryKey, JSON.stringify(history));
    },

    // 清空搜索历史
    clearSearchHistory() {
        localStorage.removeItem(this.searchHistoryKey);
        this.hideSearchHistory();
        this.showToast("已清空搜索历史", "success");
    },

    // 获取热门搜索词（预设 + 从历史中统计）
    getPopularSearchKeywords() {
        // 预设热门搜索词
        const presetKeywords = [
            "言情", "古言", "现代", "甜文", "虐文", 
            "1V1", "高H", "BG", "BL", "甜宠"
        ];
        
        // 从搜索历史中统计热门词（出现次数最多的）
        const history = this.getSearchHistory();
        const keywordCount = {};
        history.forEach(keyword => {
            keywordCount[keyword] = (keywordCount[keyword] || 0) + 1;
        });
        
        // 合并预设和热门历史词，去重
        const popularKeywords = [...new Set([
            ...presetKeywords,
            ...Object.keys(keywordCount).sort((a, b) => keywordCount[b] - keywordCount[a]).slice(0, 5)
        ])].slice(0, 8); // 最多显示8个
        
        return popularKeywords;
    },

    // 显示搜索历史下拉框（包含历史记录和热门搜索词）
    showSearchHistory() {
        const history = this.getSearchHistory();
        const popularKeywords = this.getPopularSearchKeywords();
        
        // 热门搜索词应该总是有值（预设关键词），如果没有则使用默认值
        const finalPopularKeywords = popularKeywords.length > 0 ? popularKeywords : [
            "言情", "古言", "现代", "甜文", "虐文", "1V1", "高H", "BG"
        ];
        
        // 如果既没有历史也没有热门词，不显示（理论上不应该发生）
        if (history.length === 0 && finalPopularKeywords.length === 0) {
            console.warn("没有搜索历史和热门词可显示");
            return;
        }

        let dropdown = document.getElementById("search-history-dropdown");
        const inputWrapper = document.querySelector(".search-input-wrapper");
        
        if (!inputWrapper) {
            console.warn("搜索输入框容器未找到");
            return;
        }
        
        if (!dropdown) {
            dropdown = document.createElement("div");
            dropdown.id = "search-history-dropdown";
            dropdown.className = "search-history-dropdown";
            inputWrapper.style.position = "relative";
            inputWrapper.appendChild(dropdown);
        }

        // 构建下拉框内容
        let content = '';
        
        // 热门搜索词部分（总是显示）
        if (finalPopularKeywords.length > 0) {
            content += `
                <div class="search-suggestions-section">
                    <div class="search-suggestions-header">
                        <span>🔥 热门搜索</span>
                    </div>
                    <div class="search-suggestions-list">
                        ${finalPopularKeywords
                            .map(
                                (keyword) => `
                            <div class="search-suggestion-item" data-keyword="${this.escapeHtml(keyword)}">
                                <span class="suggestion-keyword">${this.escapeHtml(keyword)}</span>
                            </div>
                        `
                            )
                            .join("")}
                    </div>
                </div>
            `;
        }
        
        // 搜索历史部分
        if (history.length > 0) {
            content += `
                <div class="search-history-section">
                    <div class="search-history-header">
                        <span>🕒 搜索历史</span>
                        <button class="clear-history-btn" onclick="App.clearSearchHistory()">清空</button>
                    </div>
                    <div class="search-history-list">
                        ${history
                            .map(
                                (h) => `
                            <div class="search-history-item" data-keyword="${this.escapeHtml(h)}">
                                <span class="history-keyword">${this.escapeHtml(h)}</span>
                                <button class="remove-history-btn" onclick="event.stopPropagation(); App.removeSearchHistory('${this.escapeHtml(h)}'); this.parentElement.remove();">×</button>
                            </div>
                        `
                            )
                            .join("")}
                    </div>
                </div>
            `;
        }

        dropdown.innerHTML = content;
        dropdown.style.display = "block";
        
        // 确保下拉框可见（强制显示）
        dropdown.style.visibility = "visible";
        dropdown.style.opacity = "1";

        // 绑定点击事件（历史记录和热门词）
        dropdown.querySelectorAll(".search-history-item, .search-suggestion-item").forEach((item) => {
            item.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const keyword = item.dataset.keyword;
                const input = document.getElementById("unified-input");
                if (input) {
                    input.value = keyword;
                    this.hideSearchHistory();
                    this.handleSearch();
                }
            });
        });
    },

    // 隐藏搜索历史下拉框
    hideSearchHistory() {
        const dropdown = document.getElementById("search-history-dropdown");
        if (dropdown) {
            dropdown.style.display = "none";
        }
    },

    // 初始化搜索历史事件
    initSearchHistory() {
        const input = document.getElementById("unified-input");
        if (!input) return;

        // 获取焦点时显示历史
        input.addEventListener("focus", () => {
            if (!input.value.trim()) {
                this.showSearchHistory();
            }
        });

        // 失去焦点时隐藏
        input.addEventListener("blur", (e) => {
            // 延迟隐藏，以便点击事件能触发
            setTimeout(() => this.hideSearchHistory(), 200);
        });

        // 输入时隐藏历史
        input.addEventListener("input", () => {
            if (input.value.trim()) {
                this.hideSearchHistory();
            } else {
                this.showSearchHistory();
            }
        });
    },

    // 页面导航
    navigateTo(page) {
        // 如果离开排行榜页面，重置标签绑定标记
        if (this.currentPage === 'rankings' && page !== 'rankings') {
            this.rankingTabsInitialized = false;
            console.log('[排行榜] 离开页面，重置事件绑定标记');
        }

        this.currentPage = page;

        // 保存当前页面到本地存储
        localStorage.setItem("lastPage", page);

        // 更新导航状态
        document.querySelectorAll(".nav-link").forEach((link) => {
            link.classList.toggle("active", link.dataset.page === page);
        });

        // 更新页面显示
        document.querySelectorAll(".page").forEach((p) => {
            p.classList.toggle("active", p.id === `page-${page}`);
        });

        // 加载页面数据
        this.loadPageData(page);
        
        // 触发自定义事件，通知其他组件页面已切换
        document.dispatchEvent(new CustomEvent('tabChanged', { detail: { page } }));
    },

    // 导航到指定书籍详情页
    navigateToBook(bookId) {
        // 使用已有的查看详情功能
        window.location.href = `/book-detail.html?id=${bookId}`;
    },

    // 加载页面数据
    async loadPageData(page) {
        switch (page) {
            case "download":
                // 快速下载页，加载共享书库部分
                this.loadSharedPage();
                // 加载热门书籍推荐
                this.loadPopularBooks();
                // 加载最近更新书籍
                this.loadRecentBooks();
                break;
            case "rankings":
                // 排行榜页
                this.loadRankings();
                // 初始化标签事件（只在页面切换时执行一次）
                setTimeout(() => this.initRankingTabs(), 100);
                break;
            case "purchased":
                if (this.currentUser) {
                    this.loadPurchasedBooks();
                } else {
                    document.getElementById("purchased-login-required").style.display = "block";
                    document.getElementById("purchased-list").innerHTML = "";
                }
                break;
            case "bookshelf":
                // 书架页
                this.loadBookshelf();
                break;
            case "downloads":
                // 下载管理页，加载统一列表
                this.loadDownloads();
                break;
            case "library":
                this.loadLibrary();
                break;
            case "global-library":
                this.loadGlobalLibrary();
                break;
            case "settings":
                this.loadSettings();
                break;
            case "subscriptions":
                this.loadSubscriptions();
                break;
            case "book-lists":
                this.loadBookLists();
                break;
            default:
                console.warn(`[App] 未知页面: ${page}`);
        }
    },

    // 检查认证状态
    async checkAuth() {
        try {
            const user = await API.auth.getMe();
            this.currentUser = user;
            this.updateUserUI();

            // 检查订阅更新
            this.checkSubscriptionUpdates();
            
            // 启动定期检查订阅更新（每5分钟）
            if (this.subscriptionCheckInterval) {
                clearInterval(this.subscriptionCheckInterval);
            }
            this.subscriptionCheckInterval = setInterval(() => {
                this.checkSubscriptionUpdates();
            }, 5 * 60 * 1000); // 5分钟

            // 如果当前在下载页面且未登录，跳转到排行榜
            // 注释掉自动跳转，允许未登录用户访问首页
            // if (!this.currentUser && this.currentPage === "download") {
            //     this.navigateTo("rankings");
            // }
        } catch (error) {
            this.currentUser = null;
            this.updateUserUI();

            // 未登录时，如果当前在下载页面，跳转到排行榜
            // 注释掉自动跳转，允许未登录用户访问首页
            // if (this.currentPage === "download") {
            //     this.navigateTo("rankings");
            // }
        }
    },

    // 更新用户UI
    updateUserUI() {
        const userArea = document.getElementById("user-area");
        const userInfo = document.getElementById("user-info");
        // const usernameDisplay = document.getElementById("username-display"); // 已移除
        const adminLink = document.getElementById("admin-link");
        const globalLibraryNav = document.getElementById("nav-global-library");

        if (this.currentUser) {
            userArea.style.display = "none";
            userInfo.style.display = "flex";
            // usernameDisplay.textContent = this.currentUser.username; // 已移除用户名显示

            // 显示管理员入口
            if (adminLink) {
                // admin用户显示管理入口
                adminLink.style.display = this.currentUser.username === "admin" ? "inline-block" : "none";
            }

            // 显示全站书库（仅授权用户）
            if (globalLibraryNav) {
                // 检查是否有云端缓存权限
                this.checkCacheAuth().then((hasAuth) => {
                    globalLibraryNav.style.display = hasAuth ? "block" : "none";
                });
            }

            // 显示游戏入口（登录后可见）
            const gameAccessCard = document.getElementById("game-access-card");
            if (gameAccessCard) {
                gameAccessCard.style.display = "flex";
            }
            
            // 显示导航栏游戏入口
            const navGame = document.getElementById("nav-game");
            if (navGame) {
                navGame.style.display = "block";
            }
            
            // 显示移动端底部导航游戏入口
            const tabGame = document.getElementById("tab-game");
            if (tabGame) {
                tabGame.style.display = "flex";
            }

            // 更新已购书籍页面
            document.getElementById("purchased-login-required").style.display = this.currentUser.hasPo18Cookie
                ? "none"
                : "block";
        } else {
            userArea.style.display = "flex";
            userInfo.style.display = "none";
            
            // 隐藏游戏入口（未登录）
            const gameAccessCard = document.getElementById("game-access-card");
            if (gameAccessCard) {
                gameAccessCard.style.display = "none";
            }
            
            // 隐藏导航栏游戏入口
            const navGame = document.getElementById("nav-game");
            if (navGame) {
                navGame.style.display = "none";
            }
            
            // 隐藏移动端底部导航游戏入口
            const tabGame = document.getElementById("tab-game");
            if (tabGame) {
                tabGame.style.display = "none";
            }
            
            if (adminLink) adminLink.style.display = "none";
            if (globalLibraryNav) globalLibraryNav.style.display = "none";
        }
    },

    // 显示认证弹窗
    showAuthModal(mode) {
        this.isAuthMode = mode;
        this.updateAuthModalUI();
        this.showModal("auth-modal");
    },

    // 切换认证模式
    toggleAuthMode() {
        this.isAuthMode = this.isAuthMode === "login" ? "register" : "login";
        this.updateAuthModalUI();
    },

    // 更新认证弹窗UI
    updateAuthModalUI() {
        const title = document.getElementById("auth-modal-title");
        const submitBtn = document.getElementById("auth-submit");
        const switchText = document.getElementById("auth-switch-text");
        const switchLink = document.getElementById("auth-switch-link");

        if (this.isAuthMode === "login") {
            title.textContent = "登录";
            submitBtn.textContent = "登录";
            switchText.textContent = "还没有账号？";
            switchLink.textContent = "去注册";
        } else {
            title.textContent = "注册";
            submitBtn.textContent = "注册";
            switchText.textContent = "已有账号？";
            switchLink.textContent = "去登录";
        }

        document.getElementById("auth-error").textContent = "";
    },

    // 处理认证
    async handleAuth() {
        const username = document.getElementById("auth-username").value.trim();
        const password = document.getElementById("auth-password").value;
        const errorEl = document.getElementById("auth-error");

        try {
            if (this.isAuthMode === "login") {
                await API.auth.login(username, password);
            } else {
                await API.auth.register(username, password);
            }

            this.hideModal("auth-modal");
            await this.checkAuth();
            this.showToast(this.isAuthMode === "login" ? "登录成功" : "注册成功", "success");

            // 清空表单
            document.getElementById("auth-username").value = "";
            document.getElementById("auth-password").value = "";
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
            this.navigateTo("shared");
            this.showToast("已登出", "info");
        } catch (error) {
            this.showToast("登出失败", "error");
        }
    },

    // 处理被踢出登录的情况（单点登录）
    handleSessionKicked() {
        this.currentUser = null;
        this.updateUserUI();
        this.navigateTo("rankings");

        // 显示提示
        const message = "您的账号已在其他设备登录，当前会话已失效，请重新登录。";
        alert(message);
    },

    // 搜索
    async doSearch(keyword, page = 1) {
        const resultsContainer = document.getElementById("search-results");
        resultsContainer.innerHTML = '<p class="empty-message">搜索中...</p>';

        try {
            const result = await API.search(keyword, page);
            
            // 应用精华过滤
            if (result.books && result.books.length > 0) {
                result.books = this.applyContentFilter(result.books);
            }
            
            this.renderSearchResults(result);
        } catch (error) {
            resultsContainer.innerHTML = `<p class="empty-message">搜索失败：${error.message}</p>`;
        }
    },

    // 渲染搜索结果
    renderSearchResults(result) {
        const container = document.getElementById("search-results");

        if (!result.books || result.books.length === 0) {
            container.innerHTML = '<p class="empty-message">未找到相关小说</p>';
            return;
        }

        // 使用新的搜索结果卡片渲染（支持版本和共享库）
        container.innerHTML = result.books.map((book) => this.renderSearchResultCard(book)).join("");
        this.bindSearchResultEvents();
    },

    // 渲染搜索结果卡片（支持版本和共享库下载）
    renderSearchResultCard(book) {
        const cover = book.cover || App.defaultCover;
        const platformIcon = book.platform === 'popo' ? '📚' : '💖';  // POPO用📚, PO18用💖
        const detailUrl = book.detail_url || (book.platform === 'popo' ? `https://www.popo.tw/books/${book.bookId}` : `https://www.po18.tw/books/${book.bookId}`);
        const tags = book.tags
            ? book.tags
                  .split("·")
                  .filter((t) => t)
                  .slice(0, 3)
                  .map((t) => `<span class="book-tag">${t.trim()}</span>`)
                  .join("")
            : "";

        // 渲染版本列表
        let versionsHtml = "";
        if (book.versions && book.versions.length > 0) {
            versionsHtml = `
                <div class="book-versions">
                    <div class="versions-title">可用版本：</div>
                    ${book.versions
                        .map((v) => {
                            const hasShared = v.sharedFiles && v.sharedFiles.length > 0;
                            const sharedBtns = hasShared
                                ? v.sharedFiles
                                      .map(
                                          (sf) =>
                                              `<button class="btn btn-xs btn-primary download-shared-btn" data-id="${sf.id}" title="下载次数: ${sf.downloadCount || 0}">
                                下载${sf.format.toUpperCase()}
                            </button>`
                                      )
                                      .join("")
                                : "";

                            return `
                            <div class="version-item">
                                <span class="version-info">
                                    <span class="chapter-count">${v.subscribedChapters || 0}章</span>
                                    ${v.totalChapters ? `<span class="total-chapters">(共${v.totalChapters}章)</span>` : ""}
                                </span>
                                <span class="version-actions">
                                    ${sharedBtns}
                                    ${hasShared ? "" : '<span class="no-shared">无共享</span>'}
                                </span>
                            </div>
                        `;
                        })
                        .join("")}
                </div>
            `;
        }

        return `
            <div class="book-card search-result-card" style="cursor: pointer;" onclick="window.location.href='/book-detail.html?id=${book.bookId}'">
                <div class="book-card-body">
                    <img class="book-cover" src="${cover}" alt="${book.title}" loading="lazy" onerror="this.src=App.defaultCover">
                    <div class="book-info">
                        <div class="book-title">
                            <span style="margin-right: 4px;">${platformIcon}</span>
                            ${book.title}
                        </div>
                        <div class="book-author">作者：${book.author || "未知"}</div>
                        <div class="book-tags">${tags}</div>
                        ${versionsHtml}
                    </div>
                </div>
                <div class="book-card-footer" onclick="event.stopPropagation();">
                    <button class="btn btn-sm btn-outline view-detail-btn" data-book-id="${book.bookId}">
                        <span class="btn-icon-mobile">📖</span>
                        <span class="btn-text-mobile">详情</span>
                    </button>
                    <button class="btn btn-sm btn-primary add-queue-btn" data-book-id="${book.bookId}" title="下载自己订阅的章节">
                        <span class="btn-icon-mobile">⬇️</span>
                        <span class="btn-text-mobile">下载</span>
                    </button>
                    <a href="${detailUrl}" target="_blank" class="btn btn-sm btn-outline" title="跳转到${book.platform === 'popo' ? 'POPO' : 'PO18'}原站">
                        <span class="btn-icon-mobile">💋</span>
                        <span class="btn-text-mobile">原站</span>
                    </a>
                </div>
            </div>
        `;
    },

    // 绑定搜索结果事件
    bindSearchResultEvents() {
        // 查看详情 - 跳转到详情页
        document.querySelectorAll(".search-result-card .view-detail-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const bookId = btn.dataset.bookId;
                window.location.href = `/book-detail.html?id=${bookId}`;
            });
        });

        // 加入队列（下载自己订阅的章节）
        document.querySelectorAll(".search-result-card .add-queue-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!this.currentUser) {
                    this.showToast("请先登录后使用队列功能", "warning");
                    return;
                }
                const bookId = btn.dataset.bookId;
                await this.addToQueue(bookId);
            });
        });

        // 下载共享文件
        document.querySelectorAll(".search-result-card .download-shared-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!this.currentUser) {
                    this.showToast("请先登录后下载共享书籍", "warning");
                    return;
                }
                const id = btn.dataset.id;
                await this.downloadSharedBook(id);
            });
        });
    },

    // 渲染书籍卡片
    renderBookCard(book, type = "search") {
        const cover = book.cover || App.defaultCover;
        const tags = book.tags
            ? book.tags
                  .split("·")
                  .filter((t) => t)
                  .slice(0, 3)
                  .map((t) => `<span class="book-tag">${t.trim()}</span>`)
                  .join("")
            : "";

        // 构建详细统计信息
        let statsInfo = "";
        if (type === "search" || type === "purchased") {
            const status = book.status || "unknown";
            const statusText =
                {
                    completed: "完结",
                    ongoing: "连载中",
                    已完結: "完结",
                    連載中: "连载中",
                    unknown: ""
                }[status] || status;

            const wordCount = book.wordCount || book.word_count;
            const chapterCount = book.chapterCount || book.total_chapters || book.subscribed_chapters;

            // 已购书籍显示已购/可购章节
            const purchasedInfo =
                type === "purchased" && (book.available_chapters || book.purchased_chapters)
                    ? `<span style="margin-left: 10px;">📚 已购 ${book.purchased_chapters || 0}/${book.available_chapters || 0}章</span>`
                    : "";

            statsInfo = `
                <div class="book-stats" style="font-size: 12px; color: #666; margin-top: 5px;">
                    ${statusText ? `<span>📖 ${statusText}</span>` : ""}
                    ${wordCount ? `<span style="margin-left: 10px;">📝 ${wordCount.toLocaleString()}字</span>` : ""}
                    ${chapterCount ? `<span style="margin-left: 10px;">📚 ${chapterCount}章</span>` : ""}
                    ${purchasedInfo}
                </div>
            `;
        }

        let actions = "";
        let extraInfo = "";

        if (type === "search" || type === "purchased") {
            actions = `
                <button class="btn btn-sm btn-outline view-detail-btn" data-book-id="${book.bookId || book.book_id}">详情</button>
                <button class="btn btn-sm btn-primary add-queue-btn" data-book-id="${book.bookId || book.book_id}">加入队列</button>
            `;
        } else if (type === "library") {
            // 书库中的书籍，如果书名为空或未知，显示文件名
            const displayTitle =
                book.title && book.title !== "未知" ? book.title : book.filename || book.title || "未知书籍";
            const needsMatch = !book.title || book.title === "未知" || !book.author;

            actions = `
                <a href="${API.library.getDownloadUrl(book.id)}" class="btn btn-sm btn-primary" download>下载</a>
                ${needsMatch ? '<button class="btn btn-sm btn-outline match-book-btn" data-id="' + book.id + '" data-filename="' + (book.filename || "") + '">匹配</button>' : ""}
                <button class="btn btn-sm btn-outline share-book-btn" data-id="${book.id}">共享</button>
                <button class="btn btn-sm btn-outline delete-library-btn" data-id="${book.id}">删除</button>
            `;

            // 替换book.title用于显示
            book = { ...book, title: displayTitle };
        } else if (type === "shared") {
            // 共享书籍显示上传者和下载次数
            extraInfo = `
                <div class="book-share-info">
                    <span class="uploader">上传者: ${book.uploaderName || book.uploader_name || "未知"}</span>
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
                    <img class="book-cover" src="${cover}" alt="${book.title}" loading="lazy" onerror="this.src=App.defaultCover">
                    <div class="book-info">
                        ${titleElement}
                        <div class="book-author">作者：${book.author || "未知"}</div>
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
        document.querySelectorAll(".view-detail-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const bookId = btn.dataset.bookId;
                window.location.href = `/book-detail.html?id=${bookId}`;
            });
        });

        // 加入队列
        document.querySelectorAll(".add-queue-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                if (!this.currentUser) {
                    this.showToast("请先登录后使用队列功能", "warning");
                    return;
                }

                const bookId = btn.dataset.bookId;
                await this.addToQueue(bookId);
            });
        });

        // 删除书库
        document.querySelectorAll(".delete-library-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                if (confirm("确定要删除这本书吗？")) {
                    await API.library.remove(id);
                    this.loadLibrary();
                    this.showToast("已删除", "success");
                }
            });
        });

        // 共享书籍
        document.querySelectorAll(".share-book-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                await this.shareBook(id);
            });
        });

        // 匹配书籍
        document.querySelectorAll(".match-book-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const filename = btn.dataset.filename;
                await this.matchBook(id, filename);
            });
        });

        // 下载共享书籍
        document.querySelectorAll(".download-shared-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                await this.downloadSharedBook(id);
            });
        });
    },

    // 显示书籍详情
    async showBookDetail(bookId) {
        try {
            const book = await API.getBookDetail(bookId);

            const modalBody = document.getElementById("book-modal-body");
            modalBody.innerHTML = `
                <div class="book-detail">
                    <div class="book-card-body" style="margin-bottom: 20px;">
                        <img class="book-cover" src="${book.cover || ""}" alt="${book.title}" loading="lazy" style="width: 120px; height: 165px;">
                        <div class="book-info">
                            <div class="book-title" style="font-size: 20px;">${book.title}</div>
                            <div class="book-author" style="font-size: 15px;">作者：${book.author}</div>
                            <div class="book-tags" style="margin-top: 10px;">
                                ${
                                    book.tags
                                        ? book.tags
                                              .split("·")
                                              .map((t) => `<span class="book-tag">${t.trim()}</span>`)
                                              .join("")
                                        : ""
                                }
                            </div>
                            <div style="margin-top: 10px; color: var(--text-secondary);">
                                章节数：${book.chapterCount || "未知"}
                            </div>
                        </div>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin-bottom: 10px; color: var(--primary-dark);">简介</h4>
                        <p style="color: var(--text-secondary); line-height: 1.8;">${book.description || "暂无简介"}</p>
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

            document.getElementById("book-modal-title").textContent = book.title;
            this.showModal("book-modal");

            // 绑定加入队列事件
            document.getElementById("add-to-queue-modal")?.addEventListener("click", async () => {
                const format = document.getElementById("download-format").value;
                const autoShare = document.getElementById("share-after-download")?.checked || false;
                await this.addToQueue(bookId, format, autoShare);
                this.hideModal("book-modal");
            });
        } catch (error) {
            this.showToast("获取详情失败：" + error.message, "error");
        }
    },

    // 加入下载队列
    async addToQueue(bookId, format = "txt", autoShare = false) {
        try {
            await API.queue.add(bookId, format, autoShare);
            const message = autoShare ? "已加入下载队列，完成后将自动共享" : "已加入下载队列";
            this.showToast(message, "success");

            // 如果当前在下载管理页面，刷新
            if (this.currentPage === "downloads") {
                this.loadDownloads();
            }
        } catch (error) {
            this.showToast("加入队列失败：" + error.message, "error");
        }
    },

    // 加载已购书籍
    async loadPurchasedBooks(refresh = false) {
        if (!this.currentUser) return;

        const container = document.getElementById("purchased-list");
        const loginRequired = document.getElementById("purchased-login-required");

        if (!this.currentUser.hasPo18Cookie) {
            loginRequired.innerHTML = `
                <p>请先在设置中配置PO18 Cookie</p>
                <button class="btn btn-primary" onclick="App.showSettingsModal()">去设置</button>
            `;
            loginRequired.style.display = "block";
            return;
        }

        loginRequired.style.display = "none";
        container.innerHTML = '<p class="empty-message">加载中...</p>';

        try {
            const result = await API.purchased.getList(refresh);

            if (result.books.length === 0) {
                container.innerHTML = '<p class="empty-message">没有找到已购书籍</p>';
                return;
            }

            container.innerHTML = result.books.map((book) => this.renderBookCard(book, "purchased")).join("");
            this.bindBookCardEvents();

            if (result.fromCache) {
                this.showToast("从缓存加载，点击刷新获取最新数据", "info");
            }
        } catch (error) {
            container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
        }
    },

    // 加载下载队列
    async loadQueue() {
        if (!this.currentUser) return;

        const container = document.getElementById("queue-list");

        try {
            const queue = await API.queue.getList();

            if (queue.length === 0) {
                container.innerHTML = '<p class="empty-message">下载队列为空</p>';
                return;
            }

            container.innerHTML = queue.map((item) => this.renderQueueItem(item)).join("");
            this.bindQueueEvents();
        } catch (error) {
            container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
        }
    },

    // 渲染队列项
    renderQueueItem(item) {
        const statusText = {
            pending: "等待中",
            downloading: "下载中",
            completed: "已完成",
            failed: "失败"
        };

        const progress = item.total_chapters > 0 ? Math.round((item.progress / item.total_chapters) * 100) : 0;

        return `
            <div class="queue-item">
                <div class="queue-item-header">
                    <span class="queue-item-title">${item.title}</span>
                    <span class="queue-status ${item.status}">${statusText[item.status] || item.status}</span>
                </div>
                ${
                    item.status === "downloading"
                        ? `
                    <div class="queue-progress">
                        <div class="queue-progress-bar" style="width: ${progress}%"></div>
                    </div>
                    <div class="queue-progress-text">${item.progress}/${item.total_chapters} 章节 (${progress}%)</div>
                `
                        : ""
                }
                ${
                    item.status === "failed"
                        ? `
                    <div style="color: var(--error-color); font-size: 13px; margin-top: 10px;">
                        错误：${item.error_message || "未知错误"}
                    </div>
                `
                        : ""
                }
                <div style="display: flex; gap: 10px; margin-top: 15px; justify-content: flex-end;">
                    ${
                        item.status === "pending"
                            ? `
                        <button class="btn btn-sm btn-primary start-download-btn" data-id="${item.id}">开始下载</button>
                    `
                            : ""
                    }
                    <button class="btn btn-sm btn-outline remove-queue-btn" data-id="${item.id}">移除</button>
                </div>
            </div>
        `;
    },

    // 绑定队列事件
    bindQueueEvents() {
        // 开始下载
        document.querySelectorAll(".start-download-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = parseInt(btn.dataset.id);
                const downloadItem = btn.closest(".download-item");
                if (!downloadItem) {
                    console.error("找不到下载项元素");
                    return;
                }

                btn.disabled = true;
                btn.textContent = "连接中...";

                // 创建或更新进度显示
                let progressContainer = downloadItem.querySelector(".queue-progress-container");
                if (!progressContainer) {
                    progressContainer = document.createElement("div");
                    progressContainer.className = "queue-progress-container";
                    progressContainer.innerHTML = `
                        <div class="queue-progress">
                            <div class="queue-progress-bar" style="width: 0%"></div>
                        </div>
                        <div class="queue-progress-text">0%</div>
                    `;
                    // 将进度容器插入到下载项中
                    const titleDiv = downloadItem.querySelector("h4")?.parentElement;
                    if (titleDiv) {
                        titleDiv.after(progressContainer);
                    }
                }

                const progressBar = progressContainer.querySelector(".queue-progress-bar");
                const progressText = progressContainer.querySelector(".queue-progress-text");

                // 订阅进度更新 (轮询方式)
                const progressWatcher = API.queue.subscribeProgress(id, async (data) => {
                    switch (data.type) {
                        case "progress":
                            btn.textContent = "下载中...";
                            progressBar.style.width = `${data.percent}%`;
                            progressText.textContent = `${data.completed}/${data.total} 章节 (${data.percent}%)`;
                            break;
                        case "completed":
                            progressBar.style.width = "100%";
                            progressText.textContent = "生成文件中...";

                            // **新版：在浏览器端生成文件**
                            if (data.chapters && data.detail) {
                                try {
                                    console.log("在浏览器端生成文件...", data);

                                    // 获取格式（从文件名提取）
                                    const format = data.fileName.split(".").pop().toLowerCase();
                                    let blob;

                                    if (format === "epub") {
                                        // 生成 EPUB
                                        progressText.textContent = "生成EPUB中...";
                                        blob = await FileGenerator.generateEpub(data.detail, data.chapters);
                                    } else {
                                        // 生成 TXT
                                        progressText.textContent = "生成TXT中...";
                                        blob = FileGenerator.generateTxt(data.detail, data.chapters);
                                    }

                                    // 下载文件
                                    progressText.textContent = "下载完成!";
                                    FileGenerator.download(blob, data.fileName);

                                    const fileSize = this.formatFileSize(blob.size);
                                    this.showToast(`下载完成！文件大小: ${fileSize}`, "success");
                                    console.log("文件生成完成:", data.fileName, fileSize);
                                } catch (e) {
                                    console.error("生成文件失败:", e);
                                    this.showToast("生成文件失败: " + e.message, "error");
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
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = data.fileName;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                    this.showToast("下载完成！", "success");
                                } catch (e) {
                                    console.error("下载文件失败:", e);
                                    this.showToast("下载文件失败", "error");
                                }
                            }

                            progressWatcher.close();

                            setTimeout(() => {
                                this.loadDownloads();
                                this.loadLibrary();
                            }, 1000);
                            break;
                        case "error":
                            progressText.textContent = `失败: ${data.error}`;
                            progressText.style.color = "var(--error-color)";
                            progressWatcher.close();
                            this.showToast("下载失败：" + data.error, "error");
                            btn.disabled = false;
                            btn.textContent = "重试";
                            break;
                    }
                });

                // 开始下载请求
                try {
                    await API.queue.startDownload(id);
                } catch (error) {
                    progressWatcher.close();
                    this.showToast("下载失败：" + error.message, "error");
                    btn.disabled = false;
                    btn.textContent = "重试";
                    progressText.textContent = `失败: ${error.message}`;
                    progressText.style.color = "var(--error-color)";
                }
            });
        });

        // 移除队列
        document.querySelectorAll(".remove-queue-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                await API.queue.remove(id);
                this.loadDownloads();
            });
        });
    },

    // 加载书库
    async loadLibrary() {
        const container = document.getElementById("library-list");
        if (!container) return;

        if (!this.currentUser) {
            container.innerHTML =
                '<p class="empty-message">请先登录后查看书库</p>';
            return;
        }

        // 显示加载中
        container.innerHTML = '<p class="empty-message">加载中...</p>';

        // 获取筛选条件
        const category = document.getElementById("library-category-filter")?.value || "";
        const author = document.getElementById("library-author-filter")?.value || "";
        const format = document.getElementById("library-format-filter")?.value || "";

        try {
            console.log("[App] 开始加载书库筛选器...");
            // 加载筛选器选项
            await this.loadLibraryFilters();

            console.log("[App] 开始请求书库数据...");
            const books = await API.library.getList({ category, author, format });

            console.log("[App] 书库数据获取成功:", books.length, "本书");

            // 更新总书籍数统计
            const totalCountElement = document.getElementById("library-total-count");
            if (totalCountElement) {
                totalCountElement.textContent = books.length;
            }

            if (books.length === 0) {
                container.innerHTML = '<p class="empty-message">书库为空，去下载一些小说吧</p>';
                return;
            }

            container.innerHTML = books.map((book) => this.renderBookCard(book, "library")).join("");
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
            const authorSelect = document.getElementById("library-author-filter");
            const currentAuthor = authorSelect?.value || "";
            if (authorSelect && filters.authors) {
                authorSelect.innerHTML =
                    '<option value="">所有作者</option>' +
                    filters.authors
                        .map((a) => `<option value="${a}" ${a === currentAuthor ? "selected" : ""}>${a}</option>`)
                        .join("");
            }

            // 更新格式筛选
            const formatSelect = document.getElementById("library-format-filter");
            const currentFormat = formatSelect?.value || "";
            if (formatSelect && filters.formats) {
                formatSelect.innerHTML =
                    '<option value="">所有格式</option>' +
                    filters.formats
                        .map(
                            (f) =>
                                `<option value="${f}" ${f === currentFormat ? "selected" : ""}>${f.toUpperCase()}</option>`
                        )
                        .join("");
            }
        } catch (e) {
            console.error("加载筛选器失败:", e);
        }
    },

    // 加载共享页（在快速下载页内嵌入）
    async loadSharedPage() {
        // 加载继续阅读卡片
        if (this.currentUser) {
            this.loadContinueReading();
        }

        const sharedSection = document.getElementById("shared-section");
        if (!sharedSection) return;

        // 未登录时隐藏共享区
        if (!this.currentUser) {
            sharedSection.style.display = "none";
            return;
        }

        // 已登录，显示共享区
        sharedSection.style.display = "block";

        // 如果未启用共享，显示启用按钮
        if (!this.currentUser.shareEnabled) {
            document.getElementById("share-search").style.display = "none";
            document.getElementById("shared-filter-bar").style.display = "none";
            document.getElementById("share-info").style.display = "block";
            document.getElementById("share-info").innerHTML = `
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
            document.getElementById("enable-share-btn")?.addEventListener("click", () => {
                this.enableShare();
            });
            return;
        }

        // 已启用共享，显示共享书库（无论是否有权限访问其他人的共享）
        document.getElementById("share-info").style.display = "none";
        document.getElementById("share-search").style.display = "flex";
        document.getElementById("shared-filter-bar").style.display = "flex";

        // 检查云端书库权限（后台授权）
        if (!this.currentUser.hasLibraryAuth) {
            const sharedContainer = document.getElementById("shared-list");
            if (sharedContainer) {
                sharedContainer.innerHTML = `
                    <div class="share-notice" style="margin-top: 20px;">
                        <p>您还没有云端书库访问权限，请联系管理员开通。</p>
                    </div>
                `;
            }
        } else {
            // 有权限访问，加载共享书库
            this.loadSharedLibrary();
        }
    },

    // 加载热门书籍推荐
    async loadPopularBooks() {
        try {
            // 获取收藏榜前9本书作为热门推荐
            const rankings = await API.rankings.get("favorites", 9);
            const container = document.getElementById("popular-books-grid");
            
            if (!container) return;
            
            if (rankings && rankings.length > 0) {
                let html = '';
                rankings.forEach(book => {
                    const platformIcon = book.platform === 'popo' ? '📚' : '💖';
                    // 使用首页专用的CSS类名和结构
                    html += `
                        <div class="popular-book-card" onclick="App.navigateToBook(${book.book_id})">
                            <div class="book-cover" style="background-image: url('${book.cover || this.defaultCover}')"></div>
                            <div class="book-info">
                                <div class="book-title" title="${book.title}">
                                    <span style="margin-right: 4px;">${platformIcon}</span>
                                    ${book.title}
                                </div>
                                <div class="book-author">${book.author || '未知作者'}</div>
                                <div class="book-stats">
                                    <span class="stat-item">📚 ${book.favorite_count || 0}</span>
                                </div>
                            </div>
                        </div>
                    `;
                });
                container.innerHTML = html;
            } else {
                container.innerHTML = '<div class="empty-message">暂无热门书籍</div>';
            }
        } catch (error) {
            console.error("加载热门书籍失败:", error);
            const container = document.getElementById("popular-books-grid");
            if (container) {
                container.innerHTML = '<div class="empty-message">加载失败</div>';
            }
        }
    },

    // 加载最近更新书籍
    async loadRecentBooks() {
        try {
            // 获取最近更新榜前6本书
            const rankings = await API.rankings.get("latest", 6);
            const container = document.getElementById("recent-books-list");
            
            if (!container) return;
            
            if (rankings && rankings.length > 0) {
                let html = '';
                rankings.forEach(book => {
                    const platformIcon = book.platform === 'popo' ? '📚' : '💖';
                    // 使用正确的CSS类名和结构
                    html += `
                        <div class="recent-book-item" onclick="App.navigateToBook(${book.book_id})">
                            <div class="book-cover-small" style="background-image: url('${book.cover || this.defaultCover}')"></div>
                            <div class="book-details">
                                <div class="book-title">
                                    <span style="margin-right: 4px;">${platformIcon}</span>
                                    ${book.title}
                                </div>
                                <div class="book-meta">
                                    <span class="author">${book.author || '未知作者'}</span>
                                    <span class="update-time">${book.last_update_time || '刚刚更新'}</span>
                                </div>
                            </div>
                            <div class="book-arrow">›</div>
                        </div>
                    `;
                });
                container.innerHTML = html;
            } else {
                container.innerHTML = '<div class="empty-message">暂无更新书籍</div>';
            }
        } catch (error) {
            console.error("加载最近更新书籍失败:", error);
            const container = document.getElementById("recent-books-list");
            if (container) {
                container.innerHTML = '<div class="empty-message">加载失败</div>';
            }
        }
    },

    // 加载共享书库
    async loadSharedLibrary(keyword = "") {
        const container = document.getElementById("shared-list");
        container.innerHTML = '<p class="empty-message">加载中...</p>';

        // 获取筛选条件
        const categoryFilter = document.getElementById("shared-category-filter")?.value || "";
        const formatFilter = document.getElementById("shared-format-filter")?.value || "";

        try {
            let books = keyword ? await API.share.search(keyword) : await API.share.getList();

            // 应用筛选
            if (categoryFilter) {
                books = books.filter((b) => b.tags && b.tags.includes(categoryFilter));
            }
            if (formatFilter) {
                books = books.filter((b) => b.format === formatFilter);
            }

            // 更新筛选器选项
            this.updateSharedFilters(books);

            if (books.length === 0) {
                container.innerHTML = '<p class="empty-message">共享书库为空</p>';
                return;
            }

            container.innerHTML = books.map((book) => this.renderBookCard(book, "shared")).join("");
            this.bindBookCardEvents();
        } catch (error) {
            container.innerHTML = `<p class="empty-message">${error.message}</p>`;
        }
    },

    // 更新共享书库筛选器
    updateSharedFilters(books) {
        const formats = new Set();

        books.forEach((book) => {
            if (book.format) {
                formats.add(book.format);
            }
        });

        // 分类已在HTML中静态设置，只更新格式筛选器
        const formatSelect = document.getElementById("shared-format-filter");
        const currentFormat = formatSelect?.value || "";
        if (formatSelect) {
            formatSelect.innerHTML =
                '<option value="">所有格式</option>' +
                Array.from(formats)
                    .map(
                        (f) =>
                            `<option value="${f}" ${f === currentFormat ? "selected" : ""}>${f.toUpperCase()}</option>`
                    )
                    .join("");
        }
    },

    // 加载下载记录
    async loadHistory() {
        if (!this.currentUser) {
            document.getElementById("history-list").innerHTML = '<p class="empty-message">请先登录</p>';
            return;
        }

        const container = document.getElementById("history-list");
        container.innerHTML = '<p class="empty-message">加载中...</p>';

        try {
            const history = await API.history.getList();

            if (history.length === 0) {
                container.innerHTML = '<p class="empty-message">暂无下载记录</p>';
                return;
            }

            container.innerHTML = history
                .map(
                    (item) => `
                <div class="history-item">
                    <div class="history-info">
                        <div class="history-title">${item.title}</div>
                        <div class="history-meta">
                            <span>作者：${item.author || "未知"}</span>
                            <span>格式：${(item.format || "txt").toUpperCase()}</span>
                            <span>大小：${item.file_size || "未知"}</span>
                            <span>总章节：${item.total_chapters || 0}</span>
                            ${item.webdav_path ? '<span style="color: #4CAF50;">✔ 已上传WebDAV</span>' : ""}
                            ${item.shared ? '<span style="color: #2196F3;">✔ 已共享</span>' : ""}
                        </div>
                    </div>
                    <div class="history-time">
                        ${this.formatTime(item.completed_at)}
                    </div>
                </div>
            `
                )
                .join("");
        } catch (error) {
            container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
        }
    },

    // 加载下载管理（合并队列和历史）
    async loadDownloads() {
        const container = document.getElementById("download-list");
        if (!container) return;

        if (!this.currentUser) {
            container.innerHTML = `
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
        `;

        try {
            // 获取队列和历史
            const queue = await API.queue.getList();
            const history = await API.history.getList();

            // 合并并按时间排序
            const allDownloads = [
                ...queue.map((item) => ({ ...item, source: "queue" })),
                ...history.map((item) => ({ ...item, source: "history" }))
            ].sort((a, b) => {
                const timeA = new Date(a.created_at || a.completed_at || 0);
                const timeB = new Date(b.created_at || b.completed_at || 0);
                return timeB - timeA;
            });

            if (allDownloads.length === 0) {
                container.innerHTML = '<p class="empty-message">暂无下载记录</p>';
                return;
            }

            container.innerHTML = allDownloads.map((item) => this.renderDownloadItem(item)).join("");
            this.bindQueueEvents();
        } catch (error) {
            container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
        }
    },

    // 渲染下载项（统一样式）
    renderDownloadItem(item) {
        const statusMap = {
            pending: { text: "等待中", color: "#757575", icon: "⏸️" },
            downloading: { text: "下载中", color: "#2196F3", icon: "⏬" },
            completed: { text: "已完成", color: "#4CAF50", icon: "✅" },
            failed: { text: "失败", color: "#f44336", icon: "❌" }
        };

        const status = item.source === "history" ? "completed" : item.status || "pending";
        const statusInfo = statusMap[status] || statusMap.pending;

        // 进度信息
        let progressInfo = "";
        if (status === "downloading" && item.progress && item.total_chapters) {
            const percent = Math.round((item.progress / item.total_chapters) * 100);
            progressInfo = `
                <div class="progress-bar" style="margin-top: 10px;">
                    <div class="progress-fill" style="width: ${percent}%"></div>
                </div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">${item.progress}/${item.total_chapters} 章 (${percent}%)</div>
            `;
        }

        // 操作按钮
        let actions = "";
        if (status === "pending") {
            actions = `
                <button class="btn btn-sm btn-primary start-download-btn" data-id="${item.id}">开始下载</button>
                <button class="btn btn-sm btn-outline remove-queue-btn" data-id="${item.id}">移除</button>
            `;
        } else if (status === "failed") {
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
                            <span>作者：${item.author || "未知"}</span>
                            <span style="margin-left: 15px;">格式：${(item.format || "txt").toUpperCase()}</span>
                            ${item.file_size ? `<span style="margin-left: 15px;">大小：${item.file_size}</span>` : ""}
                            ${item.total_chapters ? `<span style="margin-left: 15px;">总章节：${item.total_chapters}</span>` : ""}
                        </div>
                        ${progressInfo}
                        ${item.error_message ? `<div style="color: #f44336; font-size: 12px; margin-top: 5px;">错误：${item.error_message}</div>` : ""}
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
        if (!dateStr) return "未知";
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return "刚刚";
        if (diff < 3600000) return Math.floor(diff / 60000) + "分钟前";
        if (diff < 86400000) return Math.floor(diff / 3600000) + "小时前";
        if (diff < 604800000) return Math.floor(diff / 86400000) + "天前";

        return date.toLocaleDateString();
    },

    // 启用共享
    async enableShare() {
        try {
            await API.share.enable();
            await this.checkAuth();
            this.loadSharedPage();
            this.showToast("共享功能已启用", "success");
        } catch (error) {
            this.showToast("启用失败：" + error.message, "error");
        }
    },

    // 共享书籍
    async shareBook(libraryId) {
        try {
            await API.share.upload(libraryId);
            await this.checkAuth();
            this.showToast("书籍已共享", "success");
        } catch (error) {
            this.showToast("共享失败：" + error.message, "error");
        }
    },

    // 匹配书籍
    async matchBook(libraryId, filename) {
        try {
            // 提取文件名作为搜索关键词
            let keyword = filename;
            if (filename) {
                // 移除扩展名和_ID后缀
                keyword = filename.replace(/\.(epub|txt)$/i, "").replace(/_\d+$/, "");
            }

            // 弹出搜索对话框
            const searchKeyword = prompt("请输入搜索关键词：", keyword || "");
            if (!searchKeyword) return;

            // 搜索书籍
            this.showToast("正在搜索...", "info");
            const result = await API.search(searchKeyword);
            const results = result.books || [];

            if (results.length === 0) {
                this.showToast("未找到匹配的书籍", "error");
                return;
            }

            // 显示搜索结果供用户选择
            await this.showMatchResults(libraryId, results);
        } catch (error) {
            this.showToast("匹配失败：" + error.message, "error");
        }
    },

    // 显示匹配结果
    async showMatchResults(libraryId, results) {
        const modalBody = document.getElementById("book-modal-body");
        modalBody.innerHTML = `
            <h3 style="margin-bottom: 15px;">选择要匹配的书籍</h3>
            <div class="match-results-list">
                ${results
                    .map(
                        (book) => `
                    <div class="match-result-item" style="border: 1px solid #ddd; padding: 15px; margin-bottom: 10px; border-radius: 8px; cursor: pointer;" data-book-id="${book.bookId}">
                        <div style="display: flex; gap: 15px;">
                            <img src="${book.cover || App.defaultCover}" style="width: 60px; height: 80px; object-fit: cover; border-radius: 4px;">
                            <div style="flex: 1;">
                                <h4 style="margin: 0 0 5px 0;">${book.title}</h4>
                                <p style="margin: 0; color: #666; font-size: 13px;">作者：${book.author || "未知"}</p>
                                <p style="margin: 5px 0 0 0; color: #666; font-size: 12px;">
                                    ${book.status === "completed" ? "📖 完结" : "📖 连载中"}
                                    ${book.wordCount ? ` | 📝 ${book.wordCount.toLocaleString()}字` : ""}
                                    ${book.total_chapters ? ` | 📚 ${book.total_chapters}章` : ""}
                                </p>
                            </div>
                        </div>
                    </div>
                `
                    )
                    .join("")}
            </div>
        `;

        this.showModal("book-modal");

        // 绑定点击事件
        document.querySelectorAll(".match-result-item").forEach((item) => {
            item.addEventListener("click", async () => {
                const bookId = item.dataset.bookId;
                await this.confirmMatch(libraryId, bookId);
            });
        });
    },

    // 确认匹配
    async confirmMatch(libraryId, bookId) {
        try {
            this.hideModal("book-modal");
            this.showToast("正在匹配并重新生成文件...", "info");

            // 调用API匹配书籍
            await API.library.matchBook(libraryId, bookId);

            this.showToast("匹配成功！", "success");
            this.loadLibrary();
        } catch (error) {
            this.showToast("匹配失败：" + error.message, "error");
        }
    },

    // 下载共享书籍
    async downloadSharedBook(id) {
        try {
            // 直接通过链接下载
            const downloadUrl = `${API.baseUrl}/share/download/${id}`;

            // 创建临时链接并触发下载
            const link = document.createElement("a");
            link.href = downloadUrl;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            this.showToast("开始下载...", "success");

            // 延迟刷新列表以显示更新后的下载次数
            setTimeout(() => {
                this.loadSharedLibrary();
            }, 1000);
        } catch (error) {
            this.showToast("下载失败：" + error.message, "error");
        }
    },

    // 保存Cookie
    async saveCookie(cookie) {
        try {
            await API.po18.setCookie(cookie);
            await this.checkAuth();
            this.showToast("Cookie保存成功", "success");

            const statusEl = document.getElementById("cookie-status");
            statusEl.className = "cookie-status success";
            statusEl.textContent = "✅ Cookie已保存并验证通过";
        } catch (error) {
            const statusEl = document.getElementById("cookie-status");
            statusEl.className = "cookie-status error";
            statusEl.textContent = "❌ " + error.message;
        }
    },

    // 验证Cookie
    async validateCookie() {
        try {
            const result = await API.po18.validateCookie();
            const statusEl = document.getElementById("cookie-status");

            if (result.valid) {
                statusEl.className = "cookie-status success";
                statusEl.textContent = "✅ Cookie有效";
            } else {
                statusEl.className = "cookie-status error";
                statusEl.textContent = "❌ Cookie无效或已过期";
            }
        } catch (error) {
            this.showToast("验证失败", "error");
        }
    },

    // 显示设置弹窗
    showSettingsModal() {
        this.showModal("settings-modal");
        this.updateSettingsUI();
        this.loadSavedCookie();
        this.loadWebDAVConfig();
        this.loadShareSettings();
    },

    // 加载已保存的Cookie
    async loadSavedCookie() {
        try {
            const result = await API.po18.getCookie();
            const cookieInput = document.getElementById("po18-cookie");
            const statusEl = document.getElementById("cookie-status");

            if (result.cookie) {
                cookieInput.value = result.cookie;
                statusEl.className = "cookie-status success";
                statusEl.textContent = "✅ 已保存Cookie";
            } else {
                cookieInput.value = "";
                statusEl.className = "cookie-status";
                statusEl.textContent = "";
            }
        } catch (error) {
            console.error("加载Cookie失败:", error);
        }
    },

    // 加载WebDAV配置列表
    async loadWebDAVConfig() {
        try {
            const configs = await API.webdav.getConfig();
            const listContainer = document.getElementById("webdav-list");

            if (!configs || configs.length === 0) {
                listContainer.innerHTML = '<p style="color: #999;">还没有添加书库配置</p>';
                return;
            }

            listContainer.innerHTML = configs
                .map(
                    (config) => `
                <div class="webdav-item" style="padding: 15px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>${config.name}</strong>
                            ${config.isDefault ? '<span style="color: var(--md-pink); margin-left: 8px;">★ 默认</span>' : ""}
                            ${!config.isEnabled ? '<span style="color: #999; margin-left: 8px;">(已禁用)</span>' : ""}
                            <div style="font-size: 12px; color: #666; margin-top: 5px;">
                                ${config.url} - ${config.basePath || "/"}
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-sm btn-outline" onclick="App.testWebDAVById(${config.id})">测试</button>
                            <button class="btn btn-sm btn-outline" onclick="App.editWebDAV(${config.id})">编辑</button>
                            ${!config.isDefault ? `<button class="btn btn-sm btn-outline" onclick="App.setDefaultWebDAV(${config.id})">设为默认</button>` : ""}
                            <button class="btn btn-sm btn-outline" onclick="App.toggleWebDAV(${config.id})">${config.isEnabled ? "禁用" : "启用"}</button>
                            <button class="btn btn-sm btn-outline" style="color: #f44336;" onclick="App.deleteWebDAV(${config.id})">删除</button>
                        </div>
                    </div>
                </div>
            `
                )
                .join("");
        } catch (error) {
            console.error("加载WebDAV配置失败:", error);
        }
    },

    // 保存WebDAV配置
    async saveWebDAVConfig() {
        try {
            const config = {
                name: document.getElementById("webdav-name")?.value.trim() || "默认书库",
                url: document.getElementById("webdav-url").value.trim(),
                username: document.getElementById("webdav-username").value.trim(),
                password: document.getElementById("webdav-password").value,
                basePath: document.getElementById("webdav-path")?.value.trim() || "/",
                isDefault: true
            };

            if (!config.url || !config.username) {
                this.showToast("请填写完整的WebDAV配置", "error");
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
                this.showToast("修改成功", "success");
                this.cancelEditWebDAV();
            } else {
                // 新增模式
                if (!config.password) {
                    this.showToast("请填写密码", "error");
                    return;
                }

                await API.webdav.saveConfig(config);
                this.showToast("书库已添加", "success");

                // 清空表单
                document.getElementById("webdav-name").value = "";
                document.getElementById("webdav-url").value = "";
                document.getElementById("webdav-username").value = "";
                document.getElementById("webdav-password").value = "";
                document.getElementById("webdav-path").value = "";
            }

            // 重新加载列表
            await this.loadWebDAVConfig();
        } catch (error) {
            this.showToast("保存失败: " + error.message, "error");
        }
    },

    // 设置默认WebDAV
    async setDefaultWebDAV(id) {
        try {
            await API.post(`/webdav/configs/${id}/set-default`);
            this.showToast("已设为默认书库", "success");
            await this.loadWebDAVConfig();
        } catch (error) {
            this.showToast("设置失败: " + error.message, "error");
        }
    },

    // 切换WebDAV启用状态
    async toggleWebDAV(id) {
        try {
            await API.post(`/webdav/configs/${id}/toggle`);
            this.showToast("状态已更新", "success");
            await this.loadWebDAVConfig();
        } catch (error) {
            this.showToast("操作失败: " + error.message, "error");
        }
    },

    // 删除WebDAV配置
    async deleteWebDAV(id) {
        if (!confirm("确定要删除这个书库配置吗？")) return;

        try {
            await API.delete(`/webdav/configs/${id}`);
            this.showToast("已删除", "success");
            await this.loadWebDAVConfig();
        } catch (error) {
            this.showToast("删除失败: " + error.message, "error");
        }
    },

    // 编辑WebDAV配置
    async editWebDAV(id) {
        try {
            const configs = await API.webdav.getConfig();
            const config = configs.find((c) => c.id === id);

            if (!config) {
                this.showToast("配置不存在", "error");
                return;
            }

            // 填充表单
            document.getElementById("webdav-name").value = config.name;
            document.getElementById("webdav-url").value = config.url;
            document.getElementById("webdav-username").value = config.username;
            document.getElementById("webdav-path").value = config.basePath || "/";
            document.getElementById("webdav-password").value = ""; // 密码不回显

            // 保存正在编辑的ID
            this.editingWebDAVId = id;

            // 更改按钮文本
            const saveBtn = document.getElementById("save-webdav");
            saveBtn.textContent = "保存修改";
            saveBtn.style.backgroundColor = "var(--md-success)";

            // 添加取消按钮
            if (!document.getElementById("cancel-edit-webdav")) {
                const cancelBtn = document.createElement("button");
                cancelBtn.id = "cancel-edit-webdav";
                cancelBtn.className = "btn btn-outline";
                cancelBtn.textContent = "取消编辑";
                cancelBtn.onclick = () => this.cancelEditWebDAV();
                saveBtn.parentElement.insertBefore(cancelBtn, saveBtn);
            }

            this.showToast("请修改配置后点击“保存修改”", "info");
        } catch (error) {
            this.showToast("加载配置失败: " + error.message, "error");
        }
    },

    // 取消编辑WebDAV
    cancelEditWebDAV() {
        this.editingWebDAVId = null;

        // 清空表单
        document.getElementById("webdav-name").value = "";
        document.getElementById("webdav-url").value = "";
        document.getElementById("webdav-username").value = "";
        document.getElementById("webdav-password").value = "";
        document.getElementById("webdav-path").value = "";

        // 恢复按钮
        const saveBtn = document.getElementById("save-webdav");
        saveBtn.textContent = "添加书库";
        saveBtn.style.backgroundColor = "";

        // 删除取消按钮
        const cancelBtn = document.getElementById("cancel-edit-webdav");
        if (cancelBtn) {
            cancelBtn.remove();
        }
    },

    // 按ID测试WebDAV连接
    async testWebDAVById(id) {
        try {
            const configs = await API.webdav.getConfig();
            const config = configs.find((c) => c.id === id);

            if (!config) {
                this.showToast("配置不存在", "error");
                return;
            }

            this.showToast("正在测试连接...", "info");

            await API.webdav.testConnection({
                url: config.url,
                username: config.username,
                password: config.password || "" // 密码可能为空，使用已保存的
            });

            this.showToast("✅ 连接成功", "success");
        } catch (error) {
            this.showToast("❗ 连接失败: " + error.message, "error");
        }
    },

    // 测试WebDAV连接
    async testWebDAVConnection() {
        try {
            const config = {
                url: document.getElementById("webdav-url").value.trim(),
                username: document.getElementById("webdav-username").value.trim(),
                password: document.getElementById("webdav-password").value
            };

            if (!config.url || !config.username || !config.password) {
                this.showToast("请填写完整配置", "error");
                return;
            }

            const result = await API.webdav.testConnection(config);
            this.showToast("连接成功！", "success");
        } catch (error) {
            this.showToast("连接失败: " + error.message, "error");
        }
    },

    // 加载共享设置
    async loadShareSettings() {
        try {
            const checkbox = document.getElementById("enable-share-checkbox");
            const statusText = document.getElementById("share-status-text");
            const sharedCount = document.getElementById("shared-count");
            const canAccessShared = document.getElementById("can-access-shared");

            if (this.currentUser) {
                checkbox.checked = this.currentUser.shareEnabled || false;
                statusText.textContent = this.currentUser.shareEnabled ? "已启用" : "未启用";
                statusText.style.color = this.currentUser.shareEnabled
                    ? "var(--md-success)"
                    : "var(--md-on-surface-variant)";

                sharedCount.textContent = this.currentUser.sharedBooksCount || 0;
                // 使用 hasLibraryAuth 检查云端书库权限
                canAccessShared.textContent = this.currentUser.hasLibraryAuth ? "是" : "否";
                canAccessShared.style.color = this.currentUser.hasLibraryAuth
                    ? "var(--md-success)"
                    : "var(--md-on-surface-variant)";
            }
        } catch (error) {
            console.error("加载共享设置失败:", error);
        }
    },

    // 保存共享设置
    async saveShareSettings() {
        try {
            const checkbox = document.getElementById("enable-share-checkbox");
            const enabled = checkbox.checked;

            if (enabled && !this.currentUser.shareEnabled) {
                // 启用共享
                await API.share.enable();
                this.showToast("共享功能已启用", "success");
            } else if (!enabled && this.currentUser.shareEnabled) {
                // 禁用共享
                await API.share.disable();
                this.showToast("共享功能已禁用", "success");
            } else {
                this.showToast("设置未变更", "info");
            }

            // 刷新用户信息
            await this.checkAuth();
            this.loadShareSettings();
            this.loadSharedPage();
        } catch (error) {
            this.showToast("保存失败: " + error.message, "error");
        }
    },

    // 更新设置UI
    updateSettingsUI() {
        if (this.currentUser) {
            document.getElementById("share-status-text").textContent = this.currentUser.shareEnabled
                ? "已启用"
                : "未启用";
            document.getElementById("shared-count").textContent = this.currentUser.sharedBooksCount;
            document.getElementById("can-access-shared").textContent = this.currentUser.hasLibraryAuth ? "是" : "否";
        }
    },

    // 初始化设置标签页
    initSettingsTabs() {
        document.querySelectorAll(".settings-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                const tabName = tab.dataset.tab;

                document.querySelectorAll(".settings-tab").forEach((t) => {
                    t.classList.toggle("active", t === tab);
                });

                document.querySelectorAll(".settings-content").forEach((content) => {
                    content.classList.toggle("active", content.id === `settings-${tabName}`);
                });
            });
        });
    },

    // 显示Toast - MD3 Snackbar风格
    showToast(message, type = "info", options = {}) {
        const container = document.getElementById("toast-container");
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        
        // Toast图标映射
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        
        // 构建Toast内容
        const icon = options.icon !== undefined ? options.icon : icons[type];
        const duration = options.duration || 3000;
        const action = options.action;
        
        toast.innerHTML = `
            ${icon ? `<span class="toast-icon">${icon}</span>` : ''}
            <span class="toast-message">${message}</span>
            ${action ? `<button class="toast-action" onclick="${action.onClick}">${action.text}</button>` : ''}
        `;
        
        container.appendChild(toast);
        
        // 触发入场动画
        requestAnimationFrame(() => {
            toast.classList.add('toast-show');
        });
        
        // 自动移除
        const removeToast = () => {
            toast.classList.remove('toast-show');
            toast.classList.add('toast-hide');
            setTimeout(() => {
                toast.remove();
            }, 300);
        };
        
        const timer = setTimeout(removeToast, duration);
        
        // 点击关闭
        if (!action) {
            toast.addEventListener('click', () => {
                clearTimeout(timer);
                removeToast();
            });
        }
        
        // 返回toast元素，允许外部控制
        return {
            element: toast,
            close: removeToast,
            timer
        };
    },

    // ==================== 排行榜 ====================

    currentRankingType: "favorites",
    rankingCache: {},
    rankingRefreshTimer: null,
    rankingTabsInitialized: false, // 标记标签事件是否已绑定

    async loadRankings(type = null) {
        if (type) {
            this.currentRankingType = type;
        }

        // 更新标签激活状态
        document.querySelectorAll(".ranking-tab").forEach((tab) => {
            tab.classList.toggle("active", tab.dataset.type === this.currentRankingType);
        });

        // 如果有缓存且在6小时内，使用缓存
        const cacheKey = this.currentRankingType;
        const cached = this.rankingCache[cacheKey];
        const now = Date.now();

        if (cached && now - cached.timestamp < 6 * 60 * 60 * 1000) {
            this.renderRankings(cached.data);
            return;
        }

        // 显示加载中 - 使用骨架屏
        document.getElementById("ranking-list").innerHTML = `
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-card"></div>
        `;

        try {
            const books = await API.rankings.get(this.currentRankingType, 100);
            
            // 应用精华过滤
            const filteredBooks = this.applyContentFilter(books);
            
            this.rankingCache[cacheKey] = {
                data: filteredBooks,
                timestamp: now
            };
            this.renderRankings(filteredBooks);

            // 设置6小时后自动刷新
            this.scheduleRankingRefresh();
        } catch (error) {
            console.error("加载排行榜失败:", error);
            document.getElementById("ranking-list").innerHTML = '<p class="empty-message">加载失败</p>';
        }
    },

    renderRankings(books) {
        const container = document.getElementById("ranking-list");

        if (!books || books.length === 0) {
            container.innerHTML = '<p class="empty-message">暂无数据</p>';
            return;
        }

        // 如果是修仙榜，使用不同的渲染方式
        if (this.currentRankingType === "cultivation") {
            container.innerHTML = books
                .map((user, index) => {
                    const rank = user.rank || (index + 1);
                    const rankClass = rank === 1 ? "top1" : rank === 2 ? "top2" : rank === 3 ? "top3" : "";

                    // 格式化阅读时长（分钟转小时）
                    const hours = Math.floor((user.total_read_time || 0) / 60);
                    const minutes = (user.total_read_time || 0) % 60;
                    const timeText = hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;

                    return `
                    <div class="ranking-item">
                        <div class="ranking-number ${rankClass}">${rank}</div>
                        <div class="ranking-info" style="flex: 1;">
                            <div class="ranking-title">
                                <span style="margin-right: 8px;">👤</span>
                                ${this.escapeHtml(user.username || `用户${user.user_id}`)}
                            </div>
                            <div class="ranking-author">
                                <span style="color: var(--primary-color);">${user.levelName || "炼气期"} ${user.levelLayer || 1}层</span>
                                <span style="margin-left: 12px; color: #666;">ID: ${user.user_id}</span>
                            </div>
                        </div>
                        <div class="ranking-stats">
                            <div class="ranking-value">${this.formatNumber(user.exp || 0)}</div>
                            <div class="ranking-label">修为</div>
                            <div style="margin-top: 8px; font-size: 12px; color: #666;">
                                ⏱️ ${timeText}
                            </div>
                        </div>
                    </div>
                `;
                })
                .join("");
        } else {
            // 原有的书籍排行榜渲染
            const statLabels = {
                favorites: "收藏",
                comments: "留言",
                monthly: "月人气",
                total: "总人气",
                wordcount: "字数",
                latest: "更新时间"
            };

            const label = statLabels[this.currentRankingType] || "";

            container.innerHTML = books
                .map((book, index) => {
                    const rank = index + 1;
                    const rankClass = rank === 1 ? "top1" : rank === 2 ? "top2" : rank === 3 ? "top3" : "";

                    let statValue = "";
                    if (this.currentRankingType === "favorites") {
                        statValue = this.formatNumber(book.favorites_count);
                    } else if (this.currentRankingType === "comments") {
                        statValue = this.formatNumber(book.comments_count);
                    } else if (this.currentRankingType === "monthly") {
                        statValue = this.formatNumber(book.monthly_popularity);
                    } else if (this.currentRankingType === "total") {
                        statValue = this.formatNumber(book.total_popularity);
                    } else if (this.currentRankingType === "wordcount") {
                        statValue = this.formatNumber(book.word_count);
                    } else if (this.currentRankingType === "latest") {
                        statValue = this.formatUpdateTime(book.latest_chapter_date);
                    }

                    const cover = book.cover || this.defaultCover;
                    const detailUrl = book.detail_url || (book.platform === 'popo' ? `https://www.popo.tw/books/${book.book_id}` : `https://www.po18.tw/books/${book.book_id}`);
                    const statusText = this.getStatusText(book.status);
                    const platformIcon = book.platform === 'popo' ? '📚' : '💖';  // POPO用📚, PO18用💖

                    return `
                    <div class="ranking-item">
                        <div class="ranking-number ${rankClass}">${rank}</div>
                        <img src="${cover}" class="ranking-cover" alt="${this.escapeHtml(book.title)}" 
                             loading="lazy" onerror="this.src='${this.defaultCover}'"
                             style="cursor: pointer;"
                             onclick="window.location.href='/book-detail.html?id=${book.book_id}'">
                        <div class="ranking-info" style="cursor: pointer;" onclick="window.location.href='/book-detail.html?id=${book.book_id}'">
                            <div class="ranking-title">
                                <span style="margin-right: 0px;">${platformIcon}</span>
                                ${this.escapeHtml(book.title)}
                            </div>
                            <div class="ranking-author">作者：${this.escapeHtml(book.author || "未知")}</div>

                        </div>
                        <div class="ranking-stats">
                            <div class="ranking-value">${statValue}</div>
                            <div class="ranking-label">${label}</div>
                            <a href="${detailUrl}" target="_blank" class="btn-external" style="margin-top: 8px; font-size: 12px; color: var(--primary-color);" title="跳转到${book.platform === 'popo' ? 'POPO' : 'PO18'}原站">
                            </a>
                        </div>
                    </div>
                `;
                })
                .join("");
        }

        // 触发图片懒加载
        if (this.observeImages) {
            setTimeout(() => this.observeImages(), 100);
        }
    },

    // 初始化排行榜标签事件（只在页面加载时调用一次）
    initRankingTabs() {
        // 防止重复绑定
        if (this.rankingTabsInitialized) {
            console.log('[排行榜] 标签事件已绑定，跳过');
            return;
        }

        // 绑定标签切换事件
        document.querySelectorAll(".ranking-tab").forEach((tab) => {
            // 使用addEventListener替代onclick，避免覆盖
            // 先移除旧的事件监听器（如果存在）
            const oldHandler = tab._rankingClickHandler;
            if (oldHandler) {
                tab.removeEventListener('click', oldHandler);
            }
            
            // 创建新的事件处理器（使用闭包捕获当前 type 值）
            const handler = ((tabType) => {
                return (e) => {
                    e.preventDefault();
                    console.log('[排行榜] 切换到类型:', tabType);
                    this.loadRankings(tabType);
                };
            })(tab.dataset.type);
            
            // 保存处理器引用，以便下次移除
            tab._rankingClickHandler = handler;
            tab.addEventListener('click', handler);
        });

        this.rankingTabsInitialized = true;
        console.log('[排行榜] 标签事件绑定完成');
    },

    scheduleRankingRefresh() {
        if (this.rankingRefreshTimer) {
            clearTimeout(this.rankingRefreshTimer);
        }

        // 6小时后刷新
        this.rankingRefreshTimer = setTimeout(
            () => {
                if (this.currentPage === "rankings") {
                    this.rankingCache = {}; // 清除缓存
                    this.loadRankings();
                }
            },
            6 * 60 * 60 * 1000
        );
    },

    getStatusText(status) {
        const map = {
            completed: "完结",
            ongoing: "连载",
            unknown: "未知"
        };
        return map[status] || status || "未知";
    },

    // 格式化数字（超过1万显示为w）
    formatNumber(num) {
        if (!num) return "0";
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + "w";
        }
        return num.toLocaleString();
    },

    // 格式化日期时间为简短显示
    formatUpdateTime(dateStr) {
        if (!dateStr) return "-";

        try {
            const date = new Date(dateStr);
            const now = new Date();

            // 处理无效日期
            if (isNaN(date.getTime())) {
                return dateStr;
            }

            // 重置到当天0点进行比较
            const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const diff = nowDay - dateDay;
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));

            // 今天
            if (days === 0) {
                const hours = date.getHours().toString().padStart(2, "0");
                const minutes = date.getMinutes().toString().padStart(2, "0");
                return `今天 ${hours}:${minutes}`;
            }
            // 昨天
            else if (days === -1 || days === 1) {
                const hours = date.getHours().toString().padStart(2, "0");
                const minutes = date.getMinutes().toString().padStart(2, "0");
                return `昨天 ${hours}:${minutes}`;
            }
            // 2-6天前
            else if (days > 1 && days < 7) {
                return `${days}天前`;
            }
            // 7-29天前
            else if (days >= 7 && days < 30) {
                return `${days}天前`;
            }
            // 本年内（显示月日）
            else if (date.getFullYear() === now.getFullYear()) {
                const month = date.getMonth() + 1;
                const day = date.getDate();
                return `${month}月${day}日`;
            }
            // 跨年（显示年月）
            else {
                const year = date.getFullYear();
                const month = date.getMonth() + 1;
                return `${year}年${month}月`;
            }
        } catch (e) {
            return dateStr;
        }
    },

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
    },

    // HTML转义
    escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    },

    // 图片懒加载 - 使用全局lazyLoader
    setupLazyLoading() {
        // 使用utils.js中的全局lazyLoader
        this.observeImages = () => {
            if (window.lazyLoader) {
                window.lazyLoader.observe();
            }
        };

        // 初始化观察
        this.observeImages();
    },

    // ==================== 书架功能 ====================

    bookshelfData: [],
    currentBookshelfSort: "recent",

    // 加载书架
    async loadBookshelf() {
        // 检查是否有智能书架容器
        const smartContainer = document.getElementById("bookshelf-container");
        const oldContainer = document.getElementById("bookshelf-list");
        
        // 如果有智能书架容器，隐藏旧容器
        if (smartContainer && oldContainer) {
            oldContainer.style.display = 'none';
        }
        
        // 如果没有容器，直接返回
        if (!oldContainer && !smartContainer) return;

        if (!this.currentUser) {
            if (oldContainer) {
                oldContainer.innerHTML = '<p class="empty-message">请先登录</p>';
            }
            return;
        }

        // 显示加载中
        if (oldContainer) {
            oldContainer.innerHTML = '<p class="empty-message">加载中...</p>';
        }

        try {
            const response = await fetch("/api/bookshelf", {
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error("加载书架失败");
            }

            this.bookshelfData = await response.json();
            
            // 如果有智能书架容器，让智能书架处理渲染
            if (smartContainer) {
                // 触发智能书架重新渲染
                if (window.SmartBookshelf && window.SmartBookshelf.render) {
                    window.SmartBookshelf.render();
                }
            } else {
                // 否则使用旧版渲染
                this.renderBookshelf();
            }

            // 绑定排序事件
            const sortSelect = document.getElementById("bookshelf-sort-select");
            if (sortSelect && !sortSelect.dataset.bound) {
                sortSelect.dataset.bound = "true";
                sortSelect.addEventListener("change", (e) => {
                    this.currentBookshelfSort = e.target.value;
                    // 如果有智能书架，触发重新渲染
                    if (smartContainer && window.SmartBookshelf && window.SmartBookshelf.render) {
                        window.SmartBookshelf.render();
                    } else {
                        this.renderBookshelf();
                    }
                });
            }
        } catch (error) {
            if (oldContainer) {
                oldContainer.innerHTML = '<p class="empty-message">加载失败，请重试</p>';
            }
        }
    },

    // 渲染书架
    renderBookshelf() {
        // 检查是否有智能书架容器（bookshelf.html页面）
        const smartContainer = document.getElementById("bookshelf-container");
        if (smartContainer) {
            // 如果有智能书架容器，强制隐藏旧的列表容器
            const oldContainer = document.getElementById("bookshelf-list");
            if (oldContainer) {
                oldContainer.style.display = 'none';
                oldContainer.style.visibility = 'hidden';
                oldContainer.innerHTML = ''; // 清空内容
            }
            
            // 等待智能书架初始化完成后再渲染
            if (window.SmartBookshelf && window.SmartBookshelf.render) {
                window.SmartBookshelf.render();
            } else {
                // 如果智能书架还没初始化，等待一下再试
                setTimeout(() => {
                    if (window.SmartBookshelf && window.SmartBookshelf.render) {
                        window.SmartBookshelf.render();
                    }
                }, 200);
            }
            return;
        }

        // 旧版渲染逻辑（用于index.html等页面）
        const container = document.getElementById("bookshelf-list");
        if (!container) return;

        if (!this.bookshelfData || this.bookshelfData.length === 0) {
            container.innerHTML = '<p class="empty-message">书架空空如也，快去添加你喜欢的书籍吧</p>';
            return;
        }

        // 排序
        const sorted = [...this.bookshelfData];
        switch (this.currentBookshelfSort) {
            case "recent":
                sorted.sort((a, b) => {
                    const timeA = a.last_read_at ? new Date(a.last_read_at).getTime() : 0;
                    const timeB = b.last_read_at ? new Date(b.last_read_at).getTime() : 0;
                    return timeB - timeA;
                });
                break;
            case "progress":
                sorted.sort((a, b) => {
                    const progressA = this.calculateProgress(a.current_chapter, a.total_chapters);
                    const progressB = this.calculateProgress(b.current_chapter, b.total_chapters);
                    return progressB - progressA;
                });
                break;
            case "time":
                sorted.sort((a, b) => (b.reading_time || 0) - (a.reading_time || 0));
                break;
            case "added":
                sorted.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
                break;
        }

        container.innerHTML = sorted.map((book) => this.renderBookshelfItem(book)).join("");

        // 绑定事件
        container.querySelectorAll(".bookshelf-item").forEach((item) => {
            const bookId = item.dataset.bookId;

            // 点击卡片跳转详情
            item.addEventListener("click", (e) => {
                // 如果点击的是按钮，不跳转
                if (e.target.closest("button")) return;
                window.location.href = `/book-detail.html?id=${bookId}`;
            });

            // 继续阅读按钮
            item.querySelector(".btn-continue")?.addEventListener("click", (e) => {
                e.stopPropagation();
                const currentChapter = parseInt(item.dataset.currentChapter) || 0;
                window.location.href = `/reader.html?bookId=${bookId}&chapter=${currentChapter}`;
            });

            // 移除按钮
            item.querySelector(".btn-remove")?.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (confirm("确定要从书架中移除这本书吗？")) {
                    await this.removeFromBookshelf(bookId);
                }
            });
        });
    },

    // 渲染单个书架项
    renderBookshelfItem(book) {
        const progress = this.calculateProgress(book.current_chapter, book.total_chapters);
        const progressText = this.formatProgress(book.current_chapter, book.total_chapters);
        const readingTime = this.formatReadingTime(book.reading_time);
        const lastRead = this.formatLastRead(book.last_read_at);

        return `
            <div class="book-card bookshelf-item" data-book-id="${book.book_id}" data-current-chapter="${book.current_chapter}">
                <div class="book-card-body">
                    <img class="book-cover" src="${book.cover || this.defaultCover}" alt="${this.escapeHtml(book.title)}" loading="lazy" onerror="this.src='${this.defaultCover}'">
                    <div class="book-info">
                        <h3 class="book-title">${this.escapeHtml(book.title)}</h3>
                        <p class="book-author">作者：${this.escapeHtml(book.author || "未知")}</p>
                        
                        <div class="reading-progress">
                            <div class="progress-info">
                                <span>${progressText}</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${progress}%"></div>
                            </div>
                        </div>
                        
                        <div class="reading-stats">
                            <div class="stat-item">
                                <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>
                                </svg>
                                <span>${readingTime}</span>
                            </div>
                            <div class="stat-item">
                                <svg fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/>
                                </svg>
                                <span>${lastRead}</span>
                            </div>
                        </div>
                        
                        <div class="bookshelf-actions">
                            <button class="btn btn-primary btn-sm btn-continue">
                                ${book.current_chapter > 0 ? "继续阅读" : "开始阅读"}
                            </button>
                            <button class="btn btn-outline btn-sm btn-remove">
                                移除
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // 从书架移除
    async removeFromBookshelf(bookId) {
        try {
            const response = await fetch(`/api/bookshelf/${bookId}`, {
                method: "DELETE",
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error("移除失败");
            }

            // 重新加载书架
            await this.loadBookshelf();
            this.showToast("已从书架移除", "success");
        } catch (error) {
            console.error("移除失败:", error);
            this.showToast("移除失败，请重试", "error");
        }
    },

    // 计算进度
    calculateProgress(current, total) {
        if (!total || total === 0) return 0;
        return Math.round((current / total) * 100);
    },

    // 格式化进度文本
    formatProgress(current, total) {
        if (!total || total === 0) return "未开始";
        const percent = this.calculateProgress(current, total);
        return `${percent}% (${current}/${total}章)`;
    },

    // 格式化阅读时长
    formatReadingTime(minutes) {
        if (!minutes || minutes === 0) return "0分钟";
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours > 0) {
            return `${hours}小时${mins}分钟`;
        }
        return `${mins}分钟`;
    },

    // 格式化最后阅读时间
    formatLastRead(timestamp) {
        if (!timestamp) return "从未阅读";
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}天前`;
        if (hours > 0) return `${hours}小时前`;
        if (minutes > 0) return `${minutes}分钟前`;
        return "刚刚";
    },

    // 检查云端书库权限
    async checkCacheAuth() {
        try {
            const user = await API.auth.getMe();
            return user && user.hasCacheAuth; // 使用 hasCacheAuth 字段
        } catch (error) {
            return false;
        }
    },

    // 全站书库分页状态
    globalLibraryState: {
        page: 1,
        pageSize: 20,
        hasMore: true,
        loading: false,
        books: [],
        totalBooks: 0,
        totalChapters: 0
    },

    // 加载全站书库（支持无限滚动分页）
    async loadGlobalLibrary(reset = true) {
        const container = document.getElementById("global-library-list");
        if (!container) return;
        const state = this.globalLibraryState;

        // 如果正在加载或没有更多数据，跳过
        if (state.loading || (!reset && !state.hasMore)) return;

        // 重置状态
        if (reset) {
            state.page = 1;
            state.hasMore = true;
            state.books = [];
            container.innerHTML = `
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
            `;
        }

        state.loading = true;

        try {
            const tag = document.getElementById("global-tag-filter")?.value || "";
            const sortBy = document.getElementById("global-sort")?.value || "latest";
            const minWords = document.getElementById("global-min-words")?.value || "";
            const maxWords = document.getElementById("global-max-words")?.value || "";

            const params = {
                sortBy,
                page: state.page,
                pageSize: state.pageSize
            };
            // 添加筛选参数
            if (tag) params.tag = tag;
            if (minWords && minWords.trim() !== "") {
                const min = parseInt(minWords);
                if (!isNaN(min) && min > 0) params.minWords = min;
            }
            if (maxWords && maxWords.trim() !== "") {
                const max = parseInt(maxWords);
                if (!isNaN(max) && max > 0) params.maxWords = max;
            }

            const result = await API.globalLibrary.getList(params);

            // 处理返回结构
            const books = result.books || [];
            
            // 应用精华过滤
            const filteredBooks = this.applyContentFilter(books);
            
            const stats = result.stats || {};
            const pagination = result.pagination || {};

            // 更新状态（使用过滤后的书籍）
            if (reset) {
                state.books = filteredBooks;
            } else {
                state.books = [...state.books, ...filteredBooks];
            }
            state.hasMore = pagination.hasMore !== undefined ? pagination.hasMore : false;
            state.page++;

            // 更新统计信息（仅首页）
            if (reset || stats.totalBooks) {
                const totalBooksEl = document.getElementById("global-total-books");
                const totalChaptersEl = document.getElementById("global-total-chapters");
                const filteredCountEl = document.getElementById("global-filtered-count");

                if (stats.totalBooks) {
                    state.totalBooks = stats.totalBooks;
                    state.totalChapters = stats.totalChapters;
                }
                if (totalBooksEl) totalBooksEl.textContent = state.totalBooks || 0;
                if (totalChaptersEl) totalChaptersEl.textContent = state.totalChapters || 0;
                if (filteredCountEl) filteredCountEl.textContent = stats.filteredCount || pagination.total || 0;
            }

            // 渲染书籍
            if (state.books.length === 0) {
                container.innerHTML = '<p class="empty-message">暂无符合条件的书籍</p>';
                return;
            }

            // 添加加载更多触发器
            const loadMoreHtml = state.hasMore
                ? '<div class="load-more-trigger" id="global-load-more"><span class="loading-dots">加载中...</span></div>'
                : '<div class="load-more-end">已加载全部</div>';

            // 渲染书籍列表
            if (reset) {
                // 重置时，清空并重新渲染所有书籍
                container.innerHTML = state.books.map((book) => this.renderGlobalLibraryBook(book)).join("") + loadMoreHtml;
            } else {
                // 追加时，移除旧的加载触发器，添加新书籍和新的加载触发器
                const existingContent = container.innerHTML
                    .replace(/<div class="load-more-trigger"[\s\S]*?<\/div>/g, "")
                    .replace(/<div class="load-more-end"[\s\S]*?<\/div>/g, "");
                const newBooksHtml = filteredBooks.map((book) => this.renderGlobalLibraryBook(book)).join("");
                container.innerHTML = existingContent + newBooksHtml + loadMoreHtml;
            }

            // 设置无限滚动观察器
            this.setupGlobalLibraryInfiniteScroll();

            // 触发懒加载
            if (this.observeImages) {
                setTimeout(() => this.observeImages(), 100);
            }
        } catch (error) {
            // 检查是否是被踢出登录
            if (error.message.includes("已在其他设备登录") || error.message.includes("SESSION_KICKED")) {
                this.handleSessionKicked();
                return;
            }
            if (error.message.includes("权限")) {
                container.innerHTML = '<p class="empty-message">需要云端缓存权限才能访问全站书库</p>';
            } else {
                container.innerHTML = `<p class="empty-message">加载失败：${error.message}</p>`;
            }
        } finally {
            state.loading = false;
        }
    },

    // 渲染单本全站书库书籍（宫格卡片样式）
    renderGlobalLibraryBook(book) {
        const cover = book.cover || this.defaultCover;
        const platformIcon = book.platform === 'popo' ? '📚' : '💖';  // POPO用📚, PO18用💖
        const cachedChapters = book.cached_chapters || 0;
        const totalChapters = book.total_chapters || cachedChapters;
        const chapterBadge = `${cachedChapters}/${totalChapters}`;

        return `
            <div class="global-book-grid-card">
                <a href="/book-detail.html?id=${book.book_id}" class="global-book-link">
                    <div class="global-book-cover-wrap">
                        <img class="global-book-cover" src="${cover}" alt="${book.title}" loading="lazy" onerror="this.src=App.defaultCover">
                        <span class="global-book-badge">${chapterBadge}</span>
                        <span class="global-book-platform">${platformIcon}</span>
                    </div>
                    <div class="global-book-title">${book.title}</div>
                </a>
            </div>
        `;
    },

    // 设置全站书库无限滚动
    setupGlobalLibraryInfiniteScroll() {
        const trigger = document.getElementById("global-load-more");
        if (!trigger) return;

        // 清除旧的观察器
        if (this.globalLibraryObserver) {
            this.globalLibraryObserver.disconnect();
        }

        this.globalLibraryObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting && this.globalLibraryState.hasMore && !this.globalLibraryState.loading) {
                        this.loadGlobalLibrary(false);
                    }
                });
            },
            {
                rootMargin: "200px"
            }
        );

        this.globalLibraryObserver.observe(trigger);
    },

    // 加载全站书库标签
    async loadGlobalLibraryTags() {
        try {
            const tags = await API.globalLibrary.getTags();
            const select = document.getElementById("global-tag-filter");
            if (select) {
                select.innerHTML =
                    '<option value="">所有标签</option>' +
                    tags.map((tag) => `<option value="${tag}">${tag}</option>`).join("");
            }
        } catch (error) {
            console.error("加载标签失败:", error);
        }
    },

    // 加载设置页
    async loadSettings() {
        try {
            // 更新用户信息显示
            this.updateUserInfoDisplay();

            // 加载用户统计（刷新缓存以获取最新数据）
            const stats = await API.userStats.refresh();
            console.log("用户统计数据:", stats); // 调试信息

            // 更新统计显示 - 添加空值检查
            const sharedBooksEl = document.getElementById("stat-shared-books");
            if (sharedBooksEl) {
                sharedBooksEl.textContent = stats.sharedBooks || 0;
            }
            
            const sharedChaptersEl = document.getElementById("stat-shared-chapters");
            if (sharedChaptersEl) {
                sharedChaptersEl.textContent = stats.sharedChapters || 0;
            }

            const readingTimeEl = document.getElementById("stat-reading-time");
            if (readingTimeEl) {
                const hours = Math.floor((stats.readingMinutes || 0) / 60);
                const mins = (stats.readingMinutes || 0) % 60;
                readingTimeEl.textContent = hours > 0 ? `${hours}h${mins}m` : `${mins}m`;
            }

            const bookshelfEl = document.getElementById("stat-bookshelf");
            if (bookshelfEl) {
                bookshelfEl.textContent = stats.bookshelfBooks || 0;
            }
            
            const downloadsEl = document.getElementById("stat-downloads");
            if (downloadsEl) {
                downloadsEl.textContent = stats.downloads || 0;
            }
            
            const totalBooksEl = document.getElementById("stat-total-books");
            if (totalBooksEl) {
                totalBooksEl.textContent = stats.totalBooks || 0;
            }

            // 加载分享排名
            this.loadShareRanking();

            // 更新趋势数据（模拟）
            document.querySelectorAll(".stat-trend").forEach((el) => {
                const randomChange = Math.floor(Math.random() * 10) + 1;
                el.textContent = `+${randomChange}`;
                if (el.previousElementSibling && el.previousElementSibling.classList.contains("stat-value")) {
                    const value = parseInt(el.previousElementSibling.textContent);
                    if (value > 50) {
                        el.style.color = "#4caf50";
                        el.style.background = "rgba(76, 175, 80, 0.1)";
                    } else if (value > 20) {
                        el.style.color = "#ff9800";
                        el.style.background = "rgba(255, 152, 0, 0.1)";
                    } else {
                        el.style.color = "#2196f3";
                        el.style.background = "rgba(33, 150, 243, 0.1)";
                    }
                }
            });

            // 更新设置状态
            const user = this.currentUser;
            if (user) {
                const po18Status = document.getElementById("po18-status");
                if (po18Status) {
                    po18Status.textContent = user.hasPo18Cookie ? "已设置" : "未设置";
                    po18Status.style.background = user.hasPo18Cookie ? "#c8e6c9" : "";
                }

                const webdavStatus = document.getElementById("webdav-status");
                if (webdavStatus) {
                    webdavStatus.textContent = user.hasWebDAV ? "已配置" : "未配置";
                    webdavStatus.style.background = user.hasWebDAV ? "#c8e6c9" : "";
                }

                // 共享设置状态 - 检查元素是否存在
                const shareStatusBadge = document.getElementById("share-status-badge");
                if (shareStatusBadge) {
                    shareStatusBadge.textContent = user.shareEnabled ? "已启用" : "未启用";
                    shareStatusBadge.style.background = user.shareEnabled ? "#c8e6c9" : "";
                }
                
                // 更新共享开关状态
                const shareToggle = document.getElementById("share-toggle");
                if (shareToggle) {
                    shareToggle.checked = user.shareEnabled || false;
                }
            }

            // 加载阅读统计热力图
            this.loadReadingHeatmap();

            // 绑定快捷功能事件
            this.bindQuickActions();
        } catch (error) {
            console.error("加载设置失败:", error);
        }
    },

    // 绑定快捷功能事件
    bindQuickActions() {
        // 我的书架
        document.getElementById("quick-bookshelf")?.addEventListener("click", () => {
            this.navigateTo("bookshelf");
        });

        // 下载管理
        document.getElementById("quick-downloads")?.addEventListener("click", () => {
            this.navigateTo("downloads");
        });

        // 订阅管理
        document.getElementById("quick-subscriptions")?.addEventListener("click", () => {
            this.navigateTo("subscriptions");
        });

        // 全站书库
        document.getElementById("quick-library")?.addEventListener("click", () => {
            this.navigateTo("global-library");
        });

        // 编辑资料
        document.getElementById("edit-profile-btn")?.addEventListener("click", () => {
            this.showModal("profile-edit-modal");
        });

        // 查看全部成就
        document.querySelector(".section-more")?.addEventListener("click", (e) => {
            e.preventDefault();
            this.showToast("更多成就功能即将上线", "info");
        });
    },

    // 显示模态框
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = "block";
            document.body.style.overflow = "hidden";
        }
    },

    // 隐藏模态框
    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = "none";
            document.body.style.overflow = "auto";
        }
    },

    // 加载阅读统计热力图
    async loadReadingHeatmap() {
        try {
            const container = document.getElementById("reading-heatmap");
            if (!container) {
                console.warn('[热力图] 容器不存在，ID: reading-heatmap');
                return;
            }

            console.log('[热力图] 开始加载...');
            
            // 显示加载中状态
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">加载中...</div>';
            
            const data = await API.userStats.getReadingStats(180);
            console.log('[热力图] 获取数据成功:', data);

            // 更新摘要统计
            const totalDaysEl = document.getElementById("total-reading-days");
            const totalMinutesEl = document.getElementById("total-reading-minutes");
            const currentStreakEl = document.getElementById("current-streak");
            const longestStreakEl = document.getElementById("longest-streak");
            
            if (totalDaysEl) {
                totalDaysEl.textContent = data.summary?.totalDays || 0;
                console.log('[热力图] 更新总天数:', totalDaysEl.textContent);
            } else {
                console.warn('[热力图] 找不到元素: total-reading-days');
            }
            
            if (totalMinutesEl) {
                totalMinutesEl.textContent = data.summary?.totalMinutes || 0;
                console.log('[热力图] 更新总分钟数:', totalMinutesEl.textContent);
            } else {
                console.warn('[热力图] 找不到元素: total-reading-minutes');
            }
            
            if (currentStreakEl) {
                currentStreakEl.textContent = data.streak?.current || 0;
                console.log('[热力图] 更新当前连续:', currentStreakEl.textContent);
            } else {
                console.warn('[热力图] 找不到元素: current-streak');
            }
            
            if (longestStreakEl) {
                longestStreakEl.textContent = data.streak?.longest || 0;
                console.log('[热力图] 更新最长连续:', longestStreakEl.textContent);
            } else {
                console.warn('[热力图] 找不到元素: longest-streak');
            }

            // 渲染热力图
            if (data.dailyStats && data.dailyStats.length > 0) {
                this.renderHeatmap(container, data.dailyStats, data.summary?.maxMinutes || 60);
                console.log('[热力图] 渲染完成');
            } else {
                container.innerHTML = '<div style="text-align: center; padding: 30px; color: #999;">暂无阅读数据</div>';
                console.log('[热力图] 无数据');
            }
        } catch (error) {
            console.error("[热力图] 加载失败:", error);
            const container = document.getElementById("reading-heatmap");
            if (container) {
                container.innerHTML = '<div style="text-align: center; padding: 30px; color: #f44336;">加载失败，请刷新页面重试</div>';
            }
        }
    },

    // 渲染热力图
    renderHeatmap(container, dailyStats, maxMinutes) {
        // 创建日期到分钟数的映射
        const dateMap = {};
        dailyStats.forEach((d) => {
            dateMap[d.date] = d.reading_minutes;
        });

        // 生成最近26周(约6个月)的日期
        const weeks = [];
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0];

        // 计算从今天往前26周
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 26 * 7 + (7 - today.getDay()));

        let currentDate = new Date(startDate);

        for (let week = 0; week < 26; week++) {
            const weekDays = [];
            for (let day = 0; day < 7; day++) {
                const dateStr = currentDate.toISOString().split("T")[0];
                const minutes = dateMap[dateStr] || 0;

                weekDays.push({
                    date: dateStr,
                    minutes: minutes,
                    level: this.getHeatmapLevel(minutes, maxMinutes)
                });

                currentDate.setDate(currentDate.getDate() + 1);
            }
            weeks.push(weekDays);
        }

        // 渲染HTML
        const colors = ["#ebedf0", "#fce4ec", "#f8bbd9", "#f48fb1", "#e91e63"];
        const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
        const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

        let html = '<div class="heatmap-wrapper" style="display: flex; gap: 2px;">';

        // 左侧星期标签
        html +=
            '<div class="heatmap-weekdays" style="display: flex; flex-direction: column; gap: 1px; margin-right: 2px; font-size: 9px; color: #666;">';
        for (let i = 0; i < 7; i++) {
            html += `<div style="height: 10px; line-height: 10px;">${i % 2 === 1 ? weekdays[i] : ""}</div>`;
        }
        html += "</div>";

        // 热力图主体
        html += '<div style="display: flex; flex-direction: column;">';

        // 月份标签
        html += '<div style="display: flex; gap: 1px; margin-bottom: 2px; font-size: 9px; color: #666; height: 14px;">';
        let lastMonth = -1;
        weeks.forEach((week, i) => {
            const month = new Date(week[0].date).getMonth();
            if (month !== lastMonth) {
                html += `<div style="width: 10px; text-align: center;">${months[month]}</div>`;
                lastMonth = month;
            } else {
                html += '<div style="width: 10px;"></div>';
            }
        });
        html += "</div>";

        // 热力图格子
        html += '<div style="display: flex; gap: 1px;">';
        weeks.forEach((week) => {
            html += '<div style="display: flex; flex-direction: column; gap: 1px;">';
            week.forEach((day) => {
                const isFuture = day.date > todayStr;
                const bgColor = isFuture ? "#f9f9f9" : colors[day.level];
                const title = isFuture ? "" : `${day.date}: ${day.minutes}分钟`;
                html += `<div class="heatmap-cell" style="width: 10px; height: 10px; background: ${bgColor}; border-radius: 2px; cursor: ${isFuture ? "default" : "pointer"}; transition: all 0.2s;" title="${title}" onmouseover="this.style.transform='scale(1.5)'; this.style.zIndex='10';" onmouseout="this.style.transform='scale(1)'; this.style.zIndex='1';"></div>`;
            });
            html += "</div>";
        });
        html += "</div>";

        html += "</div></div>";

        container.innerHTML = html;
    },

    // 计算热力图等级
    getHeatmapLevel(minutes, maxMinutes) {
        if (minutes === 0) return 0;
        const ratio = minutes / maxMinutes;
        if (ratio < 0.25) return 1;
        if (ratio < 0.5) return 2;
        if (ratio < 0.75) return 3;
        return 4;
    },

    // ==================== 订阅管理功能 ====================

    // 检查订阅更新并显示徽章（优化版）
    async checkSubscriptionUpdates() {
        try {
            if (!this.currentUser) return;

            // 记录上次的更新数量，用于检测新更新
            const lastUpdateCount = this.lastSubscriptionUpdateCount || 0;

            const data = await API.subscriptions.getList();
            
            // 从响应数据中提取更新数量
            let updateCount = 0;
            if (typeof data.updateCount === 'number') {
                updateCount = data.updateCount;
            } else if (Array.isArray(data.subscriptions)) {
                // 如果没有updateCount字段，从subscriptions数组计算
                updateCount = data.subscriptions.filter(s => s.has_update === 1 || s.hasUpdate).length;
            }

            // 保存当前更新数量
            this.lastSubscriptionUpdateCount = updateCount;

            // 检测是否有新更新（数量增加）
            const hasNewUpdates = updateCount > lastUpdateCount;

            // 更新导航栏徽章
            const badge = document.getElementById("subscription-badge");
            if (badge) {
                if (updateCount > 0) {
                    badge.textContent = updateCount > 99 ? "99+" : updateCount;
                    badge.style.display = "flex";
                    // 如果有新更新，添加动画效果
                    if (hasNewUpdates) {
                        badge.classList.add('pulse');
                        setTimeout(() => badge.classList.remove('pulse'), 2000);
                    }
                } else {
                    badge.style.display = "none";
                }
            }

            // 更新底部Tab导航徽章
            const tabBadge = document.getElementById("tab-subscription-badge");
            if (tabBadge) {
                if (updateCount > 0) {
                    tabBadge.textContent = updateCount > 99 ? "99+" : updateCount;
                    tabBadge.style.display = "flex";
                    // 如果有新更新，添加动画效果
                    if (hasNewUpdates) {
                        tabBadge.classList.add('pulse');
                        setTimeout(() => tabBadge.classList.remove('pulse'), 2000);
                    }
                } else {
                    tabBadge.style.display = "none";
                }
            }

            // 更新设置页的提醒
            const alert = document.getElementById("subscription-alert");
            const alertCount = document.getElementById("alert-update-count");
            if (alert && alertCount) {
                if (updateCount > 0) {
                    alertCount.textContent = updateCount;
                    alert.style.display = "block";
                } else {
                    alert.style.display = "none";
                }
            }

            // 如果有新更新且浏览器支持通知，发送通知
            if (hasNewUpdates && updateCount > 0 && Notification.permission === "granted") {
                const newCount = updateCount - lastUpdateCount;
                this.showBrowserNotification(
                    "🔔 订阅更新", 
                    `您有 ${newCount > 1 ? `${newCount} 本` : '1 本'}订阅的书籍有更新！`, 
                    {
                        tag: "subscription-update",
                        url: "#subscriptions",
                        requireInteraction: false
                    }
                );
            }

            console.log(`[订阅] 检查更新完成，发现 ${updateCount} 个更新${hasNewUpdates ? '（新）' : ''}`);
        } catch (error) {
            console.error("检查订阅更新失败:", error);
            // 错误时不显示给用户，避免干扰
        }
    },

    // 检查未读提醒
    async checkNotifications() {
        try {
            if (!this.currentUser) return;

            const data = await API.subscriptions.getNotifications(50, true);
            const unreadCount = data.notifications?.length || 0;

            // 如果有未读提醒，可以在这里处理（比如显示提醒列表）
            if (unreadCount > 0) {
                console.log(`[提醒] 发现 ${unreadCount} 条未读提醒`);
                // 可以在这里触发UI更新，比如显示提醒图标
            }
        } catch (error) {
            // 静默失败，不影响主流程
            console.debug("检查提醒失败:", error);
        }
    },

    // 加载订阅列表页面
    async loadSubscriptions(retryCount = 0) {
        const listEl = document.getElementById("subscription-list");
        if (!listEl) return;

        if (!this.currentUser) {
            listEl.innerHTML =
                '<p class="empty-message">请先登录后查看订阅</p>';
            return;
        }

        listEl.innerHTML = '<p class="empty-message">加载中...</p>';

        try {
            console.log('[订阅] 开始加载订阅列表...');
            const data = await API.subscriptions.getList();
            console.log('[订阅] API返回数据:', data);
            
            // 检查返回数据格式
            if (!data) {
                console.error('[订阅] 服务器返回数据为空');
                throw new Error("服务器返回数据为空");
            }
            
            const subscriptions = data.subscriptions || [];
            console.log(`[订阅] 获取到 ${subscriptions.length} 条订阅记录`);
            const updateCount = subscriptions.filter(s => s.hasUpdate).length;

            // 更新标签页计数
            const countAllEl = document.getElementById("sub-count-all");
            const countUpdatedEl = document.getElementById("sub-count-updated");
            if (countAllEl) countAllEl.textContent = subscriptions.length;
            if (countUpdatedEl) countUpdatedEl.textContent = updateCount;

            // 绑定标签页事件
            this.bindSubscriptionTabs(subscriptions);

            // 绑定通知按钮事件
            this.bindNotificationButton();

            // 绑定检查更新按钮
            this.bindCheckUpdatesButton();

            // 更新通知按钮状态
            this.updateNotificationButton();

            // 渲染列表
            this.renderSubscriptionList(listEl, subscriptions, "all");
            
            // 刷新提醒数量（不阻塞主流程）
            this.checkSubscriptionUpdates().catch(err => {
                console.warn('[订阅] 检查更新失败:', err);
            });
        } catch (error) {
            console.error('[订阅] 加载失败:', error);
            console.error('[订阅] 错误详情:', {
                message: error.message,
                name: error.name,
                status: error.status,
                code: error.code
            });
            
            // 服务器错误（5xx）不应该重试，直接显示错误
            if (error.status >= 500) {
                console.error('[订阅] 服务器错误，不进行重试');
                if (listEl) {
                    const errorMsg = error.message || '服务器错误，请稍后重试';
                    listEl.innerHTML = `
                        <div class="empty-message" style="text-align: center; padding: 20px;">
                            <p style="margin-bottom: 12px; color: var(--md-error);">
                                ⚠️ ${errorMsg}
                            </p>
                            <p style="font-size: 12px; color: var(--md-on-surface-variant); margin-bottom: 12px;">
                                错误代码: ${error.status}${error.code ? ` (${error.code})` : ''}
                            </p>
                            <button class="btn btn-sm btn-primary" onclick="App.loadSubscriptions()" style="margin-top: 8px;">
                                🔄 重试
                            </button>
                        </div>
                    `;
                }
                return;
            }
            
            // 如果是网络错误且未超过重试次数，自动重试
            const isNetworkError = error.message && (
                                   error.message.includes('网络') || 
                                   error.message.includes('超时') || 
                                   error.message.includes('连接失败') ||
                                   error.name === 'TypeError'
                               );
            
            if (isNetworkError && retryCount < 2) {
                const remainingRetries = 2 - retryCount;
                console.log(`[订阅] 网络错误，${remainingRetries}秒后重试 (剩余 ${remainingRetries} 次)...`);
                if (listEl) {
                    listEl.innerHTML = `<p class="empty-message">网络错误，${remainingRetries}秒后自动重试...</p>`;
                }
                setTimeout(() => {
                    this.loadSubscriptions(retryCount + 1);
                }, 2000);
                return;
            }
            
            // 显示友好的错误信息
            if (listEl) {
                const errorMsg = error.message || '加载失败';
                const isAuthError = error.message.includes('登录') || error.message.includes('401');
                
                if (isAuthError) {
                    listEl.innerHTML = `
                        <p class="empty-message" style="color: var(--md-error);">
                            ⚠️ 登录已失效，请重新登录
                        </p>
                    `;
                } else {
                    listEl.innerHTML = `
                        <div class="empty-message" style="text-align: center; padding: 20px;">
                            <p style="margin-bottom: 12px; color: var(--md-on-surface-variant);">
                                ❌ ${errorMsg}
                            </p>
                            <button class="btn btn-sm btn-primary" onclick="App.loadSubscriptions()" style="margin-top: 8px;">
                                🔄 重试
                            </button>
                        </div>
                    `;
                }
            }
        }
    },

    // 绑定订阅标签页事件
    bindSubscriptionTabs(subscriptions) {
        document.querySelectorAll(".sub-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                // 更新标签状态
                document.querySelectorAll(".sub-tab").forEach((t) => t.classList.remove("active"));
                tab.classList.add("active");

                // 渲染对应列表
                const filter = tab.dataset.filter;
                const listEl = document.getElementById("subscription-list");
                this.renderSubscriptionList(listEl, subscriptions, filter);
            });
        });
    },

    // 渲染订阅列表
    renderSubscriptionList(container, subscriptions, filter) {
        let filteredList = subscriptions;

        if (filter === "updated") {
            filteredList = subscriptions.filter((s) => s.has_update === 1);
        }

        if (filteredList.length === 0) {
            container.innerHTML = `<p class="empty-message">${filter === "updated" ? "暂无更新" : '暂无订阅，去书籍详情页点击"订阅更新"关注你喜欢的书籍吧'}</p>`;
            return;
        }

        let html = "";
        filteredList.forEach((sub) => {
            const hasUpdate = sub.has_update === 1;
            const newChapters = sub.new_chapters || 0;
            let updateBadgeText = '🔔 有更新';
            if (hasUpdate && newChapters > 0) {
                updateBadgeText = `🔔 +${newChapters}章`;
            }
            html += `
                <div class="subscription-card ${hasUpdate ? "has-update" : ""}" data-book-id="${sub.book_id}">
                    <img class="book-cover" src="${sub.cover || this.defaultCover}" alt="${sub.title}" 
                         loading="lazy" onerror="this.src=App.defaultCover">
                    <div class="book-info">
                        <div class="book-title">${sub.title}</div>
                        <div class="book-author">${sub.author || "未知作者"}</div>
                        ${hasUpdate ? `<span class="update-badge">${updateBadgeText}</span>` : ""}
                    </div>
                    <div class="sub-actions">
                        <button class="btn-view" onclick="App.viewSubscribedBook('${sub.book_id}')">查看</button>
                        <button class="btn-unsubscribe" onclick="App.unsubscribeBook('${sub.book_id}')">取消订阅</button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        
        // 为有更新的订阅卡片添加点击事件，点击时清除更新标记
        container.querySelectorAll('.subscription-card.has-update').forEach(card => {
            const bookId = card.dataset.bookId;
            // 只给卡片本身添加点击事件，不包括按钮区域
            card.addEventListener('click', async (e) => {
                // 如果点击的是按钮，不处理
                if (e.target.closest('.btn-view, .btn-unsubscribe')) {
                    return;
                }
                
                try {
                    // 清除更新标记
                    await API.subscriptions.clearUpdate(bookId);
                    // 刷新提醒数量
                    await this.checkSubscriptionUpdates();
                    // 重新加载订阅列表
                    await this.loadSubscriptions();
                } catch (error) {
                    console.error('清除更新标记失败:', error);
                }
            });
        });
    },

    // 取消订阅
    async unsubscribeBook(bookId) {
        if (!confirm("确定要取消订阅这本书吗？")) return;

        try {
            await API.subscriptions.unsubscribe(bookId);
            this.showToast("已取消订阅", "success");
            this.loadSubscriptions(); // 重新加载列表
            this.checkSubscriptionUpdates(); // 更新徽章
        } catch (error) {
            this.showToast("取消失败", "error");
        }
    },

    // 查看订阅的书籍（打开详情页）
    async viewSubscribedBook(bookId) {
        try {
            // 先清除该书籍的更新标记
            await API.subscriptions.clearUpdate(bookId);
            // 刷新提醒数量
            await this.checkSubscriptionUpdates();
            // 刷新订阅列表（更新UI中的更新标记）
            await this.loadSubscriptions();
        } catch (error) {
            console.error('清除更新标记失败:', error);
            // 即使失败也继续跳转
        }
        // 打开书籍详情页
        window.location.href = `/book-detail.html?id=${bookId}`;
    },

    // 手动检查订阅更新（优化版）
    async manualCheckUpdates() {
        const btn = document.getElementById('btn-check-updates');
        if (!btn) return;

        try {
            // 禁用按钮
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span><span>检查中...</span>';

            const result = await API.subscriptions.checkUpdates();
            
            if (result.success) {
                this.showToast('已开始检查订阅更新', 'success');
                
                // 轮询检查状态，直到完成
                const checkStatus = async () => {
                    try {
                        const status = await API.subscriptions.getCheckerStatus();
                        if (!status.status.isChecking) {
                            // 检查完成，刷新列表
                            await this.loadSubscriptions();
                            await this.checkSubscriptionUpdates();
                            btn.disabled = false;
                            btn.innerHTML = '<span>🔄</span><span>检查更新</span>';
                            this.showToast('检查完成', 'success');
                        } else {
                            // 还在检查中，继续等待
                            setTimeout(checkStatus, 2000);
                        }
                    } catch (error) {
                        console.error('检查状态失败:', error);
                        // 即使失败也刷新一次
                        await this.loadSubscriptions();
                        await this.checkSubscriptionUpdates();
                        btn.disabled = false;
                        btn.innerHTML = '<span>🔄</span><span>检查更新</span>';
                    }
                };

                // 2秒后开始检查状态
                setTimeout(checkStatus, 2000);
            } else {
                this.showToast(result.message || '检查失败', 'warning');
                btn.disabled = false;
                btn.innerHTML = '<span>🔄</span><span>检查更新</span>';
            }
        } catch (error) {
            console.error('检查订阅更新失败:', error);
            this.showToast('检查失败，请稍后重试', 'error');
            btn.disabled = false;
            btn.innerHTML = '<span>🔄</span><span>检查更新</span>';
        }
    },

    // 检查单个书籍更新
    async checkSingleBook(bookId) {
        try {
            const result = await API.subscriptions.checkBook(bookId);
            
            if (result.success) {
                if (result.updated) {
                    this.showToast(`发现更新：新增 ${result.newChapters} 章`, 'success');
                } else {
                    this.showToast('暂无更新', 'info');
                }
                // 刷新订阅列表
                await this.loadSubscriptions();
                await this.checkSubscriptionUpdates();
            }
        } catch (error) {
            console.error('检查书籍失败:', error);
            this.showToast('检查失败', 'error');
        }
    },

    // 绑定检查更新按钮
    bindCheckUpdatesButton() {
        const btn = document.getElementById('btn-check-updates');
        if (!btn || btn._bound) return;

        btn._bound = true;
        btn.addEventListener('click', () => {
            this.manualCheckUpdates();
        });
    },

    // ==================== 浏览器通知功能 ====================

    // 绑定通知按钮事件
    bindNotificationButton() {
        const btn = document.getElementById("btn-enable-notification");
        if (!btn || btn._bound) return;

        btn._bound = true;
        btn.addEventListener("click", async () => {
            await this.requestNotificationPermission();
        });
    },

    // 更新通知按钮状态
    updateNotificationButton() {
        const btn = document.getElementById("btn-enable-notification");
        if (!btn) return;

        if (!("Notification" in window)) {
            btn.textContent = "浏览器不支持";
            btn.disabled = true;
            return;
        }

        switch (Notification.permission) {
            case "granted":
                btn.textContent = "✅ 已开启";
                btn.style.background = "#4caf50";
                btn.style.color = "white";
                btn.style.borderColor = "#4caf50";
                break;
            case "denied":
                btn.textContent = "已拒绝";
                btn.disabled = true;
                break;
            default:
                btn.textContent = "开启通知";
        }
    },

    // 请求通知权限
    async requestNotificationPermission() {
        if (!("Notification" in window)) {
            this.showToast("您的浏览器不支持通知功能", "error");
            return;
        }

        try {
            const permission = await Notification.requestPermission();

            if (permission === "granted") {
                this.showToast("通知已开启！", "success");
                this.showBrowserNotification("🔔 通知已开启", "订阅的书籍有更新时会推送通知", {
                    tag: "test"
                });
            } else if (permission === "denied") {
                this.showToast("您已拒绝通知权限", "error");
            }

            this.updateNotificationButton();
        } catch (error) {
            console.error("请求通知权限失败:", error);
        }
    },

    // 显示浏览器通知
    showBrowserNotification(title, body, options = {}) {
        if (Notification.permission !== "granted") return;

        try {
            const notification = new Notification(title, {
                body: body,
                icon: "/icons/icon.svg",
                badge: "/icons/icon.svg",
                tag: options.tag || "default",
                requireInteraction: false
            });

            notification.onclick = () => {
                window.focus();
                if (options.url) {
                    if (options.url.startsWith("#")) {
                        this.navigateTo(options.url.substring(1));
                    } else {
                        window.location.href = options.url;
                    }
                }
                notification.close();
            };

            // 5秒后自动关闭
            setTimeout(() => notification.close(), 5000);
        } catch (error) {
            console.error("显示通知失败:", error);
        }
    },

    // ==================== 主题系统 ====================

    // 初始化主题
    initTheme() {
        // 从本地存储读取主题偏好
        const savedTheme = localStorage.getItem("theme") || "light";
        this.setTheme(savedTheme, false);

        // 监听系统主题变化（可选）
        if (window.matchMedia) {
            window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
                // 如果用户没有手动设置，则跟随系统
                if (!localStorage.getItem("theme")) {
                    this.setTheme(e.matches ? "dark" : "light", false);
                }
            });
        }
    },

    // 切换主题
    toggleTheme() {
        const themes = ["light", "dark", "eye-care"];
        const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
        const currentIndex = themes.indexOf(currentTheme);
        const nextIndex = (currentIndex + 1) % themes.length;
        const nextTheme = themes[nextIndex];

        this.setTheme(nextTheme);
    },

    // 设置主题
    setTheme(theme, showToast = true) {
        // 设置数据属性
        if (theme === "light") {
            document.documentElement.removeAttribute("data-theme");
        } else {
            document.documentElement.setAttribute("data-theme", theme);
        }

        // 保存到本地存储
        localStorage.setItem("theme", theme);

        // 更新按钮图标
        this.updateThemeIcon(theme);

        // 显示提示
        if (showToast) {
            const themeNames = {
                light: "浅色模式",
                dark: "深色模式",
                "eye-care": "护眼模式"
            };
            this.showToast(`已切换为${themeNames[theme]}`, "success");
        }
    },

    // 更新主题图标
    updateThemeIcon(theme) {
        const btn = document.getElementById("theme-toggle");
        if (!btn) return;

        const icons = {
            light: "🌙", // 月亮（表示可以切换到深色）
            dark: "🌿", // 植物（表示可以切换到护眼）
            "eye-care": "☀️" // 太阳（表示可以切换到浅色）
        };

        btn.textContent = icons[theme];

        const titles = {
            light: "切换到深色模式",
            dark: "切换到护眼模式",
            "eye-care": "切换到浅色模式"
        };

        btn.title = titles[theme];
    },

    // 加载继续阅读卡片
    async loadContinueReading() {
        const section = document.getElementById("continue-reading-section");
        const container = document.getElementById("continue-reading-cards");

        if (!section || !container) return;

        try {
            // 按最后阅读时间排序，取前5本
            const recentBooks = books
                .filter((book) => book.last_read_at)
                .sort((a, b) => new Date(b.last_read_at) - new Date(a.last_read_at))
                .slice(0, 5);

            if (recentBooks.length === 0) {
                // 显示空状态提示
                container.innerHTML = `
                    <div style="
                        width: 100%;
                        text-align: center;
                        padding: 40px 20px;
                        color: var(--md-on-surface-variant);
                    ">
                        <div style="font-size: 48px; margin-bottom: 16px;">📖</div>
                        <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 500;">还没有阅读记录</p>
                        <p style="margin: 0; font-size: 14px;">开始阅读一本书，这里就会显示你的阅读进度哦！</p>
                    </div>
                `;
                section.style.display = "block"; // 仍然显示区域
                return;
            }

            section.style.display = "block";

            container.innerHTML = recentBooks
                .map((book) => {
                    const progress =
                        book.total_chapters > 0 ? Math.round((book.current_chapter / book.total_chapters) * 100) : 0;

                    const lastReadTime = this.formatRelativeTime(book.last_read_at);

                    return `
                    <div class="continue-reading-card" data-book-id="${book.book_id}" data-chapter="${book.current_chapter}">
                        <div class="reading-card-header">
                            <img src="${book.cover_url || this.defaultCover}" 
                                 alt="${book.title}" 
                                 class="reading-card-cover"
                                 onerror="this.src='${this.defaultCover}'">
                            <div class="reading-card-info">
                                <h4 class="reading-card-title">${book.title}</h4>
                                <p class="reading-card-author">${book.author || "未知作者"}</p>
                            </div>
                        </div>
                        <div class="reading-card-progress">
                            <div class="progress-text">
                                <span>阅读进度</span>
                                <span>${progress}%</span>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${progress}%"></div>
                            </div>
                        </div>
                        <div class="reading-card-meta">
                            <span class="reading-card-time">
                                <span>🕒</span>
                                <span>${lastReadTime}</span>
                            </span>
                            <span class="reading-card-chapter">
                                第 ${book.current_chapter}/${book.total_chapters} 章
                            </span>
                        </div>
                    </div>
                `;
                })
                .join("");

            // 绑定点击事件
            container.querySelectorAll(".continue-reading-card").forEach((card) => {
                card.addEventListener("click", () => {
                    const bookId = card.dataset.bookId;
                    const chapter = parseInt(card.dataset.chapter) || 1;
                    // 跳转到阅读器
                    window.location.href = `/reader.html?id=${bookId}&chapter=${chapter}`;
                });
            });
        } catch (error) {
            section.style.display = "none";
        }
    },

    // 格式化相对时间
    formatRelativeTime(dateString) {
        const now = new Date();
        const date = new Date(dateString);
        const diff = now - date;

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return "刚刚";
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        if (days < 7) return `${days}天前`;
        if (days < 30) return `${Math.floor(days / 7)}周前`;
        return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
    },

    // 绑定模态框事件
    bindModalEvents() {
        // 点击遮罩关闭模态框
        document.querySelectorAll(".modal-overlay").forEach((overlay) => {
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) {
                    overlay.style.display = "none";
                    document.body.style.overflow = "auto";
                }
            });
        });

        // ESC键关闭模态框
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                document.querySelectorAll(".modal-overlay").forEach((overlay) => {
                    overlay.style.display = "none";
                });
                document.body.style.overflow = "auto";
            }
        });

        // 绑定个人资料编辑事件
        this.bindProfileEditEvents();
    },

    // 绑定个人资料编辑事件
    bindProfileEditEvents() {
        // 上传头像按钮
        document.getElementById("upload-avatar-btn")?.addEventListener("click", () => {
            document.getElementById("avatar-file").click();
        });

        // 文件选择事件
        document.getElementById("avatar-file")?.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                // 验证文件类型
                if (!file.type.startsWith("image/")) {
                    this.showToast("请选择图片文件", "error");
                    return;
                }

                // 验证文件大小 (最大2MB)
                if (file.size > 2 * 1024 * 1024) {
                    this.showToast("图片大小不能超过2MB", "error");
                    return;
                }

                // 预览图片
                const reader = new FileReader();
                reader.onload = (event) => {
                    const preview = document.getElementById("avatar-preview");
                    preview.innerHTML = `<img src="${event.target.result}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                };
                reader.readAsDataURL(file);

                this.showToast("头像已选择，保存后生效", "info");
            }
        });

        // 保存个人资料按钮
        document.getElementById("save-profile-btn")?.addEventListener("click", async () => {
            await this.saveUserProfile();
        });
    },

    // 保存用户个人资料
    async saveUserProfile() {
        try {
            // 获取表单数据
            const nickname = document.getElementById("user-nickname").value.trim();
            const bio = document.getElementById("user-bio").value.trim();
            const genres = Array.from(document.getElementById("user-favorite-genres").selectedOptions).map(
                (option) => option.value
            );

            const preferences = {
                nightMode: document.getElementById("pref-night-mode").checked,
                autoSync: document.getElementById("pref-auto-sync").checked,
                pushNotifications: document.getElementById("pref-push-notifications").checked
            };

            // 构造用户数据对象
            const userData = {
                nickname: nickname || this.currentUser.username,
                bio: bio || "热爱阅读的书虫 📖",
                favoriteGenres: genres,
                preferences: preferences
            };

            // 这里应该调用API保存用户数据
            // 暂时只做前端演示
            console.log("保存用户资料:", userData);

            // 保存成功后更新界面
            document.getElementById("profile-username").textContent = userData.nickname;
            document.querySelector(".profile-bio").textContent = userData.bio;

            this.showToast("个人资料保存成功", "success");
            this.hideModal("profile-edit-modal");
        } catch (error) {
            console.error("保存个人资料失败:", error);
            this.showToast("保存失败: " + error.message, "error");
        }
    },

    // 更新用户信息显示
    updateUserInfoDisplay() {
        if (this.currentUser) {
            document.getElementById("profile-username").textContent = this.currentUser.username;

            // 计算注册天数
            const createdDate = new Date(this.currentUser.createdAt);
            const today = new Date();
            const diffTime = Math.abs(today - createdDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            document.getElementById("user-days-tag").textContent = `注册 ${diffDays} 天`;

            // 根据阅读量设置等级
            const readingMinutes = this.currentUser.readingMinutes || 0;
            let level = "Lv.1 新手";
            if (readingMinutes > 1000) level = "Lv.5 书神";
            else if (readingMinutes > 500) level = "Lv.4 资深读者";
            else if (readingMinutes > 200) level = "Lv.3 高级读者";
            else if (readingMinutes > 50) level = "Lv.2 进阶读者";
            document.getElementById("user-level-tag").textContent = level;
        }
    },

    // ==================== 折叠卡片功能 ====================
    
    // 初始化折叠卡片
    initCollapsibleCards() {
        const savedStates = JSON.parse(localStorage.getItem('cardStates') || '{}');
        const defaultCollapsed = ['achievements', 'user-stats', 'account-settings'];
        
        document.querySelectorAll('.collapsible-card').forEach(card => {
            const section = card.dataset.section;
            const content = card.querySelector('.card-content');
            const icon = card.querySelector('.toggle-icon');
            
            if (section in savedStates) {
                if (savedStates[section] === false) {
                    content?.classList.add('collapsed');
                    icon?.classList.add('collapsed');
                } else {
                    content?.classList.remove('collapsed');
                    icon?.classList.remove('collapsed');
                }
            } else {
                if (defaultCollapsed.includes(section)) {
                    content?.classList.add('collapsed');
                    icon?.classList.add('collapsed');
                } else {
                    content?.classList.remove('collapsed');
                    icon?.classList.remove('collapsed');
                }
            }
        });
    },
    
    // 切换卡片展开/折叠
    toggleSection(section) {
        const card = document.querySelector(`[data-section="${section}"]`);
        if (!card) return;
        
        const content = card.querySelector('.card-content');
        const icon = card.querySelector('.toggle-icon');
        
        if (!content) return;
        
        const isCollapsed = content.classList.contains('collapsed');
        
        if (isCollapsed) {
            content.classList.remove('collapsed');
            icon?.classList.remove('collapsed');
        } else {
            content.classList.add('collapsed');
            icon?.classList.add('collapsed');
        }
        
        // 保存状态到 localStorage
        const savedStates = JSON.parse(localStorage.getItem('cardStates') || '{}');
        savedStates[section] = !isCollapsed;
        localStorage.setItem('cardStates', JSON.stringify(savedStates));
    },
    
    // ==================== 设置项交互 ====================
    
    // 初始化设置项
    initSettingItems() {
        // 共享设置开关
        const shareToggle = document.getElementById('share-toggle');
        if (shareToggle) {
            // 从当前用户状态加载共享设置
            if (this.currentUser) {
                shareToggle.checked = this.currentUser.shareEnabled || false;
            }
            
            shareToggle.addEventListener('change', async (e) => {
                await this.toggleShare(e.target.checked);
            });
        }
    },
    
    // 切换共享状态
    async toggleShare(enabled) {
        try {
            const response = await fetch('/api/user/toggle-share', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ enabled })
            });
            
            if (response.ok) {
                this.showToast(enabled ? '共享已启用' : '共享已关闭', 'success');
            } else {
                throw new Error('设置失败');
            }
        } catch (error) {
            console.error('切换共享状态失败:', error);
            this.showToast('设置失败，请重试', 'error');
            // 恢复开关状态
            const shareToggle = document.getElementById('share-toggle');
            if (shareToggle) {
                shareToggle.checked = !enabled;
            }
        }
    },
    
    // ==================== 精华过滤功能 ====================
    
    // 加载过滤设置
    loadFilterSettings() {
        const settings = JSON.parse(localStorage.getItem('contentFilter') || '{}');
        
        // 设置开关状态
        const filterEnabled = document.getElementById('filter-enabled');
        if (filterEnabled) {
            filterEnabled.checked = settings.enabled || false;
        }
        
        // 设置过滤内容
        const filterAuthors = document.getElementById('filter-authors');
        if (filterAuthors) {
            filterAuthors.value = (settings.authors || []).join(',');
        }
        
        const filterKeywords = document.getElementById('filter-keywords');
        if (filterKeywords) {
            filterKeywords.value = (settings.keywords || []).join(',');
        }
        
        const filterCategories = document.getElementById('filter-categories');
        if (filterCategories) {
            filterCategories.value = (settings.categories || []).join(',');
        }
        
        const filterShowTip = document.getElementById('filter-show-tip');
        if (filterShowTip) {
            filterShowTip.checked = settings.showTip !== false;
        }
    },
    
    // 切换过滤开关
    toggleFilter(enabled) {
        const settings = JSON.parse(localStorage.getItem('contentFilter') || '{}');
        settings.enabled = enabled;
        localStorage.setItem('contentFilter', JSON.stringify(settings));
        
        this.showToast(enabled ? '精华过滤已启用' : '精华过滤已关闭', 'success');
    },
    
    // 保存PO18 Cookie
    async savePO18Cookie() {
        const cookieInput = document.getElementById("po18-cookie");
        const cookie = cookieInput.value.trim();
        const statusEl = document.getElementById("cookie-status");
        
        if (!cookie) {
            statusEl.innerHTML = '<span style="color: var(--md-error);">⚠️ 请输入Cookie</span>';
            return;
        }
        
        try {
            const result = await API.po18.saveCookie({ cookie });
            if (result.success) {
                statusEl.innerHTML = '<span style="color: var(--md-success);">✅ Cookie保存成功</span>';
                document.getElementById("po18-status").textContent = "已设置";
                document.getElementById("po18-status").style.background = "#c8e6c9";
                this.showToast('Cookie保存成功', 'success');
            } else {
                throw new Error(result.message || '保存失败');
            }
        } catch (error) {
            console.error('保存Cookie失败:', error);
            statusEl.innerHTML = `<span style="color: var(--md-error);">⚠️ ${error.message}</span>`;
            this.showToast('Cookie保存失败', 'error');
        }
    },
    
    // 验证PO18 Cookie
    async validatePO18Cookie() {
        const cookieInput = document.getElementById("po18-cookie");
        const cookie = cookieInput.value.trim();
        const statusEl = document.getElementById("cookie-status");
        
        if (!cookie) {
            statusEl.innerHTML = '<span style="color: var(--md-error);">⚠️ 请输入Cookie</span>';
            return;
        }
        
        statusEl.innerHTML = '<span style="color: var(--md-on-surface-variant);">⏳ 验证中...</span>';
        
        try {
            const result = await API.po18.validateCookie({ cookie });
            if (result.valid) {
                statusEl.innerHTML = '<span style="color: var(--md-success);">✅ Cookie有效</span>';
                this.showToast('Cookie验证成功', 'success');
            } else {
                statusEl.innerHTML = '<span style="color: var(--md-error);">❌ Cookie无效或已过期</span>';
                this.showToast('Cookie验证失败', 'error');
            }
        } catch (error) {
            console.error('验证Cookie失败:', error);
            statusEl.innerHTML = '<span style="color: var(--md-error);">⚠️ 验证失败</span>';
            this.showToast('验证失败', 'error');
        }
    },
    
    // 保存WebDAV配置
    async saveWebDAV() {
        const name = document.getElementById('webdav-name').value.trim();
        const url = document.getElementById('webdav-url').value.trim();
        const username = document.getElementById('webdav-username').value.trim();
        const password = document.getElementById('webdav-password').value.trim();
        const path = document.getElementById('webdav-path').value.trim() || '/po18/';
        
        if (!name || !url || !username || !password) {
            this.showToast('请填写完整信息', 'error');
            return;
        }
        
        try {
            const result = await API.webdav.save({ name, url, username, password, path });
            if (result.success) {
                this.showToast('WebDAV配置已添加', 'success');
                document.getElementById('webdav-status').textContent = '已配置';
                document.getElementById('webdav-status').style.background = '#c8e6c9';
                // 清空表单
                document.getElementById('webdav-name').value = '';
                document.getElementById('webdav-url').value = '';
                document.getElementById('webdav-username').value = '';
                document.getElementById('webdav-password').value = '';
                document.getElementById('webdav-path').value = '';
                // 重新加载列表
                this.loadWebDAVConfig();
            } else {
                throw new Error(result.message || '添加失败');
            }
        } catch (error) {
            console.error('添加WebDAV配置失败:', error);
            this.showToast('WebDAV配置失败', 'error');
        }
    },
    
    // 测试WebDAV连接
    async testWebDAV() {
        const url = document.getElementById('webdav-url').value.trim();
        const username = document.getElementById('webdav-username').value.trim();
        const password = document.getElementById('webdav-password').value.trim();
        
        if (!url || !username || !password) {
            this.showToast('请先填写连接信息', 'error');
            return;
        }
        
        this.showToast('正在测试连接...', 'info');
        
        try {
            const result = await API.webdav.test({ url, username, password });
            if (result.success) {
                this.showToast('连接成功！', 'success');
            } else {
                throw new Error(result.message || '连接失败');
            }
        } catch (error) {
            console.error('测试WebDAV连接失败:', error);
            this.showToast('连接失败！', 'error');
        }
    },
    
    // 切换设置详情
    toggleSettingDetail(detailId) {
        const detail = document.getElementById(detailId);
        if (!detail) return;
        
        detail.classList.toggle('collapsed');
    },
    
    // 切换过滤设置详情
    toggleFilterSettings() {
        const detail = document.getElementById('filter-detail');
        if (!detail) return;
        
        detail.classList.toggle('collapsed');
    },
    
    // 保存过滤设置
    saveFilterSettings() {
        const authors = document.getElementById('filter-authors').value
            .split(',')
            .map(s => s.trim())
            .filter(s => s);
            
        const keywords = document.getElementById('filter-keywords').value
            .split(',')
            .map(s => s.trim())
            .filter(s => s);
            
        const categories = document.getElementById('filter-categories').value
            .split(',')
            .map(s => s.trim())
            .filter(s => s);
            
        const showTip = document.getElementById('filter-show-tip').checked;
        const enabled = document.getElementById('filter-enabled').checked;
        
        const settings = {
            enabled,
            authors,
            keywords,
            categories,
            showTip
        };
        
        localStorage.setItem('contentFilter', JSON.stringify(settings));
        this.showToast('过滤设置已保存', 'success');
    },
    
    // 应用内容过滤
    applyContentFilter(books) {
        const settings = JSON.parse(localStorage.getItem('contentFilter') || '{}');
        
        if (!settings.enabled) {
            return books;
        }
        
        const filtered = books.filter(book => {
            // 过滤作者
            if (settings.authors && settings.authors.length > 0) {
                if (settings.authors.some(author => book.author && book.author.includes(author))) {
                    return false;
                }
            }
            
            // 过滤关键词
            if (settings.keywords && settings.keywords.length > 0) {
                const searchText = `${book.title || ''} ${book.author || ''} ${book.description || ''}`;
                if (settings.keywords.some(keyword => searchText.includes(keyword))) {
                    return false;
                }
            }
            
            // 过滤分类
            if (settings.categories && settings.categories.length > 0) {
                if (settings.categories.some(category => {
                    if (Array.isArray(book.categories)) {
                        return book.categories.includes(category);
                    } else if (book.category) {
                        return book.category.includes(category);
                    }
                    return false;
                })) {
                    return false;
                }
            }
            
            return true;
        });
        
        // 显示过滤提示
        if (settings.showTip && filtered.length < books.length) {
            const filteredCount = books.length - filtered.length;
            this.showToast(`已过滤 ${filteredCount} 本书籍`, 'info');
        }
        
        return filtered;
    },
    
    // ==================== 分享排行榜 ====================
    
    // 加载分享排行榜
    // 加载分享排名
    async loadShareRanking() {
        try {
            // 获取用户分享统计（包含排名）
            const response = await fetch('/api/user/share-stats', {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('获取排名失败');
            }
            
            const data = await response.json();
            const rankingEl = document.getElementById('share-ranking');
            
            if (rankingEl) {
                if (data.rank && data.rank > 0) {
                    // 显示排名
                    if (data.rank === 1) {
                        rankingEl.textContent = '🥇 第1名';
                    } else if (data.rank === 2) {
                        rankingEl.textContent = '🥈 第2名';
                    } else if (data.rank === 3) {
                        rankingEl.textContent = '🥉 第3名';
                    } else {
                        rankingEl.textContent = `第${data.rank}名`;
                    }
                } else {
                    rankingEl.textContent = '未上榜';
                }
            }
        } catch (error) {
            console.error('加载分享排名失败:', error);
            const rankingEl = document.getElementById('share-ranking');
            if (rankingEl) {
                rankingEl.textContent = '-';
            }
        }
    },

    // ==================== 书单管理功能 ====================

    // 加载书单页面
    async loadBookLists() {
        if (!this.currentUser) {
            this.showToast("请先登录", "warning");
            return;
        }

        // 默认加载我的书单
        this.switchBookListTab("my-lists");
    },

    // 切换书单标签页
    switchBookListTab(tabName) {
        // 更新标签页按钮状态
        document.querySelectorAll(".list-tab").forEach(tab => {
            tab.classList.toggle("active", tab.dataset.tab === tabName);
        });

        // 更新内容显示
        document.querySelectorAll(".list-tab-content").forEach(content => {
            content.classList.toggle("active", content.id === `tab-${tabName}`);
        });

        // 加载对应数据
        switch (tabName) {
            case "my-lists":
                this.loadMyLists();
                break;
            case "square":
                this.loadSquareLists();
                break;
            case "collected":
                this.loadCollectedLists();
                break;
            case "reviews":
                this.loadReviews();
                break;
        }
    },

    // 加载我的书单
    async loadMyLists() {
        const container = document.getElementById("my-lists-grid");
        container.innerHTML = '<p class="empty-message">加载中...</p>';

        try {
            const lists = await API.bookLists.getMyLists();

            if (lists.length === 0) {
                container.innerHTML = '<p class="empty-message">还没有创建书单，点击上方按钮创建一个吧</p>';
                return;
            }

            container.innerHTML = lists.map(list => this.renderBookListCard(list, true)).join('');
        } catch (error) {
            console.error("加载书单失败:", error);
            container.innerHTML = '<p class="empty-message error-message">加载失败，请刷新页面重试</p>';
        }
    },

    // 加载书单广场
    async loadSquareLists(sortBy = 'hot') {
        const container = document.getElementById("square-lists-grid");
        container.innerHTML = '<p class="empty-message">加载中...</p>';

        try {
            const lists = await API.bookLists.getSquare(1, 20, sortBy);

            if (lists.length === 0) {
                container.innerHTML = '<p class="empty-message">暂无公开书单</p>';
                return;
            }

            container.innerHTML = lists.map(list => this.renderBookListCard(list, false)).join('');
        } catch (error) {
            console.error("加载书单广场失败:", error);
            container.innerHTML = '<p class="empty-message error-message">加载失败</p>';
        }
    },

    // 加载收藏的书单
    async loadCollectedLists() {
        const container = document.getElementById("collected-lists-grid");
        container.innerHTML = '<p class="empty-message">加载中...</p>';

        try {
            const lists = await API.bookLists.getCollected();

            if (lists.length === 0) {
                container.innerHTML = '<p class="empty-message">还没有收藏书单，去书单广场看看吧</p>';
                return;
            }

            container.innerHTML = lists.map(list => this.renderBookListCard(list, false)).join('');
        } catch (error) {
            console.error("加载收藏书单失败:", error);
            container.innerHTML = '<p class="empty-message error-message">加载失败</p>';
        }
    },

    // ==================== 书评功能 ====================

    reviewsSort: 'latest',

    // 加载书评列表
    async loadReviews(sort = this.reviewsSort) {
        this.reviewsSort = sort;
        const container = document.getElementById("reviews-list");
        container.innerHTML = '<p class="empty-message">加载中...</p>';

        // 更新排序按钮状态
        document.querySelectorAll('.reviews-sort-tabs .sort-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.sort === sort);
        });

        try {
            const response = await fetch(`/api/reviews?sort=${sort}`);
            const data = await response.json();

            if (!data.reviews || data.reviews.length === 0) {
                container.innerHTML = '<p class="empty-message">还没有书评，来写第一篇吧！</p>';
                return;
            }

            container.innerHTML = data.reviews.map(review => this.renderReviewCard(review)).join('');
        } catch (error) {
            console.error("加载书评失败:", error);
            container.innerHTML = '<p class="empty-message error-message">加载失败，请重试</p>';
        }
    },

    // 渲染书评卡片
    renderReviewCard(review) {
        const cover = review.book_cover || this.defaultCover;
        const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
        const avatar = review.avatar || review.username?.charAt(0) || '📖';
        const avatarStyle = review.avatar ? `background-image: url('${review.avatar}')` : '';
        const likeClass = review.hasLiked ? 'liked' : '';
        const timeAgo = this.formatTimeAgo(review.created_at);
        
        return `
            <div class="review-card">
                <div class="review-book-info">
                    <img class="review-book-cover" src="${cover}" alt="${this.escapeHtml(review.book_title)}" onerror="this.src='${this.defaultCover}'">
                    <div class="review-book-meta">
                        <h4 class="review-book-title">${this.escapeHtml(review.book_title || '未知书名')}</h4>
                        <p class="review-book-author">作者：${this.escapeHtml(review.book_author || '未知')}</p>
                        <div class="review-rating">
                            <span class="stars">${stars}</span>
                            <span class="rating-text">${review.rating}分</span>
                        </div>
                    </div>
                </div>
                <div class="review-content">
                    <p>${this.escapeHtml(review.content)}</p>
                </div>
                <div class="review-footer">
                    <div class="review-user">
                        <span class="review-avatar" style="${avatarStyle}">${!review.avatar ? avatar : ''}</span>
                        <span class="review-username">${this.escapeHtml(review.username || '匿名用户')}</span>
                        <span class="review-time">${timeAgo}</span>
                    </div>
                    <div class="review-actions">
                        <button class="btn-like ${likeClass}" onclick="App.toggleReviewLike(${review.id}, this)">
                            <span class="like-icon">❤️</span>
                            <span class="like-count">${review.likes || 0}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    // 点赞/取消点赞书评
    async toggleReviewLike(reviewId, btn) {
        if (!this.currentUser) {
            this.showToast("请先登录", "warning");
            return;
        }

        try {
            const response = await fetch(`/api/reviews/${reviewId}/like`, {
                method: 'POST',
                credentials: 'include'
            });
            const data = await response.json();

            if (data.success) {
                const countEl = btn.querySelector('.like-count');
                const currentCount = parseInt(countEl.textContent) || 0;
                countEl.textContent = data.liked ? currentCount + 1 : currentCount - 1;
                btn.classList.toggle('liked', data.liked);
            } else {
                this.showToast(data.error || '操作失败', 'error');
            }
        } catch (error) {
            this.showToast('操作失败', 'error');
        }
    },

    // 显示写书评弹窗
    async showWriteReviewModal() {
        if (!this.currentUser) {
            this.showToast("请先登录", "warning");
            return;
        }
        
        // 重置表单
        document.getElementById('review-book-id').value = '';
        document.getElementById('selected-book-info').style.display = 'none';
        document.getElementById('review-rating-value').value = '0';
        document.getElementById('review-content').value = '';
        document.getElementById('review-error').textContent = '';
        
        // 重置星级
        document.querySelectorAll('#review-rating .star').forEach(s => {
            s.textContent = '☆';
            s.classList.remove('active');
        });
        
        // 加载书架书籍到下拉框
        const select = document.getElementById('review-book-select');
        select.innerHTML = '<option value="">加载中...</option>';
        
        try {
            const response = await fetch('/api/bookshelf', { credentials: 'include' });
            if (response.ok) {
                const books = await response.json();
                if (books.length === 0) {
                    select.innerHTML = '<option value="">书架为空，请先添加书籍到书架</option>';
                } else {
                    select.innerHTML = '<option value="">请选择书籍...</option>' + 
                        books.map(book => `<option value="${book.book_id}" data-title="${this.escapeHtml(book.title)}" data-cover="${book.cover || ''}" data-author="${this.escapeHtml(book.author || '')}">${this.escapeHtml(book.title)} - ${this.escapeHtml(book.author || '未知作者')}</option>`).join('');
                }
            } else {
                select.innerHTML = '<option value="">加载失败，请重试</option>';
            }
        } catch (error) {
            select.innerHTML = '<option value="">加载失败，请重试</option>';
        }
        
        this.showModal('review-modal');
    },

    // 选择书架书籍
    onBookSelectChange() {
        const select = document.getElementById('review-book-select');
        const selectedOption = select.options[select.selectedIndex];
        
        if (selectedOption && selectedOption.value) {
            const bookId = selectedOption.value;
            const title = selectedOption.dataset.title || '';
            const cover = selectedOption.dataset.cover || '';
            const author = selectedOption.dataset.author || '';
            
            document.getElementById('review-book-id').value = bookId;
            
            const selectedInfo = document.getElementById('selected-book-info');
            selectedInfo.innerHTML = `
                <div class="selected-book-card">
                    <img src="${cover || this.defaultCover}" alt="">
                    <div>
                        <strong>${this.escapeHtml(title)}</strong>
                        <span>${this.escapeHtml(author || '未知作者')}</span>
                    </div>
                </div>
            `;
            selectedInfo.style.display = 'block';
            selectedInfo.dataset.cover = cover;
            selectedInfo.dataset.author = author;
            selectedInfo.dataset.title = title;
        } else {
            document.getElementById('review-book-id').value = '';
            document.getElementById('selected-book-info').style.display = 'none';
        }
    },

    // 设置评分
    setReviewRating(rating) {
        document.getElementById('review-rating-value').value = rating;
        document.querySelectorAll('#review-rating .star').forEach((star, index) => {
            if (index < rating) {
                star.textContent = '★';
                star.classList.add('active');
            } else {
                star.textContent = '☆';
                star.classList.remove('active');
            }
        });
    },

    // 提交书评
    async submitReview(e) {
        e.preventDefault();
        
        const bookId = document.getElementById('review-book-id').value;
        const rating = parseInt(document.getElementById('review-rating-value').value);
        const content = document.getElementById('review-content').value.trim();
        const errorEl = document.getElementById('review-error');
        const selectedInfo = document.getElementById('selected-book-info');
        
        if (!bookId) {
            errorEl.textContent = '请选择要评论的书籍';
            return;
        }
        
        if (rating < 1) {
            errorEl.textContent = '请给书籍评分';
            return;
        }
        
        if (!content || content.length < 10) {
            errorEl.textContent = '评语至少10个字';
            return;
        }
        
        try {
            const response = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    bookId,
                    bookTitle: selectedInfo.dataset.title || '',
                    bookCover: selectedInfo.dataset.cover || '',
                    bookAuthor: selectedInfo.dataset.author || '',
                    rating,
                    content
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.showToast('书评发表成功', 'success');
                this.hideModal('review-modal');
                this.loadReviews();
            } else {
                errorEl.textContent = data.error || '发表失败';
            }
        } catch (error) {
            errorEl.textContent = '发表失败，请重试';
        }
    },

    // 格式化时间
    formatTimeAgo(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        
        if (diff < 60) return '刚刚';
        if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
        if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
        if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
        if (diff < 31536000) return Math.floor(diff / 2592000) + '个月前';
        return Math.floor(diff / 31536000) + '年前';
    },

    // 搜索书单
    async searchBookLists() {
        const keyword = document.getElementById("list-search-input").value.trim();
        if (!keyword) {
            this.loadSquareLists();
            return;
        }

        const container = document.getElementById("square-lists-grid");
        container.innerHTML = '<p class="empty-message">搜索中...</p>';

        try {
            const lists = await API.bookLists.search(keyword);

            if (lists.length === 0) {
                container.innerHTML = `<p class="empty-message">没有找到匹配的书单："${keyword}"</p>`;
                return;
            }

            container.innerHTML = lists.map(list => this.renderBookListCard(list, false)).join('');
        } catch (error) {
            console.error("搜索书单失败:", error);
            container.innerHTML = '<p class="empty-message error-message">搜索失败</p>';
        }
    },

    // 渲染书单卡片
    renderBookListCard(list, isOwner) {
        const cover = list.cover || this.defaultCover;
        const creatorName = list.creator_name || '匿名';
        
        return `
            <div class="book-list-card" onclick="App.viewBookList(${list.id})">
                <div class="list-cover" style="background-image: url('${cover}')">
                    <div class="list-count">📚 ${list.book_count || 0}本</div>
                </div>
                <div class="list-info">
                    <h4 class="list-name">${this.escapeHtml(list.name)}</h4>
                    <p class="list-desc">${this.escapeHtml(list.description || '暂无简介')}</p>
                    <div class="list-meta">
                        <span class="list-creator">👤 ${this.escapeHtml(creatorName)}</span>
                        <span class="list-stats">
                            👁 ${list.view_count || 0}
                            ⭐ ${list.collect_count || 0}
                        </span>
                    </div>
                    ${isOwner ? `
                        <div class="list-actions" onclick="event.stopPropagation()">
                            <button class="btn btn-sm btn-outline" onclick="App.editBookList(${list.id})">✏️ 编辑</button>
                            <button class="btn btn-sm btn-outline" onclick="App.deleteBookList(${list.id})">🗑️ 删除</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    // 显示创建书单弹窗
    showCreateListModal() {
        document.getElementById("list-modal-title").textContent = "📝 创建书单";
        document.getElementById("edit-list-id").value = "";
        document.getElementById("list-name").value = "";
        document.getElementById("list-description").value = "";
        document.getElementById("list-cover").value = "";
        document.getElementById("list-is-public").checked = true;
        document.getElementById("list-form-error").textContent = "";
        
        this.showModal("book-list-modal");
    },

    // 编辑书单
    async editBookList(listId) {
        try {
            const list = await API.bookLists.getById(listId);
            
            document.getElementById("list-modal-title").textContent = "✏️ 编辑书单";
            document.getElementById("edit-list-id").value = listId;
            document.getElementById("list-name").value = list.name;
            document.getElementById("list-description").value = list.description || "";
            document.getElementById("list-cover").value = list.cover || "";
            document.getElementById("list-is-public").checked = list.is_public === 1;
            document.getElementById("list-form-error").textContent = "";
            
            this.showModal("book-list-modal");
        } catch (error) {
            this.showToast("加载书单信息失败", "error");
        }
    },

    // 保存书单
    async saveBookList() {
        const listId = document.getElementById("edit-list-id").value;
        const name = document.getElementById("list-name").value.trim();
        const description = document.getElementById("list-description").value.trim();
        const cover = document.getElementById("list-cover").value.trim();
        const isPublic = document.getElementById("list-is-public").checked;
        const errorEl = document.getElementById("list-form-error");

        if (!name) {
            errorEl.textContent = "书单名称不能为空";
            return;
        }

        try {
            if (listId) {
                // 更新书单
                await API.bookLists.update(listId, name, description, cover, isPublic);
                this.showToast("书单更新成功", "success");
            } else {
                // 创建书单
                await API.bookLists.create(name, description, cover, isPublic);
                this.showToast("书单创建成功", "success");
            }

            this.hideModal("book-list-modal");
            this.loadMyLists(); // 刷新列表
        } catch (error) {
            errorEl.textContent = error.message;
        }
    },

    // 删除书单
    async deleteBookList(listId) {
        if (!confirm("确定要删除这个书单吗？")) {
            return;
        }

        try {
            await API.bookLists.delete(listId);
            this.showToast("书单已删除", "success");
            this.loadMyLists(); // 刷新列表
        } catch (error) {
            this.showToast("删除失败：" + error.message, "error");
        }
    },

    // 查看书单详情
    async viewBookList(listId) {
        try {
            const list = await API.bookLists.getById(listId);
            const books = list.books || [];
            
            // 获取评分统计
            let ratingStats = {};
            try {
                ratingStats = await API.bookLists.getRatingStats(listId);
            } catch (error) {
                console.log("获取评分统计失败:", error.message);
            }
            
            const detailHtml = `
                <div class="list-detail-header">
                    <h3>${this.escapeHtml(list.name)}</h3>
                    <p>${this.escapeHtml(list.description || '暂无简介')}</p>
                    <div class="list-meta">
                        <span>👤 ${this.escapeHtml(list.creator_name || '匿名')}</span>
                        <span>📚 ${list.book_count || 0}本</span>
                        <span>👁 ${list.view_count || 0}</span>
                        <span>⭐ ${list.collect_count || 0}</span>
                        ${ratingStats.averageRating ? `
                            <span>⭐ ${ratingStats.averageRating}分 (${ratingStats.commentCount || 0}评)</span>
                        ` : ''}
                    </div>
                    ${list.user_id !== this.currentUser?.id ? `
                        <button class="btn btn-primary" onclick="App.toggleCollectList(${listId}, ${list.isCollected})">
                            ${list.isCollected ? '⭐ 已收藏' : '☆ 收藏书单'}
                        </button>
                    ` : ''}
                </div>
                <div class="list-detail-books">
                    <h4 style="margin: 16px 0 12px">书籍列表</h4>
                    ${books.length > 0 ? books.map(book => `
                        <div class="book-item" onclick="window.location.href='/book-detail.html?id=${book.book_id}'">
                            <img src="${book.cover || this.defaultCover}" alt="${book.title}" class="book-cover-sm" />
                            <div class="book-info-sm">
                                <div class="book-title-sm">${this.escapeHtml(book.title)}</div>
                                <div class="book-author-sm">${this.escapeHtml(book.author || '未知')}</div>
                                ${book.note ? `<div class="book-note">📝 ${this.escapeHtml(book.note)}</div>` : ''}
                            </div>
                        </div>
                    `).join('') : '<p class="empty-message">书单还没有书籍</p>'}
                </div>
                
                <!-- 评论区域 -->
                <div class="list-comments-section">
                    <h4 style="margin: 24px 0 16px">评论与评分</h4>
                    ${this.currentUser ? `
                        <div class="comment-form">
                            <div class="rating-input">
                                <label>评分：</label>
                                <div class="stars">
                                    <span class="star" data-rating="1">⭐</span>
                                    <span class="star" data-rating="2">⭐</span>
                                    <span class="star" data-rating="3">⭐</span>
                                    <span class="star" data-rating="4">⭐</span>
                                    <span class="star" data-rating="5">⭐</span>
                                </div>
                                <span class="rating-value">未评分</span>
                            </div>
                            <textarea id="comment-content" class="md-textarea" rows="3" placeholder="分享你的想法..." style="width: 100%; margin: 12px 0;"></textarea>
                            <button class="btn btn-primary" onclick="App.submitBookListComment(${listId})">发布评论</button>
                        </div>
                    ` : '<p class="empty-message">请登录后发表评论</p>'}
                    
                    <div id="comments-list" class="comments-list">
                        <p class="empty-message">加载评论中...</p>
                    </div>
                </div>
            `;
            
            document.getElementById("list-detail-body").innerHTML = detailHtml;
            
            // 加载评论
            await this.loadBookListComments(listId);
            
            // 绑定评分事件
            if (this.currentUser) {
                this.bindRatingEvents();
            }
            
            this.showModal("book-list-detail-modal");
        } catch (error) {
            this.showToast("加载书单详情失败", "error");
        }
    },

    // 绑定评分事件
    bindRatingEvents() {
        const stars = document.querySelectorAll('.star');
        const ratingValue = document.querySelector('.rating-value');
        let selectedRating = null;
        
        stars.forEach(star => {
            star.addEventListener('click', () => {
                selectedRating = parseInt(star.dataset.rating);
                
                // 更新星星显示
                stars.forEach((s, index) => {
                    s.style.color = index < selectedRating ? '#FFD700' : '#ccc';
                });
                
                ratingValue.textContent = `${selectedRating}分`;
            });
            
            star.addEventListener('mouseover', () => {
                const rating = parseInt(star.dataset.rating);
                stars.forEach((s, index) => {
                    s.style.color = index < rating ? '#FFD700' : '#ccc';
                });
            });
            
            star.addEventListener('mouseout', () => {
                // 恢复到选中的评分
                stars.forEach((s, index) => {
                    s.style.color = selectedRating && index < selectedRating ? '#FFD700' : '#ccc';
                });
            });
        });
    },

    // 提交书单评论
    async submitBookListComment(listId) {
        const content = document.getElementById('comment-content').value.trim();
        const ratingValue = document.querySelector('.rating-value').textContent;
        let rating = null;
        
        if (ratingValue !== '未评分') {
            rating = parseInt(ratingValue);
        }
        
        if (!content) {
            this.showToast('请输入评论内容', 'error');
            return;
        }
        
        try {
            await API.bookLists.addComment(listId, content, rating);
            this.showToast('评论发布成功', 'success');
            
            // 清空表单
            document.getElementById('comment-content').value = '';
            document.querySelector('.rating-value').textContent = '未评分';
            document.querySelectorAll('.star').forEach(s => s.style.color = '#ccc');
            
            // 重新加载评论
            await this.loadBookListComments(listId);
            
            // 重新加载评分统计
            this.updateListRatingStats(listId);
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    },

    // 加载书单评论
    async loadBookListComments(listId) {
        try {
            const comments = await API.bookLists.getComments(listId);
            const commentsList = document.getElementById('comments-list');
            
            if (comments.length === 0) {
                commentsList.innerHTML = '<p class="empty-message">暂无评论，快来发表第一条评论吧</p>';
                return;
            }
            
            const commentsHtml = comments.map(comment => `
                <div class="comment-item">
                    <div class="comment-header">
                        <div class="comment-user">👤 ${this.escapeHtml(comment.user_name)}</div>
                        <div class="comment-time">${this.formatTime(comment.created_at)}</div>
                        ${comment.rating ? `
                            <div class="comment-rating">
                                ${'⭐'.repeat(comment.rating)}${'☆'.repeat(5 - comment.rating)} (${comment.rating}分)
                            </div>
                        ` : ''}
                    </div>
                    <div class="comment-content">${this.escapeHtml(comment.content)}</div>
                </div>
            `).join('');
            
            commentsList.innerHTML = commentsHtml;
        } catch (error) {
            console.error('加载评论失败:', error);
            document.getElementById('comments-list').innerHTML = '<p class="empty-message error-message">加载评论失败</p>';
        }
    },

    // 更新书单评分统计
    async updateListRatingStats(listId) {
        try {
            const ratingStats = await API.bookLists.getRatingStats(listId);
            const metaDivs = document.querySelectorAll('.list-meta span');
            
            // 查找评分相关的span并更新
            for (let div of metaDivs) {
                if (div.textContent.includes('⭐') && div.textContent.includes('分')) {
                    div.textContent = `⭐ ${ratingStats.averageRating || 0}分 (${ratingStats.commentCount || 0}评)`;
                    break;
                }
            }
        } catch (error) {
            console.error('更新评分统计失败:', error);
        }
    },

    // 收藏/取消收藏书单
    async toggleCollectList(listId, isCollected) {
        try {
            if (isCollected) {
                await API.bookLists.uncollect(listId);
                this.showToast("已取消收藏", "success");
            } else {
                await API.bookLists.collect(listId);
                this.showToast("收藏成功", "success");
            }
            // 重新加载详情
            this.hideModal("book-list-detail-modal");
            setTimeout(() => this.viewBookList(listId), 300);
        } catch (error) {
            this.showToast(error.message, "error");
        }
    }

};

// 导出到全局
window.app = App;
window.App = App;

// 初始化应用
document.addEventListener("DOMContentLoaded", () => {
    App.init();
});
