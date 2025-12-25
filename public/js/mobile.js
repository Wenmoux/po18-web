/*
 * File: mobile.js
 * Input: 触摸事件，DOM元素
 * Output: MobileEnhance对象，提供滑动手势、双击放大、下拉刷新等移动端交互
 * Pos: 移动端适配核心模块，优化移动设备交互体验
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和public/js/文件夹的README.md
 */

/**
 * PO18书库 - 移动端交互增强模块
 */

const MobileEnhance = {
    // 配置
    config: {
        swipeThreshold: 50, // 滑动阈值（像素）
        doubleTapDelay: 300, // 双击延迟（毫秒）
        pinchZoomMin: 0.8, // 捏合缩放最小值
        pinchZoomMax: 2.0, // 捏合缩放最大值
        pullRefreshThreshold: 80, // 下拉刷新阈值
        loadMoreThreshold: 200 // 上拉加载阈值
    },

    // 状态
    state: {
        touchStartX: 0,
        touchStartY: 0,
        touchStartTime: 0,
        lastTapTime: 0,
        isPulling: false,
        isLoading: false,
        initialPinchDistance: 0,
        currentScale: 1.0
    },

    // 初始化
    init() {
        if (!this.isMobile()) {
            console.log("[Mobile] 非移动设备，跳过移动端增强");
            return;
        }

        console.log("[Mobile] 初始化移动端增强功能");

        // 初始化各个功能
        this.initSwipeGesture();
        this.initDoubleTap();
        this.initPinchZoom();
        this.initPullToRefresh();
        this.initInfiniteScroll();

        // 添加移动端菜单
        this.initMobileMenu();

        // 初始化底部Tab导航
        this.initBottomTabBar();

        // 优化viewport
        this.optimizeViewport();

        // 添加页面可见性监听
        this.initPageVisibility();

        // 监听屏幕方向变化
        this.initOrientationChange();
    },

    // 检测是否为移动设备
    isMobile() {
        return (
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            window.innerWidth < 768
        );
    },

    // 优化viewport设置
    optimizeViewport() {
        let viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
            viewport = document.createElement("meta");
            viewport.name = "viewport";
            document.head.appendChild(viewport);
        }
        viewport.content =
            "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
    },

    // ==================== 滑动手势 ====================

    initSwipeGesture() {
        // 仅在阅读器页面启用左右滑动翻页
        const readerContent = document.getElementById("chapter-content");
        if (!readerContent) return;

        readerContent.addEventListener(
            "touchstart",
            (e) => {
                if (e.touches.length === 1) {
                    this.state.touchStartX = e.touches[0].clientX;
                    this.state.touchStartY = e.touches[0].clientY;
                    this.state.touchStartTime = Date.now();
                }
            },
            { passive: true }
        );

        readerContent.addEventListener(
            "touchend",
            (e) => {
                if (e.changedTouches.length === 1) {
                    const touchEndX = e.changedTouches[0].clientX;
                    const touchEndY = e.changedTouches[0].clientY;
                    const deltaX = touchEndX - this.state.touchStartX;
                    const deltaY = touchEndY - this.state.touchStartY;
                    const deltaTime = Date.now() - this.state.touchStartTime;

                    // 判断是否为有效滑动
                    if (
                        Math.abs(deltaX) > this.config.swipeThreshold &&
                        Math.abs(deltaX) > Math.abs(deltaY) &&
                        deltaTime < 500
                    ) {
                        if (deltaX > 0) {
                            // 右滑 - 上一章
                            this.handleSwipeRight();
                        } else {
                            // 左滑 - 下一章
                            this.handleSwipeLeft();
                        }
                    }
                }
            },
            { passive: true }
        );
    },

    handleSwipeLeft() {
        console.log("[Mobile] 左滑 - 下一章");
        const nextBtn = document.getElementById("btn-next-chapter");
        if (nextBtn && !nextBtn.disabled) {
            nextBtn.click();
        }
    },

    handleSwipeRight() {
        console.log("[Mobile] 右滑 - 上一章");
        const prevBtn = document.getElementById("btn-prev-chapter");
        if (prevBtn && !prevBtn.disabled) {
            prevBtn.click();
        }
    },

    // ==================== 双击放大 ====================

    initDoubleTap() {
        const readerContent = document.getElementById("chapter-content");
        if (!readerContent) return;

        readerContent.addEventListener("click", (e) => {
            const now = Date.now();
            const timeSinceLastTap = now - this.state.lastTapTime;

            if (timeSinceLastTap < this.config.doubleTapDelay && timeSinceLastTap > 0) {
                // 双击事件
                this.handleDoubleTap(e);
                this.state.lastTapTime = 0; // 重置
            } else {
                this.state.lastTapTime = now;
            }
        });
    },

    handleDoubleTap(e) {
        console.log("[Mobile] 双击放大");
        const target = e.target;

        // 如果是图片，放大显示
        if (target.tagName === "IMG") {
            this.showImageFullscreen(target);
        } else {
            // 其他元素，切换字体大小
            this.toggleFontSize();
        }
    },

    showImageFullscreen(img) {
        // 创建全屏查看器
        const overlay = document.createElement("div");
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: zoom-out;
        `;

        const fullImg = document.createElement("img");
        fullImg.src = img.src;
        fullImg.style.cssText = `
            max-width: 95%;
            max-height: 95%;
            object-fit: contain;
        `;

        overlay.appendChild(fullImg);
        document.body.appendChild(overlay);

        overlay.addEventListener("click", () => {
            document.body.removeChild(overlay);
        });
    },

    toggleFontSize() {
        const currentSize = parseFloat(getComputedStyle(document.body).fontSize);
        const newSize = currentSize >= 18 ? 14 : currentSize + 2;
        document.body.style.fontSize = newSize + "px";

        // 保存到localStorage
        localStorage.setItem("reader-font-size", newSize);

        // 显示提示
        this.showToast(`字体大小: ${newSize}px`);
    },

    // ==================== 捏合缩放字体 ====================

    initPinchZoom() {
        const readerContent = document.getElementById("chapter-content");
        if (!readerContent) return;

        readerContent.addEventListener(
            "touchstart",
            (e) => {
                if (e.touches.length === 2) {
                    const distance = this.getDistance(e.touches[0], e.touches[1]);
                    this.state.initialPinchDistance = distance;
                    this.state.currentScale = 1.0;
                }
            },
            { passive: true }
        );

        readerContent.addEventListener(
            "touchmove",
            (e) => {
                if (e.touches.length === 2) {
                    e.preventDefault(); // 阻止默认缩放行为

                    const distance = this.getDistance(e.touches[0], e.touches[1]);
                    const scale = distance / this.state.initialPinchDistance;

                    // 限制缩放范围
                    if (scale >= this.config.pinchZoomMin && scale <= this.config.pinchZoomMax) {
                        this.applyPinchZoom(scale);
                    }
                }
            },
            { passive: false }
        );

        readerContent.addEventListener(
            "touchend",
            (e) => {
                if (e.touches.length < 2) {
                    this.state.initialPinchDistance = 0;
                }
            },
            { passive: true }
        );
    },

    getDistance(touch1, touch2) {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    },

    applyPinchZoom(scale) {
        const currentSize = parseFloat(getComputedStyle(document.body).fontSize);
        const baseSize = parseFloat(localStorage.getItem("reader-font-size") || "14");
        const newSize = Math.round(baseSize * scale);

        // 限制字体大小范围
        if (newSize >= 12 && newSize <= 32) {
            document.body.style.fontSize = newSize + "px";
        }
    },

    // ==================== 下拉刷新 ====================

    initPullToRefresh() {
        let pullIndicator = document.getElementById("pull-refresh-indicator");
        if (!pullIndicator) {
            pullIndicator = document.createElement("div");
            pullIndicator.id = "pull-refresh-indicator";
            pullIndicator.innerHTML = '<div class="spinner"></div><span>下拉刷新</span>';
            pullIndicator.style.cssText = `
                position: fixed;
                top: -80px;
                left: 0;
                width: 100%;
                height: 80px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                background: var(--md-surface-container);
                color: var(--md-on-surface);
                transition: top 0.3s ease;
                z-index: 1000;
                font-size: 14px;
            `;
            document.body.appendChild(pullIndicator);
        }

        let startY = 0;
        let isPulling = false;

        document.addEventListener(
            "touchstart",
            (e) => {
                if (window.scrollY === 0) {
                    startY = e.touches[0].clientY;
                    isPulling = true;
                }
            },
            { passive: true }
        );

        document.addEventListener(
            "touchmove",
            (e) => {
                if (isPulling && window.scrollY === 0) {
                    const currentY = e.touches[0].clientY;
                    const distance = currentY - startY;

                    if (distance > 0 && distance < 200) {
                        pullIndicator.style.top = distance - 80 + "px";

                        if (distance > this.config.pullRefreshThreshold) {
                            pullIndicator.querySelector("span").textContent = "释放刷新";
                        } else {
                            pullIndicator.querySelector("span").textContent = "下拉刷新";
                        }
                    }
                }
            },
            { passive: true }
        );

        document.addEventListener(
            "touchend",
            (e) => {
                if (isPulling) {
                    const distance = e.changedTouches[0].clientY - startY;

                    if (distance > this.config.pullRefreshThreshold) {
                        this.handlePullRefresh();
                    }

                    pullIndicator.style.top = "-80px";
                    isPulling = false;
                }
            },
            { passive: true }
        );
    },

    async handlePullRefresh() {
        if (this.state.isLoading) return;

        this.state.isLoading = true;
        console.log("[Mobile] 下拉刷新");

        const indicator = document.getElementById("pull-refresh-indicator");
        indicator.querySelector("span").textContent = "刷新中...";
        indicator.style.top = "0";

        try {
            // 获取当前页面
            let currentPage = window.app ? window.app.currentPage : 'download';
            
            // 如果是hash路由，从 hash 获取
            if (window.location.hash) {
                currentPage = window.location.hash.replace("#", "");
            }
            
            // 处理默认页面
            if (!currentPage || currentPage === 'home' || currentPage === '') {
                currentPage = 'download';
            }
            
            console.log(`[Mobile] 刷新页面: ${currentPage}`);

            if (window.app && window.app.loadPageData) {
                await window.app.loadPageData(currentPage);
            } else {
                window.location.reload();
            }

            this.showToast("刷新成功", "success");
        } catch (error) {
            console.error("[Mobile] 刷新失败:", error);
            this.showToast("刷新失败", "error");
        } finally {
            setTimeout(() => {
                indicator.style.top = "-80px";
                this.state.isLoading = false;
            }, 500);
        }
    },

    // ==================== 无限滚动（上拉加载） ====================

    initInfiniteScroll() {
        let isLoading = false;

        window.addEventListener(
            "scroll",
            () => {
                const scrollHeight = document.documentElement.scrollHeight;
                const scrollTop = window.scrollY;
                const clientHeight = window.innerHeight;

                // 距离底部小于阈值时触发
                if (scrollHeight - scrollTop - clientHeight < this.config.loadMoreThreshold) {
                    if (!isLoading && !this.state.isLoading) {
                        isLoading = true;
                        this.handleLoadMore().finally(() => {
                            setTimeout(() => {
                                isLoading = false;
                            }, 1000);
                        });
                    }
                }
            },
            { passive: true }
        );
    },

    async handleLoadMore() {
        console.log("[Mobile] 上拉加载更多");

        // 触发当前页面的加载更多逻辑
        const currentPage = window.location.hash || "#home";

        // 根据当前页面调用相应的加载更多方法
        if (window.app) {
            if (currentPage.includes("global-library")) {
                // 全站书库已有无限滚动
                return;
            }

            // 其他页面可以添加加载更多逻辑
            this.showToast("已加载全部内容", "info");
        }
    },

    // ==================== 移动端菜单 ====================
    // 注意：已禁用左上角汉堡菜单，改用右下角悬浮导航按钮
    initMobileMenu() {
        // 不创建任何菜单按钮，完全禁用此功能
        console.log('[Mobile Menu] 左上角汉堡菜单已禁用，使用右下角悬浮导航');
        return;
    },

    // ==================== 工具方法 ====================

    initPageVisibility() {
        // 监听页面可见性变化，节省资源
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                console.log("[Mobile] 页面隐藏，暂停后台任务");
                // 可以暂停动画、视频等
            } else {
                console.log("[Mobile] 页面可见，恢复任务");
                // 恢复任务
            }
        });
    },

    initOrientationChange() {
        // 监听屏幕方向变化
        window.addEventListener("orientationchange", () => {
            setTimeout(() => {
                const orientation = window.orientation;
                if (orientation === 90 || orientation === -90) {
                    console.log("[Mobile] 横屏模式");
                    this.handleLandscapeMode();
                } else {
                    console.log("[Mobile] 竖屏模式");
                    this.handlePortraitMode();
                }
            }, 200); // 延迟等待方向变化完成
        });

        // 也监听window resize
        let resizeTimer;
        window.addEventListener("resize", () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.handleResize();
            }, 250);
        });
    },

    handleLandscapeMode() {
        // 横屏时的特殊处理
        const tabBar = document.getElementById("bottom-tab-bar");
        if (tabBar) {
            // 横屏时可以隐藏Tab标签，只显示图标
            const labels = tabBar.querySelectorAll(".tab-label");
            labels.forEach((label) => {
                label.style.display = "none";
            });
        }
    },

    handlePortraitMode() {
        // 竖屏时恢复
        const tabBar = document.getElementById("bottom-tab-bar");
        if (tabBar) {
            const labels = tabBar.querySelectorAll(".tab-label");
            labels.forEach((label) => {
                label.style.display = "block";
            });
        }
    },

    handleResize() {
        // 窗口大小变化时的处理
        const isMobile = this.isMobile();
        const menuBtn = document.getElementById("mobile-menu-btn");
        const tabBar = document.getElementById("bottom-tab-bar");

        if (isMobile) {
            if (menuBtn) menuBtn.style.display = "flex";
            if (tabBar) tabBar.style.display = "flex";
        } else {
            if (menuBtn) menuBtn.style.display = "none";
            if (tabBar) tabBar.style.display = "none";
            // 关闭抽屉菜单
            const drawer = document.getElementById("mobile-drawer");
            const overlay = document.getElementById("mobile-overlay");
            if (drawer) drawer.style.left = "-300px";
            if (overlay) overlay.style.display = "none";
        }
    },

    initBottomTabBar() {
        const tabBar = document.getElementById("bottom-tab-bar");
        if (!tabBar) {
            console.warn("[Mobile] 底部Tab导航不存在");
            return;
        }

        const tabItems = tabBar.querySelectorAll(".tab-item");

        // 绑定Tab点击事件
        tabItems.forEach((tab) => {
            tab.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();

                const page = tab.getAttribute("data-page");
                if (!page) return;

                // 移除所有激活状态
                tabItems.forEach((t) => {
                    if (t && t.classList) {
                        t.classList.remove("active");
                    }
                });

                // 添加当前激活状态
                if (tab && tab.classList) {
                    tab.classList.add("active");
                }

                // 直接触发页面切换（不依赖app.js）
                this.navigateToPage(page);
                
                // 触发自定义事件，通知其他组件标签页已切换
                document.dispatchEvent(new CustomEvent('tabChanged', { detail: { page } }));
            });
        });

        // 监听页面切换，同步Tab状态
        window.addEventListener("hashchange", () => {
            const currentPage = window.location.hash.replace("#", "") || "download";
            this.updateTabBarState(currentPage);
        });

        // 初始化Tab状态
        const currentPage = window.location.hash.replace("#", "") || "download";
        this.updateTabBarState(currentPage);

        // 确保初始页面数据加载
        setTimeout(() => {
            if (window.app && window.app.loadPageData) {
                window.app.currentPage = currentPage;
                window.app.loadPageData(currentPage);
            }
        }, 100);

        // 同步订阅徽章
        this.syncSubscriptionBadge();

        // 检查全站书库访问权限
        this.checkGlobalLibraryAccess();

        // 监听用户登录事件
        window.addEventListener('userLoggedIn', () => {
            setTimeout(() => {
                this.checkGlobalLibraryAccess();
            }, 500); // 延迟检查，确保用户信息已更新
        });

        // 监听用户信息更新事件
        window.addEventListener('userInfoUpdated', () => {
            setTimeout(() => {
                this.checkGlobalLibraryAccess();
            }, 500);
        });
    },

    navigateToPage(page) {
        // 直接调用app.js的navigateTo方法，让它处理所有逻辑
        if (window.app && window.app.navigateTo) {
            window.app.navigateTo(page);
        } else {
            // Fallback: 手动处理页面切换
            const pages = document.querySelectorAll(".page");
            pages.forEach((p) => p.classList.remove("active"));

            const targetPage = document.getElementById(`page-${page}`);
            if (targetPage) {
                targetPage.classList.add("active");
            }

            document.querySelectorAll(".nav-link").forEach((link) => {
                link.classList.toggle("active", link.dataset.page === page);
            });

            window.location.hash = `#${page}`;

            if (window.app && window.app.loadPageData) {
                window.app.currentPage = page;
                window.app.loadPageData(page);
            }
        }
    },

    updateTabBarState(page) {
        const tabBar = document.getElementById("bottom-tab-bar");
        if (!tabBar) return;

        const tabItems = tabBar.querySelectorAll(".tab-item");

        tabItems.forEach((tab) => {
            if (!tab || !tab.classList) return;

            const tabPage = tab.getAttribute("data-page");
            if (tabPage === page) {
                tab.classList.add("active");
            } else {
                tab.classList.remove("active");
            }
        });

        // 同步更新抽屉菜单的激活状态
        const drawerLinks = document.querySelectorAll(".drawer-link");
        drawerLinks.forEach((link) => {
            if (!link || !link.classList) return;

            const linkPage = link.getAttribute("data-page");
            if (linkPage === page) {
                link.classList.add("active");
            } else {
                link.classList.remove("active");
            }
        });
    },

    syncSubscriptionBadge() {
        // 同步导航栏和底部Tab的订阅徽章
        const navBadge = document.getElementById("subscription-badge");
        const tabBadge = document.getElementById("tab-subscription-badge");

        if (navBadge && tabBadge) {
            // 创建观察者监听导航栏徽章变化
            const observer = new MutationObserver(() => {
                const count = navBadge.textContent;
                const isVisible = navBadge.style.display !== "none";

                if (isVisible && count) {
                    tabBadge.textContent = count;
                    tabBadge.style.display = "flex";
                } else {
                    tabBadge.style.display = "none";
                }
            });

            observer.observe(navBadge, {
                attributes: true,
                childList: true,
                characterData: true,
                subtree: true
            });

            // 初始同步
            const count = navBadge.textContent;
            const isVisible = navBadge.style.display !== "none";
            if (isVisible && count) {
                tabBadge.textContent = count;
                tabBadge.style.display = "flex";
            }
        }
    },

    // 检查并同步全站书库权限
    checkGlobalLibraryAccess() {
        console.log('[Mobile] 检查全站书库权限...');
        
        // 检查用户是否具有全站书库权限
        const tabGlobalLibrary = document.getElementById("tab-global-library");
        const floatingGlobalLibrary = document.querySelector(".nav-menu-item[data-page='global-library']");
        
        if (!tabGlobalLibrary && !floatingGlobalLibrary) {
            console.log('[Mobile] 未找到全站书库元素');
            return;
        }

        // 从全局app对象获取用户权限信息
        console.log('[Mobile] 当前用户信息:', window.app?.currentUser);
        
        if (window.app && window.app.currentUser) {
            const user = window.app.currentUser;
            console.log('[Mobile] 用户权限字段:', {
                hasCacheAuth: user.hasCacheAuth,
                username: user.username,
                hasPo18Cookie: user.hasPo18Cookie
            });
            
            // 用户有权限，显示全站书库
            if (user.hasCacheAuth) {
                if (tabGlobalLibrary) {
                    tabGlobalLibrary.style.display = "flex";
                }
                if (floatingGlobalLibrary) {
                    floatingGlobalLibrary.style.display = "flex";
                }
                console.log('[Mobile] 用户具有全站书库权限，显示全站书库入口');
            } else {
                // 用户无权限，隐藏全站书库
                if (tabGlobalLibrary) {
                    tabGlobalLibrary.style.display = "none";
                }
                if (floatingGlobalLibrary) {
                    floatingGlobalLibrary.style.display = "none";
                }
                console.log('[Mobile] 用户无全站书库权限，隐藏全站书库入口');
            }
        } else {
            // 未登录用户，隐藏全站书库
            if (tabGlobalLibrary) {
                tabGlobalLibrary.style.display = "none";
            }
            if (floatingGlobalLibrary) {
                floatingGlobalLibrary.style.display = "none";
            }
            console.log('[Mobile] 用户未登录，隐藏全站书库入口');
        }
    },

    showToast(message, type = "info") {
        // 使用现有的toast系统
        if (window.app && window.app.showToast) {
            window.app.showToast(message, type);
        } else {
            // 简单的toast实现
            const toast = document.createElement("div");
            toast.textContent = message;
            toast.style.cssText = `
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                padding: 12px 24px;
                background: var(--md-on-surface);
                color: var(--md-surface);
                border-radius: 8px;
                z-index: 10000;
                font-size: 14px;
            `;
            document.body.appendChild(toast);

            setTimeout(() => {
                document.body.removeChild(toast);
            }, 2000);
        }
    }
};

// 自动初始化
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => MobileEnhance.init());
} else {
    MobileEnhance.init();
}

// 导出
if (typeof window !== "undefined") {
    window.MobileEnhance = MobileEnhance;
}
