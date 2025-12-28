/*
 * File: custom-errors.js
 * Input: 无外部依赖
 * Output: 自定义错误类，提供统一的错误类型定义
 * Pos: 错误处理基础模块，为业务逻辑层提供标准化的错误类型
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

/**
 * 自定义错误类
 * 提供统一的错误类型，便于错误处理和日志记录
 */

/**
 * 基础应用错误类
 */
class AppError extends Error {
    constructor(message, statusCode = 500, code = "INTERNAL_ERROR", isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = isOperational; // 是否为可预期的业务错误

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * 请求验证错误（400）
 */
class ValidationError extends AppError {
    constructor(message = "请求参数验证失败", errors = []) {
        super(message, 400, "VALIDATION_ERROR", true);
        this.errors = errors; // 详细的验证错误列表
    }
}

/**
 * 未授权错误（401）
 */
class UnauthorizedError extends AppError {
    constructor(message = "未授权访问") {
        super(message, 401, "UNAUTHORIZED", true);
    }
}

/**
 * 权限不足错误（403）
 */
class ForbiddenError extends AppError {
    constructor(message = "权限不足") {
        super(message, 403, "FORBIDDEN", true);
    }
}

/**
 * 资源不存在错误（404）
 */
class NotFoundError extends AppError {
    constructor(message = "资源不存在", resource = "resource") {
        super(message, 404, "NOT_FOUND", true);
        this.resource = resource;
    }
}

/**
 * 资源冲突错误（409）
 */
class ConflictError extends AppError {
    constructor(message = "资源冲突") {
        super(message, 409, "CONFLICT", true);
    }
}

/**
 * 请求过于频繁错误（429）
 */
class RateLimitError extends AppError {
    constructor(message = "请求过于频繁", retryAfter = null) {
        super(message, 429, "RATE_LIMIT_EXCEEDED", true);
        this.retryAfter = retryAfter; // 重试时间（秒）
    }
}

/**
 * 数据库错误
 */
class DatabaseError extends AppError {
    constructor(message = "数据库操作失败", originalError = null) {
        super(message, 500, "DATABASE_ERROR", false);
        this.originalError = originalError;
    }
}

/**
 * 外部服务错误（如爬虫、WebDAV等）
 */
class ExternalServiceError extends AppError {
    constructor(message = "外部服务调用失败", service = "external", originalError = null) {
        super(message, 502, "EXTERNAL_SERVICE_ERROR", false);
        this.service = service;
        this.originalError = originalError;
    }
}

/**
 * 文件操作错误
 */
class FileError extends AppError {
    constructor(message = "文件操作失败", operation = "operation", originalError = null) {
        super(message, 500, "FILE_ERROR", false);
        this.operation = operation;
        this.originalError = originalError;
    }
}

module.exports = {
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
};

