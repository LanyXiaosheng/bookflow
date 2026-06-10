# Bookflow

`Bookflow` 是一个番茄短篇生产平台，包含：

- 选题评分与 AI 试评
- 从 seed 立项到项目写作
- README / 角色设定 / 大纲 / 发布稿 / 全书汇总 / 全书优化
- 登录、用户隔离、复盘、通知、演示数据库 bootstrap

技术栈：

- API: Rust 1.95 + Axum 0.7 + SQLx + Postgres 16
- Web: React 19 + Vite + TypeScript + Tailwind + TanStack Query
- DB: Docker Compose + Postgres 16

## 5 分钟快速启动

前置条件：

- Docker / Docker Compose
- Rust toolchain
- Node.js 20+
- pnpm

从仓库根进入 `bookflow` 后执行：

```bash
cd bookflow
cp .env.example .env
bash scripts/bootstrap-demo.sh
cd web
pnpm install
pnpm dev
```

启动完成后：

- 前端：`http://127.0.0.1:5174`
- 后端：`http://127.0.0.1:3000`
- 健康检查：`http://127.0.0.1:3000/healthz`

默认演示账号：

- 邮箱：`demo@bookflow.local`
- 密码：`Demo123456`

`bootstrap-demo.sh` 会自动：

- 启动 Docker Postgres
- 初始化 `pgcrypto`
- 执行全部 SQLx migrations
- 写入全量演示账号、项目、章节、产物、复盘、通知、草稿数据

## 本地开发

### 方式 1：手动启动

```bash
cd bookflow
cp .env.example .env
docker compose up -d
cargo run -p bookflow-app
cd web
pnpm install
pnpm dev
```

### 方式 2：一键开发

```bash
cd bookflow
cp .env.example .env
./dev.sh
```

停止：

```bash
./dev.sh stop
```

查看日志：

```bash
./dev.sh logs
```

## 常用操作

### 重置演示数据

```bash
cd bookflow
bash scripts/reseed-demo.sh
```

适用场景：

- 演示数据被改乱
- 需要恢复成默认样板状态
- 需要让别人重复演示同一套流程

### 只补 demo 数据

```bash
cd bookflow
bash scripts/seed-demo.sh
```

### 只跑数据库迁移

```bash
cd bookflow
DATABASE_URL=postgres://bookflow:bookflow@localhost:5433/bookflow_dev \
  cargo run -p bookflow-app --bin migrate_db
```

### 生成 demo 密码 hash

```bash
cd bookflow
cargo run -p bookflow-app --bin hash_password -- 'Demo123456'
```

## 配置说明

核心环境变量见 [`.env.example`](./.env.example)：

- `DATABASE_URL`
  - 后端和迁移使用的数据库连接串
- `APP_PORT`
  - API 默认端口，默认 `3000`
- `AI_PROVIDER`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`
- `AI_IMAGE_MODEL`
- `AI_TIMEOUT_SECS`
  - AI 请求配置；不接真实模型时也能用 demo 数据打开系统
- `DEMO_EMAIL`
- `DEMO_PASSWORD`
- `DEMO_DISPLAY_NAME`
  - `bootstrap-demo.sh` / `seed-demo.sh` / `reseed-demo.sh` 使用的演示账号

## 验证

推荐至少跑这几项：

```bash
cd bookflow
cargo test --workspace
bash scripts/bootstrap-demo.sh
```

如果你要确认 demo 数据已经入库，可以执行：

```bash
docker compose exec -T postgres psql -U bookflow -d bookflow_dev -c \
  "SELECT COUNT(*) FROM users;"
```

## 常见问题

### 1. `DATABASE_URL 未设置`

先复制环境文件：

```bash
cp .env.example .env
```

### 2. Docker 库起不来

看容器状态：

```bash
docker compose ps
docker compose logs postgres
```

### 3. 前端启动了但接口 500

优先检查：

- `http://127.0.0.1:3000/healthz`
- `.env` 里的 `DATABASE_URL`
- migrations 是否执行成功

### 4. AI 功能不可用

demo 数据和大多数页面可直接打开，但真正调用模型前需要把 `.env` 里的 `AI_*` 配成有效值。

## 目录结构

| 路径 | 说明 |
|---|---|
| `api/crates/app` | Axum 路由、AI 接口、认证、启动入口 |
| `api/crates/domain` | 领域模型、状态机、错误类型 |
| `api/crates/storage` | SQLx 仓储与 migrations 调用 |
| `api/migrations` | 数据库 DDL 与演进脚本 |
| `db/demo-seed.sql` | 外部部署演示数据 |
| `docker-compose.yml` | 本地 Postgres |
| `docker/postgres/initdb` | Postgres 首次初始化扩展 |
| `scripts` | bootstrap / seed / reseed / 开发辅助脚本 |
| `web/src/pages` | 页面层：Dashboard / Seeds / Project / Write / Review / Settings / Auth |
| `web/src/api` | 前端 API 封装 |
| `web/src/components` | UI 组件 |
| `web/tests` | Playwright 用例 |

## 当前演示数据覆盖

默认 demo 库会带：

- 1 个演示用户
- 6 条 seeds
- 4 个 projects
- 7 个 chapters
- 16 条 project artifacts
- 4 条 reviews
- 4 条 notifications
- 2 条 AI seed drafts

所以启动后，`Dashboard`、`Seeds`、`ProjectDetail`、`Write`、`Review`、通知面板都可以直接看真实内容。
