# public/

⚠️ 一旦所属文件夹有所变化，请更新此文档

## 架构说明

前端静态资源根目录，包含所有HTML页面、JavaScript脚本、CSS样式、多语言配置、图标资源等。采用Material Design 3设计风格，支持响应式布局和PWA功能。

## 文件列表

- **index.html**: 主页面，整合搜索、排行榜、已购书籍、书架、下载队列、书库等所有功能模块
- **reader.html**: 阅读器页面，提供在线阅读功能，支持多种阅读模式和夜间模式
- **bookshelf.html**: 书架页面，展示用户的书籍收藏和阅读进度
- **book-detail.html**: 书籍详情页，显示小说详细信息、章节列表和下载选项
- **admin.html**: 管理后台页面，提供用户管理、系统统计、爬虫控制等管理功能
- **rankings.html**: 排行榜页面，展示各类小说排行榜
- **service-worker.js**: PWA Service Worker，实现离线缓存和资源预加载
- **manifest.json**: PWA配置文件，定义应用图标、名称、启动页等信息

## 子目录

- **css/**: 样式文件目录
- **js/**: JavaScript脚本目录
- **i18n/**: 多语言配置目录
- **icons/**: 图标资源目录
- **img/**: 图片资源目录
- **docs/**: 前端文档目录
