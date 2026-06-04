import { test, expect } from '@playwright/test'

test('选题：绿灯评分 → 自动立项 → 跳到 Write 页', async ({ page }) => {
  // 用唯一标题，避免和 db 已有数据撞
  const title = `测试-${Date.now()}-彩排那天伴娘群弹出他和伴娘的开房记录`.slice(0, 25)

  await page.goto('/seeds')
  await expect(page.locator('h1')).toContainText('选题评分卡')

  // 默认 5+5+5+4+4+5+5 = 33 → greenlight
  await expect(page.getByTestId('score-total')).toHaveText('33')
  await expect(page.getByTestId('tier-label')).toHaveText('立项')

  await page.getByTestId('seed-title').fill(title)
  await page.getByTestId('submit-seed').click()

  // 绿灯自动 createFromSeed → 跳到 /projects/:id/write
  await page.waitForURL(/\/projects\/[\w-]+\/write/, { timeout: 15_000 })
  await expect(page.getByText(title)).toBeVisible()
})

test('评分 < 23 → tier 显示 不做', async ({ page }) => {
  await page.goto('/seeds')
  // 把 7 个 slider 全设为 1 → 7 分 → reject
  // React 的受控 input 不认 el.value 直接赋值，要用 native setter 才能触发 state
  for (const k of ['title', 'opening', 'slap', 'emotion', 'twist', 'hook', 'finish']) {
    const sl = page.getByTestId(`slider-${k}`)
    await sl.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!
      setter.call(el, '1')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  await expect(page.getByTestId('score-total')).toHaveText('7')
  await expect(page.getByTestId('tier-label')).toHaveText('不做')
})

test('健康检查：db 连得上', async ({ request }) => {
  const r = await request.get('/healthz')
  expect(r.status()).toBe(200)
  expect(await r.json()).toEqual({ db: true })
})

test('顶部 nav 关键项可见', async ({ page }) => {
  await page.goto('/')
  for (const label of ['看板', '选题', '项目', '已发', '复盘', '赛道', '手册', '设置']) {
    await expect(
      page.locator('nav').getByRole('link', { name: label, exact: true })
    ).toBeVisible()
  }
})

test('看板 6 大区块齐全', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '生产看板' })).toBeVisible()
  await expect(page.getByText('QUICK START', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '生产流水线' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '下一篇发什么' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '催复盘' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '本周目标' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '在产项目' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '写作素材' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '近期产出' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '外部资源' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '技能资源' })).toBeVisible()
  // 流水线 6 个节点
  for (const k of ['seed', 'plan', 'write', 'ready', 'published', 'archive']) {
    await expect(page.getByTestId(`pipeline-${k}`)).toBeVisible()
  }
})

test('Settings 页：表单可见 + 字段已从 .env 兜底', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'LLM API 接入' })).toBeVisible()
  // base_url 输入框带初始值（从 .env 同步进 DB）
  const baseUrl = page.locator('#base_url')
  await expect(baseUrl).toBeVisible()
  await expect(baseUrl).not.toHaveValue('')
  // api_key 显示掩码（不回显明文）
  const masked = page.locator('#api_key_masked')
  await expect(masked).toContainText('*')
})

test('Tracks 页：4 个赛道列出 + 点开能渲染 markdown', async ({ page }) => {
  await page.goto('/tracks')
  await expect(page.getByRole('heading', { name: '赛道库' })).toBeVisible()
  for (const slug of ['现言婚恋火葬场', '古言重生打脸', '古言替嫁冲喜', '悬疑规则怪谈']) {
    await expect(page.getByTestId(`doc-item-${slug}`)).toBeVisible()
  }
  await page.getByTestId('doc-item-现言婚恋火葬场').click()
  await expect(page.getByTestId('doc-content').getByRole('heading', { name: '赛道定义' })).toBeVisible()
})

test('Playbook 页：11 篇手册 + 点开能渲染', async ({ page }) => {
  await page.goto('/playbook')
  await expect(page.getByRole('heading', { name: 'Playbook 写作手册' })).toBeVisible()
  // 至少 11 个目录项
  const items = page.locator('[data-testid^="doc-item-"]')
  await expect(items).toHaveCount(11)
  await page.getByTestId('doc-item-去AI味').click()
  await expect(page.getByTestId('doc-content')).toBeVisible()
})

test('Seeds 页：AI 生成面板可见 + 赛道 chip 可切换', async ({ page }) => {
  await page.goto('/seeds')
  await expect(page.getByTestId('ai-generate-panel')).toBeVisible()
  await expect(page.getByTestId('ai-generate-btn')).toBeVisible()
  // 默认选中现言；切到悬疑
  await page.getByTestId('gen-track-悬疑规则怪谈').click()
  await expect(page.getByTestId('gen-track-悬疑规则怪谈')).toHaveClass(/ring-2/)
})

test('评分卡顶部「AI 一键立项」按钮可见', async ({ page }) => {
  await page.goto('/seeds')
  await expect(page.getByTestId('ai-launch-btn')).toBeVisible()
  await expect(page.getByTestId('ai-launch-btn')).toContainText('AI 一键立项')
})

test('Write 页：AI 全章 + AI 全篇按钮可见', async ({ page }) => {
  // 先做出一个 writing 项目
  await page.goto('/seeds')
  const stamp = Date.now().toString().slice(-6)
  await page.getByTestId('seed-title').fill(`测试全章按钮${stamp}`)
  await page.getByTestId('submit-seed').click()
  await page.waitForURL(/\/projects\/[^/]+\/write/, { timeout: 15_000 })
  // 先建一章
  await page.getByTestId('new-chapter-btn').click()
  await expect(page.getByTestId('ai-full-chapter-btn')).toBeVisible()
  await expect(page.getByTestId('ai-full-book-btn')).toBeVisible()
})

test('最近选题：已立项的 seed 点击跳到 Write 页', async ({ page }) => {
  // 走完整流程：评分卡建一个绿灯 seed → 自动立项 → 跳 Write
  await page.goto('/seeds')
  const stamp = Date.now().toString().slice(-6)
  await page.getByTestId('seed-title').fill(`测试自动立项${stamp}`)
  // 默认评分 5/5/5/4/4/5/5 = 33 分，绿灯
  await page.getByTestId('submit-seed').click()
  await page.waitForURL(/\/projects\/[^/]+\/write/, { timeout: 15_000 })
  // 回 seeds 页，验证最近选题里这条带「进项目继续写」hint 且可点击
  await page.goto('/seeds')
  const item = page.getByTestId('seed-item').filter({ hasText: `测试自动立项${stamp}` }).first()
  await expect(item).toBeVisible()
  await expect(item).toContainText('进项目继续写')
  await item.click()
  await page.waitForURL(/\/projects\/[^/]+\/write/, { timeout: 5_000 })
})
