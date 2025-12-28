/*
 * File: error-handler.js
 * Input: Express request/response, custom-errors.js, logger.js
 * Output: Express错误处理中间件，统一处理所有错误并返回标准化响应
 * Pos: 错误处理层，在路由处理之后捕获和处理所有错误
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

/**
 * 统一错误处理中间件
 */

const { logger } = require("./logger");
const { AppError } = require("./custom-errors");
const config = require("./config");

/**
 * 错误处理中间件
 * 必须在所有路由之后使用
 */
function errorHandler(err, req, res, next) {
    // 如果是自定义错误类
    if (err instanceof AppError) {
        const statusCode = err.statusCode || 500;
        const response = {
            error: err.message,
            code: err.code || "INTERNAL_ERROR"
        };

        // 添加额外信息
        if (err.errors) {
            response.errors = err.errors; // 验证错误详情
        }
        if (err.retryAfter) {
            response.retryAfter = err.retryAfter; // 限流重试时间
        }
        if (err.resource) {
            response.resource = err.resource; // 资源类型
        }

        // 记录日志
        if (err.isOperational) {
            // 可预期的业务错误，使用warn级别
            logger.warn("业务错误", {
                code: err.code,
                message: err.message,
                url: req.url,
                method: req.method,
                userId: req.session?.userId,
                ip: req.ip
            });
        } else {
            // 不可预期的系统错误，使用error级别
            logger.error("系统错误", {
                code: err.code,
                message: err.message,
                stack: err.stack,
                url: req.url,
                method: req.method,
                userId: req.session?.userId,
                ip: req.ip,
                originalError: err.originalError
            });
        }

        return res.status(statusCode).json(response);
    }

    // 处理Express验证错误（如express-validator）
    if (err.name === "ValidationError" || err.name === "ValidatorError") {
        logger.warn("验证错误", {
            message: err.message,
            url: req.url,
            method: req.method,
            userId: req.session?.userId,
            ip: req.ip
        });

        return res.status(400).json({
            error: err.message || "请求参数验证失败",
            code: "VALIDATION_ERROR"
        });
    }

    // 处理Multer文件上传错误
    if (err.name === "MulterError") {
        let message = "文件上传失败";
        let statusCode = 400;

        if (err.code === "LIMIT_FILE_SIZE") {
            message = `文件大小超过限制（最大${err.limit / 1024 / 1024}MB）`;
        } else if (err.code === "LIMIT_FILE_COUNT") {
            message = `文件数量超过限制（最大${err.limit}个）`;
        } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
            message = "不支持的文件字段";
        }

        logger.warn("文件上传错误", {
            code: err.code,
            message,
            url: req.url,
            method: req.method,
            userId: req.session?.userId,
            ip: req.ip
        });

        return res.status(statusCode).json({
            error: message,
            code: "FILE_UPLOAD_ERROR"
        });
    }

    // 处理数据库错误（better-sqlite3）
    if (err.code === "SQLITE_CONSTRAINT" || err.code === "SQLITE_ERROR") {
        logger.error("数据库错误", {
            code: err.code,
            message: err.message,
            url: req.url,
            method: req.method,
            userId: req.session?.userId,
            ip: req.ip,
            stack: err.stack
        });

        return res.status(500).json({
            error: "数据库操作失败",
            code: "DATABASE_ERROR"
        });
    }

    // 处理JSON解析错误
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
        logger.warn("JSON解析错误", {
            message: err.message,
            url: req.url,
            method: req.method,
            ip: req.ip
        });

        return res.status(400).json({
            error: "请求体格式错误，请检查JSON格式",
            code: "INVALID_JSON"
        });
    }

    // 处理其他未知错误
    logger.error("未处理的错误", {
        name: err.name,
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        userId: req.session?.userId,
        ip: req.ip,
        body: req.body,
        query: req.query
    });

    // 根据环境返回不同的错误信息
    const isDevelopment = process.env.NODE_ENV === "development";
    
    res.status(err.status || 500).json({
        error: isDevelopment ? err.message : "服务器内部错误",
        code: "INTERNAL_ERROR",
        ...(isDevelopment && { stack: err.stack })
    });
}

/**
 * 404处理中间件（在路由之后使用）
 */
function notFoundHandler(req, res, next) {
    logger.warn("路由未找到", {
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    res.status(404).json({
        error: "接口不存在",
        code: "NOT_FOUND",
        path: req.url
    });
}

/**
 * 异步错误包装器
 * 用于包装异步路由处理函数，自动捕获Promise错误
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler
};

