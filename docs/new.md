# 新功能记录

## 功能恢复与增强 - 折叠卡片、精华过滤、分享排行榜

**更新日期：** 2025-12-22
**版本：** 20251222v

### 功能概述

本次更新全面恢复了之前丢失的功能，并新增了多个增强特性：

1. **“我的”页面折叠卡片重构**
   - 所有区域采用折叠卡片设计
   - 设置项移至折叠卡片内
   - 折叠状态自动保存

2. **分享排行榜功能**
   - 完整的前后端实现
   - 24小时缓存机制
   - 每天凌晨1点自动更新

3. **精华过滤功能**
   - 支持屏蔽作者、关键词、分类
   - 应用于搜索、排行榜、全站书库
   - 可选显示过滤提示

4. **阅读页多样式功能**
   - 5种标题样式（默认、优雅、古典、现代、简约）
   - 5种正文样式（默认、书信、聊天、古籍、诗歌）
   - 繁简转换功能

---

### 一、折叠卡片重构

#### 1.1 HTML 结构

**位置：** `public/index.html`

**折叠卡片结构：**
```html
<div class="collapsible-card glass-card" data-section="account-settings">
    <div class="card-header" onclick="App.toggleSection('account-settings')">
        <div class="header-left">
            <span class="header-icon">⚙️</span>
            <span class="header-title">账号设置</span>
        </div>
        <span class="toggle-icon">▼</span>
    </div>
    <div class="card-content collapsed" id="section-account-settings">
        <!-- 内容区域 -->
    </div>
</div>
```

**四个折叠卡片：**
1. **阅读统计热力图** (`data-section="reading-stats"`)
2. **成就徽章** (`data-section="achievements"`)
3. **数据统计** (`data-section="stats-dashboard"`)
4. **分享排行榜** (`data-section="share-ranking"`) - 新增
5. **账号设置** (`data-section="account-settings"`) - 新增

#### 1.2 CSS 样式

**位置：** `public/css/style.css` （末尾新增）

**关键样式：**
```css
/* 折叠卡片 */
.collapsible-card {
    margin-bottom: 16px;
    overflow: hidden;
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    cursor: pointer;
    transition: background-color 0.2s;
}

.card-content {
    max-height: 2000px;
    overflow: hidden;
    transition: max-height 0.3s ease, opacity 0.3s ease;
    opacity: 1;
    padding: 0 16px 16px;
}

.card-content.collapsed {
    max-height: 0;
    opacity: 0;
    padding: 0 16px;
}

.toggle-icon {
    transition: transform 0.3s;
}

.toggle-icon.collapsed {
    transform: rotate(-90deg);
}
```

#### 1.3 JavaScript 逻辑

**位置：** `public/js/app.js`

**新增方法：**

```javascript
// 初始化折叠卡片
initCollapsibleCards() {
    const savedStates = JSON.parse(localStorage.getItem('cardStates') || '{}');
    
    document.querySelectorAll('.collapsible-card').forEach(card => {
        const section = card.dataset.section;
        const content = card.querySelector('.card-content');
        const icon = card.querySelector('.toggle-icon');
        
        if (section && savedStates[section] === false) {
            content?.classList.add('collapsed');
            icon?.classList.add('collapsed');
        } else {
            content?.classList.remove('collapsed');
            icon?.classList.remove('collapsed');
        }
    });
}

// 切换卡片展开/折叠
toggleSection(section) {
    const card = document.querySelector(`[data-section="${section}"]`);
    if (!card) return;
    
    const content = card.querySelector('.card-content');
    const icon = card.querySelector('.toggle-icon');
    
    const isCollapsed = content.classList.contains('collapsed');
    
    if (isCollapsed) {
        content.classList.remove('collapsed');
        icon?.classList.remove('collapsed');
    } else {
        content.classList.add('collapsed');
        icon?.classList.add('collapsed');
    }
    
    // 保存状态
    const savedStates = JSON.parse(localStorage.getItem('cardStates') || '{}');
    savedStates[section] = !isCollapsed;
    localStorage.setItem('cardStates', JSON.stringify(savedStates));
}
```

---

### 二、分享排行榜功能

#### 2.1 后端 API

**位置：** `server/routes.js`

**路由：** `GET /api/share/ranking`

**功能：**
- 查询分享数据最多的100位用户
- 24小时缓存，每天凌晨1点自动更新
- 只显示开启共享且有分享数据的用户

**实现：**
```javascript
// 缓存变量
let shareRankingCache = null;
let shareRankingCacheTime = null;
const SHARE_RANKING_CACHE_DURATION = 24 * 60 * 60 * 1000;

// API 路由
router.get("/share/ranking", requireLogin, async (req, res) => {
    try {
        // 检查缓存
        if (shareRankingCache && shareRankingCacheTime && 
            (Date.now() - shareRankingCacheTime < SHARE_RANKING_CACHE_DURATION)) {
            return res.json(shareRankingCache);
        }
        
        // 查询排行榜
        const rankings = db.prepare(`
            SELECT 
                u.username,
                COALESCE(uss.total_shared_books, 0) as sharedBooks,
                COALESCE(uss.total_shared_chapters, 0) as sharedChapters
            FROM users u
            LEFT JOIN user_share_stats uss ON u.id = uss.user_id
            WHERE u.share_enabled = 1 
              AND COALESCE(uss.total_shared_books, 0) > 0
            ORDER BY sharedBooks DESC, sharedChapters DESC
            LIMIT 100
        `).all();
        
        const result = { ranking: rankings };
        shareRankingCache = result;
        shareRankingCacheTime = Date.now();
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "获取排行榜失败" });
    }
});

// 定时清理缓存（每天凌晨1点）
function scheduleRankingCacheClear() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(1, 0, 0, 0);
    
    const timeUntilClear = tomorrow - now;
    
    setTimeout(() => {
        shareRankingCache = null;
        shareRankingCacheTime = null;
        setInterval(() => {
            shareRankingCache = null;
            shareRankingCacheTime = null;
        }, 24 * 60 * 60 * 1000);
    }, timeUntilClear);
}
```

#### 2.2 前端实现

**HTML：**
```html
<div class="collapsible-card glass-card" data-section="share-ranking">
    <div class="card-header" onclick="App.toggleSection('share-ranking')">
        <div class="header-left">
            <span class="header-icon">🏆</span>
            <span class="header-title">分享排行榜</span>
        </div>
        <span class="toggle-icon">▼</span>
    </div>
    <div class="card-content collapsed" id="section-share-ranking">
        <div id="share-ranking-list" class="ranking-list"></div>
    </div>
</div>
```

**JavaScript：**
```javascript
// 加载排行榜
async loadShareRanking() {
    try {
        const response = await fetch('/api/share/ranking', {
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error('加载排行榜失败');
        
        const data = await response.json();
        this.renderShareRanking(data.ranking);
    } catch (error) {
        console.error('加载分享排行榜失败:', error);
    }
}

// 渲染排行榜
renderShareRanking(ranking) {
    const container = document.getElementById('share-ranking-list');
    if (!container) return;
    
    if (!ranking || ranking.length === 0) {
        container.innerHTML = '<div class="empty-state">📊 暂无排行数据</div>';
        return;
    }
    
    const html = ranking.map((user, index) => {
        const rank = index + 1;
        let rankBadge = '';
        
        if (rank === 1) rankBadge = '<span class="rank-badge gold">🥇</span>';
        else if (rank === 2) rankBadge = '<span class="rank-badge silver">🥈</span>';
        else if (rank === 3) rankBadge = '<span class="rank-badge bronze">🥉</span>';
        else rankBadge = `<span class="rank-number">${rank}</span>`;
        
        return `
            <div class="ranking-item">
                <div class="ranking-rank">${rankBadge}</div>
                <div class="ranking-info">
                    <div class="ranking-username">${user.username}</div>
                    <div class="ranking-stats">
                        📚 ${user.sharedBooks} 本书籍 · 📖 ${user.sharedChapters} 章节
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = html;
}
```

---

### 三、精华过滤功能

#### 3.1 设置界面

**位置：** “我的”页面 → 账号设置卡片 → 精华过滤

**HTML 结构：**
```html
<div class="setting-item-new">
    <div class="setting-header" onclick="App.toggleFilterSettings()">
        <div class="setting-info">
            <div class="setting-title">🎯 精华过滤</div>
            <div class="setting-desc">过滤不感兴趣的内容</div>
        </div>
        <label class="switch" onclick="event.stopPropagation();">
            <input type="checkbox" id="filter-enabled" onchange="App.toggleFilter(this.checked)">
            <span class="slider round"></span>
        </label>
    </div>
    <div class="setting-detail collapsed" id="filter-detail">
        <div class="filter-section">
            <label class="filter-label">屏蔽作者（逗号分隔）</label>
            <textarea id="filter-authors" class="filter-textarea"></textarea>
        </div>
        <div class="filter-section">
            <label class="filter-label">屏蔽关键词（逗号分隔）</label>
            <textarea id="filter-keywords" class="filter-textarea"></textarea>
        </div>
        <div class="filter-section">
            <label class="filter-label">屏蔽分类（逗号分隔）</label>
            <textarea id="filter-categories" class="filter-textarea"></textarea>
        </div>
        <div class="filter-section">
            <label class="switch-label">
                <input type="checkbox" id="filter-show-tip" checked>
                <span>显示过滤提示</span>
            </label>
        </div>
        <button class="btn btn-primary" onclick="App.saveFilterSettings()">保存过滤设置</button>
    </div>
</div>
```

#### 3.2 Toggle Switch 样式

**CSS：**
```css
.switch {
    position: relative;
    display: inline-block;
    width: 48px;
    height: 24px;
}

.switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--md-surface-container-high);
    transition: 0.3s;
}

.slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.3s;
}

input:checked + .slider {
    background-color: var(--md-primary);
}

input:checked + .slider:before {
    transform: translateX(24px);
}

.slider.round {
    border-radius: 24px;
}

.slider.round:before {
    border-radius: 50%;
}
```

#### 3.3 JavaScript 逻辑

**数据存储：**
```javascript
// localStorage key: 'contentFilter'
{
    enabled: true,
    authors: ['author1', 'author2'],
    keywords: ['keyword1', 'keyword2'],
    categories: ['category1', 'category2'],
    showTip: true
}
```

**核心方法：**
```javascript
// 加载过滤设置
loadFilterSettings() {
    const settings = JSON.parse(localStorage.getItem('contentFilter') || '{}');
    
    document.getElementById('filter-enabled').checked = settings.enabled || false;
    document.getElementById('filter-authors').value = (settings.authors || []).join(',');
    document.getElementById('filter-keywords').value = (settings.keywords || []).join(',');
    document.getElementById('filter-categories').value = (settings.categories || []).join(',');
    document.getElementById('filter-show-tip').checked = settings.showTip !== false;
}

// 保存过滤设置
saveFilterSettings() {
    const settings = {
        enabled: document.getElementById('filter-enabled').checked,
        authors: document.getElementById('filter-authors').value.split(',').map(s => s.trim()).filter(s => s),
        keywords: document.getElementById('filter-keywords').value.split(',').map(s => s.trim()).filter(s => s),
        categories: document.getElementById('filter-categories').value.split(',').map(s => s.trim()).filter(s => s),
        showTip: document.getElementById('filter-show-tip').checked
    };
    
    localStorage.setItem('contentFilter', JSON.stringify(settings));
    this.showToast('过滤设置已保存', 'success');
}

// 应用过滤
applyContentFilter(books) {
    const settings = JSON.parse(localStorage.getItem('contentFilter') || '{}');
    
    if (!settings.enabled) return books;
    
    const filtered = books.filter(book => {
        // 过滤作者
        if (settings.authors && settings.authors.some(author => 
            book.author && book.author.includes(author))) {
            return false;
        }
        
        // 过滤关键词
        if (settings.keywords && settings.keywords.some(keyword => {
            const searchText = `${book.title || ''} ${book.author || ''} ${book.description || ''}`;
            return searchText.includes(keyword);
        })) {
            return false;
        }
        
        // 过滤分类
        if (settings.categories && settings.categories.some(category => {
            if (Array.isArray(book.categories)) {
                return book.categories.includes(category);
            } else if (book.category) {
                return book.category.includes(category);
            }
            return false;
        })) {
            return false;
        }
        
        return true;
    });
    
    // 显示过滤提示
    if (settings.showTip && filtered.length < books.length) {
        const filteredCount = books.length - filtered.length;
        this.showToast(`已过滤 ${filteredCount} 本书籍`, 'info');
    }
    
    return filtered;
}
```

**应用位置：**
1. 搜索结果：`doSearch()` 方法
2. 排行榜：`loadRankings()` 方法  
3. 全站书库：`loadGlobalLibrary()` 方法

---

### 四、设置项交互增强

#### 4.1 共享设置 Toggle Switch

**HTML：**
```html
<div class="setting-item-new" id="open-share-settings">
    <div class="setting-header">
        <div class="setting-info">
            <div class="setting-title">🤝 共享设置</div>
            <div class="setting-desc">启用共享功能，与他人分享书籍</div>
        </div>
        <label class="switch">
            <input type="checkbox" id="share-toggle">
            <span class="slider round"></span>
        </label>
    </div>
</div>
```

**JavaScript：**
```javascript
// 初始化设置项
initSettingItems() {
    const shareToggle = document.getElementById('share-toggle');
    if (shareToggle) {
        this.loadShareStatus();
        shareToggle.addEventListener('change', async (e) => {
            await this.toggleShare(e.target.checked);
        });
    }
}

// 加载共享状态
async loadShareStatus() {
    try {
        const response = await fetch('/api/user/share-status', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            document.getElementById('share-toggle').checked = data.shareEnabled;
        }
    } catch (error) {
        console.error('加载共享状态失败:', error);
    }
}

// 切换共享状态
async toggleShare(enabled) {
    try {
        const response = await fetch('/api/user/toggle-share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ enabled })
        });
        
        if (response.ok) {
            this.showToast(enabled ? '共享已启用' : '共享已关闭', 'success');
        } else {
            throw new Error('设置失败');
        }
    } catch (error) {
        console.error('切换共享状态失败:', error);
        this.showToast('设置失败，请重试', 'error');
        document.getElementById('share-toggle').checked = !enabled;
    }
}
```

---

### 五、初始化流程

**`app.js` init() 方法：**
```javascript
async init() {
    this.bindEvents();
    await this.checkAuth();
    this.initSettingsTabs();
    this.setupLazyLoading();
    this.initSearchHistory();
    this.initTheme();
    
    // 新增初始化
    this.initCollapsibleCards();      // 折叠卡片
    this.initSettingItems();          // 设置项交互
    this.loadFilterSettings();        // 精华过滤
    
    // ... 其他初始化
}
```

**loadSettings() 方法：**
```javascript
async loadSettings() {
    try {
        this.updateUserInfoDisplay();
        const stats = await API.userStats.refresh();
        
        // 更新统计显示
        // ...
        
        // 加载阅读统计热力图
        this.loadReadingHeatmap();
        
        // 加载分享排行榜
        this.loadShareRanking();
        
        // 绑定快捷功能事件
        this.bindQuickActions();
    } catch (error) {
        console.error("加载设置失败:", error);
    }
}
```

---

### 六、版本信息

**版本号：** 20251222v

**更新文件：**
1. `public/index.html` - HTML 结构
2. `public/css/style.css` - CSS 样式 (+269行)
3. `public/js/app.js` - JavaScript 逻辑 (+308行)
4. `server/routes.js` - 后端 API
5. `public/service-worker.js` - Service Worker 版本

**缓存更新：**
所有静态资源 URL 已更新为 `?v=20251222v`

---

### 七、测试验证

#### 7.1 功能测试清单

**折叠卡片：**
- [ ] 点击卡片头部可以折叠/展开
- [ ] 折叠状态保存到 localStorage
- [ ] 刷新页面后折叠状态保持
- [ ] 折叠动画流畅

**分享排行榜：**
- [ ] 排行榜数据正常加载
- [ ] 前3名显示奖牌图标
- [ ] 其他排名显示数字
- [ ] 缓存机制正常工作

**精华过滤：**
- [ ] 开关正常切换
- [ ] 设置保存成功
- [ ] 搜索结果应用过滤
- [ ] 排行榜应用过滤
- [ ] 全站书库应用过滤
- [ ] 过滤提示正常显示

**设置项交互：**
- [ ] Toggle Switch 样式正常
- [ ] 共享开关正常工作
- [ ] 设置状态正确显示

#### 7.2 兼容性测试

- [ ] Chrome/Edge 浏览器
- [ ] Firefox 浏览器
- [ ] Safari 浏览器
- [ ] 移动端浏览器
- [ ] 深色模式
- [ ] 响应式布局

---

### 八、注意事项

1. **数据持久化**
   - 折叠状态保存在 `localStorage.cardStates`
   - 过滤设置保存在 `localStorage.contentFilter`
   - 清除浏览器数据会丢失设置

2. **性能优化**
   - 排行榜使用24小时缓存
   - 过滤功能在前端执行，大列表可能有轻微延迟
   - CSS 动画使用 GPU 加速

3. **用户体验**
   - 折叠卡片默认折叠，减少页面长度
   - 过滤提示可关闭，避免频繁打扰
   - Toggle Switch 提供更直观的开关体验

4. **后续扩展**
   - 过滤设置可同步到服务端
   - 排行榜可增加更多统计维度
   - 折叠卡片可支持更多区域

---

### 九、代码统计

**新增代码：**
- HTML: ~120 行
- CSS: ~270 行
- JavaScript: ~310 行
- 后端: ~80 行

**总计：** ~780 行

**核心文件修改：**
- `public/index.html`
- `public/css/style.css`
- `public/js/app.js`
- `server/routes.js`

---

**更新日期：** 2025-12-22
**版本：** 20251222v

### 功能概述

为阅读页添加了全面的样式切换功能，包括标题样式、正文样式和繁简转换，所有设置自动保存并持久化。

### 核心功能

#### 1. 标题样式切换（5种）

**默认样式**
- 简洁的居中标题
- 底部边框装饰

**优雅样式**
- 渐变背景色
- 圆角卡片设计
- 顶部装饰符号 ✦
- Georgia 字体，更有书卷气

**古典样式**
- 楷体字体
- 双线边框装饰
- 古铜色配色

**现代样式**
- 渐变粉色背景
- 圆角卡片 + 阴影
- 白色文字 + 高光效果
- 现代感强烈

**简约样式**
- 极简设计
- 顶部装饰线
- 底部细线

#### 2. 正文样式切换（5种）

**默认样式**
- 标准排版
- 2em 首行缩进

**书信样式**
- 宋体字体
- 类纸质渐变背景
- 圆角卡片 + 边框
- 两端对齐

**聊天样式**
- 对话气泡效果
- 奇偶段落交替左右对齐
- 不同背景色区分
- 80% 最大宽度

**古籍样式**
- 楷体字体
- 类羊皮纸背景
- 古铜色边框
- 纹理装饰

**诗歌样式**
- 居中对齐
- 较大行高（2.5）
- 左右边框装饰
- 适合诗歌排版

#### 3. 繁简转换

**功能**
- 不转换：保持原文
- 简转繁：简体中文 → 繁体中文
- 繁转简：繁体中文 → 简体中文

**实现**
- 使用字符映射表
- 保存原始文本
- 支持实时切换

### 技术实现

#### HTML 修改 (reader.html)

添加了三组设置选项：
```html
<!-- 标题样式 -->
<div class="setting-group">
    <label class="setting-label">标题样式</label>
    <div class="setting-options">
        <button class="option-btn active" data-title-style="default">默认</button>
        <button class="option-btn" data-title-style="elegant">优雅</button>
        <button class="option-btn" data-title-style="classic">古典</button>
        <button class="option-btn" data-title-style="modern">现代</button>
        <button class="option-btn" data-title-style="minimal">简约</button>
    </div>
</div>

<!-- 正文样式 -->
<div class="setting-group">
    <label class="setting-label">正文样式</label>
    <div class="setting-options">
        <button class="option-btn active" data-content-style="default">默认</button>
        <button class="option-btn" data-content-style="letter">书信</button>
        <button class="option-btn" data-content-style="chat">聊天</button>
        <button class="option-btn" data-content-style="ancient">古籍</button>
        <button class="option-btn" data-content-style="poetry">诗歌</button>
    </div>
</div>

<!-- 繁简转换 -->
<div class="setting-group">
    <label class="setting-label">繁简转换</label>
    <div class="setting-options">
        <button class="option-btn active" data-text-convert="none">不转换</button>
        <button class="option-btn" data-text-convert="s2t">简转繁</button>
        <button class="option-btn" data-text-convert="t2s">繁转简</button>
    </div>
</div>
```

#### CSS 修改 (reader.css)

**关键点**
1. 使用 `!important` 确保样式优先级
2. 同时支持类名和 ID 选择器
3. 添加伪元素装饰
4. 渐变背景和阴影效果

**示例**：
```css
/* 优雅样式 */
#chapter-title[data-title-style="elegant"] {
    background: linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%) !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08) !important;
}

/* 书信样式 */
#chapter-content[data-content-style="letter"] {
    background: linear-gradient(to bottom, #fdfcf9 0%, #fffef5 100%) !important;
    padding: 32px !important;
}
```

#### JavaScript 修改 (reader.js)

**设置对象扩展**
```javascript
settings: {
    // ... 现有设置
    titleStyle: "default",
    contentStyle: "default",
    textConvert: "none"
}
```

**事件绑定**
```javascript
// 标题样式
document.querySelectorAll("[data-title-style]").forEach((btn) => {
    btn.addEventListener("click", () => {
        this.settings.titleStyle = btn.dataset.titleStyle;
        this.applySettings();
        this.saveSettings();
    });
});
```

**应用设置**
```javascript
applySettings() {
    // 应用标题样式
    const chapterTitle = document.getElementById("chapter-title");
    if (chapterTitle) {
        chapterTitle.setAttribute("data-title-style", this.settings.titleStyle);
    }
    
    // 应用正文样式
    const chapterContent = document.getElementById("chapter-content");
    if (chapterContent) {
        chapterContent.setAttribute("data-content-style", this.settings.contentStyle);
    }
}
```

**繁简转换**
```javascript
applyTextConversion() {
    const content = document.getElementById("chapter-content");
    // 保存原始文本
    if (!content.dataset.originalText) {
        content.dataset.originalText = content.innerHTML;
    }
    
    // 根据设置转换
    if (this.settings.textConvert === 's2t') {
        // 简转繁
    } else if (this.settings.textConvert === 't2s') {
        // 繁转简
    }
}
```

### 使用方法

1. 打开任意书籍的阅读页
2. 点击右下角菜单按钮
3. 在设置面板中选择：
   - 标题样式：5种选项
   - 正文样式：5种选项
   - 繁简转换：3种选项
4. 设置立即生效并自动保存

### 注意事项

1. **背景色问题**：使用 `!important` 解决 CSS 优先级问题
2. **样式冲突**：同时支持 `.chapter-title` 和 `#chapter-title` 选择器
3. **持久化**：所有设置保存到 localStorage
4. **繁简转换**：当前为示例实现，需要完整字符映射表才能完全支持

---

## Service Worker 响应流修复

**更新日期：** 2025-12-22
**版本：** 20251222u

### 问题描述

前端加载首页时出现错误：`TypeError: Failed to execute 'json' on 'Response': body stream already read`

**错误原因：**
Service Worker 的 `apiCacheStrategy` 和 `cdnCacheStrategy` 方法在缓存响应时，使用了 `response.clone().body` 创建新的 Response 对象，这会消耗掉原始 response 的 body stream。当返回原始 response 时，其 body 已经被读取，导致前端代码无法再次读取。

### 修复方案

**文件：** `public/service-worker.js`

**修改内容：**
```javascript
// 修复前（错误）
const response = await fetch(request);
if (response.ok) {
    const clonedResponse = response.clone();
    // 使用 clonedResponse.body 会消耗原始 response 的 body
    const modifiedResponse = new Response(clonedResponse.body, {...});
    cache.put(request, modifiedResponse);
}
return response; // ❌ body 已被消耗

// 修复后（正确）
const response = await fetch(request);
if (response.ok) {
    // 先克隆用于返回
    const responseToReturn = response.clone();
    // 再克隆用于缓存
    const clonedResponse = response.clone();
    const modifiedResponse = new Response(clonedResponse.body, {...});
    cache.put(request, modifiedResponse);
    return responseToReturn; // ✅ 返回未消耗的克隆
}
return response;
```

**影响范围：**
- `apiCacheStrategy()` - API 请求缓存
- `cdnCacheStrategy()` - CDN 资源缓存

### 测试验证

**受影响的接口：**
- `/api/shared-library/list` - 共享书库列表
- `/api/rankings/favorites` - 热门书籍
- `/api/rankings/recent` - 最近更新

**验证方法：**
1. 清除浏览器缓存和 Service Worker
2. 刷新首页
3. 检查控制台是否还有 `body stream already read` 错误
4. 确认首页数据正常加载

---

## 分享章节计算说明

**更新日期：** 2025-12-22

### 数据来源

分享章节数据存储在 `user_share_stats` 表中：

**表结构：**
```sql
CREATE TABLE IF NOT EXISTS user_share_stats (
    user_id INTEGER PRIMARY KEY,
    total_shared_chapters INTEGER DEFAULT 0,  -- 分享的章节总数
    total_shared_books INTEGER DEFAULT 0,      -- 分享的书籍总数
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

### 更新机制

**自动更新触发点：**

1. **用户上传章节时** (通过油猴脚本或前端界面)
   - 路由：`POST /parse/chapters`
   - 代码位置：`server/routes.js` 第 3641、3718 行
   - 调用：`SharedDB.recordChapterShare(uploaderId, bookId, chapterId, title, uploaderId)`

2. **用户手动分享章节时**
   - 路由：`POST /share/chapter`
   - 代码位置：`server/routes.js` 第 4796 行
   - 调用：`SharedDB.recordChapterShare(userId, bookId, chapterId, chapterTitle)`

3. **预加载完成后批量分享**
   - 路由：`POST /share/preload-chapters`
   - 代码位置：`server/routes.js` 第 4820 行
   - 调用：`SharedDB.recordChapterShare(userId, bookId, chapter.id, chapter.title, uploaderId)`

**更新逻辑：** (database.js 第 943-982 行)
```javascript
SharedDB.updateUserShareStats(userId, isBook=false, isChapter=true)
// 执行 SQL: UPDATE user_share_stats SET total_shared_chapters = total_shared_chapters + 1
```

### 查询接口

**1. 用户统计接口**
- **路由：** `GET /api/user/stats`
- **返回字段：** `sharedChapters` (来自 `user_share_stats.total_shared_chapters`)
- **代码位置：** `server/routes.js` 第 2712-2735 行

**2. 分享排行榜接口**
- **路由：** `GET /api/share/ranking`
- **返回字段：** `sharedChapters` (来自 `user_share_stats.total_shared_chapters`)
- **代码位置：** `server/routes.js` 第 4258-4290 行

### 注意事项

**重要：** 章节分享统计依赖于正确传递 `uploaderId` 参数：

1. **油猴脚本上传**
   - 必须在请求中包含 `uploaderId` 字段
   - 格式：`{ uploaderId: "user_id_here", ... }`

2. **前端上传**
   - 自动使用 `req.session.userId`
   - 需要用户已登录

3. **数据一致性**
   - `chapter_shares` 表记录每次分享的详细信息
   - `user_share_stats` 表维护汇总统计
   - 两表通过触发器或应用层逻辑保持同步

### 故障排查

**如果分享章节数不更新：**

1. 检查 `uploaderId` 是否正确传递
   ```javascript
   console.log('uploaderId:', uploaderId);
   ```

2. 检查数据库记录
   ```sql
   SELECT * FROM chapter_shares WHERE user_id = ? ORDER BY share_time DESC LIMIT 10;
   SELECT * FROM user_share_stats WHERE user_id = ?;
   ```

3. 检查日志输出
   ```
   [OK] 章节分享已记录: {bookId}/{chapterId}, 用户ID: {uploaderId}
   ```

---

## 多站点支持（PO18 & POPO）

**更新日期：** 2025-12-22

### 功能概述

扩展油猴脚本和前端系统，支持 PO18 和 POPO 两个姐妹网站，实现统一管理和数据互通。

### 核心改动

#### 1. 数据库层

**表结构更新：**
- `book_metadata` 表增加 `platform` 字段（TEXT, DEFAULT 'po18'）
- 用于区分书籍来源站点：`'po18'` 或 `'popo'`

**数据迁移：**
- 自动为旧数据添加 `platform` 列，默认值为 `'po18'`
- 确保向后兼容，不影响现有数据

#### 2. 后端路由（server/routes.js）

**书籍详情 URL 动态生成：**
```javascript
detailUrl: book.platform === 'popo' 
    ? `https://www.popo.tw/books/${book.bookId}`
    : `https://www.po18.tw/books/${book.bookId}/articles`
```

**接口改动：**
- `/api/metadata/batch` - 接收并保存 `platform` 字段
- `/api/search` - 返回书籍时包含 `platform` 字段
- `/api/rankings/*` - 返回书籍时包含 `platform` 字段
- `/api/library` - 返回书籍时包含 `platform` 字段

#### 3. 油猴脚本（scripts/superapi.js）

**站点自动检测：**
```javascript
const CURRENT_SITE = window.location.hostname.includes('popo.tw') ? 'popo' : 'po18';
```

**站点配置对象：**
```javascript
const SITE_CONFIG = {
    po18: {
        name: 'PO18',
        baseUrl: 'https://www.po18.tw',
        icon: '💖',
        detailSelector: 'h1.book_name',
        authorSelector: 'a.book_author',
        chapterListSelector: '#w0>div',
        // ...
    },
    popo: {
        name: 'POPO',
        baseUrl: 'https://www.popo.tw',
        icon: '📚',
        detailSelector: 'h3.title',
        authorSelector: '.b_author a',
        chapterListSelector: '.chapters-list .chapter-item',
        // ...
    }
};
```

**通用解析函数：**
- `fetchBookDetail()` - 根据站点配置解析书籍信息
- `fetchChapterList()` - 根据站点配置获取章节列表
- `fetchChapterContent()` - 根据站点配置获取章节内容
- 所有函数自动适配当前站点

**数据上传：**
- 元信息上传时自动包含 `platform: CURRENT_SITE`
- 后端根据 `platform` 字段区分和存储

#### 4. 前端展示（public/js/app.js & public/index.html）

**站点图标区分：**
```javascript
const platformIcon = book.platform === 'popo' ? '📚' : '💖';
```

**应用位置：**
- ✅ 首页热门推荐
- ✅ 首页最近更新
- ✅ 搜索结果列表
- ✅ 排行榜列表
- ✅ 全站书库列表
- ✅ 书籍详情页"脸红心跳"按钮

**动态跳转：**
- "脸红心跳"按钮根据 `platform` 字段跳转到对应站点
- PO18: `https://www.po18.tw/books/{bookId}/articles`
- POPO: `https://www.popo.tw/books/{bookId}`

**详情页跳转（book-detail.js）：**
```javascript
const platform = this.bookData?.platform || 'po18';
const baseUrl = platform === 'popo' 
    ? 'https://www.popo.tw' 
    : 'https://www.po18.tw';
window.open(`${baseUrl}/books/${this.bookId}`, "_blank");
```

### 技术要点

#### 1. 站点识别
- 油猴脚本通过 `window.location.hostname` 自动识别当前站点
- 前端通过数据库中的 `platform` 字段识别书籍来源

#### 2. 选择器适配
- 不同站点的 DOM 结构不同，使用配置对象统一管理
- 主要差异：
  - 标题选择器：PO18 用 `h1.book_name`，POPO 用 `h3.title`
  - 章节列表：PO18 用 `#w0>div`，POPO 用 `.chapters-list .chapter-item`
  - 内容获取：PO18 用 `/articlescontent/`，POPO 用 `/articles/`

#### 3. URL 规则差异
- PO18 章节内容：`/books/{bookId}/articlescontent/{chapterId}` （返回纯内容）
- POPO 章节内容：`/books/{bookId}/articles/{chapterId}` （返回全页）

#### 4. 图标设计
- PO18：💖（粉色爱心，代表原站特色）
- POPO：📚（书本，代表阅读平台）
- 在所有书籍卡片标题前显示，直观区分来源

### 后续扩展计划

1. **更多姐妹站点支持**
   - 架构已预留扩展性，可轻松添加新站点
   - 只需在 `SITE_CONFIG` 中添加新站点配置

2. **站点筛选功能**
   - 全站书库增加"站点筛选"选项
   - 用户可选择只查看特定站点的书籍

3. **站点统计**
   - "我的"页面显示各站点书籍数量统计
   - 分别统计 PO18 和 POPO 的分享贡献

4. **跨站点搜索优化**
   - 搜索结果按站点分组显示
   - 支持站点优先级排序

### 注意事项

1. **数据一致性**
   - 旧数据默认标记为 `'po18'`，确保向后兼容
   - 新上传的书籍会自动带上正确的 `platform` 标识

2. **用户体验**
   - 图标设计要直观明了，用户能快速识别来源
   - 跳转按钮要准确跳转到对应站点，避免404

3. **性能考虑**
   - 站点判断逻辑简单高效，不影响性能
   - 图标使用 emoji，无需额外加载图片资源

4. **版本管理**
   - 油猴脚本版本更新到 v4.0.0
   - 前端静态资源版本更新到 20251222p
   - Service Worker 缓存版本更新到 20251222p

### 测试要点

#### 功能测试
- [ ] 在 PO18 使用油猴脚本上传，书籍标记为 `platform: 'po18'`
- [ ] 在 POPO 使用油猴脚本上传，书籍标记为 `platform: 'popo'`
- [ ] 搜索结果正确显示站点图标
- [ ] 排行榜正确显示站点图标
- [ ] 全站书库正确显示站点图标
- [ ] "脸红心跳"按钮跳转到正确站点
- [ ] 书籍详情页跳转到正确站点

#### 兼容性测试
- [ ] 旧数据（无 platform 字段）默认显示为 PO18
- [ ] 新旧数据混合显示正常
- [ ] 清除缓存后重新加载正常

### 版本历史

- **v4.0.3** (2025-12-22)
  - 优化书籍详情加载逻辑，优先从数据库获取
  - 新增 `/api/books/:id` 接口，无需登录即可查看数据库中的书籍
  - 只有当数据库中没有时才使用解析功能（需要登录）
  - 避免不必要的原站请求，提升加载速度
  - 修复 401 未授权错误问题

- **v4.0.2** (2025-12-22)
  - 修复 POPO 站点后端解析问题
  - 修复 routes.js 中 `detail` 变量初始化错误
  - Crawler 增加 platform 参数支持，根据站点动态选择 baseUrl
  - 添加站点特定选择器配置，支持 POPO 站点解析
  - 前端解析请求支持传递 platform 参数

- **v4.0.1** (2025-12-22)
  - 修复 POPO 站点章节列表获取问题
  - 更正 POPO 章节列表选择器：`.chapters-list .chapter-item` → `#w0>div`
  - 更正 POPO 章节名选择器：`.chapter-name` → `.c2 a`
  - 优化按钮选择器逻辑，根据站点动态选择

- **v4.0.0** (2025-12-22)
  - 初始多站点支持发布
  - 支持 PO18 和 POPO 双站点
  - 数据库增加 platform 字段
  - 前端全面显示站点图标
  - 动态跳转到对应站点
  - 油猴脚本自动识别站点

---

## 分享排行榜 API

**更新日期：** 2025-12-22

### 功能概述

为“我的”页面数据统计卡片中的“分享排名”功能提供后端接口支持。

### 接口定义

#### GET `/api/share/ranking`

**功能：** 获取分享排行榜

**认证：** 需要登录

**缓存机制：**
- 缓存时间：24小时
- 更新时间：每天凌晨1点自动清空缓存
- 首次请求后缓存结果，24小时内直接返回缓存数据

**响应格式：**
```json
{
  "ranking": [
    {
      "username": "用户名",
      "sharedBooks": 123,
      "sharedChapters": 456
    }
  ]
}
```

**排序规则：**
1. 按分享书籍数（sharedBooks）降序
2. 如果书籍数相同，按分享章节数（sharedChapters）降序
3. 最多返回 100 位用户

**筛选条件：**
- 只显示已启用共享功能的用户（`share_enabled = 1`）
- 只显示至少分享了1本书的用户

### 数据源

从 `user_share_stats` 表获取数据：
- `total_shared_books`: 用户分享的总书籍数
- `total_shared_chapters`: 用户分享的总章节数

### 实现细节

**文件：** `server/routes.js`

**缓存变量：**
```javascript
let shareRankingCache = null;
let shareRankingCacheTime = null;
const SHARE_RANKING_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时
```

**定时任务：**
- `scheduleRankingCacheClear()` 函数计算到明天1点的时间
- 使用 `setTimeout` 设置首次执行
- 使用 `setInterval` 设置每姦24小时重复执行

**SQL 查询：**
```sql
SELECT 
    u.username,
    COALESCE(uss.total_shared_books, 0) as sharedBooks,
    COALESCE(uss.total_shared_chapters, 0) as sharedChapters
FROM users u
LEFT JOIN user_share_stats uss ON u.id = uss.user_id
WHERE u.share_enabled = 1 
    AND COALESCE(uss.total_shared_books, 0) > 0
ORDER BY sharedBooks DESC, sharedChapters DESC
LIMIT 100
```

### 前端集成

**API 调用：** `public/js/api.js`
```javascript
getRanking() {
    return API.get("/share/ranking");
}
```

**显示逻辑：** `public/js/app.js`
- 在 `loadShareRanking()` 方法中调用 API
- 查找当前用户在排行榜中的位置
- 在 `#share-ranking` 元素中显示排名（如 `#1`、`#5` 或 `未上榜`）

### 性能优化

1. **缓存机制**
   - 首次查询后缓存结果
   - 24小时内直接返回缓存，无需重复查询数据库
   - 减少数据库压力

2. **定时更新**
   - 每天凌晨1点自动清空缓存
   - 确保数据每姩更新一次
   - 避免高峰期更新

3. **数据量控制**
   - 最多返回 100 位用户
   - 减少数据传输量

### 注意事项

1. **数据一致性**
   - `user_share_stats` 表需要通过其他机制实时更新
   - 排行榜数据每姩更新一次，非实时数据

2. **错误处理**
   - 前端静默失败，不影响其他功能
   - 404 错误使用 `console.debug` 而不是 `console.error`

3. **服务器重启**
   - 重启后缓存清空，首次请求会重新查询数据库
   - 定时任务自动重新设置

### 版本历史

- **v1.0.0** (2025-12-22)
  - 初始版本发布
  - 支持基本的排行榜查询
  - 实现24小时缓存机制
  - 每姩凌晨1点自动更新

---

## UI 大重构 - 设置整合与折叠卡片

**更新日期：** 2025-12-21

### 功能概述

本次重构将所有设置项从顶部弹窗移至“我的”页面，采用折叠卡片设计，优化用户体验。

#### 主要改动：

1. **移除顶部弹窗**
   - 删除 `settings-modal` 弹窗（PO18 Cookie、WebDAV、共享功能）
   - 移除相关的事件监听器（`open-po18-settings`、`open-webdav-settings`、`open-share-settings`）

2. **设置整合到“我的”页面**
   - 在“我的”页面新增“账号设置”折叠卡片
   - 集成 PO18 Cookie、WebDAV配置、共享功能、精华过滤四大设置项

3. **引入折叠卡片设计**
   - 页面分为四个折叠卡片：阅读统计、数据统计、成就徽章、账号设置
   - 默认全部折叠，点击头部展开/折叠
   - 折叠状态保存到 localStorage

4. **开关按钮代替弹窗**
   - 共享功能：使用 Toggle Switch 代替原有的复选框
   - 精华过滤：使用 Toggle Switch，开启后展开详细设置

5. **分享排行榜实装**
   - 在数据统计卡片中显示分享排行榜
   - 从 API 获取排行数据并渲染

### 文件修改

#### 1. HTML 修改 (`public/index.html`)

**删除内容：**
- 删除 `settings-modal` 弹窗（约 105 行）
- 从编辑资料弹窗中移除精华过滤设置（约 48 行）

**新增内容：**

```html
<!-- 折叠卡片结构 -->
<div class="collapsible-card glass-card" data-section="account-settings">
    <div class="card-header" onclick="App.toggleSection('account-settings')">
        <div class="header-left">
            <span class="header-icon">⚙️</span>
            <span class="header-title">账号设置</span>
        </div>
        <span class="toggle-icon">▼</span>
    </div>
    <div class="card-content" id="section-account-settings">
        <!-- 设置项列表 -->
    </div>
</div>

<!-- 单个设置项结构 -->
<div class="setting-item-new">
    <div class="setting-header">
        <div class="setting-info">
            <div class="setting-title">🔑 PO18 Cookie</div>
            <div class="setting-desc">配置PO18账号Cookie以获取已购书籍</div>
        </div>
        <span class="status-badge" id="po18-status">未设置</span>
    </div>
    <div class="setting-detail" id="po18-detail" style="display: none;">
        <!-- 详细设置内容 -->
    </div>
</div>
```

#### 2. CSS 修改 (`public/css/style.css`)

**新增样式（约 230 行）：**

```css
/* 折叠卡片 */
.collapsible-card {
    margin-bottom: 12px;
    border-radius: 10px;
    overflow: hidden;
    transition: all 0.3s ease;
}

.collapsible-card.collapsed .card-content {
    max-height: 0;
    padding: 0 16px;
    opacity: 0;
}

/* Toggle Switch */
.switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
}

input:checked + .slider {
    background-color: var(--md-primary);
}

/* 设置项 */
.setting-item-new {
    padding: 16px 0;
    border-bottom: 1px solid var(--md-outline-variant);
}

/* 排行榜 */
.ranking-item {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    background: var(--md-surface-variant);
    border-radius: 8px;
}
```

#### 3. JavaScript 修改 (`public/js/app.js`)

**新增方法：**

```javascript
// 折叠卡片功能
collapsedSections: new Set(["reading-stats", "stats-dashboard", "achievements", "account-settings"]),

toggleSection(sectionName) {
    // 切换折叠/展开状态
    // 保存到 localStorage
},

initCollapsibleCards() {
    // 加载折叠状态
    // 应用到 DOM
},

// 设置项交互
toggleSettingDetail(detailId) {
    // 展开/收起设置详情
},

initSettingItems() {
    // 初始化所有设置项的事件监听
    // PO18 Cookie、WebDAV、共享功能、精华过滤
},

// 分享排行榜
async loadShareRanking() {
    // 从 API 获取排行数据
    // 渲染到页面
}
```

**修改的方法：**

```javascript
// loadSettings() - 添加初始化调用
async loadSettings() {
    // ... 原有代码
    
    // 初始化折叠卡片和设置项
    this.initCollapsibleCards();
    this.initSettingItems();
    
    // 加载分享排行榜
    await this.loadShareRanking();
}

// showSettingsModal() - 重定向到“我的”页面
showSettingsModal() {
    this.navigateTo('settings');
    // 展开账号设置区域
}

// saveFilterSettingsFromUI() - 使用新的 ID
saveFilterSettingsFromUI() {
    const enabledEl = document.getElementById("filter-enabled-toggle");
    // ...
}
```

**删除的代码：**
- 移除 `open-po18-settings`、`open-webdav-settings`、`open-share-settings` 事件监听器（约 25 行）

### 数据流

#### 折叠卡片状态管理

```
页面加载
  └─ initCollapsibleCards()
       ├─ 从 localStorage 读取 po18_collapsed_sections
       └─ 应用 collapsed class

用户点击卡片头部
  └─ toggleSection(sectionName)
       ├─ 切换 collapsed 状态
       └─ 保存到 localStorage
```

#### 设置项交互流程

```
页面加载
  └─ initSettingItems()
       ├─ 绑定所有设置项事件
       ├─ 同步 toggle 状态
       ├─ 加载已保存的配置
       └─ 应用到 UI

用户点击设置项标题
  └─ toggleSettingDetail(detailId)
       └─ 展开/收起详细设置

用户切换 Toggle
  └─ change 事件
       ├─ 更新 UI 显示
       ├─ 调用 API（如需）
       └─ 保存到 localStorage
```

### API 接口

#### 分享排行榜

```javascript
// 获取排行榜
GET /api/share/ranking

Response:
{
    "ranking": [
        {
            "username": "用户名",
            "sharedBooks": 123
        }
    ]
}
```

### 技术要点

1. **CSS 动画**
   - 使用 `max-height` + `opacity` 实现平滑折叠
   - `transition: all 0.3s ease` 提供顺滑过渡

2. **状态持久化**
   - localStorage 存储折叠犰态
   - 使用 Set 管理折叠区域

3. **事件委托**
   - 点击事件直接在 HTML 中绑定 onclick
   - Switch 事件在 initSettingItems 中统一绑定

4. **响应式设计**
   - 移动端调整内边距和字体大小
   - 保持触摸友好的点击区域

### 版本历史

- **v2.0.0** (2025-12-21)
  - UI 大重构，移除设置弹窗
  - 引入折叠卡片设计
  - 开关按钮代替复选框
  - 实装分享排行榜
  - 更新版本号到 20251221

---

## 精华过滤（内容过滤）

**更新日期：** 2025-12-22

## 功能概述

- 为用户提供跨页面的"精华过滤"能力，用于隐藏不感兴趣的作者、标题关键词或分类标签。
- 作用范围：
  - 搜索结果
  - 排行榜
  - 全站书库
- 支持设置是否弹出"已过滤 X 条记录"的提示。

## 配置入口

- **位置**：主页底部导航「我的」 → 头像卡片右侧按钮「编辑资料」
- **弹窗**：`#profile-edit-modal`
- **表单字段**：
  - `#filter-enabled`：是否启用精华过滤
  - `#filter-show-hints`：是否在搜索/排行榜/全站书库时提示过滤条数
  - `#filter-authors`：屏蔽作者列表（每行一个）
  - `#filter-keywords`：屏蔽标题关键词列表（每行一个）
  - `#filter-categories`：屏蔽分类/标签列表（每行一个）

## 前端实现细节

### 本地存储

- **存储方式**：`localStorage`
- **key**：`po18_filter_settings`
- **数据结构**：

```json
{
  "enabled": true,
  "authors": ["作者A", "作者B"],
  "keywords": ["无CP", "古早"],
  "categories": ["BG", "骨科"],
  "showHints": true
}
```

### 相关代码位置

- **文件**：`public/js/app.js`

主要字段与方法：

```javascript
filterSettingsKey: "po18_filter_settings",
filterSettings: { ... },

loadFilterSettings(),           // 从 localStorage 加载过滤设置
saveFilterSettingsFromUI(),     // 从 UI 表单保存到 localStorage
applyFilterSettingsToUI(),      // 将设置同步到 UI 表单
applyContentFilter(books, context)  // 通用过滤函数
```

### 过滤应用点

#### 1. 搜索结果
- **方法**：`App.renderSearchResults(result)`
- **上游调用**：`App.doSearch(keyword, page)`
- **上屏前使用**：`applyContentFilter(result.books, "search")`

#### 2. 排行榜
- **方法**：`App.renderRankings(books)`
- **上游调用**：`App.loadRankings(type)`
- **上屏前使用**：`applyContentFilter(books, "rankings")`

#### 3. 全站书库
- **方法**：`App.loadGlobalLibrary(reset)`
- **上游调用**：导航进入全站书库、筛选器点击、无限滚动
- **从接口返回后使用**：`applyContentFilter(result.books, "global")`

### 提示策略

当 `showHints = true` 且本次调用中有 `filteredCount > 0` 时：
- **搜索**：`精华过滤已隐藏 X 条搜索结果记录`
- **排行榜**：`精华过滤已隐藏 X 条排行榜记录`
- **全站书库**：`精华过滤已隐藏 X 条全站书库记录`

当所有结果被过滤后，会在对应列表区域展示文案：
- **搜索**：所有结果已被精华过滤规则隐藏，可在"我的" - 编辑资料中调整过滤设置
- **排行榜/书库**：同理

## 接口说明

**本功能为纯前端实现，不涉及后端接口修改。**

所有过滤逻辑在前端完成，不会影响后端返回的数据结构。

## UI 设计

### 编辑资料弹窗新增区块

在「阅读偏好」之后、「保存资料」按钮之前，新增以下表单区域：

1. **精华过滤开关区**
   - 启用精华过滤（全站搜索/排行/书库生效）
   - 搜索/排行榜时提示已过滤条数

2. **屏蔽作者输入区**
   - 多行文本框，每行一个作者名

3. **屏蔽标题关键词输入区**
   - 多行文本框，每行一个关键词

4. **屏蔽分类/标签输入区**
   - 多行文本框，每行一个分类或标签

### 样式说明

- 使用现有的 `.form-group`、`.md-textarea`、`.checkbox-option` 等样式
- 保持与其他设置项一致的视觉风格

## 技术要点

### 过滤算法

1. **标准化处理**：将书籍的作者、标题、标签等字段转为小写进行匹配
2. **包含匹配**：使用 `String.includes()` 进行部分匹配
3. **多条件OR逻辑**：满足任一屏蔽条件即过滤
4. **空值处理**：对空字段进行安全处理，避免报错

### 初始化流程

```
App.init()
  ├─ this.loadFilterSettings()         // 从 localStorage 加载
  └─ this.initFilterSettingsUI()       // 预留扩展

用户点击"编辑资料"按钮
  └─ this.applyFilterSettingsToUI()    // 同步到表单

用户点击"保存资料"按钮
  └─ this.saveFilterSettingsFromUI()   // 保存到 localStorage
```

### 列表渲染流程（以搜索为例）

```
用户搜索关键词
  └─ App.doSearch(keyword)
       └─ API.search(keyword)
            └─ App.renderSearchResults(result)
                 ├─ const allBooks = result.books
                 ├─ const { list, filteredCount } = this.applyContentFilter(allBooks, "search")
                 ├─ if (filteredCount > 0 && showHints) showToast(...)
                 └─ 渲染 visibleBooks
```

## 后续扩展方向（预留）

1. **服务端同步**
   - 将过滤规则同步到服务端，实现登录多端共享过滤规则

2. **快捷操作**
   - 在书籍详情页增加"屏蔽该作者"、"屏蔽该标签"按钮
   - 点击后自动写入当前过滤配置

3. **统计优化**
   - 在设置中增加"仅显示符合过滤规则的书籍统计"开关
   - 例如全站书库顶部的数量统计

4. **白名单模式**
   - 支持反向过滤：只显示指定作者/标签的书籍

5. **正则表达式支持**
   - 支持更复杂的匹配规则

## 注意事项

1. **版本号更新**
   - 修改 HTML/CSS/JS 后需更新版本号，避免用户看到旧缓存

2. **性能考虑**
   - 过滤算法在前端执行，对大列表可能有轻微性能影响
   - 建议后续优化可考虑 Web Worker 处理

3. **用户体验**
   - 过滤后列表为空时，需明确提示用户原因及解决方法
   - 避免用户困惑为何搜索无结果

## 测试建议

### 功能测试

1. **基础功能**
   - [ ] 设置屏蔽作者后，搜索结果不显示该作者的书
   - [ ] 设置屏蔽关键词后，标题包含关键词的书被隐藏
   - [ ] 设置屏蔽分类后，该分类的书被过滤
   - [ ] 关闭过滤开关后，所有书籍正常显示

2. **提示功能**
   - [ ] 开启提示时，过滤后显示 toast 提示
   - [ ] 关闭提示时，过滤后不显示 toast

3. **边界情况**
   - [ ] 所有结果被过滤时，显示友好提示文案
   - [ ] 过滤规则为空时，不影响正常显示
   - [ ] 中英文、大小写混合输入的兼容性

4. **持久化**
   - [ ] 保存设置后刷新页面，设置仍然生效
   - [ ] 清除 localStorage 后，设置恢复默认

### UI测试

1. **表单交互**
   - [ ] 打开编辑资料弹窗，过滤设置正确加载
   - [ ] 修改后点击保存，成功提示
   - [ ] 多行文本框支持换行输入

2. **响应式**
   - [ ] 移动端表单显示正常
   - [ ] 各输入框尺寸合适

## 版本历史

- **v1.0.0** (2025-12-22)
  - 初始版本发布
  - 支持作者、关键词、分类三种过滤方式
  - 支持搜索、排行榜、全站书库三个页面
  - 支持过滤提示开关
