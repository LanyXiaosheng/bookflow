import { test, expect } from '@playwright/test'

// 端到端：选题（绿灯自动立项）→ 项目明细 → 进入写作 → 新建章节 + 手写正文 + 保存 → 定稿进入待发 → 待发列表能找到
test('端到端：seed → project → 章节 → 定稿 → 待发列表', async ({ page }) => {
  const title = `流程${Date.now()}冲喜替嫁那夜他先掀红盖头`.slice(0, 25)

  await page.goto('/seeds')
  // 默认 33 分 = greenlight，提交后会自动 createFromSeed 并跳到 /projects/:id
  await page.getByTestId('seed-title').fill(title)
  await page.getByTestId('submit-seed').click()

  // 先跳到项目明细页
  await page.waitForURL(/\/projects\/[\w-]+$/, { timeout: 15_000 })
  await expect(page.getByText(title)).toBeVisible()
  await page.getByRole('link', { name: /进入写作/ }).click()
  await page.waitForURL(/\/projects\/[\w-]+\/write/, { timeout: 15_000 })

  // 新建一章
  await page.getByTestId('new-chapter-btn').click()
  await page.getByTestId('chapter-title-input').fill('第1章 替嫁')

  // 写正文（用唯一片段，后面验）
  const body = `这是流程测试正文${Date.now()}。` + '她'.repeat(10020)
  await page.getByTestId('chapter-body-textarea').fill(body)

  // 字数实时
  await expect(page.getByTestId('chapter-wc')).toContainText(`${Array.from(body).length}`)

  // 保存
  await page.getByTestId('save-chapter-btn').click()
  await expect(page.getByText(/已保存/)).toBeVisible({ timeout: 5_000 })

  // 定稿（自定义 ConfirmDialog）
  await page.getByTestId('finalize-btn').click()
  await page.getByRole('button', { name: '定稿', exact: true }).click()

  // 跳到 /ready
  await page.waitForURL(/\/ready$/, { timeout: 15_000 })
  await expect(page.getByText(title)).toBeVisible()
})

test('待发 → 已发 → 归档 状态机推进', async ({ page, request }) => {
  // 自建一个 seed 起 ready 项目，免得跟其他测试抢
  const title = `流程状态机${Date.now()}上市敲钟那天前夫发现首席法务官是我`.slice(0, 25)
  const seed = await request
    .post('/api/seeds', {
      data: {
        title,
        track: '现言婚恋火葬场',
        score: { title: 5, opening: 5, slap: 5, emotion: 4, twist: 4, hook: 5, finish: 5 },
      },
    })
    .then((r) => r.json())
  const proj = await request
    .post('/api/projects', { data: { seed_id: seed.id } })
    .then((r) => r.json())
  await request.post(`/api/projects/${proj.id}/transition`, { data: { to: 'ready' } })

  await page.goto('/ready')
  const card = page.getByTestId('project-card').filter({ hasText: proj.title })
  await expect(card).toBeVisible()

  // 一路点下一阶段：ready → published → archived
  await card.getByTestId('project-next-btn').click()
  await page.goto('/published')
  const card2 = page.getByTestId('project-card').filter({ hasText: proj.title })
  await expect(card2).toBeVisible()
  await card2.getByTestId('project-next-btn').click()
  await page.goto('/archived')
  await expect(page.getByTestId('project-card').filter({ hasText: proj.title })).toBeVisible()
})

test('全书汇总：详情页可生成汇总和优化版', async ({ page, request }) => {
  test.setTimeout(180_000)

  const title = `e2e汇总-${Date.now()}-她签下离婚协议那天`.slice(0, 25)
  const seed = await request
    .post('/api/seeds', {
      data: {
        title,
        track: '现言婚恋火葬场',
        score: { title: 5, opening: 5, slap: 5, emotion: 4, twist: 4, hook: 5, finish: 5 },
      },
    })
    .then((r) => r.json())
  const proj = await request
    .post('/api/projects', { data: { seed_id: seed.id } })
    .then((r) => r.json())

  const c1 = await request
    .post(`/api/projects/${proj.id}/chapters`, { data: { title: '第一章' } })
    .then((r) => r.json())
  const c2 = await request
    .post(`/api/projects/${proj.id}/chapters`, { data: { title: '第二章' } })
    .then((r) => r.json())
  await request.put(`/api/chapters/${c1.id}`, {
    data: { title: '第一章', body: '第一章正文。她在签字前先把婚戒摘了下来。' },
  })
  await request.put(`/api/chapters/${c2.id}`, {
    data: { title: '第二章', body: '第二章正文。他追到民政局门口时她已经上车。' },
  })

  await page.goto(`/projects/${proj.id}`)
  await page.getByTestId('ai-book_summary-btn').click()
  await expect(page.getByTestId('book_summary-content')).not.toHaveText('', {
    timeout: 120_000,
  })
  await expect(page.getByTestId('copy-book_summary-btn')).toBeVisible()

  await page.getByTestId('ai-book_polished-btn').click()
  await expect(page.getByTestId('book_polished-content')).not.toHaveText('', {
    timeout: 120_000,
  })
  await expect(page.getByTestId('copy-book_polished-btn')).toBeVisible()
})

test('前期方案流：README → 角色设定，确认后才能生成大纲', async ({ page, request }) => {
  test.setTimeout(360_000)

  const title = `e2e立项流-${Date.now()}-她签下协议后全网都在等他追妻`.slice(0, 25)
  const seed = await request
    .post('/api/seeds', {
      data: {
        title,
        track: '现言婚恋火葬场',
        score: { title: 5, opening: 5, slap: 5, emotion: 4, twist: 4, hook: 5, finish: 5 },
      },
    })
    .then((r) => r.json())
  const proj = await request
    .post('/api/projects', { data: { seed_id: seed.id } })
    .then((r) => r.json())

  await page.goto(`/projects/${proj.id}`)
  await expect(page.getByTestId('projectize-flow-btn')).toContainText('重新生成前期方案')
  await expect(page.getByTestId('character_setup-card')).toBeVisible()
  await expect(page.getByTestId('ai-outline-btn')).toBeDisabled()

  await page.getByTestId('projectize-flow-btn').click()

  await expect(page.getByTestId('projectize-flow-abort-btn')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('projectize-flow-btn')).toBeDisabled()
  await expect(page.getByTestId('projectize-flow-btn')).toContainText(/README|角色设定/)
  await expect(page.getByTestId('readme-content')).not.toHaveText('', { timeout: 120_000 })
  await expect(page.getByTestId('character_setup-content')).not.toHaveText('', { timeout: 120_000 })
  await expect(page.getByTestId('projectize-flow-abort-btn')).toBeHidden({ timeout: 300_000 })
  await expect(page.getByTestId('projectize-flow-btn')).toContainText('重新生成前期方案')
  await expect(page.getByTestId('character-setup-confirm-btn')).toBeVisible()
  await expect(page.getByTestId('outline-stale-notice')).toBeVisible()
  await expect(page.getByTestId('ai-outline-btn')).toBeDisabled()

  await page.getByTestId('character-setup-confirm-btn').click()
  await expect(page.getByTestId('outline-stale-notice')).toBeHidden()
  await expect(page.getByTestId('ai-outline-btn')).toBeEnabled()
})
