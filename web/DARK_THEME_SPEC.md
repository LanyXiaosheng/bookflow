# 暗色玻璃主题转换规范（临时文件，全铺完成后删除）

目标：把浅色页面转成「纯暗底 + 半透明玻璃卡片」风格，与已完成的 Shell / Dashboard / Auth 保持一致。同时优化交互细节（hover / 过渡 / 焦点态）。

## 铁律
- **只改样式 class，绝不动逻辑**：不改 hooks、状态、事件处理、数据流、data-testid、条件渲染结构、import 的非样式部分。
- **保留所有 `data-testid`**（Playwright 测试依赖它们）。
- 改完这个文件负责的范围后，不要碰别的文件。

## 全局已就绪的 CSS token（直接用，别重新发明）
定义在 `src/index.css`，可复用：
- `.glass-card` — 主玻璃面板（圆角 2xl + 白色 10% 边框 + 白 4% 底 + 内高光 + 外阴影 + backdrop-blur-xl）。替代原来的 `bg-white shadow-sm ring-1 ring-gray-200` / `rounded-lg bg-white ...`。
- `.glass-inset` + `.glass-inset-hover` — 内嵌行 / 次级容器（替代 `border-gray-100 bg-gray-50` 这类列表行）。
- `.glass-pill` — 胶囊按钮（替代次级/描边按钮）。
- `.glass-field` — 输入框外壳（替代 `border border-gray-300` 的输入容器）。

## 颜色映射表（浅 → 暗）

### 底与容器
| 浅色 | 暗色 |
|---|---|
| `bg-white`（作为卡片） | 用 `.glass-card`（去掉原 `bg-white shadow-* ring-*`） |
| `bg-gray-50` / `bg-gray-100`（页面/次级底） | `bg-white/[0.02]` 或 `.glass-inset` |
| `border-gray-200` / `border-gray-300` / `border-gray-100` | `border-white/10`（细分隔用 `border-white/[0.06]`） |
| `divide-gray-100` / `divide-gray-200` | `divide-white/10` |
| `ring-gray-200` / `ring-1 ring-gray-200` | 并入 `.glass-card`，或 `ring-white/10` |
| `shadow-sm` / `shadow-md` / `shadow-lg` | 并入 `.glass-card`，独立时用 `shadow-black/40` |

### 文字
| 浅色 | 暗色 |
|---|---|
| `text-gray-900` | `text-white`（标题）/ `text-gray-100`（正文强调） |
| `text-gray-700` / `text-gray-800` | `text-gray-200` |
| `text-gray-600` / `text-gray-500` | `text-gray-400` |
| `text-gray-400`（次级/占位） | `text-gray-500` |
| `placeholder:text-gray-400` | `placeholder:text-white/40` |

### hover / 交互态
| 浅色 | 暗色 |
|---|---|
| `hover:bg-gray-50` / `hover:bg-gray-100` | `hover:bg-white/5` / `hover:bg-white/10` |
| `hover:bg-blue-50` | `hover:bg-white/[0.06]` 或 `hover:bg-blue-500/10` |
| `hover:border-blue-100` | `hover:border-white/20` |
| `focus:ring-blue-300` / `focus:ring-blue-100` | `focus:ring-white/25` |

### 语义色（保留色相，降饱和 + 半透明，适配暗底）
统一模式：**彩色文字用 `-300/-400`；彩色底用 `-500/10` 或 `-500/15`；彩色边用 `-400/30` 或 `-500/30`**。
| 浅色（举例） | 暗色 |
|---|---|
| `bg-blue-600 text-white`（主按钮）| **保持**（主 CTA 仍用实心 `bg-blue-600 hover:bg-blue-500 text-white`） |
| `bg-blue-50 text-blue-700` | `bg-blue-500/10 text-blue-300 border border-blue-400/20` |
| `bg-emerald-100 text-emerald-700` | `bg-emerald-500/15 text-emerald-300` |
| `bg-amber-50 text-amber-700` | `bg-amber-500/10 text-amber-300` |
| `bg-rose-50 text-rose-700` / `text-rose-600` | `bg-rose-500/10 text-rose-300` |
| `bg-violet-100 text-violet-700` | `bg-violet-500/15 text-violet-300` |
| `bg-sky-100 text-sky-700` | `bg-sky-500/15 text-sky-300` |
| `border-*-100/200`（彩色卡边） | 同色 `-400/20` 或 `-500/30` |
| 彩色卡片整块（如 `border-blue-100 bg-blue-50`） | `border-blue-400/20 bg-blue-500/[0.07]` |

### 图标底座（如 `bg-blue-50 text-blue-600` 的圆角方块）
→ `bg-blue-500/15 text-blue-300`（其他色同理）。

### 主按钮（实心 CTA）
- `bg-blue-600 ... hover:bg-blue-700` → `bg-blue-600 ... hover:bg-blue-500`（保持实心蓝，hover 提亮而非加深）。
- 白底黑字按钮（如 Auth 的）→ 保持 `bg-white text-black hover:bg-gray-200`。

## 交互细节优化（转色的同时顺手加）
- 所有可点卡片/行：确保有 `transition-colors` 或 `transition`；加 `hover:` 态（用上表的 hover 映射）。
- 列表行 / 卡片 hover：`.glass-inset .glass-inset-hover` 已含过渡，直接用。
- 卡片轻微上浮效果可保留（`hover:-translate-y-0.5`），配 `transition`。
- 骨架屏 `animate-pulse` 的占位块：`bg-white` → `bg-white/5`。
- 进度条底：`bg-*-100` → `bg-white/10`，填充条保持语义色 `-500`。

## 验收
- 改完范围内所有文件后，在 `web/` 跑 `npm run build`（tsc + vite）确认零错误。
- 目视检查：不应残留 `bg-white`（除白底 CTA 按钮）、`text-gray-900`、`border-gray-200/300`、`bg-gray-50/100` 作为容器底。
- data-testid 一个不少。

## 回报格式
只回：改了哪些文件 + 每个文件的改动摘要（1-2 句）+ build 是否通过。别把整份代码贴回来。
