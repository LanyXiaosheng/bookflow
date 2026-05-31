# bookflow

番茄短篇生产平台 v0.2 真实产品（替代 bookflow-prototype 的静态演示）。

栈：
- api: Rust 1.95 + Axum 0.7 + SQLx + Postgres 16
- web: React 19 + Vite 5 + TypeScript + Tailwind 3 + TanStack Query

## 起手

```bash
# 1. 起 db
docker compose up -d

# 2. 跑后端
cd api
cp ../.env.example ../.env  # 第一次
cargo run -p bookflow-app

# 3. 跑前端
cd web
pnpm install
pnpm dev
```

后端 :3000，前端 :5174（Vite proxy /api → :3000）。

## 子目录

| 路径 | 说明 |
|---|---|
| `api/crates/app` | Axum router + main 入口 |
| `api/crates/domain` | 业务实体、错误、tier 计算 |
| `api/crates/storage` | SQLx 仓储 |
| `api/migrations` | sqlx migrate add 输出 |
| `web/src/pages` | 路由页（Dashboard / Seed / Write） |
| `web/src/api` | TanStack Query hooks + axios client |
