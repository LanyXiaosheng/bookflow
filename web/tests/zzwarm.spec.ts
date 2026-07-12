import { test } from '@playwright/test'
test('warm', async ({ page }) => {
  const routes = ['/', '/seeds', '/projects', '/ready', '/published', '/archived', '/review', '/account-review', '/tracks', '/playbook', '/settings', '/auth', '/projects/cccccccc-cccc-4ccc-8ccc-cccccccccccc']
  for (const r of routes) { await page.goto(r, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(300) }
})
