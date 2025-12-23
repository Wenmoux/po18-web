/**
 * 书籍详情页 JavaScript
 */

const BookDetail = {
    bookId: null,
    bookData: null,
    chapters: [],
    comments: [],
    currentChapterIndex: 0,
    currentCommentPage: 1,
    totalCommentPages: 1,
    isSubscribed: false,

    // 初始化
    async init() {
        // 从 URL 获取书籍 ID（兼容 id 和 bookId 两种参数名）
        const params = new URLSearchParams(window.location.search);
        this.bookId = params.get("id") || params.get("bookId");

        if (!this.bookId) {
            this.showToast("缺少书籍ID", "error");
            setTimeout(() => (window.location.href = "index.html"), 2000);
            return;
        }

        // 绑定事件
        this.bindEvents();

        // 加载数据
        await this.loadBookData();
        await this.loadChapters();
        await this.loadComments(1);
    },

    // 绑定事件
    bindEvents() {
        // 标签页切换
        document.querySelectorAll(".tab-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });

        // 开始阅读
        document.getElementById("btn-read")?.addEventListener("click", () => {
            this.startReading();
        });

        // 加入书架
        document.getElementById("btn-add-bookshelf")?.addEventListener("click", () => {
            this.toggleBookshelf();
        });

        // 跳转原站（根据站点字段跳转）
        document.getElementById("btn-po18-link")?.addEventListener("click", () => {
            const platform = this.bookData?.platform || 'po18';
            const baseUrl = platform === 'popo' ? 'https://www.popo.tw' : 'https://www.po18.tw';
            window.open(`${baseUrl}/books/${this.bookId}`, "_blank");
        });

        // 章节列表
        document.getElementById("btn-chapters")?.addEventListener("click", () => {
            this.switchTab("chapters");
        });

        // 下载书籍
        document.getElementById("btn-download")?.addEventListener("click", () => {
            this.showDownloadModal();
        });

        // 章节倒序
        document.getElementById("reverse-chapters")?.addEventListener("change", (e) => {
            this.renderChapters(e.target.checked);
        });

        // 阅读器控制
        document.getElementById("reader-close")?.addEventListener("click", () => {
            this.closeReader();
        });

        document.getElementById("btn-prev-chapter")?.addEventListener("click", () => {
            this.prevChapter();
        });

        document.getElementById("btn-next-chapter")?.addEventListener("click", () => {
            this.nextChapter();
        });

        document.getElementById("btn-reader-prev")?.addEventListener("click", () => {
            this.prevChapter();
        });

        document.getElementById("btn-reader-next")?.addEventListener("click", () => {
            this.nextChapter();
        });

        // 下载弹窗
        document.getElementById("download-close")?.addEventListener("click", () => {
            this.hideDownloadModal();
        });

        document.getElementById("cancel-download")?.addEventListener("click", () => {
            this.hideDownloadModal();
        });

        document.getElementById("confirm-download")?.addEventListener("click", () => {
            this.startDownload();
        });

        // 预加载按钮
        document.getElementById("btn-preload")?.addEventListener("click", () => {
            this.preloadAllChapters();
        });

        // 订阅更新按钮
        document.getElementById("btn-subscribe")?.addEventListener("click", () => {
            this.toggleSubscription();
        });

        // 阅读器关闭按钮
        document.getElementById("reader-close-btn")?.addEventListener("click", () => {
            document.getElementById("reader-modal").classList.remove("active");
        });

        // 点击遮罩不关闭（注释掉，避免误触）
        // document.querySelectorAll('.modal-overlay').forEach(overlay => {
        //     overlay.addEventListener('click', (e) => {
        //         if (e.target === overlay) {
        //             overlay.classList.remove('active');
        //         }
        //     });
        // });
    },

    // 加载书籍数据
    async loadBookData() {
        try {
            // 优先从数据库获取（不需要登录）
            const response = await fetch(`/api/books/${this.bookId}`, {
                method: "GET",
                credentials: "include"
            });

            if (response.ok) {
                const data = await response.json();
                this.bookData = data;
                this.renderBookInfo();
                return;
            }

            // 如果数据库中没有，且返回 404，尝试使用解析接口
            if (response.status === 404) {
                const errorData = await response.json();
                if (errorData.needParse) {
                    console.log("数据库中没有此书，尝试使用解析接口...");
                    await this.loadBookDataFromParse();
                    return;
                }
            }

            // 其他错误
            throw new Error(`请求失败: ${response.status}`);
        } catch (error) {
            console.error("加载书籍数据失败:", error);
            this.showToast("加载失败: " + error.message, "error");
            // 显示提示信息
            document.getElementById("book-info").innerHTML = `
                <div class="error-message" style="padding: 40px; text-align: center;">
                    <p style="font-size: 18px; color: #666; margin-bottom: 20px;">该书籍信息尚未上传至数据库</p>
                    <p style="color: #999; margin-bottom: 30px;">请使用油猴脚本在原站上传书籍信息，或联系管理员添加</p>
                    <button class="btn btn-primary" onclick="window.location.href='index.html'">返回首页</button>
                </div>
            `;
        }
    },

    // 使用解析接口加载（需要登录）
    async loadBookDataFromParse() {
        try {
            const response = await fetch("/api/parse/book", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ 
                    bookId: this.bookId,
                    platform: this.getPlatformFromBookId()  // 根据 bookId 猜测 platform
                })
            });

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error("需要登录后使用解析功能");
                }
                throw new Error("解析失败");
            }

            const data = await response.json();
            this.bookData = data;
            this.renderBookInfo();
            this.showToast("解析成功", "success");
        } catch (error) {
            console.error("解析失败:", error);
            throw error;
        }
    },

    // 根据 bookId 猜测 platform（简单逻辑，可以根据实际情况调整）
    getPlatformFromBookId() {
        // 这里可以根据 bookId 的特征来判断，暂时返回默认值
        return 'po18';
    },

    // 浏览器端直接加载书籍数据
    async loadBookDataFromBrowser() {
        try {
            const url = `https://www.po18.tw/books/${this.bookId}`;
            const response = await fetch(url, {
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error("需要在PO18网站登录");
            }

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // 解析书籍信息
            this.bookData = {
                title: doc.querySelector(".book-title, h1")?.textContent.trim() || "未知书名",
                author: doc.querySelector(".author-name, .book-author")?.textContent.trim() || "未知作者",
                description: doc.querySelector(".book-description, .book-intro")?.innerHTML || "暂无简介",
                cover: doc.querySelector(".book-cover img, .cover img")?.src || "",
                status: doc.querySelector(".book-status")?.textContent.trim() || "未知",
                chapterCount: parseInt(doc.querySelector(".chapter-count")?.textContent) || 0,
                tags: Array.from(doc.querySelectorAll(".tag")).map((t) => t.textContent.trim())
            };

            this.renderBookInfo();
            this.showToast("从浏览器加载成功", "success");
        } catch (error) {
            console.error("浏览器端加载失败:", error);
            this.showToast("加载失败: " + error.message, "error");
        }
    },

    // 渲染书籍信息
    renderBookInfo() {
        if (!this.bookData) return;

        document.getElementById("book-title").textContent = this.bookData.title || "未知书名";
        document.getElementById("book-author").textContent = this.bookData.author || "未知作者";
        document.getElementById("book-status").textContent = this.bookData.status || "未知";
        document.getElementById("book-chapters").textContent = this.bookData.chapterCount || "-";

        // 缓存章节数（从章节列表计算）
        const cachedCount = this.chapters.filter((c) => c.hasCached).length;
        document.getElementById("book-cached-chapters").textContent = cachedCount || "0";
        document.getElementById("book-words").textContent = this.formatNumber(this.bookData.wordCount || 0);
        document.getElementById("book-free-chapters").textContent = this.bookData.freeChapters || "-";
        document.getElementById("book-paid-chapters").textContent = this.bookData.paidChapters || "-";
        document.getElementById("book-latest-chapter").textContent = this.bookData.latestChapterName || "-";
        document.getElementById("book-latest-date").textContent = this.bookData.latestChapterDate || "-";
        document.getElementById("book-favorites").textContent = this.formatNumber(this.bookData.favoritesCount || 0);
        document.getElementById("book-comments").textContent = this.formatNumber(this.bookData.commentsCount || 0);
        document.getElementById("book-popularity").textContent = this.formatNumber(
            this.bookData.monthlyPopularity || 0
        );

        // 书名显示在阅读器中
        document.getElementById("reader-book-title").textContent = this.bookData.title;

        // 封面
        const cover = document.getElementById("book-cover");
        if (this.bookData.cover) {
            cover.src = this.bookData.cover;
        } else {
            cover.src =
                "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjI4MCIgZmlsbD0iI0ZGRDBEQyIvPjx0ZXh0IHg9IjEwMCIgeT0iMTQwIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNiIgZmlsbD0iI0ZGOEJBNyIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Tm8gQ292ZXI8L3RleHQ+PC9zdmc+";
        }

        // 简介
        const description = this.bookData.description || "暂无简介";
        document.getElementById("book-description").innerHTML = description.replace(/\n/g, "<br>");

        // 标签
        const tagsContainer = document.getElementById("book-tags");
        tagsContainer.innerHTML = "";
        if (this.bookData.tags) {
            const tags =
                typeof this.bookData.tags === "string"
                    ? this.bookData.tags.split(/[,·、]/).filter((t) => t.trim())
                    : this.bookData.tags;

            tags.forEach((tag) => {
                const tagEl = document.createElement("span");
                tagEl.className = "tag";
                tagEl.textContent = tag.trim();
                tagsContainer.appendChild(tagEl);
            });
        }

        // 更新页面标题
        document.title = `${this.bookData.title} - PO18书库`;

        // 检查书架状态
        this.checkBookshelfStatus();

        // 检查订阅状态
        this.checkSubscriptionStatus();
    },

    // 加载章节列表
    async loadChapters(retryCount = 0) {
        const maxRetries = 3;

        try {
            // 先从数据库获取缓存章节
            const response = await fetch("/api/parse/chapters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ bookId: this.bookId, cacheOnly: true }) // 只读缓存
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || "获取章节列表失败");
            }

            const data = await response.json();
            this.chapters = data.chapters || [];

            document.getElementById("total-chapters").textContent = this.chapters.length;
            this.renderChapters(false);

            // 更新缓存章节数
            this.renderBookInfo();

            // 检查订阅更新
            this.checkChapterUpdates();

            // 如果没有缓存章节，提示用户
            if (this.chapters.length === 0) {
                this.showToast("暂无缓存章节，点击预加载获取", "info");
            }
        } catch (error) {
            console.error(`加载章节列表失败 (尝试 ${retryCount + 1}/${maxRetries}):`, error);

            // 如果还有重试次数，则重试
            if (retryCount < maxRetries - 1) {
                this.showToast(`加载失败，正在重试 (${retryCount + 1}/${maxRetries})...`, "warning");
                // 延迟1秒后重试
                await new Promise((resolve) => setTimeout(resolve, 1000));
                return this.loadChapters(retryCount + 1);
            } else {
                // 所有重试都失败
                this.showToast(error.message || "章节列表加载失败，已重试3次", "error");
            }
        }
    },

    // 单章上传至缓存
    async uploadSingleChapter(chapter) {
        try {
            this.showToast(`正在上传《${chapter.title}》...`, "info");

            const response = await fetch("/api/parse/chapter-content", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapter.chapterId
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || "上传失败");
            }

            const data = await response.json();

            if (data.fromCache) {
                this.showToast("该章节已在缓存中", "info");
            } else {
                this.showToast(`《${chapter.title}》上传成功！`, "success");
                // 更新章节状态
                chapter.hasCached = true;
                // 重新渲染章节列表
                this.renderChapters(false);
                // 更新缓存章节数
                this.renderBookInfo();
            }
        } catch (error) {
            console.error("上传章节失败:", error);
            this.showToast(error.message || "上传失败", "error");
        }
    },

    // 渲染章节列表
    renderChapters(reverse = false) {
        const container = document.getElementById("chapters-list");
        container.innerHTML = "";

        const chapters = reverse ? [...this.chapters].reverse() : this.chapters;

        chapters.forEach((chapter, index) => {
            const div = document.createElement("div");
            div.className = "chapter-item";

            // 判断是否锁定（付费且未购买且无缓存）
            const isLocked = chapter.isLocked || false;
            if (isLocked) {
                div.classList.add("locked");
            }

            const titleSpan = document.createElement("span");
            titleSpan.className = "chapter-title";
            titleSpan.textContent = chapter.title || `第${index + 1}章`;

            div.appendChild(titleSpan);

            if (isLocked) {
                const lockIcon = document.createElement("span");
                lockIcon.className = "chapter-lock";
                lockIcon.textContent = "🔒";
                div.appendChild(lockIcon);
            } else if (chapter.hasCached) {
                // 有缓存显示云图标
                const cloudIcon = document.createElement("span");
                cloudIcon.className = "chapter-cloud";
                cloudIcon.textContent = "☁️";
                cloudIcon.title = "已缓存";
                div.appendChild(cloudIcon);
                
                // 添加分享按钮
                const shareIcon = document.createElement("span");
                shareIcon.className = "chapter-share";
                shareIcon.textContent = "📤";
                shareIcon.title = "分享该章节";
                shareIcon.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await this.shareChapter(chapter);
                });
                div.appendChild(shareIcon);
            } else if (chapter.isPurchased || !chapter.isPaid) {
                // 已购买但未缓存，显示上传图标
                const uploadIcon = document.createElement("span");
                uploadIcon.className = "chapter-upload";
                uploadIcon.textContent = "📤";
                uploadIcon.title = "上传该章至缓存";
                uploadIcon.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    await this.uploadSingleChapter(chapter);
                });
                div.appendChild(uploadIcon);
            }

            div.addEventListener("click", () => {
                // 直接尝试读取，后端会优先从缓存读取（跨用户共享）
                this.readChapter(reverse ? this.chapters.length - 1 - index : index);
            });

            container.appendChild(div);
        });
    },

    // 加载评论
    async loadComments(page = 1) {
        try {
            const response = await fetch("/api/parse/comments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ bookId: this.bookId, page })
            });

            if (!response.ok) {
                throw new Error("获取评论失败");
            }

            const data = await response.json();
            this.comments = data.comments || [];
            this.currentCommentPage = data.currentPage || page;
            this.totalCommentPages = data.totalPages || 1;

            this.renderComments();
        } catch (error) {
            console.error("加载评论失败:", error);
            this.comments = [];
            this.renderComments();
        }
    },

    // 渲染评论
    renderComments() {
        const container = document.getElementById("comments-list");

        container.innerHTML = "";

        if (!this.comments || this.comments.length === 0) {
            container.innerHTML =
                '<p style="text-align: center; color: var(--md-on-surface-variant); padding: 40px 0;">暂无评论</p>';
            return;
        }

        // 直接使用后端返回的当前页评论，不需要前端分页
        this.comments.forEach((comment) => {
            const div = document.createElement("div");
            div.className = "comment-item";
            // 使用 author 和 time 字段，并添加安全检查
            const author = comment.author || "匿名用户";
            const time = comment.time || "";
            const content = comment.content || "";

            div.innerHTML = `
                <div class="comment-header">
                    <div class="comment-avatar">${author.charAt(0)}</div>
                    <span class="comment-user">${this.escapeHtml(author)}</span>
                    <span class="comment-date">${this.escapeHtml(time)}</span>
                </div>
                <div class="comment-content">${this.escapeHtml(content)}</div>
            `;
            container.appendChild(div);
        });

        this.renderCommentPagination();
    },

    // 渲染评论分页
    renderCommentPagination() {
        const container = document.getElementById("comments-pagination");
        container.innerHTML = "";

        if (this.totalCommentPages <= 1) return;

        // 上一页
        const prevBtn = document.createElement("button");
        prevBtn.className = "page-btn";
        prevBtn.textContent = "上一页";
        prevBtn.disabled = this.currentCommentPage === 1;
        prevBtn.addEventListener("click", () => {
            if (this.currentCommentPage > 1) {
                this.loadComments(this.currentCommentPage - 1);
            }
        });
        container.appendChild(prevBtn);

        // 页码
        for (let i = 1; i <= this.totalCommentPages; i++) {
            if (
                i === 1 ||
                i === this.totalCommentPages ||
                (i >= this.currentCommentPage - 2 && i <= this.currentCommentPage + 2)
            ) {
                const pageBtn = document.createElement("button");
                pageBtn.className = "page-btn";
                if (i === this.currentCommentPage) {
                    pageBtn.classList.add("active");
                }
                pageBtn.textContent = i;
                pageBtn.addEventListener("click", () => {
                    this.loadComments(i);
                });
                container.appendChild(pageBtn);
            } else if (i === this.currentCommentPage - 3 || i === this.currentCommentPage + 3) {
                const dots = document.createElement("span");
                dots.textContent = "...";
                dots.style.padding = "0 8px";
                container.appendChild(dots);
            }
        }

        // 下一页
        const nextBtn = document.createElement("button");
        nextBtn.className = "page-btn";
        nextBtn.textContent = "下一页";
        nextBtn.disabled = this.currentCommentPage === this.totalCommentPages;
        nextBtn.addEventListener("click", () => {
            if (this.currentCommentPage < this.totalCommentPages) {
                this.loadComments(this.currentCommentPage + 1);
            }
        });
        container.appendChild(nextBtn);
    },

    // 切换标签页
    switchTab(tabName) {
        document.querySelectorAll(".tab-btn").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.tab === tabName);
        });

        document.querySelectorAll(".tab-content").forEach((content) => {
            content.classList.toggle("active", content.id === `tab-${tabName}`);
        });
    },

    // 开始阅读
    startReading() {
        if (this.chapters.length === 0) {
            this.showToast("暂无章节", "warning");
            return;
        }
        // 跳转到新的阅读页面
        window.location.href = `reader.html?bookId=${this.bookId}&chapter=0`;
    },

    // 阅读章节（跳转到新页面）
    async readChapter(index) {
        if (index < 0 || index >= this.chapters.length) return;

        // 跳转到新的阅读页面
        window.location.href = `reader.html?bookId=${this.bookId}&chapter=${index}`;
    },

    // 预加载章节
    async preloadChapter(index) {
        if (index < 0 || index >= this.chapters.length) return;

        const chapter = this.chapters[index];
        if (chapter.isPaid && !chapter.isPurchased) return;

        try {
            await fetch("/api/parse/chapter-content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include", // 添加认证信息
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapter.chapterId
                })
            });
        } catch (error) {
            console.error("预加载失败:", error);
        }
    },

    // 上一章
    prevChapter() {
        if (this.currentChapterIndex > 0) {
            this.readChapter(this.currentChapterIndex - 1);
        } else {
            this.showToast("已经是第一章了", "info");
        }
    },

    // 下一章
    nextChapter() {
        if (this.currentChapterIndex < this.chapters.length - 1) {
            this.readChapter(this.currentChapterIndex + 1);
        } else {
            this.showToast("已经是最后一章了", "info");
        }
    },

    // 关闭阅读器
    closeReader() {
        document.getElementById("reader-modal").classList.remove("active");
    },

    // 显示购买确认
    showPurchaseConfirm(chapter) {
        // TODO: 实现购买接口
        if (confirm(`该章节需要购买，是否前往购买？\n章节：${chapter.title}`)) {
            this.showToast("购买功能开发中...", "info");
            // window.open(`https://www.po18.tw/books/${this.bookId}/articles/${chapter.chapterId}`);
        }
    },

    // 显示下载弹窗
    showDownloadModal() {
        document.getElementById("download-modal").classList.add("active");
    },

    // 隐藏下载弹窗
    hideDownloadModal() {
        document.getElementById("download-modal").classList.remove("active");
    },

    // 开始下载（纯服务器端，不请求PO18站）
    async startDownload() {
        const format = document.querySelector('input[name="download-format"]:checked').value;

        document.getElementById("download-progress").style.display = "block";
        document.getElementById("confirm-download").disabled = true;
        document.getElementById("progress-text").textContent = "准备下载...";

        try {
            // 直接从服务器下载（数据来自本地数据库）
            const downloadUrl = `/api/download/book/${this.bookId}?format=${format}`;

            console.log("📥 开始下载:", downloadUrl);

            // 显示进度
            document.getElementById("progress-fill").style.width = "50%";
            document.getElementById("progress-text").textContent = "服务器生成文件中...";

            // 发起下载请求
            const response = await fetch(downloadUrl, {
                method: "GET",
                credentials: "include"
            });

            console.log("📥 响应状态:", response.status, response.statusText);
            console.log("📥 Content-Type:", response.headers.get("Content-Type"));
            console.log("📥 Content-Disposition:", response.headers.get("Content-Disposition"));

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: "下载失败" }));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            // 检查响应类型
            const contentType = response.headers.get("Content-Type");
            if (contentType && contentType.includes("text/html")) {
                throw new Error("服务器返回了HTML页面而不是文件，请检查登录状态");
            }

            // 获取文件名
            const contentDisposition = response.headers.get("Content-Disposition");
            let fileName = `book_${this.bookId}.${format}`;
            if (contentDisposition) {
                const match = contentDisposition.match(/filename\*=UTF-8''(.+)/);
                if (match) {
                    fileName = decodeURIComponent(match[1]);
                }
            }

            console.log("📥 文件名:", fileName);

            // 获取文件内容
            document.getElementById("progress-fill").style.width = "80%";
            document.getElementById("progress-text").textContent = "下载文件中...";

            const blob = await response.blob();

            console.log("📥 Blob大小:", blob.size, "bytes, 类型:", blob.type);

            // 完成
            document.getElementById("progress-fill").style.width = "100%";
            document.getElementById("progress-text").textContent = "下载完成！";

            // 触发浏览器下载
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = fileName;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            this.showToast("下载完成！", "success");

            // 重置UI
            setTimeout(() => {
                this.hideDownloadModal();
                document.getElementById("download-progress").style.display = "none";
                document.getElementById("confirm-download").disabled = false;
                document.getElementById("progress-fill").style.width = "0%";
            }, 1000);
        } catch (error) {
            console.error("❌ 下载失败:", error);
            this.showToast("下载失败: " + error.message, "error");
            document.getElementById("download-progress").style.display = "none";
            document.getElementById("confirm-download").disabled = false;
            document.getElementById("progress-fill").style.width = "0%";
        }
    },

    // 格式化数字
    formatNumber(num) {
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + "万";
        }
        return num.toString();
    },

    // HTML转义，防止XSS
    escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    },

    // 预加载所有章节（实时进度）
    async preloadAllChapters() {
        const btn = document.getElementById("btn-preload");
        const progressEl = document.getElementById("preload-progress");
        const fillEl = document.getElementById("preload-fill");
        const textEl = document.getElementById("preload-text");

        try {
            // 首先从网站获取最新章节列表
            this.showToast("正在获取章节列表...", "info");
            const listResponse = await fetch("/api/parse/chapters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ bookId: this.bookId, cacheOnly: false }) // 从网站获取
            });

            if (!listResponse.ok) {
                const errorData = await listResponse.json().catch(() => ({}));
                this.showToast(errorData.error || "获取章节列表失败", "error");
                return;
            }

            const listData = await listResponse.json();
            const chapters = listData.chapters || [];

            if (chapters.length === 0) {
                this.showToast("没有可预加载的章节", "info");
                return;
            }

            // 更新章节列表
            this.chapters = chapters;
            document.getElementById("total-chapters").textContent = this.chapters.length;
            this.renderChapters(false);

            // 只预加载已购买章节
            const purchasedChapters = chapters.filter((c) => !c.isPaid || c.isPurchased);

            if (purchasedChapters.length === 0) {
                this.showToast("没有已购买的章节", "info");
                return;
            }

            // 显示进度条
            progressEl.style.display = "block";
            btn.disabled = true;

            let completed = 0;
            let successCount = 0;
            const failedChapters = []; // 记录失败的章节

            // 串行下载并更新进度
            for (const chapter of purchasedChapters) {
                try {
                    // 下载章节（后端会优先从缓存读取，支持跨用户共享）
                    const response = await fetch("/api/parse/chapter-content", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ bookId: this.bookId, chapterId: chapter.chapterId })
                    });

                    // Cookie失效时停止预加载
                    if (response.status === 401 || response.status === 400) {
                        const errorData = await response.json().catch(() => ({}));
                        this.showToast(errorData.error || "Cookie已过期，请重新设置", "error");
                        progressEl.style.display = "none";
                        btn.disabled = false;
                        return;
                    }

                    // 成功或未购买（500错误）都继续
                    if (response.ok) {
                        const data = await response.json();
                        if (data.fromCache) {
                            console.log(`章节从缓存读取: ${chapter.chapterId}`);
                        } else {
                            console.log(`章节已下载: ${chapter.chapterId}`);
                        }
                        successCount++;
                    } else {
                        // 记录失败的章节
                        failedChapters.push({
                            chapter,
                            error: `HTTP ${response.status}`
                        });
                    }
                } catch (err) {
                    console.error(`下载章节失败: ${chapter.chapterId}`, err);
                    failedChapters.push({
                        chapter,
                        error: err.message || "网络错误"
                    });
                }

                completed++;
                const percent = ((completed / purchasedChapters.length) * 100).toFixed(0);
                fillEl.style.width = percent + "%";
                textEl.textContent = `${completed}/${purchasedChapters.length}`;

                // 限速
                await new Promise((resolve) => setTimeout(resolve, 300));
            }

            // 显示结果
            const failCount = failedChapters.length;
            this.showToast(
                `预加载完成！成功 ${successCount} 个，失败 ${failCount} 个`,
                successCount > 0 ? "success" : "warning"
            );

            // 如果有失败的章节，显示失败列表和重试按钮
            if (failedChapters.length > 0) {
                this.showFailedChapters(failedChapters);
            }

            // 记录章节分享（预加载完成后自动分享）
            if (successCount > 0) {
                // 为每个章节添加缓存状态信息
                const chaptersWithCacheStatus = purchasedChapters.map(chapter => ({
                    ...chapter,
                    hasCached: true  // 预加载成功的章节都有缓存
                }));
                await this.recordPreloadShare(chaptersWithCacheStatus);
            }

            // 2秒后隐藏进度条
            setTimeout(() => {
                progressEl.style.display = "none";
                btn.disabled = false;
            }, 2000);
        } catch (error) {
            console.error("预加载失败:", error);
            this.showToast("预加载失败", "error");
            progressEl.style.display = "none";
            btn.disabled = false;
        }
    },

    // 记录预加载分享
    async recordPreloadShare(chapters) {
        try {
            // 发送批量分享记录请求
            await fetch("/api/share/preload-chapters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapters: chapters
                })
            }).catch(err => {
                console.warn("记录章节分享失败:", err);
            });
            
            // 重新加载分享统计信息
            this.loadShareStats();
        } catch (error) {
            console.warn("记录预加载分享失败:", error);
        }
    },

    // 显示失败章节列表
    showFailedChapters(failedChapters) {
        const container = document.getElementById("failed-chapters-container");
        if (!container) {
            // 创建失败章节容器
            const div = document.createElement("div");
            div.id = "failed-chapters-container";
            div.className = "failed-chapters-panel";
            div.innerHTML = `
                <div class="failed-chapters-header">
                    <h4>❗ 上传失败的章节 (${failedChapters.length})</h4>
                    <button class="btn-close-failed" onclick="document.getElementById('failed-chapters-container').remove()">×</button>
                </div>
                <div class="failed-chapters-list" id="failed-chapters-list"></div>
                <div class="failed-chapters-footer">
                    <button class="btn btn-primary" onclick="BookDetail.retryAllFailed()">重试全部</button>
                    <button class="btn btn-outline" onclick="document.getElementById('failed-chapters-container').remove()">关闭</button>
                </div>
            `;
            document.body.appendChild(div);
        }

        const listEl = document.getElementById("failed-chapters-list");
        listEl.innerHTML = failedChapters
            .map(
                (item, index) => `
            <div class="failed-chapter-item" data-index="${index}">
                <div class="failed-chapter-info">
                    <span class="failed-chapter-title">${item.chapter.title}</span>
                    <span class="failed-chapter-error">${item.error}</span>
                </div>
                <button class="btn btn-sm btn-tonal retry-btn" onclick="BookDetail.retrySingleChapter(${index})">
                    🔄 重试
                </button>
            </div>
        `
            )
            .join("");

        // 保存失败列表以便重试
        this.failedChaptersList = failedChapters;
    },

    // 重试单个章节
    async retrySingleChapter(index) {
        if (!this.failedChaptersList || index >= this.failedChaptersList.length) return;

        const item = this.failedChaptersList[index];
        const btn = document.querySelector(`[data-index="${index}"] .retry-btn`);

        btn.disabled = true;
        btn.textContent = "上传中...";

        try {
            const response = await fetch("/api/parse/chapter-content", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: item.chapter.chapterId
                })
            });

            if (response.ok) {
                this.showToast(`《${item.chapter.title}》重试成功！`, "success");
                // 从失败列表中移除
                this.failedChaptersList.splice(index, 1);
                // 重新渲染失败列表
                if (this.failedChaptersList.length === 0) {
                    document.getElementById("failed-chapters-container")?.remove();
                    this.showToast("所有章节已成功上传！", "success");
                } else {
                    this.showFailedChapters(this.failedChaptersList);
                }
                // 重新加载章节列表以更新缓存状态
                await this.loadChapters();
            } else {
                const errorData = await response.json().catch(() => ({}));
                this.showToast(errorData.error || `《${item.chapter.title}》重试失败`, "error");
                btn.disabled = false;
                btn.innerHTML = "🔄 重试";
            }
        } catch (error) {
            console.error("重试失败:", error);
            this.showToast(error.message || "重试失败", "error");
            btn.disabled = false;
            btn.innerHTML = "🔄 重试";
        }
    },

    // 重试所有失败的章节
    async retryAllFailed() {
        if (!this.failedChaptersList || this.failedChaptersList.length === 0) return;

        const totalCount = this.failedChaptersList.length;
        this.showToast(`开始重试 ${totalCount} 个失败章节...`, "info");

        const stillFailed = [];
        let successCount = 0;

        for (let i = 0; i < this.failedChaptersList.length; i++) {
            const item = this.failedChaptersList[i];

            try {
                const response = await fetch("/api/parse/chapter-content", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        bookId: this.bookId,
                        chapterId: item.chapter.chapterId
                    })
                });

                if (response.ok) {
                    successCount++;
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    stillFailed.push({
                        chapter: item.chapter,
                        error: errorData.error || `HTTP ${response.status}`
                    });
                }
            } catch (error) {
                stillFailed.push({
                    chapter: item.chapter,
                    error: error.message || "网络错误"
                });
            }

            // 限速
            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        this.showToast(
            `重试完成！成功 ${successCount} 个，失败 ${stillFailed.length} 个`,
            successCount > 0 ? "success" : "warning"
        );

        if (stillFailed.length === 0) {
            document.getElementById("failed-chapters-container")?.remove();
            // 重新加载章节列表
            await this.loadChapters();
        } else {
            this.failedChaptersList = stillFailed;
            this.showFailedChapters(stillFailed);
        }
    },

    // 显示提示
    showToast(message, type = "info") {
        const container = document.getElementById("toast-container");
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => toast.classList.add("show"), 100);
        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // 分享章节
    async shareChapter(chapter) {
        try {
            const response = await fetch("/api/share/chapter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapter.id,
                    chapterTitle: chapter.title
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || "分享章节失败");
            }

            const result = await response.json();
            this.showToast("章节分享成功", "success");
            
            // 重新加载分享统计信息
            this.loadShareStats();
        } catch (error) {
            console.error("分享章节失败:", error);
            this.showToast("分享章节失败: " + error.message, "error");
        }
    },

    // 加载分享统计信息
    async loadShareStats() {
        try {
            // 这里可以调用API获取当前用户的分享统计信息
            // 并更新页面上的统计显示
        } catch (error) {
            console.warn("加载分享统计信息失败:", error);
        }
    },

    // 模拟评论数据（用于测试）
    getMockComments() {
        return [
            { username: "用户1", date: "2024-12-14", content: "很好看！" },
            { username: "用户2", date: "2024-12-13", content: "剧情紧凑，人物刻画生动" },
            { username: "用户3", date: "2024-12-12", content: "期待更新" }
        ];
    },

    // 检查书架状态
    async checkBookshelfStatus() {
        try {
            const response = await fetch(`/api/bookshelf/check/${this.bookId}`, {
                credentials: "include"
            });

            if (response.ok) {
                const data = await response.json();
                const btn = document.getElementById("btn-add-bookshelf");
                if (data.inBookshelf) {
                    btn.innerHTML = `
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                        </svg>
                        已在书架
                    `;
                    btn.classList.add("btn-primary");
                    btn.classList.remove("btn-tonal");
                }
            }
        } catch (error) {
            console.error("检查书架状态失败:", error);
        }
    },

    // 切换书架状态
    async toggleBookshelf() {
        try {
            const btn = document.getElementById("btn-add-bookshelf");
            const isInBookshelf = btn.textContent.includes("已在书架");

            if (isInBookshelf) {
                // 从书架移除
                const response = await fetch(`/api/bookshelf/${this.bookId}`, {
                    method: "DELETE",
                    credentials: "include"
                });

                if (!response.ok) throw new Error("移除失败");

                btn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                    </svg>
                    加入书架
                `;
                btn.classList.remove("btn-primary");
                btn.classList.add("btn-tonal");
                this.showToast("已从书架移除", "success");
            } else {
                // 加入书架
                const response = await fetch("/api/bookshelf", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        bookId: this.bookId,
                        title: this.bookData.title,
                        author: this.bookData.author,
                        cover: this.bookData.cover,
                        totalChapters: this.chapters.length
                    })
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.message || "添加失败");
                }

                btn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                    </svg>
                    已在书架
                `;
                btn.classList.add("btn-primary");
                btn.classList.remove("btn-tonal");
                this.showToast("已加入书架", "success");
            }
        } catch (error) {
            console.error("操作失败:", error);
            this.showToast(error.message || "操作失败", "error");
        }
    },

    // 检查订阅状态
    async checkSubscriptionStatus() {
        try {
            const data = await API.subscriptions.getStatus(this.bookId);
            const btn = document.getElementById("btn-subscribe");
            const text = document.getElementById("subscribe-text");

            this.isSubscribed = data.isSubscribed;

            if (data.isSubscribed) {
                btn.style.background = "linear-gradient(135deg, #9c27b0, #7b1fa2)";
                btn.style.color = "white";
                btn.style.borderColor = "#9c27b0";
                text.textContent = "已订阅";
            } else {
                btn.style.background = "transparent";
                btn.style.color = "#9c27b0";
                btn.style.borderColor = "#9c27b0";
                text.textContent = "订阅更新";
            }
        } catch (error) {
            console.log("检查订阅状态失败:", error);
        }
    },

    // 检查并更新章节数（在加载章节后调用）
    async checkChapterUpdates() {
        try {
            if (!this.isSubscribed || this.chapters.length === 0) return;

            const result = await API.subscriptions.updateChapterCount(this.bookId, this.chapters.length);

            if (result.updated && result.newChapters > 0) {
                // 有新章节，显示提醒
                this.showToast(`🎉 有 ${result.newChapters} 章新更新！`, "success");

                // 清除更新标记（因为用户已经看到了）
                await API.subscriptions.clearUpdate(this.bookId);
            }
        } catch (error) {
            console.log("检查章节更新失败:", error);
        }
    },

    // 切换订阅状态
    async toggleSubscription() {
        try {
            const btn = document.getElementById("btn-subscribe");
            const text = document.getElementById("subscribe-text");
            const isSubscribed = text.textContent === "已订阅";

            if (isSubscribed) {
                // 取消订阅
                await API.subscriptions.unsubscribe(this.bookId);
                btn.style.background = "transparent";
                btn.style.color = "#9c27b0";
                btn.style.borderColor = "#9c27b0";
                text.textContent = "订阅更新";
                this.showToast("已取消订阅", "success");
            } else {
                // 订阅
                await API.subscriptions.subscribe(this.bookId, {
                    title: this.bookData?.title || "未知书名",
                    author: this.bookData?.author || "未知作者",
                    cover: this.bookData?.cover || "",
                    chapterCount: this.chapters.length || this.bookData?.chapterCount || 0
                });
                btn.style.background = "linear-gradient(135deg, #9c27b0, #7b1fa2)";
                btn.style.color = "white";
                btn.style.borderColor = "#9c27b0";
                text.textContent = "已订阅";
                this.showToast("订阅成功，更新时会通知你", "success");
            }
        } catch (error) {
            console.error("订阅操作失败:", error);
            this.showToast("操作失败", "error");
        }
    }
};

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", () => {
    BookDetail.init();
});
