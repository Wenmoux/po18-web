/*
 * File: performance-optimizer.js
 * Input: DOM元素，浏览器API
 * Output: 性能优化功能，包括资源预加载、图片优化、虚拟滚动等
 * Pos: 性能优化核心模块，负责提升应用加载速度和运行流畅度
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和public/js/文件夹的README.md
 */

/**
 * 性能优化模块
 * 专注于加载速度和流畅度优化
 */

(function() {
    'use strict';

    console.log('[性能优化] 开始初始化...');

    // 过滤浏览器扩展相关的错误
    const originalError = console.error;
    console.error = function(...args) {
        const message = args.join(' ');
        // 忽略浏览器扩展相关的错误，但保留其他错误
        if (message.includes('chrome-extension://') || 
            message.includes('NotReadableError') ||
            message.includes('web_accessible_resources')) {
            return;
        }
        // 保留业务错误
        originalError.apply(console, args);
    };

    // ==================== 1. 预加载关键资源 ====================
    class ResourcePreloader {
        constructor() {
            this.preloadQueue = [];
            this.init();
        }

        init() {
            // 预加载关键字体
            this.preloadFont('Noto Sans SC', 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&display=swap');
            
            // 预连接到关键域名
            this.preconnectDomains([
                'https://www.po18.tw',
                'https://unpkg.com'
            ]);

            // 预加载关键图片
            this.preloadCriticalImages();
        }

        preloadFont(name, url) {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'style';
            link.href = url;
            document.head.appendChild(link);
        }

        preconnectDomains(domains) {
            domains.forEach(domain => {
                const link = document.createElement('link');
                link.rel = 'dns-prefetch';
                link.href = domain;
                document.head.appendChild(link);
            });
        }

        preloadCriticalImages() {
            // 预加载默认封面等关键图片 - 仅预连接，不预加载
            const criticalImages = [
                '/icons/icon.svg'
            ];

            // 使用 dns-prefetch 而不是 preload
            criticalImages.forEach(src => {
                const img = new Image();
                img.src = src;
            });
        }
    }

    // ==================== 2. 图片优化 ====================
    class ImageOptimizer {
        constructor() {
            this.observer = null;
            this.init();
        }

        init() {
            // 使用 Intersection Observer 优化图片加载
            this.setupLazyLoading();
            
            // 图片加载失败重试
            this.setupImageRetry();
            
            // WebP支持检测
            this.checkWebPSupport();
            
            // 设置渐进式加载
            this.setupProgressiveImageLoading();
        }

        setupLazyLoading() {
            // 使用 Intersection Observer 实现真正的懒加载
            if ('IntersectionObserver' in window) {
                this.observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const img = entry.target;
                            
                            // 如果有 data-src，加载真实图片
                            if (img.dataset.src) {
                                img.src = img.dataset.src;
                                img.removeAttribute('data-src');
                            }
                            
                            // 如果有 data-srcset，加载响应式图片
                            if (img.dataset.srcset) {
                                img.srcset = img.dataset.srcset;
                                img.removeAttribute('data-srcset');
                            }
                            
                            // 停止观察
                            this.observer.unobserve(img);
                        }
                    });
                }, {
                    rootMargin: '50px', // 提前50px开始加载
                    threshold: 0.01
                });
                
                // 观察所有带 data-src 的图片
                document.addEventListener('DOMContentLoaded', () => {
                    this.observeImages();
                });
                
                // 监听DOM变化，观察新添加的图片
                const mutationObserver = new MutationObserver(() => {
                    this.observeImages();
                });
                
                mutationObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            } else {
                // 降级：直接加载所有图片
                document.addEventListener('DOMContentLoaded', () => {
                    document.querySelectorAll('img[data-src]').forEach(img => {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    });
                });
            }
        }

        observeImages() {
            if (!this.observer) return;
            
            const images = document.querySelectorAll('img[data-src]:not([src]), img[data-srcset]:not([srcset])');
            images.forEach(img => {
                this.observer.observe(img);
            });
        }

        setupProgressiveImageLoading() {
            // 为所有图片添加渐进式加载效果
            document.addEventListener('DOMContentLoaded', () => {
                const images = document.querySelectorAll('img');
                images.forEach(img => {
                    if (!img.complete) {
                        img.classList.add('loading');
                        img.addEventListener('load', () => {
                            img.classList.remove('loading');
                            img.classList.add('loaded');
                        }, { once: true });
                    }
                });
            });
        }

        setupImageRetry() {
            document.addEventListener('error', (e) => {
                if (e.target.tagName === 'IMG') {
                    const img = e.target;
                    const retryCount = parseInt(img.dataset.retryCount || '0');
                    
                    if (retryCount < 3) {
                        setTimeout(() => {
                            img.dataset.retryCount = retryCount + 1;
                            const currentSrc = img.src;
                            img.src = ''; // 清空
                            img.src = currentSrc; // 重试
                        }, 1000 * (retryCount + 1));
                    }
                }
            }, true);
        }

        checkWebPSupport() {
            const webP = new Image();
            webP.src = 'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
            webP.onload = webP.onerror = () => {
                window.supportsWebP = (webP.height === 2);
            };
        }
    }

    // ==================== 3. 代码分割和懒加载 ====================
    class CodeSplitter {
        constructor() {
            this.loadedModules = new Set();
        }

        async loadModule(moduleName) {
            if (this.loadedModules.has(moduleName)) {
                return;
            }

            try {
                switch(moduleName) {
                    case 'epub':
                        await this.loadEpubGenerator();
                        break;
                    case 'charts':
                        await this.loadCharts();
                        break;
                }
                this.loadedModules.add(moduleName);
            } catch (error) {
                console.error(`[代码分割] 模块加载失败: ${moduleName}`, error);
            }
        }

        async loadEpubGenerator() {
            // 只在需要生成EPUB时加载
            if (!window.EpubGenerator) {
                const script = document.createElement('script');
                script.src = '/js/epub-generator.js';
                document.head.appendChild(script);
                await new Promise(resolve => script.onload = resolve);
            }
        }

        async loadCharts() {
            // 只在统计页面加载图表库
            if (!window.Chart) {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
                document.head.appendChild(script);
                await new Promise(resolve => script.onload = resolve);
            }
        }
    }

    // ==================== 4. 请求优化 ====================
    class RequestOptimizer {
        constructor() {
            this.requestCache = new Map();
            this.pendingRequests = new Map();
            this.init();
        }

        init() {
            // 拦截fetch请求，添加缓存和去重
            this.interceptFetch();
        }

        interceptFetch() {
            const originalFetch = window.fetch;
            window.fetch = async (url, options = {}) => {
                // 只缓存GET请求
                if (!options.method || options.method === 'GET') {
                    const cacheKey = this.getCacheKey(url, options);
                    
                    // 检查缓存
                    if (this.requestCache.has(cacheKey)) {
                        const cached = this.requestCache.get(cacheKey);
                        if (Date.now() - cached.timestamp < 60000) { // 1分钟缓存
                            return Promise.resolve(cached.response.clone());
                        }
                    }

                    // 请求去重
                    if (this.pendingRequests.has(cacheKey)) {
                        return this.pendingRequests.get(cacheKey);
                    }

                    // 发起请求
                    const fetchPromise = originalFetch(url, options).then(response => {
                        this.requestCache.set(cacheKey, {
                            response: response.clone(),
                            timestamp: Date.now()
                        });
                        this.pendingRequests.delete(cacheKey);
                        return response;
                    });

                    this.pendingRequests.set(cacheKey, fetchPromise);
                    return fetchPromise;
                }

                return originalFetch(url, options);
            };
        }

        getCacheKey(url, options) {
            return `${url}_${JSON.stringify(options)}`;
        }

        clearCache() {
            this.requestCache.clear();
        }
    }

    // ==================== 5. 渲染优化 ====================
    class RenderOptimizer {
        constructor() {
            this.init();
        }

        init() {
            // 使用 requestIdleCallback 延迟非关键任务
            this.setupIdleTaskScheduler();
            
            // 优化DOM操作
            this.optimizeDOMOperations();
            
            // 减少重排重绘
            this.reduceReflows();
        }

        setupIdleTaskScheduler() {
            window.scheduleIdleTask = (task) => {
                if ('requestIdleCallback' in window) {
                    requestIdleCallback(task);
                } else {
                    setTimeout(task, 1);
                }
            };
        }

        optimizeDOMOperations() {
            // 批量DOM操作辅助函数
            window.batchDOMUpdate = (callback) => {
                requestAnimationFrame(() => {
                    callback();
                });
            };
        }

        reduceReflows() {
            // 读写分离，避免强制同步布局
            window.readThenWrite = (readCallback, writeCallback) => {
                const readResult = readCallback();
                requestAnimationFrame(() => {
                    writeCallback(readResult);
                });
            };
        }
    }

    // ==================== 6. 内存优化 ====================
    class MemoryOptimizer {
        constructor() {
            this.init();
        }

        init() {
            // 定期清理未使用的缓存
            this.setupCacheCleanup();
            
            // 监控内存使用
            this.monitorMemory();
            
            // 优化大列表
            this.optimizeLargeListRendering();
        }

        setupCacheCleanup() {
            setInterval(() => {
                // 清理超过5分钟的图片缓存
                if (window.lazyLoader && window.lazyLoader.observer) {
                    const images = document.querySelectorAll('img[data-src]');
                    if (images.length > 100) {
                        // 断开不在视口内的图片观察
                        images.forEach((img, index) => {
                            if (index > 50) {
                                window.lazyLoader.observer.unobserve(img);
                            }
                        });
                    }
                }

                // 清理旧的请求缓存
                if (window.requestOptimizer) {
                    window.requestOptimizer.clearCache();
                }
            }, 5 * 60 * 1000);
        }

        monitorMemory() {
            if ('memory' in performance) {
                setInterval(() => {
                    const memory = performance.memory;
                    const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
                    
                    if (usagePercent > 90) {
                        console.warn('[内存警告] 内存使用超过90%，触发清理');
                        this.forceCleanup();
                    }
                }, 30000);
            }
        }

        forceCleanup() {
            // 强制垃圾回收提示
            if (window.gc) {
                window.gc();
            }

            // 清理所有缓存
            if (window.App) {
                window.App.rankingCache = {};
            }

            // 移除不可见的DOM元素
            document.querySelectorAll('.page:not(.active)').forEach(page => {
                const images = page.querySelectorAll('img');
                images.forEach(img => {
                    if (img.src && !img.dataset.src) {
                        img.dataset.src = img.src;
                        img.src = '';
                    }
                });
            });
        }

        optimizeLargeListRendering() {
            // 为大列表添加虚拟滚动建议
            const observer = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.classList && node.classList.contains('book-list')) {
                            const items = node.children.length;
                            if (items > 100) {
                                console.log(`[性能提示] 检测到大列表(${items}项)，建议使用虚拟滚动`);
                            }
                        }
                    });
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    }

    // ==================== 7. 加载策略优化 ====================
    class LoadingStrategy {
        constructor() {
            this.init();
        }

        init() {
            // 关键CSS内联
            this.inlineCriticalCSS();
            
            // 非关键资源延迟加载
            this.deferNonCriticalResources();
            
            // 预测性预加载
            this.setupPredictivePreload();
        }

        inlineCriticalCSS() {
            // 提取首屏关键CSS并内联
            if (!document.querySelector('style#critical-css')) {
                const criticalCSS = `
                    body { margin: 0; font-family: -apple-system, sans-serif; }
                    .loading { opacity: 0; }
                    .loaded { opacity: 1; transition: opacity 0.3s; }
                    .skeleton { background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
                                background-size: 200% 100%; animation: loading 1.5s infinite; }
                    @keyframes loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
                `;
                const style = document.createElement('style');
                style.id = 'critical-css';
                style.textContent = criticalCSS;
                document.head.insertBefore(style, document.head.firstChild);
            }
        }

        deferNonCriticalResources() {
            // 延迟加载非关键JS
            window.addEventListener('load', () => {
                setTimeout(() => {
                    // 延迟加载分析脚本等
                    this.loadAnalytics();
                }, 2000);
            });
        }

        loadAnalytics() {
            // 延迟加载统计代码
            console.log('[延迟加载] 分析脚本加载完成');
        }

        setupPredictivePreload() {
            // 鼠标悬停时预加载链接
            let hoverTimer;
            document.addEventListener('mouseover', (e) => {
                const link = e.target.closest('a[href]');
                if (link && link.href.includes('/book-detail.html')) {
                    hoverTimer = setTimeout(() => {
                        const url = new URL(link.href);
                        const bookId = url.searchParams.get('id');
                        if (bookId) {
                            this.preloadBookDetail(bookId);
                        }
                    }, 300);
                }
            });

            document.addEventListener('mouseout', () => {
                clearTimeout(hoverTimer);
            });
        }

        preloadBookDetail(bookId) {
            // 预加载书籍详情数据
            fetch(`/api/books/${bookId}`)
                .then(response => response.json())
                .catch(() => {});
        }
    }

    // ==================== 8. 网络优化 ====================
    class NetworkOptimizer {
        constructor() {
            this.init();
        }

        init() {
            // 检测网络状态
            this.detectNetworkSpeed();
            
            // 根据网络状态调整策略
            this.adaptToNetwork();
        }

        detectNetworkSpeed() {
            if ('connection' in navigator) {
                const connection = navigator.connection;
                const effectiveType = connection.effectiveType;
                
                window.networkSpeed = effectiveType;
                
                connection.addEventListener('change', () => {
                    window.networkSpeed = connection.effectiveType;
                    this.adaptToNetwork();
                });
            }
        }

        adaptToNetwork() {
            const speed = window.networkSpeed;
            
            if (speed === 'slow-2g' || speed === '2g') {
                // 慢速网络：禁用自动预加载
                console.log('[网络优化] 检测到慢速网络，优化加载策略');
                window.autoPreload = false;
                
                // 降低图片质量
                document.querySelectorAll('img').forEach(img => {
                    if (img.dataset.lowQuality) {
                        img.src = img.dataset.lowQuality;
                    }
                });
            } else if (speed === '4g') {
                // 快速网络：启用预加载
                window.autoPreload = true;
            }
        }
    }

    // ==================== 初始化所有优化器 ====================
    window.addEventListener('DOMContentLoaded', () => {
        // 资源预加载
        window.resourcePreloader = new ResourcePreloader();
        
        // 图片优化
        window.imageOptimizer = new ImageOptimizer();
        
        // 代码分割
        window.codeSplitter = new CodeSplitter();
        
        // 请求优化
        window.requestOptimizer = new RequestOptimizer();
        
        // 渲染优化
        window.renderOptimizer = new RenderOptimizer();
        
        // 内存优化
        window.memoryOptimizer = new MemoryOptimizer();
        
        // 加载策略
        window.loadingStrategy = new LoadingStrategy();
        
        // 网络优化
        window.networkOptimizer = new NetworkOptimizer();

        console.log('[性能优化] ✅ 所有优化器已初始化');
    });

    // ==================== 性能监控 ====================
    window.addEventListener('load', () => {
        // 等待所有资源加载完成后统计性能
        setTimeout(() => {
            if (window.performance && window.performance.timing) {
                const timing = performance.timing;
                
                // 修复：使用 fetchStart 或 domainLookupStart 作为起点
                const startPoint = timing.fetchStart || timing.domainLookupStart || timing.navigationStart;
                const loadTime = timing.loadEventEnd - startPoint;
                const domReady = timing.domContentLoadedEventEnd - startPoint;
                const firstPaint = performance.getEntriesByType('paint')[0];
                
                // 过滤异常的加载时间（超过60秒可能是统计错误）
                const displayLoadTime = loadTime > 60000 ? domReady : loadTime;
                
                console.log('%c📊 [性能统计]', 'color: #4CAF50; font-weight: bold; font-size: 16px; padding: 10px 0;');
                console.log('%c──────────────────────────────', 'color: #ddd');
                console.log(`%c⏱️  页面加载: ${displayLoadTime}ms`, displayLoadTime < 2000 ? 'color: #4CAF50; font-weight: bold' : displayLoadTime < 3000 ? 'color: #FF9800' : 'color: #f44336');
                console.log(`%c📦  DOM解析: ${domReady}ms`, domReady < 1500 ? 'color: #4CAF50' : domReady < 2000 ? 'color: #FF9800' : 'color: #f44336');
                if (firstPaint) {
                    const fpTime = firstPaint.startTime.toFixed(0);
                    console.log(`%c🎨  首次绘制: ${fpTime}ms`, fpTime < 1000 ? 'color: #4CAF50' : fpTime < 1500 ? 'color: #FF9800' : 'color: #f44336');
                }

                // 性能评分（使用修正后的时间）
                let score = 100;
                if (displayLoadTime > 2000) score -= 10;
                if (displayLoadTime > 3000) score -= 20;
                if (displayLoadTime > 5000) score -= 30;
                if (domReady > 1500) score -= 10;
                if (domReady > 2000) score -= 20;
                
                const scoreColor = score >= 90 ? '#4CAF50' : score >= 80 ? '#8BC34A' : score >= 60 ? '#FF9800' : '#f44336';
                const scoreEmoji = score >= 90 ? '🎉' : score >= 80 ? '🚀' : score >= 60 ? '⚠️' : '🐢';
                console.log(`%c${scoreEmoji}  性能评分: ${Math.max(0, score)}/100`, `color: ${scoreColor}; font-weight: bold; font-size: 18px`);
                console.log('%c──────────────────────────────', 'color: #ddd');

                // 资源加载统计
                const resources = performance.getEntriesByType('resource');
                console.log(`%c📦  加载资源: ${resources.length} 个`, 'color: #2196F3');
                
                // 最慢资源
                const slowestResources = resources
                    .sort((a, b) => b.duration - a.duration)
                    .slice(0, 3);
                if (slowestResources.length > 0) {
                    console.log('%c🐌  最慢资源 TOP 3:', 'color: #FF9800; font-weight: bold');
                    slowestResources.forEach((r, i) => {
                        const fileName = r.name.split('/').pop().split('?')[0];
                        console.log(`   ${i+1}. ${fileName}: %c${r.duration.toFixed(0)}ms`, 'color: #FF9800');
                    });
                }

                // 内存使用
                if (performance.memory) {
                    const memory = performance.memory;
                    const usedMB = (memory.usedJSHeapSize / 1048576).toFixed(1);
                    const limitMB = (memory.jsHeapSizeLimit / 1048576).toFixed(1);
                    const usagePercent = ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(1);
                    const memoryColor = usagePercent < 50 ? '#4CAF50' : usagePercent < 75 ? '#FF9800' : '#f44336';
                    console.log(`%c🧠  内存使用: ${usedMB}MB / ${limitMB}MB (${usagePercent}%)`, `color: ${memoryColor}`);
                }

                // 在页面上显示性能徽章（仅开发环境）
                if (window.location.hostname === 'localhost') {
                    showPerformanceBadge(score, displayLoadTime);
                }
                
                // 如果图片加载慢，给出优化建议
                const slowImages = resources.filter(r => 
                    isImageResource(r.name) && r.duration > 3000
                );
                if (slowImages.length > 0) {
                    console.log('%c💡 优化建议:', 'color: #2196F3; font-weight: bold');
                    console.log('   检测到慢速图片加载，建议：');
                    console.log('   1. 启用图片懒加载');
                    console.log('   2. 使用 CDN 加速图片');
                    console.log('   3. 压缩图片大小（建议<200KB）');
                    console.log('   4. 使用 WebP 格式');
                }
            }
        }, 0);
    });

    // 判断是否为图片资源
    function isImageResource(url) {
        return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(url);
    }

    // 显示性能徽章
    function showPerformanceBadge(score, loadTime) {
        const badge = document.createElement('div');
        badge.id = 'perf-badge';
        badge.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: ${score >= 80 ? '#4CAF50' : score >= 60 ? '#FF9800' : '#f44336'};
            color: white;
            padding: 8px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            z-index: 9999;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            transition: transform 0.2s;
        `;
        badge.innerHTML = `⚡ ${score} | ${loadTime}ms`;
        badge.title = '点击查看详情';
        
        badge.addEventListener('mouseenter', () => {
            badge.style.transform = 'scale(1.1)';
        });
        badge.addEventListener('mouseleave', () => {
            badge.style.transform = 'scale(1)';
        });
        badge.addEventListener('click', () => {
            console.clear();
            window.location.reload();
        });

        document.body.appendChild(badge);

        // 5秒后淡出
        setTimeout(() => {
            badge.style.transition = 'opacity 1s';
            badge.style.opacity = '0';
            setTimeout(() => badge.remove(), 1000);
        }, 5000);
    }

})();
