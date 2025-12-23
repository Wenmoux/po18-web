/**
 * WebDAV客户端封装
 */

const fs = require("fs");
const path = require("path");

let webdavModule = null;

// 动态导入webdav模块
async function loadWebDAV() {
    if (!webdavModule) {
        webdavModule = await import("webdav");
    }
    return webdavModule;
}

class WebDAVClient {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.ready = false;

        if (config && config.url) {
            this.connectPromise = this.connect(config);
        }
    }

    // 连接到WebDAV服务器
    async connect(config) {
        try {
            const webdav = await loadWebDAV();
            this.config = config;
            this.client = webdav.createClient(config.url, {
                username: config.username,
                password: config.password
            });
            this.ready = true;
            return true;
        } catch (error) {
            console.error("WebDAV连接失败:", error.message);
            return false;
        }
    }

    // 确保客户端就绪
    async ensureReady() {
        if (this.connectPromise) {
            await this.connectPromise;
        }
        if (!this.ready || !this.client) {
            throw new Error("WebDAV未配置或连接失败");
        }
    }

    // 测试连接
    async testConnection() {
        await this.ensureReady();

        try {
            // 尝试获取根目录
            await this.client.getDirectoryContents("/");
            return { success: true, message: "连接成功" };
        } catch (error) {
            throw new Error(`连接失败: ${error.message}`);
        }
    }

    // 上传文件
    async uploadFile(localPath, remotePath) {
        await this.ensureReady();

        try {
            const fileContent = fs.readFileSync(localPath);
            await this.client.putFileContents(remotePath, fileContent);
            return { success: true, path: remotePath };
        } catch (error) {
            throw new Error(`上传失败: ${error.message}`);
        }
    }

    // 下载文件
    async downloadFile(remotePath, localPath) {
        await this.ensureReady();

        try {
            // 简单直接获取文件内容
            const content = await this.client.getFileContents(remotePath);

            // 如果提供了localPath，保存到文件
            if (localPath) {
                fs.writeFileSync(localPath, content);
                return { success: true, path: localPath };
            }

            // 否则直接返回内容
            return content;
        } catch (error) {
            console.error("WebDAV下载错误:", remotePath, error.message);
            throw new Error(`下载失败: ${error.message}`);
        }
    }

    // 列出目录内容
    async listDirectory(remotePath = "/") {
        await this.ensureReady();

        try {
            const contents = await this.client.getDirectoryContents(remotePath);
            return contents.map((item) => ({
                name: item.basename,
                path: item.filename,
                type: item.type, // 'file' or 'directory'
                size: item.size,
                lastModified: item.lastmod
            }));
        } catch (error) {
            throw new Error(`列出目录失败: ${error.message}`);
        }
    }

    // 创建目录
    async createDirectory(remotePath) {
        await this.ensureReady();

        try {
            await this.client.createDirectory(remotePath);
            return { success: true, path: remotePath };
        } catch (error) {
            // 目录已存在不算错误
            if (error.message.includes("405")) {
                return { success: true, path: remotePath, existed: true };
            }
            throw new Error(`创建目录失败: ${error.message}`);
        }
    }

    // 删除文件
    async deleteFile(remotePath) {
        await this.ensureReady();

        try {
            await this.client.deleteFile(remotePath);
            return { success: true };
        } catch (error) {
            throw new Error(`删除失败: ${error.message}`);
        }
    }

    // 检查文件/目录是否存在
    async exists(remotePath) {
        await this.ensureReady();

        try {
            await this.client.stat(remotePath);
            return true;
        } catch (error) {
            return false;
        }
    }

    // 获取书库中的所有书籍
    async getLibraryBooks(libraryPath) {
        await this.ensureReady();

        // 如果没有提供路径，使用配置中的路径或默认路径
        if (!libraryPath) {
            libraryPath = this.config.path || "/po18/";
        }

        // 确保路径以/结尾
        if (!libraryPath.endsWith("/")) {
            libraryPath += "/";
        }

        try {
            // 确保目录存在
            const exists = await this.exists(libraryPath);
            if (!exists) {
                console.log(`WebDAV目录不存在，创建: ${libraryPath}`);
                await this.createDirectory(libraryPath);
                return [];
            }

            const contents = await this.listDirectory(libraryPath);

            // 只返回文件（书籍），过滤目录
            const books = contents
                .filter((item) => item.type === "file")
                .filter((item) => {
                    // 只返回txt和epub文件
                    const ext = path.extname(item.name).toLowerCase();
                    return ext === ".txt" || ext === ".epub";
                })
                .map((item) => {
                    // 解析文件名：书名_ID.格式
                    const basename = path.basename(item.name, path.extname(item.name));
                    const parts = basename.split("_");
                    const bookId = parts.pop(); // 最后一部分是ID
                    const title = parts.join("_"); // 其余部分是书名

                    return {
                        id: item.path,
                        bookId: bookId,
                        title: title,
                        filename: item.name,
                        format: path.extname(item.name).substring(1),
                        size: item.size,
                        path: item.path,
                        lastModified: item.lastModified
                    };
                });

            return books;
        } catch (error) {
            throw new Error(`获取书库失败: ${error.message}`);
        }
    }

    // 上传书籍到WebDAV
    async uploadBook(localPath, bookInfo) {
        await this.ensureReady();

        // 使用配置中的路径或默认路径
        let libraryPath = this.config.path || "/po18/";

        // 确保路径以/结尾
        if (!libraryPath.endsWith("/")) {
            libraryPath += "/";
        }

        try {
            // 确保目录存在
            await this.createDirectory(libraryPath);

            // 生成远程文件名：书名_ID.格式
            const ext = path.extname(localPath);
            const filename = `${bookInfo.title}_${bookInfo.bookId}${ext}`;
            const remotePath = `${libraryPath}${filename}`;

            console.log(`上传书籍到WebDAV: ${remotePath}`);

            // 上传文件
            await this.uploadFile(localPath, remotePath);

            return {
                success: true,
                remotePath: remotePath,
                filename: filename
            };
        } catch (error) {
            throw new Error(`上传书籍失败: ${error.message}`);
        }
    }
}

module.exports = WebDAVClient;
