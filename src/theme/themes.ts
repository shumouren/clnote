/** 主题预设与强调色 */
export interface ThemePreset {
  id: string
  name: string
  /** 代表色，用于设置面板色块 */
  swatch: string
}

export const THEMES: ThemePreset[] = [
  { id: 'light', name: '浅色', swatch: '#f5f6f8' },
  { id: 'dark', name: '暗色', swatch: '#16181d' },
  { id: 'paper', name: '纸感', swatch: '#efe9dc' },
  { id: 'eye', name: '护眼', swatch: '#c7edcc' },
  { id: 'guofeng', name: '古风纸', swatch: '#e9dcbf' },
  { id: 'celadon', name: '青瓷', swatch: '#dfeae6' },
  { id: 'rouge', name: '胭脂', swatch: '#f3e3e6' },
  { id: 'graphite', name: '石墨', swatch: '#1b1d22' },
  { id: 'mint', name: '薄荷', swatch: '#e6f5ee' },
  { id: 'deepsea', name: '深海', swatch: '#10151f' },
  { id: 'sunset', name: '落日', swatch: '#fbeede' },
  { id: 'cyber', name: '赛博', swatch: '#16122b' },
]

export const ACCENTS: string[] = [
  '#2f6df6',
  '#b8782e',
  '#2f8f57',
  '#d6457a',
  '#7c5cff',
]
