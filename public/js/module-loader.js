/*
 * File: module-loader.js
 * Input: 无外部依赖，使用原生DOM API
 * Output: ModuleLoader类，提供按需加载JS模块的功能，支持预加载和缓存
 * Pos: 代码分割核心模块，在app.js之前加载，负责按路由动态加载其他模块
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和public/js/文件夹的README.md
 */

(function(window) {
    'use strict';

    /**
     * 模块加载器 - 实现代码分割和按需加载
     */
    class ModuleLoader {
        constructor() {
            this.loadedModules = new Set();
            this.loadingModules = new Map();
            this.version = '20251224b'; // 版本号用于缓存控制
            
            // 定义路由对应的模块映射
            this.routeModules = {
                'download': ['generator'], // 首页只需要 generator
                'rankings': ['rankings'],
                'bookshelf': ['bookshelf'],
                'library': ['bookshelf'], // 书库复用bookshelf模块
                'downloads': ['generator'], // 下载管理复用generator
                'subscriptions': [],
                'settings': [],
                'global-library': []
            };

            // 核心模块（首屏必需）
            this.coreModules = [
                'performance-optimizer',
                'utils',
                'api',
                'app'
            ];

            // 增强模块（可延迟加载）
            this.enhancementModules = [
                'mobile-enhancements',
                'app-enhancements',
                'final-enhancements',
                'mobile'
            ];
        }

        /**
         * 加载单个模块
         * @param {string} moduleName - 模块名称（不含.js后缀）
         * @returns {Promise} - 加载完成的Promise
         */
        loadModule(moduleName) {
            // 如果已加载，直接返回
            if (this.loadedModules.has(moduleName)) {
                return Promise.resolve();
            }

            // 如果正在加载，返回现有的Promise
            if (this.loadingModules.has(moduleName)) {
                return this.loadingModules.get(moduleName);
            }

            // 创建加载Promise
            const loadPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = `js/${moduleName}.js?v=${this.version}`;
                script.async = true;

                script.onload = () => {
                    this.loadedModules.add(moduleName);
                    this.loadingModules.delete(moduleName);
                    console.log(`[ModuleLoader] ✓ 模块已加载: ${moduleName}`);
                    resolve();
                };

                script.onerror = () => {
                    this.loadingModules.delete(moduleName);
                    console.error(`[ModuleLoader] ✗ 模块加载失败: ${moduleName}`);
                    reject(new Error(`Failed to load module: ${moduleName}`));
                };

                document.body.appendChild(script);
            });

            this.loadingModules.set(moduleName, loadPromise);
            return loadPromise;
        }

        /**
         * 批量加载模块
         * @param {string[]} modules - 模块名称数组
         * @returns {Promise} - 所有模块加载完成的Promise
         */
        loadModules(modules) {
            const promises = modules.map(module => this.loadModule(module));
            return Promise.all(promises);
        }

        /**
         * 加载核心模块（首屏必需）
         * @returns {Promise}
         */
        loadCoreModules() {
            console.log('[ModuleLoader] 开始加载核心模块...');
            return this.loadModules(this.coreModules);
        }

        /**
         * 加载增强模块（延迟加载）
         * @returns {Promise}
         */
        loadEnhancementModules() {
            console.log('[ModuleLoader] 开始加载增强模块...');
            return this.loadModules(this.enhancementModules);
        }

        /**
         * 根据路由加载对应模块
         * @param {string} route - 路由名称
         * @returns {Promise}
         */
        loadRouteModules(route) {
            const modules = this.routeModules[route] || [];
            if (modules.length === 0) {
                return Promise.resolve();
            }

            console.log(`[ModuleLoader] 加载路由模块: ${route} -> [${modules.join(', ')}]`);
            return this.loadModules(modules);
        }

        /**
         * 预加载路由模块（在空闲时加载）
         * @param {string} route - 路由名称
         */
        preloadRouteModules(route) {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => {
                    this.loadRouteModules(route).catch(err => {
                        console.warn('[ModuleLoader] 预加载失败:', err);
                    });
                });
            } else {
                // 降级方案：延迟加载
                setTimeout(() => {
                    this.loadRouteModules(route).catch(err => {
                        console.warn('[ModuleLoader] 预加载失败:', err);
                    });
                }, 1000);
            }
        }

        /**
         * 初始化模块加载器
         * @returns {Promise}
         */
        async init() {
            console.log('[ModuleLoader] 🚀 初始化模块加载器');
            
            // 1. 先加载核心模块
            await this.loadCoreModules();
            console.log('[ModuleLoader] ✓ 核心模块加载完成');

            // 2. 延迟加载增强模块
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => {
                    this.loadEnhancementModules().then(() => {
                        console.log('[ModuleLoader] ✓ 增强模块加载完成');
                    });
                }, { timeout: 2000 });
            } else {
                setTimeout(() => {
                    this.loadEnhancementModules().then(() => {
                        console.log('[ModuleLoader] ✓ 增强模块加载完成');
                    });
                }, 2000);
            }

            // 3. 预加载常用路由模块
            this.preloadRouteModules('rankings');
            this.preloadRouteModules('bookshelf');

            console.log('[ModuleLoader] ✓ 初始化完成');
        }

        /**
         * 获取已加载模块列表
         * @returns {string[]}
         */
        getLoadedModules() {
            return Array.from(this.loadedModules);
        }

        /**
         * 获取加载统计
         * @returns {object}
         */
        getStats() {
            return {
                loaded: this.loadedModules.size,
                loading: this.loadingModules.size,
                total: this.coreModules.length + 
                       this.enhancementModules.length + 
                       Object.values(this.routeModules).flat().filter((v, i, a) => a.indexOf(v) === i).length
            };
        }
    }

    // 创建全局实例
    window.ModuleLoader = new ModuleLoader();

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.ModuleLoader.init().catch(err => {
                console.error('[ModuleLoader] 初始化失败:', err);
            });
        });
    } else {
        window.ModuleLoader.init().catch(err => {
            console.error('[ModuleLoader] 初始化失败:', err);
        });
    }

})(window);
