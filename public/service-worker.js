/**
 * 荼蘼辞 - Service Worker
 * 提供离线缓存和PWA支持
 */

const CACHE_NAME = "po18-v2";
const STATIC_CACHE = "po18-static-v3";
const DYNAMIC_CACHE = "po18-dynamic-v3";
const IMAGE_CACHE = "po18-images-v3";
const API_CACHE = "po18-api-v3";

// 缓存版本号 - 更新时递增
const VERSION = '20251223a';

// 静态资源缓存列表 - 添加版本号
const STATIC_ASSETS = [
    "/",
    "/index.html",
    "/reader.html",
    "/book-detail.html",
    "/bookshelf.html",
    `/css/style.css?v=${VERSION}`,
    `/css/bookshelf.css?v=${VERSION}`,
    `/css/components.css?v=${VERSION}`,
    `/css/mobile-enhancements.css?v=${VERSION}`,
    `/js/performance-optimizer.js?v=${VERSION}`,
    `/js/utils.js?v=${VERSION}`,
    `/js/mobile-enhancements.js?v=${VERSION}`,
    `/js/app-enhancements.js?v=${VERSION}`,
    `/js/final-enhancements.js?v=${VERSION}`,
    `/js/app.js?v=${VERSION}`,
    `/js/api.js?v=${VERSION}`,
    `/js/generator.js?v=${VERSION}`,
    `/js/mobile.js?v=${VERSION}`,
    "/manifest.json"
];

// 安装事件 - 缓存静态资源
self.addEventListener("install", (event) => {
    console.log("[SW] Installing...");
    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            .then((cache) => {
                console.log("[SW] Caching static assets");
                // 分批缓存，避免失败
                return Promise.allSettled(
                    STATIC_ASSETS.map(url => 
                        cache.add(url).catch(err => {
                            console.warn(`[SW] Failed to cache ${url}:`, err);
                            return null;
                        })
                    )
                );
            })
            .then(() => {
                console.log("[SW] Install complete");
                return self.skipWaiting();
            })
            .catch((err) => {
                console.error("[SW] Install failed:", err);
            })
    );
});

// 激活事件 - 清理旧缓存
self.addEventListener("activate", (event) => {
    console.log("[SW] Activating...");
    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => 
                            name !== STATIC_CACHE && 
                            name !== DYNAMIC_CACHE && 
                            name !== IMAGE_CACHE &&
                            name !== API_CACHE
                        )
                        .map((name) => {
                            console.log("[SW] Deleting old cache:", name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log("[SW] Activate complete");
                return self.clients.claim();
            })
    );
});

// 请求拦截 - 优化缓存策略
self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 跳过非 GET 请求
    if (request.method !== "GET") {
        return;
    }

    // 跳过非 http/https 请求（如 chrome-extension://）
    if (!url.protocol.startsWith('http')) {
        return;
    }

    // API 请求 - 使用短期缓存
    if (url.pathname.startsWith("/api/")) {
        event.respondWith(apiCacheStrategy(request));
        return;
    }

    // 图片资源 - 使用长期缓存
    if (isImageResource(url.pathname)) {
        event.respondWith(imageCacheStrategy(request));
        return;
    }

    // 跨域资源
    if (!url.origin.includes(self.location.origin)) {
        // JSZip 和其他 CDN 资源 - 长期缓存
        if (url.hostname.includes("unpkg.com") || url.hostname.includes("fonts.googleapis.com")) {
            event.respondWith(cdnCacheStrategy(request));
        }
        return;
    }

    // 静态资源：缓存优先
    if (isStaticAsset(url.pathname)) {
        event.respondWith(cacheFirst(request));
    } else {
        // 其他资源：网络优先
        event.respondWith(networkFirst(request));
    }
});

// 判断是否为静态资源
function isStaticAsset(pathname) {
    const staticExtensions = [".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2"];
    return staticExtensions.some((ext) => pathname.endsWith(ext)) || pathname === "/" || pathname.endsWith(".html");
}

// 判断是否为图片资源
function isImageResource(pathname) {
    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
    return imageExtensions.some(ext => pathname.endsWith(ext));
}

// 缓存优先策略（但检查更新）
async function cacheFirst(request) {
    const url = new URL(request.url);
    
    // HTML文件使用网络优先策略，避免缓存问题
    if (url.pathname.endsWith('.html') || url.pathname === '/') {
        return networkFirst(request);
    }
    
    const cached = await caches.match(request);
    if (cached) {
        // 后台更新缓存
        fetch(request).then(response => {
            if (response.ok) {
                caches.open(STATIC_CACHE).then(cache => {
                    cache.put(request, response);
                });
            }
        }).catch(() => {});
        
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        console.error("[SW] Cache first failed:", err);
        // 返回离线页面
        return caches.match("/index.html");
    }
}

// 网络优先策略
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) {
            return cached;
        }
        // 返回离线页面
        return caches.match("/index.html");
    }
}

// Stale-while-revalidate 策略
async function staleWhileRevalidate(request) {
    const cached = await caches.match(request);

    const fetchPromise = fetch(request)
        .then((response) => {
            if (response.ok) {
                const cache = caches.open(DYNAMIC_CACHE);
                cache.then((c) => c.put(request, response.clone()));
            }
            return response;
        })
        .catch(() => cached);

    return cached || fetchPromise;
}

// API缓存策略 - 短期缓存(2分钟)
async function apiCacheStrategy(request) {
    const cached = await caches.match(request);
    
    // 检查缓存时间（缩短为2分钟）
    if (cached) {
        const cachedTime = cached.headers.get('sw-cached-time');
        if (cachedTime && Date.now() - parseInt(cachedTime) < 2 * 60 * 1000) {
            return cached;
        }
    }

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(API_CACHE);
            // 先克隆用于返回
            const responseToReturn = response.clone();
            
            // 再克隆用于缓存
            const clonedResponse = response.clone();
            
            // 添加缓存时间戳
            const headers = new Headers(clonedResponse.headers);
            headers.set('sw-cached-time', Date.now().toString());
            
            const modifiedResponse = new Response(clonedResponse.body, {
                status: clonedResponse.status,
                statusText: clonedResponse.statusText,
                headers: headers
            });
            
            cache.put(request, modifiedResponse);
            return responseToReturn;
        }
        return response;
    } catch (err) {
        if (cached) {
            return cached;
        }
        throw err;
    }
}

// 图片缓存策略 - 长期缓存
async function imageCacheStrategy(request) {
    // 跳过非 http/https 请求
    const url = new URL(request.url);
    if (!url.protocol.startsWith('http')) {
        return fetch(request);
    }

    const cached = await caches.match(request);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(IMAGE_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        console.error('[SW] Image fetch failed:', err);
        // 返回占位图
        return new Response(
            '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#f0f0f0"/></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
        );
    }
}

// CDN资源缓存策略 - 长期缓存（30天）
async function cdnCacheStrategy(request) {
    const cached = await caches.match(request);
    
    // 检查缓存时间（30天）
    if (cached) {
        const cachedTime = cached.headers.get('sw-cached-time');
        if (cachedTime && Date.now() - parseInt(cachedTime) < 30 * 24 * 60 * 60 * 1000) {
            console.log('[SW] CDN resource from cache:', request.url);
            return cached;
        }
    }

    try {
        console.log('[SW] Fetching CDN resource:', request.url);
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            // 先克隆用于返回
            const responseToReturn = response.clone();
            
            // 再克隆用于缓存
            const clonedResponse = response.clone();
            
            // 添加缓存时间戳
            const headers = new Headers(clonedResponse.headers);
            headers.set('sw-cached-time', Date.now().toString());
            
            const modifiedResponse = new Response(clonedResponse.body, {
                status: clonedResponse.status,
                statusText: clonedResponse.statusText,
                headers: headers
            });
            
            cache.put(request, modifiedResponse);
            console.log('[SW] CDN resource cached:', request.url);
            return responseToReturn;
        }
        return response;
    } catch (err) {
        console.error('[SW] CDN fetch failed:', err);
        if (cached) {
            console.log('[SW] Returning stale CDN cache:', request.url);
            return cached;
        }
        throw err;
    }
}

// 推送通知事件
self.addEventListener("push", (event) => {
    if (!event.data) return;

    const data = event.data.json();
    const options = {
        body: data.body || "有新内容更新",
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-72x72.png",
        vibrate: [100, 50, 100],
        data: {
            url: data.url || "/"
        },
        actions: [
            { action: "open", title: "查看" },
            { action: "close", title: "关闭" }
        ]
    };

    event.waitUntil(self.registration.showNotification(data.title || "荼蘼辞", options));
});

// 通知点击事件
self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    if (event.action === "close") return;

    const url = event.notification.data?.url || "/";

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            // 如果已有窗口打开，则聚焦
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && "focus" in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            // 否则打开新窗口
            return clients.openWindow(url);
        })
    );
});

// 后台同步事件（用于更新订阅）
self.addEventListener("sync", (event) => {
    console.log("[SW] Sync event:", event.tag);

    if (event.tag === "check-book-updates") {
        event.waitUntil(checkBookUpdates());
    }
});

// 检查书籍更新
async function checkBookUpdates() {
    try {
        // 这里可以实现检查订阅书籍更新的逻辑
        console.log("[SW] Checking book updates...");
    } catch (err) {
        console.error("[SW] Check updates failed:", err);
    }
}
