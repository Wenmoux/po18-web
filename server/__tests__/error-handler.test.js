/*
 * error-handler模块单元测试
 */

// Mock logger
jest.mock('../logger', () => ({
    logger: {
        warn: jest.fn(),
        error: jest.fn()
    }
}));

const { errorHandler, notFoundHandler, asyncHandler } = require('../error-handler');
const { ValidationError, NotFoundError, DatabaseError } = require('../custom-errors');

describe('Error Handler', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            url: '/api/test',
            method: 'GET',
            session: { userId: 1 },
            ip: '127.0.0.1'
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('errorHandler', () => {
        test('应该处理AppError', () => {
            const error = new ValidationError('Invalid input');
            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Invalid input',
                code: 'VALIDATION_ERROR'
            });
        });

        test('应该处理带详细信息的ValidationError', () => {
            const errors = [{ field: 'username', message: '不能为空' }];
            const error = new ValidationError('Validation failed', errors);
            errorHandler(error, req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                error: 'Validation failed',
                code: 'VALIDATION_ERROR',
                errors: errors
            });
        });

        test('应该处理NotFoundError with resource', () => {
            const error = new NotFoundError('User not found', 'user');
            errorHandler(error, req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                error: 'User not found',
                code: 'NOT_FOUND',
                resource: 'user'
            });
        });

        test('应该处理RateLimitError with retryAfter', () => {
            const { RateLimitError } = require('../custom-errors');
            const error = new RateLimitError('Too many requests', 60);
            errorHandler(error, req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                error: 'Too many requests',
                code: 'RATE_LIMIT_EXCEEDED',
                retryAfter: 60
            });
        });

        test('应该处理系统错误（isOperational=false）', () => {
            const originalError = new Error('DB connection failed');
            const error = new DatabaseError('Database error', originalError);
            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Database error',
                code: 'DATABASE_ERROR'
            });
        });

        test('应该处理MulterError', () => {
            const error = {
                name: 'MulterError',
                code: 'LIMIT_FILE_SIZE',
                limit: 5 * 1024 * 1024
            };
            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: '文件大小超过限制（最大5MB）',
                code: 'FILE_UPLOAD_ERROR'
            });
        });

        test('应该处理JSON解析错误', () => {
            const error = {
                name: 'SyntaxError',
                status: 400,
                message: 'Unexpected token',
                body: {}
            };
            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: '请求体格式错误，请检查JSON格式',
                code: 'INVALID_JSON'
            });
        });

        test('应该处理数据库错误', () => {
            const error = {
                code: 'SQLITE_CONSTRAINT',
                message: 'UNIQUE constraint failed'
            };
            errorHandler(error, req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: '数据库操作失败',
                code: 'DATABASE_ERROR'
            });
        });

        test('应该在开发环境显示堆栈跟踪', () => {
            process.env.NODE_ENV = 'development';
            const error = new Error('Unknown error');
            errorHandler(error, req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Unknown error',
                    code: 'INTERNAL_ERROR',
                    stack: expect.any(String)
                })
            );
        });

        test('应该在生产环境隐藏堆栈跟踪', () => {
            process.env.NODE_ENV = 'production';
            const error = new Error('Unknown error');
            errorHandler(error, req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                error: '服务器内部错误',
                code: 'INTERNAL_ERROR'
            });
        });
    });

    describe('notFoundHandler', () => {
        test('应该返回404响应', () => {
            notFoundHandler(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({
                error: '接口不存在',
                code: 'NOT_FOUND',
                path: '/api/test'
            });
        });
    });

    describe('asyncHandler', () => {
        test('应该正确处理异步函数', async () => {
            const handler = asyncHandler(async (req, res) => {
                res.json({ success: true });
            });

            await handler(req, res, next);

            expect(res.json).toHaveBeenCalledWith({ success: true });
            expect(next).not.toHaveBeenCalled();
        });

        test('应该捕获Promise错误并传递给next', async () => {
            const error = new Error('Async error');
            const handler = asyncHandler(async (req, res) => {
                throw error;
            });

            await handler(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
            expect(res.json).not.toHaveBeenCalled();
        });

        test('应该处理同步错误', async () => {
            const error = new Error('Sync error');
            const handler = asyncHandler((req, res) => {
                throw error;
            });

            await handler(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });

        test('应该处理返回Promise的函数', async () => {
            const handler = asyncHandler((req, res) => {
                return Promise.resolve().then(() => {
                    res.json({ success: true });
                });
            });

            await handler(req, res, next);

            expect(res.json).toHaveBeenCalledWith({ success: true });
        });
    });
});

