/*
 * Jest测试环境设置文件
 * 在每个测试文件运行前执行
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test';

// 全局测试工具和模拟
global.console = {
    ...console,
    // 在测试中禁用某些console输出（可选）
    // log: jest.fn(),
    // debug: jest.fn(),
    // info: jest.fn(),
    // warn: jest.fn(),
    error: jest.fn()
};

// 清理模块缓存（在需要时使用）
// beforeEach(() => {
//     jest.clearAllMocks();
//     jest.resetModules();
// });

