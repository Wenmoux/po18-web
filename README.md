# 不争春 - PO18/POPO小说下载网站

一个功能完整的PO18/POPO小说下载和管理平台，支持多站点、搜索、下载、书库管理、共享功能和书评系统。

## 📝 文档更新规范

**⚠️ 重要！任何功能、架构、写法更新必须在工作结束后更新相关文档！⚠️**

### 强制性规范

1. **每次更新代码时**，必须同步更新：
   - 文件的头部注释（Input/Output/Pos）
   - 所属文件夹的README.md
   - 根目录README.md（如有架构变化）

2. **每个文件夹**必须包含README.md，说明：
   - 极简架构说明（3行以内）
   - 每个文件的名称、地位、功能
   - 更新提醒："一旦所属文件夹有所变化，请更新此文档"

3. **每个文件**开头必须包含标准注释（见下方规范）

### 文件头注释规范

每个文件的开头必须包含以下注释：

**JavaScript/CSS文件：**
```javascript
/*
 * File: 文件名.js
 * Input: 依赖的外部输入（模块、API、数据等）
 * Output: 对外提供的功能/接口/样式
 * Pos: 在系统中的位置和职责
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属文件夹的README.md
 */
```

**HTML文件：**
```html
<!--
  File: 文件名.html
  Input: 依赖的外部资源（JS、CSS、API）
  Output: 提供的页面功能
  Pos: 在系统中的位置和职责
  Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属文件夹的README.md
-->
```

### 目录文档规范

每个文件夹必须包含`README.md`，格式如下：

```markdown
# 目录名

⚠️ 一旦所属文件夹有所变化，请更新此文档

## 架构说明
极简说明（3行以内，描述该目录的核心职责和在系统中的作用）

## 文件列表

- **文件名.js**: 地位/功能描述
- **文件名2.js**: 地位/功能描述
```

## 🌟 特性

- **多站点支持**: 同时支持PO18和POPO两个平台，自动识别站点
- **小说搜索**: 支持关键词、ID、标签等多种方式搜索小说
- **多格式下载**: 支持TXT、HTML、EPUB多种格式下载
- **书库管理**: 个人书库管理，支持WebDAV同步
- **共享功能**: 用户可共享自己下载的书籍给其他用户
- **书评系统**: 支持发表书评、评分、热门排序、点赞互动
- **元信息同步**: 支持书籍元信息和章节内容的批量上传同步
- **阅读器**: 内置Web阅读器，支持多种阅读模式
  - **主题自定义**: 内置6个精美主题（默认白、护眼黄、夜间黑、护眼绿、少女粉、清新蓝）
  - **颜色自定义**: 支持自定义背景、文字、标题、高亮颜色
  - **背景图片**: 支持上传图片或URL，可配置重复、大小、位置
  - **字体选择**: 7种预设字体（系统、宋体、思源宋、楷体、黑体、仿宋、明体）
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

### PO18/POPO集成
- Cookie管理
- 小说信息抓取
- 章节内容下载
- 多站点自动识别

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

### 书评系统
- 发表书评和评分
- 热门/最新/评分排序
- 点赞和回复互动
- 书评审核管理

### 元信息同步
- 书籍元数据批量上传
- 章节内容同步
- 人气/收藏/评论/订购数统计
- 支持增量更新

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

### 书评相关
- `GET /api/reviews` - 获取书评列表（支持latest/hot/rating排序）
- `POST /api/reviews` - 发表书评
- `GET /api/reviews/:bookId` - 获取指定书籍的书评
- `POST /api/reviews/:id/like` - 点赞书评
- `DELETE /api/reviews/:id` - 删除书评

### 元信息同步
- `POST /api/metadata/batch` - 批量上传书籍元信息
- `GET /api/metadata/:bookId` - 获取书籍元信息
- `POST /api/chapters` - 上传章节内容
- `GET /api/chapters/:bookId` - 获取书籍章节列表
- `DELETE /api/chapters/:bookId` - 删除书籍章节缓存

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