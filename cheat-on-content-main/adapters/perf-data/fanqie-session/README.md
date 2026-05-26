# Adapter: fanqie-session（番茄小说数据抓取）

被 `/cheat-retro` 在 `state.data_collection=adapter` + `platform=fanqie` 时自动调用。

---

## 这个 adapter 是干嘛的

番茄小说（fanqienovel.com）是字节跳动旗下网文平台。创作者后台在 `fanqienovel.com/main/writer/`。

fanqie-session 用 **Playwright + 持久化 Chromium context** 模拟真实浏览器：
- 首次登录后 cookie 存在你的内容项目根目录 `.auth-fanqie/`
- 之后每次抓取直接复用 cookie，不用重新登录
- 拦截前端 XHR responses 直接抓数据接口的 JSON（不解析 HTML）
- 已验证 API：`/api/author/short_article/list/v0/`（短篇作品列表）

输出写到你的内容项目 `videos/<...>/report.md`。
调试产物写到 `.cheat-cache/fanqie-session-debug/`。

---

## 前置条件

两种模式可选：

| 模式 | 依赖 | 安装成本 | 能力 |
|---|---|---|---|
| **Lite（推荐）** | Python 3.10+ 即可 | 0 额外依赖 | 作品列表 + 阅读数据 |
| Full | Python 3.10+ + Playwright + Chromium | ~500MB | 列表 + 详情 + 评论 |

Lite 模式用纯 HTTP 调 API，只需要从浏览器复制一次 cookie。

---

## 安装 — Lite 模式（推荐，30 秒）

```bash
# 1. 进你的内容项目根目录
cd ~/my-channel

# 2. 创建 cookie 目录
mkdir -p .auth-fanqie

# 3. 从浏览器获取 cookie：
#    a) 打开 https://fanqienovel.com/main/writer/short-manage
#    b) F12 → Network → 刷新页面
#    c) 点任意 XHR 请求（如 short_article/list）
#    d) 复制 Request Headers 里的 Cookie 值（整行）
#    e) 粘贴到文件：
pbpaste > .auth-fanqie/cookies.txt
# 或手动：echo '你的cookie值' > .auth-fanqie/cookies.txt

# 4. 验证
ADAPTER="path/to/cheat-on-content/adapters/perf-data/fanqie-session"
python3 "$ADAPTER/crawler_lite.py"
# 应输出你的作品列表
```

---

## 安装 — Full 模式（需要评论数据时）

```bash
cd ~/my-channel
python3 -m venv .venv
source .venv/bin/activate
pip install playwright>=1.44
playwright install chromium

ADAPTER="path/to/cheat-on-content/adapters/perf-data/fanqie-session"
python "$ADAPTER/crawler.py" login
# → 弹出 Chromium 窗口，登录后自动关闭
```

---

## 日常用法

### 自动模式（推荐）

配置好后，cheat-retro 自动调用，你不需要手动跑：

```
# 在 Claude Code 里
已发布 https://fanqienovel.com/page/7639788525784662552
# → cheat-publish 自动识别平台为 fanqie，提取 item_id

# T+3 天后
复盘 predictions/2026-05-11_xxx_民政局排号那天.md
# → cheat-retro 自动调 fanqie-session adapter 抓数据
```

### 手动模式（调试 / 测试）

```bash
cd ~/my-channel
source .venv/bin/activate

# 列最近作品（验证登录态）
python "$ADAPTER/review.py" list

# 抓特定作品的完整数据（列表 + 详情 + 评论）
python "$ADAPTER/review.py" work 7640055308248697881

# 带稿子一起抓（稿子会写入 report.md）
python "$ADAPTER/review.py" work 7640055308248697881 ./scripts/民政局.md

# 交互式选择（弹出列表让你选）
python "$ADAPTER/review.py"
```

---

## 怎么拿到 work_id / item_id

番茄小说有两个 ID：

| ID | 用途 | 来源 |
|---|---|---|
| `book_id` | 作品管理 ID（创作者后台用） | API 返回的 `book_id` 字段 |
| `item_id` | 前台阅读页 ID | URL 路径：`fanqienovel.com/page/<item_id>` |

**获取方式**：
- 前台页面 URL：`https://fanqienovel.com/page/7639788525784662552` → `item_id = 7639788525784662552`
- 创作者后台：`review.py list` 输出的第一列就是 `book_id`
- cheat-publish 登记时自动从 URL 提取并存入 prediction header

---

## 配置 cheat-on-content 使用此 adapter

### 新用户（首次 init）

跑 `/cheat-init` 时选择平台 → 选 **d) 番茄小说**，自动配置。

### 已有用户（手动配置）

编辑你项目根目录的 `.cheat-state.json`：

```json
{
  "data_collection": "adapter",
  "enabled_perf_adapters": ["fanqie-session"]
}
```

---

## report.md 输出格式

由 `renderer.py` 生成，示例：

```markdown
# 民政局排号那天，他的白月光把孕检单发进了家族群

- 作品 ID：`7640055308248697881`
- 内容 ID：`7639788525784662552`
- 发布时间：2026-05-11 15:36
- 最近更新：2026-05-11 15:36
- 字数：1.6w
- 分类：婚姻家庭 / 追妻火葬场 / 打脸逆袭
- 签约状态：恭喜你成功签约
- 链接：https://fanqienovel.com/page/7639788525784662552
- 抓取时间：2026-05-23 15:04

## 阅读数据

- 阅读：1.6w
- 收藏：-（需从详情页获取）
- 评论：-
- 点赞：-
- 打赏：-

## 评论（按点赞降序，共 N 条）

- [👍12] 评论内容...
- [👍8 💬3] 评论内容...
```

---

## 已验证的 API 结构

基于 2026-05 实测：

**短篇列表接口**：`GET /api/author/short_article/list/v0/`

```
参数：aid=2503&app_name=muye_novel&page_count=10&page_index=0&status=0&time_sort=0
响应：
{
  "code": 0,
  "data": {
    "item_list": [{
      "book_id": "7640055308248697881",
      "item_id": "7639788525784662552",
      "multi_title": ["标题"],
      "read_count": "15589",        ← 字符串
      "word_number": 16165,          ← 整数
      "create_time": "1778838995",   ← 字符串 timestamp
      "category": [{name: "婚姻家庭"}, ...],
      "sign_status": 5,             ← 5=已签约
      "is_data_show": 1             ← 1=可查看数据
    }],
    "total_count": 47
  }
}
```

---

## 失败模式与排查

| 症状 | 原因 | 处理 |
|---|---|---|
| `ensure_login` 超时 | cookie 过期 | 重新跑 `python crawler.py login` |
| `_parse_work_list` 返回空 | 接口字段变化 | 看 `.cheat-cache/fanqie-session-debug/creator_urls.txt` |
| 评论抓取为空 | 评论页 XHR 路径变化 | 看 `debug/comment_urls.txt` |
| Chromium 崩溃 | 内存不足 | 关闭其他 Chrome 进程；`playwright install chromium --force` |
| `list` 命令只显示短篇 | 当前只拦截 short_article 接口 | 长篇接口路径待补充 |

**接口变化时的自救步骤**：
1. 打开 Chrome DevTools → Network → 手动操作创作者后台
2. 找到新的 API 路径和响应结构
3. 更新 `crawler.py` 的 URL 匹配规则和 `_normalize_work()` 字段映射

---

## 稳定性等级

★★☆ — Playwright 方案比纯 HTTP 强得多，但仍受平台前端改版影响。建议每月手动跑一次 `review.py list` 验证健康。

---

## 安全提示

- **不要把 `.auth-fanqie/` 提交到 git** — 里面是你的登录凭据
- **不要把 `.cheat-cache/` 提交到 git** — 含调试截图和接口 URL
- 项目 `.gitignore` 已默认排除这两个目录
- 只抓自己账号的数据，个人用途

---

## 文件清单

```
adapters/perf-data/fanqie-session/
├── README.md            # 本文件
├── requirements.txt     # playwright>=1.44（仅 full 模式需要）
├── paths.py             # 路径解析（PROJECT_ROOT / auth / debug / videos）
├── crawler_lite.py      # 轻量抓取（纯 HTTP，零依赖）
├── review_lite.py       # lite 模式 CLI 入口
├── crawler.py           # 完整抓取（Playwright，含评论）
├── review.py            # full 模式 CLI 入口
├── renderer.py          # JSON → report.md 渲染
└── run.sh               # cheat-retro 调用的 wrapper（自动选 lite/full）
```

---

## 与其他 adapter 的关系

| Adapter | 平台 | 方案 | 状态 |
|---|---|---|---|
| `douyin-session` | 抖音 | Playwright | ✅ 已验证 |
| **`fanqie-session`** | **番茄小说** | **Playwright** | **✅ 已验证** |
| `youtube-data-api` | YouTube | 官方 API | 待开发 |
| `bilibili-stat` | B 站 | 公开接口 | 待开发 |
| `xhs-explore` | 小红书 | Playwright | 待开发 |

如果你做多平台内容，**只装你实际用的 adapter**——不需要全装。
