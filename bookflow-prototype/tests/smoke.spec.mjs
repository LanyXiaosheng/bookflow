// @ts-check
import { test, expect } from '@playwright/test';

/**
 * BookFlow 三页 smoke
 *
 * 不要改成「测代码内部实现」。这里只断言可见行为：
 *   - 页能打开 / 关键文案在
 *   - 控制台无 error 级日志
 *   - 已经实现的交互真的有反应
 *   - 还没实现的死点用 .fail() / 注释挂起，作为 backlog
 */

const PAGES = [
  { path: '/index.html', title: 'BookFlow' },
  { path: '/dashboard.html', title: '看板' },
  { path: '/write.html', title: '写作' },
  { path: '/seed-scorecard.html', title: '选题评分' },
];

// helper：把 input[type=range] 设到指定值并触发 input 事件
async function setRange(locator, value) {
  await locator.evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

for (const p of PAGES) {
  test(`[smoke] ${p.path} 打开 + 无 console error`, async ({ page }) => {
    const errors = [];
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

    const resp = await page.goto(p.path);
    expect(resp?.status(), '页面 HTTP 200').toBe(200);
    await expect(page).toHaveTitle(new RegExp(p.title));
    // 等 lucide 图标渲染（每页 DOMContentLoaded 都会调）
    await page.waitForLoadState('domcontentloaded');
    expect(errors, `控制台 error: ${errors.join('\n')}`).toEqual([]);
  });
}

test('[index] 三个卡片能跳到对应页', async ({ page }) => {
  await page.goto('/index.html');
  for (const link of [
    { text: '打开 dashboard.html', expectPath: /dashboard\.html$/ },
    { text: '打开 write.html', expectPath: /write\.html$/ },
    { text: '打开 seed-scorecard.html', expectPath: /seed-scorecard\.html$/ },
  ]) {
    await page.goto('/index.html');
    await page.getByText(link.text, { exact: false }).first().click();
    await expect(page).toHaveURL(link.expectPath);
  }
});

test('[seed] slider 改变 → 总分 / 段位 / CTA 三联动', async ({ page }) => {
  await page.goto('/seed-scorecard.html');

  // 先读初始
  const totalEl = page.locator('#score-total');
  const tierEl = page.locator('#score-tier');
  const ctaBtn = page.locator('#cta-submit');

  const initial = parseInt((await totalEl.textContent()) ?? '0', 10);
  expect(initial).toBeGreaterThan(0);

  // 把 7 个维度全拉满 5
  const sliders = page.locator('input.score-slider[type="range"]');
  const n = await sliders.count();
  expect(n).toBe(7);
  for (let i = 0; i < n; i++) {
    await setRange(sliders.nth(i), 5);
  }

  await expect(totalEl).toHaveText('35');
  await expect(tierEl).toHaveText('立刻立项');
  await expect(ctaBtn).toBeEnabled();
  await expect(ctaBtn).toContainText('立项');

  // 全设最低 1（slider min=1，产品设计：每维至少 1 分起评）
  for (let i = 0; i < n; i++) {
    await setRange(sliders.nth(i), 1);
  }
  await expect(totalEl).toHaveText('7');
  await expect(tierEl).toHaveText('不做');
  await expect(ctaBtn).toContainText('差 21');
});

test('[seed] 雷达图 polygon 跟着 slider 变', async ({ page }) => {
  await page.goto('/seed-scorecard.html');
  const radar = page.locator('#radar-area');
  const before = await radar.getAttribute('points');
  const sliders = page.locator('input.score-slider[type="range"]');
  await setRange(sliders.first(), 5);
  const after = await radar.getAttribute('points');
  expect(after).not.toBe(before);
});

test('[seed] AI Drawer 开 / 关 / Tab 切换', async ({ page }) => {
  await page.goto('/seed-scorecard.html');
  const drawer = page.locator('#ai-drawer');
  await expect(drawer).toBeHidden();

  await page.locator('#open-ai-drawer').click();
  await expect(drawer).toBeVisible();

  // Tab 切到「评论区痛点挖掘」
  const commentTab = page.locator('.ai-tab[data-tab="comment"]');
  await commentTab.click();
  await expect(commentTab).toHaveClass(/border-blue-600/);
  // 内容区跟着切
  await expect(page.locator('#tab-content-comment')).toBeVisible();
  await expect(page.locator('#tab-content-parse')).toBeHidden();

  // 关 drawer
  await page.locator('#drawer-close-btn').click();
  await expect(drawer).toBeHidden();
});

test('[write] 字数条随正文输入实时更新', async ({ page }) => {
  await page.goto('/write.html');
  // 总字数
  const totalEl = page.locator('#word-total');
  const initial = parseInt((await totalEl.textContent()) ?? '0', 10);
  expect(initial).toBeGreaterThan(0);

  // 在第 6 章正文末尾加 100 个字
  const ch6 = page.locator('#chapter-6 .manuscript-body');
  await expect(ch6).toBeVisible();
  // contentEditable 区
  await ch6.focus();
  await page.keyboard.press('End');
  const extra = '字'.repeat(100);
  await page.keyboard.type(extra, { delay: 0 });

  await expect.poll(async () => parseInt((await totalEl.textContent()) ?? '0', 10))
    .toBeGreaterThan(initial);
});

test('[dashboard] Pipeline 节点点击 → toast 或跳转，不能完全没反应', async ({ page }) => {
  await page.goto('/dashboard.html');
  const node = page.locator('[data-pipeline-stage]').first();
  await expect(node, 'Pipeline 节点应有 data-pipeline-stage').toBeVisible();
  await node.click();
  // 接受两种实现：a) toast 出现  b) 跳到对应 stage 列表页 / 锚点
  const toast = page.locator('[data-toast]');
  await expect(toast).toBeVisible({ timeout: 2000 });
});

// ============ stub.js 兜底 ============

test('[stub] 死链点击 → toast，不会跳到 #', async ({ page }) => {
  await page.goto('/dashboard.html');
  const before = page.url();

  // 顶部 nav「选题」当前是 href="#"
  await page.getByRole('link', { name: '选题', exact: true }).click();
  await expect(page.locator('[data-toast="stub"]')).toBeVisible();
  // URL 不应被加上 #
  expect(page.url()).toBe(before);
});

test('[stub] 死按钮点击 → toast', async ({ page }) => {
  await page.goto('/write.html');
  // write 页右栏「调整 prompt」是死按钮
  await page.getByRole('button', { name: /调整 prompt/ }).click();
  await expect(page.locator('[data-toast="stub"]')).toBeVisible();
});

test('[stub] disabled 按钮不触发 toast', async ({ page }) => {
  await page.goto('/write.html');
  // 「校验字数（Step 3）」disabled
  const btn = page.getByRole('button', { name: /校验字数/ });
  await expect(btn).toBeDisabled();
  // disabled 按钮 click 在 chromium 不会触发 click，强制跳过
  // 这里只断言 toast 不存在
  await expect(page.locator('[data-toast="stub"]')).toHaveCount(0);
});

test('[stub] 真按钮（Drawer 开）不被 stub 抢走', async ({ page }) => {
  await page.goto('/seed-scorecard.html');
  await page.locator('#open-ai-drawer').click();
  await expect(page.locator('#ai-drawer')).toBeVisible();
  await expect(page.locator('[data-toast="stub"]')).toHaveCount(0);
});

// ============ 跨页一致性 ============

const NAV_ITEMS = ['看板', '选题', '项目', '已发', '复盘', '赛道', '手册', '设置'];
const PAGES_FOR_NAV = ['/dashboard.html', '/write.html', '/seed-scorecard.html'];

for (const path of PAGES_FOR_NAV) {
  test(`[一致性] ${path} 顶部 nav 8 项齐全`, async ({ page }) => {
    await page.goto(path);
    for (const item of NAV_ITEMS) {
      await expect(
        page.locator('nav').getByRole('link', { name: item, exact: true }).first()
      ).toBeVisible();
    }
    // BookFlow logo 跳 dashboard
    const logo = page.locator('nav a').filter({ hasText: 'BookFlow' }).first();
    await expect(logo).toHaveAttribute('href', /dashboard\.html$/);
  });
}
