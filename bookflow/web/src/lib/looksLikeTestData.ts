/** 测试数据启发式：以「测试 / e2e / smoke / playwright / test」开头的标题视为测试数据 */
const TEST_PREFIX_RE = /^(测试|e2e|smoke|playwright|test)/i

export function looksLikeTestData(title: string): boolean {
  return TEST_PREFIX_RE.test(title.trim())
}
