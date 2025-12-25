# public/css/

⚠️ 一旦所属文件夹有所变化，请更新此文档

## 架构说明

前端样式文件目录，采用Material Design 3设计规范，支持主题切换和响应式布局。主样式文件定义全局样式，功能样式文件对应具体页面，增强样式文件提供移动端和组件优化。

## 文件列表

- **style.css**: 主样式文件，定义全局变量、基础布局、通用组件、主题系统等核心样式
- **reader.css**: 阅读器样式，定义阅读器界面、阅读设置、章节列表等阅读相关样式，**新增主题自定义CSS变量**（--reader-bg-color, --reader-text-color, --reader-title-color, --reader-highlight-color, --reader-font-family）
- **bookshelf.css**: 书架样式，定义书架布局、书籍卡片、筛选器等书架相关样式
- **book-detail.css**: 书籍详情样式，定义详情页布局、章节列表、操作按钮等样式
- **components.css**: 通用组件样式，定义Modal、Toast、Card等可复用组件样式
- **mobile-enhancements.css**: 移动端增强样式，优化移动设备的触摸交互和布局适配
- **responsive-styles.css**: 响应式样式，定义不同屏幕尺寸下的布局调整规则
