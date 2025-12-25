/*
 * File: mobile-enhancements.js
 * Input: DOM元素，触摸事件
 * Output: 移动端交互增强功能，包括触摸手势、滚动优化、懒加载等
 * Pos: 移动端增强模块，提供手势操作和响应式优化
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和public/js/文件夹的README.md
 */

/**
 * 移动端增强功能
 * 包括触摸手势、滚动优化、适配增强等
 */

// 移动端特定功能增强
document.addEventListener('DOMContentLoaded', () => {
    // 检测是否为移动设备
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    
    if (isMobile) {
        // 优化排行榜和共享书库布局
        optimizeListLayouts();
        
        // 监听屏幕方向变化
        window.addEventListener('resize', () => {
            if (window.matchMedia('(max-width: 768px)').matches) {
                optimizeListLayouts();
            }
        });
    }
});

// 优化列表布局
function optimizeListLayouts() {
    // 优化排行榜布局
    const rankingItems = document.querySelectorAll('.ranking-item');
    rankingItems.forEach(item => {
        // 确保排行榜项目为垂直布局
        if (window.matchMedia('(max-width: 768px)').matches) {
            // 检查是否已有优化标记
            if (!item.hasAttribute('data-mobile-optimized')) {
                item.setAttribute('data-mobile-optimized', 'true');
                
                // 确保统计信息移到底部
                const stats = item.querySelector('.ranking-stats');
                if (stats) {
                    // 移动统计元素到末尾
                    item.appendChild(stats);
                }
            }
        }
    });
    
    // 优化共享书库布局
    const sharedItems = document.querySelectorAll('.shared-list .book-card');
    sharedItems.forEach(item => {
        if (window.matchMedia('(max-width: 768px)').matches) {
            if (!item.hasAttribute('data-mobile-optimized')) {
                item.setAttribute('data-mobile-optimized', 'true');
                
                // 确保共享信息和按钮在底部
                const shareInfo = item.querySelector('.book-share-info');
                const footer = item.querySelector('.book-card-footer');
                
                if (shareInfo) {
                    item.appendChild(shareInfo);
                }
                if (footer) {
                    item.appendChild(footer);
                }
            }
        }
    });
}

// 触摸手势增强
class TouchGestures {
    constructor() {
        this.swipeThreshold = 30; // 滑动阈值
        this.startX = 0;
        this.startY = 0;
        this.callbacks = {};
    }

    // 绑定滑动手势
    bindSwipe(element, callback) {
        element.addEventListener('touchstart', (e) => {
            this.startX = e.touches[0].clientX;
            this.startY = e.touches[0].clientY;
        });

        element.addEventListener('touchend', (e) => {
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            
            const diffX = endX - this.startX;
            const diffY = endY - this.startY;

            // 判断是否为水平滑动
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > this.swipeThreshold) {
                if (diffX > 0) {
                    callback('right');
                } else {
                    callback('left');
                }
            }
        });
    }
}

// 滚动性能优化
class ScrollOptimizer {
    constructor() {
        this.isScrolling = false;
        this.init();
    }

    init() {
        // 使用节流优化滚动事件
        let scrollTimer;
        window.addEventListener('scroll', () => {
            if (!this.isScrolling) {
                this.isScrolling = true;
                requestAnimationFrame(() => {
                    this.onScroll();
                    this.isScrolling = false;
                });
            }
        }, { passive: true });
    }

    onScroll() {
        // 滚动时的优化逻辑
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        // 显示/隐藏回到顶部按钮
        const topBtn = document.querySelector('.scroll-top-btn');
        if (topBtn) {
            if (scrollTop > 300) {
                topBtn.style.display = 'flex';
            } else {
                topBtn.style.display = 'none';
            }
        }
    }
}

// 初始化移动端增强功能
const touchGestures = new TouchGestures();
const scrollOptimizer = new ScrollOptimizer();

// 优化图片加载（移动端懒加载）
function initLazyLoading() {
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        img.classList.add('loaded');
                    }
                    observer.unobserve(img);
                }
            });
        });

        // 观察所有带data-src的图片
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    initLazyLoading();
    
    // 优化按钮触摸效果
    const touchElements = document.querySelectorAll('.btn, .nav-link, .card-interactive');
    touchElements.forEach(el => {
        // 添加触摸反馈
        el.addEventListener('touchstart', () => {
            el.style.transform = 'scale(0.98)';
        });
        
        el.addEventListener('touchend', () => {
            el.style.transform = '';
        });
    });
});

// 防止移动端页面缩放
document.addEventListener('touchstart', function(event) {
    if (event.touches.length > 1) {
        event.preventDefault();
    }
}, { passive: false });

let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    if ((Date.now() - lastTouchEnd) <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = Date.now();
}, { passive: false });

/**
 * 移动端交互增强
 * 手势、触摸反馈、PWA功能
 */

class MobileEnhancements {
    constructor() {
        this.init();
    }

    init() {
        this.setupRippleEffect();
        this.setupSwipeGestures();
        this.setupPullToRefresh();
        this.setupLongPress();
        this.setupPWAInstall();
        this.setupKeyboardOptimization();
    }

    // ===== 涟漪效果 =====
    setupRippleEffect() {
        document.addEventListener("click", (e) => {
            const rippleElements = [".btn", ".card-interactive", ".nav-link", ".tool-btn"];
            const target = e.target.closest(rippleElements.join(","));

            if (!target) return;

            const ripple = document.createElement("span");
            ripple.classList.add("ripple");

            const rect = target.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;

            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;

            // 确保父元素是ripple容器
            if (!target.classList.contains("ripple-container")) {
                target.classList.add("ripple-container");
            }

            target.appendChild(ripple);

            setTimeout(() => ripple.remove(), 600);
        });
    }

    // ===== 滑动手势 =====
    setupSwipeGestures() {
        let touchStartX = 0;
        let touchEndX = 0;
        let touchStartY = 0;
        let touchEndY = 0;

        document.addEventListener(
            "touchstart",
            (e) => {
                touchStartX = e.changedTouches[0].screenX;
                touchStartY = e.changedTouches[0].screenY;
            },
            { passive: true }
        );

        document.addEventListener(
            "touchend",
            (e) => {
                touchEndX = e.changedTouches[0].screenX;
                touchEndY = e.changedTouches[0].screenY;

                const swipeableElement = e.target.closest(".swipeable");
                if (swipeableElement) {
                    this.handleSwipe(swipeableElement, touchStartX, touchEndX, touchStartY, touchEndY);
                }
            },
            { passive: true }
        );
    }

    handleSwipe(element, startX, endX, startY, endY) {
        const diffX = endX - startX;
        const diffY = endY - startY;

        // 确保是水平滑动
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            if (diffX > 0) {
                // 右滑
                this.onSwipeRight(element);
            } else {
                // 左滑
                this.onSwipeLeft(element);
            }
        }
    }

    onSwipeRight(element) {
        element.dispatchEvent(new CustomEvent("swiperight"));
    }

    onSwipeLeft(element) {
        element.dispatchEvent(new CustomEvent("swipeleft"));
    }

    // ===== 下拉刷新 =====
    setupPullToRefresh() {
        const containers = document.querySelectorAll(".pull-to-refresh");

        containers.forEach((container) => {
            let startY = 0;
            let isPulling = false;

            container.addEventListener(
                "touchstart",
                (e) => {
                    if (container.scrollTop === 0) {
                        startY = e.touches[0].pageY;
                        isPulling = true;
                    }
                },
                { passive: true }
            );

            container.addEventListener(
                "touchmove",
                (e) => {
                    if (!isPulling) return;

                    const currentY = e.touches[0].pageY;
                    const diff = currentY - startY;

                    if (diff > 0 && diff < 100) {
                        container.classList.add("pulling");
                        e.preventDefault();
                    }
                },
                { passive: false }
            );

            container.addEventListener(
                "touchend",
                (e) => {
                    if (!isPulling) return;

                    const currentY = e.changedTouches[0].pageY;
                    const diff = currentY - startY;

                    if (diff > 60) {
                        // 触发刷新
                        container.dispatchEvent(new CustomEvent("refresh"));
                    }

                    container.classList.remove("pulling");
                    isPulling = false;
                },
                { passive: true }
            );
        });
    }

    // ===== 长按操作 =====
    setupLongPress() {
        let pressTimer;

        document.addEventListener("touchstart", (e) => {
            const longPressElement = e.target.closest("[data-long-press]");
            if (!longPressElement) return;

            pressTimer = setTimeout(() => {
                this.showLongPressMenu(longPressElement, e.touches[0]);
            }, 500);
        });

        document.addEventListener("touchend", () => {
            clearTimeout(pressTimer);
        });

        document.addEventListener("touchmove", () => {
            clearTimeout(pressTimer);
        });
    }

    showLongPressMenu(element, touch) {
        // 触发震动反馈
        if ("vibrate" in navigator) {
            navigator.vibrate(50);
        }

        const menu = element.querySelector(".long-press-menu");
        if (!menu) return;

        menu.style.left = `${touch.pageX}px`;
        menu.style.top = `${touch.pageY}px`;
        menu.classList.add("show");

        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.classList.remove("show");
                document.removeEventListener("click", closeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener("click", closeMenu);
        }, 100);
    }

    // ===== PWA安装提示 =====
    setupPWAInstall() {
        let deferredPrompt;

        window.addEventListener("beforeinstallprompt", (e) => {
            e.preventDefault();
            deferredPrompt = e;

            // 检查是否已经显示过提示
            if (!localStorage.getItem("pwa_install_dismissed")) {
                this.showInstallPrompt(deferredPrompt);
            }
        });

        window.addEventListener("appinstalled", () => {
            console.log("PWA已安装");
            window.toast?.success("应用已添加到主屏幕");
            this.hideInstallPrompt();
        });
    }

    showInstallPrompt(prompt) {
        const promptHTML = `
            <div class="install-prompt" id="install-prompt">
                <div class="install-prompt-icon">📚</div>
                <div class="install-prompt-content">
                    <div class="install-prompt-title">添加到主屏幕</div>
                    <div class="install-prompt-desc">快速访问,离线可用</div>
                </div>
                <div class="install-prompt-actions">
                    <button class="install-prompt-btn" id="install-dismiss">稍后</button>
                    <button class="install-prompt-btn install-prompt-btn-primary" id="install-accept">安装</button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML("beforeend", promptHTML);

        setTimeout(() => {
            document.getElementById("install-prompt").classList.add("show");
        }, 1000);

        document.getElementById("install-accept").addEventListener("click", async () => {
            if (prompt) {
                prompt.prompt();
                const { outcome } = await prompt.userChoice;
                console.log(`用户选择: ${outcome}`);
            }
            this.hideInstallPrompt();
        });

        document.getElementById("install-dismiss").addEventListener("click", () => {
            localStorage.setItem("pwa_install_dismissed", "true");
            this.hideInstallPrompt();
        });
    }

    hideInstallPrompt() {
        const prompt = document.getElementById("install-prompt");
        if (prompt) {
            prompt.classList.remove("show");
            setTimeout(() => prompt.remove(), 300);
        }
    }

    // ===== 虚拟键盘优化 =====
    setupKeyboardOptimization() {
        if (!window.visualViewport) return;

        const viewport = window.visualViewport;
        let lastHeight = viewport.height;

        viewport.addEventListener("resize", () => {
            const currentHeight = viewport.height;
            const diff = lastHeight - currentHeight;

            // 键盘弹出
            if (diff > 100) {
                document.body.classList.add("keyboard-open");
                this.adjustForKeyboard(diff);
            }
            // 键盘收起
            else if (diff < -100) {
                document.body.classList.remove("keyboard-open");
                this.restoreLayout();
            }

            lastHeight = currentHeight;
        });
    }

    adjustForKeyboard(keyboardHeight) {
        // 将焦点元素滚动到可见区域
        const activeElement = document.activeElement;
        if ((activeElement && activeElement.tagName === "INPUT") || activeElement.tagName === "TEXTAREA") {
            setTimeout(() => {
                activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 100);
        }
    }

    restoreLayout() {
        // 恢复布局
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

// ===== 底部抽屉管理器 =====
class BottomSheetManager {
    constructor() {
        this.activeSheet = null;
    }

    show(sheetId) {
        const sheet = document.getElementById(sheetId);
        if (!sheet) return;

        // 关闭当前打开的抽屉
        if (this.activeSheet && this.activeSheet !== sheet) {
            this.hide(this.activeSheet.id);
        }

        sheet.classList.add("active");
        this.activeSheet = sheet;

        // 添加遮罩
        this.showOverlay();

        // 支持拖动关闭
        this.setupDragToClose(sheet);
    }

    hide(sheetId) {
        const sheet = document.getElementById(sheetId);
        if (!sheet) return;

        sheet.classList.remove("active");
        this.activeSheet = null;
        this.hideOverlay();
    }

    showOverlay() {
        let overlay = document.getElementById("bottom-sheet-overlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "bottom-sheet-overlay";
            overlay.className = "overlay active";
            document.body.appendChild(overlay);

            overlay.addEventListener("click", () => {
                if (this.activeSheet) {
                    this.hide(this.activeSheet.id);
                }
            });
        } else {
            overlay.classList.add("active");
        }
    }

    hideOverlay() {
        const overlay = document.getElementById("bottom-sheet-overlay");
        if (overlay) {
            overlay.classList.remove("active");
        }
    }

    setupDragToClose(sheet) {
        const handle = sheet.querySelector(".bottom-sheet-handle");
        if (!handle) return;

        let startY = 0;
        let currentY = 0;

        handle.addEventListener(
            "touchstart",
            (e) => {
                startY = e.touches[0].pageY;
            },
            { passive: true }
        );

        handle.addEventListener(
            "touchmove",
            (e) => {
                currentY = e.touches[0].pageY;
                const diff = currentY - startY;

                if (diff > 0) {
                    sheet.style.transform = `translateY(${diff}px)`;
                }
            },
            { passive: true }
        );

        handle.addEventListener(
            "touchend",
            () => {
                const diff = currentY - startY;

                if (diff > 100) {
                    this.hide(sheet.id);
                } else {
                    sheet.style.transform = "";
                }
            },
            { passive: true }
        );
    }
}

// ===== 自动初始化 =====
if (typeof window !== "undefined") {
    window.mobileEnhancements = new MobileEnhancements();
    window.bottomSheet = new BottomSheetManager();

    console.log("✅ Mobile enhancements loaded");
}
