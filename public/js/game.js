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
        this.lastReadingTime = null; // 上次阅读时间（用于计算阅读时长）
        this.allCollections = []; // 所有藏品
        this.filteredCollections = []; // 筛选后的藏品
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
            <!-- 标签页导航 -->
            <div class="game-tabs" style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 2px solid var(--game-border);">
                <button class="game-tab active" data-tab="main" style="padding: 12px 24px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 14px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                    蓬莱境
                </button>
                <button class="game-tab" data-tab="collections" style="padding: 12px 24px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 14px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                    玄藏录
                </button>
                <button class="game-tab" data-tab="ranking" style="padding: 12px 24px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 14px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                    玄藏排行
                </button>
                <button class="game-tab" data-tab="cultivation-ranking" style="padding: 12px 24px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 14px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                    修为排行
                </button>
            </div>

            <!-- 修仙标签页内容 -->
            <div class="game-tab-content active" id="game-tab-main">
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

                <!-- 修仙子标签页 -->
                <div class="game-sub-tabs" style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 2px solid var(--game-border); flex-wrap: wrap;">
                    <button class="game-sub-tab active" data-subtab="fragments" style="padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 13px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                        碎片背包
                    </button>
                    <button class="game-sub-tab" data-subtab="items" style="padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 13px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                        道具背包
                    </button>
                    <button class="game-sub-tab" data-subtab="techniques" style="padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 13px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                        功法列表
                    </button>
                    <button class="game-sub-tab" data-subtab="achievements" style="padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 13px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                        成就系统
                    </button>
                    <button class="game-sub-tab" data-subtab="daily" style="padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 13px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                        每日任务
                    </button>
                    <button class="game-sub-tab" data-subtab="signin" style="padding: 10px 20px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 13px; color: var(--md-on-surface-variant); transition: all 0.3s; margin-bottom: -2px;">
                        每日签到
                    </button>
                </div>

                <!-- 碎片背包子标签页 -->
                <div class="game-sub-tab-content active" id="game-subtab-fragments">
                    <div class="game-section">
                        <div class="game-section-title">碎片背包</div>
                        <div class="game-fragments-grid">
                            ${this.renderFragments()}
                        </div>
                    </div>
                </div>

                <!-- 道具背包子标签页 -->
                <div class="game-sub-tab-content" id="game-subtab-items" style="display: none;">
                    <div class="game-section">
                        <div class="game-section-title">道具背包</div>
                        <div class="game-items-list">
                            ${this.renderItems()}
                        </div>
                    </div>
                </div>

                <!-- 功法列表子标签页 -->
                <div class="game-sub-tab-content" id="game-subtab-techniques" style="display: none;">
                    <div class="game-section">
                        <div class="game-section-title">功法列表</div>
                        <div class="game-techniques-list">
                            ${this.renderTechniques()}
                        </div>
                    </div>
                </div>

                <!-- 成就系统子标签页 -->
                <div class="game-sub-tab-content" id="game-subtab-achievements" style="display: none;">
                    <div class="game-section">
                        <div class="game-section-title">成就系统</div>
                        <div id="achievements-section"></div>
                    </div>
                </div>

                <!-- 每日任务子标签页 -->
                <div class="game-sub-tab-content" id="game-subtab-daily" style="display: none;">
                    <div class="game-section">
                        <div class="game-section-title">每日任务</div>
                        <div id="tasks-section"></div>
                    </div>
                </div>

                <!-- 每日签到这个标签页 -->
                <div class="game-sub-tab-content" id="game-subtab-signin" style="display: none;">
                    <div class="game-section">
                        <div class="game-section-title">每日签到</div>
                        <div id="signin-section"></div>
                    </div>
                </div>
            </div>

            <!-- 玄藏录标签页内容 -->
            <div class="game-tab-content" id="game-tab-collections" style="display: none;">
                <div id="collections-content">
                    <div class="game-loading">加载中...</div>
                </div>
                <!-- 详情弹窗 -->
                <div class="modal-overlay" id="collection-modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <div class="modal-title" id="modal-title">
                                <span id="modal-icon" style="font-size: 32px;"></span>
                                <span id="modal-name"></span>
                            </div>
                            <button class="modal-close" id="modal-close">&times;</button>
                        </div>
                        <div class="modal-body" id="modal-body">
                            <!-- 动态填充 -->
                        </div>
                    </div>
                </div>
            </div>

            <!-- 玄藏排行标签页内容 -->
            <div class="game-tab-content" id="game-tab-ranking" style="display: none;">
                <div id="ranking-content">
                    <div class="game-loading">加载中...</div>
                </div>
            </div>

            <!-- 修为排行标签页内容 -->
            <div class="game-tab-content" id="game-tab-cultivation-ranking" style="display: none;">
                <div id="cultivation-ranking-content">
                    <div class="game-loading">加载中...</div>
                </div>
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
        
        // 主标签页切换
        this.pageContainer.querySelectorAll(".game-tab").forEach(tab => {
            tab.addEventListener("click", (e) => {
                const tabName = e.target.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // 子标签页切换（修仙标签页内的）
        this.pageContainer.querySelectorAll(".game-sub-tab").forEach(tab => {
            tab.addEventListener("click", (e) => {
                const subtabName = e.target.dataset.subtab;
                this.switchSubTab(subtabName);
            });
        });
        
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
     * 切换标签页
     */
    switchTab(tabName) {
        // 更新标签状态
        this.pageContainer.querySelectorAll(".game-tab").forEach(tab => {
            tab.classList.remove("active");
            tab.style.color = "var(--md-on-surface-variant)";
            tab.style.borderBottomColor = "transparent";
        });
        const activeTab = this.pageContainer.querySelector(`.game-tab[data-tab="${tabName}"]`);
        if (activeTab) {
            activeTab.classList.add("active");
            activeTab.style.color = "var(--md-primary)";
            activeTab.style.borderBottomColor = "var(--md-primary)";
        }

        // 更新内容显示
        this.pageContainer.querySelectorAll(".game-tab-content").forEach(content => {
            content.style.display = "none";
            content.classList.remove("active");
        });
        const activeContent = this.pageContainer.querySelector(`#game-tab-${tabName}`);
        if (activeContent) {
            activeContent.style.display = "block";
            activeContent.classList.add("active");
        }

        // 加载对应数据
        if (tabName === "collections") {
            this.loadCollections();
        } else if (tabName === "ranking") {
            this.loadRanking();
        } else if (tabName === "cultivation-ranking") {
            this.loadCultivationRanking();
        } else if (tabName === "main") {
            // 切换到修仙标签页时，默认显示第一个子标签页
            this.switchSubTab("fragments");
        }
    }

    /**
     * 切换子标签页（修仙标签页内的）
     */
    switchSubTab(subtabName) {
        // 更新子标签状态
        this.pageContainer.querySelectorAll(".game-sub-tab").forEach(tab => {
            tab.classList.remove("active");
            tab.style.color = "var(--md-on-surface-variant)";
            tab.style.borderBottomColor = "transparent";
        });
        const activeSubTab = this.pageContainer.querySelector(`.game-sub-tab[data-subtab="${subtabName}"]`);
        if (activeSubTab) {
            activeSubTab.classList.add("active");
            activeSubTab.style.color = "var(--md-primary)";
            activeSubTab.style.borderBottomColor = "var(--md-primary)";
        }

        // 更新子内容显示
        this.pageContainer.querySelectorAll(".game-sub-tab-content").forEach(content => {
            content.style.display = "none";
            content.classList.remove("active");
        });
        const activeSubContent = this.pageContainer.querySelector(`#game-subtab-${subtabName}`);
        if (activeSubContent) {
            activeSubContent.style.display = "block";
            activeSubContent.classList.add("active");
        }

        // 加载对应数据
        if (subtabName === "achievements") {
            this.loadAchievements();
        } else if (subtabName === "daily") {
            this.loadTasks();
        } else if (subtabName === "signin") {
            this.loadSignin();
        }
    }

    /**
     * 加载玄藏录
     */
    async loadCollections() {
        const container = document.getElementById("collections-content");
        if (!container) return;

        try {
            container.innerHTML = '<div class="game-loading">加载中...</div>';
            const response = await fetch("/api/game/collections", {
                credentials: "include"
            });
            const result = await response.json();
            
            if (result.success) {
                const { collections, stats } = result.data;
                this.allCollections = collections;
                
                let html = `
                    <div class="game-section">
                        <div class="game-section-title">玄藏统计</div>
                        <div class="game-info-cards">
                            <div class="game-info-card">
                                <div class="game-info-card-title">总藏品数</div>
                                <div class="game-info-card-value">${stats.total || 0}</div>
                            </div>
                            <div class="game-info-card">
                                <div class="game-info-card-title">独特类型</div>
                                <div class="game-info-card-value">${stats.unique_types || 0}</div>
                            </div>
                            <div class="game-info-card">
                                <div class="game-info-card-title">传说级</div>
                                <div class="game-info-card-value">${stats.legendary_count || 0}</div>
                            </div>
                            <div class="game-info-card">
                                <div class="game-info-card-title">史诗级</div>
                                <div class="game-info-card-value">${stats.epic_count || 0}</div>
                            </div>
                        </div>
                    </div>
                    <div class="game-section">
                        <div class="game-section-title">我的玄藏</div>
                        <div class="collections-filters">
                            <div class="filter-group">
                                <label class="filter-label">搜索:</label>
                                <input type="text" class="search-input" id="collections-search-input" placeholder="搜索玄藏名称、描述或ID...">
                            </div>
                            <div class="filter-group">
                                <label class="filter-label">品质:</label>
                                <select class="filter-select" id="collections-filter-quality">
                                    <option value="">全部</option>
                                    <option value="common">普通</option>
                                    <option value="uncommon">不凡</option>
                                    <option value="rare">稀有</option>
                                    <option value="epic">史诗</option>
                                    <option value="legendary">传说</option>
                                    <option value="mythic">神话</option>
                                </select>
                            </div>
                            <div class="filter-group">
                                <label class="filter-label">排序:</label>
                                <select class="filter-select" id="collections-sort-by">
                                    <option value="obtained_at_desc">获得时间（最新）</option>
                                    <option value="obtained_at_asc">获得时间（最早）</option>
                                    <option value="rarity_desc">稀有度（高→低）</option>
                                    <option value="rarity_asc">稀有度（低→高）</option>
                                    <option value="quality">品质</option>
                                    <option value="name">名称</option>
                                </select>
                            </div>
                        </div>
                        <div class="collections-grid" id="collections-grid"></div>
                    </div>
                `;
                container.innerHTML = html;
                
                // 绑定筛选和搜索事件
                document.getElementById('collections-search-input').addEventListener('input', () => this.applyCollectionFilters());
                document.getElementById('collections-filter-quality').addEventListener('change', () => this.applyCollectionFilters());
                document.getElementById('collections-sort-by').addEventListener('change', () => this.applyCollectionFilters());
                
                // 绑定详情弹窗事件
                const modal = document.getElementById('collection-modal');
                if (modal) {
                    document.getElementById('modal-close').addEventListener('click', () => this.closeCollectionModal());
                    modal.addEventListener('click', (e) => {
                        if (e.target.id === 'collection-modal') {
                            this.closeCollectionModal();
                        }
                    });
                }
                
                // 应用筛选和排序
                this.applyCollectionFilters();
            } else {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--md-error);">
                        <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                        <p>加载失败，请刷新重试</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error("加载玄藏失败:", error);
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--md-error);">
                    <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                    <p>加载失败，请刷新重试</p>
                </div>
            `;
        }
    }

    /**
     * 应用筛选和排序
     */
    applyCollectionFilters() {
        const searchTerm = document.getElementById('collections-search-input')?.value.toLowerCase() || '';
        const qualityFilter = document.getElementById('collections-filter-quality')?.value || '';
        const sortBy = document.getElementById('collections-sort-by')?.value || 'obtained_at_desc';

        // 筛选
        this.filteredCollections = this.allCollections.filter(collection => {
            // 搜索筛选
            if (searchTerm) {
                const searchable = [
                    collection.name || '',
                    collection.description || '',
                    collection.collection_id || '',
                    collection.effect_description || ''
                ].join(' ').toLowerCase();
                if (!searchable.includes(searchTerm)) {
                    return false;
                }
            }

            // 品质筛选
            if (qualityFilter && collection.quality !== qualityFilter) {
                return false;
            }

            return true;
        });

        // 排序
        this.filteredCollections.sort((a, b) => {
            switch (sortBy) {
                case 'obtained_at_desc':
                    return new Date(b.obtained_at) - new Date(a.obtained_at);
                case 'obtained_at_asc':
                    return new Date(a.obtained_at) - new Date(b.obtained_at);
                case 'rarity_desc':
                    return (b.rarity || 1) - (a.rarity || 1);
                case 'rarity_asc':
                    return (a.rarity || 1) - (b.rarity || 1);
                case 'quality':
                    const qualityOrder = { 'mythic': 6, 'legendary': 5, 'epic': 4, 'rare': 3, 'uncommon': 2, 'common': 1 };
                    return (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
                case 'name':
                    return (a.name || '').localeCompare(b.name || '');
                default:
                    return 0;
            }
        });

        // 渲染
        this.renderCollections();
    }

    /**
     * 渲染藏品列表
     */
    renderCollections() {
        const grid = document.getElementById('collections-grid');
        if (!grid) return;
        
        if (this.filteredCollections.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-icon">📚</div>
                    <p>${this.allCollections.length === 0 ? '暂无玄藏' : '没有找到匹配的玄藏'}</p>
                    ${this.allCollections.length === 0 ? '<p style="font-size: 14px; margin-top: 10px;">继续阅读以获得玄藏</p>' : ''}
                </div>
            `;
        } else {
            const getQualityName = (quality) => {
                const names = {
                    'common': '普通', 'uncommon': '不凡', 'rare': '稀有',
                    'epic': '史诗', 'legendary': '传说', 'mythic': '神话'
                };
                return names[quality] || '普通';
            };

            const formatDate = (dateString) => {
                if (!dateString) return '未知';
                const date = new Date(dateString);
                return date.toLocaleString('zh-CN', {
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                });
            };

            const hexToRgb = (hex) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? {
                    r: parseInt(result[1], 16),
                    g: parseInt(result[2], 16),
                    b: parseInt(result[3], 16)
                } : null;
            };

            grid.innerHTML = this.filteredCollections.map((collection, index) => {
                const qualityClass = `quality-${collection.quality || 'common'}`;
                const color = collection.color || '#9e9e9e';
                const icon = collection.icon || '📚';
                const effectText = collection.effect_description || '';
                
                // 提取 RGB 值用于渐变
                const rgb = hexToRgb(color);
                const rgbString = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : '33, 150, 243';
                
                return `
                    <div class="collection-card" 
                         style="--collection-color: ${color}; --collection-color-rgb: ${rgbString}; --index: ${index}" 
                         data-collection-index="${index}">
                        <div class="collection-icon">${icon}</div>
                        <div class="collection-name">${collection.name || '未知'}</div>
                        <div class="collection-quality ${qualityClass}">${getQualityName(collection.quality)}</div>
                        ${effectText ? `<div class="collection-effect">${effectText}</div>` : ''}
                        ${collection.description ? `<div class="collection-description">${collection.description}</div>` : ''}
                        ${collection.rarity ? `<div class="collection-rarity">稀有度: ${collection.rarity}</div>` : ''}
                        <div class="collection-id">${collection.collection_id}</div>
                        <div class="collection-obtained">获得时间: ${formatDate(collection.obtained_at)}</div>
                    </div>
                `;
            }).join('');

            // 绑定点击事件
            grid.querySelectorAll('.collection-card').forEach(card => {
                card.addEventListener('click', () => {
                    const index = parseInt(card.dataset.collectionIndex);
                    this.showCollectionDetail(this.filteredCollections[index]);
                });
            });
        }
    }

    /**
     * 显示藏品详情
     */
    showCollectionDetail(collection) {
        const modal = document.getElementById('collection-modal');
        if (!modal) return;

        const getQualityName = (quality) => {
            const names = {
                'common': '普通', 'uncommon': '不凡', 'rare': '稀有',
                'epic': '史诗', 'legendary': '传说', 'mythic': '神话'
            };
            return names[quality] || '普通';
        };

        const formatDate = (dateString) => {
            if (!dateString) return '未知';
            const date = new Date(dateString);
            return date.toLocaleString('zh-CN', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        };

        const qualityClass = `quality-${collection.quality || 'common'}`;
        const color = collection.color || '#9e9e9e';
        const icon = collection.icon || '📚';

        document.getElementById('modal-icon').textContent = icon;
        document.getElementById('modal-name').textContent = collection.name || '未知';

        let bodyHtml = `
            <div class="modal-info-row">
                <div class="modal-info-label">品质:</div>
                <div class="modal-info-value">
                    <span class="collection-quality ${qualityClass}">${getQualityName(collection.quality)}</span>
                </div>
            </div>
        `;

        if (collection.rarity) {
            bodyHtml += `
                <div class="modal-info-row">
                    <div class="modal-info-label">稀有度:</div>
                    <div class="modal-info-value">${collection.rarity}</div>
                </div>
            `;
        }

        if (collection.description) {
            bodyHtml += `
                <div class="modal-info-row">
                    <div class="modal-info-label">描述:</div>
                    <div class="modal-info-value">${collection.description}</div>
                </div>
            `;
        }

        if (collection.effect_description) {
            bodyHtml += `
                <div class="modal-effect">
                    <div class="modal-effect-title">✨ 效果</div>
                    <div>${collection.effect_description}</div>
                </div>
            `;
        }

        bodyHtml += `
            <div class="modal-info-row">
                <div class="modal-info-label">玄藏ID:</div>
                <div class="modal-info-value" style="font-family: monospace; font-size: 12px;">${collection.collection_id}</div>
            </div>
        `;

        if (collection.obtained_at) {
            bodyHtml += `
                <div class="modal-info-row">
                    <div class="modal-info-label">获得时间:</div>
                    <div class="modal-info-value">${formatDate(collection.obtained_at)}</div>
                </div>
            `;
        }

        if (collection.obtained_from_book_id) {
            bodyHtml += `
                <div class="modal-info-row">
                    <div class="modal-info-label">获得来源:</div>
                    <div class="modal-info-value">书籍ID: ${collection.obtained_from_book_id}</div>
                </div>
            `;
        }

        document.getElementById('modal-body').innerHTML = bodyHtml;
        modal.classList.add('active');
    }

    /**
     * 关闭详情弹窗
     */
    closeCollectionModal() {
        const modal = document.getElementById('collection-modal');
        if (modal) {
            modal.classList.remove('active');
        }
    }

    /**
     * 加载玄藏排行
     */
    async loadRanking() {
        const container = document.getElementById("ranking-content");
        if (!container) return;

        try {
            container.innerHTML = '<div class="game-loading">加载中...</div>';
            const response = await fetch("/api/game/collections/ranking?limit=100", {
                credentials: "include"
            });
            const result = await response.json();
            
            if (result.success) {
                const qualityNames = {
                    'common': '普通', 'uncommon': '不凡', 'rare': '稀有',
                    'epic': '史诗', 'legendary': '传说', 'mythic': '神话'
                };
                const qualityColors = {
                    'common': '#9e9e9e', 'uncommon': '#4caf50', 'rare': '#2196f3',
                    'epic': '#9c27b0', 'legendary': '#ff9800', 'mythic': '#f44336'
                };

                let html = `
                    <div class="game-section">
                        <div class="game-section-title">玄藏排行</div>
                        <div style="overflow-x: auto;">
                            <table style="width: 100%; border-collapse: collapse; background: var(--md-surface-container-low); border-radius: 12px; overflow: hidden;">
                                <thead>
                                    <tr style="background: var(--md-surface-container);">
                                        <th style="padding: 12px; text-align: left; font-weight: 600; width: 60px;">排名</th>
                                        <th style="padding: 12px; text-align: left; font-weight: 600;">藏品ID</th>
                                        <th style="padding: 12px; text-align: left; font-weight: 600;">名称</th>
                                        <th style="padding: 12px; text-align: left; font-weight: 600;">品质</th>
                                        <th style="padding: 12px; text-align: left; font-weight: 600;">稀有度</th>
                                        <th style="padding: 12px; text-align: left; font-weight: 600;">持有人</th>
                                        <th style="padding: 12px; text-align: left; font-weight: 600;">获得时间</th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                if (result.data.length === 0) {
                    html += `
                        <tr>
                            <td colspan="7" style="text-align: center; padding: 40px; color: var(--md-on-surface-variant);">
                                暂无排行数据
                            </td>
                        </tr>
                    `;
                } else {
                    result.data.forEach(item => {
                        const qualityName = qualityNames[item.quality] || '普通';
                        const color = qualityColors[item.quality] || '#9e9e9e';
                        const date = new Date(item.obtained_at).toLocaleString('zh-CN', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit'
                        });

                        html += `
                            <tr style="border-bottom: 1px solid var(--game-border);">
                                <td style="padding: 12px; font-weight: 600; color: var(--md-primary);">#${item.rank}</td>
                                <td style="padding: 12px; font-family: monospace; font-size: 11px;">${item.collection_id}</td>
                                <td style="padding: 12px;">${item.name || '未知'}</td>
                                <td style="padding: 12px;">
                                    <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; background: ${color}; color: white;">${qualityName}</span>
                                </td>
                                <td style="padding: 12px;">${item.rarity || 1}</td>
                                <td style="padding: 12px;">${item.username || '未知'}</td>
                                <td style="padding: 12px; font-size: 12px; color: var(--md-on-surface-variant);">${date}</td>
                            </tr>
                        `;
                    });
                }

                html += `
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;
                container.innerHTML = html;
            } else {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--md-error);">
                        <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                        <p>加载失败，请刷新重试</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error("加载排行失败:", error);
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--md-error);">
                    <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                    <p>加载失败，请刷新重试</p>
                </div>
            `;
        }
    }

    /**
     * 加载修为排行榜
     */
    async loadCultivationRanking() {
        const container = document.getElementById("cultivation-ranking-content");
        if (!container) return;

        try {
            container.innerHTML = '<div class="game-loading">加载中...</div>';
            const response = await fetch("/api/rankings/cultivation?limit=100", {
                credentials: "include"
            });
            
            if (!response.ok) {
                throw new Error("加载失败");
            }

            const rankings = await response.json();
            
            if (!rankings || rankings.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--md-on-surface-variant);">
                        <div style="font-size: 48px; margin-bottom: 10px;">📊</div>
                        <p>暂无排行数据</p>
                    </div>
                `;
                return;
            }

            // 格式化阅读时长
            const formatTime = (minutes) => {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                if (hours > 0) return `${hours}小时${mins}分钟`;
                return `${mins}分钟`;
            };

            // 格式化数字
            const formatNumber = (num) => {
                if (!num) return "0";
                if (num >= 10000) return (num / 10000).toFixed(1) + "w";
                return num.toLocaleString();
            };

            let html = `
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; background: var(--md-surface-container-low); border-radius: 12px; overflow: hidden;">
                        <thead>
                            <tr style="background: var(--md-surface-container);">
                                <th style="padding: 12px; text-align: left; font-weight: 600; width: 60px;">排名</th>
                                <th style="padding: 12px; text-align: left; font-weight: 600;">用户名</th>
                                <th style="padding: 12px; text-align: left; font-weight: 600;">境界</th>
                                <th style="padding: 12px; text-align: left; font-weight: 600;">修为</th>
                                <th style="padding: 12px; text-align: left; font-weight: 600;">阅读时长</th>
                                <th style="padding: 12px; text-align: left; font-weight: 600;">ID</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            rankings.forEach((user, index) => {
                const rank = user.rank || (index + 1);
                const rankClass = rank === 1 ? "top1" : rank === 2 ? "top2" : rank === 3 ? "top3" : "";
                const rankStyle = rank <= 3 
                    ? `font-weight: 700; color: ${rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : '#cd7f32'};` 
                    : 'font-weight: 600; color: var(--md-primary);';

                html += `
                    <tr style="border-bottom: 1px solid var(--game-border); ${rank <= 3 ? 'background: rgba(255, 215, 0, 0.05);' : ''}">
                        <td style="padding: 12px; ${rankStyle}">#${rank}</td>
                        <td style="padding: 12px; font-weight: 500;">${(user.username || `用户${user.user_id}`).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
                        <td style="padding: 12px;">
                            <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; background: var(--md-primary); color: white; font-weight: 600;">
                                ${user.levelName || "炼气期"} ${user.levelLayer || 1}层
                            </span>
                        </td>
                        <td style="padding: 12px; font-weight: 600; color: var(--md-primary);">${formatNumber(user.exp || 0)}</td>
                        <td style="padding: 12px; font-size: 13px; color: var(--md-on-surface-variant);">${formatTime(user.total_read_time || 0)}</td>
                        <td style="padding: 12px; font-family: monospace; font-size: 11px; color: var(--md-on-surface-variant);">${user.user_id}</td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
                </div>
            `;
            container.innerHTML = html;
        } catch (error) {
            console.error("加载修为排行榜失败:", error);
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--md-error);">
                    <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                    <p>加载失败，请刷新重试</p>
                </div>
            `;
        }
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

        // 生成会话哈希（防重复提交）
        const timestamp = Date.now();
        const sessionHash = this.generateSessionHash(bookId, chapterId, wordsRead, timestamp);

        try {
            const response = await fetch("/api/game/reading", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    wordsRead,
                    readingTime,
                    bookId,
                    chapterId,
                    sessionHash,
                    timestamp
                })
            });
            
            const result = await response.json();
            if (result.success && result.data) {
                // 检查是否获得玄藏
                if (result.data.collection) {
                    this.showCollectionNotification(result.data.collection);
                }
                
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
        // 防止快速翻页：限制单次添加的字数
        const maxWordsPerCheck = 5000;
        const actualWords = Math.min(words, maxWordsPerCheck);
        
        this.readingWords += actualWords;
        this.lastRewardCheck += actualWords;

        // 每1000字检查一次奖励
        if (this.lastRewardCheck >= this.rewardCheckInterval) {
            // 计算实际阅读时间（防止刷新刷修为）
            const now = Date.now();
            if (!this.lastReadingTime) {
                this.lastReadingTime = now;
            }
            const timeElapsed = Math.floor((now - this.lastReadingTime) / 1000); // 秒
            this.lastReadingTime = now;
            
            // 确保有最小阅读时间
            const minTime = Math.max(timeElapsed, Math.floor(this.lastRewardCheck / 1000 * 0.3)); // 至少0.3秒/千字
            
            this.recordReading(this.lastRewardCheck, minTime, bookId, chapterId);
            this.lastRewardCheck = 0;
        }
    }

    /**
     * 生成会话哈希（防重复提交）
     */
    generateSessionHash(bookId, chapterId, wordsRead, timestamp) {
        // 简单的哈希生成（前端版本）
        const hashString = `${bookId || ''}_${chapterId || ''}_${wordsRead}_${timestamp}_${Math.random()}`;
        let hash = 0;
        for (let i = 0; i < hashString.length; i++) {
            const char = hashString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * 显示藏品获得通知
     */
    showCollectionNotification(collection) {
        const qualityColors = {
            'common': '#9e9e9e',
            'uncommon': '#4caf50',
            'rare': '#2196f3',
            'epic': '#9c27b0',
            'legendary': '#ff9800',
            'mythic': '#f44336'
        };
        
        const qualityNames = {
            'common': '普通',
            'uncommon': '不凡',
            'rare': '稀有',
            'epic': '史诗',
            'legendary': '传说',
            'mythic': '神话'
        };
        
        const color = collection.color || qualityColors[collection.quality] || '#9e9e9e';
        const qualityName = qualityNames[collection.quality] || '普通';
        const icon = collection.icon || '📚';
        
        // 创建藏品获得弹窗
        const popup = document.createElement("div");
        popup.className = "game-collection-popup";
        popup.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 16px;
            padding: 30px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            z-index: 10000;
            text-align: center;
            min-width: 280px;
            border: 3px solid ${color};
        `;
        
        popup.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 15px;">✨</div>
            <div style="font-size: 20px; font-weight: 600; margin-bottom: 10px; color: #333;">
                获得玄藏！
            </div>
            <div style="font-size: 48px; margin: 15px 0;">${icon}</div>
            <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: ${color};">
                ${collection.name || '未知玄藏'}
            </div>
            <div style="display: inline-block; padding: 4px 12px; border-radius: 12px; background: ${color}; color: white; font-size: 12px; margin-bottom: 15px;">
                ${qualityName}
            </div>
            <div style="font-size: 11px; color: #999; font-family: monospace; word-break: break-all; margin-top: 10px;">
                ID: ${collection.collection_id}
            </div>
            <button style="margin-top: 20px; padding: 10px 24px; background: ${color}; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
                确定
            </button>
        `;
        
        document.body.appendChild(popup);
        
        // 添加动画
        setTimeout(() => {
            popup.style.opacity = '0';
            popup.style.transform = 'translate(-50%, -50%) scale(0.9)';
            popup.style.transition = 'all 0.3s ease';
        }, 100);
        
        // 点击关闭
        const closeBtn = popup.querySelector('button');
        closeBtn.addEventListener('click', () => {
            popup.style.opacity = '0';
            popup.style.transform = 'translate(-50%, -50%) scale(0.9)';
            setTimeout(() => {
                if (popup.parentNode) {
                    popup.remove();
                }
            }, 300);
        });
        
        // 3秒后自动关闭
        setTimeout(() => {
            if (popup.parentNode) {
                popup.style.opacity = '0';
                popup.style.transform = 'translate(-50%, -50%) scale(0.9)';
                setTimeout(() => {
                    if (popup.parentNode) {
                        popup.remove();
                    }
                }, 300);
            }
        }, 3000);
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

