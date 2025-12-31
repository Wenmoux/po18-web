/**
 * 游戏系统模块 - 修仙阅读游戏
 */

class GameSystem {
    constructor() {
        this.gameData = null;
        this.pageContainer = null;
        this.readingWords = 0;
        this.lastRewardCheck = 0;
        this.rewardCheckInterval = 1000; // 每1000字检查一次奖励
    }

    /**
     * 初始化游戏系统
     */
    init() {
        this.pageContainer = document.getElementById("game-page-content");
        
        // 监听页面显示
        this.setupPageListener();
        
        // 定期保存阅读进度
        setInterval(() => {
            if (this.readingWords > 0) {
                this.recordReading(this.readingWords);
                this.readingWords = 0;
            }
        }, 30000); // 每30秒保存一次
    }

    /**
     * 设置页面显示监听
     */
    setupPageListener() {
        // 监听页面切换
        const gamePage = document.getElementById("page-game");
        if (gamePage) {
            // 使用 MutationObserver 监听页面显示
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === "attributes" && mutation.attributeName === "class") {
                        const isActive = gamePage.classList.contains("active");
                        if (isActive) {
                            // 每次显示页面时都重新加载数据（确保数据最新）
                            this.loadGameData();
                        }
                    }
                });
            });
            observer.observe(gamePage, { attributes: true, attributeFilter: ["class"] });
            
            // 初始检查
            if (gamePage.classList.contains("active")) {
                this.loadGameData();
            }
        }
        
        // 也监听 App 的页面切换事件
        if (window.App) {
            const originalNavigateTo = window.App.navigateTo;
            if (originalNavigateTo) {
                window.App.navigateTo = (page) => {
                    originalNavigateTo.call(window.App, page);
                    if (page === "game") {
                        setTimeout(() => this.loadGameData(), 100);
                    }
                };
            }
        }
        
        // 定期刷新数据（每30秒，仅在页面显示时）
        setInterval(() => {
            const gamePage = document.getElementById("page-game");
            if (gamePage && gamePage.classList.contains("active")) {
                this.loadGameData();
            }
        }, 30000);
    }

    /**
     * 加载游戏数据
     */
    async loadGameData() {
        if (!this.pageContainer) {
            this.pageContainer = document.getElementById("game-page-content");
        }
        if (!this.pageContainer) return;
        
        // 显示加载状态
        this.pageContainer.innerHTML = '<div class="game-loading">加载中</div>';
        
        try {
            const response = await fetch("/api/game/data", {
                credentials: "include"
            });
            const result = await response.json();
            if (result.success) {
                this.gameData = result.data;
                this.renderPage();
            } else {
                this.pageContainer.innerHTML = `
                    <div class="game-empty-state">
                        <div class="game-empty-icon">⚠️</div>
                        <div class="game-empty-text">${result.error || "加载失败"}</div>
                    </div>
                `;
            }
        } catch (error) {
            console.error("加载游戏数据失败:", error);
            if (this.pageContainer) {
                this.pageContainer.innerHTML = `
                    <div class="game-empty-state">
                        <div class="game-empty-icon">⚠️</div>
                        <div class="game-empty-text">加载失败，请刷新重试</div>
                    </div>
                `;
            }
        }
    }

    /**
     * 渲染游戏页面
     */
    renderPage() {
        if (!this.gameData || !this.pageContainer) return;
        
        // 计算当前层的修为进度百分比
        let expPercent = 100;
        if (this.gameData.expToNextLevel !== undefined && this.gameData.expToNextLevel > 0) {
            // 当前层已获得的修为
            const currentLevelExp = this.gameData.exp - this.gameData.expForCurrentLevel;
            // 使用当前层所需的总修为计算进度
            expPercent = Math.floor((currentLevelExp / this.gameData.expToNextLevel) * 100);
            expPercent = Math.max(0, Math.min(100, expPercent)); // 限制在0-100之间
        } else if (this.gameData.expToNext > 0) {
            // 兼容旧数据：使用简化计算
            expPercent = Math.floor((this.gameData.exp / (this.gameData.exp + this.gameData.expToNext)) * 100);
        }

        // 格式化阅读时间
        const formatTime = (seconds) => {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            if (hours > 0) return `${hours}小时${minutes}分钟`;
            return `${minutes}分钟`;
        };
        
        const formatWords = (words) => {
            if (words >= 10000) return `${(words / 10000).toFixed(1)}万字`;
            if (words >= 1000) return `${(words / 1000).toFixed(1)}千字`;
            return `${words}字`;
        };

        this.pageContainer.innerHTML = `
            <!-- 离线收益提示 -->
            <div id="offline-reward-section" style="margin-bottom: 16px;"></div>
            
            <!-- 境界信息卡片 -->
            <div class="game-info-cards">
                <div class="game-info-card">
                    <div class="game-info-card-title">当前境界</div>
                    <div class="game-info-card-value">${this.gameData.levelName} ${this.gameData.levelLayer}层</div>
                    <div class="game-info-card-subtitle">等级 ${this.gameData.level}</div>
                </div>
                <div class="game-info-card">
                    <div class="game-info-card-title">修为进度</div>
                    <div class="game-info-card-value">${this.gameData.exp}</div>
                    <div class="game-info-card-subtitle">还需 ${this.gameData.expToNext} 修为</div>
                    <div class="game-progress-bar">
                        <div class="game-progress-fill" style="width: ${expPercent}%"></div>
                    </div>
                </div>
            </div>
            
            <!-- 阅读统计 -->
            <div class="game-section">
                <div class="game-section-title">阅读统计</div>
                <div class="game-info-cards">
                    <div class="game-info-card">
                        <div class="game-info-card-title">今日阅读</div>
                        <div class="game-info-card-value">${formatWords(this.gameData.todayReadWords || 0)}</div>
                        <div class="game-info-card-subtitle">${formatTime(this.gameData.todayReadTime || 0)}</div>
                    </div>
                    <div class="game-info-card">
                        <div class="game-info-card-title">总阅读</div>
                        <div class="game-info-card-value">${formatWords(this.gameData.totalReadWords || 0)}</div>
                        <div class="game-info-card-subtitle">${formatTime(this.gameData.totalReadTime || 0)}</div>
                    </div>
                </div>
            </div>

            <!-- 碎片背包 -->
            <div class="game-section">
                <div class="game-section-title">碎片背包</div>
                <div class="game-fragments-grid">
                    ${this.renderFragments()}
                </div>
            </div>

            <!-- 道具背包 -->
            <div class="game-section">
                <div class="game-section-title">道具背包</div>
                <div class="game-items-list">
                    ${this.renderItems()}
                </div>
            </div>

            <!-- 功法列表 -->
            <div class="game-section">
                <div class="game-section-title">功法列表</div>
                <div class="game-techniques-list">
                    ${this.renderTechniques()}
                </div>
            </div>

            <!-- 每日签到 -->
            <div class="game-section">
                <div class="game-section-title">每日签到</div>
                <div id="signin-section"></div>
            </div>

            <!-- 每日任务 -->
            <div class="game-section">
                <div class="game-section-title">每日任务</div>
                <div id="tasks-section"></div>
            </div>

            <!-- 成就系统 -->
            <div class="game-section">
                <div class="game-section-title">成就系统</div>
                <div id="achievements-section"></div>
            </div>
        `;

        // 绑定事件
        this.bindEvents();
        
        // 加载离线收益
        this.loadOfflineReward();
        
        // 加载签到、任务、成就
        this.loadSignin();
        this.loadTasks();
        this.loadAchievements();
    }
    
    /**
     * 加载离线收益
     */
    async loadOfflineReward() {
        try {
            const response = await fetch("/api/game/offline-reward", {
                credentials: "include"
            });
            const result = await response.json();
            if (result.success && result.data.offlineTime > 60) {
                // 离线超过1分钟才显示
                const section = document.getElementById("offline-reward-section");
                if (section) {
                    const hours = result.data.offlineHours;
                    const minutes = result.data.offlineMinutes;
                    const timeText = hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
                    section.innerHTML = `
                        <div class="game-info-card" style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); border: 1px solid var(--game-warning);">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div style="font-size: 14px; font-weight: 600; color: var(--game-text-primary); margin-bottom: 4px;">
                                        ⏰ 离线收益
                                    </div>
                                    <div style="font-size: 12px; color: var(--game-text-secondary);">
                                        离线 ${timeText}，获得 ${result.data.expGained} 修为
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            }
        } catch (error) {
            console.error("加载离线收益失败:", error);
        }
    }

    /**
     * 加载签到信息
     */
    async loadSignin() {
        try {
            const response = await fetch("/api/game/signin/info", {
                credentials: "include"
            });
            const result = await response.json();
            if (result.success) {
                this.renderSignin(result.data);
            }
        } catch (error) {
            console.error("加载签到信息失败:", error);
        }
    }

    /**
     * 渲染签到UI
     */
    renderSignin(signinInfo) {
        const section = document.getElementById("signin-section");
        if (!section) return;

        const today = new Date().toISOString().split('T')[0];
        const isTodaySigned = signinInfo.todaySigned;
        const consecutiveDays = signinInfo.consecutiveDays || 0;
        const monthSignins = signinInfo.monthSignins || [];

        // 生成本月日历
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDay = firstDay.getDay();

        let calendarHTML = `
            <div class="game-signin-calendar">
                <div class="game-signin-header">
                    <div class="game-signin-consecutive">
                        <span style="font-size: 24px; font-weight: 600; color: var(--game-primary);">
                            ${consecutiveDays}
                        </span>
                        <span style="font-size: 12px; color: var(--game-text-secondary);">
                            连续签到
                        </span>
                    </div>
                    <button class="game-btn game-btn-primary" 
                            ${isTodaySigned ? 'disabled' : ''} 
                            id="signin-btn">
                        ${isTodaySigned ? '✓ 已签到' : '签到'}
                    </button>
                </div>
                <div class="game-signin-calendar-grid">
        `;

        // 星期标题
        const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        weekDays.forEach(day => {
            calendarHTML += `<div class="game-signin-weekday">${day}</div>`;
        });

        // 空白填充
        for (let i = 0; i < startDay; i++) {
            calendarHTML += `<div class="game-signin-day empty"></div>`;
        }

        // 日期
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isSigned = monthSignins.includes(dateStr);
            const isToday = dateStr === today;
            const isPast = dateStr < today;

            let className = 'game-signin-day';
            if (isToday) className += ' today';
            if (isSigned) className += ' signed';
            if (isPast && !isSigned) className += ' missed';

            calendarHTML += `
                <div class="${className}" title="${dateStr}">
                    <div class="game-signin-day-number">${day}</div>
                    ${isSigned ? '<div class="game-signin-check">✓</div>' : ''}
                </div>
            `;
        }

        calendarHTML += `
                </div>
            </div>
        `;

        section.innerHTML = calendarHTML;

        // 绑定签到按钮
        const signinBtn = document.getElementById("signin-btn");
        if (signinBtn && !isTodaySigned) {
            signinBtn.addEventListener("click", () => this.handleSignin());
        }
    }

    /**
     * 处理签到
     */
    async handleSignin() {
        try {
            const response = await fetch("/api/game/signin", {
                method: "POST",
                credentials: "include"
            });
            const result = await response.json();
            if (result.success) {
                this.showRewardNotification("签到成功", `获得 ${result.data.rewardExp} 修为`, result.data.rewardItems);
                this.loadSignin();
                this.loadGameData(); // 刷新游戏数据
            } else {
                alert(result.message || "签到失败");
            }
        } catch (error) {
            console.error("签到失败:", error);
            alert("签到失败，请重试");
        }
    }

    /**
     * 加载每日任务
     */
    async loadTasks() {
        try {
            const response = await fetch("/api/game/tasks", {
                credentials: "include"
            });
            const result = await response.json();
            if (result.success) {
                this.renderTasks(result.data);
            }
        } catch (error) {
            console.error("加载任务失败:", error);
        }
    }

    /**
     * 渲染任务列表
     */
    renderTasks(tasks) {
        const section = document.getElementById("tasks-section");
        if (!section) return;

        if (!tasks || tasks.length === 0) {
            section.innerHTML = `
                <div class="game-empty-state">
                    <div class="game-empty-icon">📋</div>
                    <div class="game-empty-text">暂无任务</div>
                </div>
            `;
            return;
        }

        let html = '<div class="game-tasks-list">';
        tasks.forEach(task => {
            const progress = task.progress || 0;
            const target = task.target || 1;
            const percent = Math.min((progress / target) * 100, 100);
            const isCompleted = task.completed === 1;
            const difficultyClass = task.difficulty || 'easy';
            
            html += `
                <div class="game-task-card ${isCompleted ? 'completed' : ''} ${difficultyClass}">
                    <div class="game-task-header">
                        <div class="game-task-name">${task.task_name}</div>
                        <div class="game-task-reward">+${task.reward_exp} 修为</div>
                    </div>
                    <div class="game-task-desc">${task.task_desc}</div>
                    <div class="game-task-progress">
                        <div class="game-progress-bar">
                            <div class="game-progress-fill" style="width: ${percent}%"></div>
                        </div>
                        <div class="game-task-progress-text">
                            ${progress} / ${target}
                        </div>
                    </div>
                    ${isCompleted ? '<div class="game-task-completed">✓ 已完成</div>' : ''}
                </div>
            `;
        });
        html += '</div>';

        section.innerHTML = html;
    }

    /**
     * 加载成就
     */
    async loadAchievements() {
        try {
            const response = await fetch("/api/game/achievements", {
                credentials: "include"
            });
            const result = await response.json();
            if (result.success) {
                this.renderAchievements(result.data);
            }
        } catch (error) {
            console.error("加载成就失败:", error);
        }
    }

    /**
     * 渲染成就列表
     */
    renderAchievements(achievements) {
        const section = document.getElementById("achievements-section");
        if (!section) return;

        // 按类型分组
        const byType = {
            reading: [],
            realm: [],
            collection: [],
            special: []
        };

        achievements.forEach(ach => {
            const type = ach.achievement_type || 'reading';
            if (byType[type]) {
                byType[type].push(ach);
            }
        });

        let html = '';

        // 阅读成就
        if (byType.reading.length > 0) {
            html += '<div class="game-achievement-group"><div class="game-achievement-group-title">📖 阅读成就</div>';
            html += this.renderAchievementList(byType.reading);
            html += '</div>';
        }

        // 境界成就
        if (byType.realm.length > 0) {
            html += '<div class="game-achievement-group"><div class="game-achievement-group-title">🏆 境界成就</div>';
            html += this.renderAchievementList(byType.realm);
            html += '</div>';
        }

        // 收集成就
        if (byType.collection.length > 0) {
            html += '<div class="game-achievement-group"><div class="game-achievement-group-title">📦 收集成就</div>';
            html += this.renderAchievementList(byType.collection);
            html += '</div>';
        }

        // 特殊成就
        if (byType.special.length > 0) {
            html += '<div class="game-achievement-group"><div class="game-achievement-group-title">✨ 特殊成就</div>';
            html += this.renderAchievementList(byType.special);
            html += '</div>';
        }

        section.innerHTML = html || `
            <div class="game-empty-state">
                <div class="game-empty-icon">🏅</div>
                <div class="game-empty-text">暂无成就</div>
            </div>
        `;
    }

    /**
     * 渲染成就列表
     */
    renderAchievementList(achievements) {
        let html = '<div class="game-achievements-list">';
        achievements.forEach(ach => {
            const isCompleted = ach.completed === 1;
            const isClaimed = ach.reward_claimed === 1;
            const progress = ach.progress || 0;
            const target = ach.target || 1;
            const percent = Math.min((progress / target) * 100, 100);

            html += `
                <div class="game-achievement-card ${isCompleted ? 'completed' : ''}">
                    <div class="game-achievement-icon">${isCompleted ? '✓' : '○'}</div>
                    <div class="game-achievement-content">
                        <div class="game-achievement-name">${ach.name || ach.achievement_id}</div>
                        <div class="game-achievement-desc">${ach.desc || ''}</div>
                        <div class="game-task-progress">
                            <div class="game-progress-bar">
                                <div class="game-progress-fill" style="width: ${percent}%"></div>
                            </div>
                            <div class="game-task-progress-text">
                                ${progress} / ${target}
                            </div>
                        </div>
                    </div>
                    <div class="game-achievement-reward">
                        <div class="game-achievement-reward-exp">+${ach.reward?.exp || 0} 修为</div>
                        ${isCompleted && !isClaimed ? 
                            `<button class="game-btn game-btn-small" data-achievement-id="${ach.achievement_id}">领取</button>` :
                            isClaimed ? '<span class="game-achievement-claimed">已领取</span>' : ''
                        }
                    </div>
                </div>
            `;
        });
        html += '</div>';
        return html;
    }

    /**
     * 领取成就奖励
     */
    async claimAchievement(achievementId) {
        try {
            const response = await fetch("/api/game/achievements/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ achievementId })
            });
            const result = await response.json();
            if (result.success) {
                this.showRewardNotification("成就奖励", `获得 ${result.rewards.exp} 修为`, result.rewards.items);
                this.loadAchievements();
                this.loadGameData();
            } else {
                alert(result.message || "领取失败");
            }
        } catch (error) {
            console.error("领取成就奖励失败:", error);
            alert("领取失败，请重试");
        }
    }

    /**
     * 显示奖励通知
     */
    showRewardNotification(title, message, items = []) {
        // 这里可以显示一个通知弹窗
        console.log(title, message, items);
        // TODO: 实现通知UI
    }

    /**
     * 渲染碎片
     */
    renderFragments() {
        const fragmentTypes = {
            technique: { icon: "📜", name: "功法碎片" },
            pill: { icon: "💊", name: "丹药碎片" },
            artifact: { icon: "🗡️", name: "法宝碎片" },
            beast: { icon: "🐉", name: "灵兽碎片" }
        };

        const fragmentsByType = {};
        this.gameData.fragments.forEach(f => {
            if (!fragmentsByType[f.fragment_type]) {
                fragmentsByType[f.fragment_type] = [];
            }
            fragmentsByType[f.fragment_type].push(f);
        });

        let html = "";
        Object.keys(fragmentTypes).forEach(type => {
            const typeInfo = fragmentTypes[type];
            const fragments = fragmentsByType[type] || [];
            
            // 按数量排序（多的在前，接近完成的优先显示）
            const sortedFragments = fragments.sort((a, b) => {
                // 可合成的优先
                if (a.quantity >= 10 && b.quantity < 10) return -1;
                if (a.quantity < 10 && b.quantity >= 10) return 1;
                // 然后按数量降序
                return b.quantity - a.quantity;
            });
            
            // 按碎片ID分组显示
            sortedFragments.forEach(fragment => {
                const canSynthesize = fragment.quantity >= 10;
                const progressPercent = Math.min((fragment.quantity / 10) * 100, 100);
                html += `
                    <div class="game-fragment-card ${canSynthesize ? "can-synthesize" : ""}" 
                         data-type="${type}" data-id="${fragment.fragment_id}">
                        <div class="game-fragment-icon">${typeInfo.icon}</div>
                        <div class="game-fragment-name">${fragment.fragment_id}</div>
                        <div class="game-fragment-count">${fragment.quantity}/10</div>
                        <div class="game-progress-bar" style="width: 100%; margin-top: 4px; height: 4px;">
                            <div class="game-progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        ${canSynthesize ? `<button class="game-fragment-synthesize" data-type="${type}" data-id="${fragment.fragment_id}">✨ 合成</button>` : ""}
                    </div>
                `;
            });
            
            // 如果没有该类型的碎片，显示空卡片提示
            if (fragments.length === 0) {
                html += `
                    <div class="game-fragment-card empty" data-type="${type}">
                        <div class="game-fragment-icon" style="opacity: 0.3;">${typeInfo.icon}</div>
                        <div class="game-fragment-name" style="opacity: 0.5;">${typeInfo.name}</div>
                        <div class="game-fragment-count" style="opacity: 0.5;">0/10</div>
                    </div>
                `;
            }
        });

        return html;
    }

    /**
     * 渲染道具
     */
    renderItems() {
        if (!this.gameData.items || this.gameData.items.length === 0) {
            return `
                <div class="game-empty-state">
                    <div class="game-empty-icon">📦</div>
                    <div class="game-empty-text">暂无道具<br>继续阅读获得道具</div>
                </div>
            `;
        }

        const itemIcons = {
            pill: "💊",
            artifact: "🗡️",
            talisman: "📿"
        };

        return this.gameData.items.map(item => {
            const icon = itemIcons[item.item_type] || "📦";
            const effect = this.getItemEffect(item.item_id);
            return `
                <div class="game-item-card">
                    <div class="game-item-icon">${icon}</div>
                    <div class="game-item-info">
                        <div class="game-item-name">${item.item_id}</div>
                        <div class="game-item-count">×${item.quantity}</div>
                        <div class="game-item-effect" style="font-size: 11px; color: var(--game-text-secondary); margin-top: 4px;">
                            ${effect}
                        </div>
                    </div>
                    <button class="game-item-action" data-item-type="${item.item_type}" data-item-id="${item.item_id}">
                        使用
                    </button>
                </div>
            `;
        }).join("");
    }

    /**
     * 渲染功法
     */
    renderTechniques() {
        if (!this.gameData.techniques || this.gameData.techniques.length === 0) {
            return `
                <div class="game-empty-state">
                    <div class="game-empty-icon">📜</div>
                    <div class="game-empty-text">暂无功法<br>收集功法碎片解锁</div>
                </div>
            `;
        }

        return this.gameData.techniques.map(tech => {
            const effectText = this.getTechniqueEffect(tech.technique_id);
            return `
                <div class="game-technique-card ${tech.is_equipped ? "equipped" : ""}">
                    <div class="game-technique-header">
                        <div class="game-technique-info">
                            <div class="game-technique-icon">📜</div>
                            <div class="game-technique-details">
                                <div class="game-technique-name">${tech.technique_id}</div>
                                <div class="game-technique-level">Lv.${tech.level}</div>
                            </div>
                        </div>
                        <button class="game-technique-action ${tech.is_equipped ? "equipped" : ""}" 
                                data-technique-id="${tech.technique_id}">
                            ${tech.is_equipped ? "已装备" : "装备"}
                        </button>
                    </div>
                    <div class="game-technique-effect">${effectText}</div>
                </div>
            `;
        }).join("");
    }

    /**
     * 获取道具效果描述
     */
    getItemEffect(itemId) {
        const effects = {
            "回神丹": "效果: 下次阅读修为+50%",
            "悟道丹": "效果: 碎片掉落率提升至50%",
            "清心丹": "效果: 阅读专注度提升",
            "聚灵丹": "效果: 立即获得100修为",
            "书签法宝": "效果: 快速定位阅读位置",
            "护眼法宝": "效果: 保护眼睛，减少疲劳",
            "记忆法宝": "效果: 增强记忆，提升理解",
            "专注法宝": "效果: 提升阅读专注度"
        };
        return effects[itemId] || "效果: 使用后生效";
    }

    /**
     * 获取功法效果描述
     */
    getTechniqueEffect(techniqueId) {
        const effects = {
            "清心诀": "效果: 阅读时修为+10%",
            "凝神诀": "效果: 阅读时修为+15%",
            "悟道诀": "效果: 阅读时修为+20%",
            "静心诀": "效果: 阅读时修为+12%"
        };
        return effects[techniqueId] || "效果: 提升阅读收益";
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        if (!this.pageContainer) return;
        
        // 道具使用
        this.pageContainer.querySelectorAll(".game-item-action").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const itemType = e.target.dataset.itemType;
                const itemId = e.target.dataset.itemId;
                await this.useItem(itemType, itemId);
            });
        });

        // 功法装备/卸下
        this.pageContainer.querySelectorAll(".game-technique-action").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const techniqueId = e.target.dataset.techniqueId;
                await this.toggleTechnique(techniqueId);
            });
        });
        
        // 碎片合成
        this.pageContainer.querySelectorAll(".game-fragment-synthesize").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const fragmentType = e.target.dataset.type;
                const fragmentId = e.target.dataset.id;
                await this.synthesizeFragment(fragmentType, fragmentId);
            });
        });

        // 成就领取（使用事件委托，因为成就是动态加载的）
        this.pageContainer.addEventListener("click", async (e) => {
            if (e.target.classList.contains("game-btn-small") && e.target.dataset.achievementId) {
                const achievementId = e.target.dataset.achievementId;
                await this.claimAchievement(achievementId);
            }
        });
    }

    /**
     * 使用道具
     */
    async useItem(itemType, itemId) {
        try {
            const response = await fetch("/api/game/items/use", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ itemType, itemId, quantity: 1 })
            });
            const result = await response.json();
            if (result.success) {
                const message = result.effect ? `使用成功！${result.effect}` : "使用成功";
                if (window.App && window.App.showToast) {
                    window.App.showToast(message, "success");
                }
                this.loadGameData();
            } else {
                if (window.App && window.App.showToast) {
                    window.App.showToast(result.error || "使用失败", "error");
                }
            }
        } catch (error) {
            console.error("使用道具失败:", error);
            if (window.App && window.App.showToast) {
                window.App.showToast("使用失败", "error");
            }
        }
    }

    /**
     * 合成碎片
     */
    async synthesizeFragment(fragmentType, fragmentId) {
        try {
            const response = await fetch("/api/game/fragments/synthesize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ fragmentType, fragmentId })
            });
            const result = await response.json();
            if (result.success) {
                if (window.App && window.App.showToast) {
                    window.App.showToast(result.data.message, "success");
                }
                this.loadGameData();
            } else {
                if (window.App && window.App.showToast) {
                    window.App.showToast(result.error || "合成失败", "error");
                }
            }
        } catch (error) {
            console.error("合成碎片失败:", error);
            if (window.App && window.App.showToast) {
                window.App.showToast("合成失败", "error");
            }
        }
    }

    /**
     * 切换功法装备状态
     */
    async toggleTechnique(techniqueId) {
        try {
            const response = await fetch("/api/game/techniques/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ techniqueId })
            });
            const result = await response.json();
            if (result.success) {
                if (window.App && window.App.showToast) {
                    window.App.showToast(result.isEquipped ? "装备成功" : "卸下成功", "success");
                }
                this.loadGameData();
            } else {
                if (window.App && window.App.showToast) {
                    window.App.showToast(result.error || "操作失败", "error");
                }
            }
        } catch (error) {
            console.error("切换功法失败:", error);
            if (window.App && window.App.showToast) {
                window.App.showToast("操作失败", "error");
            }
        }
    }

    /**
     * 记录阅读
     */
    async recordReading(wordsRead, readingTime = 0, bookId = null, chapterId = null) {
        if (wordsRead <= 0) return;

        try {
            const response = await fetch("/api/game/reading", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    wordsRead,
                    readingTime,
                    bookId,
                    chapterId
                })
            });
            const result = await response.json();
            if (result.success && result.data) {
                // 检查是否升级
                if (result.data.leveledUp) {
                    this.showLevelUpNotification(result.data.oldLevel, result.data.level);
                }
                
                // 显示奖励提示
                if (result.data.expGained > 0) {
                    this.showNotification(`+${result.data.expGained} 修为`, "exp");
                }
                if (result.data.fragments && result.data.fragments.length > 0) {
                    result.data.fragments.forEach(fragment => {
                        this.showRewardPopup(fragment.name, fragment.type);
                    });
                }
                // 更新游戏数据（如果游戏页面正在显示）
                const gamePage = document.getElementById("page-game");
                if (gamePage && gamePage.classList.contains("active")) {
                    this.loadGameData();
                }
            }
        } catch (error) {
            console.error("记录阅读失败:", error);
        }
    }

    /**
     * 添加阅读字数（供阅读器调用）
     */
    addReadingWords(words, bookId = null, chapterId = null) {
        this.readingWords += words;
        this.lastRewardCheck += words;

        // 每1000字检查一次奖励
        if (this.lastRewardCheck >= this.rewardCheckInterval) {
            this.recordReading(this.lastRewardCheck, 0, bookId, chapterId);
            this.lastRewardCheck = 0;
        }
    }

    /**
     * 显示奖励弹窗
     */
    showRewardPopup(itemName, itemType) {
        const icons = {
            technique: "📜",
            pill: "💊",
            artifact: "🗡️",
            beast: "🐉"
        };
        const icon = icons[itemType] || "✨";

        const popup = document.createElement("div");
        popup.className = "game-reward-popup";
        popup.innerHTML = `
            <div class="game-reward-title">✨ 获得奖励</div>
            <div class="game-reward-icon">${icon}</div>
            <div class="game-reward-name">${itemName}</div>
            <button class="game-reward-close">确定</button>
        `;
        document.body.appendChild(popup);

        popup.querySelector(".game-reward-close").addEventListener("click", () => {
            popup.remove();
        });

        // 3秒后自动关闭
        setTimeout(() => {
            if (popup.parentNode) {
                popup.remove();
            }
        }, 3000);
    }

    /**
     * 显示境界提升通知
     */
    showLevelUpNotification(oldLevel, newLevel) {
        const levelNames = [
            "炼气期", "筑基期", "金丹期", "元婴期", "化神期", 
            "合体期", "大乘期", "渡劫期"
        ];
        const oldLevelIndex = Math.min(Math.floor((oldLevel - 1) / 10), levelNames.length - 1);
        const newLevelIndex = Math.min(Math.floor((newLevel - 1) / 10), levelNames.length - 1);
        const oldLevelName = levelNames[oldLevelIndex];
        const newLevelName = levelNames[newLevelIndex];
        const oldLayer = ((oldLevel - 1) % 10) + 1;
        const newLayer = ((newLevel - 1) % 10) + 1;
        
        const popup = document.createElement("div");
        popup.className = "game-reward-popup";
        popup.style.animation = "popupIn 0.5s ease, levelUpShake 0.5s ease 0.3s";
        popup.innerHTML = `
            <div class="game-reward-title" style="color: var(--game-warning); font-size: 20px;">🎉 境界提升！</div>
            <div class="game-reward-icon" style="font-size: 64px;">✨</div>
            <div class="game-reward-name" style="font-size: 18px; font-weight: 600;">
                ${oldLevelName} ${oldLayer}层 → ${newLevelName} ${newLayer}层
            </div>
            <div style="font-size: 14px; color: var(--game-text-secondary); margin-top: 8px;">
                继续阅读，提升更高境界！
            </div>
            <button class="game-reward-close">确定</button>
        `;
        document.body.appendChild(popup);

        popup.querySelector(".game-reward-close").addEventListener("click", () => {
            popup.remove();
        });

        // 5秒后自动关闭
        setTimeout(() => {
            if (popup.parentNode) {
                popup.remove();
            }
        }, 5000);
    }

    /**
     * 显示通知
     */
    showNotification(message, type = "info") {
        const icons = {
            success: "✓",
            error: "✗",
            exp: "⚡",
            info: "ℹ"
        };
        const icon = icons[type] || "ℹ";

        const notification = document.createElement("div");
        notification.className = "game-notification";
        notification.innerHTML = `
            <div class="game-notification-content">
                <div class="game-notification-icon">${icon}</div>
                <div class="game-notification-text">${message}</div>
            </div>
        `;
        document.body.appendChild(notification);

        // 2秒后移除
        setTimeout(() => {
            notification.classList.add("expiring");
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, 2000);
    }
}

// 创建全局游戏系统实例
const gameSystem = new GameSystem();

// 页面加载完成后初始化
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        gameSystem.init();
    });
} else {
    gameSystem.init();
}

// 导出供其他模块使用
if (typeof module !== "undefined" && module.exports) {
    module.exports = gameSystem;
}

