# BookFlow 静态原型

基于 [`../BOOKFLOW.md`](../BOOKFLOW.md) v0.2 的视觉验证稿。零依赖，双击 HTML 即可在浏览器打开。

## 文件

| 文件 | 内容 | 行数 | 范式 |
|---|---|---|---|
| `index.html` | 导航页 + 视觉基线色卡 | ~100 | — |
| `dashboard.html` | 看板（五段式：快速开始 / Pipeline 流水 / 健康指标 / Lanes / 技能资源） | ~630 | 展示型 |
| `write.html` | 写作工作台（三栏：大纲 / 正文 / AI 助手 + Step 进度条 + 字数 sticky） | ~530 | 工具型 |
| `seed-scorecard.html` | 选题评分卡（7 维 slider 实时改 SVG 雷达图 + 段位 + AI 选题加速 Drawer） | ~640 | 表单型 |

## 怎么看

```bash
open bookflow-prototype/index.html
```

或直接在 Finder 双击 `index.html`。

## 设计基线（一比一对齐 GEOFlow）

来源：阅读 `~/Desktop/990Pro/个人知识库/输入/AIGEO/GEOFlow/resources/views/admin/{layouts/app,partials/header,dashboard,articles/index}.blade.php` 后总结。

| 维度 | 取值 |
|---|---|
| 技术栈 | Tailwind play-cdn + Lucide CDN（无构建） |
| body 底色 | `bg-gray-50`（不是渐变、不是玻璃） |
| 主容器 | `max-w-7xl mx-auto py-6 sm:px-6 lg:px-8`（写作台用 max-w-1400 宽屏） |
| 导航 | **顶部水平**（`bg-white shadow-sm border-b`，h-16），不是左侧 SideNav |
| 卡片 | `bg-white rounded-lg shadow-sm ring-1 ring-gray-200`（平面，浅阴影） |
| 主色 | `blue-600` |
| 状态色 | emerald / blue / amber / red / violet / slate 六色，成对 `bg-X-100 text-X-700` |
| 字体 | 系统字 + 中文优先 PingFang SC |
| 图标 | Lucide |

## 范围与边界

**做了**：
- Dashboard 五段式骨架（含 6 节点 Pipeline 流水卡 + 推荐侧栏 + 4 联健康卡 + 3 栏 Lanes + 3 卡技能资源）
- 写作工作台三栏（大纲只读 + 正文章节卡 + AI 助手三 tab）+ 顶部 sticky 字数条 + 5 步进度条
- 选题评分卡（7 维 slider 实时驱动 SVG 雷达图 + 段位实时变色 + 立项按钮 ≥28 解锁 + AI 选题加速 Drawer 双 tab）
- 真实数据填充：当前赛道现言婚恋火葬场、立项 4 / 写作 5 / 待发 24 / 已发 7、用「他说前妻死了」「婚礼彩排那天伴娘群里弹出他和伴娘的开房记录」实际项目数据示范

**没做**（明确边界）：
- 写作工作台的字数实时计算、tab 切换是静态展示（Dashboard 同理）
- 阶段迁移确认 / 复盘录入这两个 Drawer
- 移动端响应式细节
- i18n（菜单写死中文）

## 下一步可选路径

1. **加交互**：用原生 JS 让 Dashboard 推荐侧栏可切换、写作台 tab 切换 + 字数实时计算跑起来（半天）
2. **加更多页**：立项编辑器（双栏 + 大纲 10 章卡片校验）/ 待发发布前检查 7 项 / 已发数据录入 Drawer
3. **进 Laravel**：照路径 A 把这三页改造成 Blade 模板放进 GEOFlow（1-2 天，可见真实数据）
4. **改设计**：基于这三页的视觉反馈调色调/间距/字号，定稿后再做下一页

