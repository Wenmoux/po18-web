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
    
    // 初始化
    async init() {
        // 从URL获取书籍ID
        const params = new URLSearchParams(window.location.search);
        this.bookId = params.get('id');
        
        if (!this.bookId) {
            this.showToast('缺少书籍ID', 'error');
            setTimeout(() => window.location.href = 'index.html', 2000);
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
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });
        
        // 开始阅读
        document.getElementById('btn-read')?.addEventListener('click', () => {
            this.startReading();
        });
        
        // 章节列表
        document.getElementById('btn-chapters')?.addEventListener('click', () => {
            this.switchTab('chapters');
        });
        
        // 下载书籍
        document.getElementById('btn-download')?.addEventListener('click', () => {
            this.showDownloadModal();
        });
        
        // 章节倒序
        document.getElementById('reverse-chapters')?.addEventListener('change', (e) => {
            this.renderChapters(e.target.checked);
        });
        
        // 阅读器控制
        document.getElementById('reader-close')?.addEventListener('click', () => {
            this.closeReader();
        });
        
        document.getElementById('btn-prev-chapter')?.addEventListener('click', () => {
            this.prevChapter();
        });
        
        document.getElementById('btn-next-chapter')?.addEventListener('click', () => {
            this.nextChapter();
        });
        
        document.getElementById('btn-reader-prev')?.addEventListener('click', () => {
            this.prevChapter();
        });
        
        document.getElementById('btn-reader-next')?.addEventListener('click', () => {
            this.nextChapter();
        });
        
        // 下载弹窗
        document.getElementById('download-close')?.addEventListener('click', () => {
            this.hideDownloadModal();
        });
        
        document.getElementById('cancel-download')?.addEventListener('click', () => {
            this.hideDownloadModal();
        });
        
        document.getElementById('confirm-download')?.addEventListener('click', () => {
            this.startDownload();
        });
        
        // 预加载按钮
        document.getElementById('btn-preload')?.addEventListener('click', () => {
            this.preloadAllChapters();
        });
        
        // 阅读器关闭按钮
        document.getElementById('reader-close-btn')?.addEventListener('click', () => {
            document.getElementById('reader-modal').classList.remove('active');
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
            // 使用解析接口获取书籍详情
            const response = await fetch('/api/parse/book', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',  // 添加认证信息
                body: JSON.stringify({ bookId: this.bookId })
            });
            
            if (!response.ok) {
                throw new Error('解析失败');
            }
            
            const data = await response.json();
            this.bookData = data;
            this.renderBookInfo();
        } catch (error) {
            console.error('加载书籍数据失败:', error);
            this.showToast('加载失败', 'error');
        }
    },
    
    // 渲染书籍信息
    renderBookInfo() {
        if (!this.bookData) return;
        
        document.getElementById('book-title').textContent = this.bookData.title || '未知书名';
        document.getElementById('book-author').textContent = this.bookData.author || '未知作者';
        document.getElementById('book-status').textContent = this.bookData.status || '未知';
        document.getElementById('book-chapters').textContent = this.bookData.chapterCount || '-';
        
        // 缓存章节数（从章节列表计算）
        const cachedCount = this.chapters.filter(c => c.hasCached).length;
        document.getElementById('book-cached-chapters').textContent = cachedCount || '0';
        document.getElementById('book-words').textContent = this.formatNumber(this.bookData.wordCount || 0);
        document.getElementById('book-free-chapters').textContent = this.bookData.freeChapters || '-';
        document.getElementById('book-paid-chapters').textContent = this.bookData.paidChapters || '-';
        document.getElementById('book-latest-chapter').textContent = this.bookData.latestChapterName || '-';
        document.getElementById('book-latest-date').textContent = this.bookData.latestChapterDate || '-';
        document.getElementById('book-favorites').textContent = this.formatNumber(this.bookData.favoritesCount || 0);
        document.getElementById('book-comments').textContent = this.formatNumber(this.bookData.commentsCount || 0);
        document.getElementById('book-popularity').textContent = this.formatNumber(this.bookData.monthlyPopularity || 0);
        
        // 书名显示在阅读器中
        document.getElementById('reader-book-title').textContent = this.bookData.title;
        
        // 封面
        const cover = document.getElementById('book-cover');
        if (this.bookData.cover) {
            cover.src = this.bookData.cover;
        } else {
            cover.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjI4MCIgZmlsbD0iI0ZGRDBEQyIvPjx0ZXh0IHg9IjEwMCIgeT0iMTQwIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNiIgZmlsbD0iI0ZGOEJBNyIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Tm8gQ292ZXI8L3RleHQ+PC9zdmc+';
        }
        
        // 简介
        const description = this.bookData.description || '暂无简介';
        document.getElementById('book-description').innerHTML = description.replace(/\n/g, '<br>');
        
        // 标签
        const tagsContainer = document.getElementById('book-tags');
        tagsContainer.innerHTML = '';
        if (this.bookData.tags) {
            const tags = typeof this.bookData.tags === 'string' 
                ? this.bookData.tags.split(/[,·、]/).filter(t => t.trim())
                : this.bookData.tags;
            
            tags.forEach(tag => {
                const tagEl = document.createElement('span');
                tagEl.className = 'tag';
                tagEl.textContent = tag.trim();
                tagsContainer.appendChild(tagEl);
            });
        }
        
        // 更新页面标题
        document.title = `${this.bookData.title} - PO18书库`;
    },
    
    // 加载章节列表
    async loadChapters() {
        try {
            // 先从数据库获取缓存章节
            const response = await fetch('/api/parse/chapters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ bookId: this.bookId, cacheOnly: true })  // 只读缓存
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || '获取章节列表失败');
            }
            
            const data = await response.json();
            this.chapters = data.chapters || [];
            
            document.getElementById('total-chapters').textContent = this.chapters.length;
            this.renderChapters(false);
            
            // 更新缓存章节数
            this.renderBookInfo();
            
            // 如果没有缓存章节，提示用户
            if (this.chapters.length === 0) {
                this.showToast('暂无缓存章节，点击预加载获取', 'info');
            }
        } catch (error) {
            console.error('加载章节列表失败:', error);
            this.showToast(error.message || '章节列表加载失败', 'error');
        }
    },
    
    // 单章上传至缓存
    async uploadSingleChapter(chapter) {
        try {
            this.showToast(`正在上传《${chapter.title}》...`, 'info');
            
            const response = await fetch('/api/parse/chapter-content', {
                method: 'POST',
                credentials: 'include',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapter.chapterId
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || '上传失败');
            }
            
            const data = await response.json();
            
            if (data.fromCache) {
                this.showToast('该章节已在缓存中', 'info');
            } else {
                this.showToast(`《${chapter.title}》上传成功！`, 'success');
                // 更新章节状态
                chapter.hasCached = true;
                // 重新渲染章节列表
                this.renderChapters(false);
                // 更新缓存章节数
                this.renderBookInfo();
            }
        } catch (error) {
            console.error('上传章节失败:', error);
            this.showToast(error.message || '上传失败', 'error');
        }
    },
    
    // 渲染章节列表
    renderChapters(reverse = false) {
        const container = document.getElementById('chapters-list');
        container.innerHTML = '';
        
        const chapters = reverse ? [...this.chapters].reverse() : this.chapters;
        
        chapters.forEach((chapter, index) => {
            const div = document.createElement('div');
            div.className = 'chapter-item';
            
            // 判断是否锁定（付费且未购买且无缓存）
            const isLocked = chapter.isLocked || false;
            if (isLocked) {
                div.classList.add('locked');
            }
            
            // 有缓存的不显示边框，用云图标表示
            // if (chapter.hasCached) {
            //     div.style.borderLeft = '3px solid #4CAF50';
            // }
            
            const titleSpan = document.createElement('span');
            titleSpan.className = 'chapter-title';
            titleSpan.textContent = chapter.title || `第${index + 1}章`;
            
            div.appendChild(titleSpan);
            
            if (isLocked) {
                const lockIcon = document.createElement('span');
                lockIcon.className = 'chapter-lock';
                lockIcon.textContent = '🔒';
                div.appendChild(lockIcon);
            } else if (chapter.hasCached) {
                // 有缓存显示云图标
                const cloudIcon = document.createElement('span');
                cloudIcon.className = 'chapter-cloud';
                cloudIcon.textContent = '☁️';
                cloudIcon.title = '已缓存';
                div.appendChild(cloudIcon);
            } else if (chapter.isPurchased || !chapter.isPaid) {
                // 已购买但未缓存，显示上传图标
                const uploadIcon = document.createElement('span');
                uploadIcon.className = 'chapter-upload';
                uploadIcon.textContent = '📤';
                uploadIcon.title = '上传该章至缓存';
                uploadIcon.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.uploadSingleChapter(chapter);
                });
                div.appendChild(uploadIcon);
            }
            
            div.addEventListener('click', () => {
                // 直接尝试读取，后端会优先从缓存读取（跨用户共享）
                this.readChapter(reverse ? this.chapters.length - 1 - index : index);
            });
            
            container.appendChild(div);
        });
    },
    
    // 加载评论
    async loadComments(page = 1) {
        try {
            const response = await fetch('/api/parse/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ bookId: this.bookId, page })
            });
            
            if (!response.ok) {
                throw new Error('获取评论失败');
            }
            
            const data = await response.json();
            this.comments = data.comments || [];
            this.currentCommentPage = data.currentPage || page;
            this.totalCommentPages = data.totalPages || 1;
            
            this.renderComments();
        } catch (error) {
            console.error('加载评论失败:', error);
            this.comments = [];
            this.renderComments();
        }
    },
    
    // 渲染评论
    renderComments() {
        const container = document.getElementById('comments-list');
        
        container.innerHTML = '';
        
        if (!this.comments || this.comments.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--md-on-surface-variant); padding: 40px 0;">暂无评论</p>';
            return;
        }
        
        // 直接使用后端返回的当前页评论，不需要前端分页
        this.comments.forEach(comment => {
            const div = document.createElement('div');
            div.className = 'comment-item';
            // 使用 author 和 time 字段，并添加安全检查
            const author = comment.author || '匿名用户';
            const time = comment.time || '';
            const content = comment.content || '';
            
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
        const container = document.getElementById('comments-pagination');
        container.innerHTML = '';
        
        if (this.totalCommentPages <= 1) return;
        
        // 上一页
        const prevBtn = document.createElement('button');
        prevBtn.className = 'page-btn';
        prevBtn.textContent = '上一页';
        prevBtn.disabled = this.currentCommentPage === 1;
        prevBtn.addEventListener('click', () => {
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
                const pageBtn = document.createElement('button');
                pageBtn.className = 'page-btn';
                if (i === this.currentCommentPage) {
                    pageBtn.classList.add('active');
                }
                pageBtn.textContent = i;
                pageBtn.addEventListener('click', () => {
                    this.loadComments(i);
                });
                container.appendChild(pageBtn);
            } else if (
                i === this.currentCommentPage - 3 || 
                i === this.currentCommentPage + 3
            ) {
                const dots = document.createElement('span');
                dots.textContent = '...';
                dots.style.padding = '0 8px';
                container.appendChild(dots);
            }
        }
        
        // 下一页
        const nextBtn = document.createElement('button');
        nextBtn.className = 'page-btn';
        nextBtn.textContent = '下一页';
        nextBtn.disabled = this.currentCommentPage === this.totalCommentPages;
        nextBtn.addEventListener('click', () => {
            if (this.currentCommentPage < this.totalCommentPages) {
                this.loadComments(this.currentCommentPage + 1);
            }
        });
        container.appendChild(nextBtn);
    },
    
    // 切换标签页
    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tabName}`);
        });
    },
    
    // 开始阅读
    startReading() {
        if (this.chapters.length === 0) {
            this.showToast('暂无章节', 'warning');
            return;
        }
        this.readChapter(0);
    },
    
    // 阅读章节
    async readChapter(index) {
        if (index < 0 || index >= this.chapters.length) return;
        
        this.currentChapterIndex = index;
        const chapter = this.chapters[index];
        
        // 显示阅读器
        document.getElementById('reader-modal').classList.add('active');
        document.getElementById('reader-title').textContent = chapter.title || `第${index + 1}章`;
        document.getElementById('reader-progress').textContent = `${index + 1}/${this.chapters.length}`;
        document.getElementById('reader-content').innerHTML = '<p style="text-align: center; padding: 40px 0;">加载中...</p>';
        
        try {
            // 加载章节内容（后端会优先从缓存读取）
            const response = await fetch('/api/parse/chapter-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ 
                    bookId: this.bookId,
                    chapterId: chapter.chapterId 
                })
            });
            
            // 如果返回400/401，可能是未购买且无缓存
            if (response.status === 400 || response.status === 500) {
                const errorData = await response.json().catch(() => ({}));
                if (chapter.isPaid && !chapter.isPurchased) {
                    document.getElementById('reader-modal').classList.remove('active');
                    this.showPurchaseConfirm(chapter);
                    return;
                }
                throw new Error(errorData.error || '加载失败');
            }
            
            if (!response.ok) {
                throw new Error('加载失败');
            }
            
            const data = await response.json();
            
            if (data.html) {
                document.getElementById('reader-content').innerHTML = data.html;
            } else if (data.text) {
                const paragraphs = data.text.split('\n').filter(p => p.trim());
                const html = paragraphs.map(p => `<p>${p}</p>`).join('');
                document.getElementById('reader-content').innerHTML = html;
            } else {
                document.getElementById('reader-content').innerHTML = '<p style="text-align: center;">内容加载失败</p>';
            }
            
            // 预加载下一章
            if (index + 1 < this.chapters.length) {
                this.preloadChapter(index + 1);
            }
        } catch (error) {
            console.error('加载章节内容失败:', error);
            document.getElementById('reader-content').innerHTML = '<p style="text-align: center; color: var(--md-error);">加载失败</p>';
        }
    },
    
    // 预加载章节
    async preloadChapter(index) {
        if (index < 0 || index >= this.chapters.length) return;
        
        const chapter = this.chapters[index];
        if (chapter.isPaid && !chapter.isPurchased) return;
        
        try {
            await fetch('/api/parse/chapter-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',  // 添加认证信息
                body: JSON.stringify({ 
                    bookId: this.bookId,
                    chapterId: chapter.chapterId 
                })
            });
        } catch (error) {
            console.error('预加载失败:', error);
        }
    },
    
    // 上一章
    prevChapter() {
        if (this.currentChapterIndex > 0) {
            this.readChapter(this.currentChapterIndex - 1);
        } else {
            this.showToast('已经是第一章了', 'info');
        }
    },
    
    // 下一章
    nextChapter() {
        if (this.currentChapterIndex < this.chapters.length - 1) {
            this.readChapter(this.currentChapterIndex + 1);
        } else {
            this.showToast('已经是最后一章了', 'info');
        }
    },
    
    // 关闭阅读器
    closeReader() {
        document.getElementById('reader-modal').classList.remove('active');
    },
    
    // 显示购买确认
    showPurchaseConfirm(chapter) {
        // TODO: 实现购买接口
        if (confirm(`该章节需要购买，是否前往购买？\n章节：${chapter.title}`)) {
            this.showToast('购买功能开发中...', 'info');
            // window.open(`https://www.po18.tw/books/${this.bookId}/articles/${chapter.chapterId}`);
        }
    },
    
    // 显示下载弹窗
    showDownloadModal() {
        document.getElementById('download-modal').classList.add('active');
    },
    
    // 隐藏下载弹窗
    hideDownloadModal() {
        document.getElementById('download-modal').classList.remove('active');
    },
    
    // 开始下载
    async startDownload() {
        const format = document.querySelector('input[name="download-format"]:checked').value;
        
        document.getElementById('download-progress').style.display = 'block';
        document.getElementById('confirm-download').disabled = true;
        
        try {
            // 添加到下载队列
            const queueResponse = await API.queue.add(this.bookId, format);
            const queueId = queueResponse.queueId;
            
            // 开始下载
            await API.queue.startDownload(queueId);
            
            // 订阅进度
            const watcher = API.queue.subscribeProgress(queueId, async (data) => {
                console.log('下载进度事件:', data);
                
                if (data.type === 'progress') {
                    document.getElementById('progress-fill').style.width = `${data.percent}%`;
                    document.getElementById('progress-text').textContent = `${data.percent}% (${data.completed}/${data.total})`;
                } else if (data.type === 'completed') {
                    console.log('下载完成，生成文件:', data);
                    document.getElementById('progress-fill').style.width = '100%';
                    document.getElementById('progress-text').textContent = '生成文件中...';
                    
                    // 生成文件
                    if (data.chapters && data.detail) {
                        console.log(`开始生成${format}文件, 章节数:`, data.chapters.length);
                        console.log('前3章数据示例:', data.chapters.slice(0, 3).map(c => ({
                            title: c.title,
                            htmlLength: c.html?.length || 0,
                            textLength: c.text?.length || 0,
                            error: c.error
                        })));
                        
                        let blob;
                        if (format === 'epub') {
                            blob = await FileGenerator.generateEpub(data.detail, data.chapters);
                        } else {
                            blob = FileGenerator.generateTxt(data.detail, data.chapters);
                        }
                        console.log('文件生成完成，大小:', blob.size, '字节');
                        FileGenerator.download(blob, data.fileName);
                        this.showToast('下载完成！', 'success');
                    } else {
                        console.error('缺少数据:', { chapters: !!data.chapters, detail: !!data.detail });
                        this.showToast('数据错误，无法生成文件', 'error');
                    }
                    
                    watcher.close();
                    this.hideDownloadModal();
                    document.getElementById('download-progress').style.display = 'none';
                    document.getElementById('confirm-download').disabled = false;
                    document.getElementById('progress-fill').style.width = '0%';
                } else if (data.type === 'error') {
                    this.showToast('下载失败: ' + data.error, 'error');
                    watcher.close();
                    this.hideDownloadModal();
                    document.getElementById('download-progress').style.display = 'none';
                    document.getElementById('confirm-download').disabled = false;
                }
            });
        } catch (error) {
            console.error('下载失败:', error);
            this.showToast('下载失败', 'error');
            document.getElementById('download-progress').style.display = 'none';
            document.getElementById('confirm-download').disabled = false;
        }
    },
    
    // 格式化数字
    formatNumber(num) {
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + '万';
        }
        return num.toString();
    },
    
    // HTML转义，防止XSS
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    // 预加载所有章节（实时进度）
    async preloadAllChapters() {
        const btn = document.getElementById('btn-preload');
        const progressEl = document.getElementById('preload-progress');
        const fillEl = document.getElementById('preload-fill');
        const textEl = document.getElementById('preload-text');
        
        try {
            // 首先从网站获取最新章节列表
            this.showToast('正在获取章节列表...', 'info');
            const listResponse = await fetch('/api/parse/chapters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ bookId: this.bookId, cacheOnly: false })  // 从网站获取
            });
            
            if (!listResponse.ok) {
                const errorData = await listResponse.json().catch(() => ({}));
                this.showToast(errorData.error || '获取章节列表失败', 'error');
                return;
            }
            
            const listData = await listResponse.json();
            const chapters = listData.chapters || [];
            
            if (chapters.length === 0) {
                this.showToast('没有可预加载的章节', 'info');
                return;
            }
            
            // 更新章节列表
            this.chapters = chapters;
            document.getElementById('total-chapters').textContent = this.chapters.length;
            this.renderChapters(false);
            
            // 只预加载已购买章节
            const purchasedChapters = chapters.filter(c => !c.isPaid || c.isPurchased);
            
            if (purchasedChapters.length === 0) {
                this.showToast('没有已购买的章节', 'info');
                return;
            }
            
            // 显示进度条
            progressEl.style.display = 'block';
            btn.disabled = true;
            
            let completed = 0;
            let successCount = 0;
            let failCount = 0;
            
            // 串行下载并更新进度
            for (const chapter of purchasedChapters) {
                try {
                    // 下载章节（后端会优先从缓存读取，支持跨用户共享）
                    const response = await fetch('/api/parse/chapter-content', {
                        method: 'POST',
                        credentials: 'include',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({bookId: this.bookId, chapterId: chapter.chapterId})
                    });
                    
                    // Cookie失效时停止预加载
                    if (response.status === 401 || response.status === 400) {
                        const errorData = await response.json().catch(() => ({}));
                        this.showToast(errorData.error || 'Cookie已过期，请重新设置', 'error');
                        progressEl.style.display = 'none';
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
                        failCount++;
                    }
                } catch (err) {
                    console.error(`下载章节失败: ${chapter.chapterId}`, err);
                    failCount++;
                }
                
                completed++;
                const percent = (completed / purchasedChapters.length * 100).toFixed(0);
                fillEl.style.width = percent + '%';
                textEl.textContent = `${completed}/${purchasedChapters.length}`;
                
                // 限速
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            this.showToast(`预加载完成！成功 ${successCount} 个，失败 ${failCount} 个`, successCount > 0 ? 'success' : 'warning');
            
            // 2秒后隐藏进度条
            setTimeout(() => {
                progressEl.style.display = 'none';
                btn.disabled = false;
            }, 2000);
        } catch (error) {
            console.error('预加载失败:', error);
            this.showToast('预加载失败', 'error');
            progressEl.style.display = 'none';
            btn.disabled = false;
        }
    },
    
    // 显示提示
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    
    // 模拟评论数据（用于测试）
    getMockComments() {
        return [
            { username: '用户1', date: '2024-12-14', content: '很好看！' },
            { username: '用户2', date: '2024-12-13', content: '剧情紧凑，人物刻画生动' },
            { username: '用户3', date: '2024-12-12', content: '期待更新' }
        ];
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    BookDetail.init();
});
   