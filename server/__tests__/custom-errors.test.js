/*
 * custom-errors模块单元测试
 */

const {
    AppError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    DatabaseError,
    ExternalServiceError,
    FileError
} = require('../custom-errors');

describe('Custom Errors', () => {
    describe('AppError', () => {
        test('应该创建AppError实例', () => {
            const error = new AppError('Test error', 500, 'TEST_ERROR');
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error.message).toBe('Test error');
            expect(error.statusCode).toBe(500);
            expect(error.code).toBe('TEST_ERROR');
            expect(error.isOperational).toBe(true);
        });

        test('应该使用默认值', () => {
            const error = new AppError('Test error');
            expect(error.statusCode).toBe(500);
            expect(error.code).toBe('INTERNAL_ERROR');
            expect(error.isOperational).toBe(true);
        });

        test('应该有stack trace', () => {
            const error = new AppError('Test error');
            expect(error.stack).toBeDefined();
        });
    });

    describe('ValidationError', () => {
        test('应该创建ValidationError', () => {
            const error = new ValidationError('Invalid input');
            expect(error).toBeInstanceOf(ValidationError);
            expect(error).toBeInstanceOf(AppError);
            expect(error.statusCode).toBe(400);
            expect(error.code).toBe('VALIDATION_ERROR');
        });

        test('应该包含错误详情', () => {
            const errors = [
                { field: 'username', message: '用户名不能为空' }
            ];
            const error = new ValidationError('Validation failed', errors);
            expect(error.errors).toEqual(errors);
        });
    });

    describe('UnauthorizedError', () => {
        test('应该创建UnauthorizedError', () => {
            const error = new UnauthorizedError('Not authorized');
            expect(error).toBeInstanceOf(UnauthorizedError);
            expect(error.statusCode).toBe(401);
            expect(error.code).toBe('UNAUTHORIZED');
        });

        test('应该使用默认消息', () => {
            const error = new UnauthorizedError();
            expect(error.message).toBe('未授权访问');
        });
    });

    describe('ForbiddenError', () => {
        test('应该创建ForbiddenError', () => {
            const error = new ForbiddenError('Access denied');
            expect(error).toBeInstanceOf(ForbiddenError);
            expect(error.statusCode).toBe(403);
            expect(error.code).toBe('FORBIDDEN');
        });
    });

    describe('NotFoundError', () => {
        test('应该创建NotFoundError', () => {
            const error = new NotFoundError('Resource not found', 'user');
            expect(error).toBeInstanceOf(NotFoundError);
            expect(error.statusCode).toBe(404);
            expect(error.code).toBe('NOT_FOUND');
            expect(error.resource).toBe('user');
        });
    });

    describe('ConflictError', () => {
        test('应该创建ConflictError', () => {
            const error = new ConflictError('Resource conflict');
            expect(error).toBeInstanceOf(ConflictError);
            expect(error.statusCode).toBe(409);
            expect(error.code).toBe('CONFLICT');
        });
    });

    describe('RateLimitError', () => {
        test('应该创建RateLimitError', () => {
            const error = new RateLimitError('Too many requests', 60);
            expect(error).toBeInstanceOf(RateLimitError);
            expect(error.statusCode).toBe(429);
            expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
            expect(error.retryAfter).toBe(60);
        });
    });

    describe('DatabaseError', () => {
        test('应该创建DatabaseError', () => {
            const originalError = new Error('DB connection failed');
            const error = new DatabaseError('Database error', originalError);
            expect(error).toBeInstanceOf(DatabaseError);
            expect(error.statusCode).toBe(500);
            expect(error.code).toBe('DATABASE_ERROR');
            expect(error.originalError).toBe(originalError);
            expect(error.isOperational).toBe(false);
        });
    });

    describe('ExternalServiceError', () => {
        test('应该创建ExternalServiceError', () => {
            const originalError = new Error('API failed');
            const error = new ExternalServiceError('Service error', 'api', originalError);
            expect(error).toBeInstanceOf(ExternalServiceError);
            expect(error.statusCode).toBe(502);
            expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
            expect(error.service).toBe('api');
            expect(error.originalError).toBe(originalError);
        });
    });

    describe('FileError', () => {
        test('应该创建FileError', () => {
            const originalError = new Error('File write failed');
            const error = new FileError('File error', 'write', originalError);
            expect(error).toBeInstanceOf(FileError);
            expect(error.statusCode).toBe(500);
            expect(error.code).toBe('FILE_ERROR');
            expect(error.operation).toBe('write');
            expect(error.originalError).toBe(originalError);
        });
    });

    describe('错误继承', () => {
        test('所有错误都应该继承自AppError', () => {
            const errors = [
                new ValidationError(),
                new UnauthorizedError(),
                new ForbiddenError(),
                new NotFoundError(),
                new ConflictError(),
                new RateLimitError(),
                new DatabaseError(),
                new ExternalServiceError(),
                new FileError()
            ];

            errors.forEach(error => {
                expect(error).toBeInstanceOf(AppError);
                expect(error).toBeInstanceOf(Error);
            });
        });
    });
});

