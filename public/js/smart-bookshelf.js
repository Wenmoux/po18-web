/**
 * 智能书架整理功能
 * 提供标签分组、批量操作等功能
 */

(function() {
    'use strict';

    // 预设标签配置（自动分类）
    const PRESET_TAGS = {
        'all': '全部',
        'reading': '阅读中',
        'to-read': '待读',
        'finished': '已读完',
        'dropped': '已弃',
        'default': '未分类'
    };

    // 用户自定义分类（从API获取）
    let customCategories = [];
    let categoriesMap = {}; // categoryId -> category

    // 从API加载分类
    async function loadCategories() {
        try {
            const response = await fetch('/api/bookshelf/categories', {
                credentials: 'include'
            });
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    customCategories = result.data || [];
                    // 构建分类映射
                    categoriesMap = {};
                    customCategories.forEach(cat => {
                        categoriesMap[cat.id] = cat;
                    });
                    return customCategories;
                }
            }
        } catch (error) {
            console.error('加载分类失败:', error);
        }
        return [];
    }

    // 获取所有标签（预设 + 自定义分类）
    function getAllTags() {
        const tags = { ...PRESET_TAGS };
        // 添加自定义分类
        customCategories.forEach(cat => {
            tags[`cat_${cat.id}`] = cat.name;
        });
        return tags;
    }

    // 当前状态
    let currentTag = 'all';
    let batchMode = false;
    let selectedBooks = new Set();
    let bookshelfData = [];

    // 初始化
    async function init() {
        if (!document.getElementById('bookshelf-container')) {
            return; // 不在书架页面
        }

        // 先加载分类
        await loadCategories();
        
        initTagFilters(); // 先初始化标签筛选器（会调用renderTagFilters和bindTagFilterEvents）
        bindBatchModeEvents();
        bindBatchActions();

        // 监听书架数据更新
        const originalLoadBookshelf = window.App?.loadBookshelf;
        if (originalLoadBookshelf && !window.App.loadBookshelf._smartBookshelfWrapped) {
            const wrappedFn = async function() {
                await originalLoadBookshelf.call(this);
                bookshelfData = this.bookshelfData || [];
                // 只在有新结构时才渲染智能书架
                if (document.getElementById('bookshelf-container')) {
                    // 确保旧列表容器被隐藏
                    const oldContainer = document.getElementById('bookshelf-list');
                    if (oldContainer) {
                        oldContainer.style.display = 'none';
                    }
                    renderSmartBookshelf();
                }
            };
            wrappedFn._smartBookshelfWrapped = true;
            window.App.loadBookshelf = wrappedFn;
        }
        
        // 如果书架数据已经加载，立即渲染
        if (window.App && window.App.bookshelfData && window.App.bookshelfData.length > 0) {
            bookshelfData = window.App.bookshelfData;
            const oldContainer = document.getElementById('bookshelf-list');
            if (oldContainer) {
                oldContainer.style.display = 'none';
            }
            renderSmartBookshelf();
        }
    }

    // 绑定标签筛选事件
    function bindTagFilterEvents() {
        // 先移除旧的事件监听器（如果存在）
        document.querySelectorAll('.tag-filter-btn').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
        });

        // 重新绑定事件
        document.querySelectorAll('.tag-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tag = btn.dataset.tag;
                currentTag = tag;
                
                // 更新按钮状态
                document.querySelectorAll('.tag-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                renderSmartBookshelf();
            });
        });

        // 绑定新建标签按钮
        const createTagBtn = document.getElementById('create-custom-tag-btn');
        if (createTagBtn) {
            createTagBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showCreateTagModal();
            });
        }

        // 绑定删除分类按钮
        document.querySelectorAll('.tag-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tagKey = btn.dataset.tagKey;
                const categoryId = btn.dataset.categoryId;
                const category = categoriesMap[categoryId];
                if (category) {
                    deleteCustomTag(tagKey, category.name);
                }
            });
        });
    }

    // 删除自定义分类
    async function deleteCustomTag(tagKey, tagName) {
        // 提取分类ID
        const categoryId = tagKey.replace('cat_', '');
        
        // 检查是否有书籍使用该分类
        const booksUsingTag = bookshelfData.filter(book => book.category_id == categoryId);
        
        if (booksUsingTag.length > 0) {
            const message = `分类"${tagName}"下还有 ${booksUsingTag.length} 本书。\n\n删除后，这些书将被移动到"未分类"。\n\n确定要删除此分类吗？`;
            if (!confirm(message)) {
                return;
            }
        } else {
            if (!confirm(`确定要删除分类"${tagName}"吗？`)) {
                return;
            }
        }

        // 调用API删除分类
        try {
            const response = await fetch(`/api/bookshelf/categories/${categoryId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('删除失败');
            }

            // 重新加载分类和书架数据
            await loadCategories();
            await window.App.loadBookshelf();

            // 如果当前选中的是已删除的分类，切换到"全部"
            if (currentTag === tagKey) {
                currentTag = 'all';
            }

            renderTagFilters();
            renderSmartBookshelf();
            
            if (window.App.showToast) {
                window.App.showToast('分类已删除', 'success');
            } else {
                console.log('分类已删除');
            }
        } catch (error) {
            console.error('删除分类失败:', error);
            alert('删除分类失败，请重试');
        }
    }

    // 显示创建分类模态框
    async function showCreateTagModal() {
        const tagName = prompt('请输入新分类名称：');
        if (!tagName || !tagName.trim()) {
            return;
        }

        const trimmedName = tagName.trim();

        // 检查是否已存在同名分类
        const allTags = getAllTags();
        if (Object.values(allTags).includes(trimmedName)) {
            alert('该分类名称已存在！');
            return;
        }

        // 调用API创建分类
        try {
            const response = await fetch('/api/bookshelf/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name: trimmedName })
            });
            
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.error || '创建失败');
            }

            // 重新加载分类
            await loadCategories();
            
            // 更新UI
            renderTagFilters();
            
            if (window.App.showToast) {
                window.App.showToast('分类创建成功！', 'success');
            } else {
                alert('分类创建成功！');
            }
        } catch (error) {
            console.error('创建分类失败:', error);
            alert('创建分类失败：' + error.message);
        }
    }

    // 渲染标签筛选器（包含自定义分类）
    function renderTagFilters() {
        const filterBar = document.querySelector('.tag-filters') || document.getElementById('tag-filters-container');
        if (!filterBar) return;

        const allTags = getAllTags();
        
        // 先渲染预设标签（排除'all'）
        const presetHtml = Object.entries(PRESET_TAGS)
            .filter(([key]) => key !== 'all')
            .map(([key, label]) => {
                const isActive = currentTag === key ? 'active' : '';
                return `<button class="tag-filter-btn ${isActive}" data-tag="${key}">${label}</button>`;
            })
            .join('');
        
        // 渲染自定义分类
        const customHtml = customCategories.map(cat => {
            const key = `cat_${cat.id}`;
            const isActive = currentTag === key ? 'active' : '';
            const colorStyle = cat.color ? `style="background: ${cat.color};"` : '';
            return `
                <button class="tag-filter-btn ${isActive}" data-tag="${key}" ${colorStyle}>
                    ${cat.icon || ''} ${cat.name}
                    <span class="tag-delete-btn" data-tag-key="${key}" data-category-id="${cat.id}" title="删除分类">×</span>
                </button>
            `;
        }).join('');

        // 添加"全部"和"新建"按钮
        const allBtn = currentTag === 'all' ? 'active' : '';
        filterBar.innerHTML = `
            <button class="tag-filter-btn ${allBtn}" data-tag="all">全部</button>
            ${presetHtml}
            ${customHtml}
            <button class="tag-filter-btn btn-create-tag" id="create-custom-tag-btn" title="新建分类">
                <span>+</span>
            </button>
        `;

        // 更新批量操作的下拉选择器
        updateBatchTagSelect();

        // 重新绑定事件
        bindTagFilterEvents();
    }

    // 更新批量操作标签选择器
    function updateBatchTagSelect() {
        const select = document.getElementById('batch-tag-select');
        if (!select) return;

        const allTags = getAllTags();
        const options = Object.entries(allTags)
            .filter(([key]) => key !== 'all')
            .map(([key, label]) => `<option value="${key}">${label}</option>`)
            .join('');

        select.innerHTML = `<option value="">选择标签</option>${options}`;
    }

    // 初始化时渲染标签筛选器
    function initTagFilters() {
        if (document.getElementById('bookshelf-container')) {
            renderTagFilters();
        }
    }

    // 绑定批量模式事件
    function bindBatchModeEvents() {
        const batchModeBtn = document.getElementById('bookshelf-batch-mode');
        const batchActions = document.getElementById('bookshelf-batch-actions');
        
        if (batchModeBtn) {
            batchModeBtn.addEventListener('click', () => {
                batchMode = !batchMode;
                selectedBooks.clear();
                
                if (batchMode) {
                    batchModeBtn.textContent = '取消批量';
                    batchActions.style.display = 'flex';
                } else {
                    batchModeBtn.textContent = '批量操作';
                    batchActions.style.display = 'none';
                }
                
                renderSmartBookshelf();
            });
        }
    }

    // 绑定批量操作事件
    function bindBatchActions() {
        // 应用标签
        const applyTagBtn = document.getElementById('batch-apply-tag');
        if (applyTagBtn) {
            applyTagBtn.addEventListener('click', async () => {
                const tag = document.getElementById('batch-tag-select').value;
                if (!tag) {
                    alert('请选择标签');
                    return;
                }

                if (selectedBooks.size === 0) {
                    alert('请选择至少一本书');
                    return;
                }

                await batchUpdateTag(Array.from(selectedBooks), tag);
                renderTagFilters(); // 更新标签筛选器
            });
        }

        // 标记已读
        const markReadBtn = document.getElementById('batch-mark-read');
        if (markReadBtn) {
            markReadBtn.addEventListener('click', async () => {
                if (selectedBooks.size === 0) {
                    alert('请选择至少一本书');
                    return;
                }
                await batchMarkAsRead(Array.from(selectedBooks), true);
            });
        }

        // 标记未读
        const markUnreadBtn = document.getElementById('batch-mark-unread');
        if (markUnreadBtn) {
            markUnreadBtn.addEventListener('click', async () => {
                if (selectedBooks.size === 0) {
                    alert('请选择至少一本书');
                    return;
                }
                await batchMarkAsRead(Array.from(selectedBooks), false);
            });
        }

        // 取消批量
        const cancelBtn = document.getElementById('batch-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                batchMode = false;
                selectedBooks.clear();
                document.getElementById('bookshelf-batch-mode').textContent = '批量操作';
                document.getElementById('bookshelf-batch-actions').style.display = 'none';
                renderSmartBookshelf();
            });
        }
    }

    // 智能分组渲染书架 - 直接显示全部书籍，不显示分组标题
    function renderSmartBookshelf() {
        console.log("📚 renderSmartBookshelf 被调用");
        
        if (!window.App) {
            console.warn("📚 App对象不存在");
            return;
        }

        bookshelfData = window.App.bookshelfData || [];
        console.log("📚 当前bookshelfData:", bookshelfData.length, "本书");
        
        // 确保旧列表容器被隐藏
        const oldContainer = document.getElementById('bookshelf-list');
        if (oldContainer) {
            oldContainer.style.display = 'none';
        }
        
        if (bookshelfData.length === 0) {
            const emptyEl = document.getElementById('bookshelf-empty');
            if (emptyEl) {
                emptyEl.style.display = 'block';
            }
            // 隐藏所有分组
            ['reading', 'to-read', 'finished', 'dropped', 'default'].forEach(tag => {
                const groupEl = document.getElementById(`bookshelf-group-${tag}`);
                if (groupEl) {
                    groupEl.style.display = 'none';
                }
            });
            // 隐藏所有自定义分类分组
            customCategories.forEach(cat => {
                const groupEl = document.getElementById(`bookshelf-group-cat_${cat.id}`);
                if (groupEl) {
                    groupEl.style.display = 'none';
                }
            });
            console.log("📚 书架为空，显示空状态");
            return;
        }

        const emptyEl = document.getElementById('bookshelf-empty');
        if (emptyEl) {
            emptyEl.style.display = 'none';
        }

        // 根据当前选中的标签筛选书籍
        let filteredBooks = [];
        
        if (currentTag === 'all') {
            // 显示全部书籍
            filteredBooks = bookshelfData;
        } else if (currentTag.startsWith('cat_')) {
            // 自定义分类
            const categoryId = currentTag.replace('cat_', '');
            filteredBooks = bookshelfData.filter(book => book.category_id == categoryId);
        } else {
            // 预设标签
            filteredBooks = bookshelfData.filter(book => {
                const progress = window.App.calculateProgress(book.current_chapter, book.total_chapters);
                
                if (book.category_id) {
                    // 有自定义分类的书籍，不在预设标签中显示
                    return false;
                }
                
                if (currentTag === 'finished') {
                    return book.is_read === 1;
                } else if (currentTag === 'reading') {
                    return progress > 0 && progress < 100 && book.is_read !== 1;
                } else if (currentTag === 'to-read') {
                    return progress === 0 && book.is_read !== 1;
                } else if (currentTag === 'dropped') {
                    // 已弃标签需要特殊处理
                    return false; // 暂时不支持
                } else if (currentTag === 'default') {
                    return !book.category_id && progress === 0 && book.is_read !== 1;
                }
                return false;
            });
        }

        // 创建或获取统一的列表容器
        let unifiedList = document.getElementById('bookshelf-list-unified');
        const groupsContainer = document.querySelector('.bookshelf-groups');
        
        if (!unifiedList && groupsContainer) {
            unifiedList = document.createElement('div');
            unifiedList.id = 'bookshelf-list-unified';
            unifiedList.className = 'bookshelf-list';
            groupsContainer.innerHTML = ''; // 清空原有分组
            groupsContainer.appendChild(unifiedList);
        }
        
        if (!unifiedList) {
            console.warn("📚 无法创建统一列表容器");
            return;
        }

        // 隐藏所有分组标题
        document.querySelectorAll('.group-title').forEach(title => {
            title.style.display = 'none';
        });
        
        // 隐藏所有预设分组
        ['reading', 'to-read', 'finished', 'dropped', 'default'].forEach(tag => {
            const groupEl = document.getElementById(`bookshelf-group-${tag}`);
            if (groupEl) {
                groupEl.style.display = 'none';
            }
        });
        
        // 隐藏所有自定义分类分组
        customCategories.forEach(cat => {
            const groupEl = document.getElementById(`bookshelf-group-cat_${cat.id}`);
            if (groupEl) {
                groupEl.style.display = 'none';
            }
        });

        // 排序
        const sorted = sortBooks(filteredBooks, window.App.currentBookshelfSort || 'recent');
        
        // 渲染所有书籍到统一列表
        unifiedList.innerHTML = sorted.map(book => 
            renderBookItem(book, batchMode)
        ).join('');

        // 绑定事件
        bindBookItemEvents(unifiedList);
    }

    // 渲染单个书籍项
    function renderBookItem(book, showCheckbox = false) {
        const progress = window.App.calculateProgress(book.current_chapter, book.total_chapters);
        const progressText = window.App.formatProgress(book.current_chapter, book.total_chapters);
        const readingTime = window.App.formatReadingTime(book.reading_time);
        const lastRead = window.App.formatLastRead(book.last_read_at);
        const isSelected = selectedBooks.has(book.book_id);
        
        // 获取分类名称
        let tagName = '未分类';
        let tagColor = { bg: '#f5f5f5', color: '#757575', icon: '📦' };
        
        if (book.category_id && categoriesMap[book.category_id]) {
            const category = categoriesMap[book.category_id];
            tagName = category.name;
            tagColor = {
                bg: category.color || '#e3f2fd',
                color: '#1976d2',
                icon: category.icon || '📚'
            };
        } else {
            // 使用预设标签
            const allTags = getAllTags();
            const progress = window.App.calculateProgress(book.current_chapter, book.total_chapters);
            let autoTag = 'default';
            if (book.is_read === 1) {
                autoTag = 'finished';
            } else if (progress > 0 && progress < 100) {
                autoTag = 'reading';
            } else if (progress === 0) {
                autoTag = 'to-read';
            }
            tagName = allTags[autoTag] || '未分类';
        }
        
        // 如果还没有设置颜色，使用预设颜色
        if (!tagColor || tagColor.bg === '#f5f5f5') {
            const tagColors = {
                '阅读中': { bg: '#e3f2fd', color: '#1976d2', icon: '📖' },
                '待读': { bg: '#fff3e0', color: '#f57c00', icon: '📚' },
                '已读完': { bg: '#e8f5e9', color: '#388e3c', icon: '✅' },
                '已弃': { bg: '#fce4ec', color: '#c2185b', icon: '🗑️' },
                '未分类': { bg: '#f5f5f5', color: '#757575', icon: '📦' }
            };
            const presetColor = tagColors[tagName];
            if (presetColor) {
                tagColor = presetColor;
            }
        }

        // 使用类似全站书库的简洁卡片样式
        return `
            <div class="book-card bookshelf-card ${isSelected ? 'selected' : ''}" 
                 data-book-id="${book.book_id}" 
                 data-current-chapter="${book.current_chapter}"
                 data-category-id="${book.category_id || ''}">
                ${showCheckbox ? `
                    <input type="checkbox" class="book-checkbox" 
                           ${isSelected ? 'checked' : ''} 
                           data-book-id="${book.book_id}">
                ` : ''}
                <div class="book-card-body">
                    <img class="book-cover" 
                         src="${book.cover || window.App.defaultCover}" 
                         alt="${window.App.escapeHtml(book.title)}" 
                         loading="lazy" 
                         onerror="this.src='${window.App.defaultCover}'">
                    <div class="book-info">
                        <div class="book-title">${window.App.escapeHtml(book.title)}</div>
                        <div class="book-author">${window.App.escapeHtml(book.author || "未知作者")}</div>
                        ${progress > 0 ? `
                            <div class="book-progress-info">
                                <span class="progress-text">${progressText}</span>
                                <div class="progress-bar-mini">
                                    <div class="progress-fill" style="width: ${progress}%"></div>
                                </div>
                            </div>
                        ` : ''}
                        <div class="book-meta">
                            <span class="meta-item" title="阅读时长">⏱️ ${readingTime}</span>
                            ${lastRead ? `<span class="meta-item" title="最后阅读">${lastRead}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="book-card-footer">
                    ${!showCheckbox ? `
                        <button class="btn btn-sm btn-outline btn-tag-select" title="选择分类" style="position: relative;">
                            <span class="tag-badge-inline" style="background: ${tagColor.bg}; color: ${tagColor.color}; padding: 4px 8px; border-radius: 12px; font-size: 11px;">
                                ${tagColor.icon} ${tagName}
                            </span>
                        </button>
                        <button class="btn btn-sm btn-primary btn-continue-reading" title="${book.current_chapter > 0 ? '继续阅读' : '开始阅读'}">
                            ${book.current_chapter > 0 ? '继续' : '开始'}
                        </button>
                        <button class="btn btn-sm btn-outline btn-remove-book" title="从书架移除">
                            <svg fill="currentColor" viewBox="0 0 20 20" width="16" height="16">
                                <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // 绑定书籍项事件
    function bindBookItemEvents(container) {
        container.querySelectorAll('.bookshelf-card').forEach(item => {
            const bookId = item.dataset.bookId;

            // 批量模式：复选框
            const checkbox = item.querySelector('.book-checkbox');
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        selectedBooks.add(bookId);
                        item.classList.add('selected');
                    } else {
                        selectedBooks.delete(bookId);
                        item.classList.remove('selected');
                    }
                    updateBatchCount();
                });
            }

            // 点击卡片（非批量模式）
            if (!batchMode) {
                item.addEventListener('click', (e) => {
                    // 如果点击的是按钮，不跳转
                    if (e.target.closest('button')) return;
                    window.location.href = `/book-detail.html?id=${bookId}`;
                });

                // 分类选择按钮
                const tagSelectBtn = item.querySelector('.btn-tag-select');
                if (tagSelectBtn) {
                    tagSelectBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        showTagSelectMenu(tagSelectBtn, bookId);
                    });
                }

                // 继续阅读按钮
                const continueBtn = item.querySelector('.btn-continue-reading');
                if (continueBtn) {
                    continueBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const chapter = parseInt(item.dataset.currentChapter) || 0;
                        window.location.href = `/reader.html?bookId=${bookId}&chapter=${chapter}`;
                    });
                }

                // 移除按钮
                const removeBtn = item.querySelector('.btn-remove-book');
                if (removeBtn) {
                    removeBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (confirm('确定要从书架中移除这本书吗？')) {
                            try {
                                await window.App.removeFromBookshelf(bookId);
                                renderSmartBookshelf();
                            } catch (error) {
                                console.error('移除失败:', error);
                                alert('移除失败，请重试');
                            }
                        }
                    });
                }
            }
        });
    }

    // 显示标签选择菜单
    function showTagSelectMenu(badgeElement, bookId) {
        // 移除旧的菜单
        document.querySelectorAll('.tag-select-menu').forEach(m => m.remove());

        const allTags = getAllTags();
        const menu = document.createElement('div');
        menu.className = 'tag-select-menu';
        menu.style.cssText = `
            position: absolute;
            background: var(--md-surface-container-high);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            padding: 8px 0;
            z-index: 10000;
            min-width: 140px;
            max-height: 300px;
            overflow-y: auto;
        `;

        const tagOptions = Object.entries(allTags)
            .filter(([key]) => key !== 'all')
            .map(([key, label]) => {
                return `<div class="tag-menu-item" data-tag="${key}">${label}</div>`;
            })
            .join('');

        menu.innerHTML = tagOptions;

        // 计算菜单位置
        const rect = badgeElement.getBoundingClientRect();
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 5}px`;

        document.body.appendChild(menu);

        // 绑定菜单项点击事件
        menu.querySelectorAll('.tag-menu-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const tag = item.dataset.tag;
                await updateBookTag(bookId, tag);
                menu.remove();
            });
        });

        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !badgeElement.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    }

    // 更新单本书的分类
    async function updateBookTag(bookId, tag) {
        try {
            // 如果是预设标签，不更新分类（categoryId设为null）
            let categoryId = null;
            if (tag && tag.startsWith('cat_')) {
                categoryId = parseInt(tag.replace('cat_', ''));
            }
            
            const response = await fetch(`/api/bookshelf/${bookId}/category`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ categoryId })
            });

            if (!response.ok) {
                throw new Error('更新失败');
            }

            // 重新加载书架数据
            await window.App.loadBookshelf();
            
            if (window.App.showToast) {
                window.App.showToast('分类已更新', 'success');
            } else {
                console.log('分类已更新');
            }
        } catch (error) {
            console.error('更新分类失败:', error);
            if (window.App.showToast) {
                window.App.showToast('更新失败，请重试', 'error');
            } else {
                alert('更新失败，请重试');
            }
        }
    }

    // 排序书籍
    function sortBooks(books, sortType) {
        const sorted = [...books];
        switch (sortType) {
            case 'recent':
                sorted.sort((a, b) => {
                    const timeA = a.last_read_at ? new Date(a.last_read_at).getTime() : 0;
                    const timeB = b.last_read_at ? new Date(b.last_read_at).getTime() : 0;
                    return timeB - timeA;
                });
                break;
            case 'progress':
                sorted.sort((a, b) => {
                    const progressA = window.App.calculateProgress(a.current_chapter, a.total_chapters);
                    const progressB = window.App.calculateProgress(b.current_chapter, b.total_chapters);
                    return progressB - progressA;
                });
                break;
            case 'time':
                sorted.sort((a, b) => (b.reading_time || 0) - (a.reading_time || 0));
                break;
            case 'added':
                sorted.sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
                break;
        }
        return sorted;
    }

    // 更新批量操作计数
    function updateBatchCount() {
        const countEl = document.getElementById('batch-count');
        if (countEl) {
            countEl.textContent = selectedBooks.size;
        }
    }

    // 批量更新分类
    async function batchUpdateTag(bookIds, tag) {
        try {
            // 如果是预设标签，不更新分类（categoryId设为null）
            let categoryId = null;
            if (tag && tag.startsWith('cat_')) {
                categoryId = parseInt(tag.replace('cat_', ''));
            }
            
            const response = await fetch('/api/bookshelf/batch/category', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ bookIds, categoryId })
            });

            if (!response.ok) {
                throw new Error('更新失败');
            }

            await window.App.loadBookshelf();
            selectedBooks.clear();
            window.App.showToast('分类已更新', 'success');
        } catch (error) {
            console.error('批量更新分类失败:', error);
            window.App.showToast('更新失败，请重试', 'error');
        }
    }

    // 批量标记已读/未读
    async function batchMarkAsRead(bookIds, isRead) {
        try {
            const response = await fetch('/api/bookshelf/batch/mark', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ bookIds, isRead })
            });

            if (!response.ok) {
                throw new Error('标记失败');
            }

            await window.App.loadBookshelf();
            selectedBooks.clear();
            window.App.showToast(isRead ? '已标记为已读' : '已标记为未读', 'success');
        } catch (error) {
            console.error('批量标记失败:', error);
            window.App.showToast('标记失败，请重试', 'error');
        }
    }

    // 强制隐藏旧容器
    function forceHideOldContainer() {
        const oldContainer = document.getElementById('bookshelf-list');
        if (oldContainer) {
            oldContainer.style.display = 'none';
            oldContainer.style.visibility = 'hidden';
            oldContainer.style.position = 'absolute';
            oldContainer.style.left = '-9999px';
        }
    }
    
    // 等待DOM加载完成后初始化
    function doInit() {
        // 立即隐藏旧容器
        forceHideOldContainer();
        
        // 确保App对象已加载
        if (!window.App) {
            setTimeout(doInit, 100);
            return;
        }
        
        // 确保DOM已准备好
        if (!document.getElementById('bookshelf-container')) {
            setTimeout(doInit, 100);
            return;
        }
        
        init().then(() => {
            // 再次确保旧容器被隐藏
            forceHideOldContainer();
            
            // 初始化完成后，如果书架数据已存在，立即渲染
            if (window.App.bookshelfData) {
                bookshelfData = window.App.bookshelfData;
                renderSmartBookshelf();
            }
        });
    }

    // 立即尝试初始化
    forceHideOldContainer(); // 立即执行一次
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', doInit);
    } else {
        // DOM已加载，立即初始化
        doInit();
    }
    
    // 监听App的loadBookshelf完成事件
    const checkAndWrap = () => {
        if (window.App && window.App.loadBookshelf && !window.App.loadBookshelf._smartBookshelfWrapped) {
            const originalLoadBookshelf = window.App.loadBookshelf;
            window.App.loadBookshelf = async function(...args) {
                const result = await originalLoadBookshelf.apply(this, args);
                // 强制隐藏旧容器
                forceHideOldContainer();
                // 如果智能书架已初始化，触发重新渲染
                if (window.SmartBookshelf && document.getElementById('bookshelf-container')) {
                    bookshelfData = this.bookshelfData || [];
                    renderSmartBookshelf();
                }
                return result;
            };
            window.App.loadBookshelf._smartBookshelfWrapped = true;
        } else if (!window.App) {
            setTimeout(checkAndWrap, 100);
        }
    };
    checkAndWrap();

    // 导出到全局
    window.SmartBookshelf = {
        init: function() {
            init();
        },
        render: renderSmartBookshelf,
        getAllTags,
        loadCategories,
        getCategories: () => customCategories
    };

})();

