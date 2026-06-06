export const TRACK_PRIMARY_OPTIONS = [
  '婚姻家庭',
  '女生生活',
  '男生生活',
  '现言甜宠',
  '虐心婚恋',
  '青春虐恋',
  '男生情感',
  '女性成长',
  '悬疑惊悚',
  '玄幻仙侠',
  '宫斗宅斗',
  '男频衍生',
  '女频衍生',
  '年代',
  '纯爱',
  '其他',
  '古言甜宠',
  '古风世情',
  '都市日常',
  '男频脑洞',
  '女频脑洞',
  '民国旧影',
  '古言虐恋',
  '历史古代',
] as const

export const TRACK_PLOT_OPTIONS = [
  '追妻火葬场',
  '追夫火葬场',
  '真假千金',
  '先婚后爱',
  '打脸逆袭',
  '破镜重圆',
  '系统',
  '金手指',
  '大女主',
  '女性互助',
  '穿越',
  '重生',
  '暗恋',
  '婚恋',
  '权谋',
  '架空',
  '养崽文',
  '团宠',
  '无限流',
  '末日求生',
  '游戏动漫',
  '规则怪谈',
  '民间奇闻',
  '影视',
  '科幻',
  '推理',
  '直播',
  '升级流',
  '外卖',
  '鉴宝',
  '黑道',
  '都市江湖',
  '都市异能',
] as const

export type TrackPrimary = (typeof TRACK_PRIMARY_OPTIONS)[number]
export type TrackPlot = (typeof TRACK_PLOT_OPTIONS)[number]

export const DEFAULT_TRACK_PRIMARY: TrackPrimary = '婚姻家庭'
export const DEFAULT_TRACK_PLOT: TrackPlot = '追妻火葬场'

export function defaultPlotForPrimary(primary: string): TrackPlot {
  switch (primary) {
    case '悬疑惊悚':
      return '规则怪谈'
    case '玄幻仙侠':
      return '升级流'
    case '宫斗宅斗':
      return '权谋'
    case '历史古代':
      return '重生'
    case '现言甜宠':
      return '先婚后爱'
    case '古言甜宠':
      return '先婚后爱'
    case '女性成长':
      return '大女主'
    default:
      return DEFAULT_TRACK_PLOT
  }
}

export function composeTrack(primary: string, plots: string[]): string {
  const left = primary.trim()
  const right = plots.map((item) => item.trim()).filter(Boolean).join('/')
  if (!left) return right
  if (!right) return left
  return `${left}·${right}`
}

export function splitTrack(track: string): { primary: string; plots: string[] } {
  const normalized = track.trim()
  if (!normalized) {
    return { primary: DEFAULT_TRACK_PRIMARY, plots: [DEFAULT_TRACK_PLOT] }
  }

  const pairSeparators = ['·', ' / ', '/', '-', '｜', '|']
  for (const separator of pairSeparators) {
    const idx = normalized.indexOf(separator)
    if (idx > 0) {
      const primary = normalized.slice(0, idx).trim()
      const plots = normalized
        .slice(idx + separator.length)
        .split('/')
        .map((item) => item.trim())
        .filter(Boolean)
      return {
        primary: primary || DEFAULT_TRACK_PRIMARY,
        plots: plots.length > 0 ? plots : [DEFAULT_TRACK_PLOT],
      }
    }
  }

  switch (normalized) {
    case '现言婚恋火葬场':
      return { primary: '婚姻家庭', plots: ['追妻火葬场'] }
    case '古言重生打脸':
      return { primary: '历史古代', plots: ['重生'] }
    case '古言替嫁冲喜':
      return { primary: '古言甜宠', plots: ['先婚后爱'] }
    case '悬疑规则怪谈':
      return { primary: '悬疑惊悚', plots: ['规则怪谈'] }
    default:
      return { primary: normalized, plots: [DEFAULT_TRACK_PLOT] }
  }
}
