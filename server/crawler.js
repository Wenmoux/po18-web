/**
 * PO18小说下载网站 - 小说爬取核心模块
 */

const axios = require("axios");
const cheerio = require("cheerio");
const config = require("./config");

// 创建带超时配置的axios实例（优化：减少全局超时）
const axiosInstance = axios.create({
    timeout: 15000, // 15秒全局超时
    family: 4, // 强制IPv4
    validateStatus: function (status) {
        return status < 500;
    }
});

class NovelCrawler {
    constructor(cookie = null, platform = 'po18') {
        this.cookie = cookie;
        this.platform = platform;  // 'po18' 或 'popo'
        // 根据站点设置 baseUrl
        if (platform === 'popo') {
            this.baseUrl = 'https://www.popo.tw';
        } else {
            this.baseUrl = config.po18.baseUrl;
        }
        
        // 站点特定的选择器配置
        this.selectors = this.platform === 'popo' ? {
            title: 'h3.title',
            author: '.b_author a',
            cover: '.BC img',
            tags: '.tags a',
            status: '.b_statu',
            description: '.book_intro',
            latestChapter: '.newe_chapter',  // POPO可能不同
            bookData: '.b_statu'  // 用于获取章节数等信息
        } : {
            title: 'h1.book_name',
            author: 'a.book_author',
            cover: '.book_cover img',
            tags: '.book_intro_tags a',
            status: 'dd.statu',
            description: '.B_I_content',
            latestChapter: '.new_chapter',
            bookData: 'dd.statu'
        };
    }

    // 设置用户Cookie
    setCookie(cookie) {
        this.cookie = cookie;
    }

    // 获取请求头
    getHeaders(referer = null) {
        const headers = { ...config.po18.headers };

        if (this.cookie) {
            // 清理cookie中的非法字符
            let cleanCookie = this.cookie;
            if (typeof cleanCookie === "string") {
                // 移除首尾空白字符和换行符
                cleanCookie = cleanCookie.trim().replace(/[\r\n]+/g, "");
            }
            headers["Cookie"] = cleanCookie;
        }

        if (referer) {
            headers["Referer"] = referer;
        }
        return headers;
    }

    // 延迟函数
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // 搜索小说
    async search(keyword, page = 1) {
        try {
            const url = `${this.baseUrl}/books/search?keyword=${encodeURIComponent(keyword)}&page=${page}`;
            const response = await axiosInstance.get(url, { headers: this.getHeaders() });
            const $ = cheerio.load(response.data);

            const books = [];
            $(".book_list .book_cell").each((i, el) => {
                const $el = $(el);
                const link = $el.find("a.book_name").attr("href") || "";
                const bidMatch = link.match(/\/books\/(\d+)/);

                books.push({
                    bookId: bidMatch ? bidMatch[1] : null,
                    title: $el.find(".book_name").text().trim(),
                    author: $el.find(".book_author").text().trim(),
                    cover: $el.find(".book_cover img").attr("src"),
                    description: $el.find(".book_intro").text().trim(),
                    tags: $el.find(".book_tags").text().trim(),
                    detailUrl: link ? `${this.baseUrl}${link}` : null
                });
            });

            // 获取分页信息
            const totalPages =
                $(".pagination").find("li").length > 0
                    ? parseInt($(".pagination li:last-child").prev().text()) || 1
                    : 1;

            return {
                books: books.filter((b) => b.bookId),
                page,
                totalPages,
                keyword
            };
        } catch (error) {
            console.error("搜索失败:", error.message);
            throw error;
        }
    }

    // 获取小说详情
    async getDetail(bookId) {
        // 额外的安全检查
        if (!bookId || typeof bookId !== "string" || bookId.trim() === "" || bookId === "parse") {
            throw new Error(`无效的书籍ID: ${JSON.stringify(bookId)}`);
        }

        // 重试机制
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const url = `${this.baseUrl}/books/${bookId}`;
                console.log(`请求小说详情 (尝试 ${attempt}/${maxRetries}):`, url);

                const response = await axiosInstance.get(url, {
                    headers: this.getHeaders(),
                    timeout: 20000, // 20秒超时
                    family: 4, // 强制使用IPv4
                    validateStatus: function (status) {
                        return status < 500; // 只拒绝500以上的错误
                    }
                });

                if (response.status >= 400) {
                    throw new Error(`请求失败，状态码: ${response.status}`);
                }

                const html = response.data;
                const $ = cheerio.load(html);

                // 调试：打印响应状态和部分HTML内容
                console.log("响应状态:", response.status);
                console.log("响应内容长度:", html.length);
                console.log("HTML前500字符:", html.substring(0, 500));

                // 检查是否被重定向到登录页面
                const pageTitle = $("title").text().trim();
                console.log("页面标题:", pageTitle);

                if (pageTitle.includes("登入") || pageTitle.includes("登录") || html.includes("請先登入")) {
                    throw new Error("需要登录才能查看");
                }

                // 检查是否是404页面或错误页面
                if (response.status === 404) {
                    throw new Error("书籍不存在（404）");
                }

                // 不要简单地检查HTML中是否包含"不存在"等字样，因为这可能是书籍内容的一部分
                // 而是检查是否能解析到书籍的核心信息

                // 获取标签 - 使用配置的选择器
                const tags = [];
                $(this.selectors.tags).each((i, el) => {
                    const tag = $(el).text().trim();
                    if (tag) tags.push(tag);
                });

                // 获取章节数 - 多种选择器尝试
                let chapterCount = 0;
                const zhText = $("dd.statu").text() || $(".statu").text() || "";
                const zhMatch = zhText.match(/(\d+)/);
                if (zhMatch) {
                    chapterCount = parseInt(zhMatch[1]);
                }

                // 获取总字数
                let wordCount = 0;
                $("table.book_data tbody tr").each((i, el) => {
                    const thText = $(el).find("th").text().trim();
                    const tdText = $(el).find("td").text().trim();
                    if (thText === "總字數" || thText === "总字数") {
                        wordCount = parseInt(tdText) || 0;
                    }
                });

                // 获取免费章回数和付费章回数
                let freeChapters = 0;
                let paidChapters = 0;
                let favoritesCount = 0; // 新增：收藏数
                let commentsCount = 0; // 新增：留言数
                let monthlyPopularity = 0; // 新增：月人气
                let totalPopularity = 0; // 新增：累积人气

                $("table.book_data tbody tr").each((i, el) => {
                    const thText = $(el).find("th").text().trim();
                    const tdText = $(el).find("td").text().trim();
                    if (thText === "免費章回" || thText === "免费章回") {
                        freeChapters = parseInt(tdText) || 0;
                    } else if (thText === "付費章回" || thText === "付费章回") {
                        paidChapters = parseInt(tdText) || 0;
                    } else if (thText === "收藏數" || thText === "收藏数") {
                        favoritesCount = parseInt(tdText) || 0;
                    } else if (thText === "留言數" || thText === "留言数") {
                        commentsCount = parseInt(tdText) || 0;
                    } else if (thText === "本月人氣" || thText === "本月人气") {
                        monthlyPopularity = parseInt(tdText) || 0;
                    } else if (thText === "累积人氣" || thText === "累积人气" || thText === "累積人氣") {
                        totalPopularity = parseInt(tdText) || 0;
                    }
                });

                // 获取状态
                let status = "unknown";
                const statusText = $("dd.statu").text().trim();
                if (statusText.includes("完結") || statusText.includes("完结")) {
                    status = "completed";
                } else if (statusText.includes("未完結") || statusText.includes("未完结")) {
                    status = "ongoing";
                } else if (statusText.includes("連載") || statusText.includes("连载")) {
                    status = "ongoing";
                }

                // 获取描述 - 多种选择器尝试
                const description = $(".B_I_content").text().trim() || $(".book_intro_content").text().trim() || "";

                // 获取标题 - 多种选择器尝试
                const fullTitle = $("h1.book_name").text().trim() || $("h1").first().text().trim() || "";
                const title = fullTitle ? fullTitle.split(/（|【|\(/)[0].trim() : "";

                // 获取作者 - 多种选择器尝试
                const author = $("a.book_author").text().trim() || $(".book_author").text().trim() || "";

                // 获取封面 - 多种选择器尝试
                const cover = $(".book_cover img").attr("src") || $("img.book_cover").attr("src") || "";

                // 获取最新章回信息
                let latestChapterName = "";
                let latestChapterDate = "";
                const newChapter = $(".new_chapter");
                if (newChapter.length > 0) {
                    const chapterTitle = newChapter.find("h4").first();
                    if (chapterTitle.length > 0) {
                        latestChapterName = chapterTitle.text().trim();
                    }
                    const dateDiv = newChapter.find(".date").first();
                    if (dateDiv.length > 0) {
                        const dateText = dateDiv.text().trim();
                        // 提取日期，如："公開 2025-12-14 14:00"
                        const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
                        if (dateMatch) {
                            latestChapterDate = dateMatch[1];
                        }
                    }
                }

                // 验证是否成功解析到核心信息
                if (!title || !author) {
                    console.error("解析页面失败，可能HTML结构不匹配。页面标题:", pageTitle);
                    throw new Error("无法解析书籍信息，可能需要登录或书籍不存在");
                }

                const detail = {
                    bookId,
                    title,
                    fullTitle: fullTitle || title,
                    author,
                    cover,
                    description,
                    tags: tags.join("·"),
                    chapterCount,
                    wordCount, // 新增：总字数
                    freeChapters, // 新增：免费章回数
                    paidChapters, // 新增：付费章回数
                    status, // 新增：状态
                    latestChapterName, // 新增：最新章回名
                    latestChapterDate, // 新增：最新章回日期
                    platform: this.platform, // 新增：平台标识，使用当前站点
                    favoritesCount, // 新增：收藏数
                    commentsCount, // 新增：留言数
                    monthlyPopularity, // 新增：月人气
                    totalPopularity, // 新增：总人气
                    pageNum: Math.ceil(chapterCount / 100) || 1,
                    detailUrl: url
                };

                console.log("获取小说详情成功:", detail.title, "-", detail.author);
                return detail;
            } catch (error) {
                // 记录更详细的错误信息
                let errorMessage = error.message || "未知错误";
                if (error.code) {
                    errorMessage += ` (code: ${error.code})`;
                }
                if (error.response) {
                    errorMessage += ` (status: ${error.response.status})`;
                }
                if (error.config && error.config.url) {
                    errorMessage += ` (url: ${error.config.url})`;
                }

                console.error(`获取小说详情失败 (尝试 ${attempt}/${maxRetries}):`, errorMessage);
                console.error("错误详情:", error);

                // 如果是最后一次尝试，或者是一些不可重试的错误，则抛出异常
                if (
                    attempt === maxRetries ||
                    errorMessage.includes("无效的书籍ID") ||
                    errorMessage.includes("书籍不存在") ||
                    errorMessage.includes("需要登录")
                ) {
                    // 返回基本信息并标记错误
                    return {
                        bookId,
                        title: `书籍 ${bookId}`,
                        fullTitle: `书籍 ${bookId}`,
                        author: "未知",
                        cover: "",
                        description: "获取详情失败: " + errorMessage,
                        tags: "",
                        chapterCount: 0,
                        pageNum: 1,
                        detailUrl: `${this.baseUrl}/books/${bookId}`,
                        error: errorMessage
                    };
                }

                // 等待一段时间后重试
                if (attempt < maxRetries) {
                    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
                }
            }
        }
    }

    // 获取章节列表（优化：并发获取多页）
    async getChapterList(bookId, pageNum) {
        const chapters = [];

        // 并发获取所有页的章节
        const pagePromises = [];
        for (let page = 1; page <= pageNum; page++) {
            pagePromises.push(this.getChapterPage(bookId, page, pageNum));
        }

        const pageResults = await Promise.all(pagePromises);

        // 合并结果并重新编号
        let globalIndex = 0;
        for (const pageChapters of pageResults) {
            for (const chapter of pageChapters) {
                chapter.index = globalIndex++;
                chapters.push(chapter);
            }
        }

        console.log(`共获取到 ${chapters.length} 个可下载章节`);
        return chapters;
    }

    // 简化的获取章节方法（用于详情页）
    async getChapters(bookId) {
        // 先获取书籍详情以获取总章节数
        const detail = await this.getDetail(bookId);
        if (detail.error) {
            throw new Error(detail.error);
        }

        // 计算页数
        const pageNum = detail.pageNum || Math.ceil(detail.chapterCount / 100) || 1;

        // 并发获取所有页的章节（包括未购买的）
        const pagePromises = [];
        for (let page = 1; page <= pageNum; page++) {
            pagePromises.push(this.getChapterPageAll(bookId, page, pageNum));
        }

        const pageResults = await Promise.all(pagePromises);

        // 合并结果
        const chapters = [];
        for (const pageChapters of pageResults) {
            chapters.push(...pageChapters);
        }

        console.log(`共获取到 ${chapters.length} 个章节（包括未购买）`);
        return chapters;
    }

    // 获取单页所有章节（包括未购买的）
    async getChapterPageAll(bookId, page, totalPages) {
        try {
            console.log(`正在获取第${page}/${totalPages}页章节列表（所有章节）...`);
            const url = `${this.baseUrl}/books/${bookId}/articles?page=${page}`;

            const response = await axiosInstance.get(url, {
                headers: this.getHeaders(`${this.baseUrl}/books/${bookId}`),
                timeout: 20000,
                family: 4,
                validateStatus: function (status) {
                    return status < 500;
                }
            });

            if (response.status !== 200) {
                console.error(`获取第${page}页章节列表失败: HTTP ${response.status}`);
                return [];
            }

            const $ = cheerio.load(response.data);
            const chapters = [];

            // 解析所有章节（包括未购买的）
            $("#w0>div").each((i, el) => {
                const $el = $(el);
                const nameEl = $el.find(".l_chaptname");
                if (nameEl.length === 0) return;

                const name = nameEl.text().trim();
                const isPurchased = !$el.text().includes("訂購");
                const btnLink = $el.find(".l_btn a");

                // 尝试获取chapterId
                let chapterId = "";
                if (btnLink.length > 0) {
                    const href = btnLink.attr("href");
                    if (href) {
                        const parts = href.split("/");
                        if (parts.length >= 5) {
                            chapterId = parts[4];
                        }
                    }
                }

                // 即使没有chapterId也添加（未购买的章节）
                chapters.push({
                    title: name,
                    bookId: bookId,
                    chapterId: chapterId || `unknown_${page}_${i}`,
                    isPaid: !isPurchased, // 未购买的就是付费章节
                    isPurchased: isPurchased
                });
            });

            console.log(`第${page}页获取到 ${chapters.length} 个章节`);
            return chapters;
        } catch (error) {
            console.error(`获取第${page}页章节列表失败:`, error.message);
            return [];
        }
    }

    // 获取单页章节列表
    async getChapterPage(bookId, page, totalPages) {
        try {
            console.log(`正在获取第${page}/${totalPages}页章节列表...`);
            const url = `${this.baseUrl}/books/${bookId}/articles?page=${page}`;

            const response = await axiosInstance.get(url, {
                headers: this.getHeaders(`${this.baseUrl}/books/${bookId}`),
                timeout: 20000,
                family: 4,
                validateStatus: function (status) {
                    return status < 500;
                }
            });

            if (response.status !== 200) {
                console.error(`获取第${page}页章节列表失败: HTTP ${response.status}`);
                return [];
            }

            const $ = cheerio.load(response.data);
            const chapters = [];

            // 使用与1.js完全相同的选择器
            $("#w0>div").each((i, el) => {
                const $el = $(el);
                const nameEl = $el.find(".l_chaptname");
                if (nameEl.length === 0) return;

                const name = nameEl.text().trim();
                const isPurchased = !$el.text().includes("訂購");

                if (isPurchased) {
                    const btnLink = $el.find(".l_btn a");
                    if (btnLink.length === 0) return;

                    const href = btnLink.attr("href");
                    if (!href) return;

                    const parts = href.split("/");
                    if (parts.length < 5) return;

                    chapters.push({
                        title: name,
                        bookId: parts[2],
                        chapterId: parts[4]
                    });
                }
            });

            console.log(`第${page}页获取到 ${chapters.length} 个章节`);
            return chapters;
        } catch (error) {
            console.error(`获取第${page}页章节列表失败:`, error.message);
            return [];
        }
    }

    // 获取章节内容（优化：增加重试机制）
    async getChapterContent(bookId, chapterId) {
        const maxRetries = 3; // 增加到3次重试
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const url = `${this.baseUrl}/books/${bookId}/articlescontent/${chapterId}`;
                const referer = `${this.baseUrl}/books/${bookId}/articles/${chapterId}`;

                const response = await axiosInstance.get(url, {
                    headers: {
                        ...this.getHeaders(referer),
                        "X-Requested-With": "XMLHttpRequest"
                    },
                    timeout: 12000, // 优化：进一步减少到12s，更快进入重试
                    family: 4,
                    validateStatus: function (status) {
                        return status < 500;
                    }
                });

                if (response.status !== 200) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const $ = cheerio.load(response.data);

                // 获取标题
                const title = $("h1").text().trim();

                // 移除引用和标题
                $("blockquote").remove();
                $("h1").remove();

                // 获取正文
                const html = $("body").html() || "";
                const text = $("body").text().replace(/\s+/g, "\n").trim();

                return {
                    title,
                    html: html.replace(/&nbsp;/g, ""),
                    text: text.replace(/&nbsp;/g, " ")
                };
            } catch (error) {
                lastError = error;
                const isTimeout = error.code === "ECONNABORTED" || error.message.includes("timeout");

                if (attempt < maxRetries) {
                    const delay = isTimeout ? 500 : 1000 * (attempt + 1); // 超时快速重试
                    console.log(
                        `章节 [${bookId}/${chapterId}] 下载失败 (${error.message})，${delay}ms后重试 ${attempt + 1}/${maxRetries}`
                    );
                    await this.delay(delay);
                } else {
                    console.error(`章节 [${bookId}/${chapterId}] 下载失败，已达最大重试次数:`, error.message);
                }
            }
        }

        throw lastError;
    }

    // 并发下载所有章节（优先从数据库缓存读取）
    async downloadAllChapters(chapters, concurrency = 8, onProgress = null, ChapterCacheDB = null) {
        const contents = new Array(chapters.length);
        let completedCount = 0;
        let currentIndex = 0;

        const worker = async () => {
            while (currentIndex < chapters.length) {
                const index = currentIndex++;
                const chapter = chapters[index];

                try {
                    // 优先从缓存获取
                    let content = null;
                    if (ChapterCacheDB) {
                        const cached = ChapterCacheDB.get(chapter.bookId, chapter.chapterId);
                        if (cached) {
                            content = {
                                title: cached.title,
                                html: cached.html,
                                text: cached.text,
                                fromCache: true
                            };
                            console.log(`下载从缓存读取: ${chapter.chapterId}`);
                        }
                    }

                    // 缓存不存在，从网站下载
                    if (!content) {
                        content = await this.getChapterContent(chapter.bookId, chapter.chapterId);

                        // 如果未购买，设置为未订阅
                        if (content.error) {
                            contents[index] = {
                                title: chapter.title,
                                html: "<p>未订阅</p>",
                                text: "未订阅",
                                index,
                                originalTitle: chapter.title,
                                notPurchased: true
                            };
                            completedCount++;
                            if (onProgress) {
                                onProgress(completedCount, chapters.length);
                            }
                            continue;
                        }

                        // 保存到缓存
                        if (ChapterCacheDB && !content.error) {
                            try {
                                ChapterCacheDB.save(
                                    chapter.bookId,
                                    chapter.chapterId,
                                    content.title || "",
                                    content.html || "",
                                    content.text || ""
                                );
                            } catch (err) {
                                console.error("保存缓存失败:", err);
                            }
                        }
                    }

                    contents[index] = {
                        ...content,
                        index,
                        originalTitle: chapter.title
                    };
                } catch (error) {
                    contents[index] = {
                        title: chapter.title,
                        html: "<p>未订阅</p>",
                        text: "未订阅",
                        index,
                        originalTitle: chapter.title,
                        error: true
                    };
                }

                completedCount++;
                if (onProgress) {
                    onProgress(completedCount, chapters.length);
                }
            }
        };

        // 启动多个worker，去除不必要的延迟
        const workers = [];
        for (let i = 0; i < Math.min(concurrency, chapters.length); i++) {
            workers.push(worker());
        }

        await Promise.all(workers);
        return contents;
    }

    // 获取已购书籍列表
    async getPurchasedBooks(years = 5) {
        if (!this.cookie) {
            throw new Error("需要登录才能获取已购书籍");
        }

        const allBooks = [];
        const currentYear = new Date().getFullYear();
        const failedYears = [];

        for (let year = currentYear; year >= currentYear - years; year--) {
            let retryCount = 0;
            const maxRetries = 2;

            while (retryCount <= maxRetries) {
                try {
                    console.log(
                        `正在获取${year}年已购书籍...${retryCount > 0 ? ` (重试 ${retryCount}/${maxRetries})` : ""}`
                    );
                    const url = `${this.baseUrl}/panel/stock_manage/buyed_lists?sort=order&date_year=${year}`;

                    const response = await axiosInstance.get(url, {
                        headers: this.getHeaders(`${this.baseUrl}/panel/stock_manage/buyed_lists`),
                        timeout: 20000,
                        family: 4,
                        validateStatus: function (status) {
                            return status < 500;
                        }
                    });

                    if (response.status !== 200) {
                        console.error(`获取${year}年已购书籍失败: HTTP ${response.status}`);
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const $ = cheerio.load(response.data);

                    // 解析已购书籍列表
                    $("tbody > tr").each((i, el) => {
                        const $el = $(el);
                        const nameEl = $el.find(".T_name a").first();
                        if (nameEl.length === 0) return;

                        const name = nameEl.text().trim();
                        const href = nameEl.attr("href");
                        const authorEl = $el.find(".T_author");
                        const statusEl = $el.find(".T_status");
                        const buyTimeEl = $el.find(".T_buytime");
                        const latestTimeEl = $el.find(".T_latestime");
                        const settleEl = $el.find(".T_settle");

                        // 从href中提取bid
                        const bidMatch = href ? href.match(/\/books\/(\d+)/) : null;
                        const bid = bidMatch ? bidMatch[1] : null;

                        // 解析可购买/已购买章节数 (例如: "280/280" 或 "21/19")
                        let availableChapters = 0;
                        let purchasedChapters = 0;
                        const settleText = settleEl.text().trim();
                        const chapterMatch = settleText.match(/(\d+)\/(\d+)/);
                        if (chapterMatch) {
                            availableChapters = parseInt(chapterMatch[1]) || 0;
                            purchasedChapters = parseInt(chapterMatch[2]) || 0;
                        }

                        if (name && bid) {
                            allBooks.push({
                                bookId: bid,
                                title: name,
                                author: authorEl.length ? authorEl.text().trim() : "未知作者",
                                status: statusEl.length ? statusEl.text().trim() : "",
                                buyTime: buyTimeEl.length ? buyTimeEl.text().trim() : "",
                                latestTime: latestTimeEl.length ? latestTimeEl.text().trim() : "",
                                availableChapters, // 可购买章节数
                                purchasedChapters, // 已购买章节数
                                year,
                                detailUrl: `${this.baseUrl}${href}`
                            });
                        }
                    });

                    console.log(`获取到${year}年已购书籍 ${allBooks.filter((b) => b.year === year).length} 本`);
                    await this.delay(config.po18.requestDelay);
                    break; // 成功后退出重试循环
                } catch (error) {
                    retryCount++;
                    console.error(`获取${year}年已购书籍失败:`, error.message);

                    if (retryCount > maxRetries) {
                        console.error(`${year}年数据获取失败，已跳过`);
                        failedYears.push(year);
                        break;
                    }

                    // 重试前等待2秒
                    await this.delay(2000);
                }
            }
        }

        if (failedYears.length > 0) {
            console.warn(`以下年份数据获取失败: ${failedYears.join(", ")}`);
        }

        return allBooks;
    }

    // 验证Cookie是否有效
    async validateCookie() {
        if (!this.cookie) {
            return false;
        }

        try {
            const url = `${this.baseUrl}/panel/stock_manage/buyed_lists`;
            const response = await axiosInstance.get(url, {
                headers: this.getHeaders(),
                maxRedirects: 0,
                validateStatus: (status) => status < 400
            });

            // 如果能访问已购页面，说明已登录
            return !response.data.includes("登入");
        } catch (error) {
            return false;
        }
    }

    // 获取书籍评论
    async getComments(bookId, page = 1) {
        try {
            const url = `${this.baseUrl}/books/${bookId}/view?page=${page}#COMMENTS`;
            const response = await axiosInstance.get(url, {
                headers: this.getHeaders(`${this.baseUrl}/books/${bookId}`),
                timeout: 15000
            });

            if (response.status !== 200) {
                return { comments: [], totalPages: 0 };
            }

            const $ = cheerio.load(response.data);
            const comments = [];

            // 解析评论列表 - 使用实际HTML结构的选择器
            $("#w0 .C_list_reader").each((i, el) => {
                const $el = $(el);
                const author = $el.find(".C_member .member_name").text().trim();
                const contentBox = $el.find(".C_msg .C_box");
                // 移除珍珠图标和其他元素，只保留文本
                contentBox.find(".C_img").remove();
                const content = contentBox.text().trim();
                const time = $el.find(".C_func .date").text().trim();

                if (author && content) {
                    comments.push({ author, content, time });
                }
            });

            // 获取总页数 - 使用实际的分页结构
            let totalPages = 1;
            const lastPageLink = $("#w1.page a.num").last();
            if (lastPageLink.length > 0) {
                const lastPageText = lastPageLink.text().trim();
                totalPages = parseInt(lastPageText) || 1;
            }

            console.log(`获取书籍${bookId}第${page}页评论: ${comments.length}条, 共${totalPages}页`);
            return { comments, totalPages, currentPage: page };
        } catch (error) {
            console.error("获取评论失败:", error.message);
            return { comments: [], totalPages: 0 };
        }
    }
}

// 内容格式化工具
const ContentFormatter = {
    // 格式化为TXT
    toTxt(detail, contents) {
        let txt = `${detail.title}\n`;
        txt += `作者：${detail.author}\n`;
        txt += `标签：${detail.tags}\n`;
        txt += `\n${"=".repeat(50)}\n\n`;
        txt += `${detail.description}\n`;
        txt += `\n${"=".repeat(50)}\n\n`;

        contents.forEach((chapter) => {
            if (chapter) {
                txt += `

第${chapter.index + 1}章 ${chapter.title}

`;
                txt += chapter.text || "";
            }
        });

        return txt;
    },

    // 格式化为HTML
    toHtml(detail, contents) {
        let html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${detail.title} - ${detail.author}</title>
    <style>
        :root {
            --bg-color: #FFF9F0;
            --text-color: #333;
            --chapter-bg: #fff;
        }
        body {
            font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            line-height: 1.8;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
        }
        .book-header {
            text-align: center;
            padding: 30px 0;
            border-bottom: 2px solid #FFB2C0;
            margin-bottom: 30px;
        }
        .book-title {
            font-size: 28px;
            color: #D46A87;
            margin-bottom: 10px;
        }
        .book-author {
            color: #666;
        }
        .book-tags {
            margin: 15px 0;
        }
        .book-tags span {
            display: inline-block;
            background: #FFB2C0;
            color: white;
            padding: 3px 10px;
            border-radius: 15px;
            margin: 3px;
            font-size: 12px;
        }
        .book-intro {
            background: var(--chapter-bg);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
        }
        .chapter {
            background: var(--chapter-bg);
            padding: 25px;
            margin-bottom: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        .chapter-title {
            color: #D46A87;
            border-bottom: 1px solid #FFD0DC;
            padding-bottom: 10px;
            margin-bottom: 15px;
        }
        .chapter-content p {
            text-indent: 2em;
            margin-bottom: 1em;
        }
        .toc {
            background: var(--chapter-bg);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
        }
        .toc h3 {
            color: #D46A87;
            margin-bottom: 15px;
        }
        .toc ul {
            list-style: none;
            padding: 0;
        }
        .toc li {
            margin: 5px 0;
        }
        .toc a {
            color: #666;
            text-decoration: none;
        }
        .toc a:hover {
            color: #D46A87;
        }
    </style>
</head>
<body>
    <div class="book-header">
        <h1 class="book-title">${detail.title}</h1>
        <p class="book-author">作者：${detail.author}</p>
        <div class="book-tags">
            ${detail.tags
                .split("·")
                .map((t) => (t.trim() ? `<span>${t.trim()}</span>` : ""))
                .join("")}
        </div>
    </div>
    
    <div class="book-intro">
        <h3>简介</h3>
        <p>${detail.description}</p>
    </div>
    
    <div class="toc">
        <h3>目录</h3>
        <ul>
            ${contents.map((chapter, i) => (chapter ? `<li><a href="#chapter-${i}">第${i + 1}章 ${chapter.title}</a></li>` : "")).join("")}
        </ul>
    </div>
    
    ${contents
        .map((chapter, i) =>
            chapter
                ? `
    <div class="chapter" id="chapter-${i}">
        <h3 class="chapter-title">第${i + 1}章 ${chapter.title}</h3>
        <div class="chapter-content">
            ${chapter.html || `<p>${chapter.text}</p>`}
        </div>
    </div>
    `
                : ""
        )
        .join("")}
</body>
</html>`;

        return html;
    },

    // 生成EPUB结构数据（用于epub-gen或手动构建）
    toEpubData(detail, contents) {
        return {
            title: detail.title,
            author: detail.author,
            publisher: "PO18小说下载站",
            cover: detail.cover,
            content: contents
                .filter((c) => c)
                .map((chapter, i) => ({
                    title: `第${i + 1}章 ${chapter.title}`,
                    data: `<h2>第${i + 1}章 ${chapter.title}</h2>${chapter.html || `<p>${(chapter.text || "").replace(/\n/g, "</p><p>")}</p>`}`
                }))
        };
    }
};

// EPUB生成器 - 使用JSZip手动构建
const JSZip = require("jszip");

const EpubGenerator = {
    // XML转义
    escapeXml(str) {
        if (!str) return "";
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    },

    // 生成EPUB文件
    async generate(detail, contents) {
        const zip = new JSZip();
        const bookId = "po18-" + detail.bid + "-" + Date.now();
        const axios = require("axios");

        // 图片缓存，用于去重
        const imageCache = new Map();
        let imageCounter = 0;

        // 过滤无效章节
        const validContents = contents.filter((c) => c);

        // 1. mimetype文件（必须是第一个文件，不压缩）
        zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

        // 2. META-INF/container.xml
        zip.file(
            "META-INF/container.xml",
            `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
        );

        // 3. 样式文件
        zip.file("OEBPS/Styles/main.css", this.getMainCss());

        // 4. 简介页/封面页
        const tagsHtml = detail.tags
            ? detail.tags
                  .split("·")
                  .map((t) => `<span class="tag">${this.escapeXml(t.trim())}</span>`)
                  .join("")
            : "";

        let descParagraphs = "";
        if (detail.description) {
            const descText = detail.description.replace(/<\/?p>/gi, "").replace(/<br\s*\/?>/gi, "\n");
            descParagraphs = descText
                .split(/\n+/)
                .filter((p) => p.trim())
                .map((p) => `  <p class="kt">${this.escapeXml(p.trim())}</p>`)
                .join("\n");
        }

        const coverXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
    <title>内容简介</title>
    <link href="Styles/main.css" type="text/css" rel="stylesheet"/>
</head>
<body>
  <h2 class="introduction-title">内容简介</h2>
  <div class="book-tags">${tagsHtml}</div>
  <p class="kt">书名：${this.escapeXml(detail.title)}</p>
  <p class="kt">作者：${this.escapeXml(detail.author)}</p>
${descParagraphs}
  <div class="design-box">
    <p class="design-content">本书采用PO18小说下载器自动生成，仅供个人学习之用。</p>
    <hr class="design-line"/>
  </div>
</body>
</html>`;
        zip.file("OEBPS/cover.xhtml", coverXhtml);

        // 6. 下载并处理章节中的图片
        console.log("[EPUB] 开始下载章节图片...");

        // 辅助函数：下载图片
        const downloadImage = async (url) => {
            // 检查缓存
            if (imageCache.has(url)) {
                return imageCache.get(url);
            }

            try {
                console.log(`[EPUB] 下载图片: ${url}`);
                const response = await axios.get(url, {
                    responseType: "arraybuffer",
                    timeout: 10000,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    }
                });

                // 获取文件扩展名
                const ext = url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)?.[1] || "jpg";
                const imageName = `image${imageCounter++}.${ext.toLowerCase()}`;

                // 保存到ZIP
                zip.file(`OEBPS/Images/${imageName}`, response.data);

                // 缓存映射
                imageCache.set(url, imageName);

                console.log(`[EPUB] 图片下载成功: ${imageName}`);
                return imageName;
            } catch (error) {
                console.error(`[EPUB] 图片下载失败: ${url}`, error.message);
                return null;
            }
        };

        // 辅助函数：替换HTML中的图片URL
        const processImagesInHtml = async (html) => {
            const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
            let match;
            const promises = [];
            const replacements = [];

            while ((match = imgRegex.exec(html)) !== null) {
                const fullTag = match[0];
                const imgUrl = match[1];

                promises.push(
                    downloadImage(imgUrl).then((localName) => {
                        if (localName) {
                            const newTag = fullTag.replace(imgUrl, `Images/${localName}`);
                            replacements.push({ old: fullTag, new: newTag });
                        }
                    })
                );
            }

            await Promise.all(promises);

            // 执行替换
            let processedHtml = html;
            for (const { old, new: newTag } of replacements) {
                processedHtml = processedHtml.replace(old, newTag);
            }

            return processedHtml;
        };

        // 7. 章节文件 - 先处理图片，再生成XHTML
        for (let index = 0; index < validContents.length; index++) {
            const chapter = validContents[index];

            // 解析章节标题
            const titleMatch = chapter.title.match(/^(第[一-龥\d]+章)\s*(.*)$/);
            let seqNum = "";
            let chapterName = chapter.title;
            if (titleMatch) {
                seqNum = titleMatch[1];
                chapterName = titleMatch[2] || "";
            }

            // 处理正文内容 - 优先使用html保留图片
            let contentHtml = "";

            console.log(
                `[EPUB] 章节${index}: ${chapter.title}, html长度: ${(chapter.html || "").length}, text长度: ${(chapter.text || "").length}`
            );

            if (chapter.html && chapter.html.trim()) {
                // 使用html内容，先处理图片
                let htmlContent = chapter.html;

                const hasImage = htmlContent.includes("<img");
                console.log(`[EPUB] 章节${index} 包含图片: ${hasImage}`);

                if (hasImage) {
                    // 下载并替换图片URL
                    htmlContent = await processImagesInHtml(htmlContent);
                }

                // 格式化处理
                htmlContent = htmlContent
                    .replace(/<br\s*\/?>/gi, "\n")
                    .replace(/<\/p>\s*<p>/gi, "\n")
                    .replace(/^<p>/gi, "")
                    .replace(/<\/p>$/gi, "");

                // 分段处理，保留img标签
                const lines = htmlContent.split(/\n+/);
                contentHtml = lines
                    .filter((line) => line.trim())
                    .map((line) => {
                        // 如果包含img标签，保持原样
                        if (line.includes("<img")) {
                            console.log(`[EPUB] 找到图片行: ${line.substring(0, 100)}...`);
                            return `  <div class="image-container">${line}</div>`;
                        }
                        // 否则作为普通段落
                        return `  <p>${line.trim()}</p>`;
                    })
                    .join("\n");
            } else {
                // 退回到纯文本模式
                console.log(`[EPUB] 章节${index} 使用纯文本模式`);
                const rawContent = chapter.text || "";
                const textContent = rawContent
                    .replace(/<br\s*\/?>/gi, "\n")
                    .replace(/<\/p>\s*<p>/gi, "\n")
                    .replace(/<\/?p>/gi, "")
                    .replace(/&nbsp;/g, " ");

                contentHtml = textContent
                    .split(/\n+/)
                    .filter((p) => p.trim())
                    .map((p) => `  <p>${p.trim()}</p>`)
                    .join("\n");
            }

            const chapterXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
    <title>${this.escapeXml(chapter.title)}</title>
    <link href="Styles/main.css" type="text/css" rel="stylesheet"/>
</head>
<body>
  <h2 class="chapter-title" title="${this.escapeXml(chapter.title)}">${seqNum ? `<span class="chapter-sequence-number">${this.escapeXml(seqNum)}</span><br/>` : ""}${this.escapeXml(chapterName || chapter.title)}</h2>
${contentHtml}
</body>
</html>`;
            zip.file(`OEBPS/chapter${index}.xhtml`, chapterXhtml);
        }

        console.log(`[EPUB] 章节处理完成，共下载图片: ${imageCache.size}张`);

        // 8. 生成manifest和spine（在处理完章节后）
        let manifest = "";
        let spine = "";

        // 添加封面页
        manifest += '    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>\n';
        spine += '    <itemref idref="cover"/>\n';

        // 添加章节
        validContents.forEach((chapter, index) => {
            manifest += `    <item id="chapter${index}" href="chapter${index}.xhtml" media-type="application/xhtml+xml"/>\n`;
            spine += `    <itemref idref="chapter${index}"/>\n`;
        });

        // 添加图片
        imageCache.forEach((localName, url) => {
            const ext = localName.split(".").pop();
            let mimeType = "image/jpeg";
            if (ext === "png") mimeType = "image/png";
            else if (ext === "gif") mimeType = "image/gif";
            else if (ext === "webp") mimeType = "image/webp";

            manifest += `    <item id="${localName.replace(".", "_")}" href="Images/${localName}" media-type="${mimeType}"/>\n`;
        });

        // 添加目录和样式
        manifest += '    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n';
        manifest += '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n';
        manifest += '    <item id="css" href="Styles/main.css" media-type="text/css"/>\n';

        // 9. content.opf
        const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${this.escapeXml(detail.title)}</dc:title>
    <dc:creator>${this.escapeXml(detail.author)}</dc:creator>
    <dc:language>zh-TW</dc:language>
    <dc:publisher>PO18脸红心跳</dc:publisher>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
${manifest}  </manifest>
  <spine toc="ncx">
${spine}  </spine>
</package>`;
        zip.file("OEBPS/content.opf", contentOpf);

        // 10. 目录文件 toc.xhtml (EPUB3 nav)
        let tocItems = '      <li><a href="cover.xhtml">内容简介</a></li>\n';
        validContents.forEach((chapter, index) => {
            tocItems += `      <li><a href="chapter${index}.xhtml">${this.escapeXml(chapter.title)}</a></li>\n`;
        });

        const tocXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
    <title>目录</title>
    <link href="Styles/main.css" type="text/css" rel="stylesheet"/>
</head>
<body>
  <nav epub:type="toc">
    <h2 class="toc-title">目录</h2>
    <ol>
${tocItems}    </ol>
  </nav>
</body>
</html>`;
        zip.file("OEBPS/toc.xhtml", tocXhtml);

        // 8. NCX文件 (EPUB2兼容)
        let ncxNavPoints = `    <navPoint id="cover" playOrder="1">
      <navLabel><text>内容简介</text></navLabel>
      <content src="cover.xhtml"/>
    </navPoint>\n`;
        let playOrder = 2;
        validContents.forEach((chapter, index) => {
            ncxNavPoints += `    <navPoint id="chapter${index}" playOrder="${playOrder++}">
      <navLabel><text>${this.escapeXml(chapter.title)}</text></navLabel>
      <content src="chapter${index}.xhtml"/>
    </navPoint>\n`;
        });

        const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookId}"/>
  </head>
  <docTitle><text>${this.escapeXml(detail.title)}</text></docTitle>
  <navMap>
${ncxNavPoints}  </navMap>
</ncx>`;
        zip.file("OEBPS/toc.ncx", ncx);

        // 生成EPUB Buffer
        const buffer = await zip.generateAsync({
            type: "nodebuffer",
            mimeType: "application/epub+zip"
        });
        return buffer;
    },

    // CSS样式
    getMainCss() {
        return `/* EPUB主样式表 */
@charset "utf-8";

/* 基础样式 */
body {
  margin: 0;
  padding: 0;
  text-align: justify;
  font-family: "DK-SONGTI", "Songti SC", "st", "宋体", "SimSun", "STSong", serif;
  color: #333333;
}

p {
  margin-left: 0;
  margin-right: 0;
  line-height: 1.3em;
  text-align: justify;
  text-justify: inter-ideograph;
  text-indent: 2em;
  duokan-text-indent: 2em;
}

div {
  margin: 0;
  padding: 0;
  line-height: 130%;
  text-align: justify;
}

/* 图片容器 */
div.image-container {
  text-align: center;
  margin: 1em 0;
  padding: 0;
}

div.image-container img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}

/* 封面图片 */
div.top-img-box {
  text-align: center;
  duokan-bleed: lefttopright;
}

img.top-img {
  width: 100%;
}

/* 分卷标题 */
h1.part-title {
  width: 1em;
  margin: 10% auto auto auto;
  font-family: "SourceHanSerifSC-Bold";
  font-size: 1.3em;
  text-align: center;
  color: #a80000;
  padding: 0.2em;
  border: 2px solid #a80000;
}

/* 章节标题 */
h2.chapter-title {
  margin: 0 12% 2em 12%;
  padding: 0 4px 0 4px;
  line-height: 1.3em;
  font-family: "SourceHanSerifSC-Bold";
  text-align: center;
  font-size: 1em;
  color: #a80000;
}

span.chapter-sequence-number {
  font-family: "FZLanTYKXian";
  font-size: x-small;
  color: #676767;
}

span.sub-heading {
  font-size: small;
}

/* 简介标题 */
h2.introduction-title,
h3.introduction-title {
  margin: 2em auto 2em auto;
  font-family: "SourceHanSerifSC-Bold";
  text-align: center;
  font-size: 1em;
  color: #a80000;
  padding: 0;
}

/* 特殊段落样式 */
p.kt {
  font-family: "STKaiti";
}

p.text-right {
  text-align: right;
  text-indent: 0em;
  duokan-text-indent: 0em;
}

p.end {
  margin: 2em auto auto auto;
  text-align: center;
  font-family: "FZLanTYKXian";
  font-size: small;
  color: #a80000;
  text-indent: 0em;
  duokan-text-indent: 0em;
}

/* 设计信息框 */
div.design-box {
  margin: 20% 2% auto 2%;
  padding: 0.8em;
  border: 2px solid rgba(246, 246, 246, 0.3);
  border-radius: 7px;
  background-color: rgba(246, 246, 246, 0.3);
}

h1.design-title {
  margin: 1em auto 1em auto;
  padding: 0 4px 0 4px;
  font-family: "FZLanTYKXian";
  font-size: 65%;
  color: #808080;
  text-align: center;
}

p.design-content {
  margin-top: 1em;
  font-family: "FZLanTYKXian";
  font-size: 60%;
  color: #808080;
  text-indent: 0em;
  duokan-text-indent: 0em;
}

span.duokanicon {
  font-family: "Asheng";
  color: #EC902E;
}

hr.design-line {
  border-style: dashed;
  border-width: 1px 0 0 0;
  border-color: rgba(200, 200, 193, 0.15);
}

/* 书籍简介样式 */
.book_intro,
.book-intro {
  max-width: 100%;
  margin: 0 auto;
  padding: 1em;
}

.book_intro h3,
.book-intro h3 {
  margin: 0 0 1.5em 0;
  padding-bottom: 0.5em;
  font-family: "SourceHanSerifSC-Bold";
  font-size: 1.2em;
  text-align: center;
  color: #a80000;
  border-bottom: 2px solid #a80000;
}

.B_I_content,
.intro-content {
  line-height: 1.8;
  color: #333333;
  font-size: 1em;
}

.B_I_content p,
.intro-content p {
  margin: 0.8em 0;
  line-height: 1.8;
  text-indent: 2em;
  duokan-text-indent: 2em;
}

/* 简介特殊段落 */
.tagline {
  font-style: italic;
  color: #7f8c8d;
  text-align: center;
  margin: 1.5em 0;
  text-indent: 0 !important;
  duokan-text-indent: 0 !important;
}

.meta-info {
  text-align: center;
  font-weight: bold;
  color: #34495e;
  margin: 1em 0;
  text-indent: 0 !important;
  duokan-text-indent: 0 !important;
}

/* 文字颜色样式 */
.text-red,
.color-red {
  color: #e74c3c;
}

.text-orange,
.color-orange {
  color: #e67e22;
}

.text-gray,
.color-gray {
  color: #999999;
}

.text-green,
.color-green {
  color: #27ae60;
}

.text-black,
.color-black {
  color: #000000;
}

.color-dark-red {
  color: #c0392b;
}

/* 标签样式 */
.book-tags {
  margin-top: 1.5em;
  padding-top: 1em;
  border-top: 1px solid #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
}

.tag {
  display: inline-block;
  padding: 0.4em 2em;
  background: #FFB3D9;
  color: #ffffff;
  border-radius: 15px;
  font-size: 0.85em;
  text-decoration: none;
  font-weight: 500;
  text-indent: 0;
  duokan-text-indent: 0;
}

/* 目录样式 */
.toc-title {
  text-align: center;
  color: #a80000;
  margin-bottom: 1em;
}

nav ol {
  list-style: none;
  padding-left: 0;
}

nav li {
  margin: 0.5em 0;
}

nav a {
  color: #333;
  text-decoration: none;
}

nav a:hover {
  color: #a80000;
}
`;
    }
};

module.exports = {
    NovelCrawler,
    ContentFormatter,
    EpubGenerator
};
