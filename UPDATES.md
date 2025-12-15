# 详情页优化更新说明

## 已完成修改

### 1. UI优化 ✅
- book-detail.css: 缩小封面和整体尺寸
- book-detail.html: 添加更多字段显示（免费章节、付费章节、最新章节、更新时间）
- 阅读器中间显示书名

### 2. 阅读器优化 ✅  
- 工具栏中间显示书名
- Footer添加关闭按钮，避免误触
- 需添加关闭按钮事件

### 3. 预加载进度显示 ✅
- HTML已添加进度显示组件
- CSS已添加样式
- 需修改preloadAllChapters()函数实现实时进度

## 待完成修改（需手动添加）

### 4. 关闭按钮事件
在book-detail.js的bindEvents()中添加：
```javascript
document.getElementById('reader-close-btn')?.addEventListener('click', () => {
    document.getElementById('reader-modal').classList.remove('active');
});
```

### 5. 预加载实时进度
修改preloadAllChapters()函数：
```javascript
async preloadAllChapters() {
    const btn = document.getElementById('btn-preload');
    const progressEl = document.getElementById('preload-progress');
    const fillEl = document.getElementById('preload-fill');
    const textEl = document.getElementById('preload-text');
    
    // 显示进度条
    progressEl.style.display = 'block';
    
    // 获取章节列表
    const chapters = this.chapters.filter(c => !c.isPaid || c.isPurchased);
    let completed = 0;
    
    // 串行下载并更新进度
    for (const chapter of chapters) {
        if (ChapterCacheDB.exists(this.bookId, chapter.chapterId)) {
            completed++;
            continue;
        }
        
        // 下载章节
        await fetch('/api/parse/chapter-content', {
            method: 'POST',
            credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({bookId: this.bookId, chapterId: chapter.chapterId})
        });
        
        completed++;
        const percent = (completed / chapters.length * 100).toFixed(0);
        fillEl.style.width = percent + '%';
        textEl.textContent = `${completed}/${chapters.length}`;
    }
    
    // 完成后隐藏
    setTimeout(() => {
        progressEl.style.display = 'none';
    }, 2000);
}
```

### 6. 下载从数据库读取
修改routes.js的/download/start，在下载章节内容前先检查缓存：
```javascript
// 下载章节内容，优先从缓存
const contents = [];
for (const chapter of chapters) {
    // 先从缓存获取
    const cached = ChapterCacheDB.get(queueItem.book_id, chapter.chapterId);
    if (cached) {
        contents.push({
            title: cached.title,
            html: cached.html,
            text: cached.text,
            error: false
        });
        console.log(`从缓存读取: ${chapter.chapterId}`);
    } else {
        // 缓存不存在，从网站下载
        const content = await crawler.getChapterContent(queueItem.book_id, chapter.chapterId);
        contents.push(content);
    }
}
```

### 7. 预加载使用共享缓存
修改/parse/chapter-content，移除isPurchased检查，允许读取共享缓存：
```javascript
// 先从缓存获取（不检查是否购买）
const cached = ChapterCacheDB.get(bookId, chapterId);
if (cached) {
    console.log(`从缓存读取章节: ${bookId}/${chapterId}`);
    return res.json({
        html: cached.html || '',
        text: cached.text || '',
        title: cached.title || '',
        fromCache: true
    });
}

// 缓存不存在时才检查是否有权限
const user = UserDB.findById(req.session.userId);
if (!user || !user.po18_cookie) {
    return res.status(400).json({ error: '请先设置PO18 Cookie' });
}

// 检查是否已购买（如果是付费章节）
// 这里需要从章节列表判断isPaid和isPurchased
```

### 8. 阅读器不自动关闭
修改CSS中modal-overlay点击事件，不再关闭：
```javascript
// 删除或注释bindEvents中的这段代码：
/*
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('active');
        }
    });
});
*/
```

## 建议
重启服务器后测试所有功能，特别是：
1. 预加载进度实时显示
2. 下载使用缓存内容
3. 阅读器不误关闭
4. 详情字段显示完整
