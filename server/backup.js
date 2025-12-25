/*
 * File: backup.js
 * Input: database.js, logger.js, config.js, 本地文件系统
 * Output: DatabaseBackup类，提供数据库备份、恢复、自动清理旧备份等功能
 * Pos: 数据库备份模块，定期备份用户数据，支持全量和增量备份，防止数据丢失
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和所属server/文件夹的README.md
 */

/**
 * PO18小说下载网站 - 数据库备份与恢复模块
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { db } = require('./database');
const { logger } = require('./logger');
const config = require('./config');

const execAsync = promisify(exec);

class DatabaseBackup {
    constructor(options = {}) {
        this.backupDir = options.backupDir || './backups';
        this.dbPath = options.dbPath || config.database.path;
        this.maxBackups = options.maxBackups || 10;
        
        // 确保备份目录存在
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }
    
    /**
     * 创建数据库备份
     * @param {string} type 备份类型: 'full'(全量) | 'incremental'(增量)
     * @param {object} options 备份选项
     * @returns {Promise<object>} 备份结果
     */
    async createBackup(type = 'full', options = {}) {
        const startTime = Date.now();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `po18_backup_${timestamp}_${type}.db`;
        const backupPath = path.join(this.backupDir, backupFileName);
        
        try {
            logger.info(`开始创建数据库备份: ${type}`, { backupPath, options });
            
            if (type === 'full') {
                // 全量备份 - 直接复制数据库文件
                await this._createFullBackup(backupPath);
            } else if (type === 'incremental') {
                // 增量备份 - 导出自上次备份以来更改的数据
                await this._createIncrementalBackup(backupPath, options.since);
            } else {
                throw new Error(`不支持的备份类型: ${type}`);
            }
            
            // 获取备份文件信息
            const stats = fs.statSync(backupPath);
            const endTime = Date.now();
            
            const result = {
                success: true,
                type,
                filePath: backupPath,
                fileName: backupFileName,
                fileSize: stats.size,
                duration: endTime - startTime,
                timestamp: new Date().toISOString()
            };
            
            logger.info(`数据库备份创建成功`, result);
            
            // 清理旧备份
            await this._cleanupOldBackups();
            
            return result;
        } catch (error) {
            logger.error(`数据库备份失败`, { error: error.message, type, backupPath });
            throw error;
        }
    }
    
    /**
     * 创建全量备份
     * @param {string} backupPath 备份文件路径
     */
    async _createFullBackup(backupPath) {
        // 方法1: 直接复制数据库文件
        // 注意: 这种方法要求数据库没有被锁定
        try {
            fs.copyFileSync(this.dbPath, backupPath);
            logger.info(`全量备份创建成功 (文件复制)`, { backupPath });
            return;
        } catch (copyError) {
            logger.warn(`文件复制备份失败，尝试SQL导出`, { error: copyError.message });
        }
        
        // 方法2: 使用SQL导出
        const backupDb = new (require('better-sqlite3'))(backupPath);
        try {
            // 启用外键支持
            backupDb.exec('PRAGMA foreign_keys = ON;');
            
            // 获取源数据库的所有表
            const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
            
            // 开始事务
            backupDb.exec('BEGIN TRANSACTION;');
            
            // 复制表结构
            for (const table of tables) {
                backupDb.exec(table.sql);
            }
            
            // 复制数据
            for (const table of tables) {
                // 跳过sqlite_sequence表
                if (table.name === 'sqlite_sequence') continue;
                
                // 获取所有数据
                const rows = db.prepare(`SELECT * FROM ${table.name}`).all();
                
                // 插入数据
                if (rows.length > 0) {
                    const columns = Object.keys(rows[0]);
                    const placeholders = columns.map(() => '?').join(', ');
                    const insertStmt = backupDb.prepare(`INSERT INTO ${table.name} (${columns.join(', ')}) VALUES (${placeholders})`);
                    
                    const insertMany = backupDb.transaction((rows) => {
                        for (const row of rows) {
                            insertStmt.run(...columns.map(col => row[col]));
                        }
                    });
                    
                    insertMany(rows);
                }
            }
            
            // 提交事务
            backupDb.exec('COMMIT;');
            backupDb.close();
            
            logger.info(`全量备份创建成功 (SQL导出)`, { backupPath });
        } catch (sqlError) {
            backupDb.close();
            throw sqlError;
        }
    }
    
    /**
     * 创建增量备份
     * @param {string} backupPath 备份文件路径
     * @param {string} since 时间戳，只备份此时间之后更改的数据
     */
    async _createIncrementalBackup(backupPath, since) {
        // 对于SQLite数据库，真正的增量备份比较复杂
        // 这里简化实现，基于时间戳的逻辑备份
        
        const backupDb = new (require('better-sqlite3'))(backupPath);
        try {
            // 启用外键支持
            backupDb.exec('PRAGMA foreign_keys = ON;');
            
            // 获取源数据库的所有表
            const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
            
            // 开始事务
            backupDb.exec('BEGIN TRANSACTION;');
            
            // 复制表结构
            for (const table of tables) {
                backupDb.exec(table.sql);
            }
            
            // 复制数据（基于时间戳）
            const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000); // 默认24小时前
            
            for (const table of tables) {
                // 跳过sqlite_sequence表
                if (table.name === 'sqlite_sequence') continue;
                
                // 检查表是否有时间戳字段
                const tableInfo = db.prepare(`PRAGMA table_info(${table.name})`).all();
                const timestampColumns = tableInfo.filter(col => 
                    col.name.includes('created_at') || 
                    col.name.includes('updated_at') || 
                    col.name.includes('cached_at') ||
                    col.name.includes('downloaded_at') ||
                    col.name.includes('shared_at')
                ).map(col => col.name);
                
                let rows = [];
                if (timestampColumns.length > 0) {
                    // 如果有时间戳字段，只备份更新过的数据
                    const conditions = timestampColumns.map(col => `${col} >= ?`).join(' OR ');
                    const query = `SELECT * FROM ${table.name} WHERE ${conditions}`;
                    const params = timestampColumns.map(() => sinceDate.toISOString());
                    rows = db.prepare(query).all(...params);
                } else {
                    // 如果没有时间戳字段，备份所有数据
                    rows = db.prepare(`SELECT * FROM ${table.name}`).all();
                }
                
                // 插入数据
                if (rows.length > 0) {
                    const columns = Object.keys(rows[0]);
                    const placeholders = columns.map(() => '?').join(', ');
                    const insertStmt = backupDb.prepare(`INSERT OR REPLACE INTO ${table.name} (${columns.join(', ')}) VALUES (${placeholders})`);
                    
                    const insertMany = backupDb.transaction((rows) => {
                        for (const row of rows) {
                            insertStmt.run(...columns.map(col => row[col]));
                        }
                    });
                    
                    insertMany(rows);
                }
            }
            
            // 提交事务
            backupDb.exec('COMMIT;');
            backupDb.close();
            
            logger.info(`增量备份创建成功`, { backupPath, since });
        } catch (error) {
            backupDb.close();
            throw error;
        }
    }
    
    /**
     * 恢复数据库
     * @param {string} backupPath 备份文件路径
     * @param {object} options 恢复选项
     * @returns {Promise<object>} 恢复结果
     */
    async restoreBackup(backupPath, options = {}) {
        const startTime = Date.now();
        
        try {
            logger.info(`开始恢复数据库备份`, { backupPath, options });
            
            // 检查备份文件是否存在
            if (!fs.existsSync(backupPath)) {
                throw new Error(`备份文件不存在: ${backupPath}`);
            }
            
            // 关闭当前数据库连接
            // 注意: 在生产环境中，这需要更仔细的处理
            // db.close();
            
            // 备份当前数据库（以防恢复失败）
            const currentBackupPath = `${this.dbPath}.restore_backup`;
            fs.copyFileSync(this.dbPath, currentBackupPath);
            logger.info(`当前数据库已备份`, { backupPath: currentBackupPath });
            
            try {
                // 替换数据库文件
                fs.copyFileSync(backupPath, this.dbPath);
                logger.info(`数据库恢复成功`, { backupPath });
                
                // 验证恢复后的数据库
                const verifyResult = await this._verifyDatabase();
                
                const endTime = Date.now();
                const result = {
                    success: true,
                    filePath: backupPath,
                    duration: endTime - startTime,
                    verified: verifyResult,
                    timestamp: new Date().toISOString()
                };
                
                logger.info(`数据库恢复完成`, result);
                return result;
            } catch (restoreError) {
                // 恢复失败，回滚到原始数据库
                logger.error(`数据库恢复失败，正在回滚`, { error: restoreError.message });
                fs.copyFileSync(currentBackupPath, this.dbPath);
                throw new Error(`数据库恢复失败并已回滚: ${restoreError.message}`);
            } finally {
                // 清理临时备份文件
                if (fs.existsSync(currentBackupPath)) {
                    fs.unlinkSync(currentBackupPath);
                }
            }
        } catch (error) {
            logger.error(`数据库恢复失败`, { error: error.message, backupPath });
            throw error;
        }
    }
    
    /**
     * 验证数据库完整性
     * @returns {Promise<object>} 验证结果
     */
    async _verifyDatabase() {
        try {
            const verifyDb = new (require('better-sqlite3'))(this.dbPath);
            
            // 运行完整性检查
            const integrityResult = verifyDb.prepare('PRAGMA integrity_check;').get();
            
            // 获取表信息
            const tables = verifyDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            
            // 检查关键表是否存在
            const requiredTables = ['users', 'book_metadata', 'chapter_cache'];
            const missingTables = requiredTables.filter(table => 
                !tables.some(t => t.name === table)
            );
            
            verifyDb.close();
            
            const result = {
                integrity: integrityResult.integrity_check === 'ok',
                tableCount: tables.length,
                missingTables,
                valid: integrityResult.integrity_check === 'ok' && missingTables.length === 0
            };
            
            return result;
        } catch (error) {
            logger.error(`数据库验证失败`, { error: error.message });
            throw error;
        }
    }
    
    /**
     * 清理旧备份
     */
    async _cleanupOldBackups() {
        try {
            const files = fs.readdirSync(this.backupDir)
                .filter(file => file.startsWith('po18_backup_') && file.endsWith('.db'))
                .map(file => ({
                    name: file,
                    path: path.join(this.backupDir, file),
                    stat: fs.statSync(path.join(this.backupDir, file))
                }))
                .sort((a, b) => b.stat.mtime - a.stat.mtime); // 按修改时间倒序排列
            
            // 删除超过最大数量的备份
            if (files.length > this.maxBackups) {
                const filesToDelete = files.slice(this.maxBackups);
                for (const file of filesToDelete) {
                    fs.unlinkSync(file.path);
                    logger.info(`旧备份已删除`, { filePath: file.path });
                }
            }
        } catch (error) {
            logger.warn(`清理旧备份失败`, { error: error.message });
        }
    }
    
    /**
     * 获取备份列表
     * @returns {Promise<Array>} 备份文件列表
     */
    async listBackups() {
        try {
            const files = fs.readdirSync(this.backupDir)
                .filter(file => file.startsWith('po18_backup_') && file.endsWith('.db'))
                .map(file => {
                    const fullPath = path.join(this.backupDir, file);
                    const stat = fs.statSync(fullPath);
                    const parts = file.split('_');
                    const timestamp = parts[2].replace(/-/g, ':');
                    const type = parts[3].replace('.db', '');
                    
                    return {
                        fileName: file,
                        filePath: fullPath,
                        size: stat.size,
                        createdAt: stat.mtime,
                        timestamp,
                        type
                    };
                })
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // 按创建时间倒序排列
            
            return files;
        } catch (error) {
            logger.error(`获取备份列表失败`, { error: error.message });
            throw error;
        }
    }
    
    /**
     * 删除指定备份
     * @param {string} fileName 备份文件名
     * @returns {Promise<object>} 删除结果
     */
    async deleteBackup(fileName) {
        try {
            const filePath = path.join(this.backupDir, fileName);
            
            if (!fs.existsSync(filePath)) {
                throw new Error(`备份文件不存在: ${fileName}`);
            }
            
            fs.unlinkSync(filePath);
            
            const result = {
                success: true,
                fileName,
                deletedAt: new Date().toISOString()
            };
            
            logger.info(`备份文件已删除`, result);
            return result;
        } catch (error) {
            logger.error(`删除备份文件失败`, { error: error.message, fileName });
            throw error;
        }
    }
    
    /**
     * 压缩备份文件
     * @param {string} fileName 备份文件名
     * @returns {Promise<object>} 压缩结果
     */
    async compressBackup(fileName) {
        try {
            const filePath = path.join(this.backupDir, fileName);
            const compressedPath = `${filePath}.gz`;
            
            if (!fs.existsSync(filePath)) {
                throw new Error(`备份文件不存在: ${fileName}`);
            }
            
            // 使用gzip压缩
            const { stdout, stderr } = await execAsync(`gzip -c "${filePath}" > "${compressedPath}"`);
            
            const stats = fs.statSync(compressedPath);
            
            const result = {
                success: true,
                originalFile: fileName,
                compressedFile: `${fileName}.gz`,
                originalSize: fs.statSync(filePath).size,
                compressedSize: stats.size,
                compressionRatio: ((fs.statSync(filePath).size - stats.size) / fs.statSync(filePath).size * 100).toFixed(2)
            };
            
            logger.info(`备份文件压缩成功`, result);
            return result;
        } catch (error) {
            logger.error(`压缩备份文件失败`, { error: error.message, fileName });
            throw error;
        }
    }
}

// 创建全局备份实例
const databaseBackup = new DatabaseBackup();

module.exports = {
    DatabaseBackup,
    databaseBackup
};