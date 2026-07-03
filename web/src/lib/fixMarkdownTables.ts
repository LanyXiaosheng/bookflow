/**
 * 修复 AI 生成的 Markdown 表格分隔行列数与表头不一致的问题。
 *
 * GFM 规范要求表格分隔行（| --- | --- |）的单元格数必须和表头行一致，
 * 否则 remark-gfm 整段不认作表格、原样当纯文本渲染。AI 写大纲的「爆点节奏表」
 * 时经常把分隔行写少几列（如表头 4 列、分隔行只给 3 个 ---），导致表格不渲染。
 *
 * 这里在渲染前做一道兜底：检测「表头行 + 紧邻分隔行」的组合，
 * 当分隔行单元格数 ≠ 表头列数时，按表头列数重建分隔行（保留已有的对齐冒号）。
 * 不改表头和数据行内容，只规整分隔行。
 */

/** 把一行按 `|` 切成单元格，去掉首尾空管道产生的空串 */
function splitCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

/** 一行是否「看起来像」分隔行：每个单元格只由 -、: 和空格组成，且至少含一个 - */
function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false
  return splitCells(trimmed).every((c) => /^:?-+:?$/.test(c))
}

/** 一行是否像表格行（含管道符且不是纯空行） */
function looksLikeTableRow(line: string): boolean {
  return line.trim().includes('|')
}

/** 按表头列数重建分隔行，尽量保留原分隔行已有的对齐（: 位置） */
function rebuildSeparator(headerCols: number, originalCells: string[]): string {
  const cells: string[] = []
  for (let i = 0; i < headerCols; i++) {
    // 复用原单元格的对齐冒号；多出来的列用默认 ---
    const orig = originalCells[i] ?? ''
    const left = orig.startsWith(':') ? ':' : ''
    const right = orig.endsWith(':') ? ':' : ''
    cells.push(`${left}---${right}`)
  }
  return `| ${cells.join(' | ')} |`
}

export function fixMarkdownTables(md: string): string {
  if (!md || !md.includes('|')) return md
  const lines = md.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1]
    // 表头行（像表格行）+ 下一行是分隔行 → 校验列数
    if (
      next !== undefined &&
      looksLikeTableRow(line) &&
      !isSeparatorRow(line) &&
      isSeparatorRow(next)
    ) {
      const headerCols = splitCells(line).length
      const sepCells = splitCells(next)
      out.push(line)
      if (sepCells.length !== headerCols) {
        out.push(rebuildSeparator(headerCols, sepCells))
      } else {
        out.push(next)
      }
      i++ // 跳过已处理的分隔行
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}
