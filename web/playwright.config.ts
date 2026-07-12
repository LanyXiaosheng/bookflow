import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 5174)

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Chromium 148 起默认开启 Local Network Access 检查：开启 page.route 拦截后，
    // 对 127.0.0.1 的模块请求会被 LNA 拦截（本机存在系统级 HTTP 代理时尤甚），
    // 返回 JSON 错误页 → "MIME type application/json" → 整页白屏、所有 testid 找不到。
    // 关掉该检查让本地 dev server 的模块正常加载。
    launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
  },
  webServer: [
    {
      // 前端：Vite dev，proxy /api -> :3000
      command: 'pnpm dev --strictPort',
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // 后端：cargo run，监听 :3000，依赖外部已起的 docker postgres :5433
      command: 'cargo run -p bookflow-app',
      cwd: '..',
      url: 'http://localhost:3000/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        DATABASE_URL: 'postgres://bookflow:bookflow@localhost:5433/bookflow_dev',
        APP_PORT: '3000',
      },
    },
  ],
})
