# Bookflow 全书汇总与优化升华设计

## 背景

当前 `bookflow` 已支持：

- 项目详情页生成 `README / 大纲 / 发布稿 / 配套`
- 写作页与项目详情页触发 AI 全书生成
- 项目列表显示 `AI 生成中 · 第 X/Y 章 · 段 A/B` 的全局进度徽章

现存缺口：

- 打开项目详情页后，看不到与项目列表一致的实时正文生成状态
- 项目详情页没有“全书汇总”能力，无法把多章正文收敛成一份完整可复制内容
- 没有基于汇总正文继续做“优化升华 / 去 AI 味 / 增强代入感”的二次产物

本设计补齐以上缺口，并严格沿用现有 `artifact + SSE stream + versioned artifact` 架构。

## 目标

### 功能目标

1. 项目详情页在 AI 全书生成进行中时，显示实时进度和当前章节正文预览。
2. 用户可在项目详情页手动触发“全书汇总”。
3. 全书汇总不是简单拼接展示，而是先由 AI 基于全章节正文生成一版连贯整合后的完整正文。
4. 用户可在已有全书汇总的前提下，手动触发“优化升华”。
5. 保留两份独立产物：
   - 原始汇总
   - 优化版汇总
6. 两份产物都支持一键复制。

### 非目标

- 不做“10 章生成完自动汇总 / 自动优化”
- 不新增独立“汇总工作台”页面
- 不让优化版覆盖原始汇总
- 不引入新的持久化模型，继续复用 `project_artifacts`
- 不修改写作页的主流程交互

## 用户确认过的关键决策

- 原始汇总生成方式：由 AI 先把全章节整合成一版连贯完整正文，再输出。
- 优化结果保留策略：保留原始汇总与优化版汇总，两份都可复制。
- 触发方式：两步都手动触发。
- 详情页实时展示：除进度状态外，还要显示当前正在生成章节的实时正文预览。

## 方案选择

采用 `方案 A`：沿用现有项目级 AI 产物体系，新增两类产物：

- `book_summary`
- `book_polished`

理由：

- 最贴合现有 `ArtifactKind + SSE + 保存版本` 模式
- 支持版本化、重生成、失败保留旧版
- 前后端改动集中，风险最低

不采用的方案：

- 只做临时接口不存产物：缺少版本和历史，不适合当前工作流
- 独立汇总工作台：范围过大，超出本次需求

## 现状与复用点

### 前端

- `bookflow/web/src/pages/ProjectDetail.tsx`
  - 已有通用流式产物卡片 `ArtifactStreamCard`
  - 已有正文生成卡片 `BodyGenCard`
- `bookflow/web/src/hooks/useSSE.ts`
  - 已支持 `POST + SSE delta/error/done`
- `bookflow/web/src/hooks/useFullBook.ts`
  - 已提供全书生成进度与 `liveBody`
- `bookflow/web/src/hooks/useAiJobStore.ts`
  - 已做跨页面 AI 任务同步，但当前仅持久化章/段/字数，不含 `liveBody`

### 后端

- `bookflow/api/crates/storage/src/lib.rs`
  - 已有 `ArtifactKind` 与 `ArtifactRepo`
- `bookflow/api/crates/app/src/main.rs`
  - 已有项目级 AI stream handler 路由模式
- `bookflow/api/crates/app/src/ai.rs`
  - 已有长文本流式生成封装

## 设计概览

### 一、详情页实时状态增强

项目详情页正文卡片新增两块内容：

1. 进度条/状态条
   - 文案：`AI 生成中 · 第 X/Y 章 · 段 A/B · N 字`
   - 支持中断
2. 当前章节实时正文预览
   - 标题：`正在生成章节预览`
   - 内容：`liveBody.text`

状态来源分两种：

- 当前页自己触发全书生成：优先显示 `useFullBook().progress`
- 用户从别页进入详情页：读取 `useAiJob(projectId)` 的全局状态

为支持第二种情况，需要把 `liveBody` 一并写入 `useAiJobStore`。

### 二、全书汇总

详情页新增“全书汇总”卡片。

行为：

- 用户手动点击 `AI 生成全书汇总`
- 后端按章节顺序收集正文
- 先拼成输入材料，再交给 AI 生成一版连贯完整正文
- 流式返回到前端
- 完成后保存为 `book_summary`

卡片能力：

- 显示流式内容
- 已有版本时显示版本号
- 支持重新生成
- 支持复制

### 三、优化升华

详情页新增“优化升华”卡片。

行为：

- 用户手动点击 `优化升华 / 去 AI 味 / 增强代入`
- 以后端最新 `book_summary` 作为唯一输入
- AI 输出优化版全文
- 完成后保存为 `book_polished`

卡片能力：

- 无 `book_summary` 时禁用
- 显示流式内容
- 已有版本时显示版本号
- 支持重新生成
- 支持复制

## 后端设计

### 数据模型

扩展 `ArtifactKind`：

- `BookSummary -> "book_summary"`
- `BookPolished -> "book_polished"`

数据库 `project_artifacts.kind` 的 `CHECK` 约束需同步扩展，允许：

- `readme`
- `outline`
- `publish_post`
- `side_dishes`
- `book_summary`
- `book_polished`

不新增表，不新增独立实体。

### 新增路由

在 `bookflow/api/crates/app/src/main.rs` 新增：

- `POST /api/projects/:id/ai-book-summary/stream`
- `POST /api/projects/:id/ai-book-polish/stream`

### 新增 Handler

#### `ai_book_summary_stream`

输入：

- `project_id`

处理流程：

1. 查询项目全部章节
2. 按 `idx` 排序
3. 过滤空正文章节
4. 无正文则报错：`先生成至少一章正文，再汇总`
5. 将章节整理为统一材料，例如：

```md
# 第1章 章节标题
正文...

# 第2章 章节标题
正文...
```

6. 调用 `stream_book_summary`
7. SSE `done` 后保存为 `ArtifactKind::BookSummary`

#### `ai_book_polish_stream`

输入：

- `project_id`

处理流程：

1. 查询最新 `BookSummary`
2. 不存在则报错：`先生成全书汇总，再做优化升华`
3. 调用 `stream_book_polish`
4. SSE `done` 后保存为 `ArtifactKind::BookPolished`

### AI Prompt 设计

新增两个 system prompt：

- `project_book_summary.system.md`
- `project_book_polish.system.md`

#### 汇总 Prompt 要求

- 保留原剧情顺序和核心冲突
- 把多章内容整合为一份连贯正文
- 修复明显重复、跳段、口吻漂移
- 不输出分析，不输出标题清单，不输出解释
- 直接输出完整正文

#### 优化 Prompt 要求

- 基于 `book_summary` 二次润色
- 目标是“去 AI 味、增强代入感、提升爽点和节奏”
- 保留剧情事实，不新增设定，不改结局走向
- 不输出点评说明，只输出优化后正文

## 前端设计

### Artifact 类型扩展

在 `bookflow/web/src/api/projects.ts` 扩展：

- `book_summary`
- `book_polished`

### 项目详情页结构

在 `BodyGenCard` 之后新增两张卡片：

1. `全书汇总`
2. `优化升华`

顺序：

1. README
2. 大纲
3. 正文
4. 全书汇总
5. 优化升华
6. 发布稿
7. 配套素材

原因：

- 汇总与优化都建立在正文之上
- 发布稿与配套素材仍属于后续运营产物

### 正文卡片增强

`BodyGenCard` 需新增：

- 显示全局 AI 任务状态
- 显示当前章节实时正文预览

展示策略：

- 若本地 `progress.running` 为真，显示本地状态
- 否则若全局 `useAiJob(projectId)` 有 `full_book` 任务，显示全局状态

### AI Job Store 扩展

`AiJob` 新增可选字段：

```ts
liveBody?: {
  chapterId: string
  text: string
}
```

`useFullBook` 在推送进度时同步写入 `liveBody`。

清理规则：

- 成功：清空 job
- 失败：清空 job
- 中断：清空 job

### 产物卡片增强

`ArtifactStreamCard` 建议增加可选复制能力：

- `copyable?: boolean`
- `copyLabel?: string`

行为：

- 有内容时显示复制按钮
- 复制纯文本内容
- 成功后显示轻量提示 `已复制`

### 卡片交互规则

#### 全书汇总卡片

- 标题：`全书汇总`
- 按钮：`AI 生成全书汇总`
- 已存在内容时按钮文案：`重新生成`
- 禁用条件：
  - 没有正文
  - 正在跑全书正文生成
  - 正在跑全书汇总

#### 优化升华卡片

- 标题：`优化升华`
- 按钮：`优化升华`
- 已存在内容时按钮文案：`重新生成`
- 禁用条件：
  - 没有 `book_summary`
  - 正在跑优化流

## 数据流

### 全书汇总数据流

```text
章节列表 -> 后端按 idx 收集正文 -> 组装章节原文材料 -> AI 连贯整合
-> SSE 流式返回 -> 保存 book_summary -> 前端刷新 artifacts
```

### 优化升华数据流

```text
读取最新 book_summary -> AI 润色优化
-> SSE 流式返回 -> 保存 book_polished -> 前端刷新 artifacts
```

### 实时正文预览数据流

```text
useFullBook.streamWriteOne -> progress.liveBody 更新
-> setAiJob 写入 localStorage
-> ProjectDetail 订阅 useAiJob(projectId)
-> 渲染当前章节预览
```

## 错误处理

### 全书正文生成失败

- 已写入章节内容保留
- 正文卡片显示错误
- 用户可再次触发续写

### 全书汇总失败

- 当前流显示错误
- 若已有旧版 `book_summary`，继续保留旧版展示
- 不覆盖旧版本

### 优化升华失败

- 当前流显示错误
- 若已有旧版 `book_polished`，继续保留旧版展示
- 不覆盖旧版本

### 复制失败

- 显示轻量错误提示
- 不影响当前内容

## 测试策略

### 后端

- `ArtifactKind` 新值可正确 parse / serialize
- `ai_book_summary_stream`
  - 无正文时报错
  - 有正文时可保存 `book_summary`
- `ai_book_polish_stream`
  - 无 `book_summary` 时禁用/报错
  - 有 `book_summary` 时可保存 `book_polished`

### 前端

- `ProjectDetail` 在有全局 `AiJob` 时显示实时状态
- `liveBody` 存在时显示实时正文预览
- `book_summary` 卡片可生成、可复制
- `book_polished` 在无 `book_summary` 时禁用
- 两张卡片在已有旧版时重生成失败不丢旧内容

### E2E

新增一条轻量流程：

1. 创建项目
2. 准备至少 2 章正文
3. 打开项目详情页
4. 触发 `AI 生成全书汇总`
5. 等待汇总内容出现
6. 触发 `优化升华`
7. 等待优化版内容出现
8. 验证两张卡片都能看到内容与复制按钮

## 风险与约束

### Token 风险

- 多章正文汇总可能很长
- 第一版先直接发送全文；若后续遇到上下文超限，再单独设计分块汇总策略

### 一致性风险

- `useAiJobStore` 是前端本地状态，不是后端任务队列
- 浏览器刷新或更换设备后，实时状态可能丢失
- 这是当前系统既有约束，本次不改变

### 版本增长

- 每次重生成都会写一版新 artifact
- 这是现有产物模型预期行为，本次不做清理策略

## 实施范围

本次只覆盖：

- 项目详情页实时正文生成状态补齐
- 全书汇总产物
- 优化版汇总产物
- 两份内容复制

不覆盖：

- 自动串联触发
- 人工对比 diff 视图
- 汇总结果再反写章节
- 独立编辑器

## 验收标准

1. 项目列表显示 `AI 生成中` 时，打开对应项目详情页也能看到实时进度。
2. 详情页能看到当前正在生成章节的实时正文预览。
3. 用户能手动生成 `全书汇总`。
4. `全书汇总` 是 AI 连贯整合后的完整正文，不是纯拼接直接展示。
5. 用户能基于 `全书汇总` 生成 `优化升华`。
6. 原始汇总与优化版汇总都保留，且都可复制。
7. 重生成失败时，不覆盖已存在旧版本。
