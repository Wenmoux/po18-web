/**
 * PO18小说下载网站 - 主服务器入口
 */

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const apiRoutes = require('./routes');
const { SharedDB } = require('./database');

const app = express();

// 清理共享书库中的旧数据（文件不存在的记录）
console.log('正在清理共享书库旧数据...');
const deletedCount = SharedDB.cleanupMissingFiles();
if (deletedCount > 0) {
    console.log(`已清理 ${deletedCount} 条无效共享书籍记录`);
} else {
    console.log('共享书库数据正常，无需清理');
}

// 确保必要的目录存在
const dirs = [
    config.download.tempDir,
    config.download.downloadDir,
    path.dirname(config.database.path)
];

dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// 中间件
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session配置
app.use(session(config.session));

// 请求日志中间件
app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
        console.log(`[API] ${req.method} ${req.url}`);
    }
    next();
});

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// API路由
app.use('/api', apiRoutes);

// 前端路由 - SPA支持
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
const { port, host } = config.server;

app.listen(port, host, () => {
    console.log(`
╔════════════════════════════════════════════════╗
║                                                ║
║      PO18小说下载网站 v1.0.0                    ║
║                                                ║
║      服务器已启动: http://${host}:${port}          ║
║                                                ║
╚════════════════════════════════════════════════╝
    `);
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('正在关闭服务器...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('正在关闭服务器...');
    process.exit(0);
});
