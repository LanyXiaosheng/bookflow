import { test, expect } from '@playwright/test'

test('选题：评分 → 立项 → 列表出现新条目（前后端贯通）', async ({ page }) => {
  // 用唯一标题，避免和 db 已有数据撞
  const title = `测试-${Date.now()}-彩排那天伴娘群弹出他和伴娘的开房记录`.slice(0, 25)

  await page.goto('/seeds')
  await expect(page.locator('h1')).toContainText('选题评分卡')

  // 默认 5+5+5+4+4+5+5 = 33 → greenlight
  await expect(page.getByTestId('score-total')).toHaveText('33')
  await expect(page.getByTestId('tier-label')).toHaveText('立项')

  await page.getByTestId('seed-title').fill(title)
  await page.getByTestId('submit-seed').click()

  // 列表里出现新条目
  const list = page.getByTestId('seeds-list')
  await expect(list.getByText(title, { exact: true })).toBeVisible({ timeout: 5_000 })
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

test('顶部 nav 8 项齐全', async ({ page }) => {
  await page.goto('/')
  for (const label of ['看板', '选题', '项目', '已发', '复盘', '赛道', '手册', '设置']) {
    await expect(
      page.locator('nav').getByRole('link', { name: label, exact: true })
    ).toBeVisible()
  }
})
