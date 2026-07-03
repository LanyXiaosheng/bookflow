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

## 给别人部署的演示库

```bash
cd bookflow
cp .env.example .env
bash scripts/bootstrap-demo.sh
```

这条链路会：

- 启动 Docker Postgres
- 初始化 `pgcrypto`
- 执行 `api/migrations/*.sql`
- 写入全量演示数据

默认演示账号：

- 邮箱：`demo@bookflow.local`
- 密码：`Demo123456`

可在 `.env` 覆盖：

- `DEMO_EMAIL`
- `DEMO_PASSWORD`
- `DEMO_DISPLAY_NAME`

如果需要把演示环境重置回样板状态：

```bash
bash scripts/reseed-demo.sh
```

只想单独补演示数据：

```bash
bash scripts/seed-demo.sh
```

只想单独跑数据库迁移：

```bash
DATABASE_URL=postgres://bookflow:bookflow@localhost:5433/bookflow_dev \
  cargo run -p bookflow-app --bin migrate_db
```

## 子目录

| 路径 | 说明 |
|---|---|
| `api/crates/app` | Axum router + main 入口 |
| `api/crates/domain` | 业务实体、错误、tier 计算 |
| `api/crates/storage` | SQLx 仓储 |
| `api/migrations` | sqlx migrate add 输出 |
| `db/demo-seed.sql` | 外部部署演示数据 |
| `scripts` | demo bootstrap / seed / reseed 脚本 |
| `web/src/pages` | 路由页（Dashboard / Seed / Write） |
| `web/src/api` | TanStack Query hooks + axios client |
