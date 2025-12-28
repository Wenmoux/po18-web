# 测试文档

## 📋 测试结构

```
tests/
├── setup.js                 # Jest全局设置
├── __tests__/              # 测试文件目录
│   ├── server/            # 服务器端测试
│   └── public/            # 前端测试（可选）
└── __mocks__/             # Mock文件目录
```

## 🧪 运行测试

### 运行所有测试
```bash
npm test
```

### 监听模式（开发时使用）
```bash
npm run test:watch
```

### 生成覆盖率报告
```bash
npm run test:coverage
```

### 只运行服务器端测试
```bash
npm run test:server
```

## 📝 编写测试

### 测试文件命名

- 测试文件应该放在 `__tests__` 目录下
- 或者使用 `.test.js` 或 `.spec.js` 后缀
- 例如：`rate-limiter.test.js` 或 `rate-limiter.spec.js`

### 测试结构

```javascript
describe('模块名称', () => {
    beforeEach(() => {
        // 每个测试前执行
    });

    afterEach(() => {
        // 每个测试后执行
    });

    describe('功能分组', () => {
        test('应该做什么', () => {
            // 测试代码
            expect(actual).toBe(expected);
        });
    });
});
```

## ✅ 测试覆盖

当前测试覆盖的模块：

- ✅ `server/rate-limiter.js` - 限流中间件
- ✅ `server/custom-errors.js` - 自定义错误类
- ✅ `server/error-handler.js` - 错误处理中间件

## 📊 测试最佳实践

1. **独立性**: 每个测试应该独立运行，不依赖其他测试
2. **可重复性**: 测试结果应该一致，可重复
3. **清晰性**: 测试名称应该清晰描述测试内容
4. **覆盖性**: 测试应该覆盖正常流程、边界情况和错误情况
5. **Mock**: 使用Mock隔离外部依赖

## 🔧 Mock使用

### Mock模块

```javascript
jest.mock('../module-name', () => ({
    functionName: jest.fn()
}));
```

### Mock函数

```javascript
const mockFunction = jest.fn();
mockFunction.mockReturnValue('value');
mockFunction.mockResolvedValue('async value');
```

## 📈 覆盖率目标

- **语句覆盖率**: > 80%
- **分支覆盖率**: > 75%
- **函数覆盖率**: > 80%
- **行覆盖率**: > 80%

## 🚀 持续集成

测试应该在以下情况自动运行：

1. 提交代码前（pre-commit hook）
2. 推送代码到仓库
3. 创建Pull Request

