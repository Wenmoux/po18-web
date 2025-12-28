/**
 * 主题管理器
 * 提供主题编辑、导入/导出、保存/加载等功能
 */

(function() {
    'use strict';

    const THEME_STORAGE_KEY = 'po18_custom_themes';
    const CURRENT_THEME_KEY = 'po18_current_theme';

    // 获取所有自定义主题
    function getCustomThemes() {
        try {
            const saved = localStorage.getItem(THEME_STORAGE_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            console.error('读取自定义主题失败:', e);
            return {};
        }
    }

    // 保存自定义主题
    function saveCustomTheme(themeName, themeData) {
        try {
            const themes = getCustomThemes();
            themes[themeName] = {
                ...themeData,
                name: themeName,
                createdAt: themes[themeName]?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themes));
            return true;
        } catch (e) {
            console.error('保存自定义主题失败:', e);
            return false;
        }
    }

    // 删除自定义主题
    function deleteCustomTheme(themeName) {
        try {
            const themes = getCustomThemes();
            delete themes[themeName];
            localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themes));
            return true;
        } catch (e) {
            console.error('删除自定义主题失败:', e);
            return false;
        }
    }

    // 获取当前使用的主题
    function getCurrentTheme() {
        try {
            const saved = localStorage.getItem(CURRENT_THEME_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    }

    // 设置当前使用的主题
    function setCurrentTheme(themeName, themeData) {
        try {
            localStorage.setItem(CURRENT_THEME_KEY, JSON.stringify({
                name: themeName,
                data: themeData,
                appliedAt: new Date().toISOString()
            }));
            return true;
        } catch (e) {
            console.error('设置当前主题失败:', e);
            return false;
        }
    }

    // 导出主题为JSON
    function exportTheme(themeName) {
        const themes = getCustomThemes();
        const theme = themes[themeName];
        if (!theme) {
            return null;
        }

        return JSON.stringify({
            name: theme.name,
            version: '1.0',
            exportedAt: new Date().toISOString(),
            theme: {
                backgroundColor: theme.backgroundColor,
                textColor: theme.textColor,
                titleColor: theme.titleColor,
                highlightColor: theme.highlightColor,
                backgroundImage: theme.backgroundImage || '',
                backgroundRepeat: theme.backgroundRepeat || 'no-repeat',
                backgroundSize: theme.backgroundSize || 'cover',
                backgroundPosition: theme.backgroundPosition || 'center'
            }
        }, null, 2);
    }

    // 导入主题从JSON
    function importTheme(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            if (!data.theme || !data.name) {
                throw new Error('无效的主题格式');
            }

            const themeName = data.name;
            const themeData = {
                backgroundColor: data.theme.backgroundColor || '#FFFFFF',
                textColor: data.theme.textColor || '#333333',
                titleColor: data.theme.titleColor || '#1a1a1a',
                highlightColor: data.theme.highlightColor || '#D81B60',
                backgroundImage: data.theme.backgroundImage || '',
                backgroundRepeat: data.theme.backgroundRepeat || 'no-repeat',
                backgroundSize: data.theme.backgroundSize || 'cover',
                backgroundPosition: data.theme.backgroundPosition || 'center'
            };

            // 如果主题已存在，添加后缀
            const themes = getCustomThemes();
            let finalName = themeName;
            let counter = 1;
            while (themes[finalName]) {
                finalName = `${themeName}_${counter}`;
                counter++;
            }

            saveCustomTheme(finalName, themeData);
            return { success: true, name: finalName };
        } catch (e) {
            console.error('导入主题失败:', e);
            return { success: false, error: e.message };
        }
    }

    // 验证主题数据
    function validateTheme(themeData) {
        const required = ['backgroundColor', 'textColor', 'titleColor', 'highlightColor'];
        for (const field of required) {
            if (!themeData[field]) {
                return { valid: false, error: `缺少必需字段: ${field}` };
            }
        }
        return { valid: true };
    }

    // 导出到全局
    window.ThemeManager = {
        getCustomThemes,
        saveCustomTheme,
        deleteCustomTheme,
        getCurrentTheme,
        setCurrentTheme,
        exportTheme,
        importTheme,
        validateTheme
    };
})();

