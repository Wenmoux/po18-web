/**
 * 应用增强功能集成
 * 统一初始化所有优化功能
 */

(function() {
    'use strict';

    // 等待DOM加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEnhancements);
    } else {
        initEnhancements();
    }

    function initEnhancements() {
        console.log('[增强功能] 开始初始化...');

        // 1. 初始化移动端增强
        initMobileEnhancements();

        // 2. 应用滚动节流
        applyScrollThrottle();

        // 3. 添加长按菜单到书籍卡片
        addLongPressMenus();

        // 4. 添加滑动手势到书架
        addSwipeGestures();

        // 5. 添加下拉刷新
        addPullToRefresh();

        // 6. 添加骨架屏加载优化
        enhanceLoadingStates();

        console.log('[增强功能] 初始化完成✅');
    }

    // ==================== 1. 移动端增强 ====================
    function initMobileEnhancements() {
        if (typeof MobileEnhancements !== 'undefined') {
            window.mobileEnhancements = new MobileEnhancements();
            console.log('[移动端增强] 已启用');
        }

        if (typeof BottomSheetManager !== 'undefined') {
            window.bottomSheet = new BottomSheetManager();
            console.log('[底部抽屉] 已启用');
        }
    }

    // ==================== 2. 滚动节流 ====================
    function applyScrollThrottle() {
        // 为全站书库的无限滚动添加节流
        const globalLibraryContainer = document.getElementById('page-global-library');
        if (globalLibraryContainer && typeof Utils !== 'undefined') {
            const throttledScroll = Utils.throttle(() => {
                // 检查是否滚动到底部
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const windowHeight = window.innerHeight;
                const docHeight = document.documentElement.scrollHeight;
                
                if (scrollTop + windowHeight >= docHeight - 200) {
                    // 触发加载更多
                    const trigger = document.getElementById('global-load-more');
                    if (trigger && trigger.dataset.loading !== 'true') {
                        trigger.dataset.loading = 'true';
                        // App.loadGlobalLibrary 会自动处理
                    }
                }
            }, 200);

            window.addEventListener('scroll', throttledScroll);
            console.log('[滚动节流] 已应用到无限滚动');
        }
    }

    // ==================== 3. 长按菜单 ====================
    function addLongPressMenus() {
        // 为所有书籍卡片添加长按菜单
        document.addEventListener('click', (e) => {
            const bookCard = e.target.closest('.book-card, .ranking-item, .bookshelf-item');
            if (!bookCard) return;

            let pressTimer = null;
            let menuShown = false;

            bookCard.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e, bookCard);
            });

            bookCard.addEventListener('touchstart', (e) => {
                pressTimer = setTimeout(() => {
                    if (!menuShown) {
                        navigator.vibrate && navigator.vibrate(50);
                        showContextMenu(e.touches[0], bookCard);
                        menuShown = true;
                    }
                }, 500);
            });

            bookCard.addEventListener('touchend', () => {
                clearTimeout(pressTimer);
                setTimeout(() => { menuShown = false; }, 100);
            });

            bookCard.addEventListener('touchmove', () => {
                clearTimeout(pressTimer);
            });
        }, { once: true });

        function showContextMenu(e, element) {
            // 移除旧菜单
            document.querySelectorAll('.context-menu').forEach(m => m.remove());

            const bookId = element.dataset.bookId || 
                          element.querySelector('[data-book-id]')?.dataset.bookId;
            
            if (!bookId) return;

            const menu = document.createElement('div');
            menu.className = 'context-menu';
            menu.style.cssText = `
                position: fixed;
                left: ${e.clientX || e.pageX}px;
                top: ${e.clientY || e.pageY}px;
                background: var(--md-surface-container-high);
                border-radius: var(--md-radius-md);
                box-shadow: var(--md-elevation-3);
                padding: 8px 0;
                z-index: 10000;
                min-width: 160px;
                animation: fadeInScale 0.2s ease;
            `;

            menu.innerHTML = `
                <div class="menu-item" data-action="detail">
                    <span class="menu-icon">📖</span>
                    <span class="menu-text">查看详情</span>
                </div>
                <div class="menu-item" data-action="download">
                    <span class="menu-icon">⬇️</span>
                    <span class="menu-text">立即下载</span>
                </div>
                <div class="menu-item" data-action="subscribe">
                    <span class="menu-icon">🔔</span>
                    <span class="menu-text">订阅更新</span>
                </div>
                <div class="menu-item" data-action="share">
                    <span class="menu-icon">🔗</span>
                    <span class="menu-text">分享链接</span>
                </div>
            `;

            // 添加菜单样式
            if (!document.getElementById('context-menu-style')) {
                const style = document.createElement('style');
                style.id = 'context-menu-style';
                style.textContent = `
                    .context-menu .menu-item {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        padding: 12px 16px;
                        cursor: pointer;
                        transition: background 0.2s;
                    }
                    .context-menu .menu-item:hover {
                        background: var(--md-surface-container-highest);
                    }
                    .context-menu .menu-icon {
                        font-size: 18px;
                    }
                    .context-menu .menu-text {
                        font-size: 14px;
                        color: var(--md-on-surface);
                    }
                    @keyframes fadeInScale {
                        from {
                            opacity: 0;
                            transform: scale(0.9);
                        }
                        to {
                            opacity: 1;
                            transform: scale(1);
                        }
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(menu);

            // 点击菜单项
            menu.addEventListener('click', (e) => {
                const item = e.target.closest('.menu-item');
                if (!item) return;

                const action = item.dataset.action;
                handleMenuAction(action, bookId);
                menu.remove();
            });

            // 点击外部关闭
            setTimeout(() => {
                document.addEventListener('click', function closeMenu() {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                });
            }, 100);
        }

        function handleMenuAction(action, bookId) {
            switch(action) {
                case 'detail':
                    window.location.href = `/book-detail.html?id=${bookId}`;
                    break;
                case 'download':
                    window.toast?.info('开始下载...');
                    // 调用下载功能
                    break;
                case 'subscribe':
                    window.toast?.success('订阅成功');
                    break;
                case 'share': {
                    const url = `${window.location.origin}/book-detail.html?id=${bookId}`;
                    if (navigator.share) {
                        navigator.share({ title: '书籍分享', url });
                    } else {
                        navigator.clipboard.writeText(url);
                        window.toast?.success('链接已复制');
                    }
                    break;
                }
            }
        }

        console.log('[长按菜单] 已添加到书籍卡片');
    }

    // ==================== 4. 滑动手势 ====================
    function addSwipeGestures() {
        const bookshelfItems = document.querySelectorAll('.bookshelf-item');
        
        bookshelfItems.forEach(item => {
            let startX = 0;
            let currentX = 0;
            let isDragging = false;

            item.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                isDragging = true;
            });

            item.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                currentX = e.touches[0].clientX;
                const diff = currentX - startX;

                if (Math.abs(diff) > 10) {
                    e.preventDefault();
                    item.style.transform = `translateX(${Math.min(0, diff)}px)`;
                }
            });

            item.addEventListener('touchend', () => {
                if (!isDragging) return;
                isDragging = false;

                const diff = currentX - startX;
                
                if (diff < -100) {
                    // 左滑删除
                    item.style.transform = 'translateX(-100%)';
                    setTimeout(() => {
                        if (confirm('确定要从书架中移除吗？')) {
                            item.remove();
                            window.toast?.success('已移除');
                        } else {
                            item.style.transform = '';
                        }
                    }, 300);
                } else {
                    item.style.transform = '';
                }
            });
        });

        console.log(`[滑动手势] 已添加到 ${bookshelfItems.length} 个书架项`);
    }

    // ==================== 5. 下拉刷新 ====================
    function addPullToRefresh() {
        const pages = ['page-rankings', 'page-bookshelf', 'page-global-library'];
        
        pages.forEach(pageId => {
            const page = document.getElementById(pageId);
            if (!page) return;

            let startY = 0;
            let currentY = 0;
            let isPulling = false;
            let indicator = null;

            // 创建指示器
            indicator = document.createElement('div');
            indicator.className = 'pull-refresh-indicator';
            indicator.style.cssText = `
                position: absolute;
                top: -60px;
                left: 50%;
                transform: translateX(-50%);
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: top 0.3s;
                z-index: 100;
            `;
            indicator.innerHTML = '<div class="loading-spinner"></div>';
            page.style.position = 'relative';
            page.insertBefore(indicator, page.firstChild);

            page.addEventListener('touchstart', (e) => {
                if (window.scrollY === 0) {
                    startY = e.touches[0].clientY;
                    isPulling = true;
                }
            });

            page.addEventListener('touchmove', (e) => {
                if (!isPulling) return;
                currentY = e.touches[0].clientY;
                const diff = currentY - startY;

                if (diff > 0 && diff < 100) {
                    indicator.style.top = `${-60 + diff}px`;
                }
            });

            page.addEventListener('touchend', async () => {
                if (!isPulling) return;
                isPulling = false;

                const diff = currentY - startY;
                
                if (diff > 60) {
                    // 触发刷新
                    indicator.style.top = '10px';
                    window.toast?.info('刷新中...');
                    
                    // 延迟刷新以显示动画
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // 刷新对应页面数据
                    if (pageId === 'page-rankings' && window.App) {
                        App.rankingCache = {};
                        App.loadRankings();
                    } else if (pageId === 'page-bookshelf' && window.App) {
                        App.loadBookshelf();
                    } else if (pageId === 'page-global-library' && window.App) {
                        App.loadGlobalLibrary(true);
                    }
                    
                    window.toast?.success('刷新完成');
                }
                
                indicator.style.top = '-60px';
            });
        });

        console.log('[下拉刷新] 已添加到主要列表页');
    }

    // ==================== 6. 骨架屏优化 ====================
    function enhanceLoadingStates() {
        // 拦截App的加载状态，替换为骨架屏
        if (window.App) {
            const originalLoadRankings = App.loadRankings;
            App.loadRankings = async function(...args) {
                const container = document.getElementById('ranking-list');
                if (container) {
                    container.innerHTML = `
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                    `;
                }
                return originalLoadRankings.apply(this, args);
            };

            const originalLoadBookshelf = App.loadBookshelf;
            App.loadBookshelf = async function(...args) {
                const container = document.getElementById('bookshelf-list');
                if (container && !container.querySelector('.skeleton')) {
                    container.innerHTML = `
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                    `;
                }
                return originalLoadBookshelf.apply(this, args);
            };

            const originalLoadGlobalLibrary = App.loadGlobalLibrary;
            App.loadGlobalLibrary = async function(reset = false, ...args) {
                if (reset) {
                    const container = document.getElementById('global-library-list');
                    if (container) {
                        container.innerHTML = `
                            <div class="skeleton skeleton-card"></div>
                            <div class="skeleton skeleton-card"></div>
                            <div class="skeleton skeleton-card"></div>
                        `;
                    }
                }
                return originalLoadGlobalLibrary.call(this, reset, ...args);
            };

            console.log('[骨架屏] 已应用到加载状态');
        }
    }

})();
