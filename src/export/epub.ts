/**
 * 手稿导出 EPUB：把多篇文本笔记按章节顺序拼成一本 EPUB 3 电子书。
 * 纯前端用 JSZip 打包（mimetype 须 STORE 不压缩、且为首个文件）。
 */
import JSZip from 'jszip'
import type { FsNode } from '../model/types'
import { noteToHtmlBody, sanitizeName } from './exporters'

interface EpubOptions {
  bookTitle: string
  author: string
  accent: string
  /** 每章所属的卷路径（祖先文件夹名，不含最顶层书名文件夹），与 notes 一一对应；空数组表示无卷 */
  volumePaths?: string[][]
}

function uuid(): string {
  // 浏览器内可用 crypto.randomUUID；兜底用时间戳+随机
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* ignore */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function chapterXhtml(node: FsNode): string {
  const body = noteToHtmlBody(node)
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="utf-8" />
<title>${escapeXml(node.name)}</title>
<link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
${body}
</body>
</html>`
}

/** 卷名页：整页居中显示卷名（如「第一卷」），放在该卷第一章之前 */
function volumeXhtml(title: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="utf-8" />
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body class="volume">
  <h1 class="volume-title">${escapeXml(title)}</h1>
</body>
</html>`
}

/** 扉页：书名 + 作者 + 可见目录（链接到各卷页 / 章页） */
function frontXhtml(
  bookTitle: string,
  author: string,
  toc: { file: string; title: string; sub: boolean }[],
): string {
  const lis = toc
    .map(
      (t) =>
        `<li class="${t.sub ? 'toc-chap' : 'toc-vol'}"><a href="${t.file}">${escapeXml(t.title)}</a></li>`,
    )
    .join('\n    ')
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="utf-8" />
<title>${escapeXml(bookTitle)}</title>
<link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body class="front">
  <h1 class="book-title">${escapeXml(bookTitle)}</h1>
  <p class="book-author">${escapeXml(author || '佚名')}</p>
  <hr class="front-hr" />
  <h2 class="toc-title">目录</h2>
  <ol class="toc">
    ${lis}
  </ol>
</body>
</html>`
}

const STYLE_CSS = `body { font-family: "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "SimSun", serif; line-height: 1.8; color: #1a1a1a; margin: 0 8%; }
h1 { font-size: 1.6em; text-align: center; margin: 1.2em 0 1em; }
h2 { font-size: 1.3em; }
h3 { font-size: 1.12em; }
p { margin: .6em 0; text-indent: 2em; }
blockquote { margin: 1em 2em; color: #555; }
pre { background: #f4f4f4; padding: 10px; border-radius: 6px; overflow-x: auto; }
code { font-family: monospace; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 6px 8px; }
hr { border: none; border-top: 1px solid #ddd; margin: 1.6em 0; }
img { max-width: 100%; }
a { color: #2f6df6; }
/* 扉页：书名 / 作者 / 目录 */
body.front { text-align: center; }
h1.book-title { font-size: 2em; margin-top: 2.2em; }
p.book-author { margin-top: .4em; color: #666; text-indent: 0; }
hr.front-hr { width: 40%; margin: 2.2em auto; }
h2.toc-title { margin-top: 1.2em; }
ol.toc { list-style: none; padding: 0; text-align: left; max-width: 26em; margin: 0 auto; }
ol.toc li { margin: .35em 0; }
ol.toc li.toc-vol { font-weight: bold; margin-top: 1em; }
/* 卷名页 */
body.volume { text-align: center; }
h1.volume-title { margin-top: 42%; font-size: 1.8em; }`

/** 把若干文本笔记按给定顺序拼成一本 EPUB，返回 Blob。
 *  结构：扉页（书名 + 作者 + 目录）→ 各卷卷名页（卷的第一章之前）→ 章节正文 */
export async function notesToEpub(
  notes: FsNode[],
  opts: EpubOptions,
): Promise<Blob> {
  const volumePaths = opts.volumePaths ?? notes.map(() => [])

  // 按「卷路径连续分组」生成页面序列：扉页 + 卷页 + 章页，同时收集可见目录
  interface Page {
    id: string
    file: string
    title: string
    xhtml: string
  }
  const pages: Page[] = []
  const toc: { file: string; title: string; sub: boolean }[] = []
  pages.push({ id: 'front', file: 'front.xhtml', title: opts.bookTitle || '我的手稿', xhtml: '' })

  let volNo = 0
  let chapNo = 0
  let inVolume = false
  const keyOf = (i: number) => (volumePaths[i] ?? []).join('\u0001')
  for (let i = 0; i < notes.length; i++) {
    const vp = volumePaths[i] ?? []
    const isNewVolume = vp.length > 0 && keyOf(i) !== keyOf(i - 1)
    if (vp.length === 0) inVolume = false
    if (isNewVolume) {
      const title = vp.join(' · ')
      const id = `vol-${volNo++}`
      const file = `${id}.xhtml`
      pages.push({ id, file, title, xhtml: volumeXhtml(title) })
      toc.push({ file, title, sub: false })
      inVolume = true
    }
    const title = notes[i].name || `第${chapNo + 1}章`
    const id = `chap-${chapNo++}`
    const file = `${id}.xhtml`
    pages.push({ id, file, title, xhtml: chapterXhtml(notes[i]) })
    toc.push({ file, title, sub: inVolume })
  }

  // 扉页目录依赖全部页面，最后再回填
  pages[0].xhtml = frontXhtml(opts.bookTitle || '我的手稿', opts.author, toc)

  const bookId = uuid()
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${bookId}</dc:identifier>
    <dc:title>${escapeXml(opts.bookTitle)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>${escapeXml(opts.author || '佚名')}</dc:creator>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="style" href="style.css" media-type="text/css" />
    ${pages.map((p) => `<item id="${p.id}" href="${p.file}" media-type="application/xhtml+xml" />`).join('\n    ')}
  </manifest>
  <spine>
    ${pages.map((p) => `<itemref idref="${p.id}" />`).join('\n    ')}
  </spine>
</package>`

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="utf-8" />
<title>目录</title>
</head>
<body>
<nav epub:type="toc" id="toc">
  <h1>目录</h1>
  <ol>
    <li class="toc-vol"><a href="front.xhtml">封面</a></li>
    ${toc.map((t) => `<li class="${t.sub ? 'toc-chap' : 'toc-vol'}"><a href="${t.file}">${escapeXml(t.title)}</a></li>`).join('\n    ')}
  </ol>
</nav>
</body>
</html>`

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`

  const zip = new JSZip()
  // mimetype 必须 STORE（不压缩）且为第一个加入的文件，否则部分阅读器拒读
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', container)
  const oebps = zip.folder('OEBPS')!
  oebps.file('content.opf', opf)
  oebps.file('nav.xhtml', nav)
  oebps.file('style.css', STYLE_CSS)
  for (const p of pages) oebps.file(p.file, p.xhtml)

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  })
}

export { sanitizeName }
