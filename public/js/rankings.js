// 排行榜页面脚本

const Rankings = {
    currentType: 'favorites',
    
    init() {
        this.bindEvents();
        this.loadRankings('favorites');
    },
    
    bindEvents() {
        // 标签切换
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const type = e.target.dataset.type;
                this.switchTab(type);
            });
        });
    },
    
    switchTab(type) {
        // 更新激活状态
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.type === type);
        });
        
        // 加载数据
        this.currentType = type;
        this.loadRankings(type);
    },
    
    async loadRankings(type) {
        const container = document.getElementById('ranking-list');
        container.innerHTML = '<div class="loading">加载中...</div>';
        
        try {
            const response = await fetch(`/api/rankings/${type}?limit=100`);
            if (!response.ok) {
                throw new Error('加载失败');
            }
            
            const books = await response.json();
            
            if (books.length === 0) {
                container.innerHTML = '<div class="empty">暂无数据</div>';
                return;
            }
            
            this.renderBooks(books, type);
        } catch (error) {
            console.error('加载排行榜失败:', error);
            container.innerHTML = '<div class="empty">加载失败，请稍后重试</div>';
        }
    },
    
    renderBooks(books, type) {
        const container = document.getElementById('ranking-list');
        
        const statLabelMap = {
            'favorites': '收藏',
            'comments': '留言',
            'monthly': '月人气',
            'total': '总人气',
            'latest': '更新时间'
        };
        
        const statLabel = statLabelMap[type] || '';
        
        container.innerHTML = books.map((book, index) => {
            const rank = index + 1;
            const rankClass = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
            
            let statValue = '';
            if (type === 'favorites') {
                statValue = this.formatNumber(book.favorites_count);
            } else if (type === 'comments') {
                statValue = this.formatNumber(book.comments_count);
            } else if (type === 'monthly') {
                statValue = this.formatNumber(book.monthly_popularity);
            } else if (type === 'total') {
                statValue = this.formatNumber(book.total_popularity);
            } else if (type === 'latest') {
                statValue = book.latest_chapter_date || '-';
            }
            
            const cover = book.cover || '/img/no-cover.png';
            const detailUrl = `https://www.po18.tw/books/${book.book_id}`;
            
            return `
                <div class="book-item" onclick="window.open('${detailUrl}', '_blank')">
                    <div class="rank ${rankClass}">${rank}</div>
                    <div class="book-cover">
                        <img src="${cover}" alt="${this.escapeHtml(book.title)}" onerror="this.src='/img/no-cover.png'">
                    </div>
                    <div class="book-info">
                        <div class="book-title">${this.escapeHtml(book.title)}</div>
                        <div class="book-author">作者：${this.escapeHtml(book.author || '未知')}</div>
                        <div class="book-meta">
                            <span>${this.formatNumber(book.total_chapters || 0)} 章</span>
                            <span>${this.formatNumber(book.word_count || 0)} 字</span>
                            <span>${this.getStatusText(book.status)}</span>
                            ${book.latest_chapter_name ? `<span>最新：${this.escapeHtml(book.latest_chapter_name)}</span>` : ''}
                        </div>
                    </div>
                    <div class="book-stats">
                        <div class="stat-value">${statValue}</div>
                        <div class="stat-label">${statLabel}</div>
                    </div>
                </div>
            `;
        }).join('');
    },
    
    formatNumber(num) {
        if (!num) return '0';
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + 'w';
        }
        return num.toString();
    },
    
    getStatusText(status) {
        const map = {
            'completed': '完结',
            'ongoing': '连载',
            'unknown': '未知'
        };
        return map[status] || status || '未知';
    },
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    Rankings.init();
});
