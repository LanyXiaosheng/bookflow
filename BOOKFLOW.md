# BookFlow — 番茄短篇生产后台 · 需求交互功能文档

> Web 化 SOP.md + pipeline-manage skill 的全流程，把命令行工作台变成可视化看板。
> 设计语言对齐 GEOFlow（geo_admin），保持同一套视觉与交互范式。

---

## 0. 文档定位

| 项 | 内容 |
|---|---|
| 产品代号 | BookFlow |
| 产品形态 | 单租户 Web 后台（个人/小团队） |
| 当前版本 | v0.2（PRD + 交互稿，已对齐 GEOFlow 实际实现） |
| 上游权威 | `SOP.md`、`pipeline-manage/SKILL.md`、`playbook/*` |
| 设计参考 | GEOFlow（`/Users/lany-xiaosheng/Desktop/990Pro/个人知识库/输入/AIGEO/GEOFlow`），Laravel 11 + Blade + Tailwind play-cdn + Lucide |
| 文档范围 | 信息架构 / 模块拆分 / 关键交互 / 数据模型 / 设计规范 / MVP 边界 / 实现路径映射 |

**铁律**：BookFlow 是 SOP 的执行器，不是 SOP 的替代品。SOP 改了，UI 跟着改；UI 不允许引入 SOP 没有的规则。

---

## 1. 产品定位与目标

### 1.1 解决什么

当前生产线的痛点：

- 状态分散在 `DASHBOARD.md` + `pipeline/` 6 个目录 + 多个 README，看一眼全局要跳 4 次。
- 阶段迁移、字数校验、发布检查靠记忆 + 命令行，新人/换设备成本高。
- 复盘数据没结构化，回收 → 沉淀 → 反哺选题的链路全靠人脑。
- 多账号（新号/旧号）、多赛道、多平台时，DASHBOARD 单文件扛不住。

### 1.2 一句话目标

**让"从一个脑洞到发布上线再到复盘归档"全流程，在一个浏览器标签页里完成。**

### 1.3 北极星指标

| 指标 | 目标 |
|---|---|
| 单篇从立项到待发的耗时 | ≤ 30 分钟 |
| 阶段错放率（产物阶段 ≠ 目录阶段） | 0% |
| 字数不达标流入待发 | 0 篇 |
| 发布后 72h 复盘完成率 | ≥ 90% |

---

## 2. 设计语言对齐（基于 GEOFlow 实际源码）

> **重要修订**：v0.1 推断的"左侧导航 + 玻璃拟态"基于登录页特例，**与 GEOFlow 后台实际不符**。
> 阅读 `resources/views/admin/{layouts/app,partials/header,dashboard,articles/index}.blade.php` 后修订如下。
> 玻璃拟态只用于登录页（`auth/login.blade.php`），后台主体是平面、克制、灰白基调。

### 2.1 整体骨架

| 维度 | GEOFlow 实际取值 | BookFlow 沿用 |
|---|---|---|
| 技术栈 | Laravel 11 + Blade + Tailwind **play-cdn** + Lucide Icons | 同 |
| body 底色 | `bg-gray-50` 纯灰，无渐变 | 同 |
| 主容器 | `<main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">` | 同 |
| 导航形式 | **顶部水平导航**（`<nav class="bg-white shadow-sm border-b">`，h-16） | 同（不是左侧 SideNav） |
| 卡片 | `bg-white p-5 shadow-sm ring-1 ring-gray-200 rounded-lg` 平面白卡 | 同 |
| 圆角 | 卡片/按钮 `rounded-lg`，标签 `rounded-md`/`rounded-full`，弹层 `rounded-2xl` | 同 |
| 阴影 | `shadow-sm` 极浅，hover 才到 `shadow-md` | 同（不用长投影） |
| 描边 | `ring-1 ring-gray-200` 或 `border border-gray-200` | 同 |
| 主色 | `blue-600` （CTA / 高亮 / active 菜单） | 同 |
| 状态色调色板 | emerald / blue / amber / red / violet / slate（成对 `bg-X-50/100 text-X-600/700`） | 同 |
| 分隔 | `border-b border-gray-100` / `divide-y divide-gray-100` | 同 |

### 2.2 顶部导航实际结构（一比一复刻）

```
<nav class="bg-white shadow-sm border-b">
  max-w-7xl 容器, h-16
  ├─ 左：品牌名 (text-lg font-semibold text-gray-900)
  ├─ 中：水平菜单 (overflow-x-auto, gap-3 lg:gap-5)
  │      非 active：text-gray-500 hover:text-gray-700
  │      active：    text-blue-600 font-medium
  └─ 右：通知铃 + 语言切换 (select) + 用户头像下拉
</nav>
```

**菜单项一律纯文本+蓝色高亮**，不带图标背景（与 dashboard 内卡片图标区分）。

### 2.3 排版（来自实际样式）

| 用途 | Tailwind 类 |
|---|---|
| 页一级标题 | `text-2xl font-bold text-gray-900` 或 `text-3xl font-bold text-gray-900`（dashboard） |
| 页副标题 | `mt-1 text-sm text-gray-600` 或 `text-sm leading-6 text-gray-600` |
| 区块标题 | `text-xl font-semibold text-gray-900` |
| 卡片标题 | `text-base font-semibold text-gray-900` |
| 大数字指标 | `text-3xl font-bold text-gray-900` |
| eyebrow（小标题前缀） | `text-xs font-semibold uppercase tracking-[0.2em] text-blue-600` |
| 弱信息 | `text-xs text-gray-400` / `text-sm text-gray-500` |

### 2.4 关键组件范式（直接照搬 GEOFlow）

#### 健康指标卡（Dashboard 顶部 4 联）

```html
<div class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
  <div class="flex items-center justify-between gap-3">
    <h3 class="text-base font-semibold text-gray-900">在产项目</h3>
    <i data-lucide="layers" class="h-5 w-5 text-blue-600"></i>
  </div>
  <div class="mt-5 text-3xl font-bold text-gray-900">12</div>
  <div class="mt-2 text-sm font-medium text-gray-500">立项 3 / 写作 5 / 待发 4</div>
</div>
```

#### 状态徽章（六种语义色）

```html
<!-- ready 绿 -->     <span class="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"><span class="mr-2 h-1.5 w-1.5 rounded-full bg-current"></span>就绪</span>
<!-- running 蓝 -->   bg-blue-100 text-blue-700
<!-- warning 黄 -->   bg-amber-100 text-amber-700
<!-- error 红 -->     bg-red-100 text-red-700
<!-- available 紫 --> bg-violet-100 text-violet-700
<!-- slate -->        bg-slate-100 text-slate-700
```

#### 主按钮 / 次按钮 / 危险按钮

```html
<!-- 主 -->  <a class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
<!-- 次 -->  <a class="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
<!-- 危险 --><button class="inline-flex items-center px-4 py-2 border border-red-200 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50">
```

#### 流水节点（GEOFlow `flowNodes` 范式 → BookFlow Pipeline 6 阶段）

每节点一张卡：左侧 9×9 圆形数字徽章（`bg-blue-600 text-white`）或图标+色调 → 标题 → 描述 → 指标列表 → 操作按钮组。

#### 通道列（GEOFlow `lanes` 范式 → BookFlow 项目卡片墙）

```
卡片 grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3
图标 7×7 边框小方框 → 标题 truncate + 描述 truncate → 右侧大数字
hover: border-blue-100 bg-blue-50
```

### 2.5 国际化

完全沿用 GEOFlow：

- `lang/{zh_CN,en,ja,es,ru,pt_BR}/admin.php` 字典
- `__('admin.xxx.yyy')` 调用
- 顶部 `<select>` 切换 → `route('admin.locale.switch', ['locale' => $code])`
- BookFlow 翻译 key 命名 `bookflow.<module>.<key>`，命名空间隔离

---

## 3. 信息架构

### 3.1 顶部水平导航（一比一对齐 GEOFlow header）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ BookFlow   看板 · 选题 · 写作 · 待发 · 已发 · 复盘 · 赛道 · 手册 · 设置  │  🔔 🌐 👤▼  │
└──────────────────────────────────────────────────────────────────────────┘
```

- 导航容器：`bg-white shadow-sm border-b`，高 16，max-w-7xl 居中
- 菜单项：纯文本，active 蓝、非 active 灰，`overflow-x-auto` 自适应
- 右侧：通知铃（红点 = 待复盘/字数告警/外部修改）+ 语言下拉（zh/en/ja）+ 用户菜单
- 移动端：`md:hidden` 折叠成右上角 menu 按钮 + 抽屉

**菜单合并设计**：

GEOFlow 把 categories/authors/title-libs/keyword-libs/image-libs 全收在 `素材` 一级菜单下用面包屑切；BookFlow 的「选题/立项/写作/待发/已发/归档」6 个阶段如果都顶级会挤爆水平条，因此合并为：

| 一级菜单 | 含子菜单 / 跳转目标 |
|---|---|
| 看板 | `/dashboard`（默认） |
| 选题 | 选题池（阶段 1） |
| 项目 | 立项 + 写作 + 待发（阶段 2/3/4 用 tab 切换） |
| 已发 | 阶段 5 列表 + 数据录入 |
| 复盘 | 阶段 6 + 复盘分析聚合 |
| 赛道 | tracks 配置 |
| 手册 | playbook 只读 |
| 设置 | 账号 / LLM / 字数规则 / 通知 / git 同步 |

8 个一级菜单，与 GEOFlow 当前的 8 项数量级一致，不挤。

### 3.2 路由规划（按 Laravel 路由习惯命名）

```
/bookflow                        → 重定向 /bookflow/dashboard
/bookflow/dashboard              → 看板
/bookflow/seeds                  → 选题池（阶段 1 列表）
/bookflow/seeds/create           → 新建选题（评分卡）
/bookflow/seeds/{id}             → 选题详情/编辑
/bookflow/projects               → 项目列表（默认按阶段分 tab）
/bookflow/projects/{id}          → 详情，下含子 tab：outline/write/pre-publish
/bookflow/projects/{id}/write    → 写作工作台
/bookflow/projects/{id}/pre-publish → 发布前检查
/bookflow/published              → 已发
/bookflow/retros                 → 复盘分析
/bookflow/tracks                 → 赛道配置
/bookflow/playbook               → 手册
/bookflow/playbook/{slug}        → 手册单页
/bookflow/settings               → 设置
```

`prefix` 用 `bookflow`，避免与 GEOFlow 的 `geo_admin` 冲突——若两个后台同部署，按子路径隔离。

### 3.3 页面通用骨架（沿用 `admin/layouts/app.blade.php`）

```blade
@extends('bookflow.layouts.app')

@section('content')
  <div class="px-4 sm:px-0">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">{{ $pageTitle }}</h1>
        <p class="mt-1 text-sm text-gray-600">{{ $pageSubtitle }}</p>
      </div>
      <div class="flex flex-wrap gap-2 justify-end">
        {{-- 主按钮 + 次按钮组 --}}
      </div>
    </div>

    {{-- 内容区：sections 用 mb-8 间隔 --}}
  </div>
@endsection
```

每页都遵循"标题区 + 操作区按钮组 + section 卡片群"的三段范式。

---

## 4. 核心模块

### 4.1 Dashboard（全局看板）

**一比一对齐 GEOFlow `dashboard.blade.php` 的五段式结构**，把每段映射到番茄短篇生产线的对应概念。

#### 整体五段（自上而下）

```
┌────────────────────────────────────────────────────────────────┐
│ ① 页头：标题 + [刷新] [+ 新建选题]（主按钮）                     │
├────────────────────────────────────────────────────────────────┤
│ ② 快速开始（三步走，对齐 GEOFlow quick_start）                  │
│    [1] 接 LLM API   [2] 配赛道+playbook   [3] 立第一个项目      │
├────────────────────────────────────────────────────────────────┤
│ ③ Pipeline 流水（核心，对齐 GEOFlow automation flow_nodes）     │
│    左：6 节点流水图 (选题→立项→写作→待发→已发→归档)             │
│    右：360px 推荐侧栏（"下一篇发什么 / 哪篇该催复盘"）            │
├────────────────────────────────────────────────────────────────┤
│ ④ 健康指标（4 联卡，对齐 GEOFlow healthCards）                  │
│    [在产项目] [本周已发] [待复盘] [字数告警]                     │
├────────────────────────────────────────────────────────────────┤
│ ⑤ 通道 Lanes（3 栏，对齐 GEOFlow lanes）                        │
│    [写作素材] [近期产出] [外部资源]                              │
├────────────────────────────────────────────────────────────────┤
│ ⑥ 技能资源（3 卡，对齐 GEOFlow skillResourceCards）              │
│    [SOP 流程速查] [Playbook 写作手册] [pipeline-manage 命令]    │
└────────────────────────────────────────────────────────────────┘
```

#### ② 快速开始（onboarding 引导，老用户折叠）

三步走对应番茄短篇的"零到一"启动：

| 步 | GEOFlow 对应 | BookFlow 对应 |
|---|---|---|
| 1 | 接 OpenAI/Anthropic API | 接 LLM API（写作/选题用） |
| 2 | 创建知识库/标题库/关键词库/图片库/作者 | 配赛道（4 选 1）+ 检查 playbook 已就绪 |
| 3 | 创建采集任务 | 立第一个项目（跳选题评分卡） |

每步右上角 emerald 状态徽章 `bg-emerald-100 text-emerald-700`。

#### ③ Pipeline 流水（最重要的可视化）

**对齐 `flowNodes` 范式**：左侧主区是 6 节点横向流水卡（数量超 GEOFlow 的 7 节点，但更紧凑因为概念更纯）。

每节点一张子卡：

```html
<div class="rounded-lg border border-gray-200 bg-white p-5">
  <div class="flex items-start gap-3">
    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
      <i data-lucide="target" class="h-5 w-5"></i>  <!-- 选题图标 -->
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold text-gray-900">选题</h3>
        <span class="...status-badge...">{{ $stage1_count }} 项</span>
      </div>
      <ul class="mt-2 space-y-1 text-xs text-gray-500">
        <li>评分 ≥28：{{ $ready_count }}</li>
        <li>备选池：{{ $backup_count }}</li>
      </ul>
      <div class="mt-3 flex gap-2">
        <a class="px-3 py-1.5 rounded-md text-xs bg-blue-600 text-white">查看 →</a>
      </div>
    </div>
  </div>
</div>
```

| 节点 | 图标 (lucide) | 状态色调 | 关键指标 |
|---|---|---|---|
| 选题 | `target` | blue | 评分 ≥28 数 / 备选池数 |
| 立项 | `clipboard-list` | violet | 大纲完成数 / 言情向占比 |
| 写作 | `pen-line` | amber → blue | 进行中数 / 字数达标率 |
| 待发 | `send` | green | 7 项检查全过数 |
| 已发 | `rocket` | emerald | T+72h 内复盘催办数 |
| 归档 | `archive` | slate | 累计归档 / 平均完读率 |

**右侧 360px 侧栏**（对齐 GEOFlow 的 recommendations 抽屉）：

- "下一篇发什么"：调 `pipeline-manage` next-publish 逻辑，输出 1 推荐 + 1 备选
- "哪篇催复盘"：T+72h 未复盘项目列表
- "本周目标进度"：从 DASHBOARD.md 解析，显示完成度

#### ④ 健康指标（4 联）

完全照搬 `healthCards` 范式，4 张白卡 grid `md:grid-cols-2 xl:grid-cols-4`：

| 卡 | 大数字 | 副文 | 图标 | tone |
|---|---|---|---|---|
| 在产项目 | 12 | 立项 3 / 写作 5 / 待发 4 | `layers` | blue |
| 本周已发 | 3 | 较上周 +1 | `rocket` | green |
| 待复盘 | 2 | 已超 72h: 1 | `clipboard-check` | amber |
| 字数告警 | 1 | 第 N 章 < 1000 | `triangle-alert` | red |

#### ⑤ Lanes（3 栏）

对齐 `lanes` 范式，每栏一个 section 白卡，内含若干"图标 + 标题 + 副文 + 右侧数字"行。

| 栏 | rows |
|---|---|
| 写作素材 | 赛道（4）/ playbook（11 篇）/ 模板（项目模板）/ 禁用词表 |
| 近期产出 | 最近 5 篇按时间倒序，点击跳详情 |
| 外部资源 | 番茄热榜 / 评论区拆解工具 / B 站&知乎对标 |

#### ⑥ 技能资源（3 卡）

对齐 `skillResourceCards` 范式，3 张可点击卡：

- SOP 流程速查 → 跳手册 §SOP
- Playbook 写作手册 → 跳手册首页
- pipeline-manage 命令 → 跳手册 §命令参考

每卡 `target="_blank"` 在新页打开（playbook 是只读视图，独立窗口阅读体验更好）。

#### 关键交互

- 流水节点 hover → ring `ring-2 ring-blue-100`
- 节点右上角 ⋯ 菜单：开写 / 发布检查 / 移阶段 / 归档
- 拖拽不直接迁移——拖到目标节点 → 弹出"阶段迁移确认 Drawer"，跑 SOP 判定才落库
- 卡点警示：节点上若有 ≥3 天未变动项目，节点边框变 amber + 显示天数

---

### 4.2 选题池（阶段 1）

**对应**：`pipeline/1-选题/` + SOP §1。

#### 视图

- **列表 + 筛选侧栏**：赛道 / 评分区间 / 创建时间 / 来源（脑洞/拆解/评论）
- **空态**："还没有选题。试试 AI 选题加速 →"，按钮触发 AI Brainstorm Drawer

#### 评分卡（核心）

按 SOP §1 的 7 维度（标题点击感 / 开局炸裂度 / 打脸清晰度 / 情绪强度 / 反转空间 / 试读卡点 / 完读驱动），每项 1-5 分。

- 形式：雷达图 `<ScoreRadar>` + 7 个 slider
- 实时计算合计分，边框颜色随段位变：
  - ≥28 绿（立刻立项）
  - 23-27 黄（备选池）
  - <23 红（不做）
- 必填字段：标题、赛道、一句话卖点（"谁 + 在什么死局里 + 怎么反杀"）
- **言情向额外段**：甜宠/虐爽/虐爽转甜宠 单选 + 经典套路 + 反套路破局
- 言情前置判断时：右侧抽屉自动渲染 `playbook/言情爆款共性.md`

#### AI 选题加速 Drawer

两个 tab：

| Tab | 输入 | 输出 |
|---|---|---|
| 爆款标题拆解法 | 粘贴 10-20 个爆款标题 + 选赛道 | 10 个新标题 + 一句话卖点（直接转评分卡） |
| 评论区痛点挖掘法 | 粘贴评论 + 选赛道 + 受众画像 | 3 个核心痛点 + 5 个选题（标题 + 卖点） |

提示词模板从 SOP §1 内置，参数注入。Prompt 落 LLM 的请求由后端代理。

#### 状态流转动作

- "立项" 按钮：评分 ≥28 时高亮，点击 → 创建 `大纲.md` 模板 → 项目移入立项

---

### 4.3 立项（阶段 2）

**对应**：`pipeline/2-立项/` + SOP §2。

#### 双栏编辑器

| 左 | README.md 元数据表单 |
| 右 | 大纲.md 富文本编辑器（章节折叠） |

两栏并行编辑，自动保存。模板从 `templates/project-template/` 复制。

#### 大纲必含三段（强制）

1. **故事主线**：单段文本框
2. **10 章细纲**：每章 4 字段卡片（目标 / 阻碍 / 变化 / 章尾钩子），不足 10 章红框告警
3. **爆点节奏表**：第 1/3/5/8/10 章必须打 ★ 炸点 tag，缺一不可

#### 言情向附加段

- 类型单选 + 经典套路标签多选 + 反套路破局文本框 + 信息差/发糖机制文本框

#### 校验规则（前端 + 提交时双校验）

- 每章至少 2 个变化点
- 前 30%（即第 1-3 章）含 强冲突 + 意外信息 + 高代价选择 至少各 1
- 言情向前 3000 字女主必须有不可逆动作字段勾选

#### 状态流转

- "进入写作" 按钮：所有强校验通过才高亮 → 项目移入写作 → 跳 `/projects/:id/write`

---

### 4.4 写作工作台（阶段 3 · 最复杂模块）

**对应**：`pipeline/3-写作/` + SOP §3 + `pipeline-manage` 字数验证规则。

#### 三栏布局

```
┌────────────┬──────────────────────────┬───────────────┐
│ 大纲面板   │   正文编辑区              │  AI 助手       │
│ (只读)     │   (主编辑器, 章节锚点)    │  (写作/精修)   │
│            │                          │               │
│ 1-10章细纲 │  # 第1章                 │  Prompt 模板  │
│ 折叠展开   │  ...                     │  禁用词表     │
│ 章尾钩子   │                          │  代入感清单   │
│ 高亮       │  字数实时显示            │  钩子设计     │
└────────────┴──────────────────────────┴───────────────┘
```

#### 字数计数（与 SKILL.md 完全一致）

- 计入：中文字符 + 中英文标点
- 不计入：空格 / 换行 / Markdown 标记 / 章节标题行
- 顶部 sticky 字数条：`<WordCountBadge>` 总字数 + 各章字数
- 每章 < 1000 字 → 章节锚点红点
- 总字数 < 10000 → 顶部红条 + "进入待发" 按钮置灰

#### 写作模式（按 SOP §3 节奏）

| 步骤 | 动作 | 边界 |
|---|---|---|
| Step 1 | "AI 写第 1-5 章"：注入大纲 + 禁用词表 + 代入感清单，目标 7000 字 | 一次 Write，不验证字数 |
| Step 2 | "AI 写第 6-10 章"：同上，目标 7000 字 | 一次 Write，不验证字数 |
| Step 3 | "校验字数"：跑 SKILL.md 的 Python 命令，前端展示原始输出 | 不允许 AI 自报达标 |
| Step 4 | "去 AI 味前置"：调 `playbook/去AI味.md` 规则做 inline 改写，产物即最终版 | 已在 commit `5ae6278` 落地 |
| Step 5 | "生成三件套"：手机复制版 .txt + 发布稿.md + 配套.md，并行产出 | 模板拼装 |

每步状态条可视化，进度条 + 当前耗时（目标 5 分钟）。

#### Playbook 嵌入

右侧 AI 助手 tab：去AI味 / 代入感 / 爆点节奏 / 反转设计 / 钩子设计 / 开头设计 / 精修清单 / 禁用词表 / 格式规范，全部从 `playbook/*.md` 直接渲染只读。

#### 状态流转

- "进入待发" 按钮：四件套齐 + 字数 ≥ 10000 才高亮 → 跑发布前检查 → 移入待发

---

### 4.5 待发（阶段 4）

**对应**：`pipeline/4-待发/` + SOP §4 + pre-publish 子命令。

#### 列表视图

- 卡片网格：标题 / 字数（绿勾或红 ×）/ 配套完整度 / 距上次更新 / "发布检查" + "推荐发布时段" 按钮

#### 发布前检查 Drawer（核心）

逐项 checklist，全绿才允许标记已发：

- [ ] 字数 ≥ 10000（执行计数命令，输出真实数字）
- [ ] 四件套齐全（正文 / 手机复制版 / 发布稿 / 配套）
- [ ] 禁用词扫描通过（与 `playbook/禁用词表.md` 比对）
- [ ] 标题 ≤ 25 字
- [ ] 配套含 标题 AB / 简介 / 标签
- [ ] 发布稿章节断点正确（每章一段）
- [ ] 精修清单 7 项全过（按 `playbook/精修清单.md`）

任意未过：列出违规明细 + "回到写作" 按钮。

#### 发布动作

"标记已发" → 弹窗填写：发布时间 / 平台 / 账号（新号/旧号）/ 平台 ID/URL → 项目移入已发。
此动作**不调用任何外部平台 API**，仅记录元数据（与 SOP "发布是外部动作"原则一致）。

#### 推荐发布时段

按题材自动建议（古言虐爽→周五21:00；现言火葬场→晚 21-23 点；快节奏打脸→午休 12:00），数据从复盘聚合而来。

---

### 4.6 已发（阶段 5）

**对应**：`pipeline/5-已发/` + SOP §5。

#### 视图

- 表格：标题 / 平台 / 账号 / 发布时间 / T+24h CTR / T+72h 完读率 / 复盘状态 / 操作
- 数据回填：手动录入或粘贴平台后台数据（番茄等平台无开放 API，明确走人工）

#### 复盘 Drawer（72h 后变红催办）

按 SOP §5 五问填写：

1. 点击率（目标 ≥15%）
2. 前 3000 字停留（目标 ≥40%）
3. 完读率（目标 ≥60%）
4. 这个题最强的点
5. 下次同类题怎么改

提交 → 写入 DASHBOARD.md 复盘表 → 项目移入归档。

---

### 4.7 归档（阶段 6）

**对应**：`pipeline/6-归档/`。

- 全表只读，按发布时间倒序
- 提供导出（按账号 / 按赛道 / 按时间段 → CSV/JSON）
- 单篇详情含完整数据回放（雷达图 + 数据 + 复盘文本）

---

### 4.8 复盘分析（横向）

聚合所有归档项目，输出可操作的写作策略洞察。

#### 看板

- **赛道表现矩阵**：CTR × 完读率 散点，气泡大小 = 字数
- **评分 vs 实际数据相关性**：检验 7 维度评分卡的预测力
- **时段热力图**：发布时段 × 完读率
- **最强点词云**：从所有复盘的"最强点"字段聚合
- **改进方向 backlog**：从所有"下次怎么改"汇集，可勾选转入 playbook 草稿

#### 反哺

- 一键"刷新赛道画像"：把表现差的标题特征 + 评论痛点写回 `tracks/*.md`
- 一键"沉淀写法"：把高分项目共性写入 `playbook/` 草稿（人工 review 后落盘）

---

### 4.9 赛道配置

`tracks/*.md` 的可视化编辑：

- 列表：4 条赛道（古言重生打脸 / 古言替嫁冲喜 / 现言婚恋火葬场 / 悬疑规则怪谈）
- 详情：方向 / 标签体系 / 受众画像 / 经典套路 / 反套路点 / 高频物件 / 禁忌 / 历史最佳标题
- 编辑后版本化保存（git commit）

---

### 4.10 写作手册（Playbook）

`playbook/*.md` 的只读浏览：

- 左目录树，右 markdown 渲染
- 每页底部"反馈/沉淀"按钮 → 把会话中沉淀的新经验提交为草稿
- 写作工作台右栏直接嵌入此页面

---

### 4.11 系统设置

| 段 | 项 |
|---|---|
| 账号 | 新号 / 旧号 / 自定义账号 CRUD |
| LLM | API Key / 模型 / 温度 / Max tokens |
| 字数规则 | 中文最低 / 单章最低（默认 10000 / 1000，对齐 SOP） |
| 备份 | git remote / 本地路径 / 自动 push 频率 |
| 主题 | 浅灰（默认） / 深色 |
| 多语言 | zh_CN / en / ja |

---

## 5. 数据模型

### 5.1 核心实体

```ts
type Stage = '1-选题' | '2-立项' | '3-写作' | '4-待发' | '5-已发' | '6-归档'
type Track = '古言重生打脸' | '古言替嫁冲喜' | '现言婚恋火葬场' | '悬疑规则怪谈'
type RomanceType = '甜宠向' | '虐爽向' | '虐爽转甜宠' | null

interface Project {
  id: string                // slug, 来自标题
  title: string
  track: Track
  stage: Stage
  account?: 'new' | 'old' | string
  createdAt: string
  updatedAt: string

  // 评分卡
  score: {
    titleClick: 1|2|3|4|5
    openingExplosive: 1|2|3|4|5
    slapClarity: 1|2|3|4|5
    emotionIntensity: 1|2|3|4|5
    twistRoom: 1|2|3|4|5
    teaserHook: 1|2|3|4|5
    finishDrive: 1|2|3|4|5
    total: number             // 自动求和
  }
  pitch: string                // 一句话卖点

  // 言情向附加
  romance?: {
    type: RomanceType
    tropes: string[]
    counterTropes: string
    informationGap?: string
    sweetMechanism?: string
  }

  // 大纲
  outline: {
    mainline: string
    chapters: Chapter[]        // 长度 ≥ 10
    explosivePoints: number[]  // 必含 [1,3,5,8,10]
  }

  // 正文
  content: {
    body?: string
    bodyPlainText?: string
    publishDraft?: string
    metadata?: PublishMeta
    chineseCharCount?: number
    perChapterCount?: number[]
  }

  // 发布
  publish?: {
    platform: string
    platformId?: string
    url?: string
    publishedAt: string
  }

  // 复盘
  retro?: {
    ctr?: number
    earlyRetention?: number
    finishRate?: number
    bestPoint: string
    nextImprovement: string
    retroAt: string
  }
}

interface Chapter {
  index: number
  title?: string
  goal: string
  obstacle: string
  change: string
  endHook: string
  bodyText?: string
  charCount?: number
}
```

### 5.2 持久化策略

- **磁盘真相源**：保留现有 `pipeline/` 目录结构，UI 操作 = 文件读写。
- **索引层**：SQLite（`bookflow.db`）缓存全部项目元数据，启动时扫描重建，watcher 监听文件变化。
- **冲突原则**：磁盘 > DB。任何不一致以磁盘为准，DB 重建。
- **DASHBOARD.md / SOP.md 不动**：UI 写复盘 → 同步追加到 DASHBOARD.md 表，保持向下兼容。

---

## 6. 关键交互流

### 6.1 一篇文章的完整生命周期

```
[Dashboard 点 +新建选题]
  → 评分卡 Drawer (≥28 分)
  → [立项] 双栏编辑大纲 (10 章 + 爆点)
  → [写作] AI 生成 12000 字 → 字数校验
  → 一键三联生成手机版/发布稿/配套
  → [待发] 发布前检查 7 项全绿
  → 标记已发 (录平台 ID)
  → T+72h 复盘催办
  → 5 问复盘 → [归档]
  → 复盘分析聚合 → 反哺 playbook/tracks
```

### 6.2 阶段迁移确认 Drawer（统一交互）

任意阶段迁移触发：

1. 跑 SOP 阶段判定（`pipeline-manage` 同款逻辑）
2. 列出未通过项 + 通过项
3. 通过 → 迁移目录 + 写日志 + 刷新 Kanban
4. 未通过 → 阻断 + 给出"修复路径"按钮

**不允许 UI 绕过 SOP 规则。**

### 6.3 字数校验流（贯穿写作 → 待发）

```
[每章写完]
  → 实时计数（前端 wasm 重算）
  → < 1000 字 → 章节红点 + 提示扩写
[全文完成]
  → 顶部字数条
  → < 10000 → "进入待发" 置灰
  → ≥ 10000 → 解锁 + 触发预校验
[发布前检查]
  → 后端再算一次（防前端篡改）
  → 与前端不一致 → 报警 + 按后端为准
```

### 6.4 复盘催办流

```
[已发后 72h]
  → cron 标红
  → Dashboard 顶部条 "X 篇待复盘"
  → 邮件/桌面通知（可选）
  → 复盘 Drawer 强制 5 问
  → 提交 → 写入 DASHBOARD.md + DB → 移归档
```

---

## 7. 权限与单租户简化

MVP 阶段单用户、本地部署，登录沿用 GEOFlow 的简单账密页（设计已有）。

后续如开放团队协作：

| 角色 | 权限 |
|---|---|
| Owner | 全部 |
| Writer | 选题/立项/写作，不可修改 SOP/playbook |
| Reviewer | 只读 + 复盘录入 |

---

## 8. 非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | Dashboard 首屏 ≤ 1.5s，编辑器输入延迟 ≤ 50ms |
| 兼容 | Chrome / Safari / Edge 最近两版；不兼容 IE |
| 离线 | 写作工作台离线可写（IndexedDB 缓存）+ 联网回写 |
| 备份 | 文件层走 git，DB 每日 dump，云端可选 S3/OSS |
| 安全 | LLM API Key 存本地 keychain，不入 DB；磁盘文件继承 OS 权限 |
| 可观测 | 操作日志（谁在何时把哪篇移到哪阶段）持久化 90 天 |

---

## 9. MVP 范围（v0.1）

**做**：

- Dashboard / 6 阶段 Kanban
- 选题评分卡（含 AI 选题加速 2 个 prompt）
- 立项编辑器（大纲三段强校验）
- 写作工作台（字数实时计数 + 一键三联）
- 待发发布前检查 7 项
- 标记已发 + 复盘 Drawer
- 归档列表 + 导出
- Playbook 只读浏览

**不做（留 v0.2+）**：

- 复盘分析高级图表（散点矩阵、词云）
- Tracks 反哺自动写回
- 多账号协作、角色权限
- 平台 API 直发（番茄等无开放 API，长期保持人工）
- 移动端 App（PWA 即可）

---

## 10. 开发节奏建议

| 周 | 里程碑 |
|---|---|
| W1 | 数据模型 + 文件层 watcher + 阶段判定 API |
| W2 | Dashboard + 6 阶段 Kanban + 阶段迁移 Drawer |
| W3 | 选题评分卡 + AI 选题加速 |
| W4 | 立项双栏编辑器 + 大纲校验 |
| W5 | 写作工作台 + 字数计数 + AI 生成 |
| W6 | 待发发布检查 + 复盘 Drawer |
| W7 | 归档导出 + Playbook 渲染 + 联调走通完整生命周期 |
| W8 | 性能优化 + i18n + 打包发布 v0.1 |

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| UI 与 SOP 脱节 | UI 校验逻辑直接调用 `pipeline-manage` 的同一份判定函数，不重写 |
| AI 生成质量波动 | 写作工作台保留"分段重写""指定章节重写"按钮，不强迫一次过 |
| 字数前后端不一致 | 后端为唯一真相，前端只做实时反馈，提交时以后端为准 |
| 文件被外部编辑 | Watcher 检测变更 → 标"外部修改"角标 → 用户确认覆盖 / 重载 |
| 复盘数据无法自动回收 | 明确人工录入，提供"复盘催办"提醒，不假装能爬 |

---

## 12. 与现有资产的映射关系

| 现有 | 映射到 BookFlow |
|---|---|
| `SOP.md` | 规则引擎权威源（不动） |
| `pipeline-manage/SKILL.md` | 阶段判定 + 字数校验 + 发布检查后端逻辑 |
| `DASHBOARD.md` | Dashboard 页 + 操作日志，UI 操作回写此文件 |
| `pipeline/N-阶段/` | 数据真相源，UI 读写此目录 |
| `playbook/*.md` | 写作手册页只读渲染 + 写作工作台右栏嵌入 |
| `tracks/*.md` | 赛道配置页编辑对象 |
| `templates/project-template/` | 立项创建时的初始模板 |
| `archive/` | 归档页历史浏览源 |

---

## 13. 参考实现路径映射（GEOFlow → BookFlow）

> 把每个 BookFlow 模块对应到 GEOFlow 的真实文件，实施时直接对照抄。
> 路径前缀：`/Users/lany-xiaosheng/Desktop/990Pro/个人知识库/输入/AIGEO/GEOFlow/`

### 13.1 Layout / 通用骨架

| BookFlow 模块 | GEOFlow 参考文件 | 抄什么 |
|---|---|---|
| 页面外壳 | `resources/views/admin/layouts/app.blade.php` | DOCTYPE / `bg-gray-50` / `<main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">` / flash 提示 |
| 顶部导航 | `resources/views/admin/partials/header.blade.php` | h-16 nav / 菜单 active 高亮 / 通知铃 / 语言下拉 / 用户菜单（折叠 + 外点关闭） |
| 页脚 | `resources/views/admin/partials/footer.blade.php` | 版本号 + 链接 |
| 欢迎弹窗 | `resources/views/admin/partials/welcome-modal.blade.php` | 首次登录引导（BookFlow 复用：首次进入显示 SOP 速读） |

### 13.2 Dashboard

| 段 | GEOFlow 参考 | BookFlow 改造 |
|---|---|---|
| 整体五段结构 | `resources/views/admin/dashboard.blade.php` 1-587 行 | 全盘对齐，仅替换数据源 |
| `flowNodes` 流水节点 | 同上 90-343 行 | 7 节点 → 6 节点（番茄阶段） |
| `lanes` 通道 | 同上 lanes 渲染段 | 重构成"写作素材/近期产出/外部资源"三栏 |
| `healthCards` 健康卡 | 同上 523-535 行 | 4 张：在产/已发/待复盘/字数告警 |
| `skillResourceCards` | 同上 565-585 行 | 改为 SOP/Playbook/pipeline-manage 三入口 |
| 状态/色调 map | 同上 5-20 行的 `$statusStyles` `$toneStyles` | 直接复用 |

### 13.3 列表页范式（选题池/已发/归档）

| 抄什么 | 来源 |
|---|---|
| 标题区 + 操作按钮组 | `resources/views/admin/articles/index.blade.php` 28-67 行 |
| 筛选条 + 搜索 | 同上的 filters 段（task_id / status / date_from / date_to / search） |
| 表格 + 分页 | 同上的 table + Laravel paginator |
| 批量操作 | 同上的 `toggleBatchActions()` JS 模式 |
| 回收站视图 | 同上 `$isTrashView` 分支 |
| 空态 | 同上 empty-state 段 |

### 13.4 表单页范式（评分卡/大纲编辑/赛道编辑）

| 抄什么 | 来源 |
|---|---|
| 单页表单骨架 | `resources/views/admin/tasks/form.blade.php` |
| 创建/编辑共用 form | `resources/views/admin/tasks/{create,edit}.blade.php` 都 include form |
| 富文本/markdown 编辑 | `resources/views/admin/articles/form.blade.php` |
| AI 生成集成 | `resources/views/admin/title-libraries/ai-generate.blade.php`（评论挖掘/标题拆解可对照） |

### 13.5 详情页范式（项目详情/已发详情）

| 抄什么 | 来源 |
|---|---|
| tab 切换 + 子内容卡 | `resources/views/admin/distribution/show.blade.php` |
| 关联资源面板 | `resources/views/admin/authors/detail.blade.php` |
| 历史/日志 timeline | `resources/views/admin/admin-activity-logs/index.blade.php` |

### 13.6 后端范式

| BookFlow | GEOFlow 参考 |
|---|---|
| Controller 组织 | `app/Http/Controllers/Admin/*Controller.php`（按业务对象一类一文件） |
| 路由前缀 + middleware | `routes/web.php` 的 `Route::prefix($adminPrefix)->name('admin.')->middleware(['admin.locale'])` 模式 |
| 认证 guard | `admin` guard + `admin.auth` middleware（直接复用 GEOFlow 已有的） |
| Service 层 | `app/Services/`（如 `DashboardStatsService` 风格） |
| Job / 异步 | `app/Jobs/`（写作 AI 调用建议异步，避免长请求阻塞） |
| 配置 | `config/geoflow.php` 范式 → `config/bookflow.php`（admin_base_path / 字数底线 / LLM 配置） |
| 国际化 | `lang/{locale}/admin.php` → `lang/{locale}/bookflow.php` |

### 13.7 资源映射速查（最关键 10 个）

```
GEOFlow                                                    →  BookFlow
─────────────────────────────────────────────────────────────────────
admin/dashboard.blade.php                                  →  bookflow/dashboard.blade.php
admin/layouts/app.blade.php                                →  bookflow/layouts/app.blade.php
admin/partials/header.blade.php                            →  bookflow/partials/header.blade.php
admin/articles/index.blade.php                             →  bookflow/seeds/index.blade.php
admin/articles/form.blade.php                              →  bookflow/projects/outline.blade.php
admin/tasks/form.blade.php                                 →  bookflow/seeds/scorecard.blade.php
admin/title-libraries/ai-generate.blade.php                →  bookflow/seeds/ai-brainstorm.blade.php
admin/distribution/show.blade.php                          →  bookflow/projects/show.blade.php
admin/analytics/index.blade.php                            →  bookflow/retros/index.blade.php
admin/site-settings/index.blade.php                        →  bookflow/settings/index.blade.php
```

---

## 14. 落地路径建议（二选一）

### 路径 A：BookFlow 作为 GEOFlow 的扩展模块（推荐用于快速验证）

把 BookFlow 直接做成 GEOFlow 的一个 namespace，复用其登录 / guard / layouts / lang / 中间件。

| 项 | 操作 |
|---|---|
| 路由 | 在 `routes/web.php` 追加 `Route::prefix('bookflow')->name('bookflow.')->middleware(['admin.auth'])` 组 |
| Controller | 新建 `app/Http/Controllers/BookFlow/*Controller.php` |
| 视图 | `resources/views/bookflow/` 目录，layout extend `admin.layouts.app` 或自建 |
| 配置 | `config/bookflow.php` |
| 数据 | 新建 migrations，但**真相源仍是文件系统**（pipeline/ 目录） |
| 文件根 | 配置项 `bookflow.pipeline_root = /path/to/番茄短篇工厂/pipeline`，绝对路径 |

**优点**：登录/权限/i18n/UI 全部白拿，1 周可见可用原型。
**缺点**：与 GEOFlow 业务耦合，发布节奏被 GEOFlow 拽住。

### 路径 B：独立 fork 一个 BookFlow 仓库（推荐用于长期维护）

`git clone GEOFlow → bookflow`，删掉 GEOFlow 业务模块（articles/distribution/url-import/ai-prompts 等），保留：

- Laravel 骨架 + auth + admin layout + i18n
- header / footer / 通知系统 / 语言切换
- dashboard 五段式骨架（替换数据源）
- 公共组件 / 状态色调 / 按钮样式

**优点**：干净的命名空间、独立发布、独立配置。
**缺点**：需要清理无关代码 ~2-3 天，但视觉/交互完全沿用 GEOFlow 的成果。

### 决策建议

- **个人/小团队 + 短期目标（3 个月内验证）**：选 A
- **打算长期作为独立产品维护**：选 B
- **临时折中**：先 A 验证 4-6 周，确认价值后再 fork 为 B

---

**文档结束。下一步**：基于本文档拉一份原型稿（直接用 Tailwind play-cdn + Lucide 写静态 HTML），跑通 Dashboard + 写作工作台两个最复杂页，再决定走路径 A 还是 B。
