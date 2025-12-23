/**
 * 最终增强功能应用
 * 应用所有剩余的优化功能
 */

(function() {
    'use strict';

    // 等待App和工具加载完成
    window.addEventListener('load', () => {
        setTimeout(() => {
            applyRemainingEnhancements();
        }, 100);
    });

    function applyRemainingEnhancements() {
        console.log('[最终增强] 开始应用剩余功能...');

        // 1. 应用虚拟滚动到长列表
        applyVirtualScrolling();

        // 2. 应用动画工具到模态框
        enhanceModals();

        // 3. 应用本地存储到设置
        useStorageForSettings();

        // 4. 创建底部抽屉筛选器 - 已禁用，改用导航按钮
        // createBottomSheetFilters();

        // 5. 添加更多移动端优化
        enhanceMobileInteractions();

        console.log('[最终增强] ✅ 所有功能已应用！');
    }

    // ==================== 1. 虚拟滚动 ====================
    function applyVirtualScrolling() {
        if (!window.App || !window.Utils || !window.Utils.VirtualList) return;

        // 拦截排行榜渲染，当数据超过50项时使用虚拟滚动
        const originalRenderRankings = App.renderRankings;
        App.renderRankings = function(books) {
            if (!books || books.length <= 50) {
                // 数据少时使用原始方法
                return originalRenderRankings.call(this, books);
            }

            console.log(`[虚拟滚动] 启用虚拟滚动渲染 ${books.length} 项`);

            const container = document.getElementById('ranking-list');
            if (!container) return;

            // 清空容器
            container.innerHTML = '';
            container.style.height = '600px';
            container.style.overflowY = 'auto';
            container.style.position = 'relative';

            // 创建虚拟列表
            const virtualList = new Utils.VirtualList(container, {
                itemHeight: 120, // 每项高度
                buffer: 3,
                renderItem: (visibleItems, offset) => {
                    // 使用wrapper渲染
                    const wrapper = virtualList.wrapper;
                    if (!wrapper) return;

                    wrapper.innerHTML = `
                        <div style="position: absolute; top: ${offset}px; width: 100%;">
                            ${visibleItems.map((book, idx) => {
                                const index = Math.floor(offset / 120) + idx;
                                return App.renderSingleRanking(book, index);
                            }).join('')}
                        </div>
                    `;

                    // 重新观察图片
                    if (App.observeImages) {
                        setTimeout(() => App.observeImages(), 10);
                    }
                }
            });

            virtualList.setData(books);
        };

        // 添加单项渲染方法
        if (!App.renderSingleRanking) {
            App.renderSingleRanking = function(book, index) {
                const rank = index + 1;
                const rankClass = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
                
                let statValue = '';
                if (this.currentRankingType === 'favorites') {
                    statValue = this.formatNumber(book.favorites_count);
                } else if (this.currentRankingType === 'comments') {
                    statValue = this.formatNumber(book.comments_count);
                } else if (this.currentRankingType === 'monthly') {
                    statValue = this.formatNumber(book.monthly_popularity);
                } else if (this.currentRankingType === 'total') {
                    statValue = this.formatNumber(book.total_popularity);
                } else if (this.currentRankingType === 'wordcount') {
                    statValue = this.formatNumber(book.word_count);
                } else if (this.currentRankingType === 'latest') {
                    statValue = this.formatUpdateTime(book.latest_chapter_date);
                }

                const cover = book.cover || this.defaultCover;
                const statusText = this.getStatusText(book.status);

                return `
                    <div class="ranking-item">
                        <div class="ranking-number ${rankClass}">${rank}</div>
                        <img src="${cover}" class="ranking-cover" alt="${this.escapeHtml(book.title)}" 
                             loading="lazy" onerror="this.src='${this.defaultCover}'"
                             style="cursor: pointer;"
                             onclick="window.location.href='/book-detail.html?id=${book.book_id}'">
                        <div class="ranking-info" style="cursor: pointer;" onclick="window.location.href='/book-detail.html?id=${book.book_id}'">
                            <div class="ranking-title">${this.escapeHtml(book.title)}</div>
                            <div class="ranking-author">作者：${this.escapeHtml(book.author || '未知')}</div>
                            <div class="ranking-meta">
                                <span>${this.formatNumber(book.total_chapters || 0)} 章</span>
                                <span>${this.formatNumber(book.word_count || 0)} 字</span>
                                <span>${statusText}</span>
                            </div>
                        </div>
                        <div class="ranking-stats">
                            <div class="ranking-value">${statValue}</div>
                        </div>
                    </div>
                `;
            };
        }

        console.log('[虚拟滚动] 已应用到排行榜');
    }

    // ==================== 2. 动画增强 ====================
    function enhanceModals() {
        if (!window.Utils || !window.Utils.AnimationUtil) return;

        // 增强所有模态框的打开/关闭动画
        const showModalOriginal = window.App?.showModal;
        if (showModalOriginal) {
            App.showModal = function(id) {
                const modal = document.getElementById(id);
                if (modal) {
                    modal.classList.add('active');
                    modal.style.display = 'flex';
                    
                    // 使用淡入动画
                    const modalDialog = modal.querySelector('.modal');
                    if (modalDialog) {
                        modalDialog.style.opacity = '0';
                        modalDialog.style.transform = 'scale(0.9)';
                        Utils.AnimationUtil.fadeIn(modalDialog, 200);
                        
                        setTimeout(() => {
                            modalDialog.style.transform = 'scale(1)';
                        }, 10);
                    }
                }
                return showModalOriginal.call(this, id);
            };
        }

        const hideModalOriginal = window.App?.hideModal;
        if (hideModalOriginal) {
            App.hideModal = function(id) {
                const modal = document.getElementById(id);
                if (modal) {
                    const modalDialog = modal.querySelector('.modal');
                    if (modalDialog) {
                        modalDialog.style.transform = 'scale(0.9)';
                        Utils.AnimationUtil.fadeOut(modalDialog, 200);
                        
                        setTimeout(() => {
                            modal.classList.remove('active');
                            modal.style.display = 'none';
                        }, 200);
                    } else {
                        return hideModalOriginal.call(this, id);
                    }
                } else {
                    return hideModalOriginal.call(this, id);
                }
            };
        }

        console.log('[动画增强] 已应用到模态框');
    }

    // ==================== 3. 本地存储应用 ====================
    function useStorageForSettings() {
        if (!window.storage || !window.App) return;

        // 保存用户主题偏好
        const originalInitTheme = App.initTheme;
        if (originalInitTheme) {
            App.initTheme = function() {
                const savedTheme = storage.get('theme', 'light');
                const themeToggle = document.getElementById('theme-toggle');
                
                if (themeToggle) {
                    document.body.classList.toggle('dark-theme', savedTheme === 'dark');
                    
                    themeToggle.addEventListener('change', (e) => {
                        const isDark = e.target.checked;
                        storage.set('theme', isDark ? 'dark' : 'light');
                        console.log('[存储] 主题已保存:', isDark ? 'dark' : 'light');
                    });
                }
                
                return originalInitTheme.call(this);
            };
        }

        // 保存阅读器设置
        if (typeof ReaderApp !== 'undefined') {
            const saveReaderSettings = () => {
                const settings = {
                    fontSize: ReaderApp.fontSize || 16,
                    theme: ReaderApp.currentTheme || 'default',
                    fontFamily: ReaderApp.fontFamily || 'default'
                };
                storage.set('readerSettings', settings);
            };

            // 拦截设置修改
            ['changeFontSize', 'changeTheme', 'changeFontFamily'].forEach(method => {
                if (ReaderApp[method]) {
                    const original = ReaderApp[method];
                    ReaderApp[method] = function(...args) {
                        const result = original.apply(this, args);
                        saveReaderSettings();
                        return result;
                    };
                }
            });
        }

        console.log('[本地存储] 已应用到设置保存');
    }

    // ==================== 4. 底部抽屉筛选器 ====================
    function createBottomSheetFilters() {
        // 为筛选器创建底部抽屉（移动端）
        if (window.innerWidth > 768) return; // 仅移动端

        // 只处理可见的筛选栏，避免重复创建
        const filterBars = document.querySelectorAll('.filter-bar');
        
        // 记录已创建的按钮，避免重复
        const createdButtons = new Set();
        
        filterBars.forEach((filterBar, index) => {
            // 跳过隐藏的筛选栏
            if (filterBar.style.display === 'none' || 
                filterBar.offsetParent === null || 
                createdButtons.has(filterBar)) {
                return;
            }
            
            // 跳过已经有对应按钮的筛选栏
            if (filterBar.hasAttribute('data-sheet-created')) {
                return;
            }
            
            // 标记已创建
            filterBar.setAttribute('data-sheet-created', 'true');
            createdButtons.add(filterBar);
            // 创建触发按钮
            const triggerBtn = document.createElement('button');
            triggerBtn.className = 'btn btn-primary filter-trigger-btn';
            triggerBtn.innerHTML = '<span>🔍</span><span style="font-size: 12px;">筛选</span>';

            // 创建背景遮罩
            const overlay = document.createElement('div');
            overlay.className = 'bottom-sheet-overlay';
            overlay.id = `filter-overlay-${index}`;

            // 创建底部抽屉
            const sheet = document.createElement('div');
            sheet.id = `filter-sheet-${index}`;
            sheet.className = 'bottom-sheet';
            sheet.innerHTML = `
                <div class="bottom-sheet-handle"></div>
                <div class="bottom-sheet-content">
                    <h3 style="margin-bottom: 16px;">筛选条件</h3>
                    ${filterBar.innerHTML}
                </div>
            `;

            // 添加到页面
            document.body.appendChild(overlay);
            document.body.appendChild(sheet);
            document.body.appendChild(triggerBtn);
            
            // 保存关联关系，用于后续显示/隐藏
            triggerBtn.dataset.filterBarId = filterBar.id || `filter-${index}`;
            if (!filterBar.id) {
                filterBar.id = `filter-${index}`;
            }

            // 绑定事件 - 打开抽屉
            triggerBtn.addEventListener('click', () => {
                sheet.classList.add('active');
                overlay.classList.add('active');
            });

            // 绑定事件 - 关闭抽屉
            const closeSheet = () => {
                sheet.classList.remove('active');
                overlay.classList.remove('active');
            };

            overlay.addEventListener('click', closeSheet);

            // 隐藏原始筛选栏
            filterBar.style.display = 'none';
            
            // 根据父元素的可见性决定按钮显示/隐藏
            const checkVisibility = () => {
                const parentSection = filterBar.closest('.tab-content');
                if (parentSection) {
                    const isActive = parentSection.classList.contains('active');
                    triggerBtn.style.display = isActive ? 'flex' : 'none';
                } else {
                    // 如果没有tab-content父元素，默认显示
                    triggerBtn.style.display = 'flex';
                }
            };
            
            // 初始检查
            checkVisibility();
            
            // 监听标签页切换
            document.addEventListener('tabChanged', checkVisibility);
        });

        console.log(`[底部抽屉] 已创建 ${createdButtons.size} 个筛选器`);
    }

    // ==================== 5. 移动端交互增强 ====================
    function enhanceMobileInteractions() {
        // 创建悉窗导航按钮（MD3风格 + 毛玻璃 + 可拖动）
        createFloatingNavButton();

        // 添加触觉反馈
        const addHapticFeedback = (selector) => {
            document.querySelectorAll(selector).forEach(element => {
                element.addEventListener('click', () => {
                    if (navigator.vibrate) {
                        navigator.vibrate(10);
                    }
                });
            });
        };

        addHapticFeedback('.btn');
        addHapticFeedback('.tab-item');
        addHapticFeedback('.book-card');

        // 添加双击返回顶部
        let lastTap = 0;
        document.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;
            
            if (tapLength < 300 && tapLength > 0) {
                // 双击
                if (window.scrollY > 300) {
                    window.scrollTo({
                        top: 0,
                        behavior: 'smooth'
                    });
                    window.toast?.info('返回顶部');
                }
            }
            lastTap = currentTime;
        });

        // 添加滚动到顶部按钮
        const scrollTopBtn = document.createElement('button');
        scrollTopBtn.className = 'scroll-top-btn';
        scrollTopBtn.innerHTML = '↑';
        scrollTopBtn.style.cssText = `
            position: fixed;
            bottom: 140px;
            right: 20px;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: var(--md-primary);
            color: var(--md-on-primary);
            border: none;
            font-size: 24px;
            box-shadow: var(--md-elevation-2);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s;
            z-index: 998;
        `;

        document.body.appendChild(scrollTopBtn);

        // 监听滚动显示/隐藏按钮
        window.addEventListener('scroll', Utils.throttle(() => {
            if (window.scrollY > 300) {
                scrollTopBtn.style.opacity = '1';
                scrollTopBtn.style.pointerEvents = 'auto';
            } else {
                scrollTopBtn.style.opacity = '0';
                scrollTopBtn.style.pointerEvents = 'none';
            }
        }, 200));

        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });

        console.log('[移动端增强] 触觉反馈、双击返回、滚动按钮已添加');
    }

    // ==================== 悄窗导航按钮（MD3毛玻璃风格） ====================
    function createFloatingNavButton() {
        // 仅移动端显示
        if (window.innerWidth > 768) return;

        // 注意：不隐藏原有的底部导航栏，保持两者共存
        // 底部Tab栏仍然显示，悬浮按钮作为补充导航

        // 创建悉窗按钮
        const floatingNav = document.createElement('div');
        floatingNav.id = 'floating-nav-btn';
        floatingNav.className = 'floating-nav-btn';
        floatingNav.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
            </svg>
        `;

        // 创建导航菜单
        const navMenu = document.createElement('div');
        navMenu.className = 'floating-nav-menu';
        navMenu.innerHTML = `
            <div class="nav-menu-item" data-page="download">
                <span class="nav-menu-icon">📥</span>
                <span class="nav-menu-label">快速下载</span>
            </div>
            <div class="nav-menu-item" data-page="bookshelf">
                <span class="nav-menu-icon">📚</span>
                <span class="nav-menu-label">书架</span>
            </div>
            <div class="nav-menu-item" data-page="rankings">
                <span class="nav-menu-icon">🏆</span>
                <span class="nav-menu-label">排行榜</span>
            </div>
            <div class="nav-menu-item" data-page="downloads">
                <span class="nav-menu-icon">⬇️</span>
                <span class="nav-menu-label">下载管理</span>
            </div>
            <div class="nav-menu-item" data-page="library">
                <span class="nav-menu-icon">📚</span>
                <span class="nav-menu-label">我的书库</span>
            </div>
            <div class="nav-menu-item" data-page="global-library">
                <span class="nav-menu-icon">🌐</span>
                <span class="nav-menu-label">全站书库</span>
            </div>
            <div class="nav-menu-item" data-page="subscriptions">
                <span class="nav-menu-icon">🔔</span>
                <span class="nav-menu-label">订阅</span>
            </div>
            <div class="nav-menu-item" data-page="settings">
                <span class="nav-menu-icon">👤</span>
                <span class="nav-menu-label">我的</span>
            </div>
        `;

        document.body.appendChild(floatingNav);
        document.body.appendChild(navMenu);

        // 可拖动功能
        let isDragging = false;
        let startX, startY, startLeft, startTop;
        let hasMoved = false;
        
        // 统一处理开始拖动
        const startDrag = (clientX, clientY) => {
            isDragging = true;
            hasMoved = false;
            startX = clientX;
            startY = clientY;
            const rect = floatingNav.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            floatingNav.style.transition = 'none';
        };
        
        // 统一处理拖动过程
        const doDrag = (clientX, clientY) => {
            if (!isDragging) return;
            hasMoved = true;
            const deltaX = clientX - startX;
            const deltaY = clientY - startY;
            floatingNav.style.left = `${startLeft + deltaX}px`;
            floatingNav.style.top = `${startTop + deltaY}px`;
            floatingNav.style.right = 'auto';
            floatingNav.style.bottom = 'auto';
        };
        
        // 统一处理结束拖动
        const endDrag = () => {
            if (isDragging) {
                isDragging = false;
                floatingNav.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                
                // 如果没有移动，则切换菜单
                if (!hasMoved) {
                    toggleNavMenu();
                }
            }
        };

        // 触摸事件
        floatingNav.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            startDrag(touch.clientX, touch.clientY);
        });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const touch = e.touches[0];
            doDrag(touch.clientX, touch.clientY);
        });

        document.addEventListener('touchend', () => {
            endDrag();
        });
        
        // 鼠标事件（桌面端支持）
        floatingNav.addEventListener('mousedown', (e) => {
            startDrag(e.clientX, e.clientY);
            
            const mouseMoveHandler = (e) => {
                doDrag(e.clientX, e.clientY);
            };
            
            const mouseUpHandler = () => {
                endDrag();
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
            };
            
            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });

        // 点击按钮切换菜单（作为额外保险）
        floatingNav.addEventListener('click', (e) => {
            // 在非拖动状态下触发菜单切换
            if (!isDragging && !hasMoved) {
                toggleNavMenu();
            }
        });

        // 菜单项点击事件
        navMenu.querySelectorAll('.nav-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const page = item.dataset.page;
                if (window.app && window.app.navigateTo) {
                    window.app.navigateTo(page);
                }
                hideNavMenu();
                
                // 触觉反馈
                if (navigator.vibrate) {
                    navigator.vibrate(10);
                }
            });
        });

        // 点击其他地方关闭菜单
        document.addEventListener('click', (e) => {
            if (!navMenu.contains(e.target) && !floatingNav.contains(e.target)) {
                hideNavMenu();
            }
        });

        function toggleNavMenu() {
            if (navMenu.classList.contains('active')) {
                hideNavMenu();
            } else {
                showNavMenu();
            }
        }

        function showNavMenu() {
            navMenu.classList.add('active');
            floatingNav.classList.add('active');
            
            // 计算菜单位置
            const btnRect = floatingNav.getBoundingClientRect();
            const menuHeight = 240; // 预估菜单高度
            
            // 默认在按钮左上方
            navMenu.style.right = `${window.innerWidth - btnRect.left}px`;
            navMenu.style.bottom = `${window.innerHeight - btnRect.top + 10}px`;
            navMenu.style.left = 'auto';
            navMenu.style.top = 'auto';
        }

        function hideNavMenu() {
            navMenu.classList.remove('active');
            floatingNav.classList.remove('active');
        }

        console.log('[漂浮导航] MD3毛玻璃风格按钮已创建');
    }

})();
