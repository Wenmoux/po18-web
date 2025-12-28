// 书架页面 JavaScript
(function () {
    "use strict";

    let currentUser = null;
    let bookshelves = [];
    let currentSort = "recent";

    // 初始化
    async function init() {
        console.log("📚 书架页面初始化开始");
        await checkAuth();
        console.log("👤 当前用户:", currentUser);
        if (!currentUser) {
            console.warn("⚠️ 用户未登录，准备跳转");
            alert("请先登录");
            window.location.href = "/";
            return;
        }

        console.log("✓ 用户已登录，开始加载书架");
        loadBookshelf();
        bindEvents();
    }

    // 检查登录状态
    async function checkAuth() {
        try {
            console.log("🔍 检查登录状态...");
            const response = await fetch("/api/auth/me", {
                credentials: "include"
            });
            console.log("📡 /api/auth/me 响应状态:", response.status);

            if (response.ok) {
                currentUser = await response.json();
                console.log("✓ 获取到用户信息:", currentUser);
                // document.getElementById("username-display").textContent = currentUser.username; // 已移除用户名显示
                document.getElementById("user-info").style.display = "flex";
            } else {
                console.warn("⚠️ 登录验证失败，状态码:", response.status);
            }
        } catch (error) {
            console.error("❌ 获取用户信息异常:", error);
        }
    }

    // 加载书架数据
    async function loadBookshelf() {
        try {
            const response = await fetch("/api/bookshelf", {
                credentials: "include"
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("加载书架失败:", response.status, errorText);
                throw new Error("加载书架失败: " + response.status);
            }

            bookshelves = await response.json();
            console.log("书架数据:", bookshelves);
            renderBookshelf();
        } catch (error) {
            console.error("加载书架异常:", error);
            showEmptyState();
        }
    }

    // 渲染书架
    function renderBookshelf() {
        const grid = document.getElementById("bookshelf-grid");
        const emptyState = document.getElementById("empty-state");

        if (!bookshelves || bookshelves.length === 0) {
            showEmptyState();
            return;
        }

        // 排序
        sortBookshelf();

        grid.innerHTML = bookshelves
            .map(
                (book) => `
            <div class="bookshelf-item" data-book-id="${book.book_id}">
                <div class="book-cover-container">
                    <img class="book-cover-img" src="${book.cover || "/images/default-cover.jpg"}" alt="${book.title}">
                    <div class="reading-progress-overlay">
                        <div class="progress-text">${formatProgress(book.current_chapter, book.total_chapters)}</div>
                        <div class="progress-bar-container">
                            <div class="progress-bar" style="width: ${calculateProgress(book.current_chapter, book.total_chapters)}%"></div>
                        </div>
                    </div>
                </div>
                <div class="bookshelf-item-info">
                    <h3 class="bookshelf-item-title">${book.title}</h3>
                    <p class="bookshelf-item-author">作者：${book.author}</p>
                    <div class="bookshelf-item-stats">
                        <div class="stat-item-inline">
                            <svg fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>
                            </svg>
                            <span>${formatReadingTime(book.reading_time)}</span>
                        </div>
                        <div class="stat-item-inline">
                            <svg fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/>
                            </svg>
                            <span>${formatLastRead(book.last_read_at)}</span>
                        </div>
                    </div>
                </div>
                <div class="bookshelf-item-actions">
                    <button class="btn-continue" onclick="continueReading('${book.book_id}', ${book.current_chapter})">
                        ${book.current_chapter > 0 ? "继续阅读" : "开始阅读"}
                    </button>
                    <button class="btn-remove" onclick="removeFromBookshelf('${book.book_id}')">
                        移除
                    </button>
                </div>
            </div>
        `
            )
            .join("");

        grid.style.display = "grid";
        emptyState.style.display = "none";

        // 绑定点击事件
        document.querySelectorAll(".bookshelf-item").forEach((item) => {
            item.addEventListener("click", (e) => {
                if (!e.target.closest("button")) {
                    const bookId = item.dataset.bookId;
                    window.location.href = `/book-detail.html?id=${bookId}`;
                }
            });
        });
    }

    // 排序书架
    function sortBookshelf() {
        switch (currentSort) {
            case "recent":
                bookshelves.sort((a, b) => new Date(b.last_read_at) - new Date(a.last_read_at));
                break;
            case "progress":
                bookshelves.sort((a, b) => {
                    const progressA = calculateProgress(a.current_chapter, a.total_chapters);
                    const progressB = calculateProgress(b.current_chapter, b.total_chapters);
                    return progressB - progressA;
                });
                break;
            case "time":
                bookshelves.sort((a, b) => (b.reading_time || 0) - (a.reading_time || 0));
                break;
            case "added":
                bookshelves.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
                break;
        }
    }

    // 显示空状态
    function showEmptyState() {
        document.getElementById("bookshelf-grid").style.display = "none";
        document.getElementById("empty-state").style.display = "block";
    }

    // 继续阅读
    window.continueReading = async function (bookId, currentChapter) {
        window.location.href = `/reader.html?id=${bookId}&chapter=${currentChapter}`;
    };

    // 从书架移除
    window.removeFromBookshelf = async function (bookId) {
        if (!confirm("确定要从书架中移除这本书吗？")) {
            return;
        }

        try {
            const response = await fetch(`/api/bookshelf/${bookId}`, {
                method: "DELETE",
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error("移除失败");
            }

            // 重新加载书架
            await loadBookshelf();
        } catch (error) {
            console.error("移除失败:", error);
            alert("移除失败，请重试");
        }
    };

    // 绑定事件
    function bindEvents() {
        // 排序切换
        document.getElementById("sort-select").addEventListener("change", (e) => {
            currentSort = e.target.value;
            renderBookshelf();
        });

        // 登出
        document.getElementById("btn-logout").addEventListener("click", async () => {
            try {
                await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "include"
                });
                window.location.href = "/";
            } catch (error) {
                console.error("登出失败:", error);
            }
        });
    }

    // 工具函数
    function formatProgress(current, total) {
        if (!total || total === 0) return "未开始";
        const percent = Math.round((current / total) * 100);
        return `${percent}% (${current}/${total}章)`;
    }

    function calculateProgress(current, total) {
        if (!total || total === 0) return 0;
        return Math.round((current / total) * 100);
    }

    function formatReadingTime(minutes) {
        if (!minutes || minutes === 0) return "0分钟";
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours > 0) {
            return `${hours}小时${mins}分钟`;
        }
        return `${mins}分钟`;
    }

    function formatLastRead(timestamp) {
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
    }

    // 页面加载完成后初始化
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
