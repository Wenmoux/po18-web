/**
 * PO18 在线阅读器
 * 移动端友好的阅读界面
 */

class Reader {
    constructor() {
        this.bookId = null;
        this.bookTitle = "";
        this.chapters = [];
        this.currentChapterIndex = 0;
        this.settings = {
            fontSize: 18,
            lineHeight: 1.8,
            paragraphSpacing: 1.5, // 段落间距（em）
            contentWidth: 800,
            theme: "default",
            font: "system",
            pageMode: "scroll", // scroll/slide/click
            autoScroll: false,
            autoScrollSpeed: 50,
            ttsApiUrl: "", // 自定义TTS API
            titleStyle: "default", // 标题样式
            contentStyle: "default", // 正文样式
            textConvert: "none" // 繁简转换
        };

        // 阅读进度
        this.scrollPosition = {}; // 记录每章滚动位置
        this.autoScrollTimer = null;

        // 书签系统
        this.readingStartTime = Date.now();
        this.lastUpdateTime = Date.now();
        this.readingTimeAccumulated = 0; // 秒
        this.progressUpdateTimer = null; // 定时更新定时器

        // TTS 朗读功能
        this.tts = {
            synth: window.speechSynthesis,
            utterance: null,
            voices: [],
            isPlaying: false,
            isPaused: false,
            currentParagraphIndex: 0,
            paragraphs: [],
            rate: 1.0,
            pitch: 1.0,
            selectedVoice: null,
            autoScroll: true, // 自动滚动跟随
            scrollTimer: null, // 滚动定时器
            currentCharIndex: 0, // 当前字符索引
            highlightElement: null // 高亮元素
        };

        this.init();
    }

    // 初始化
    init() {
        this.loadSettings();
        this.parseUrlParams();
        this.bindEvents();
        this.applySettings();
        this.initTTS();
        this.initReadingProgress(); // 初始化阅读进度

        if (this.bookId) {
            this.loadBook();
            // 启动定时更新书架进度（每30秒）
            this.startProgressUpdate();
        } else {
            this.showToast("缺少书籍信息", "error");
        }
    }

    // 解析URL参数（兼容 bookId 和 id 两种参数名）
    parseUrlParams() {
        const params = new URLSearchParams(window.location.search);
        this.bookId = params.get("bookId") || params.get("id");
        this.currentChapterIndex = parseInt(params.get("chapter") || "0");
    }

    // 加载书籍信息
    async loadBook() {
        try {
            // 获取书籍基本信息
            const bookResponse = await fetch(`/api/book/${this.bookId}`, {
                credentials: "include"
            });

            if (!bookResponse.ok) {
                throw new Error("加载书籍信息失败");
            }

            const bookData = await bookResponse.json();
            this.bookTitle = bookData.title;
            document.getElementById("book-title").textContent = this.bookTitle;
            document.title = `${this.bookTitle} - 阅读`;

            // 加载章节列表
            await this.loadChapters();
        } catch (error) {
            console.error("加载书籍失败:", error);
            this.showToast("加载失败: " + error.message, "error");
        }
    }

    // 加载章节列表
    async loadChapters() {
        try {
            const response = await fetch("/api/parse/chapters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    bookId: this.bookId,
                    cacheOnly: true // 优先读缓存
                })
            });

            if (!response.ok) {
                throw new Error("加载章节列表失败");
            }

            const data = await response.json();
            this.chapters = data.chapters || [];

            if (this.chapters.length === 0) {
                this.showToast("暂无可用章节", "warning");
                return;
            }

            // 渲染目录
            this.renderCatalog();

            // 加载当前章节
            await this.loadChapter(this.currentChapterIndex);
        } catch (error) {
            console.error("加载章节列表失败:", error);
            this.showToast("加载章节失败", "error");
        }
    }

    // 加载章节内容
    async loadChapter(index) {
        if (index < 0 || index >= this.chapters.length) {
            this.showToast("没有更多章节了", "warning");
            return;
        }

        // 保存TTS状态
        const wasTTSPlaying = this.tts.isPlaying && !this.tts.isPaused;
        if (wasTTSPlaying) {
            // 暂时停止TTS
            this.pauseTTS();
        }

        // 保存当前章节滚动位置
        this.saveScrollPosition();

        this.currentChapterIndex = index;
        const chapter = this.chapters[index];

        // 更新书架进度
        this.updateBookshelfProgress();

        // 更新UI
        document.getElementById("chapter-title").textContent = chapter.title || `第${index + 1}章`;
        document.getElementById("chapter-progress").textContent = `${index + 1}/${this.chapters.length}`;
        document.getElementById("chapter-content").innerHTML =
            '<div class="loading-spinner"><div class="spinner"></div><p>加载中...</p></div>';

        // 更新按钮状态
        document.getElementById("btn-prev").disabled = index === 0;
        document.getElementById("btn-next").disabled = index === this.chapters.length - 1;

        // 滚动到顶部（如果没有保存的位置）
        window.scrollTo(0, 0);

        try {
            // 1. 先检查内存缓存
            const cachedData = this.getCachedChapter(chapter.chapterId);
            if (cachedData) {
                this.renderChapterContent(cachedData, wasTTSPlaying);
                this.updateHistory(index);
                this.preloadNextChapter(index);
                return;
            }

            // 2. 尝试从服务器缓存加载
            const response = await fetch("/api/parse/chapter-content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapter.chapterId,
                    cacheOnly: true // 只读缓存
                })
            });

            if (response.ok) {
                const data = await response.json();

                // 缓存命中，直接渲染
                if (data.fromCache) {
                    // 存入内存缓存
                    const cacheKey = `${this.bookId}_${chapter.chapterId}`;
                    this.chapterCache.set(cacheKey, data);

                    this.renderChapterContent(data, wasTTSPlaying);
                    this.updateHistory(index);
                    this.preloadNextChapter(index);
                    return;
                }
            }

            // 3. 缓存未命中，尝试浏览器端解析
            if (chapter.isLocked) {
                document.getElementById("chapter-content").innerHTML =
                    '<div style="text-align: center; padding: 60px 20px; color: #999;">' +
                    '<p style="font-size: 16px; margin-bottom: 12px;">🔒 此章节需要购买</p>' +
                    '<p style="font-size: 14px;">请在PO18网站购买后继续阅读</p>' +
                    "</div>";
                return;
            }

            // 尝试浏览器端直接请求（需要用户已登录PO18）
            await this.loadChapterFromBrowser(chapter, wasTTSPlaying);
        } catch (error) {
            console.error("加载章节内容失败:", error);
            document.getElementById("chapter-content").innerHTML =
                `<p style="text-align:center;color:var(--primary-color);">加载失败: ${error.message}</p>`;
        }
    }

    // 渲染章节内容
    renderChapterContent(data, restoreTTS = false) {
        if (data.html) {
            document.getElementById("chapter-content").innerHTML = data.html;
        } else if (data.text) {
            const paragraphs = data.text.split("\n").filter((p) => p.trim());
            const html = paragraphs.map((p) => `<p>${this.escapeHtml(p)}</p>`).join("");
            document.getElementById("chapter-content").innerHTML =
                html || '<p style="text-align:center;color:#999;">内容为空</p>';
        } else {
            document.getElementById("chapter-content").innerHTML =
                '<p style="text-align:center;color:#999;">内容加载失败</p>';
        }

        // 渲染后恢复滚动位置
        setTimeout(() => {
            this.restoreScrollPosition();
            this.updateReadingProgress();
            
            // 如果需要恢夏TTS
            if (restoreTTS) {
                this.resumeTTSAfterChapterChange();
            }
        }, 100);
    }

    // 浏览器端加载章节（直接请求PO18）
    async loadChapterFromBrowser(chapter, restoreTTS = false) {
        try {
            document.getElementById("chapter-content").innerHTML =
                '<div class="loading-spinner"><div class="spinner"></div><p>从PO18加载中...</p></div>';

            // 直接请求PO18网站（浏览器会自动携带Cookie）
            const url = `https://www.po18.tw/books/${this.bookId}/articlescontent/${chapter.chapterId}`;
            const response = await fetch(url, {
                credentials: "include",
                headers: {
                    "X-Requested-With": "XMLHttpRequest"
                }
            });

            if (!response.ok) {
                throw new Error("需要在PO18网站登录");
            }

            const htmlText = await response.text();

            // 浏览器端解析HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, "text/html");

            // 获取标题
            const titleEl = doc.querySelector("h1");
            const title = titleEl ? titleEl.textContent.trim() : chapter.title;

            // 移除不需要的元素
            doc.querySelectorAll("blockquote, h1").forEach((el) => el.remove());

            // 获取正文
            const bodyEl = doc.querySelector("body");
            const html = bodyEl ? bodyEl.innerHTML : "";
            const text = bodyEl ? bodyEl.textContent.replace(/\s+/g, "\n").trim() : "";

            // 渲染内容
            this.renderChapterContent({ html, text, title }, restoreTTS);

            // 更新历史记录
            this.updateHistory(this.currentChapterIndex);

            // 异步上传到缓存（不阻塞）
            this.uploadChapterToCache(chapter.chapterId, title, html, text);

            // 预加载下一章
            this.preloadNextChapter(this.currentChapterIndex);
        } catch (error) {
            console.error("浏览器端加载失败:", error);

            // 降级到服务器端请求
            document.getElementById("chapter-content").innerHTML =
                '<div class="loading-spinner"><div class="spinner"></div><p>切换到服务器加载...</p></div>';

            const fallbackResponse = await fetch("/api/parse/chapter-content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapter.chapterId,
                    cacheOnly: false // 允许服务器端爬取
                })
            });

            if (!fallbackResponse.ok) {
                const errorData = await fallbackResponse.json().catch(() => ({}));
                throw new Error(errorData.error || "加载失败");
            }

            const data = await fallbackResponse.json();
            this.renderChapterContent(data, restoreTTS);
            this.updateHistory(this.currentChapterIndex);
            this.preloadNextChapter(this.currentChapterIndex);
        }
    }

    // 上传章节到缓存
    async uploadChapterToCache(chapterId, title, html, text) {
        try {
            await fetch("/api/parse/chapter-content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapterId,
                    title: title,
                    html: html,
                    text: text,
                    fromUserScript: true // 标记为浏览器端上传
                })
            });
            console.log(`章节已缓存: ${chapterId}`);
        } catch (error) {
            console.error("上传缓存失败:", error);
        }
    }

    // 更新历史记录
    updateHistory(index) {
        const newUrl = `${window.location.pathname}?bookId=${this.bookId}&chapter=${index}`;
        window.history.pushState({ chapter: index }, "", newUrl);
    }

    // 章节内容缓存（内存缓存，快速切换）
    chapterCache = new Map();
    preloadingChapters = new Set();

    // 预加载前后章节（默认前后各2章）
    preloadNearbyChapters(currentIndex, range = 2) {
        // 预加载后面的章节（优先级更高）
        for (let i = 1; i <= range; i++) {
            const nextIndex = currentIndex + i;
            if (nextIndex < this.chapters.length) {
                this.preloadChapter(nextIndex);
            }
        }

        // 预加载前面的章节
        for (let i = 1; i <= range; i++) {
            const prevIndex = currentIndex - i;
            if (prevIndex >= 0) {
                this.preloadChapter(prevIndex);
            }
        }
    }

    // 预加载下一章（兼容旧代码）
    preloadNextChapter(index) {
        this.preloadNearbyChapters(index, 2);
    }

    // 预加载章节（带缓存）
    async preloadChapter(index) {
        if (index < 0 || index >= this.chapters.length) return;

        const chapter = this.chapters[index];
        if (chapter.isLocked) return;

        // 已缓存或正在加载，跳过
        const cacheKey = `${this.bookId}_${chapter.chapterId}`;
        if (this.chapterCache.has(cacheKey) || this.preloadingChapters.has(cacheKey)) {
            return;
        }

        this.preloadingChapters.add(cacheKey);

        try {
            const response = await fetch("/api/parse/chapter-content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapter.chapterId
                })
            });

            if (response.ok) {
                const data = await response.json();
                // 缓存内容
                this.chapterCache.set(cacheKey, data);

                // 限制缓存大小（最多缓存10章）
                if (this.chapterCache.size > 10) {
                    const firstKey = this.chapterCache.keys().next().value;
                    this.chapterCache.delete(firstKey);
                }
            }
        } catch (error) {
            // 预加载失败不影响主流程
            console.log("预加载失败:", error);
        } finally {
            this.preloadingChapters.delete(cacheKey);
        }
    }

    // 从缓存获取章节内容
    getCachedChapter(chapterId) {
        const cacheKey = `${this.bookId}_${chapterId}`;
        return this.chapterCache.get(cacheKey);
    }

    // 渲染目录
    renderCatalog() {
        const catalogList = document.getElementById("catalog-list");

        if (this.chapters.length === 0) {
            catalogList.innerHTML = '<div class="loading-spinner"><p>暂无章节</p></div>';
            return;
        }

        const html = this.chapters
            .map((chapter, index) => {
                const current = index === this.currentChapterIndex ? "current" : "";
                const locked = chapter.isLocked ? "locked" : "";
                const lockIcon = chapter.isLocked
                    ? '<svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
                    : "";

                return `
                <div class="catalog-item ${current} ${locked}" data-index="${index}">
                    <span class="chapter-number">${index + 1}</span>
                    <span class="chapter-name">${this.escapeHtml(chapter.title || `第${index + 1}章`)}</span>
                    ${lockIcon}
                </div>
            `;
            })
            .join("");

        catalogList.innerHTML = html;

        // 绑定点击事件
        catalogList.querySelectorAll(".catalog-item:not(.locked)").forEach((item) => {
            item.addEventListener("click", () => {
                const index = parseInt(item.dataset.index);
                this.loadChapter(index);
                this.closeCatalog();
            });
        });
    }

    // 绑定事件
    bindEvents() {
        // 返回按钮 - 默认返回上一页
        document.getElementById("btn-back").addEventListener("click", () => {
            if (document.referrer && document.referrer.includes(window.location.host)) {
                window.history.back();
            } else {
                // 如果没有上一页，跳转到书籍详情
                window.location.href = `/book-detail.html?id=${this.bookId}`;
            }
        });

        // 返回菜单按钮
        const backMenuBtn = document.getElementById("btn-back-menu");
        const backMenu = document.getElementById("back-menu");

        backMenuBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            backMenu.classList.toggle("show");
        });

        // 点击其他地方关闭菜单
        document.addEventListener("click", (e) => {
            if (!backMenu.contains(e.target) && !backMenuBtn.contains(e.target)) {
                backMenu.classList.remove("show");
            }
        });

        // 返回菜单项
        document.querySelectorAll(".back-menu-item").forEach((item) => {
            item.addEventListener("click", () => {
                const target = item.dataset.target;
                backMenu.classList.remove("show");

                switch (target) {
                    case "detail":
                        window.location.href = `/book-detail.html?id=${this.bookId}`;
                        break;
                    case "bookshelf":
                        window.location.href = "/#bookshelf";
                        break;
                    case "home":
                        window.location.href = "/";
                        break;
                }
            });
        });

        // 目录按钮
        document.getElementById("btn-catalog").addEventListener("click", () => this.openCatalog());
        document.getElementById("btn-catalog-2").addEventListener("click", () => this.openCatalog());
        document.getElementById("btn-close-catalog").addEventListener("click", () => this.closeCatalog());

        // 设置按钮
        document.getElementById("btn-settings").addEventListener("click", () => this.openSettings());
        document.getElementById("btn-close-settings").addEventListener("click", () => this.closeSettings());

        // 章节导航
        document.getElementById("btn-prev").addEventListener("click", () => this.prevChapter());
        document.getElementById("btn-next").addEventListener("click", () => this.nextChapter());
        document.getElementById("btn-menu").addEventListener("click", () => this.toggleToolbar());

        // 书签
        document.getElementById("btn-bookmark").addEventListener("click", () => {
            this.addBookmark();
        });

        // 日夜切换
        document.getElementById("btn-daynight").addEventListener("click", () => {
            this.toggleDayNight();
        });

        // TTS朗读按钮
        document.getElementById("btn-tts")?.addEventListener("click", () => {
            this.openTTS();
        });

        document.getElementById("btn-close-tts")?.addEventListener("click", () => {
            this.closeTTS();
        });

        // TTS控制
        document.getElementById("tts-play")?.addEventListener("click", () => {
            this.toggleTTSPlay();
        });

        document.getElementById("tts-stop")?.addEventListener("click", () => {
            this.stopTTS();
        });

        // TTS语速/音调调节
        document.getElementById("tts-rate")?.addEventListener("input", (e) => {
            this.tts.rate = parseFloat(e.target.value);
            document.getElementById("tts-rate-value").textContent = this.tts.rate.toFixed(1);
            this.updateSliderBackground(e.target);
        });

        document.getElementById("tts-pitch")?.addEventListener("input", (e) => {
            this.tts.pitch = parseFloat(e.target.value);
            document.getElementById("tts-pitch-value").textContent = this.tts.pitch.toFixed(1);
            this.updateSliderBackground(e.target);
        });

        // TTS语音选择
        document.getElementById("tts-voice")?.addEventListener("change", (e) => {
            const voiceIndex = parseInt(e.target.value);
            this.tts.selectedVoice = this.tts.voices[voiceIndex] || null;
        });

        // 遮罩层
        document.getElementById("overlay").addEventListener("click", () => {
            this.closeCatalog();
            this.closeSettings();
            this.closeTTS();
        });

        // 目录搜索
        document.getElementById("catalog-search").addEventListener("input", (e) => {
            this.searchCatalog(e.target.value);
        });

        // 设置选项
        this.bindSettingEvents();

        // 键盘快捷键
        document.addEventListener("keydown", (e) => {
            if (e.key === "ArrowLeft") this.prevChapter();
            if (e.key === "ArrowRight") this.nextChapter();
            if (e.key === "Escape") {
                this.closeCatalog();
                this.closeSettings();
            }
        });

        // 点击阅读区域切换工具栏
        let clickTimer = null;
        document.getElementById("reader-content").addEventListener("click", (e) => {
            // 避免点击链接时触发
            if (e.target.tagName === "A") return;

            clearTimeout(clickTimer);
            clickTimer = setTimeout(() => {
                if (this.settings.pageMode === "click") {
                    const clickX = e.clientX;
                    const width = window.innerWidth;

                    if (clickX < width / 3) {
                        this.prevChapter();
                    } else if (clickX > (width * 2) / 3) {
                        this.nextChapter();
                    } else {
                        this.toggleToolbar();
                    }
                } else {
                    this.toggleToolbar();
                }
            }, 200);
        });

        // 双击阅读区域切换工具栏
        document.getElementById("reader-content").addEventListener("dblclick", (e) => {
            clearTimeout(clickTimer);
            this.toggleToolbar();
        });

        // 浏览器后退前进
        window.addEventListener("popstate", (e) => {
            if (e.state && typeof e.state.chapter === "number") {
                this.loadChapter(e.state.chapter);
            }
        });
    }

    // 绑定设置事件
    bindSettingEvents() {
        // 字体大小滑块
        const fontSizeSlider = document.getElementById("font-size-slider");
        if (fontSizeSlider) {
            fontSizeSlider.addEventListener("input", (e) => {
                this.settings.fontSize = parseInt(e.target.value);
                document.getElementById("font-size-value").textContent = this.settings.fontSize;
                this.applySettings();
                this.updateSliderBackground(e.target);
            });
            fontSizeSlider.addEventListener("change", () => this.saveSettings());
        }

        // 行间距滑块
        const lineHeightSlider = document.getElementById("line-height-slider");
        if (lineHeightSlider) {
            lineHeightSlider.addEventListener("input", (e) => {
                this.settings.lineHeight = parseFloat(e.target.value);
                document.getElementById("line-height-value").textContent = this.settings.lineHeight.toFixed(1);
                this.applySettings();
                this.updateSliderBackground(e.target);
            });
            lineHeightSlider.addEventListener("change", () => this.saveSettings());
        }

        // 段落间距滑块
        const paragraphSlider = document.getElementById("paragraph-spacing-slider");
        if (paragraphSlider) {
            paragraphSlider.addEventListener("input", (e) => {
                this.settings.paragraphSpacing = parseFloat(e.target.value);
                document.getElementById("paragraph-spacing-value").textContent =
                    this.settings.paragraphSpacing.toFixed(1);
                this.applySettings();
                this.updateSliderBackground(e.target);
            });
            paragraphSlider.addEventListener("change", () => this.saveSettings());
        }
        // 字体大小
        document.querySelectorAll("[data-size]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const size = parseInt(btn.dataset.size);
                this.settings.fontSize = size;
                this.applySettings();
                this.saveSettings();
                this.updateActiveButton(btn, "[data-size]");
            });
        });

        // 行间距
        document.querySelectorAll("[data-line]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const line = parseFloat(btn.dataset.line);
                this.settings.lineHeight = line;
                this.applySettings();
                this.saveSettings();
                this.updateActiveButton(btn, "[data-line]");
            });
        });

        // 页面宽度
        document.querySelectorAll("[data-width]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const width = btn.dataset.width;
                // 处理百分比和数字
                if (width.includes("%")) {
                    this.settings.contentWidth = width;
                } else {
                    this.settings.contentWidth = parseInt(width);
                }
                this.applySettings();
                this.saveSettings();
                this.updateActiveButton(btn, "[data-width]");
            });
        });

        // 主题
        document.querySelectorAll("[data-theme]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const theme = btn.dataset.theme;
                this.settings.theme = theme;
                this.applySettings();
                this.saveSettings();
                this.updateActiveButton(btn, "[data-theme]");
            });
        });

        // 字体
        document.querySelectorAll("[data-font]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const font = btn.dataset.font;
                this.settings.font = font;
                this.applySettings();
                this.saveSettings();
                this.updateActiveButton(btn, "[data-font]");
            });
        });

        // 标题样式
        document.querySelectorAll("[data-title-style]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const titleStyle = btn.dataset.titleStyle;
                this.settings.titleStyle = titleStyle;
                this.applySettings();
                this.saveSettings();
                this.updateActiveButton(btn, "[data-title-style]");
            });
        });

        // 正文样式
        document.querySelectorAll("[data-content-style]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const contentStyle = btn.dataset.contentStyle;
                this.settings.contentStyle = contentStyle;
                this.applySettings();
                this.saveSettings();
                this.updateActiveButton(btn, "[data-content-style]");
            });
        });

        // 繁简转换
        document.querySelectorAll("[data-text-convert]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const textConvert = btn.dataset.textConvert;
                this.settings.textConvert = textConvert;
                this.applyTextConversion();
                this.saveSettings();
                this.updateActiveButton(btn, "[data-text-convert]");
            });
        });

        // 翻页方式
        document.querySelectorAll("[data-page]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const mode = btn.dataset.page;
                this.settings.pageMode = mode;
                this.applySettings();
                this.saveSettings();
                this.updateActiveButton(btn, "[data-page]");
            });
        });

        // 自动滚动切换
        const autoScrollToggle = document.getElementById("auto-scroll-toggle");
        if (autoScrollToggle) {
            autoScrollToggle.addEventListener("click", () => {
                this.settings.autoScroll = !this.settings.autoScroll;
                autoScrollToggle.classList.toggle("active", this.settings.autoScroll);
                this.saveSettings();

                if (this.settings.autoScroll) {
                    this.startAutoScroll();
                } else {
                    this.stopAutoScroll();
                }
            });
            // 恢复状态
            autoScrollToggle.classList.toggle("active", this.settings.autoScroll);
        }

        // 自动滚动速度
        const autoScrollSpeed = document.getElementById("auto-scroll-speed");
        if (autoScrollSpeed) {
            autoScrollSpeed.addEventListener("input", (e) => {
                this.settings.autoScrollSpeed = parseInt(e.target.value);
                document.getElementById("auto-scroll-speed-value").textContent = this.settings.autoScrollSpeed;
                if (this.settings.autoScroll) {
                    this.stopAutoScroll();
                    this.startAutoScroll();
                }
            });
            autoScrollSpeed.addEventListener("change", () => this.saveSettings());
        }

        // TTS API设置
        const ttsApiUrl = document.getElementById("tts-api-url");
        if (ttsApiUrl) {
            ttsApiUrl.value = this.settings.ttsApiUrl || "";
            ttsApiUrl.addEventListener("change", (e) => {
                this.settings.ttsApiUrl = e.target.value.trim();
                this.saveSettings();
            });
        }
    }

    // 更新按钮激活状态
    updateActiveButton(activeBtn, selector) {
        document.querySelectorAll(selector).forEach((btn) => {
            btn.classList.remove("active");
        });
        activeBtn.classList.add("active");
    }

    // 应用设置
    applySettings() {
        const root = document.documentElement;
        root.style.setProperty("--font-size", `${this.settings.fontSize}px`);
        root.style.setProperty("--line-height", this.settings.lineHeight);
        root.style.setProperty("--paragraph-spacing", `${this.settings.paragraphSpacing}em`);
        root.style.setProperty(
            "--content-width",
            typeof this.settings.contentWidth === "number"
                ? `${this.settings.contentWidth}px`
                : this.settings.contentWidth
        );

        document.body.setAttribute("data-theme", this.settings.theme);
        document.body.setAttribute("data-font", this.settings.font);
        document.body.setAttribute("data-page-mode", this.settings.pageMode);

        // 应用标题样式
        const chapterTitle = document.getElementById("chapter-title");
        if (chapterTitle) {
            chapterTitle.setAttribute("data-title-style", this.settings.titleStyle);
        }

        // 应用正文样式
        const chapterContent = document.getElementById("chapter-content");
        if (chapterContent) {
            chapterContent.setAttribute("data-content-style", this.settings.contentStyle);
        }

        // 更新日夜切换按钮
        const dayNightBtn = document.getElementById("btn-daynight");
        if (dayNightBtn) {
            const isDark = this.settings.theme === "dark";
            dayNightBtn.querySelector("span").textContent = isDark ? "日间" : "夜间";
        }

        // 更新所有设置按钮状态
        this.updateSettingsUI();
    }

    // 保存设置
    saveSettings() {
        localStorage.setItem("readerSettings", JSON.stringify(this.settings));
    }

    // 加载设置
    loadSettings() {
        const saved = localStorage.getItem("readerSettings");
        if (saved) {
            try {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            } catch (e) {
                console.error("加载设置失败:", e);
            }
        }
    }

    // 更新设置UI状态
    updateSettingsUI() {
        // 字体大小滑块
        const fontSizeSlider = document.getElementById("font-size-slider");
        const fontSizeValue = document.getElementById("font-size-value");
        if (fontSizeSlider) {
            fontSizeSlider.value = this.settings.fontSize;
            if (fontSizeValue) fontSizeValue.textContent = this.settings.fontSize;
            this.updateSliderBackground(fontSizeSlider);
        }

        // 行间距滑块
        const lineHeightSlider = document.getElementById("line-height-slider");
        const lineHeightValue = document.getElementById("line-height-value");
        if (lineHeightSlider) {
            lineHeightSlider.value = this.settings.lineHeight;
            if (lineHeightValue) lineHeightValue.textContent = this.settings.lineHeight.toFixed(1);
            this.updateSliderBackground(lineHeightSlider);
        }

        // 段落间距滑块
        const paragraphSlider = document.getElementById("paragraph-spacing-slider");
        const paragraphValue = document.getElementById("paragraph-spacing-value");
        if (paragraphSlider) {
            paragraphSlider.value = this.settings.paragraphSpacing;
            if (paragraphValue) paragraphValue.textContent = this.settings.paragraphSpacing.toFixed(1);
            this.updateSliderBackground(paragraphSlider);
        }

        // 按钮状态
        document.querySelectorAll("[data-width]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.width == this.settings.contentWidth);
        });

        document.querySelectorAll("[data-theme]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.theme === this.settings.theme);
        });

        document.querySelectorAll("[data-font]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.font === this.settings.font);
        });

        document.querySelectorAll("[data-page]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.page === this.settings.pageMode);
        });
    }

    // 打开目录
    openCatalog() {
        document.getElementById("catalog-panel").classList.add("active");
        document.getElementById("overlay").classList.add("active");

        // 滚动到当前章节
        setTimeout(() => {
            const current = document.querySelector(".catalog-item.current");
            if (current) {
                current.scrollIntoView({ block: "center", behavior: "smooth" });
            }
        }, 100);
    }

    // 关闭目录
    closeCatalog() {
        document.getElementById("catalog-panel").classList.remove("active");
        document.getElementById("overlay").classList.remove("active");
    }

    // 打开设置
    openSettings() {
        document.getElementById("settings-panel").classList.add("active");
        document.getElementById("overlay").classList.add("active");
    }

    // 关闭设置
    closeSettings() {
        document.getElementById("settings-panel").classList.remove("active");
        document.getElementById("overlay").classList.remove("active");
    }

    // 切换工具栏
    toggleToolbar() {
        const header = document.getElementById("reader-header");
        const toolbar = document.getElementById("reader-toolbar");
        const nav = document.getElementById("chapter-nav");

        const isHidden = toolbar.classList.contains("hidden");

        if (isHidden) {
            header.classList.remove("hidden");
            toolbar.classList.remove("hidden");
            nav.classList.remove("hidden");
        } else {
            header.classList.add("hidden");
            toolbar.classList.add("hidden");
            nav.classList.add("hidden");
        }
    }

    // 上一章
    prevChapter() {
        if (this.currentChapterIndex > 0) {
            this.loadChapter(this.currentChapterIndex - 1);
        } else {
            this.showToast("已经是第一章了", "info");
        }
    }

    // 下一章
    nextChapter() {
        if (this.currentChapterIndex < this.chapters.length - 1) {
            this.loadChapter(this.currentChapterIndex + 1);
        } else {
            this.showToast("已经是最后一章了", "info");
        }
    }

    // 添加书签
    addBookmark() {
        const bookmark = {
            bookId: this.bookId,
            bookTitle: this.bookTitle,
            chapterIndex: this.currentChapterIndex,
            chapterTitle: this.chapters[this.currentChapterIndex]?.title || "",
            timestamp: Date.now()
        };

        // 保存到localStorage
        const bookmarks = JSON.parse(localStorage.getItem("bookmarks") || "[]");
        const index = bookmarks.findIndex((b) => b.bookId === this.bookId);

        if (index >= 0) {
            bookmarks[index] = bookmark;
        } else {
            bookmarks.unshift(bookmark);
        }

        localStorage.setItem("bookmarks", JSON.stringify(bookmarks.slice(0, 50)));
        this.showToast("书签已保存", "success");
    }

    // 切换日夜模式
    toggleDayNight() {
        const isDark = this.settings.theme === "dark";
        this.settings.theme = isDark ? "default" : "dark";
        this.applySettings();
        this.saveSettings();

        // 更新主题按钮状态
        document.querySelectorAll("[data-theme]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.theme === this.settings.theme);
        });
    }

    // 搜索目录
    searchCatalog(keyword) {
        const items = document.querySelectorAll(".catalog-item");
        const lowerKeyword = keyword.toLowerCase();

        items.forEach((item) => {
            const title = item.querySelector(".chapter-name").textContent.toLowerCase();
            const match = title.includes(lowerKeyword);
            item.style.display = match ? "flex" : "none";
        });
    }

    // 显示提示
    showToast(message, type = "info") {
        const toast = document.getElementById("toast");
        toast.textContent = message;
        toast.classList.add("show");

        setTimeout(() => {
            toast.classList.remove("show");
        }, 2500);
    }

    // HTML转义
    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== 书架功能 ====================

    // 启动定时更新
    startProgressUpdate() {
        // 清除旧的定时器
        if (this.progressUpdateTimer) {
            clearInterval(this.progressUpdateTimer);
        }

        // 每30秒更新一次
        this.progressUpdateTimer = setInterval(() => {
            this.updateBookshelfProgress();
        }, 30000); // 30秒

        console.log("🔄 已启动书架进度定时更新（30秒/次）");
    }

    // 停止定时更新
    stopProgressUpdate() {
        if (this.progressUpdateTimer) {
            clearInterval(this.progressUpdateTimer);
            this.progressUpdateTimer = null;
            console.log("⏸️ 已停止书架进度定时更新");
        }
    }

    // 更新书架进度
    async updateBookshelfProgress() {
        if (!this.bookId) {
            console.warn("⚠️ bookId为空，无法更新书架");
            return;
        }

        try {
            // 计算阅读时长（分钟）
            const now = Date.now();
            const timeDiff = Math.floor((now - this.lastUpdateTime) / 1000); // 秒
            this.readingTimeAccumulated += timeDiff;
            this.lastUpdateTime = now;

            const readingMinutes = Math.floor(this.readingTimeAccumulated / 60);

            console.log("📊 更新书架进度:", {
                bookId: this.bookId,
                currentChapter: this.currentChapterIndex,
                totalChapters: this.chapters.length,
                readingMinutes: readingMinutes,
                accumulated: this.readingTimeAccumulated
            });

            const response = await fetch("/api/bookshelf/progress", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    bookId: this.bookId,
                    currentChapter: this.currentChapterIndex,
                    totalChapters: this.chapters.length,
                    readingMinutes: readingMinutes
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("❌ 更新书架失败:", response.status, errorText);
            } else {
                const result = await response.json();
                console.log("✓ 书架更新成功:", result);
            }
        } catch (error) {
            console.error("❌ 更新书架异常:", error);
        }
    }

    // ==================== TTS朗读功能 ====================

    // 初始TTS
    initTTS() {
        if (!("speechSynthesis" in window)) {
            console.warn("TTS不支持");
            return;
        }

        // 加载语音列表
        const loadVoices = () => {
            this.tts.voices = this.tts.synth.getVoices();
            this.populateVoiceList();
        };

        loadVoices();

        // Chrome需要等待voiceschanged事件
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = loadVoices;
        }

        // 初始化滑块背景
        setTimeout(() => {
            const rateSlider = document.getElementById("tts-rate");
            const pitchSlider = document.getElementById("tts-pitch");
            if (rateSlider) this.updateSliderBackground(rateSlider);
            if (pitchSlider) this.updateSliderBackground(pitchSlider);
        }, 100);
    }

    // 填充语音列表
    populateVoiceList() {
        const voiceSelect = document.getElementById("tts-voice");
        if (!voiceSelect) return;

        voiceSelect.innerHTML = "";

        // 过滤中文语音优先
        const chineseVoices = this.tts.voices.filter(
            (v) => v.lang.includes("zh") || v.lang.includes("CN") || v.lang.includes("TW")
        );
        const otherVoices = this.tts.voices.filter(
            (v) => !v.lang.includes("zh") && !v.lang.includes("CN") && !v.lang.includes("TW")
        );

        const sortedVoices = [...chineseVoices, ...otherVoices];

        sortedVoices.forEach((voice, index) => {
            const option = document.createElement("option");
            const originalIndex = this.tts.voices.indexOf(voice);
            option.value = originalIndex;
            option.textContent = `${voice.name} (${voice.lang})`;
            if (voice.lang.includes("zh")) {
                option.textContent = `🇨🇳 ${voice.name}`;
            }
            voiceSelect.appendChild(option);
        });

        // 默认选中第一个中文语音
        if (chineseVoices.length > 0) {
            const firstChineseIndex = this.tts.voices.indexOf(chineseVoices[0]);
            voiceSelect.value = firstChineseIndex;
            this.tts.selectedVoice = chineseVoices[0];
        } else if (this.tts.voices.length > 0) {
            this.tts.selectedVoice = this.tts.voices[0];
        }
    }

    // 更新滑块背景
    updateSliderBackground(slider) {
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const value = parseFloat(slider.value);
        const percentage = ((value - min) / (max - min)) * 100;
        slider.style.background = `linear-gradient(to right, var(--primary-color) 0%, var(--primary-color) ${percentage}%, #e0e0e0 ${percentage}%, #e0e0e0 100%)`;
    }

    // 打开TTS面板
    openTTS() {
        document.getElementById("tts-panel").classList.add("active");
        document.getElementById("overlay").classList.add("active");
    }

    // 关闭TTS面板
    closeTTS() {
        document.getElementById("tts-panel").classList.remove("active");
        document.getElementById("overlay").classList.remove("active");
    }

    // 切换TTS播放
    toggleTTSPlay() {
        if (!this.tts.synth) {
            this.showToast("您的浏览器不支持语音朗读", "error");
            return;
        }

        if (this.tts.isPlaying) {
            if (this.tts.isPaused) {
                this.resumeTTS();
            } else {
                this.pauseTTS();
            }
        } else {
            this.startTTS();
        }
    }

    // 开始朗读
    startTTS() {
        // 获取章节内容
        const contentEl = document.getElementById("chapter-content");
        if (!contentEl) return;

        // 提取所有段落文本
        const paragraphs = contentEl.querySelectorAll("p");
        if (paragraphs.length === 0) {
            // 如果没有p标签，直接使用整个内容
            this.tts.paragraphs = [contentEl.textContent];
        } else {
            this.tts.paragraphs = Array.from(paragraphs)
                .map((p) => p.textContent.trim())
                .filter((t) => t);
        }

        if (this.tts.paragraphs.length === 0) {
            this.showToast("没有可朗读的内容", "warning");
            return;
        }

        this.tts.currentParagraphIndex = 0;
        this.tts.isPlaying = true;
        this.tts.isPaused = false;

        this.updateTTSUI();
        this.speakParagraph(0);
    }

    // 朗读指定段落
    speakParagraph(index) {
        if (index >= this.tts.paragraphs.length) {
            // 朗读完成 - 检查是否有下一章
            if (this.currentChapterIndex < this.chapters.length - 1) {
                // 自动跳转到下一章
                this.showToast('本章朗读完成，自动跳转下一章', 'info');
                setTimeout(() => {
                    this.nextChapter();
                }, 1000);
            } else {
                // 已是最后一章
                this.stopTTS();
                this.showToast('所有章节朗读完成', 'success');
            }
            return;
        }

        this.tts.currentParagraphIndex = index;
        const text = this.tts.paragraphs[index];

        // 创建语音对象
        this.tts.utterance = new SpeechSynthesisUtterance(text);
        this.tts.utterance.rate = this.tts.rate;
        this.tts.utterance.pitch = this.tts.pitch;

        if (this.tts.selectedVoice) {
            this.tts.utterance.voice = this.tts.selectedVoice;
        }

        // 语音事件
        this.tts.utterance.onstart = () => {
            this.highlightParagraph(index);
            this.updateTTSProgress();
        };

        this.tts.utterance.onend = () => {
            this.removeHighlight();
            // 继续下一段
            if (this.tts.isPlaying && !this.tts.isPaused) {
                this.speakParagraph(index + 1);
            }
        };

        this.tts.utterance.onerror = (e) => {
            console.error("TTS错误:", e);
            if (e.error !== "interrupted") {
                this.showToast("朗读出错: " + e.error, "error");
            }
        };

        this.tts.synth.speak(this.tts.utterance);
    }

    // 高亮当前段落
    highlightParagraph(index) {
        this.removeHighlight();

        const contentEl = document.getElementById("chapter-content");
        const paragraphs = contentEl.querySelectorAll("p");

        if (paragraphs[index]) {
            paragraphs[index].classList.add("tts-highlight");
            this.tts.highlightElement = paragraphs[index];
            
            // 滚动到可见区域 - 使用smooth滚动
            paragraphs[index].scrollIntoView({ behavior: "smooth", block: "center" });
            
            // 启动实时滚动跟随
            if (this.tts.autoScroll) {
                this.startTTSAutoScroll(paragraphs[index]);
            }
        }
    }

    // 启动TTS自动滚动跟随
    startTTSAutoScroll(element) {
        // 清除之前的定时器
        if (this.tts.scrollTimer) {
            clearInterval(this.tts.scrollTimer);
        }

        // 每100ms检查一次元素位置，保持在视口中心
        this.tts.scrollTimer = setInterval(() => {
            if (!this.tts.isPlaying || this.tts.isPaused || !element) {
                clearInterval(this.tts.scrollTimer);
                return;
            }

            const rect = element.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const elementCenter = rect.top + rect.height / 2;
            const viewportCenter = viewportHeight / 2;

            // 如果元素不在视口中心附近，微调滚动
            const offset = elementCenter - viewportCenter;
            if (Math.abs(offset) > 50) {
                window.scrollBy({
                    top: offset * 0.1, // 平滑滚动
                    behavior: "auto"
                });
            }
        }, 100);
    }

    // 移除高亮
    removeHighlight() {
        // 清除滚动定时器
        if (this.tts.scrollTimer) {
            clearInterval(this.tts.scrollTimer);
            this.tts.scrollTimer = null;
        }

        document.querySelectorAll(".tts-highlight").forEach((el) => {
            el.classList.remove("tts-highlight");
        });
        
        this.tts.highlightElement = null;
    }

    // 更新TTS进度
    updateTTSProgress() {
        const progress = ((this.tts.currentParagraphIndex + 1) / this.tts.paragraphs.length) * 100;
        document.getElementById("tts-progress-bar").style.width = `${progress}%`;
        document.getElementById("tts-status").textContent =
            `正在朗读: ${this.tts.currentParagraphIndex + 1} / ${this.tts.paragraphs.length} 段`;
    }

    // 更新TTS UI状态
    updateTTSUI() {
        const playBtn = document.getElementById("tts-play");
        if (this.tts.isPlaying && !this.tts.isPaused) {
            playBtn.classList.add("playing");
        } else {
            playBtn.classList.remove("playing");
        }
    }

    // 暂停TTS
    pauseTTS() {
        if (this.tts.synth.speaking) {
            this.tts.synth.pause();
            this.tts.isPaused = true;
            this.updateTTSUI();
            document.getElementById("tts-status").textContent = "已暂停";
        }
    }

    // 继续TTS
    resumeTTS() {
        if (this.tts.synth.paused) {
            this.tts.synth.resume();
            this.tts.isPaused = false;
            this.updateTTSUI();
        }
    }

    // 停止TTS
    stopTTS() {
        this.tts.synth.cancel();
        this.tts.isPlaying = false;
        this.tts.isPaused = false;
        this.tts.currentParagraphIndex = 0;

        this.removeHighlight();
        this.updateTTSUI();

        document.getElementById("tts-progress-bar").style.width = "0%";
        document.getElementById("tts-status").textContent = "点击播放开始朗读";
    }

    // 章节切换后恢夏TTS
    resumeTTSAfterChapterChange() {
        if (!this.tts.synth) return;

        // 等待内容渲染完成
        setTimeout(() => {
            console.log('[TTS] 章节切换后自动恢复朗读');
            this.startTTS();
            this.showToast('已切换章节，继续朗读', 'success');
        }, 300);
    }

    // ==================== 阅读进度功能 ====================

    // 初始化阅读进度
    initReadingProgress() {
        window.addEventListener("scroll", () => {
            this.updateReadingProgress();
        });
    }

    // 更新阅读进度
    updateReadingProgress() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

        // 更新进度条
        const progressBar = document.getElementById("reading-progress-bar");
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }

        // 更新进度指示器
        const indicator = document.getElementById("reading-progress-indicator");
        if (indicator) {
            const percentage = indicator.querySelector(".progress-percentage");
            const text = indicator.querySelector(".progress-text");

            if (percentage) percentage.textContent = `${Math.round(progress)}%`;
            if (text) text.textContent = `第 ${this.currentChapterIndex + 1}/${this.chapters.length} 章`;

            // 滚动时显示，停止后隐藏
            indicator.classList.add("visible");
            clearTimeout(this.progressHideTimer);
            this.progressHideTimer = setTimeout(() => {
                indicator.classList.remove("visible");
            }, 1500);
        }
    }

    // 保存章节滚动位置
    saveScrollPosition() {
        const chapterId = this.chapters[this.currentChapterIndex]?.chapterId;
        if (chapterId) {
            this.scrollPosition[chapterId] = window.pageYOffset || document.documentElement.scrollTop;
        }
    }

    // 恢复章节滚动位置
    restoreScrollPosition() {
        const chapterId = this.chapters[this.currentChapterIndex]?.chapterId;
        if (chapterId && this.scrollPosition[chapterId]) {
            window.scrollTo(0, this.scrollPosition[chapterId]);
        }
    }

    // ==================== 自动滚动功能 ====================

    // 开始自动滚动
    startAutoScroll() {
        this.stopAutoScroll();

        const scrollStep = this.settings.autoScrollSpeed / 10; // 每步滚动像素

        this.autoScrollTimer = setInterval(() => {
            const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

            if (currentScroll >= maxScroll) {
                // 到达底部，自动翻页
                if (this.currentChapterIndex < this.chapters.length - 1) {
                    this.nextChapter();
                } else {
                    this.stopAutoScroll();
                    this.settings.autoScroll = false;
                    const toggle = document.getElementById("auto-scroll-toggle");
                    if (toggle) toggle.classList.remove("active");
                    this.showToast("已是最后一章", "info");
                }
            } else {
                window.scrollBy(0, scrollStep);
            }
        }, 100);

        this.showToast("已启动自动滚动", "success");
    }

    // 停止自动滚动
    stopAutoScroll() {
        if (this.autoScrollTimer) {
            clearInterval(this.autoScrollTimer);
            this.autoScrollTimer = null;
        }
    }

    // 繁简转换
    applyTextConversion() {
        const content = document.getElementById("chapter-content");
        if (!content || !content.dataset.originalText) {
            // 保存原始文本
            if (content) {
                content.dataset.originalText = content.innerHTML;
            }
        }

        if (!content) return;

        // 恢复原始文本
        if (this.settings.textConvert === 'none') {
            if (content.dataset.originalText) {
                content.innerHTML = content.dataset.originalText;
            }
            return;
        }

        // 获取原始文本
        const originalHTML = content.dataset.originalText || content.innerHTML;
        
        // 简化的繁简转换（仅示例，实际需要完整的映射表）
        let convertedText = originalHTML;
        
        if (this.settings.textConvert === 's2t') {
            // 简转繁（示例映射）
            const s2tMap = {
                '为': '為', '书': '書', '长': '長', '从': '从',
                '东': '東', '临': '臨', '丽': '麗', '乐': '樂',
                '习': '習', '买': '買', '们': '們', '传': '傳',
                '体': '體', '作': '作', '你': '你', '儿': '兒',
                '先': '先', '全': '全', '公': '公', '共': '共',
                '关': '關', '兴': '興', '兵': '兵', '其': '其',
                '内': '內', '册': '冊', '再': '再', '写': '寫',
                '军': '軍', '准': '準', '几': '幾', '凭': '憑',
                '出': '出', '击': '擊', '分': '分', '列': '列',
                '则': '則', '初': '初', '到': '到', '制': '製',
                '前': '前', '力': '力', '功': '功', '务': '務',
                '动': '動', '助': '助', '劳': '勞', '医': '醫',
                '十': '十', '千': '千', '华': '華', '卖': '賣',
                '南': '南', '单': '單', '占': '佔', '会': '會',
                '义': '義'
            };
            Object.keys(s2tMap).forEach(s => {
                const reg = new RegExp(s, 'g');
                convertedText = convertedText.replace(reg, s2tMap[s]);
            });
        } else if (this.settings.textConvert === 't2s') {
            // 繁转简（示例映射）
            const t2sMap = {
                '為': '为', '義': '义', '書': '书', '長': '长', '會': '会',
                '從': '从', '東': '东', '臨': '临', '麗': '丽', '樂': '乐',
                '習': '习', '買': '买', '們': '们', '傳': '传', '體': '体',
                '佯': '作', '兒': '儿', '關': '关', '興': '兴', '內': '内',
                '冊': '册', '寫': '写', '軍': '军', '準': '准', '幾': '几',
                '憑': '凭', '擊': '击', '製': '制', '務': '务', '動': '动',
                '勞': '劳', '醫': '医', '華': '华', '賣': '卖', '單': '单',
                '佔': '占', '戰': '战', '心': '心', '聽': '听', '鏡': '镜'
            };
            Object.keys(t2sMap).forEach(t => {
                const reg = new RegExp(t, 'g');
                convertedText = convertedText.replace(reg, t2sMap[t]);
            });
        }

        content.innerHTML = convertedText;
    }
}

// 初始化阅读器
let readerInstance;
document.addEventListener("DOMContentLoaded", () => {
    readerInstance = new Reader();
});

// 页面卸载时保存进度
window.addEventListener("beforeunload", () => {
    if (readerInstance) {
        readerInstance.stopProgressUpdate();
        readerInstance.updateBookshelfProgress();
    }
});
