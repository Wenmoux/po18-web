/**
 * 阅读笔记和标注模块
 * 提供文本选择、高亮标注、笔记添加和管理功能
 */

class ReadingNotes {
    constructor(reader) {
        this.reader = reader;
        this.bookId = reader.bookId;
        this.currentChapterId = null;
        this.notes = [];
        this.highlights = new Map(); // 存储高亮元素
        this.selectedText = '';
        this.selectionRange = null;
        this.isNoteMode = false;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadChapterNotes();
    }

    // 绑定事件
    bindEvents() {
        // 监听文本选择
        document.addEventListener('mouseup', (e) => this.handleTextSelection(e));
        document.addEventListener('touchend', (e) => this.handleTextSelection(e));
        
        // 监听章节切换
        if (this.reader && this.reader.on) {
            this.reader.on('chapterChanged', (chapterId) => {
                this.currentChapterId = chapterId;
                this.loadChapterNotes();
            });
        }
    }

    // 处理文本选择
    handleTextSelection(e) {
        // 如果不在阅读内容区域，忽略
        const contentEl = document.getElementById('chapter-content');
        if (!contentEl || !contentEl.contains(e.target)) {
            return;
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            this.hideNoteToolbar();
            return;
        }

        const selectedText = selection.toString().trim();
        if (!selectedText || selectedText.length < 2) {
            this.hideNoteToolbar();
            return;
        }

        this.selectedText = selectedText;
        this.selectionRange = selection.getRangeAt(0).cloneRange();
        
        // 显示笔记工具栏
        this.showNoteToolbar(e);
    }

    // 显示笔记工具栏
    showNoteToolbar(e) {
        // 移除旧的工具栏
        this.hideNoteToolbar();

        const toolbar = document.createElement('div');
        toolbar.id = 'note-toolbar';
        toolbar.className = 'note-toolbar';
        toolbar.innerHTML = `
            <button class="note-btn highlight-btn" data-action="highlight" title="高亮">
                <span>🖍️</span>
            </button>
            <button class="note-btn note-btn" data-action="note" title="添加笔记">
                <span>📝</span>
            </button>
            <button class="note-btn cancel-btn" data-action="cancel" title="取消">
                <span>✕</span>
            </button>
        `;

        // 定位工具栏
        const rect = this.selectionRange.getBoundingClientRect();
        toolbar.style.position = 'fixed';
        toolbar.style.left = `${rect.left + rect.width / 2 - 60}px`;
        toolbar.style.top = `${rect.top - 50}px`;
        toolbar.style.zIndex = '10000';

        document.body.appendChild(toolbar);

        // 绑定按钮事件
        toolbar.querySelector('[data-action="highlight"]').addEventListener('click', () => {
            this.addHighlight();
        });
        toolbar.querySelector('[data-action="note"]').addEventListener('click', () => {
            this.showNoteDialog();
        });
        toolbar.querySelector('[data-action="cancel"]').addEventListener('click', () => {
            this.hideNoteToolbar();
            window.getSelection().removeAllRanges();
        });

        // 点击外部关闭
        setTimeout(() => {
            document.addEventListener('click', (e) => {
                if (!toolbar.contains(e.target)) {
                    this.hideNoteToolbar();
                }
            }, { once: true });
        }, 100);
    }

    // 隐藏笔记工具栏
    hideNoteToolbar() {
        const toolbar = document.getElementById('note-toolbar');
        if (toolbar) {
            toolbar.remove();
        }
    }

    // 添加高亮
    async addHighlight(color = '#FFEB3B') {
        if (!this.selectedText || !this.selectionRange) return;

        try {
            const chapter = this.reader.chapters[this.reader.currentChapterIndex];
            if (!chapter) return;

            const response = await fetch('/api/reading-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapter.chapterId || chapter.id,
                    chapterTitle: chapter.title,
                    selectedText: this.selectedText,
                    noteText: '',
                    highlightColor: color,
                    positionStart: this.getTextPosition(this.selectionRange.startContainer, this.selectionRange.startOffset),
                    positionEnd: this.getTextPosition(this.selectionRange.endContainer, this.selectionRange.endOffset)
                })
            });

            if (response.ok) {
                const result = await response.json();
                this.highlightText(this.selectionRange, color, result.noteId);
                this.hideNoteToolbar();
                window.getSelection().removeAllRanges();
                this.reader.showToast('高亮添加成功', 'success');
                
                // 重新加载笔记
                await this.loadChapterNotes();
            } else {
                const error = await response.json();
                this.reader.showToast(error.error || '添加高亮失败', 'error');
            }
        } catch (error) {
            console.error('添加高亮失败:', error);
            this.reader.showToast('添加高亮失败', 'error');
        }
    }

    // 显示笔记对话框
    showNoteDialog() {
        if (!this.selectedText || !this.selectionRange) return;

        const dialog = document.createElement('div');
        dialog.className = 'note-dialog-overlay';
        dialog.innerHTML = `
            <div class="note-dialog">
                <div class="note-dialog-header">
                    <h3>添加笔记</h3>
                    <button class="note-dialog-close">✕</button>
                </div>
                <div class="note-dialog-body">
                    <div class="note-selected-text">
                        <strong>选中的文本：</strong>
                        <p>${this.escapeHtml(this.selectedText)}</p>
                    </div>
                    <div class="note-input-group">
                        <label>笔记内容：</label>
                        <textarea id="note-text-input" placeholder="输入你的笔记..." rows="4"></textarea>
                    </div>
                    <div class="note-color-group">
                        <label>高亮颜色：</label>
                        <div class="note-color-options">
                            <button class="color-option" data-color="#FFEB3B" style="background: #FFEB3B"></button>
                            <button class="color-option" data-color="#FF9800" style="background: #FF9800"></button>
                            <button class="color-option" data-color="#4CAF50" style="background: #4CAF50"></button>
                            <button class="color-option" data-color="#2196F3" style="background: #2196F3"></button>
                            <button class="color-option" data-color="#9C27B0" style="background: #9C27B0"></button>
                        </div>
                    </div>
                </div>
                <div class="note-dialog-footer">
                    <button class="note-btn-cancel">取消</button>
                    <button class="note-btn-save">保存</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        let selectedColor = '#FFEB3B';

        // 颜色选择
        dialog.querySelectorAll('.color-option').forEach(btn => {
            btn.addEventListener('click', () => {
                dialog.querySelectorAll('.color-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedColor = btn.dataset.color;
            });
        });
        dialog.querySelector('.color-option').classList.add('active');

        // 关闭按钮
        const closeDialog = () => {
            dialog.remove();
            this.hideNoteToolbar();
        };

        dialog.querySelector('.note-dialog-close').addEventListener('click', closeDialog);
        dialog.querySelector('.note-btn-cancel').addEventListener('click', closeDialog);
        dialog.querySelector('.note-dialog-overlay').addEventListener('click', (e) => {
            if (e.target === dialog.querySelector('.note-dialog-overlay')) {
                closeDialog();
            }
        });

        // 保存按钮
        dialog.querySelector('.note-btn-save').addEventListener('click', async () => {
            const noteText = dialog.querySelector('#note-text-input').value.trim();
            await this.saveNote(noteText, selectedColor);
            closeDialog();
        });
    }

    // 保存笔记
    async saveNote(noteText, color) {
        if (!this.selectedText || !this.selectionRange) return;

        try {
            const chapter = this.reader.chapters[this.reader.currentChapterIndex];
            if (!chapter) return;

            const response = await fetch('/api/reading-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    bookId: this.bookId,
                    chapterId: chapter.chapterId || chapter.id,
                    chapterTitle: chapter.title,
                    selectedText: this.selectedText,
                    noteText: noteText,
                    highlightColor: color,
                    positionStart: this.getTextPosition(this.selectionRange.startContainer, this.selectionRange.startOffset),
                    positionEnd: this.getTextPosition(this.selectionRange.endContainer, this.selectionRange.endOffset)
                })
            });

            if (response.ok) {
                const result = await response.json();
                this.highlightText(this.selectionRange, color, result.noteId);
                this.hideNoteToolbar();
                window.getSelection().removeAllRanges();
                this.reader.showToast('笔记添加成功', 'success');
                
                // 重新加载笔记
                await this.loadChapterNotes();
            } else {
                const error = await response.json();
                this.reader.showToast(error.error || '添加笔记失败', 'error');
            }
        } catch (error) {
            console.error('添加笔记失败:', error);
            this.reader.showToast('添加笔记失败', 'error');
        }
    }

    // 高亮文本
    highlightText(range, color, noteId) {
        const span = document.createElement('span');
        span.className = 'reading-highlight';
        span.style.backgroundColor = color;
        span.style.cursor = 'pointer';
        span.dataset.noteId = noteId;
        span.title = '点击查看笔记';

        try {
            range.surroundContents(span);
            this.highlights.set(noteId, span);

            // 点击高亮显示笔记
            span.addEventListener('click', () => {
                this.showNotePopup(noteId);
            });
        } catch (e) {
            // 如果范围跨越多个节点，需要特殊处理
            console.warn('高亮文本失败:', e);
        }
    }

    // 加载章节笔记
    async loadChapterNotes() {
        if (!this.bookId) return;

        try {
            const chapter = this.reader.chapters[this.reader.currentChapterIndex];
            if (!chapter) return;

            const response = await fetch(`/api/reading-notes/chapter/${this.bookId}/${chapter.chapterId || chapter.id}`, {
                credentials: 'include'
            });

            if (response.ok) {
                const result = await response.json();
                this.notes = result.notes || [];
                this.renderHighlights();
            }
        } catch (error) {
            console.error('加载笔记失败:', error);
        }
    }

    // 渲染高亮
    renderHighlights() {
        // 清除旧的高亮
        document.querySelectorAll('.reading-highlight').forEach(el => {
            const parent = el.parentNode;
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
        });
        this.highlights.clear();

        // 渲染新的高亮
        const contentEl = document.getElementById('chapter-content');
        if (!contentEl) return;

        this.notes.forEach(note => {
            // 这里需要根据position_start和position_end来定位文本
            // 简化实现：搜索选中的文本并高亮
            const text = contentEl.textContent || contentEl.innerText;
            const index = text.indexOf(note.selected_text);
            
            if (index !== -1) {
                // 找到文本位置，创建高亮
                const range = document.createRange();
                const walker = document.createTreeWalker(
                    contentEl,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );

                let charCount = 0;
                let startNode = null;
                let startOffset = 0;
                let endNode = null;
                let endOffset = 0;

                while (walker.nextNode()) {
                    const node = walker.currentNode;
                    const nodeLength = node.textContent.length;

                    if (startNode === null && charCount + nodeLength > index) {
                        startNode = node;
                        startOffset = index - charCount;
                    }

                    if (charCount + nodeLength >= index + note.selected_text.length) {
                        endNode = node;
                        endOffset = index + note.selected_text.length - charCount;
                        break;
                    }

                    charCount += nodeLength;
                }

                if (startNode && endNode) {
                    range.setStart(startNode, startOffset);
                    range.setEnd(endNode, endOffset);
                    this.highlightText(range, note.highlight_color, note.id);
                }
            }
        });
    }

    // 显示笔记弹窗
    showNotePopup(noteId) {
        const note = this.notes.find(n => n.id === noteId);
        if (!note) return;

        const popup = document.createElement('div');
        popup.className = 'note-popup';
        popup.innerHTML = `
            <div class="note-popup-header">
                <h4>笔记</h4>
                <button class="note-popup-close">✕</button>
            </div>
            <div class="note-popup-body">
                <div class="note-popup-text">
                    <strong>选中的文本：</strong>
                    <p>${this.escapeHtml(note.selected_text)}</p>
                </div>
                ${note.note_text ? `
                    <div class="note-popup-note">
                        <strong>笔记：</strong>
                        <p>${this.escapeHtml(note.note_text)}</p>
                    </div>
                ` : '<p class="note-popup-empty">暂无笔记内容</p>'}
            </div>
            <div class="note-popup-footer">
                <button class="note-btn-edit" data-note-id="${note.id}">编辑</button>
                <button class="note-btn-delete" data-note-id="${note.id}">删除</button>
            </div>
        `;

        document.body.appendChild(popup);

        popup.querySelector('.note-popup-close').addEventListener('click', () => popup.remove());
        popup.querySelector('.note-popup-overlay')?.addEventListener('click', () => popup.remove());

        popup.querySelector('.note-btn-edit').addEventListener('click', () => {
            this.editNote(note);
            popup.remove();
        });

        popup.querySelector('.note-btn-delete').addEventListener('click', async () => {
            if (confirm('确定要删除这条笔记吗？')) {
                await this.deleteNote(note.id);
                popup.remove();
            }
        });
    }

    // 编辑笔记
    async editNote(note) {
        const dialog = document.createElement('div');
        dialog.className = 'note-dialog-overlay';
        dialog.innerHTML = `
            <div class="note-dialog">
                <div class="note-dialog-header">
                    <h3>编辑笔记</h3>
                    <button class="note-dialog-close">✕</button>
                </div>
                <div class="note-dialog-body">
                    <div class="note-selected-text">
                        <strong>选中的文本：</strong>
                        <p>${this.escapeHtml(note.selected_text)}</p>
                    </div>
                    <div class="note-input-group">
                        <label>笔记内容：</label>
                        <textarea id="note-text-edit" rows="4">${this.escapeHtml(note.note_text || '')}</textarea>
                    </div>
                </div>
                <div class="note-dialog-footer">
                    <button class="note-btn-cancel">取消</button>
                    <button class="note-btn-save">保存</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const closeDialog = () => dialog.remove();
        dialog.querySelector('.note-dialog-close').addEventListener('click', closeDialog);
        dialog.querySelector('.note-btn-cancel').addEventListener('click', closeDialog);
        dialog.querySelector('.note-dialog-overlay')?.addEventListener('click', (e) => {
            if (e.target === dialog.querySelector('.note-dialog-overlay')) {
                closeDialog();
            }
        });

        dialog.querySelector('.note-btn-save').addEventListener('click', async () => {
            const noteText = dialog.querySelector('#note-text-edit').value.trim();
            await this.updateNote(note.id, noteText);
            closeDialog();
        });
    }

    // 更新笔记
    async updateNote(noteId, noteText) {
        try {
            const response = await fetch(`/api/reading-notes/${noteId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ noteText })
            });

            if (response.ok) {
                this.reader.showToast('笔记更新成功', 'success');
                await this.loadChapterNotes();
            } else {
                const error = await response.json();
                this.reader.showToast(error.error || '更新失败', 'error');
            }
        } catch (error) {
            console.error('更新笔记失败:', error);
            this.reader.showToast('更新失败', 'error');
        }
    }

    // 删除笔记
    async deleteNote(noteId) {
        try {
            const response = await fetch(`/api/reading-notes/${noteId}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                this.reader.showToast('笔记删除成功', 'success');
                
                // 移除高亮
                const highlight = this.highlights.get(noteId);
                if (highlight) {
                    const parent = highlight.parentNode;
                    parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
                    parent.normalize();
                    this.highlights.delete(noteId);
                }
                
                await this.loadChapterNotes();
            } else {
                const error = await response.json();
                this.reader.showToast(error.error || '删除失败', 'error');
            }
        } catch (error) {
            console.error('删除笔记失败:', error);
            this.reader.showToast('删除失败', 'error');
        }
    }

    // 获取文本位置（简化实现）
    getTextPosition(node, offset) {
        const contentEl = document.getElementById('chapter-content');
        if (!contentEl) return 0;

        const text = contentEl.textContent || contentEl.innerText;
        const walker = document.createTreeWalker(
            contentEl,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let position = 0;
        while (walker.nextNode()) {
            const currentNode = walker.currentNode;
            if (currentNode === node) {
                return position + offset;
            }
            position += currentNode.textContent.length;
        }

        return position;
    }

    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ReadingNotes;
} else {
    window.ReadingNotes = ReadingNotes;
}

