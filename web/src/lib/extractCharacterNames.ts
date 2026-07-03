const STOP_WORDS = new Set([
  '一句话简介',
  '钩子',
  '主角设定',
  '角色设定',
  '项目',
  '赛道',
  '状态',
  '评分',
  '女主',
  '男主',
  '白月光',
  '丈夫',
  '妻子',
  '前夫',
  '前妻',
  '闺蜜',
  '母亲',
  '父亲',
  '姐姐',
  '妹妹',
  '兄长',
  '反派',
])

export function extractCharacterNamesFromReadme(content: string): string[] {
  const names: string[] = []
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim().replace(/\*\*/g, '')
    const match = trimmed.match(/(?:女主|男主|白月光|丈夫|妻子|前夫|前妻|闺蜜|母亲|父亲|姐姐|妹妹|兄长|反派|主角)[：:]\s*([\u4e00-\u9fff]{2,4})/)
    if (match?.[1] && !STOP_WORDS.has(match[1]) && !names.includes(match[1])) {
      names.push(match[1])
    }
  }

  return names
}
