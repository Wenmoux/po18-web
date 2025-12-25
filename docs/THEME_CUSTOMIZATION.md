# 阅读器主题自定义功能说明

## 功能概述

阅读器现在支持完整的自定义背景/配色/字体功能,用户可以:
1. 选择内置的6个主题方案
2. 自定义背景色、正文色、标题色、高亮色
3. 上传或使用URL设置背景图片
4. 配置背景图片的重复、大小、位置等样式
5. 选择7种预设字体

## 已实现功能

### 1. 预设主题方案 (6个)

- **默认白**: 纯白背景,适合日间阅读
- **护眼黄**: 米黄色背景,减少眼睛疲劳
- **夜间黑**: 深色背景,适合夜间阅读
- **护眼绿**: 淡绿色背景,保护视力
- **少女粉**: 粉色背景,温馨柔和
- **清新蓝**: 淡蓝色背景,清爽宁静

### 2. 自定义颜色

用户可以使用颜色选择器自定义:
- 背景颜色
- 正文颜色
- 标题颜色
- 高亮颜色

### 3. 背景图片设置

支持两种方式设置背景:
- 输入图片URL
- 上传本地图片文件

可配置背景图片样式:
- **重复方式**: 不重复/平铺/水平平铺/垂直平铺
- **大小**: 覆盖/包含/自动
- **位置**: 居中/顶部/底部/左侧/右侧

### 4. 字体选择 (7种)

- 系统默认
- 宋体
- 思源宋体
- 楷体
- 黑体
- 仿宋
- 明体

## 实现细节

### JavaScript 代码 (reader.js)

#### 数据结构

```javascript
// 预设主题
this.presetThemes = {
    default: { name: "默认白", backgroundColor: "#FFFFFF", ... },
    sepia: { name: "护眼黄", backgroundColor: "#F5E6D3", ... },
    // ... 其他主题
}

// 预设字体
this.presetFonts = {
    system: { name: "系统默认", value: "system-ui, ..." },
    serif: { name: "宋体", value: "'Noto Serif SC', ..." },
    // ... 其他字体
}

// 用户自定义设置
this.settings.customTheme = {
    backgroundColor: "#F5E6D3",
    textColor: "#333333",
    titleColor: "#484034",
    highlightColor: "#8F7042",
    backgroundImage: "",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
    backgroundPosition: "center"
}
```

#### 主要方法

- `applyPresetTheme(themeKey)`: 应用预设主题
- `updateCustomColor(colorType, color)`: 更新自定义颜色
- `updateBackgroundImage(imageUrl)`: 更新背景图片
- `updateBackgroundStyle(property, value)`: 更新背景样式
- `applyFont(fontKey)`: 应用字体
- `applySettings()`: 应用所有设置到DOM

### CSS 样式 (reader.css)

#### CSS变量

```css
:root {
    --reader-bg-color: #FFFFFF;
    --reader-text-color: #333333;
    --reader-title-color: #1a1a1a;
    --reader-highlight-color: #D81B60;
    --reader-font-family: var(--font-family);
}
```

#### 应用样式

```css
.chapter-content {
    color: var(--reader-text-color);
    background-color: var(--reader-bg-color);
    font-family: var(--reader-font-family);
}

.chapter-title {
    color: var(--reader-title-color);
}
```

### HTML UI组件

主题设置面板包含在 `theme-settings-panel.html` 中,需要集成到阅读器的设置面板。

主要元素ID:
- `data-preset-theme`: 预设主题按钮
- `bg-color-picker`: 背景色选择器
- `text-color-picker`: 文字色选择器
- `title-color-picker`: 标题色选择器
- `highlight-color-picker`: 高亮色选择器
- `bg-image-url`: 背景图片URL输入
- `bg-image-input`: 背景图片文件上传
- `bg-repeat`: 背景重复方式
- `bg-size`: 背景大小
- `bg-position`: 背景位置
- `data-preset-font`: 字体选择按钮

## 使用方法

### 集成到现有阅读器

1. **确保reader.js已更新**: 包含所有主题管理功能的代码
2. **更新reader.css**: 包含CSS变量定义和样式应用
3. **添加HTML组件**: 将 `theme-settings-panel.html` 的内容插入到设置面板中

### 在实际阅读器HTML中添加

找到设置面板的 `settings-content` 部分,在适当位置插入主题设置HTML:

```html
<aside class="settings-panel" id="settings-panel">
    <div class="settings-header">
        <h3>阅读设置</h3>
        <button class="close-btn" id="btn-close-settings">×</button>
    </div>
    <div class="settings-content">
        <!-- 现有的字体大小、行间距等设置 -->
        
        <!-- 插入主题配色设置 -->
        <!-- 从 theme-settings-panel.html 复制内容到这里 -->
        
        <!-- 其他设置 -->
    </div>
</aside>
```

## 扩展性设计

### 添加新主题

在 `reader.js` 的 `presetThemes` 对象中添加新主题:

```javascript
this.presetThemes = {
    // ... 现有主题
    newTheme: {
        name: "新主题",
        backgroundColor: "#颜色值",
        textColor: "#颜色值",
        titleColor: "#颜色值",
        highlightColor: "#颜色值"
    }
}
```

然后在HTML中添加对应的按钮:

```html
<button class="theme-btn" data-preset-theme="newTheme" style="background: #颜色值; color: #文字色">
    <span>新主题</span>
</button>
```

### 添加新字体

在 `presetFonts` 对象中添加:

```javascript
this.presetFonts = {
    // ... 现有字体
    newFont: { 
        name: "新字体名称", 
        value: "'FontFamily', fallback, ..." 
    }
}
```

在HTML中添加按钮:

```html
<button class="option-btn" data-preset-font="newFont">新字体名称</button>
```

## 数据持久化

所有设置自动保存到 `localStorage`,键名为 `readerSettings`。包括:
- 当前选择的主题
- 自定义颜色配置
- 背景图片及样式
- 选择的字体

## 兼容性说明

- 颜色选择器需要现代浏览器支持 `<input type="color">`
- 文件上传使用 FileReader API,支持将图片转为Base64保存
- CSS变量需要现代浏览器支持
- 建议在Chrome、Firefox、Safari、Edge等现代浏览器中使用

## 注意事项

1. 背景图片使用Base64编码时,localStorage有大小限制(通常5-10MB)
2. 建议使用外部图片URL而非本地上传大图片
3. 字体需要用户系统已安装,否则回退到备用字体
4. 主题切换会实时生效,无需刷新页面
