/**
 * 文件生成器 - 在浏览器端生成 TXT/EPUB 文件
 * 参考油猴脚本 1.js 实现
 */

const FileGenerator = {
    /**
     * 生成 TXT 文件
     * @param {Object} detail - 书籍详情
     * @param {Array} chapters - 章节内容数组
     * @returns {Blob} TXT 文件 Blob
     */
    generateTxt(detail, chapters) {
        let content = '';
        
        // 添加书名和作者
        content += `${detail.title}\n`;
        content += `作者：${detail.author}\n`;
        if (detail.tags && detail.tags.length > 0) {
            content += `标签：${detail.tags.join(', ')}\n`;
        }
        content += `\n`;
        
        // 添加简介
        if (detail.description) {
            content += `简介：\n${detail.description}\n`;
            content += `\n${'='.repeat(50)}\n\n`;
        }
        
        // 添加章节内容
        chapters.forEach((chapter, index) => {
            if (chapter.error) {
                content += `\n第${index + 1}章 ${chapter.title}\n\n`;
                content += `[章节获取失败]\n\n`;
            } else {
                content += `\n第${index + 1}章 ${chapter.title}\n\n`;
                content += `${chapter.text}\n\n`;
            }
        });
        
        return new Blob([content], { type: 'text/plain;charset=utf-8' });
    },
    
    /**
     * 生成 EPUB 文件
     * @param {Object} detail - 书籍详情
     * @param {Array} chapters - 章节内容数组
     * @returns {Promise<Blob>} EPUB 文件 Blob
     */
    async generateEpub(detail, chapters) {
        const zip = new JSZip();
        const bookId = 'po18-' + detail.bookId + '-' + Date.now();
        
        // 1. mimetype 文件（必须是第一个文件，不压缩）
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        
        // 2. META-INF/container.xml
        const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`;
        zip.file('META-INF/container.xml', containerXml);
        
        // 3. OEBPS/content.opf (元数据和清单)
        const contentOpf = this._generateContentOpf(detail, chapters, bookId);
        zip.file('OEBPS/content.opf', contentOpf);
        
        // 4. OEBPS/toc.ncx (导航)
        const tocNcx = this._generateTocNcx(detail, chapters, bookId);
        zip.file('OEBPS/toc.ncx', tocNcx);
        
        // 5. OEBPS/stylesheet.css (样式)
        const css = this._generateStylesheet();
        zip.file('OEBPS/stylesheet.css', css);
        
        // 6. OEBPS/title.xhtml (标题页)
        const titlePage = this._generateTitlePage(detail);
        zip.file('OEBPS/title.xhtml', titlePage);
        
        // 7. OEBPS/chapterXXX.xhtml (章节内容)
        chapters.forEach((chapter, index) => {
            const chapterHtml = this._generateChapterHtml(chapter, index);
            zip.file(`OEBPS/chapter${String(index + 1).padStart(3, '0')}.xhtml`, chapterHtml);
        });
        
        // 8. 封面图片（如果有）
        if (detail.cover && detail.cover.startsWith('http')) {
            try {
                const coverBlob = await this._fetchCoverImage(detail.cover);
                if (coverBlob) {
                    zip.file('OEBPS/cover.jpg', coverBlob);
                }
            } catch (e) {
                console.warn('封面下载失败:', e);
            }
        }
        
        // 生成 EPUB
        return await zip.generateAsync({ 
            type: 'blob', 
            mimeType: 'application/epub+zip',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 }
        });
    },
    
    /**
     * 生成 content.opf
     */
    _generateContentOpf(detail, chapters, bookId) {
        const hasCover = detail.cover && detail.cover.startsWith('http');
        
        return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>${this._escapeXml(detail.title)}</dc:title>
        <dc:creator>${this._escapeXml(detail.author || '未知作者')}</dc:creator>
        <dc:language>zh-CN</dc:language>
        <dc:identifier id="bookid">${bookId}</dc:identifier>
        <dc:publisher>PO18</dc:publisher>
        <dc:date>${new Date().toISOString().split('T')[0]}</dc:date>
        ${detail.description ? `<dc:description>${this._escapeXml(detail.description)}</dc:description>` : ''}
        ${detail.tags && detail.tags.length ? `<dc:subject>${this._escapeXml(detail.tags.join(', '))}</dc:subject>` : ''}
        ${hasCover ? '<meta name="cover" content="cover-image"/>' : ''}
    </metadata>
    <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="stylesheet" href="stylesheet.css" media-type="text/css"/>
        <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
        ${hasCover ? '<item id="cover-image" href="cover.jpg" media-type="image/jpeg"/>' : ''}
        ${chapters.map((_, i) => 
            `<item id="chapter${i + 1}" href="chapter${String(i + 1).padStart(3, '0')}.xhtml" media-type="application/xhtml+xml"/>`
        ).join('\n        ')}
    </manifest>
    <spine toc="ncx">
        <itemref idref="title"/>
        ${chapters.map((_, i) => `<itemref idref="chapter${i + 1}"/>`).join('\n        ')}
    </spine>
    <guide>
        <reference type="text" title="开始阅读" href="title.xhtml"/>
    </guide>
</package>`;
    },
    
    /**
     * 生成 toc.ncx
     */
    _generateTocNcx(detail, chapters, bookId) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="${bookId}"/>
        <meta name="dtb:depth" content="1"/>
        <meta name="dtb:totalPageCount" content="0"/>
        <meta name="dtb:maxPageNumber" content="0"/>
    </head>
    <docTitle>
        <text>${this._escapeXml(detail.title)}</text>
    </docTitle>
    <navMap>
        <navPoint id="title" playOrder="1">
            <navLabel><text>标题页</text></navLabel>
            <content src="title.xhtml"/>
        </navPoint>
        ${chapters.map((chapter, i) => `
        <navPoint id="chapter${i + 1}" playOrder="${i + 2}">
            <navLabel><text>${this._escapeXml(chapter.title || `第${i + 1}章`)}</text></navLabel>
            <content src="chapter${String(i + 1).padStart(3, '0')}.xhtml"/>
        </navPoint>`).join('')}
    </navMap>
</ncx>`;
    },
    
    /**
     * 生成样式表（参考 1.js）
     */
    _generateStylesheet() {
        return `@charset "UTF-8";
body {
    font-family: "Noto Serif SC", "Source Han Serif CN", serif;
    line-height: 1.8;
    margin: 2em;
    text-align: justify;
}
h1 {
    text-align: center;
    font-size: 1.8em;
    margin: 2em 0 1em 0;
    page-break-before: always;
}
h2 {
    text-align: center;
    font-size: 1.5em;
    margin: 1.5em 0 1em 0;
}
p {
    text-indent: 2em;
    margin: 0.5em 0;
}
.title-page {
    text-align: center;
    margin-top: 30%;
}
.title-page h1 {
    font-size: 2.5em;
    margin-bottom: 0.5em;
}
.title-page p {
    font-size: 1.2em;
    text-indent: 0;
}`;
    },
    
    /**
     * 生成标题页
     */
    _generateTitlePage(detail) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>${this._escapeXml(detail.title)}</title>
    <link rel="stylesheet" type="text/css" href="stylesheet.css"/>
</head>
<body>
    <div class="title-page">
        <h1>${this._escapeXml(detail.title)}</h1>
        <p>作者：${this._escapeXml(detail.author || '未知作者')}</p>
        ${detail.tags && detail.tags.length ? `<p>标签：${this._escapeXml(detail.tags.join(', '))}</p>` : ''}
        ${detail.description ? `<div style="margin-top: 3em; text-align: left;"><p style="text-indent: 0; font-weight: bold;">简介：</p>${detail.description}</div>` : ''}
    </div>
</body>
</html>`;
    },
    
    /**
     * 生成章节 HTML
     */
    _generateChapterHtml(chapter, index) {
        const chapterNum = index + 1;
        const title = chapter.title || `第${chapterNum}章`;
        
        let content = '';
        if (chapter.error) {
            content = '<p style="color: #999; text-align: center;">[章节获取失败]</p>';
        } else if (chapter.html) {
            content = chapter.html;
        } else if (chapter.text) {
            // 将纯文本转换为段落
            const paragraphs = chapter.text.split('\n').filter(p => p.trim());
            content = paragraphs.map(p => `<p>${this._escapeXml(p)}</p>`).join('\n');
        }
        
        return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>${this._escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="stylesheet.css"/>
</head>
<body>
    <h1>${this._escapeXml(title)}</h1>
    ${content}
</body>
</html>`;
    },
    
    /**
     * 获取封面图片
     */
    async _fetchCoverImage(url) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return await response.blob();
            }
        } catch (e) {
            console.error('封面下载失败:', e);
        }
        return null;
    },
    
    /**
     * XML 转义
     */
    _escapeXml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    },
    
    /**
     * 触发浏览器下载
     */
    download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    },
    
    /**
     * 格式化文件大小
     */
    formatFileSize(bytes) {
        if (bytes < 1024) {
            return bytes + ' B';
        } else if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(2) + ' KB';
        } else {
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        }
    }
};
