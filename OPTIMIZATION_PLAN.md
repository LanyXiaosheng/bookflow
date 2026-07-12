# bookflow · 深度分析与优化路线图

> 生成于 2026-07-04，由 5 路独立分析（后端逐行 / 前端 / 数据库迁移 / 工程基建 / 事实地图）合成。
> 所有 finding 均附 `文件:行号` 证据；clippy/tsc/eslint 数字为本次实测。
> 执行进度不要写回本文件（本文件只记问题与方案）；事实地图见 `PROJECT_MAP.md`。

## 总体结论

项目底子**中上**：后端三层分离清晰、SQL 全参数绑定无注入、密码 Argon2、越权校验逐 handler 核实全覆盖；前端 0 `any`、0 console.log、react-query 使用规范。但存在 **5 个 P0 级事故点**和一条贯穿性病根——**「真相分裂」**：schema 真相分裂在迁移/运行时 DDL/手工 ALTER 三处，SSE 解析复制 5 处已漂移，pipeline 三套并存，tier 阈值前后端两个版本。大优化的主线就是**收敛真相到单一来源**。

---

## P0 · 事故点（立刻修，全是小 diff）

| # | 问题 | 证据 | 失败场景 |
|---|------|------|---------|
| 1 | `/api/settings` GET/PUT **无认证** | api/crates/app/src/main.rs:1995, 2010 | 未登录攻击者 PUT 覆盖全局 AI key/base_url，劫持所有用户的 AI 调用到自己网关；GET 泄露 provider/掩码 key |
| 2 | `ai_score_seed` 无认证 | main.rs:379 | 未登录可无限烧 AI 额度（同文件其他 seed handler 都有 require_user） |
| 3 | `project_reviews` 4 列（show/comment/like/library_count）**任何迁移都没建** | storage/src/lib.rs:1487,1534,1553-1556 vs migrations/20260606100000 | 纯迁移新建库 → 复盘页/番茄回填 500 `column does not exist`；现网能跑只因手工 ALTER 过 |
| 4 | Dockerfile 吞前端构建失败 | Dockerfile（`RUN npm run build; mkdir -p /app/dist` 分号非 &&） | 当前 tsc 有 1 个错（web/src/pages/ProjectDetail.tsx:756 TS2366）→ build 必失败 → 镜像照样成功 → 上线白屏 |
| 5 | git 历史含 **590MB 付费小说 TXT** | 初始提交 0cbc009 加入、d7ad937 删除，.git size-pack 255MB | 版权风险 + 克隆/CI 拖 256MB；修复需 `git filter-repo` 重写历史（**不可逆，需拍板**） |

顺手项（同批修）：
- 渐变紫 3 处违反红线：web/src/components/BatchLaunchPanel.tsx:46、web/src/pages/Seeds.tsx:362,571
- 多米 key 热更新失效：main.rs:2043-2046 改的是请求级 AppState 克隆（AppState.duomi 非 Arc，main.rs:72），换 key 后 duomi 生图/视频继续用旧 key 直到重启；应从 `s.ai.snapshot()` 取 key 构造
- settings.rs:130-147 运行时 `ALTER TABLE ... ADD COLUMN`（duomiapi_key 不在任何迁移）→ 与 P0-3 一起出一个「对齐真相」迁移，删掉运行时 DDL

## P1 · 正确性与结构（1~2 周主战场）

**后端数据一致性**
- `character_name_apply` 逐条 save 无事务（main.rs:2450）：中途失败 → 半改名脏数据无法回滚
- `ai_launch_seed` seed insert + create_project 无事务（main.rs:2226）：失败留孤儿 seed
- `create_seed` 先查后插、无 `(user_id,title,track)` 唯一约束（main.rs:320）：并发双击插重复

**前端结构病**
- SSE 流解析复制 5 处已协议漂移：useSSE.ts:36-167（全事件）vs usePipeline.ts:87-101 / useFullBook.ts:91-101（**收到 replace/retry 静默丢弃**）vs useFullPipeline.ts:212-229 vs lib/runPipeline.ts:117,158 → 收敛为一个解析器（净删 600-900 行）
- pipeline 三套并存：runPipeline.ts 注释自认是 useFullPipeline 的复制品，usePipeline 是第三套 → 单项目与批量入口行为分叉
- 上帝组件 6 个：ProjectDetail.tsx 2351 行（内含手写 ZIP 实现 916-1016、21 个 useState）、Seeds.tsx 1447（单函数 88-1331）、Dashboard 990、QuickRetro 861、Write 826、Review 649
- 全局加固三件套（各 <50 行）：路由 lazy()（main.tsx:7-24 现在 16 页全静态 import）+ ErrorBoundary（全应用 0 个，渲染错=白屏丢流式状态）+ axios 401 拦截器（client.ts 无 interceptor）
- e2e 红灯 2 例（test-results/ 2026-07-04）：通知铃铛 testid、项目详情复制预览——**动结构前先修绿**，否则回归无法归因

**工程**
- 无任何 CI（.github/ 不存在；.sqlx 已提交、离线可编译，无阻碍）：最小 CI = cargo clippy + cargo check + tsc + eslint + （可选）playwright
- Dockerfile：npm→pnpm、COPY lockfile、后端依赖层缓存、`;`→`&&`
- demo-seed 无生产护栏：db/demo-seed.sql:4-30 ON CONFLICT DO UPDATE 覆写全局 AI key、:31-48 植入公开口令 Demo123456 账号
- 迁移 0 个 down 文件；20260606161000 按环境特征（恰好 1 个早期用户）决定数据归属，不同库跑出不同终态

## P2 · 性能

**后端**
- fanqie 明细抓取对每本书**串行 spawn curl 子进程**（main.rs:1023）：50 本书→上百串行子进程，单请求数十秒 → 并发化（bounded）
- 列表接口全部无分页：list_seeds / projects list_with_stats
- dashboard_summary 5+ 条独立查询可并发（main.rs:1839）
- throttle 每次读 env（ai.rs:108）

**数据库（一进一出）**
- 补索引 Top5：`projects(user_id, updated_at DESC) WHERE deleted_at IS NULL`（lib.rs:791/821 默认排序路径）；`ai_seed_drafts(user_id, created_at DESC)`（lib.rs:1331）；`seeds(user_id,title,track)`（lib.rs:672 每次 AI 入库查重，可与 P1 唯一约束合并）；`ai_seed_drafts(user_id,title) WHERE heat=''`（lib.rs:1370,1397）；`chapters(project_id) INCLUDE(word_count)`（lib.rs:838/1645 SUM 避免回大 heap 页）
- 删死索引 5 个：seeds_created_at_idx、seeds_tier_idx、ai_seed_drafts_track_idx、ai_seed_drafts_batch_id_idx、projects_status_idx
- project_artifacts 只增不删，story_image 的 content 存 base64 data_url（main.rs:3043 起）= 膨胀最快的表 → 出走文件/对象存储
- user_sessions 无过期清理（只读侧过滤 lib.rs:176）→ 加定期清理
- fanqie_stats：补 UNIQUE(user_id,book_id)（现在重复导入重复计数）、FK 补 ON DELETE、计数列收 NOT NULL

**前端**
- AI 端点 timeout 靠 12 处手工覆盖 8s 默认值，忘写必超时 → 分层默认
- 大列表无虚拟化、重型组件无 memo（ProjectDetail 0 个 memo）

## P3 · 质量与卫生

- **死代码（cargo/grep 实证）**：build_full_book_source(main.rs:3939)、OPENINGS_REF(ai.rs:1788)、DocRoot::root(docs.rs:47)、ProjectReviewRepo::pool(storage:1478)、domain::Dimension(domain:16)；前端 fixMarkdownTables.ts 74 行无引用
- **死依赖**：app 的 tokio-stream/tower、storage 的 tokio/tracing、前端 gsap
- **lint 实测**：clippy 12 warnings；eslint 32 problems（26 errors，react-hooks/set-state-in-effect 17 + exhaustive-deps 6）
- **重复**：8 个 ai_*_stream handler 高度雷同、4 处 JSON 兜底解析雷同；SSEEventDelta/Error 类型定义 3 次；PipelineStepKey 重复 export 2 次
- **tier 阈值两版本**：后端 V2 ≥30/≥22（domain/src/lib.rs:37）vs 前端旧版 ≥32/≥26（web/src/api/seeds.ts:42-53）——同一 seed 两端可能显示不同段位
- **AppError::Ai 错映射 502**：业务前置（"先生成大纲"）也返 502
- **日志泄漏**：ai.rs:2275 每次生图 warn 打印 key 前 4 位（调试残留）
- **仓库卫生**：.gitignore 补 `.idea/`、`web/.tmp-*`；`git rm --cached` 6 张调试截图(~640KB)与 ocr_pending/ 5.6MB JPG（是否保留归档需确认）；空目录 `bookflow/` 删除（README「给别人部署」让人 cd bookflow → 照做卡死，README 同步修）；hot_tracks.md 等 3 份研究文档归 docs/；README 补 dev.sh；.env.example 补 AI_MIN_INTERVAL_MS/AI_OPENAI_API_KIND/DOMIAPI_KEY（后端 env 全集 12 个）
- **dev.sh**：set -u 下裸展开 AI_* 变量缺一即崩（dev.sh:62）；`pkill -f "vite.*--strictPort"` 误伤其他项目
- **Rust 版本三处漂移**：README 1.95 / Dockerfile 1.86+--ignore-rust-version / 本机 1.92 → 加 rust-toolchain.toml
- **compose**：无 restart/app healthcheck；`image: bookflow:latest` 无 build 段；`AI_API_KEY: ""` 写死易误提交真 key
- **sqlx 编译期校验覆盖率 16%**（8/49 处 query! 宏）——P0-3 正是因此活过编译；长期方向：迁宏或加真库集成测试
- Cookie 缺 Secure flag（部署 HTTPS 后加）

## 执行波次建议

- **第 0 波（半天，全是小 diff 大收益）**：P0-1/2 补 require_user → 「对齐真相」迁移（4 列 + duomiapi_key + 删运行时 DDL）→ 修 ProjectDetail.tsx:756 tsc 错 → Dockerfile `;`→`&&` → 渐变紫 3 处 → 多米 key 热更新
- **第 1 波（1-2 天，加固）**：最小 CI + e2e 修绿 2 例 + 后端 3 处事务/唯一约束 + 前端三件套（lazy/ErrorBoundary/401）+ demo-seed 护栏 + tier 阈值统一
- **第 2 波（2-4 天，结构收敛）**：SSE 解析器收敛为一（删 600-900 行）→ pipeline 三套并一 → 拆 ProjectDetail/Seeds（先机械移出卡片与 ZIP 工具）→ 拆 main.rs（4105 行：fanqie 450 行、prompt、settings、8 个 stream handler 各成 module）→ 索引一进一出 → fanqie 抓取并发化
- **第 3 波（择机/需拍板）**：git filter-repo 洗 590MB 历史（**不可逆**）→ story_image 出走对象存储 → sqlx 宏覆盖/集成测试 → 分页 → 死代码死依赖清理 + clippy/eslint 清零

## 需要用户拍板的事

1. **git 历史重写**（P0-5）：filter-repo 不可逆、所有 clone 需重拉。做不做、何时做？
2. **app_settings 全局单行 = 所有用户共享同一个 AI key**（且明文存库，dump 会带出）：单用户工具还是多用户产品？决定要不要做 per-user key。
3. **fanqie_stats 整个 repo 没有写入代码**，数据靠库外手工灌 [unverified]：这张表的数据到底怎么进来的？决定补约束的方式。
4. **ocr_pending/ 5.6MB 图片**：还要用还是归档删除？
