# PROJECT_MAP · bookflow
> 单一真相源。新会话/换工具先读我，别重新 explore。改了路由/schema/字段名就更新。

## 启动
- 一键: `./dev.sh {start|stop|restart|logs}`（起 postgres + api + web，PID 存 `.dev/`；需先有 `.env` 含 DATABASE_URL/AI_*）
- 后端(Rust axum): `cargo build -p bookflow-app` 后运行 @ http://localhost:3000（`APP_PORT`，⚠️不是 8080）· 健康: `GET /healthz`
- 前端(Vite): `pnpm dev` @ http://127.0.0.1:5174（proxy `/api`→:3000）
- DB: `docker compose up -d`（postgres:16-alpine，宿主 **5433**→5432，db `bookflow_dev`，user/pass bookflow/bookflow）
- 迁移: `api/migrations/*.sql`（sqlx，21 个）；demo 数据 `db/demo-seed.sql` + `scripts/*-demo.sh`
- 根目录无 smoke.sh（验收用 verify-delivery skill 现场跑）

## 目录树
```
.
.claude
.codegraph
.idea
.sqlx
api
api/crates
api/crates/app
api/crates/domain
api/crates/storage
api/migrations
bookflow
db
docker
docker/postgres
docker/postgres/initdb
ocr_pending
scripts
web
web/public
web/src
web/src/api
web/src/components
web/src/hooks
web/src/lib
web/src/pages
web/test-results
web/test-results/e2e-通知铃铛会展示真实通知面板
web/test-results/e2e-项目详情复制会输出预览文本而不是-markdown-源码
web/tests
```

## 后端路由表
| method | path | 位置 |
|--------|------|------|
| POST | /api/auth/login | api/crates/app/src/main.rs:171 |
| POST | /api/auth/logout | api/crates/app/src/main.rs:174 |
| GET | /api/auth/me | api/crates/app/src/main.rs:172 |
| PUT | /api/auth/profile | api/crates/app/src/main.rs:173 |
| POST | /api/auth/register | api/crates/app/src/main.rs:170 |
| PUT | /api/chapters/:id | api/crates/app/src/main.rs:264 |
| POST | /api/chapters/:id/ai-beats | api/crates/app/src/main.rs:265 |
| POST | /api/chapters/:id/ai-qa | api/crates/app/src/main.rs:275 |
| POST | /api/chapters/:id/ai-write | api/crates/app/src/main.rs:266 |
| GET | /api/dashboard/summary | api/crates/app/src/main.rs:276 |
| POST | /api/fanqie/fetch-all | api/crates/app/src/main.rs:194 |
| POST | /api/fanqie/fetch-from-curl | api/crates/app/src/main.rs:195 |
| GET | /api/notifications | api/crates/app/src/main.rs:278 |
| POST | /api/notifications/:id/read | api/crates/app/src/main.rs:279 |
| POST | /api/notifications/clear-resolved | api/crates/app/src/main.rs:281 |
| POST | /api/notifications/read-all | api/crates/app/src/main.rs:280 |
| GET | /api/playbook | api/crates/app/src/main.rs:284 |
| GET | /api/playbook/:slug | api/crates/app/src/main.rs:285 |
| POST | /api/projects | api/crates/app/src/main.rs:180 |
| GET | /api/projects/:id | api/crates/app/src/main.rs:181 |
| POST | /api/projects/:id/ai-publish-qa | api/crates/app/src/main.rs:235 |
| POST | /api/projects/:id/ai-readme/stream | api/crates/app/src/main.rs:197 |
| POST | /api/projects/:id/ai-story-image | api/crates/app/src/main.rs:234 |
| GET | /api/projects/:id/artifacts | api/crates/app/src/main.rs:196 |
| GET | /api/projects/:id/reviews | api/crates/app/src/main.rs:185 |
| POST | /api/projects/:id/transition | api/crates/app/src/main.rs:182 |
| GET | /api/reviews/pending | api/crates/app/src/main.rs:183 |
| POST | /api/reviews/quick-batch | api/crates/app/src/main.rs:184 |
| POST | /api/seeds | api/crates/app/src/main.rs:162 |
| DELETE | /api/seeds/:id | api/crates/app/src/main.rs:163 |
| POST | /api/seeds/ai-backfill-heat | api/crates/app/src/main.rs:167 |
| GET | /api/seeds/ai-drafts | api/crates/app/src/main.rs:168 |
| POST | /api/seeds/ai-generate | api/crates/app/src/main.rs:165 |
| POST | /api/seeds/ai-launch | api/crates/app/src/main.rs:169 |
| POST | /api/seeds/ai-recommend-track | api/crates/app/src/main.rs:166 |
| POST | /api/seeds/ai-score | api/crates/app/src/main.rs:164 |
| GET | /api/settings | api/crates/app/src/main.rs:277 |
| GET | /api/tracks | api/crates/app/src/main.rs:282 |
| GET | /api/tracks/:slug | api/crates/app/src/main.rs:283 |
| GET | /api/users/me/fanqie-stats | api/crates/app/src/main.rs:179 |
| GET | /healthz | api/crates/app/src/main.rs:161 |

## DB schema（表 · 关键列）
```sql
seeds (
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;
project_reviews (
ALTER TABLE users ADD COLUMN IF NOT EXISTS strategy JSONB NOT NULL DEFAULT '{}'::jsonb;
fanqie_stats (
ai_seed_drafts (
    ADD COLUMN IF NOT EXISTS image_model TEXT NOT NULL DEFAULT 'gpt-image-2';
project_artifacts (
notifications (
app_settings (
    ADD COLUMN IF NOT EXISTS recommend_reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS heat TEXT NOT NULL DEFAULT '';
    ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE;
    ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE;
    ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
projects (
chapters (
users (
user_sessions (
ALTER TABLE projects ADD COLUMN IF NOT EXISTS author TEXT NULL;
ALTER TABLE seeds ADD COLUMN score JSONB;
```
_列清单从 migration 抽样，完整定义见:_ ./docker/postgres/initdb/00-extensions.sql ./db/demo-seed.sql ./api/migrations/20260606161000_reassign_legacy_data_to_preexisting_user.sql 

## 前后端字段对照（防漂移·手工维护）
> 全链路命名约定：后端 DTO 无 rename_all，**前后端全是 snake_case**（不做 camelCase 转换）。枚举值另有专门 rename（见下）。

| 概念 | 后端字段/值 | DB 列 | 前端字段 | 备注 |
|------|---------|-------|---------|------|
| Seed 评分 | `score: serde_json::Value` (domain/src/lib.rs:62-114) | `seeds.score` JSONB | `AnyScore = Score \| LegacyScore` (web/src/api/seeds.ts:6-98) | ⚠️新版 4 维 `title_ctr/conflict/tagfit/novelty`(1-10,满分40)，旧版 7 维(1-5)；靠「是否含 title_ctr」判新旧 |
| Seed 段位 | `Tier` snake_case → `greenlight/backlog/reject` (domain:28-57) | `seeds.tier` TEXT CHECK | `type Tier` 同 3 值 | ⚠️阈值两处版本不一致：后端 V2 ≥30/≥22（domain:37），前端另有 ≥32/≥26（seeds.ts:42-53） |
| 项目状态 | `ProjectStatus` → `writing/ready/published/archived` (domain:153-160) | `projects.status` CHECK | 同 4 值 (projects.ts:3) | 单向状态机，不可回退/跨级 |
| 项目列表项 | `ProjectListItem` 用 `#[serde(flatten)]` 摊平 (domain:215-221) | 聚合无列 | `extends Project` 平铺 (projects.ts:15-18) | 后端嵌套、线上平铺 |
| 章节序号 | `idx: i16` (domain:438) | `chapters.idx` SMALLINT，UNIQUE(project_id,idx)，从 1 起 | `idx: number` (chapters.ts:13) | ⚠️叫 `idx`，不是 index/order |
| 章节 beats | `Beat.note` 有 `#[serde(default)]` (domain:426-444) | `chapters.beats` JSONB | `note?: string` (chapters.ts:4-8) | 后端默认空串、前端 optional |
| 复盘阶段 | `ReviewStage` 自定义 rename → `24h/72h/7d` (domain:223-231) | `project_reviews.stage` CHECK | 同 3 值 (reviews.ts:4) | 值不是 snake_case |
| 复盘结果 | `ReviewResult` rename 成中文 `爆/平/扑` (domain:252-260) | `overall_result` CHECK('爆','平','扑') | 同 (reviews.ts:5) | 枚举值是中文 |
| 复盘四数据列 | `show_count/comment_count/like_count/library_count` (domain:292-294, storage:1487…) | ⚠️**迁移里不存在这 4 列** | 同 4 字段 (reviews.ts:28-31) | 🔥新建库会炸，迁移 20260629 注释自认「部分库手工建好」 |
| 番茄数据 | `FanqieStat` | `fanqie_stats.digg_count/shelf_count/click_rate…` | 同名 (account.ts:39-55) | 与 project_reviews 的 like/library 命名不统一 |
| 账号策略 | `users.strategy` JSONB 透传 | `users.strategy` DEFAULT '{}' | `AccountStrategy {[k]:unknown}` (account.ts:27-36) | 松散结构，AI 复盘写入 |
| 用户 | `User` 不含 password_hash (domain:5-11) | `users.password_hash` 有列不外泄 | 无 password (auth.ts:3-8) | |

## 业务约定
- 认证: Cookie-session（非 JWT）。Cookie `bookflow_session` = 随机 UUIDv4，HttpOnly/SameSite=Lax；服务端存 `user_sessions(token,user_id,expires_at)`。remember_me(默认 true)=14 天，否则 1 天。密码 Argon2。(app/src/main.rs:2291-2293, 2522-2597)
- 鉴权: **无全局 middleware**，逐 handler 手动 `require_user(&s,&headers)` (main.rs:2667-2711)；隔离靠查询里的 `user_id` 过滤。**无 RBAC/角色**。
- 业务流转: seed（选题+评分）→ project（`projects.seed_id REFERENCES seeds ON DELETE RESTRICT`，一 seed 可多 project）→ chapters（CASCADE，UNIQUE(project_id,idx)）。AI 一键立项 `seedsApi.aiLaunch` (seeds.ts:183-191)。
- 番茄集成: 番茄小说=发布平台。用户贴 Cookie/curl → `POST /api/fanqie/fetch-all|fetch-from-curl` 抓运营数据 → 按标题匹配写入 `project_reviews`（项目级）与 `fanqie_stats`（账号级）。后端 subprocess 调 `scripts/fanqie_crawler.py`。(main.rs:194-195,713,829-942)

## 固定审美约束（前端必守）
- 现状: **手写组件 + Tailwind**（非 shadcn，无 Radix/cva/clsx），图标 lucide-react
- 字体 token: `fontFamily.sans` 苹方系；`fontFamily.manuscript`（稿件正文）PingFang/Songti/思源宋体（web/tailwind.config.js）
- 颜色: 无自定义主题色，用 Tailwind 默认调色板；全局背景 `#f9fafb`(gray-50)（web/src/index.css）
- 风格: 简约、明亮
- 禁令: 🚫 任何渐变色（尤其渐变紫）  🚫 emoji 开发  🚫 黑暗科技风
