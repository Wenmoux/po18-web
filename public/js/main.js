
/*
 * File: main.js
 * Input: app.js, api.js
 * Output: 应用启动逻辑，初始化各个模块和加载初始数据
 * Pos: 应用启动入口，负责初始化应用并启动各个模块
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和public/js/文件夹的README.md
 */

// 页面初始化
async function initApp() {
    showLoading();
    
    try {
        // 并行加载必要数据
        await Promise.all([
            loadUserInfo(),
            loadSubscriptionBadge(),
            loadShareStats(),  // 加载分享统计信息
            loadGlobalLibraryAccess()
        ]);
        
        // 初始化各页面
        initPages();
        
        hideLoading();
    } catch (error) {
        hideLoading();
        showToast("初始化失败: " + error.message, "error");
    }
}

// 加载用户信息
async function loadUserInfo() {
    try {
        const response = await fetch("/api/auth/me");
        if (response.ok) {
            const userInfo = await response.json();
            currentUser = userInfo;
            
            // 更新UI
            document.getElementById("user-display-name").textContent = userInfo.nickname || userInfo.username;
            document.getElementById("user-avatar").textContent = (userInfo.nickname || userInfo.username).charAt(0);
            
            // 更新设置页面的用户信息
            document.getElementById("user-nickname").value = userInfo.nickname || "";
            document.getElementById("user-bio").value = userInfo.bio || "";
            
            // 更新偏好设置
            if (userInfo.preferences) {
                document.getElementById("pref-night-mode").checked = userInfo.preferences.nightMode || false;
                document.getElementById("pref-auto-sync").checked = userInfo.preferences.autoSync || false;
                document.getElementById("pref-push-notifications").checked = userInfo.preferences.pushNotifications || false;
            }
            
            // 更新喜爱类型
            if (userInfo.favoriteGenres) {
                const select = document.getElementById("user-favorite-genres");
                userInfo.favoriteGenres.forEach(genre => {
                    const option = select.querySelector(`option[value="${genre}"]`);
                    if (option) option.selected = true;
                });
            }
        }
    } catch (error) {
        console.warn("加载用户信息失败:", error);
    }
}

// 加载分享统计信息
async function loadShareStats() {
    try {
        // 获取排行榜信息
        const rankingResponse = await fetch("/api/share-rankings?limit=100");
        if (rankingResponse.ok) {
            const rankings = await rankingResponse.json();
            const userRanking = rankings.findIndex(r => r.user_id == currentUser.id) + 1;
            const rankingElement = document.getElementById("share-ranking");
            if (rankingElement) {
                rankingElement.textContent = userRanking > 0 ? userRanking : "-";
            }
        }
    } catch (error) {
        console.warn("加载分享统计信息失败:", error);
    }
}
