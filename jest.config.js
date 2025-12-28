/*
 * Jest配置文件
 * 用于单元测试和集成测试
 */

module.exports = {
    // 测试环境
    testEnvironment: 'node',
    
    // 根目录
    rootDir: '.',
    
    // 测试文件匹配模式
    testMatch: [
        '**/__tests__/**/*.js',
        '**/?(*.)+(spec|test).js'
    ],
    
    // 覆盖率配置
    collectCoverage: false,
    collectCoverageFrom: [
        'server/**/*.js',
        '!server/**/*.test.js',
        '!server/**/__tests__/**',
        '!**/node_modules/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    
    // 模块路径映射
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1'
    },
    
    // 设置文件（在每个测试文件运行前执行）
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    
    // 忽略的文件
    testPathIgnorePatterns: [
        '/node_modules/',
        '/coverage/',
        '/dist/',
        '/temp/',
        '/downloads/',
        '/backups/'
    ],
    
    // 转换配置（如果需要）
    transform: {},
    
    // 超时设置
    testTimeout: 10000,
    
    // 详细输出
    verbose: true,
    
    // 测试结果通知
    notify: false
};

