# PO18小说下载网站

一个功能完整的PO18小说下载和管理平台，支持搜索、下载、书库管理和共享功能。

## 📝 文档更新规范

**重要！任何功能、架构、写法更新必须在工作结束后更新相关文档！**

### 文件头注释规范

每个文件的开头必须包含以下三行注释：

```javascript
/*
 * File: 文件名.js
 * Input: 依赖的外部输入（模块、API、数据）
 * Output: 对外提供的功能/接口
 * Pos: 在系统中的位置和职责
 * Note: 一旦此文件被更新，请更新文件头注释，并更新所属文件夹的README.md
 */
```

### 目录文档规范

每个文件夹中必须包含一个`README.md`，格式如下：

```markdown
# 目录名

架构说明（极短3行以内）

## 文件列表

- **文件名.js**: 地位/功能描述
```

## 🌟 特性

- **小说搜索**: 支持关键词、ID、标签等多种方式搜索PO18小说
- **多格式下载**: 支持TXT、HTML、EPUB多种格式下载
- **书库管理**: 个人书库管理，支持WebDAV同步
- **共享功能**: 用户可共享自己下载的书籍给其他用户
- **阅读器**: 内置Web阅读器，支持多种阅读模式
- **排行榜**: 提供各类小说排行榜
- **订阅系统**: 订阅喜爱的小说，及时获取更新提醒
- **移动端适配**: 完美适配移动设备，支持PWA安装

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn

### 安装步骤

1. 克隆项目代码：
```bash
git clone <repository-url>
cd po18-web
```

2. 安装依赖：
```bash
npm install
```

3. 启动服务：
```bash
npm start
```

4. 访问应用：
打开浏览器访问 `http://localhost:3000`

### 开发模式

```bash
# 启动开发服务器（自动重启）
npm run dev

# 代码格式化
npm run format

# 代码检查
npm run lint

# 自动修复代码问题
npm run lint:fix
```

## 📁 项目结构

```
po18-web/
├── public/              # 前端静态资源
│   ├── css/             # 样式文件
│   │   ├── style.css           # 主样式
│   │   ├── reader.css          # 阅读器样式
│   │   ├── bookshelf.css       # 书架样式
│   │   ├── components.css      # 通用组件样式（新增）
│   │   └── mobile-enhancements.css  # 移动端增强（新增）
│   ├── js/              # JavaScript文件
│   │   ├── app.js              # 主应用逻辑
│   │   ├── api.js              # API接口
│   │   ├── utils.js            # 工具函数（新增）
│   │   ├── mobile-enhancements.js  # 移动端交互（新增）
│   │   └── ...
│   ├── icons/           # 图标文件
│   └── *.html           # HTML页面
├── server/              # 后端服务
│   ├── app.js           # 应用入口
│   ├── config.js        # 配置文件
│   ├── routes.js        # 路由定义
│   ├── crawler.js       # 爬虫模块
│   ├── database.js      # 数据库模块
│   └── webdav.js        # WebDAV模块
├── shared/              # 共享书库目录
├── temp/                # 临时文件目录
├── downloads/           # 下载文件目录
├── data/                # 数据库文件目录
├── scripts/             # 脚本工具
├── .eslintrc.json       # ESLint配置（新增）
├── .prettierrc.json     # Prettier配置（新增）
└── package.json         # 项目配置
```

## 🛠️ 技术栈

### 前端
- HTML/CSS/JavaScript
- Material Design 3 风格
- 响应式设计
- PWA支持

### 后端
- Node.js
- Express.js
- SQLite (better-sqlite3)
- WebDAV

### 第三方库
- axios: HTTP请求
- cheerio: HTML解析
- epub-gen: EPUB生成
- archiver: 文件压缩
- jsdom: DOM操作
- webdav: WebDAV客户端

## 🔧 核心功能

### 用户系统
- 用户注册/登录
- Session认证
- 管理员权限

### PO18集成
- Cookie管理
- 小说信息抓取
- 章节内容下载

### 下载管理
- 下载队列
- 进度跟踪
- 格式转换
- 文件生成

### 书库功能
- 个人书库(WebDAV)
- 共享书库
- 全站书库(需权限)
- 书架管理

### 阅读体验
- Web阅读器
- 多种阅读模式
- 夜间模式
- 阅读进度跟踪

## 📡 API接口

主要API接口前缀: `/api`

### 认证相关
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `POST /api/auth/logout` - 用户登出
- `GET /api/auth/me` - 获取当前用户信息

### PO18相关
- `GET /api/po18/cookie` - 获取PO18 Cookie
- `POST /api/po18/cookie` - 设置PO18 Cookie
- `GET /api/po18/validate` - 验证Cookie有效性
- `GET /api/po18/purchased` - 获取已购书籍

### 搜索相关
- `GET /api/search` - 搜索小说

### 下载相关
- `GET /api/queue` - 获取下载队列
- `POST /api/queue` - 添加到下载队列
- `DELETE /api/queue/:id` - 从队列中删除
- `DELETE /api/queue/completed` - 清空已完成队列

### 书库相关
- `GET /api/library` - 获取个人书库
- `GET /api/library/filters` - 获取书库筛选条件
- `DELETE /api/library/:id` - 删除书库中的书籍

### 共享相关
- `POST /api/share/upload` - 上传到共享书库
- `GET /api/share/library` - 获取共享书库
- `GET /api/share/search` - 搜索共享书库
- `GET /api/share/download/:id` - 下载共享书籍

### 排行榜
- `GET /api/rankings/:type` - 获取排行榜

### 全站书库
- `GET /api/global-library` - 获取全站书库
- `GET /api/global-library/tags` - 获取标签列表

### 管理后台
- `GET /api/admin/check` - 检查管理员权限
- `GET /api/admin/stats` - 获取系统统计
- `GET /api/admin/users` - 获取用户列表
- `PUT /api/admin/users/:id` - 更新用户
- `DELETE /api/admin/users/:id` - 删除用户

## ⚙️ 配置说明

配置文件位于 `server/config.js`：

- **服务器配置**: 端口、主机地址
- **Session配置**: 密钥、超时时间
- **PO18配置**: 基础URL、请求头、并发数
- **共享书库配置**: 路径、最大文件大小
- **数据库配置**: 数据库路径
- **下载配置**: 临时目录、下载目录、支持格式

## 🔐 安全说明

- 所有API接口均有权限验证
- Cookie敏感信息不直接暴露给前端
- 文件上传有大小限制
- WebDAV配置信息加密存储

## 📱 移动端特性

- 响应式布局
- 触摸友好的交互设计
- PWA支持，可安装到主屏幕
- 离线阅读支持(部分功能)

## 🤝 贡献

欢迎提交Issue和Pull Request来改进这个项目。

## 📄 许可证

本项目采用MIT许可证，详情请见[LICENSE](LICENSE)文件。