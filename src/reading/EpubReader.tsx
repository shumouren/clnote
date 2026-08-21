import { useEffect, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import type { BookProgress, DiskEntry } from '../model/types'
import { mediaProtocolUrl } from '../storage/media'

/** epub 阅读器：基于 epub.js 渲染，分页 / 翻页 / 进度（CFI）记忆。
 *  关键点：`allowScriptedContent: true`——epub.js 默认给 iframe 设
 *  `sandbox="allow-same-origin"`（缺 allow-scripts），WebView2 严格沙箱会拦截
 *  about:srcdoc 内脚本导致正文空白/无法翻页；该选项让 iframe 补上 allow-scripts。
 *  其余优化：容器无尺寸时等布局稳定再 display；ResizeObserver 监听尺寸变化自动重排；
 *  spread 固定单页避免窄容器双页错位。 */

/** epub 阅读器：基于 epub.js 渲染，分页 / 翻页 / 进度（CFI）记忆。
 *  优化点：
 *  - 分栏 flex 布局下容器首次挂载可能还没有尺寸，先等容器有宽度再 display，避免空白。
 *  - 用 ResizeObserver 监听容器尺寸变化（拖分栏 / 窗口缩放）后自动 resize 重排，避免内容偏移。
 *  - spread 固定单页（'none'），避免窄容器双页布局导致的显示错位。 */
export default function EpubReader({
  book,
  progress,
  onProgress,
  fontSize = 1,
  theme,
  onAddNote,
  jumpCfi,
  jumpTick,
  highlightSignal,
  replayHighlights,
  removeHighlight,
  onHighlight,
}: {
  book: DiskEntry
  progress: BookProgress | null
  onProgress: (p: { percent: number; cfi?: string }) => void
  fontSize?: number
  /** 阅读主题：纸感 / 夜间背景 + 衬线字体（可选） */
  theme?: { bg?: string; color?: string; font?: string }
  /** 划词后点「批注」：把选中位置（CFI + 百分比）交给父组件去新建批注 */
  onAddNote?: (cfi: string, percent: number) => void
  /** 外部请求跳转到某个 CFI（点击批注列表项时）；jumpTick 递增让重复点击同一批注也生效 */
  jumpCfi?: string | null
  jumpTick?: number
  /** 工具栏「高亮」按钮：递增一次即高亮当前 iframe 内选区 */
  highlightSignal?: number
  /** 打开书时重放已持久化的高亮（空文本批注的 anchor 列表） */
  replayHighlights?: string[]
  /** 删除高亮笔记时移除对应标记（cfi + tick 支持重复删除） */
  removeHighlight?: { cfi: string; tick: number } | null
  /** 高亮成功后回调（父组件持久化高亮笔记） */
  onHighlight?: (cfi: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const bookRef = useRef<Book | null>(null)
  /** epub 主体容器（聚焦后 ←/→ 翻页） */
  const bodyRef = useRef<HTMLDivElement>(null)
  /** 目录（epub 的 TOC 导航） */
  const [toc, setToc] = useState<{ label: string; href: string }[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  /** 阅读流模式：分页（paginated）/ 滚动（scrolled）。白屏自动兜底时切换为滚动，无手动按钮 */
  const [flowMode, setFlowMode] = useState<'paginated' | 'scrolled'>('paginated')
  /** 划词高亮：选中文本后显示的浮动按钮位置 + 预存 CFI/百分比（点按钮时 iframe 选区可能已丢失） */
  const [hl, setHl] = useState<{ x: number; y: number; cfi?: string; percent?: number } | null>(null)
  /** 最近一次 relocated 的百分比与 CFI（供批注锚点 / 清除高亮后重绘当前页） */
  const lastPctRef = useRef(0)
  const lastCfiRef = useRef<string | null>(null)

  const switchFlow = (mode: 'paginated' | 'scrolled') => {
    setFlowMode(mode)
    const r = renditionRef.current
    if (!r) return
    try {
      ;(r as unknown as { flow: (f: string) => void }).flow(mode)
      // resize 必须传当前容器实际尺寸（epub.js 无参 resize 会用旧的像素宽度、不重新测量）
      const el = ref.current
      if (el) {
        ;(r as unknown as { resize: (w: number, h: number) => void }).resize(
          el.clientWidth,
          el.clientHeight,
        )
      }
    } catch {
      /* 忽略 */
    }
  }

  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const url = mediaProtocolUrl(book.path)
    const epub = ePub(url)
    bookRef.current = epub
    const rendition = epub.renderTo(el, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
      // 关键：允许 epub 内容 iframe 内执行脚本（否则 WebView2 沙箱拦截 → 正文空白）
      allowScriptedContent: true,
    })
    renditionRef.current = rendition

    // 给 epub 内容注入 CSP：只限制字体来源（'self' + data:）。
    // 书的 CSS 常引用设备专用字体路径（res:///、file:/// 等），这些请求：
    //  - 必然失败（协议不存在），刷屏 console；
    //  - 在 dev 模式下畸形 URL 会打崩 Vite dev server（URI malformed / decodeURI）。
    // 用 CSP 在浏览器层直接拦截，请求根本不会发出；图片/脚本/样式保持宽松，不影响正文。
    try {
      const hooks = rendition as unknown as {
        hooks: { content: { register: (fn: (contents: unknown) => void) => void } }
      }
      hooks.hooks.content.register((contents: unknown) => {
        try {
          const doc = (contents as { document?: Document }).document
          if (!doc?.head) return
          if (doc.head.querySelector('meta[http-equiv="Content-Security-Policy"]')) return
          const meta = doc.createElement('meta')
          meta.httpEquiv = 'Content-Security-Policy'
          meta.content =
            "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; font-src 'self' data:"
          doc.head.appendChild(meta)
        } catch {
          /* 忽略 */
        }
      })
    } catch {
      /* 忽略 */
    }

    let cancelled = false

    // 分栏 / 侧栏刚挂载时容器可能没有尺寸（clientWidth=0），等布局稳定后再渲染，
    // 否则 epub.js 会以 0 尺寸渲染导致整页空白（最多等 100 帧，避免无限循环）
    const show = () => {
      if (cancelled) return
      // 进度 CFI 可能已失效（书重排 / 旧进度 / 目录项变化），
      // display 失败时必须回退到从头显示，否则整页白屏。
      const failSafe = () => {
        if (cancelled) return
        try {
          rendition.display().catch(() => {})
        } catch {
          /* 忽略 */
        }
      }
      try {
        // display 成功后必须主动 resize 一次：epub.js 的 iframe 初始是 0×0，
        // 需要 resize() 撑开到容器尺寸（此前由 ResizeObserver 首次触发完成，
        // 移除 RO 后改由这里显式触发，否则正文白屏）。
        const p = progress?.cfi
          ? rendition.display(progress.cfi).catch(() => {
              // 无效 CFI（No startContainer found 等）→ 回退从头显示
              failSafe()
            })
          : rendition.display()
        Promise.resolve(p)
          .then(() => {
            if (!cancelled) {
              try {
                ;(rendition as unknown as { resize: (w: number, h: number) => void }).resize(
                  el.clientWidth,
                  el.clientHeight,
                )
              } catch {
                /* noop */
              }
            }
          })
          .catch(() => {})
        // 双保险：即使 display 的 promise 迟迟不 resolve，也要在短时间内撑开一次
        window.setTimeout(() => {
          if (!cancelled) {
            try {
              ;(rendition as unknown as { resize: (w: number, h: number) => void }).resize(
                el.clientWidth,
                el.clientHeight,
              )
            } catch {
              /* noop */
            }
          }
        }, 150)
        // 白屏自动兜底：个别书（CSS 宽度异常等）分页模式渲染后内容为空，
        // 检测到 iframe 内没有文字时自动切换滚动模式并重新显示
        window.setTimeout(() => {
          if (cancelled) return
          try {
            const anyR = rendition as unknown as {
              getContents?: () => { document: { body: { innerText: string } } }[]
              flow?: (f: string) => void
              resize?: (w: number, h: number) => void
              display?: (target?: string) => Promise<unknown>
            }
            const body = anyR.getContents?.()?.[0]?.document?.body
            const text = body?.innerText?.trim() ?? ''
            if (text.length > 0) return
            // 空白 → 切滚动模式重试（对超宽/异常布局的书最有效），并同步按钮状态
            setFlowMode('scrolled')
            anyR.flow?.('scrolled')
            anyR.resize?.(el.clientWidth, el.clientHeight)
            window.setTimeout(() => {
              if (!cancelled) {
                try {
                  anyR.display?.().catch(() => {})
                } catch {
                  /* 忽略 */
                }
              }
            }, 120)
          } catch {
            /* 忽略 */
          }
        }, 1600)
      } catch {
        /* 已销毁等情况忽略 */
      }
    }
    let sizeTries = 0
    const waitForSize = () => {
      if (cancelled) return
      if (el.clientWidth > 0 && el.clientHeight > 0) show()
      else if (sizeTries++ < 100) requestAnimationFrame(waitForSize)
    }
    requestAnimationFrame(waitForSize)

    // 进度上报节流：epub.js 重排/翻页时 relocated 可能较频繁，
    // 若每次都 setState 会造成阅读区与批注区反复重渲染闪烁。
    let lastPct = -1
    let lastTime = 0
    rendition.on('relocated', (loc: { start?: { percentage?: string; cfi?: string } }) => {
      const pct = Number(loc.start?.percentage ?? 0) * 100
      lastPctRef.current = pct
      lastCfiRef.current = loc.start?.cfi ?? null
      const now = Date.now()
      if (Math.abs(pct - lastPct) < 0.5 && now - lastTime < 800) return
      lastPct = pct
      lastTime = now
      onProgress({ percent: pct, cfi: loc.start?.cfi })
    })

    // 容器尺寸变化（拖分栏 / 分栏开关 / 窗口缩放 / 文件树宽度变化）时自动重排。
    // resize 前记录当前位置 CFI（CFI 指向 DOM 节点、不依赖分页宽度，重排后仍有效），
    // resize 后 display 回该 CFI 恢复位置——这样分栏后内容既按新宽度重排、又停在原处。
    // 注意：不要用 display(百分比)（epub.js 不认、会回退第一页）。
    let roTimer: number | null = null
    const scheduleResize = () => {
      if (cancelled) return
      if (roTimer) window.clearTimeout(roTimer)
      roTimer = window.setTimeout(() => {
        if (cancelled) return
        try {
          let cfi: string | null = null
          try {
            const loc = (rendition as unknown as {
              currentLocation?: () => { start?: { cfi?: string } } | null
            }).currentLocation?.()
            cfi = loc?.start?.cfi ?? null
          } catch {
            /* 忽略 */
          }
          // epub.js 无参 resize 会用旧的像素宽度、不重新测量容器，导致分栏后内容不收缩。
          // 必须传当前容器（.epub-view）的实际尺寸。
          const host = ref.current
          const w = host?.clientWidth ?? 0
          const h = host?.clientHeight ?? 0
          if (w > 0 && h > 0) {
            ;(rendition as unknown as { resize: (w: number, h: number) => void }).resize(w, h)
          }
          if (cfi) {
            window.setTimeout(() => {
              if (cancelled) return
              try {
                ;(rendition as unknown as { display: (t: string) => Promise<unknown> })
                  .display(cfi)
                  .catch(() => {
                    /* 定位失败保持 resize 后的当前页，不回退 */
                  })
              } catch {
                /* 忽略 */
              }
            }, 80)
          }
        } catch {
          /* noop */
        }
      }, 200)
    }
    window.addEventListener('resize', scheduleResize)
    window.addEventListener('clnote-pane-resized', scheduleResize)

    return () => {
      cancelled = true
      if (roTimer) window.clearTimeout(roTimer)
      window.removeEventListener('resize', scheduleResize)
      window.removeEventListener('clnote-pane-resized', scheduleResize)
      try {
        rendition.destroy()
      } catch {
        /* noop */
      }
      try {
        epub.destroy()
      } catch {
        /* noop */
      }
      renditionRef.current = null
      bookRef.current = null
    }
    // 仅在打开的书变化时重新初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path])

  // 字号调节（A−/A+）：epub.js 主题字体缩放
  useEffect(() => {
    const r = renditionRef.current
    if (!r) return
    try {
      ;(r as unknown as { themes: { fontSize: (size: string) => void } }).themes.fontSize(
        `${fontSize * 100}%`,
      )
    } catch {
      /* 未就绪时忽略 */
    }
  }, [fontSize])

  // 阅读主题：纸感 / 夜间背景 + 衬线字体（themes.override）
  useEffect(() => {
    const r = renditionRef.current
    if (!r) return
    try {
      const th = (r as unknown as { themes: { override: (k: string, v: string) => void } }).themes
      if (theme?.bg) th.override('background', theme.bg)
      if (theme?.color) th.override('color', theme.color)
      if (theme?.font) th.override('font-family', theme.font)
    } catch {
      /* 未就绪时忽略 */
    }
  }, [theme?.bg, theme?.color, theme?.font])

  // 翻页方向键：仅当按键来自 epub 内容 iframe（点进正文后）←/→ 翻页，不干扰编辑器
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || !t.ownerDocument || t.ownerDocument === document) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        navRef.current(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        navRef.current(1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // 划词批注/高亮：从【iframe 内部】取选区（父文档 getSelection 拿不到 iframe 内选区）。
  // 监听 mouseup + selectionchange 双通道（iframe 内划词两种事件路径都可能覆盖）；
  // 浮动条位置用【选区自身的 getBoundingClientRect】定位——无论鼠标在哪里松开，
  // 按钮都出现在选中文字上方，符合 office 行为。
  useEffect(() => {
    const showHlFromSelection = () => {
      let iframeSel: Selection | null = null
      let contents:
        | { window?: Window; cfiFromRange?: (range: Range) => string | null }
        | undefined
      try {
        const anyR = renditionRef.current as unknown as {
          getContents?: () => {
            window?: Window
            cfiFromRange?: (range: Range) => string | null
          }[]
        }
        contents = anyR.getContents?.()?.[0]
        iframeSel = contents?.window?.getSelection?.() ?? null
      } catch {
        /* 忽略 */
      }
      if (!iframeSel || iframeSel.isCollapsed || iframeSel.rangeCount === 0) return
      try {
        const range = iframeSel.getRangeAt(0)
        const cfi = contents?.cfiFromRange?.(range)
        if (!cfi) return
        // getBoundingClientRect 返回的是相对 iframe 视口的坐标，
        // 必须加上 iframe 在页面中的偏移，否则浮动条会跑到屏幕外
        let iframeLeft = 0
        let iframeTop = 0
        try {
          const frameEl = (contents?.window as unknown as { frameElement?: Element })
            ?.frameElement as HTMLElement | null
          const fr = frameEl?.getBoundingClientRect()
          if (fr) {
            iframeLeft = fr.left
            iframeTop = fr.top
          }
        } catch {
          /* 忽略 */
        }
        const rect = range.getBoundingClientRect()
        const x = iframeLeft + rect.left + rect.width / 2
        const y = iframeTop + rect.top - 8
        setHl({ x, y, cfi, percent: lastPctRef.current })
      } catch {
        /* 忽略 */
      }
    }
    const hideHl = () => setHl(null)

    const onUp = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      // 只有当事件【发生在 iframe 正文内】（划词松开）才显示浮动条，
      // 点击外部按钮/面板不会触发（消除「点外面还弹出高亮/批注」）
      const fromIframe = !!t && !!t.ownerDocument && t.ownerDocument !== document
      const anyR = renditionRef.current as unknown as {
        getContents?: () => { window?: Window }[]
      }
      let iframeSel: Selection | null = null
      try {
        iframeSel = anyR.getContents?.()?.[0]?.window?.getSelection?.() ?? null
      } catch {
        /* 忽略 */
      }
      const hasSel = !!iframeSel && !iframeSel.isCollapsed && iframeSel.rangeCount > 0
      if (!hasSel) {
        // 普通点击正文 → 容器聚焦，方向键可用
        if (fromIframe) bodyRef.current?.focus()
        hideHl()
        return
      }
      if (!fromIframe) {
        // 选区在正文但鼠标在外部松开：不弹（避免误触发）
        return
      }
      showHlFromSelection()
    }
    window.addEventListener('mouseup', onUp, true)
    return () => {
      window.removeEventListener('mouseup', onUp, true)
    }
  }, [])

  const navRef = useRef<(dir: number) => void>(() => {})
  navRef.current = (dir: number) => {
    const r = renditionRef.current
    if (!r) return
    if (dir < 0) r.prev()
    else r.next()
  }

  // 统一高亮：标注 CFI 并返回是否成功。已高亮过的 CFI 直接跳过（避免 DOM 高亮叠加两层）
  const highlightedRef = useRef<Set<string>>(new Set())
  const highlightCfi = (cfi: string): boolean => {
    if (highlightedRef.current.has(cfi)) return false
    const r = renditionRef.current
    if (!r) return false
    try {
      ;(r as unknown as { annotations?: { highlight?: (c: string) => void } }).annotations?.highlight?.(
        cfi,
      )
      highlightedRef.current.add(cfi)
      return true
    } catch {
      return false
    }
  }

  // 执行高亮（浮动条按钮）：用预存 CFI，成功后回调父组件持久化
  const doHighlight = () => {
    if (!hl?.cfi) return
    if (highlightCfi(hl.cfi)) onHighlight?.(hl.cfi)
    setHl(null)
  }

  // 工具栏「🖍 高亮」：高亮当前 iframe 内选区（父组件每次点击递增 highlightSignal）
  useEffect(() => {
    if (!highlightSignal) return
    const anyR = renditionRef.current as unknown as {
      getContents?: () => { window?: Window; cfiFromRange?: (r: Range) => string | null }[]
    }
    let cfi: string | null = null
    try {
      const contents = anyR.getContents?.()?.[0]
      const sel = contents?.window?.getSelection?.()
      if (contents?.cfiFromRange && sel && !sel.isCollapsed && sel.rangeCount > 0) {
        cfi = contents.cfiFromRange(sel.getRangeAt(0))
      }
    } catch {
      /* 忽略 */
    }
    if (cfi && highlightCfi(cfi)) onHighlight?.(cfi)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightSignal])

  // 打开书时重放已持久化的高亮（渲染完成后逐个标注）
  useEffect(() => {
    if (!replayHighlights?.length) return
    const timer = window.setTimeout(() => {
      replayHighlights.forEach((cfi) => highlightCfi(cfi))
    }, 500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.path])

  // 删除高亮笔记 → 移除对应标记
  useEffect(() => {
    if (!removeHighlight?.cfi) return
    const r = renditionRef.current
    if (!r) return
    try {
      // 必须传 type='highlight'：epub.js 内部 hash=encodeURI(cfi+type)，
      // 不传 type 会生成 'undefined' 后缀导致匹配不到、移除失败
      ;(r as unknown as { annotations?: { remove?: (cfi: string, type: string) => void } }).annotations?.remove?.(
        removeHighlight.cfi,
        'highlight',
      )
      highlightedRef.current.delete(removeHighlight.cfi)
      // 移除 DOM 标记后重绘当前页，确保视觉上立即消失
      const cfi = lastCfiRef.current
      if (cfi) {
        window.setTimeout(() => {
          try {
            ;(r as unknown as { display: (t: string) => Promise<unknown> })
              .display(cfi)
              .catch(() => {})
          } catch {
            /* 忽略 */
          }
        }, 60)
      }
    } catch {
      /* 忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removeHighlight?.cfi, removeHighlight?.tick])

  // 点「批注」：把选中位置交给父组件（打开批注输入并锚定到该位置）
  const doAddNote = () => {
    if (hl?.cfi && hl.percent != null) onAddNote?.(hl.cfi, hl.percent)
    setHl(null)
  }

  // 点击批注列表项：跳转到书内对应文字位置（CFI 精确定位）
  useEffect(() => {
    if (!jumpCfi) return
    const r = renditionRef.current
    if (!r) return
    try {
      r.display(jumpCfi).catch(() => {})
    } catch {
      /* 忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpCfi, jumpTick])

  // 读取 epub 目录（TOC）
  useEffect(() => {
    let alive = true
    const b = bookRef.current
    if (!b) return
    ;(
      (b as unknown as { loaded: { navigation: Promise<{ toc: { label: string; href: string }[] }> } })
        .loaded.navigation as Promise<{ toc: { label: string; href: string }[] }>
    )
      .then((nav) => {
        if (alive) setToc(nav.toc ?? [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [book.path])

  const nav = (dir: number) => {
    const r = renditionRef.current
    if (!r) return
    if (dir < 0) r.prev()
    else r.next()
  }

  const jumpTo = (href: string) => {
    const r = renditionRef.current
    if (!r) return
    try {
      r.display(href)
    } catch {
      /* 定位失败忽略 */
    }
    setTocOpen(false)
  }

  return (
    <div className="epub-wrap">
      <div className="epub-toolbar">
        <button className="tb-btn" onClick={() => nav(-1)}>
          ← 上一页
        </button>
        <button className="tb-btn" onClick={() => nav(1)}>
          下一页 →
        </button>
        <button
          className={'tb-btn' + (tocOpen ? ' active' : '')}
          onClick={() => setTocOpen((v) => !v)}
          title="目录（章节导航）"
        >
          📑 目录 {toc.length ? `(${toc.length})` : ''}
        </button>
      </div>
      <div
        className="epub-body"
        ref={bodyRef}
        tabIndex={0}
        onKeyDown={(e) => {
          // 点击正文后容器获得焦点，←/→ 即可翻页（分页=翻页，滚动=上一节/下一节）
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            navRef.current(e.key === 'ArrowLeft' ? -1 : 1)
          }
        }}
        style={{ outline: 'none' }}
      >
        {tocOpen && (
          <div className="epub-toc">
            <div className="epub-toc-title">目录</div>
            <div className="epub-toc-list">
              {toc.length === 0 && <div className="mat-empty">此书没有目录信息。</div>}
              {toc.map((t, i) => (
                <div
                  key={t.href || i}
                  className="epub-toc-item"
                  title={t.label}
                  onClick={() => jumpTo(t.href)}
                >
                  {t.label}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="epub-view" ref={ref} />
      </div>
      {hl && (
        <div className="epub-hl-bar" style={{ left: hl.x, top: hl.y - 44 }}>
          <button className="epub-hl-btn" onClick={doHighlight} title="把选中文字标亮（会话内高亮）">
            📌 高亮
          </button>
          <button className="epub-hl-btn" onClick={doAddNote} title="在选中文字处添加批注">
            💬 批注
          </button>
        </div>
      )}
    </div>
  )
}
