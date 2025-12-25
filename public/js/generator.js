/*
 * File: generator.js
 * Input: JSZip库，书籍数据和章节内容
 * Output: FileGenerator对象，提供生成TXT/HTML/EPUB格式文件的功能
 * Pos: 文件生成模块，处理多种格式电子书的生成
 * Note: ⚠️ 一旦此文件被更新，请同步更新文件头注释和public/js/文件夹的README.md
 */

/**
 * 文件生成器 - 用于生成 EPUB 和 TXT 格式的电子书
 */
const FileGenerator = {
    // JSZip 加载状态
    jszipLoaded: false,
    jszipLoading: false,
    jszipLoadPromise: null,

    /**
     * 动态加载 JSZip 库
     * @returns {Promise<void>}
     */
    async loadJSZip() {
        // 如果已经加载，直接返回
        if (this.jszipLoaded && typeof JSZip !== 'undefined') {
            return Promise.resolve();
        }

        // 如果正在加载，返回现有的 Promise
        if (this.jszipLoading && this.jszipLoadPromise) {
            return this.jszipLoadPromise;
        }

        // 开始加载
        this.jszipLoading = true;
        this.jszipLoadPromise = new Promise((resolve, reject) => {
            console.log('📦 开始加载 JSZip 库...');
            const startTime = performance.now();

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js';
            script.async = true;
            
            script.onload = () => {
                const loadTime = (performance.now() - startTime).toFixed(0);
                console.log(`✅ JSZip 库加载完成，耗时 ${loadTime}ms`);
                this.jszipLoaded = true;
                this.jszipLoading = false;
                resolve();
            };
            
            script.onerror = () => {
                console.error('❌ JSZip 库加载失败');
                this.jszipLoading = false;
                reject(new Error('JSZip 加载失败'));
            };
            
            document.head.appendChild(script);
        });

        return this.jszipLoadPromise;
    },

    /**
     * 生成 EPUB 格式电子书
     * @param {Object} detail - 书籍详情
     * @param {Array} chapters - 章节列表
     * @returns {Promise<Blob>} - EPUB 文件的 Blob 对象
     */
    async generateEpub(detail, chapters) {
        console.log("开始生成EPUB，书籍:", detail.title, "章节数:", chapters.length);

        // 确保 JSZip 已加载
        await this.loadJSZip();

        const zip = new JSZip();
        const bookId = "po18-" + detail.book_id + "-" + Date.now();

        // 1. mimetype文件（必须是第一个文件，不压缩）
        zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

        // 2. META-INF/container.xml
        zip.file(
            "META-INF/container.xml",
            `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
        );

        // 3. OEBPS/content.opf
        let manifest = "";
        let spine = "";

        // 添加封面页
        manifest += '    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>\n';
        spine += '    <itemref idref="cover"/>\n';

        // 添加章节
        chapters.forEach((chapter, index) => {
            if (chapter && chapter.text) {
                manifest += `    <item id="chapter${index}" href="chapter${index}.xhtml" media-type="application/xhtml+xml"/>\n`;
                spine += `    <itemref idref="chapter${index}"/>\n`;
            }
        });

        // 添加目录和样式
        manifest += '    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n';
        manifest += '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n';
        manifest += '    <item id="css" href="Styles/main.css" media-type="text/css"/>\n';

        const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${this.escapeXml(detail.title)}</dc:title>
    <dc:creator>${this.escapeXml(detail.author || "未知")}</dc:creator>
    <dc:language>zh-TW</dc:language>
    <dc:publisher>PO18书库</dc:publisher>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
${manifest}  </manifest>
  <spine toc="ncx">
${spine}  </spine>
</package>`;
        zip.file("OEBPS/content.opf", contentOpf);

        // 4. 样式文件
        const mainCss = this.getEpubCSS();
        zip.file("OEBPS/Styles/main.css", mainCss);

        // 5. 封面页
        const tags = detail.tags || "";
        const tagsHtml = tags
            ? (typeof tags === "string" ? tags : String(tags))
                  .split("·")
                  .map((t) => `<span class="tag">${this.escapeXml(t.trim())}</span>`)
                  .join("")
            : "";

        let descParagraphs = "";
        if (detail.description) {
            const descText = detail.description.replace(/<\/?p>/gi, "").replace(/<br\s*\/?>/gi, "\n");
            descParagraphs = descText
                .split(/\n+/)
                .filter((p) => p.trim())
                .map((p) => `  <p class="kt">${this.escapeXml(p.trim())}</p>`)
                .join("\n");
        }

        const coverXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
    <title>内容简介</title>
    <link href="Styles/main.css" type="text/css" rel="stylesheet"/>
</head>
<body>
  <h2 class="introduction-title">内容简介</h2>
  <div class="book-tags">${tagsHtml}</div>
  <p class="kt">书名：${this.escapeXml(detail.title)}</p>
  <p class="kt">作者：${this.escapeXml(detail.author || "未知")}</p>
${descParagraphs}
  <div class="design-box">
    <p class="design-content">本书采用PO18书库生成，仅供个人学习之用。</p>
    <hr class="design-line"/>
  </div>
</body>
</html>`;
        zip.file("OEBPS/cover.xhtml", coverXhtml);

        // 6. 章节文件
        chapters.forEach((chapter, index) => {
            if (chapter && chapter.text) {
                const titleMatch = chapter.title.match(/^(第[\u4e00-\u9fa5\d]+章)\s*(.*)$/);
                let seqNum = "";
                let chapterName = chapter.title;
                if (titleMatch) {
                    seqNum = titleMatch[1];
                    chapterName = titleMatch[2] || "";
                }

                const textContent = chapter.text
                    .replace(/<br\s*\/?>/gi, "\n")
                    .replace(/<\/p>\s*<p>/gi, "\n")
                    .replace(/<\/?p>/gi, "")
                    .replace(/&nbsp;/g, " ");

                const contentHtml = textContent
                    .split(/\n+/)
                    .filter((p) => p.trim())
                    .map((p) => `  <p>${this.escapeXml(p.trim())}</p>`)
                    .join("\n");

                const chapterXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
    <title>${this.escapeXml(chapter.title)}</title>
    <link href="Styles/main.css" type="text/css" rel="stylesheet"/>
</head>
<body>
  <h2 class="chapter-title" title="${this.escapeXml(chapter.title)}">${seqNum ? `<span class="chapter-sequence-number">${this.escapeXml(seqNum)}</span><br/>` : ""}${this.escapeXml(chapterName || chapter.title)}</h2>
${contentHtml}
</body>
</html>`;
                zip.file(`OEBPS/chapter${index}.xhtml`, chapterXhtml);
            }
        });

        // 7. 目录文件 toc.xhtml
        let tocItems = '      <li><a href="cover.xhtml">内容简介</a></li>\n';
        chapters.forEach((chapter, index) => {
            if (chapter && chapter.text) {
                tocItems += `      <li><a href="chapter${index}.xhtml">${this.escapeXml(chapter.title)}</a></li>\n`;
            }
        });

        const tocXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
    <title>目录</title>
    <link href="Styles/main.css" type="text/css" rel="stylesheet"/>
</head>
<body>
  <nav epub:type="toc">
    <h2 class="toc-title">目录</h2>
    <ol>
${tocItems}    </ol>
  </nav>
</body>
</html>`;
        zip.file("OEBPS/toc.xhtml", tocXhtml);

        // 8. NCX文件
        let ncxNavPoints = `    <navPoint id="cover" playOrder="1">
      <navLabel><text>内容简介</text></navLabel>
      <content src="cover.xhtml"/>
    </navPoint>\n`;
        let playOrder = 2;
        chapters.forEach((chapter, index) => {
            if (chapter && chapter.text) {
                ncxNavPoints += `    <navPoint id="chapter${index}" playOrder="${playOrder++}">
      <navLabel><text>${this.escapeXml(chapter.title)}</text></navLabel>
      <content src="chapter${index}.xhtml"/>
    </navPoint>\n`;
            }
        });

        const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookId}"/>
  </head>
  <docTitle><text>${this.escapeXml(detail.title)}</text></docTitle>
  <navMap>
${ncxNavPoints}  </navMap>
</ncx>`;
        zip.file("OEBPS/toc.ncx", ncx);

        // 生成并返回 Blob
        console.log("正在压缩EPUB文件...");
        const blob = await zip.generateAsync({
            type: "blob",
            mimeType: "application/epub+zip"
        });
        console.log("EPUB生成完成，大小:", blob.size);
        return blob;
    },

    /**
     * 生成 TXT 格式电子书
     * @param {Object} detail - 书籍详情
     * @param {Array} chapters - 章节列表
     * @returns {Blob} - TXT 文件的 Blob 对象
     */
    generateTxt(detail, chapters) {
        console.log("开始生成TXT，书籍:", detail.title, "章节数:", chapters.length);

        let content = "";

        // 添加书籍信息
        content += `书名：${detail.title}\n`;
        content += `作者：${detail.author || "未知"}\n`;
        if (detail.tags) {
            content += `标签：${detail.tags}\n`;
        }
        if (detail.description) {
            const desc = detail.description
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/?p>/gi, "")
                .replace(/&nbsp;/g, " ");
            content += `\n简介：\n${desc}\n`;
        }
        content += "\n" + "=".repeat(50) + "\n\n";

        // 添加章节内容
        chapters.forEach((chapter) => {
            if (chapter && chapter.text) {
                content += `${chapter.title}\n\n`;

                const text = chapter.text
                    .replace(/<br\s*\/?>/gi, "\n")
                    .replace(/<\/p>\s*<p>/gi, "\n\n")
                    .replace(/<\/?p>/gi, "")
                    .replace(/&nbsp;/g, " ")
                    .trim();

                content += text + "\n\n";
                content += "-".repeat(50) + "\n\n";
            }
        });

        const blob = new Blob([content], {
            type: "text/plain;charset=utf-8"
        });
        console.log("TXT生成完成，大小:", blob.size);
        return blob;
    },

    /**
     * 下载文件
     * @param {Blob} blob - 文件 Blob 对象
     * @param {String} fileName - 文件名
     */
    download(blob, fileName) {
        console.log("开始下载文件:", fileName);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log("文件下载完成");
        }, 100);
    },

    /**
     * XML 转义
     * @param {String} str - 需要转义的字符串
     * @returns {String} - 转义后的字符串
     */
    escapeXml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    },

    /**
     * 获取 EPUB CSS 样式
     * @returns {String} - CSS 内容
     */
    getEpubCSS() {
        return `/* EPUB主样式表 */
@charset "utf-8";

/* ==================== 基础样式 ==================== */
body {
  margin: 0;
  padding: 0;
  text-align: justify;
  font-family: "Songti SC", "st", "宋体", "SimSun", "STSong", serif;
  color: #333333;
}

p {
  margin-left: 0;
  margin-right: 0;
  line-height: 1.8em;
  text-align: justify;
  text-indent: 2em;
}

div {
  margin: 0;
  padding: 0;
  line-height: 130%;
  text-align: justify;
}

/* ==================== 章节标题 ==================== */
h2.chapter-title {
  margin: 0 12% 2em 12%;
  padding: 0 4px 0 4px;
  line-height: 1.3em;
  text-align: center;
  font-size: 1.2em;
  color: #a80000;
}

span.chapter-sequence-number {
  font-size: x-small;
  color: #676767;
}

/* ==================== 简介标题 ==================== */
h2.introduction-title {
  margin: 2em auto 2em auto;
  text-align: center;
  font-size: 1.2em;
  color: #a80000;
  padding: 0;
}

/* ==================== 特殊段落样式 ==================== */
p.kt {
  font-family: "STKaiti", "KaiTi", serif;
}

/* ==================== 设计信息框 ==================== */
div.design-box {
  margin: 20% 2% auto 2%;
  padding: 0.8em;
  border: 2px solid rgba(246, 246, 246, 0.3);
  border-radius: 7px;
  background-color: rgba(246, 246, 246, 0.3);
}

p.design-content {
  margin-top: 1em;
  font-size: 80%;
  color: #808080;
  text-indent: 0em;
}

hr.design-line {
  border-style: dashed;
  border-width: 1px 0 0;
  border-color: rgba(200, 200, 193, 0.15);
}

/* ==================== 标签样式 ==================== */
.book-tags {
  margin: 1.5em 0;
  padding: 1em 0;
  border-top: 1px solid #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
}

.tag {
  display: inline-block;
  padding: 0.4em 1em;
  background: #FFB3D9;
  color: #ffffff;
  border-radius: 15px;
  font-size: 0.85em;
  text-decoration: none;
  font-weight: 500;
  text-indent: 0;
}

/* ==================== 目录样式 ==================== */
.toc-title {
  text-align: center;
  color: #a80000;
  margin: 2em 0;
}

/* ==================== 通用工具类 ==================== */
.text-center {
  text-align: center;
  text-indent: 0 !important;
}

/* ==================== 夜间模式支持 ==================== */
@media (prefers-color-scheme: dark) {
  body {
    background: #1a1a1a;
    color: #e0e0e0;
  }
  
  h2.introduction-title,
  h2.chapter-title {
    color: #f39c12;
  }
  
  .tag {
    background: #D85A8C;
    color: #e0e0e0;
  }
}`;
    }
};
