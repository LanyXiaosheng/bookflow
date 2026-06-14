# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e.spec.ts >> 项目详情复制会输出预览文本而不是 markdown 源码
- Location: tests/e2e.spec.ts:520:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByTestId('copy-publish_post-btn')

```

# Test source

```ts
  465 |   await page.getByTestId('review-engagement-count').fill('')
  466 |   await page.getByTestId('review-save-btn').click()
  467 | 
  468 |   await expect.poll(() => saveCount).toBe(1)
  469 |   expect(receivedSaveBody).toMatchObject({
  470 |     data_recorded: false,
  471 |     read_count: null,
  472 |     completion_rate: null,
  473 |     engagement_count: null,
  474 |   })
  475 | 
  476 |   await page.getByTestId('review-read-count').fill('1234')
  477 |   await page.getByTestId('review-completion-rate').fill('0.56')
  478 |   await page.getByTestId('review-engagement-count').fill('88')
  479 |   await page.getByTestId('review-overall-result').selectOption('爆')
  480 |   await page.getByTestId('review-title-result').fill('标题钩子有效')
  481 |   await page.getByTestId('review-hook-result').fill('开头留人稳定')
  482 |   await page.getByTestId('review-emotion-result').fill('情绪节点够密')
  483 |   await page.getByTestId('review-success-reason').fill('节奏和反转匹配赛道预期')
  484 |   await page.getByTestId('review-failure-reason').fill('中段传播点不够集中')
  485 |   await page.getByTestId('review-continue-track').fill('继续追投婚恋火葬场')
  486 |   await page.getByTestId('review-reusable-conclusion').fill('高压身份反差仍然有效')
  487 |   await page.getByTestId('review-next-action').fill('下一篇继续做身份反转强钩子')
  488 |   await page.getByTestId('review-save-btn').click()
  489 | 
  490 |   await expect(page.getByText('已保存复盘')).toBeVisible({ timeout: 15_000 })
  491 |   await expect.poll(() => saveCount).toBe(2)
  492 |   await expect(page.getByTestId('review-read-count')).toHaveValue('1234')
  493 |   await expect(page.getByTestId('review-overall-result')).toHaveValue('爆')
  494 |   await expect.poll(() => receivedSaveBody).not.toBeNull()
  495 |   expect(receivedSaveBody).toMatchObject({
  496 |     data_recorded: true,
  497 |     read_count: 1234,
  498 |     completion_rate: 0.56,
  499 |     engagement_count: 88,
  500 |     overall_result: '爆',
  501 |     title_result: '标题钩子有效',
  502 |     next_action: '下一篇继续做身份反转强钩子',
  503 |   })
  504 | })
  505 | 
  506 | test('通知铃铛会展示真实通知面板', async ({ page }) => {
  507 |   await page.setViewportSize({ width: 1280, height: 900 })
  508 |   await page.goto('/')
  509 |   await expect(page.getByTestId('notification-trigger')).toBeVisible()
  510 |   await expect(page.getByTestId('notification-trigger')).toContainText('2')
  511 | 
  512 |   await page.getByTestId('notification-trigger').click()
  513 |   await expect(page.getByTestId('notification-panel')).toBeVisible()
  514 |   await expect(page.getByTestId('notification-panel')).toContainText('待复盘项目 2 篇')
  515 |   await expect(page.getByTestId('notification-panel')).toContainText('AI 设置未配置完整')
  516 |   await expect(page.getByTestId('notifications-read-all')).toBeVisible()
  517 |   await expect(page.getByTestId('notifications-clear-resolved')).toBeVisible()
  518 | })
  519 | 
  520 | test('项目详情复制会输出预览文本而不是 markdown 源码', async ({ page }) => {
  521 |   const projectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  522 |   await page.route('**/api/projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc', async (route) => {
  523 |     await route.fulfill({
  524 |       json: {
  525 |         id: projectId,
  526 |         seed_id: 'seed-copy-0000-4000-8000-000000000000',
  527 |         title: '复制测试项目',
  528 |         track: '现言婚恋火葬场',
  529 |         status: 'ready',
  530 |         created_at: '2026-06-08T10:00:00Z',
  531 |         updated_at: '2026-06-08T10:00:00Z',
  532 |       },
  533 |     })
  534 |   })
  535 |   await page.route('**/api/projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc/artifacts', async (route) => {
  536 |     await route.fulfill({
  537 |       json: [
  538 |         {
  539 |           id: 'artifact-copy-1',
  540 |           project_id: projectId,
  541 |           kind: 'publish_post',
  542 |           version: 1,
  543 |           content: '# 第一章\n\n这是正文。\n\n---\n\n**第二段**继续。',
  544 |           created_at: '2026-06-08T10:00:00Z',
  545 |         },
  546 |       ],
  547 |     })
  548 |   })
  549 |   await page.route('**/api/projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc/chapters', async (route) => {
  550 |     await route.fulfill({ json: [] })
  551 |   })
  552 | 
  553 |   await page.addInitScript(() => {
  554 |     ;(window as Window & { __copiedText?: string }).__copiedText = ''
  555 |     Object.assign(navigator, {
  556 |       clipboard: {
  557 |         writeText: async (text: string) => {
  558 |           ;(window as Window & { __copiedText?: string }).__copiedText = text
  559 |         },
  560 |       },
  561 |     })
  562 |   })
  563 | 
  564 |   await page.goto(`/projects/${projectId}`)
> 565 |   await page.getByTestId('copy-publish_post-btn').click()
      |                                                   ^ Error: locator.click: Test timeout of 30000ms exceeded.
  566 | 
  567 |   const copied = await page.evaluate(() => (window as Window & { __copiedText?: string }).__copiedText)
  568 |   expect(copied).toContain('第一章')
  569 |   expect(copied).toContain('这是正文。')
  570 |   expect(copied).toContain('第二段继续。')
  571 |   expect(copied).not.toContain('# ')
  572 |   expect(copied).not.toContain('---')
  573 |   expect(copied).not.toContain('**')
  574 | })
  575 | 
```