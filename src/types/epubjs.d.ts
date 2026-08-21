// epub.js 没有官方 @types 包，这里提供最小化的模块声明，仅覆盖本项目用到的 API。
// 若日后 epubjs 自带类型，删除本文件即可。
declare module 'epubjs' {
  export interface RenditionLocation {
    start?: { cfi?: string; percentage?: string; href?: string; location?: string }
    end?: { cfi?: string; percentage?: string }
  }
  export interface Rendition {
    display(target?: string): Promise<void>
    next(): void
    prev(): void
    destroy(): void
    on(event: 'relocated' | 'rendered' | string, handler: (location: RenditionLocation) => void): void
  }
  export interface Book {
    destroy(): void
    renderTo(element: HTMLElement | string, options: Record<string, unknown>): Rendition
  }
  export default function ePub(
    url: string | ArrayBuffer,
    options?: Record<string, unknown>,
  ): Book
}
