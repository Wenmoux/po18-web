/*
 * routes模块集成测试
 * 测试主要API端点的基本功能
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');

// Mock数据库和其他依赖
jest.mock('../database', () => ({
    UserDB: {
        findByUsername: jest.fn(),
        findById: jest.fn(),
        create: jest.fn(),
        validateSessionToken: jest.fn(() => true),
        canAccessSharedLibrary: jest.fn(() => false),
        hasCacheAuth: jest.fn(() => false),
        hasLibraryAuth: jest.fn(() => false)
    },
    db: {
        prepare: jest.fn(() => ({
            get: jest.fn(() => ({})),
            run: jest.fn(() => ({ changes: 0, lastInsertRowid: 1 })),
            all: jest.fn(() => [])
        }))
    }
}));

jest.mock('../logger', () => ({
    logger: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        log: jest.fn(),
        logUserAction: jest.fn(),
        logAdminAction: jest.fn(),
        logRequest: jest.fn((req, res, next) => next())
    }
}));

const app = express();
app.use(express.json());
app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
}));
app.use('/api', require('../routes'));

describe('API Routes', () => {
    describe('GET /api/auth/me', () => {
        test('应该返回401如果未登录', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .expect(401);
            
            expect(response.body).toHaveProperty('error');
        });

        test('应该返回用户信息如果已登录', async () => {
            const { UserDB } = require('../database');
            UserDB.findById.mockReturnValue({
                id: 1,
                username: 'testuser',
                po18_cookie: null,
                webdav_config: null,
                share_enabled: 0,
                shared_books_count: 0
            });

            const response = await request(app)
                .get('/api/auth/me')
                .set('Cookie', ['connect.sid=s%3Atest'])
                .expect(200);

            // 注意：这个测试可能需要真实的session，这里只是示例
            // 实际测试中需要设置session
        });
    });

    describe('POST /api/auth/login', () => {
        test('应该返回400如果缺少用户名或密码', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({})
                .expect(400);

            expect(response.body).toHaveProperty('error');
            expect(response.body.code).toBe('VALIDATION_ERROR');
        });

        test('应该返回401如果用户名或密码错误', async () => {
            const { UserDB } = require('../database');
            UserDB.findByUsername.mockReturnValue(null);

            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    username: 'wronguser',
                    password: 'wrongpass'
                })
                .expect(401);

            expect(response.body.code).toBe('UNAUTHORIZED');
        });
    });

    describe('POST /api/auth/register', () => {
        test('应该返回400如果缺少必要参数', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({})
                .expect(400);

            expect(response.body.code).toBe('VALIDATION_ERROR');
            expect(response.body.errors).toBeDefined();
        });

        test('应该返回400如果用户名或密码太短', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    username: 'ab',
                    password: '12345'
                })
                .expect(400);

            expect(response.body.code).toBe('VALIDATION_ERROR');
        });
    });
});

