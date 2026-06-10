import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      json: {
        user: {
          id: 'test-user',
          email: 'writer@example.com',
          display_name: '守单客',
          created_at: '2026-06-06T10:00:00Z',
        },
      },
    })
  })
  await page.route('**/api/notifications**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          unread_count: 2,
          items: [
            {
              id: 'notif-1',
              user_id: 'test-user',
              category: 'production',
              level: 'warning',
              status: 'unread',
              title: '待复盘项目 2 篇',
              body: '当前有 2 个项目等待补录复盘数据。',
              action_label: '去复盘',
              action_href: '/review',
              source_type: 'review_pending',
              source_id: null,
              fingerprint: 'pending-reviews',
              read_at: null,
              resolved_at: null,
              created_at: '2026-06-08T10:00:00Z',
              updated_at: '2026-06-08T10:00:00Z',
            },
            {
              id: 'notif-2',
              user_id: 'test-user',
              category: 'system',
              level: 'error',
              status: 'read',
              title: 'AI 设置未配置完整',
              body: '当前 AI API 的 base_url 或 api_key 缺失。',
              action_label: '去设置',
              action_href: '/settings',
              source_type: 'settings',
              source_id: null,
              fingerprint: 'settings-ai-missing',
              read_at: '2026-06-08T10:01:00Z',
              resolved_at: null,
              created_at: '2026-06-08T10:00:00Z',
              updated_at: '2026-06-08T10:01:00Z',
            },
          ],
        },
      })
      return
    }
    await route.fulfill({ status: 204 })
  })
})

const dashboardMainProject = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  seed_id: 'seed-main-0000-4000-8000-000000000000',
  title: '闺蜜订婚宴上她未婚夫把我当小三我先公开了合伙协议',
  track: '现言婚恋火葬场',
  status: 'ready',
  created_at: '2026-06-01T10:00:00Z',
  updated_at: '2026-06-05T10:00:00Z',
}

const dashboardBackupProject = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  seed_id: 'seed-backup-000-4000-8000-000000000000',
  title: '公司上市敲钟那天前夫发现首席法务官是我',
  track: '现言婚恋火葬场',
  status: 'published',
  created_at: '2026-05-28T10:00:00Z',
  updated_at: '2026-06-04T10:00:00Z',
}

const dashboardPendingReview = {
  project_id: '11111111-1111-4111-8111-111111111111',
  title: `复盘流${Date.now()}上市敲钟那天前夫发现首席法务官是我`.slice(0, 25),
  status: 'published',
  stage: '24h',
  published_at: '2026-06-01T12:00:00Z',
  track: '现言婚恋火葬场',
  total_words: 10456,
  data_recorded: false,
  last_review_result: null,
} as const

async function stubDashboardCardData(page: Parameters<typeof test>[0]['page']) {
  await page.route('**/api/dashboard/summary', async (route) => {
    await route.fulfill({
      json: {
        counts: {
          writing: 1,
          ready: 1,
          published: 1,
          archived: 0,
          seeds_total: 2,
          seeds_greenlight: 1,
          seeds_backlog: 1,
        },
        pipeline: [
          { key: 'seed', label: '选题', count: 1, line1: '评分 ≥28：1', line2: '备选池：1', line2_warn: false },
          { key: 'plan', label: '立项', count: 1, line1: '大纲完成：1', line2: '言情向占比：100%', line2_warn: false },
          { key: 'write', label: '写作', count: 1, line1: '字数达标：1 / 1', line2: null, line2_warn: false },
          { key: 'ready', label: '待发', count: 1, line1: '7 项检查全过：1', line2: null, line2_warn: false },
          { key: 'published', label: '已发', count: 1, line1: '本周新发：1', line2: null, line2_warn: false },
          { key: 'archive', label: '归档', count: 0, line1: '累计归档：0', line2: '等待复盘归档', line2_warn: false },
        ],
        health: {
          in_progress: 2,
          in_progress_detail: '立项 1 / 待发 1',
          weekly_published: 1,
          weekly_delta: 0,
          pending_review: 1,
          pending_review_overdue: 0,
          wc_warnings: 0,
          wc_warning_detail: '暂无字数告警',
        },
        llm: {
          configured: true,
          provider: 'openai',
          model: 'gpt-5',
        },
        recent_seeds: [],
        recent_projects: [dashboardMainProject, dashboardBackupProject],
      },
    })
  })
  await page.route('**/api/reviews/pending', async (route) => {
    await route.fulfill({ json: [dashboardPendingReview] })
  })
}

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

test('下一篇发什么：主推荐和备选可跳项目明细', async ({ page }) => {
  await stubDashboardCardData(page)

  await page.goto('/')
  await page.getByTestId('dashboard-next-publish-main').click()
  await page.waitForURL(`/projects/${dashboardMainProject.id}`, { timeout: 15_000 })

  await page.goto('/')
  await page.getByTestId('dashboard-next-publish-backup').click()
  await page.waitForURL(`/projects/${dashboardBackupProject.id}`, { timeout: 15_000 })

  await page.goto('/')
  await page.getByTestId('dashboard-next-publish-reason').click()
  await page.waitForURL(
    new RegExp(`/projects/${dashboardMainProject.id}\\?from=dashboard-next-publish$`),
    { timeout: 15_000 },
  )
})

test('催复盘：看板卡片入口可跳 review 路由', async ({ page }) => {
  await stubDashboardCardData(page)

  await page.goto('/')
  await page.getByTestId('dashboard-review-count-link').click()
  await page.waitForURL('/review', { timeout: 15_000 })

  await page.goto('/')
  await page.getByTestId('dashboard-review-item-0').click()
  await page.waitForURL(
    new RegExp(`/review\\?project_id=${dashboardPendingReview.project_id}&stage=${dashboardPendingReview.stage}$`),
    { timeout: 15_000 },
  )
})

test('本周目标：目标项可跳既有入口', async ({ page }) => {
  await stubDashboardCardData(page)

  await page.goto('/')
  await page.getByTestId('dashboard-week-goal-seeds').click()
  await page.waitForURL('/seeds', { timeout: 15_000 })

  await page.goto('/')
  await page.getByTestId('dashboard-week-goal-projects').click()
  await page.waitForURL('/projects', { timeout: 15_000 })
})

test('小说配图：封面导出可选择 jpeg 并生成对应文件名', async ({ page }) => {
  const projectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const projectTitle = '她签下离婚协议那天全网等他追妻'
  const storyImagePayload = {
    model: 'stub-image-model',
    prompt: '高情绪短篇封面，都市夜景，强对比光影',
    mime_type: 'image/png',
    data_url:
      'data:image/svg+xml;base64,' +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><rect width="100%" height="100%" fill="#0f172a"/></svg>',
      ).toString('base64'),
    title_text: projectTitle,
    cover_size: '1024x1536',
    author_name: '守单客',
    show_author: true,
  }

  await page.route(`**/api/projects/${projectId}`, async (route) => {
    await route.fulfill({
      json: {
        id: projectId,
        seed_id: 'seed-story-image-0000-4000-8000-000000000000',
        title: projectTitle,
        track: '现言婚恋火葬场',
        status: 'writing',
        created_at: '2026-06-01T10:00:00Z',
        updated_at: '2026-06-05T10:00:00Z',
      },
    })
  })
  await page.route(`**/api/projects/${projectId}/chapters`, async (route) => {
    await route.fulfill({ json: [] })
  })
  await page.route(`**/api/projects/${projectId}/artifacts`, async (route) => {
    await route.fulfill({
      json: [
        {
          id: 'artifact-story-image',
          project_id: projectId,
          kind: 'story_image',
          version: 1,
          content: JSON.stringify(storyImagePayload),
          created_at: '2026-06-05T10:00:00Z',
        },
      ],
    })
  })

  await page.goto(`/projects/${projectId}`)
  await expect(page.getByTestId('story_image-card')).toBeVisible()
  await expect(page.getByTestId('cover-export-format')).toHaveValue('png')
  await page.getByTestId('cover-export-format').selectOption('jpeg')
  await expect(page.getByTestId('cover-export-quality')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('download-story-image-btn').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`story-image-${projectId}.jpeg`)
})

test('Dashboard 复盘入口：通过催复盘卡进入真实 /review 页面并可保存复盘', async ({ page }) => {
  const projectId = dashboardPendingReview.project_id
  const savedReview = {
    id: '22222222-2222-4222-8222-222222222222',
    project_id: projectId,
    stage: '24h',
    published_at: '2026-06-01T12:00:00Z',
    data_recorded: true,
    read_count: 1234,
    completion_rate: 0.56,
    engagement_count: 88,
    overall_result: '爆',
    title_result: '标题钩子有效',
    hook_result: '开头留人稳定',
    emotion_result: '情绪节点够密',
    success_reason: '节奏和反转匹配赛道预期',
    failure_reason: '中段传播点不够集中',
    continue_track: '继续追投婚恋火葬场',
    reusable_conclusion: '高压身份反差仍然有效',
    next_action: '下一篇继续做身份反转强钩子',
    created_at: '2026-06-02T12:00:00Z',
    updated_at: '2026-06-02T13:00:00Z',
  }

  let reviewsByProject = [savedReview]
  let receivedSaveBody: Record<string, unknown> | null = null
  let saveCount = 0

  await stubDashboardCardData(page)
  await page.route(`**/api/projects/${projectId}/reviews`, async (route) => {
    await route.fulfill({ json: reviewsByProject })
  })
  await page.route(`**/api/projects/${projectId}/reviews/24h`, async (route) => {
    saveCount += 1
    receivedSaveBody = route.request().postDataJSON() as Record<string, unknown>
    reviewsByProject = [
      {
        ...savedReview,
        ...receivedSaveBody,
        updated_at: '2026-06-02T14:00:00Z',
      },
    ]
    await route.fulfill({ json: reviewsByProject[0] })
  })

  await page.goto('/')
  await page.getByTestId('dashboard-review-item-0').click()
  await page.waitForURL(/\/review\?project_id=.*&stage=24h$/, { timeout: 15_000 })

  await expect(page.getByRole('heading', { name: '复盘', exact: true })).toBeVisible()
  await expect(page.getByTestId('review-pending-list')).toBeVisible()
  await expect(page.getByTestId('review-project-summary')).toContainText(dashboardPendingReview.title)
  await expect(page.getByTestId('review-project-detail-link')).toHaveAttribute(
    'href',
    `/projects/${projectId}`,
  )

  await page.getByTestId('review-read-count').fill('')
  await page.getByTestId('review-completion-rate').fill('')
  await page.getByTestId('review-engagement-count').fill('')
  await page.getByTestId('review-save-btn').click()

  await expect.poll(() => saveCount).toBe(1)
  expect(receivedSaveBody).toMatchObject({
    data_recorded: false,
    read_count: null,
    completion_rate: null,
    engagement_count: null,
  })

  await page.getByTestId('review-read-count').fill('1234')
  await page.getByTestId('review-completion-rate').fill('0.56')
  await page.getByTestId('review-engagement-count').fill('88')
  await page.getByTestId('review-overall-result').selectOption('爆')
  await page.getByTestId('review-title-result').fill('标题钩子有效')
  await page.getByTestId('review-hook-result').fill('开头留人稳定')
  await page.getByTestId('review-emotion-result').fill('情绪节点够密')
  await page.getByTestId('review-success-reason').fill('节奏和反转匹配赛道预期')
  await page.getByTestId('review-failure-reason').fill('中段传播点不够集中')
  await page.getByTestId('review-continue-track').fill('继续追投婚恋火葬场')
  await page.getByTestId('review-reusable-conclusion').fill('高压身份反差仍然有效')
  await page.getByTestId('review-next-action').fill('下一篇继续做身份反转强钩子')
  await page.getByTestId('review-save-btn').click()

  await expect(page.getByText('已保存复盘')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => saveCount).toBe(2)
  await expect(page.getByTestId('review-read-count')).toHaveValue('1234')
  await expect(page.getByTestId('review-overall-result')).toHaveValue('爆')
  await expect.poll(() => receivedSaveBody).not.toBeNull()
  expect(receivedSaveBody).toMatchObject({
    data_recorded: true,
    read_count: 1234,
    completion_rate: 0.56,
    engagement_count: 88,
    overall_result: '爆',
    title_result: '标题钩子有效',
    next_action: '下一篇继续做身份反转强钩子',
  })
})

test('通知铃铛会展示真实通知面板', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('notification-trigger')).toBeVisible()
  await expect(page.getByTestId('notification-trigger')).toContainText('2')

  await page.getByTestId('notification-trigger').click()
  await expect(page.getByTestId('notification-panel')).toBeVisible()
  await expect(page.getByTestId('notification-panel')).toContainText('待复盘项目 2 篇')
  await expect(page.getByTestId('notification-panel')).toContainText('AI 设置未配置完整')
  await expect(page.getByTestId('notifications-read-all')).toBeVisible()
  await expect(page.getByTestId('notifications-clear-resolved')).toBeVisible()
})

test('项目详情复制会输出预览文本而不是 markdown 源码', async ({ page }) => {
  const projectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  await page.route('**/api/projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc', async (route) => {
    await route.fulfill({
      json: {
        id: projectId,
        seed_id: 'seed-copy-0000-4000-8000-000000000000',
        title: '复制测试项目',
        track: '现言婚恋火葬场',
        status: 'ready',
        created_at: '2026-06-08T10:00:00Z',
        updated_at: '2026-06-08T10:00:00Z',
      },
    })
  })
  await page.route('**/api/projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc/artifacts', async (route) => {
    await route.fulfill({
      json: [
        {
          id: 'artifact-copy-1',
          project_id: projectId,
          kind: 'publish_post',
          version: 1,
          content: '# 第一章\n\n这是正文。\n\n---\n\n**第二段**继续。',
          created_at: '2026-06-08T10:00:00Z',
        },
      ],
    })
  })
  await page.route('**/api/projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc/chapters', async (route) => {
    await route.fulfill({ json: [] })
  })

  await page.addInitScript(() => {
    ;(window as Window & { __copiedText?: string }).__copiedText = ''
    Object.assign(navigator, {
      clipboard: {
        writeText: async (text: string) => {
          ;(window as Window & { __copiedText?: string }).__copiedText = text
        },
      },
    })
  })

  await page.goto(`/projects/${projectId}`)
  await page.getByTestId('copy-publish_post-btn').click()

  const copied = await page.evaluate(() => (window as Window & { __copiedText?: string }).__copiedText)
  expect(copied).toContain('第一章')
  expect(copied).toContain('这是正文。')
  expect(copied).toContain('第二段继续。')
  expect(copied).not.toContain('# ')
  expect(copied).not.toContain('---')
  expect(copied).not.toContain('**')
})
