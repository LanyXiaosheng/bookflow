# 番茄短篇项目仓库

这个仓库现在有两个主要入口：

1. `bookflow/`
   一个可运行的番茄短篇生产平台，包含前后端、数据库、演示数据、登录、项目写作、复盘、通知和 AI 工作流。
2. 内容工厂资料目录
   包括 `pipeline/`、`playbook/`、`tracks/`、`templates/` 等，用于选题、写作、发布和沉淀方法论。

如果你的目标是“把系统跑起来给别人用”，直接看下面的 `Bookflow` 快速启动。  
如果你的目标是“查看内容生产资料和 SOP”，看后面的“资料目录说明”。

## Bookflow 快速启动

前置条件：

- Docker / Docker Compose
- Rust toolchain
- Node.js 20+
- pnpm

执行：

```bash
cd bookflow
cp .env.example .env
bash scripts/bootstrap-demo.sh
cd web
pnpm install
pnpm dev
```

启动后：

- 前端：`http://127.0.0.1:5174`
- 后端：`http://127.0.0.1:3000`
- 健康检查：`http://127.0.0.1:3000/healthz`

默认演示账号：

- 邮箱：`demo@bookflow.local`
- 密码：`Demo123456`

常用命令：

```bash
# 重置演示数据
cd bookflow
bash scripts/reseed-demo.sh

# 一键开发
cd bookflow
./dev.sh

# 运行 Rust 测试
cd bookflow
DATABASE_URL=postgres://bookflow:bookflow@localhost:5433/bookflow_dev cargo test --workspace
```

更完整的系统说明见：

- [bookflow/README.md](./bookflow/README.md)

## 资料目录说明

仓库根目录下的内容工厂资料仍然保留，主要用于写作与生产流程沉淀：

| 目录 | 用途 |
|------|------|
| `pipeline/` | 项目按阶段流转的生产管线 |
| `templates/` | 项目模板 |
| `playbook/` | 写作手册、去 AI 味、爆点节奏 |
| `tracks/` | 赛道配置、选题方向、标签体系 |
| `archive/` | 已归档内容 |
| `DASHBOARD.md` | 当前项目状态、本周目标、最近动态 |
| `SOP.md` | 生产 SOP 与阶段要求 |

## 仓库建议阅读顺序

如果你是第一次接手这个仓库，建议按这个顺序看：

1. [bookflow/README.md](./bookflow/README.md)
2. [BOOKFLOW.md](./BOOKFLOW.md)
3. [SOP.md](./SOP.md)
4. [DASHBOARD.md](./DASHBOARD.md)

## 当前推荐入口

- 要跑系统：进 `bookflow/`
- 要看生产资料：留在仓库根目录继续读 `SOP.md`、`DASHBOARD.md`、`pipeline/`
