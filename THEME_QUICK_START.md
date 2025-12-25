# 🎨 阅读器主题功能 - 快速开始

## 📌 功能一览

### ✨ 6个预设主题
- 🤍 默认白 - 简洁明亮
- 🟡 护眼黄 - 减少疲劳  
- ⚫ 夜间黑 - 夜间阅读
- 🟢 护眼绿 - 保护视力
- 🩷 少女粉 - 温馨柔和
- 🔵 清新蓝 - 宁静优雅

### 🎨 自定义颜色
- 背景色
- 文字色
- 标题色
- 高亮色

### 🖼️ 背景图片
- URL链接
- 本地上传
- 样式配置(重复/大小/位置)

### 🔤 7种字体
系统默认 | 宋体 | 思源宋 | 楷体 | 黑体 | 仿宋 | 明体

---

## 🚀 立即使用

### 步骤1: 集成UI组件

将 `public/theme-settings-panel.html` 的内容复制到阅读器设置面板:

```html
<div class="settings-content">
    <!-- 粘贴主题设置HTML到这里 -->
</div>
```

### 步骤2: 测试功能

1. 打开阅读器页面
2. 点击"设置"按钮
3. 选择一个主题
4. 立即看到效果!

### 步骤3: 个性化定制

- 点击颜色选择器,选择喜欢的颜色
- 上传心仪的背景图片
- 选择最舒适的阅读字体

---

## 💡 使用技巧

### 白天阅读推荐
```
主题: 默认白 或 清新蓝
字体: 黑体 或 思源宋体
```

### 夜间阅读推荐  
```
主题: 夜间黑
字体: 黑体
背景: 纯色(无图片)
```

### 长时间阅读推荐
```
主题: 护眼黄 或 护眼绿
字体: 宋体 或 楷体
```

### 古风小说推荐
```
主题: 护眼黄
字体: 楷体 或 仿宋
背景: 宣纸纹理图片
```

---

## 📝 代码示例

### 直接调用主题功能

```javascript
// 获取阅读器实例
const reader = readerInstance;

// 切换主题
reader.applyPresetTheme('sepia'); // 护眼黄

// 自定义颜色
reader.updateCustomColor('background', '#FFF3E0');
reader.updateCustomColor('text', '#3E2723');

// 设置背景图片
reader.updateBackgroundImage('https://example.com/bg.jpg');

// 配置背景样式
reader.updateBackgroundStyle('size', 'cover');
reader.updateBackgroundStyle('position', 'center');

// 切换字体
reader.applyFont('kai'); // 楷体
```

### 获取当前设置

```javascript
// 从localStorage读取
const settings = JSON.parse(localStorage.getItem('readerSettings'));
console.log(settings.customTheme);
```

### 重置为默认

```javascript
localStorage.removeItem('readerSettings');
location.reload();
```

---

## 📚 完整文档

- **功能说明**: [docs/THEME_CUSTOMIZATION.md](docs/THEME_CUSTOMIZATION.md)
- **集成指南**: [docs/THEME_INTEGRATION_GUIDE.md](docs/THEME_INTEGRATION_GUIDE.md)  
- **实现总结**: [docs/THEME_FEATURE_SUMMARY.md](docs/THEME_FEATURE_SUMMARY.md)

---

## 🎯 添加新主题 (仅需2步!)

### 1. 在reader.js中添加定义

```javascript
this.presetThemes.sunset = {
    name: "日落橙",
    backgroundColor: "#FFF3E0",
    textColor: "#3E2723",
    titleColor: "#BF360C",
    highlightColor: "#FF6F00"
};
```

### 2. 在HTML中添加按钮

```html
<button class="theme-btn" data-preset-theme="sunset" 
        style="background: #FFF3E0; color: #3E2723">
    <span>日落橙</span>
</button>
```

完成! 🎉

---

## ❓ 常见问题

**Q: 主题没有生效?**  
A: 检查浏览器控制台错误,确认reader.js和reader.css已更新

**Q: 背景图片不显示?**  
A: 检查图片URL是否有效,或尝试上传本地图片

**Q: 字体没有变化?**  
A: 确认系统已安装该字体,或选择其他字体

**Q: 如何分享我的主题?**  
A: 复制localStorage中的customTheme对象,分享给他人

---

## 🎨 主题色彩参考

| 主题 | 背景色 | 文字色 | 标题色 | 高亮色 |
|-----|--------|--------|--------|--------|
| 默认白 | #FFFFFF | #333333 | #1a1a1a | #D81B60 |
| 护眼黄 | #F5E6D3 | #333333 | #484034 | #8F7042 |
| 夜间黑 | #1E1E1E | #B8B8B8 | #E0E0E0 | #FF6B9D |
| 护眼绿 | #C7EDCC | #2D4A2B | #1A3A1A | #5B8C5A |
| 少女粉 | #FFE4E1 | #4A3333 | #8B4A4A | #D8849B |
| 清新蓝 | #E6F3FF | #2C4A5E | #1A3A4A | #4A7BA7 |

---

**享受个性化的阅读体验! 📖✨**
