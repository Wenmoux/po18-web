/*
 * File: app.js
 * Input: Express, session, config.js, routes.js, database.js, logger.js, monitor.js
 * Output: Express应用实例，启动HTTP服务器，提供静态文件服务和API路由
 * Pos: 服务端应用入口，负责初始化Express服务器、配置中间件、启动监控和订阅检查
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

/**
 * PO18小说下载网站 - 主服务器入口
 */

const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const config = require("./config");
const apiRoutes = require("./routes");
const { SharedDB } = require("./database");
const { logger } = require("./logger");
const { performanceMonitor, subscriptionChecker } = require("./monitor");

const app = express();

// 清理共享书库中的旧数据（文件不存在的记录）
console.log("正在清理共享书库旧数据...");
const deletedCount = SharedDB.cleanupMissingFiles();
if (deletedCount > 0) {
    console.log(`已清理 ${deletedCount} 条无效共享书籍记录`);
} else {
    console.log("共享书库数据正常，无需清理");
}

// 确保必要的目录存在
const dirs = [config.download.tempDir, config.download.downloadDir, path.dirname(config.database.path)];

dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// 中间件
app.use(
    cors({
        origin: ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost", "http://127.0.0.1"],
        credentials: true
    })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session配置
app.use(session(config.session));

// 请求日志中间件
app.use(logger.logRequest.bind(logger));
// 静态文件服务
app.use(express.static(path.join(__dirname, "../public"), {
    // 添加缓存控制以避免缓存问题
    maxAge: '1d',
    etag: false,
    lastModified: false,
    setHeaders: function (res, path, stat) {
        // 对于HTML文件，设置不缓存
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else {
            // 对于其他静态资源，添加版本戳以避免缓存问题
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 1天
        }
    }
}));

// API路由
app.use("/api", apiRoutes);

// 前端路由 - SPA支持（只处理非API请求）
app.get("*", (req, res, next) => {
    // 如果是API请求，跳过这个路由
    if (req.url.startsWith("/api")) {
        return next();
    }
    
    // 特殊处理：如果是.js文件请求，直接交给静态文件中间件处理
    if (req.url.endsWith(".js") || req.url.endsWith(".css") || req.url.endsWith(".png") || req.url.endsWith(".jpg") || req.url.endsWith(".jpeg") || req.url.endsWith(".gif") || req.url.endsWith(".svg") || req.url.endsWith(".ico") || req.url.endsWith(".woff") || req.url.endsWith(".woff2") || req.url.endsWith(".ttf") || req.url.endsWith(".eot")) {
        return next();
    }
    
    // 移除查询参数，只保留路径部分
    const urlPath = req.url.split('?')[0];
    
    // 检查请求的文件是否存在
    const filePath = path.join(__dirname, "../public", urlPath);
    
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            // 文件不存在，返回index.html（SPA支持）
            res.sendFile(path.join(__dirname, "../public/index.html"));
        } else {
            // 文件存在，让静态文件中间件处理
            next();
        }
    });
});

// 错误处理中间件
app.use((err, req, res, next) => {
    logger.error("服务器错误", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "服务器内部错误" });
});

// 启动服务器
const { port, host } = config.server;

app.listen(port, host, () => {
    logger.info("服务器启动", { host, port });
    
    // 启动性能监控
    performanceMonitor.startMonitoring();
    
    // 启动订阅更新检查（延迟10秒启动，等待服务器完全启动）
    setTimeout(() => {
        subscriptionChecker.startChecking();
    }, 10000);
    
    console.log(`
╭────────────────────────────────────────────────╮
│                                                │
│      PO18小说下载网站 v1.0.0                    │
│                                                │
│      服务器已启动: http://${host}:${port}          │
│      订阅检查: 已启动 (每30分钟)                │
│                                                │
╰────────────────────────────────────────────────╯
    `);
});

// 优雅关闭
process.on("SIGTERM", () => {
    logger.info("正在关闭服务器...");
    console.log("正在关闭服务器...");
    
    // 停止性能监控
    performanceMonitor.stopMonitoring();
    
    // 停止订阅检查
    subscriptionChecker.stopChecking();
    
    process.exit(0);
});

process.on("SIGINT", () => {
    logger.info("正在关闭服务器...");
    console.log("正在关闭服务器...");
    
    // 停止性能监控
    performanceMonitor.stopMonitoring();
    
    // 停止订阅检查
    subscriptionChecker.stopChecking();
    
    process.exit(0);
});