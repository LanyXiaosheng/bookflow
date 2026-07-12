import { test } from '@playwright/test'

async function tryCase(browser: import('@playwright/test').Browser, opts: { grant?: boolean }) {
  const ctx = await browser.newContext()
  if (opts.grant) {
    try { await ctx.grantPermissions(['local-network-access']) } catch (e) { console.log('grant err', String(e).slice(0, 80)) }
  }
  const page = await ctx.newPage()
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: { user: { id: 'u', email: 'e@e.com', display_name: '守单客', created_at: '2026-06-06T10:00:00Z' } } }))
  await page.route('**/api/notifications**', (r) => r.fulfill({ json: { unread_count: 2, items: [] } }))
  await page.route('**/api/dashboard/summary', (r) => r.fulfill({ status: 404, json: {} }))
  await page.route('**/api/reviews/pending', (r) => r.fulfill({ json: [] }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  const rootLen = await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? -1)
  await ctx.close()
  return rootLen
}

test('matrix', async ({ browser }) => {
  console.log('grant=false ->', await tryCase(browser, { grant: false }))
  console.log('grant=true  ->', await tryCase(browser, { grant: true }))
})
