/**
 * PO18书库 - 国际化框架
 */

const I18n = {
    currentLang: "zh-CN",
    fallbackLang: "zh-CN",
    translations: {},

    // 支持的语言
    languages: {
        "zh-CN": "简体中文",
        "zh-TW": "繁體中文",
        en: "English",
        ja: "日本語",
        ko: "한국어"
    },

    // 初始化
    async init() {
        // 从localStorage读取用户偏好
        const saved = localStorage.getItem("app-language");
        if (saved && this.languages[saved]) {
            this.currentLang = saved;
        } else {
            // 检测浏览器语言
            const browserLang = navigator.language || navigator.userLanguage;
            if (this.languages[browserLang]) {
                this.currentLang = browserLang;
            } else if (browserLang.startsWith("zh")) {
                this.currentLang = browserLang.includes("TW") || browserLang.includes("HK") ? "zh-TW" : "zh-CN";
            } else if (browserLang.startsWith("en")) {
                this.currentLang = "en";
            } else if (browserLang.startsWith("ja")) {
                this.currentLang = "ja";
            } else if (browserLang.startsWith("ko")) {
                this.currentLang = "ko";
            }
        }

        // 加载翻译文件
        await this.loadTranslations(this.currentLang);

        // 应用翻译
        this.applyTranslations();

        // 设置HTML语言属性
        document.documentElement.lang = this.currentLang;
    },

    // 加载翻译文件
    async loadTranslations(lang) {
        try {
            const response = await fetch(`/i18n/${lang}.json`);
            if (response.ok) {
                this.translations[lang] = await response.json();
            } else {
                console.warn(`翻译文件加载失败: ${lang}`);
                if (lang !== this.fallbackLang) {
                    await this.loadTranslations(this.fallbackLang);
                }
            }
        } catch (error) {
            console.error("加载翻译失败:", error);
        }
    },

    // 获取翻译文本
    t(key, params = {}) {
        const keys = key.split(".");
        let value = this.translations[this.currentLang];

        // 遍历键路径
        for (const k of keys) {
            if (value && typeof value === "object") {
                value = value[k];
            } else {
                value = undefined;
                break;
            }
        }

        // 如果找不到，尝试fallback语言
        if (value === undefined && this.currentLang !== this.fallbackLang) {
            let fallback = this.translations[this.fallbackLang];
            for (const k of keys) {
                if (fallback && typeof fallback === "object") {
                    fallback = fallback[k];
                } else {
                    fallback = undefined;
                    break;
                }
            }
            value = fallback;
        }

        // 如果还是找不到，返回键名
        if (value === undefined) {
            return key;
        }

        // 替换参数
        if (typeof value === "string" && Object.keys(params).length > 0) {
            Object.keys(params).forEach((param) => {
                value = value.replace(new RegExp(`\\{${param}\\}`, "g"), params[param]);
            });
        }

        return value;
    },

    // 切换语言
    async switchLanguage(lang) {
        if (!this.languages[lang]) {
            console.error("不支持的语言:", lang);
            return false;
        }

        // 如果翻译未加载，先加载
        if (!this.translations[lang]) {
            await this.loadTranslations(lang);
        }

        this.currentLang = lang;
        localStorage.setItem("app-language", lang);
        document.documentElement.lang = lang;

        // 重新应用翻译
        this.applyTranslations();

        // 触发语言切换事件
        window.dispatchEvent(new CustomEvent("languageChanged", { detail: { lang } }));

        return true;
    },

    // 应用翻译到DOM
    applyTranslations() {
        // 翻译所有带 data-i18n 属性的元素
        document.querySelectorAll("[data-i18n]").forEach((el) => {
            const key = el.getAttribute("data-i18n");
            const translation = this.t(key);

            // 根据元素类型设置文本
            if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
                if (el.placeholder !== undefined) {
                    el.placeholder = translation;
                }
            } else {
                el.textContent = translation;
            }
        });

        // 翻译所有带 data-i18n-html 属性的元素（支持HTML）
        document.querySelectorAll("[data-i18n-html]").forEach((el) => {
            const key = el.getAttribute("data-i18n-html");
            el.innerHTML = this.t(key);
        });

        // 翻译所有带 data-i18n-title 属性的元素
        document.querySelectorAll("[data-i18n-title]").forEach((el) => {
            const key = el.getAttribute("data-i18n-title");
            el.title = this.t(key);
        });

        // 翻译所有带 data-i18n-placeholder 属性的元素
        document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
            const key = el.getAttribute("data-i18n-placeholder");
            el.placeholder = this.t(key);
        });
    },

    // 获取当前语言
    getCurrentLanguage() {
        return this.currentLang;
    },

    // 获取当前语言显示名称
    getCurrentLanguageName() {
        return this.languages[this.currentLang] || this.currentLang;
    },

    // 获取所有支持的语言
    getSupportedLanguages() {
        return Object.keys(this.languages).map((code) => ({
            code,
            name: this.languages[code]
        }));
    }
};

// 导出为全局对象（兼容旧代码）
if (typeof window !== "undefined") {
    window.I18n = I18n;
}

// 支持模块化导入
if (typeof module !== "undefined" && module.exports) {
    module.exports = I18n;
}
