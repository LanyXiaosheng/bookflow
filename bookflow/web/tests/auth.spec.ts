import { expect, test } from '@playwright/test'

test('未登录访问业务页会提示登录并保留返回地址', async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 404, json: { error: 'session not_found' } })
  })

  await page.goto('/projects')
  await expect(page.getByTestId('login-required')).toBeVisible()
  await expect(page.getByTestId('login-required')).toContainText('需要登录')

  const loginLink = page.getByTestId('login-required-login')
  await expect(loginLink).toHaveAttribute('href', '/auth?redirect=%2Fprojects')
})

test('登录成功后回到 redirect 指定页面', async ({ page }) => {
  let loginCalled = false
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 404, json: { error: 'session not_found' } })
  })
  await page.route('**/api/auth/login', async (route) => {
    loginCalled = true
    await route.fulfill({
      json: {
        user: {
          id: 'user-1',
          email: 'writer@example.com',
          display_name: '守单客',
          created_at: '2026-06-06T10:00:00Z',
        },
      },
    })
  })
  await page.route('**/api/projects', async (route) => {
    await route.fulfill({ json: [] })
  })

  await page.goto('/auth?redirect=%2Fprojects')
  await page.locator('input[type="email"]').fill('writer@example.com')
  await page.locator('input[type="password"]').fill('123456')
  await page.getByRole('button', { name: '登录账号' }).click()

  await expect.poll(() => loginCalled).toBe(true)
  await page.waitForURL('/projects')
})

test('用户菜单通过下拉修改昵称和退出', async ({ page }) => {
  let loggedIn = true
  await page.route('**/api/auth/me', async (route) => {
    if (!loggedIn) {
      await route.fulfill({ status: 404, json: { error: 'session not_found' } })
      return
    }
    await route.fulfill({
      json: {
        user: {
          id: 'user-1',
          email: 'writer@example.com',
          display_name: '守单客',
          created_at: '2026-06-06T10:00:00Z',
        },
      },
    })
  })
  await page.route('**/api/auth/logout', async (route) => {
    loggedIn = false
    await route.fulfill({ status: 204 })
  })

  await page.goto('/')
  await expect(page.getByTestId('user-menu-trigger')).toBeVisible()
  await expect(page.getByTestId('user-menu')).toBeHidden()

  await page.getByTestId('user-menu-trigger').click()
  await expect(page.getByTestId('user-menu')).toBeVisible()
  await expect(page.getByTestId('user-menu-rename')).toBeVisible()
  await page.getByTestId('user-menu-logout').click()

  await expect(page.getByText('登录 / 注册')).toBeVisible()
  await expect(page.getByTestId('user-menu-trigger')).toBeHidden()
})

test('已发页同时展示已发和归档项目', async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      json: {
        user: {
          id: 'user-1',
          email: 'writer@example.com',
          display_name: '守单客',
          created_at: '2026-06-06T10:00:00Z',
        },
      },
    })
  })
  await page.route('**/api/projects/*/chapters', async (route) => {
    await route.fulfill({ json: [] })
  })

  const requestedUrls: string[] = []
  await page.route('**/api/projects?*', async (route) => {
    requestedUrls.push(route.request().url())
    const url = new URL(route.request().url())
    const status = url.searchParams.get('status')
    await route.fulfill({
      json: [
        {
          id: `${status}-project`,
          seed_id: `${status}-seed`,
          title: status === 'archived' ? '归档项目' : '已发项目',
          track: '现言婚恋火葬场',
          status,
          created_at: '2026-06-06T10:00:00Z',
          updated_at: '2026-06-06T10:00:00Z',
        },
      ],
    })
  })

  await page.goto('/published')
  await expect(page.getByText('已发项目')).toBeVisible()
  await expect(page.getByText('归档项目')).toBeVisible()
  expect(requestedUrls.some((url) => url.includes('status=archived'))).toBe(true)
  expect(requestedUrls.some((url) => url.includes('status=published'))).toBe(true)
})
