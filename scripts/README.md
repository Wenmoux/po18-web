# scripts

工具脚本和油猴脚本集合，包含数据库维护、测试、油猴增强等脚本。
一旦此文件夹有变化，请立即更新本文档。

## 文件列表

### 油猴脚本

- **superapi.js**: PO18/POPO通用增强油猴脚本，提供元信息遍历、批量上传、章节管理等功能

### HTML参考文件

- **chapter.html**: PO18/POPO章节页面HTML参考，用于调试DOM选择器
- **content.html**: PO18/POPO内容页面HTML参考
- **detail.html**: PO18/POPO详情页面HTML参考
- **findbook.html**: POPO找书看页面HTML参考

### 数据库维护脚本

- **check_all_users_stats.js**: 检查所有用户的统计数据
- **check_chapter_cache_structure.js**: 检查章节缓存结构完整性
- **check_chapter_shares.js**: 检查章节分享记录
- **check_cookie.js**: 检查Cookie有效性
- **check_shared_library.js**: 检查共享书库完整性
- **check_stats.js**: 检查统计数据
- **check_user_4_stats.js**: 检查用户ID=4的统计数据（开发用）
- **check_user_share_stats.js**: 检查用户分享统计
- **clean_cookies.js**: 清理无效Cookie
- **clean_shared.js**: 清理共享书库
- **fix-chapter-order.js**: 修复章节顺序
- **fix-map.js**: 修复映射关系
- **fix_user_4_shares.js**: 修复用户ID=4的分享数据

### 测试脚本

- **test_frontend_api.js**: 测试前端API接口
- **test_user_stats.js**: 测试用户统计功能

### 文档

- **AUTO_SYNC_README.md**: 自动同步文档说明

## 使用说明

### 运行数据库维护脚本

```bash
node scripts/check_all_users_stats.js
node scripts/clean_shared.js
```

### 安装油猴脚本

1. 安装Tampermonkey浏览器扩展
2. 打开`superapi.js`
3. 复制全部内容
4. 在Tampermonkey中创建新脚本并粘贴
5. 保存并启用脚本

### 更新HTML参考文件

当PO18/POPO网站结构更新时，访问对应页面并保存HTML到相应文件，用于调试和更新DOM选择器。
