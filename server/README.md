# server/

⚠️ 一旦所属文件夹有所变化，请更新此文档

## 架构说明

服务端核心模块目录，基于Express框架构建RESTful API，支持PO18和POPO双平台。负责处理所有业务逻辑、数据持久化、网站爬取、元信息同步、书评系统、WebDAV同步、用户认证等核心功能。

## 文件列表

- **app.js**: 应用入口文件，初始化Express服务器、配置中间件、启动监控和订阅检查服务
- **config.js**: 全局配置文件，包含服务器、Session、PO18/POPO、数据库、下载、共享等所有配置项
- **routes.js**: API路由模块，定义所有RESTful API端点，包括元信息同步、书评、章节上传等新功能
- **database.js**: 数据库模块，封装SQLite操作，管理用户、书库、队列、订阅、元信息、章节、书评等所有数据表
- **crawler.js**: 爬虫模块，负责抓取PO18/POPO小说信息、章节内容，生成TXT/HTML/EPUB格式文件
- **webdav.js**: WebDAV客户端模块，实现个人书库的WebDAV同步功能
- **logger.js**: 日志系统，记录用户操作、管理员操作、系统错误等日志，支持文件持久化
- **monitor.js**: 监控模块，提供性能监控、订阅更新检查、系统健康度监测功能
- **analytics.js**: 用户分析模块，统计用户活跃度、下载量、阅读时长等行为数据
- **backup.js**: 数据库备份模块，定期备份用户数据，支持自动清理旧备份

## 主要数据表

- **users**: 用户表
- **book_metadata**: 书籍元信息表（含人气、收藏、评论、订购数等统计字段）
- **chapters**: 章节内容表
- **reviews**: 书评表
- **subscriptions**: 订阅表
- **download_queue**: 下载队列表
