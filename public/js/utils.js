/*
 * File: utils.js
 * Input: 无直接外部依赖
 * Output: 工具类和函数，包括防抖节流、懒加载、Toast通知、本地存储、表单验证等
 * Pos: 通用工具库，为所有模块提供通用功能和性能优化
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和public/js/文件夹的README.md
 */

/**
 * 工具函数库 - 性能优化和通用功能
 */

// ===== 防抖函数 =====
function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ===== 节流函数 =====
function throttle(func, limit = 300) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

// ===== 图片懒加载 =====
class LazyImageLoader {
    constructor(options = {}) {
        this.options = {
            root: null,
            rootMargin: "50px",
            threshold: 0.01,
            ...options
        };
        this.observer = null;
        this.init();
    }

    init() {
        if ("IntersectionObserver" in window) {
            this.observer = new IntersectionObserver(this.handleIntersection.bind(this), this.options);
            this.observe();
        } else {
            // 降级处理
            this.loadAllImages();
        }
    }

    handleIntersection(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                this.loadImage(img);
                this.observer.unobserve(img);
            }
        });
    }

    loadImage(img) {
        if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        }
        if (img.dataset.srcset) {
            img.srcset = img.dataset.srcset;
            img.removeAttribute('data-srcset');
        }
    }

    observe() {
        const images = document.querySelectorAll('img[data-src], img[data-srcset]');
        images.forEach(img => this.observer.observe(img));
    }

    loadAllImages() {
        const images = document.querySelectorAll('img[data-src], img[data-srcset]');
        images.forEach(img => this.loadImage(img));
    }

    // 添加新图片到观察列表
    observeNew(img) {
        if (this.observer && (img.dataset.src || img.dataset.srcset)) {
            this.observer.observe(img);
        } else {
            this.loadImage(img);
        }
    }

    disconnect() {
        if (this.observer) {
            this.observer.disconnect();
        }
    }
}

// ===== Toast通知增强 =====
class ToastManager {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        if (!document.getElementById("toast-container")) {
            this.container = document.createElement("div");
            this.container.id = "toast-container";
            this.container.className = "toast-container";
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById("toast-container");
        }
    }

    show(message, type = "info", duration = 3000) {
        const toast = document.createElement("div");
        toast.className = `toast toast-${type} show`;
        toast.textContent = message;

        // 添加图标
        const icon = this.getIcon(type);
        toast.innerHTML = `
            <span class="toast-icon">${icon}</span>
            <span class="toast-message">${message}</span>
        `;

        this.container.appendChild(toast);

        // 自动消失
        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 300);
        }, duration);

        return toast;
    }

    getIcon(type) {
        const icons = {
            success: "✓",
            error: "✕",
            warning: "⚠",
            info: "ℹ"
        };
        return icons[type] || icons.info;
    }

    success(message, duration) {
        return this.show(message, "success", duration);
    }

    error(message, duration) {
        return this.show(message, "error", duration);
    }

    warning(message, duration) {
        return this.show(message, "warning", duration);
    }

    info(message, duration) {
        return this.show(message, "info", duration);
    }
}

// ===== 本地存储管理 =====
class StorageManager {
    constructor(prefix = "po18_") {
        this.prefix = prefix;
    }

    set(key, value, expire = null) {
        const data = {
            value,
            expire: expire ? Date.now() + expire : null
        };
        try {
            localStorage.setItem(this.prefix + key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error("Storage set error:", e);
            return false;
        }
    }

    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(this.prefix + key);
            if (!item) return defaultValue;

            const data = JSON.parse(item);

            // 检查过期
            if (data.expire && Date.now() > data.expire) {
                this.remove(key);
                return defaultValue;
            }

            return data.value;
        } catch (e) {
            console.error("Storage get error:", e);
            return defaultValue;
        }
    }

    remove(key) {
        try {
            localStorage.removeItem(this.prefix + key);
            return true;
        } catch (e) {
            console.error("Storage remove error:", e);
            return false;
        }
    }

    clear() {
        try {
            const keys = Object.keys(localStorage);
            keys.forEach((key) => {
                if (key.startsWith(this.prefix)) {
                    localStorage.removeItem(key);
                }
            });
            return true;
        } catch (e) {
            console.error("Storage clear error:", e);
            return false;
        }
    }
    
    // 清除所有缓存
    clearAll() {
        try {
            localStorage.clear();
            console.log('LocalStorage 已清空');
            return true;
        } catch (e) {
            console.error("Storage clearAll error:", e);
            return false;
        }
    }
    
    // 清除缓存并刷新页面
    static clearAllCachesAndRefresh() {
        // 清除 LocalStorage
        try {
            localStorage.clear();
        } catch (e) {
            console.error("Clear localStorage error:", e);
        }
        
        // 清除 Service Worker 缓存
        if ('caches' in window) {
            caches.keys().then(names => {
                return Promise.all(
                    names.map(name => caches.delete(name))
                );
            }).then(() => {
                console.log('所有缓存已清除，刷新页面...');
                window.location.reload(true);
            });
        } else {
            window.location.reload(true);
        }
    }
}

// ===== 虚拟滚动列表 =====
class VirtualList {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            itemHeight: 100,
            buffer: 3,
            ...options
        };
        this.items = [];
        this.visibleRange = { start: 0, end: 0 };
        this.init();
    }

    init() {
        this.container.style.overflowY = "auto";
        this.container.style.position = "relative";

        // 创建包裹容器
        this.wrapper = document.createElement('div');
        this.wrapper.style.position = 'relative';
        this.container.appendChild(this.wrapper);

        this.scrollHandler = throttle(() => this.update(), 16);
        this.container.addEventListener("scroll", this.scrollHandler);
    }

    setData(items) {
        this.items = items;
        this.update();
    }

    update() {
        const scrollTop = this.container.scrollTop;
        const containerHeight = this.container.clientHeight;
        const { itemHeight, buffer } = this.options;

        const start = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
        const end = Math.min(this.items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer);

        if (start !== this.visibleRange.start || end !== this.visibleRange.end) {
            this.visibleRange = { start, end };
            this.render();
        }
    }

    render() {
        const { start, end } = this.visibleRange;
        const { itemHeight } = this.options;
        const visibleItems = this.items.slice(start, end);

        // 更新容器高度
        const totalHeight = this.items.length * itemHeight;
        if (this.wrapper) {
            this.wrapper.style.height = `${totalHeight}px`;
        }

        // 渲染可见项
        const offset = start * itemHeight;
        this.options.renderItem(visibleItems, offset);
    }

    destroy() {
        this.container.removeEventListener("scroll", this.scrollHandler);
    }
}

// ===== 动画工具 =====
class AnimationUtil {
    static fadeIn(element, duration = 300) {
        element.style.opacity = "0";
        element.style.display = "block";

        let start = null;
        const animate = (timestamp) => {
            if (!start) start = timestamp;
            const progress = timestamp - start;
            const opacity = Math.min(progress / duration, 1);

            element.style.opacity = opacity;

            if (progress < duration) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    }

    static fadeOut(element, duration = 300) {
        let start = null;
        const initialOpacity = parseFloat(getComputedStyle(element).opacity);

        const animate = (timestamp) => {
            if (!start) start = timestamp;
            const progress = timestamp - start;
            const opacity = Math.max(initialOpacity * (1 - progress / duration), 0);

            element.style.opacity = opacity;

            if (progress < duration) {
                requestAnimationFrame(animate);
            } else {
                element.style.display = "none";
            }
        };

        requestAnimationFrame(animate);
    }

    static slideDown(element, duration = 300) {
        element.style.display = "block";
        const height = element.scrollHeight;
        element.style.height = "0";
        element.style.overflow = "hidden";

        let start = null;
        const animate = (timestamp) => {
            if (!start) start = timestamp;
            const progress = timestamp - start;
            const currentHeight = Math.min((progress / duration) * height, height);

            element.style.height = `${currentHeight}px`;

            if (progress < duration) {
                requestAnimationFrame(animate);
            } else {
                element.style.height = "";
                element.style.overflow = "";
            }
        };

        requestAnimationFrame(animate);
    }
}

// ===== 表单验证工具 =====
class FormValidator {
    constructor(form) {
        this.form = form;
        this.rules = {};
    }

    addRule(fieldName, rules) {
        this.rules[fieldName] = rules;
        return this;
    }

    validate() {
        const errors = {};
        let isValid = true;

        Object.keys(this.rules).forEach((fieldName) => {
            const field = this.form.querySelector(`[name="${fieldName}"]`);
            if (!field) return;

            const value = field.value.trim();
            const rules = this.rules[fieldName];

            for (const rule of rules) {
                const error = this.validateRule(value, rule);
                if (error) {
                    errors[fieldName] = error;
                    isValid = false;
                    this.showError(field, error);
                    break;
                } else {
                    this.clearError(field);
                }
            }
        });

        return { isValid, errors };
    }

    validateRule(value, rule) {
        if (rule.required && !value) {
            return rule.message || "此字段必填";
        }

        if (rule.minLength && value.length < rule.minLength) {
            return rule.message || `最少${rule.minLength}个字符`;
        }

        if (rule.maxLength && value.length > rule.maxLength) {
            return rule.message || `最多${rule.maxLength}个字符`;
        }

        if (rule.pattern && !rule.pattern.test(value)) {
            return rule.message || "格式不正确";
        }

        if (rule.custom && !rule.custom(value)) {
            return rule.message || "验证失败";
        }

        return null;
    }

    showError(field, message) {
        field.classList.add("input-error");

        let errorElement = field.parentElement.querySelector(".input-error-message");
        if (!errorElement) {
            errorElement = document.createElement("div");
            errorElement.className = "input-error-message";
            field.parentElement.appendChild(errorElement);
        }
        errorElement.textContent = message;
    }

    clearError(field) {
        field.classList.remove("input-error");
        const errorElement = field.parentElement.querySelector(".input-error-message");
        if (errorElement) {
            errorElement.remove();
        }
    }
}

// ===== 导出工具 =====
window.Utils = {
    debounce,
    throttle,
    LazyImageLoader,
    ToastManager,
    StorageManager,
    VirtualList,
    AnimationUtil,
    FormValidator
};

// 创建全局实例
window.toast = new ToastManager();
window.storage = new StorageManager();
window.lazyLoader = new LazyImageLoader();

console.log("✅ Utils library loaded");
