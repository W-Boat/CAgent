# CAgent

CAgent 是面向校园场景的智能体基础平台。校园导览应用组合知识检索、办事入口、校内地图和结构化回答；管理端提供资料维护、智能体配置、反馈纠错与使用统计。

## 功能

- 多供应商模型、权限与额度控制，流式多轮对话和回答版本切换。
- 内嵌与外挂知识库：独立启停、文件/表浏览、固定问答、管理员纠错、主题检索与来源面板。支持 PostgreSQL/MySQL 外部只读资料源与可配置公众号采集接入。
- 受约束的呈现协议：卡片、流程清单、表格、图表、表单和地图；结构校验、文字回退、首错自动重新渲染与错误反馈。支持固定卡片、新式排版、文字为主三种偏好。
- 导览及链接点击统计。
- 回答缓存，保留天数和开关可配置；图片自动压缩与真实上传进度。
- **批量对话测试**：`/admin/evaluations` 和鉴权接口 `/api/evaluations` 接收 JSON/CSV 测试集、验证集。同批次保留多轮上下文，批次独立；导出包含批次、轮次、题目、回复、状态和用量的 JSON/CSV。
- 全站长期记忆与进入引导弹窗开关。关闭记忆同时停止读取、注入、自动提取与创建，当前会话上下文继续有效。

个人课表及浏览器扩展方案已移除。改为独立「集体课表」知识库，支持普通 HTTP 采集、管理员 JSON 上传、课程/院系/周次/时间查询及独立启停；不代表用户实际选课。详见 [集体课表部署和更新说明](knowledge/collective-timetable/README.md)。代码已移除退役的社论检索和情侣空间实现，不提供重新启用入口。

## 恢复当前校园应用配置

仓库现在包含当前校园应用的可公开初始化包：[deploy/profiles/ucass](deploy/profiles/ucass)。包含 **28,985 条内嵌知识索引、39 个库配置、39 条已发布外挂知识条目、4 个共享 Agent、7 个技能、55 项设置及模型参数**，保留库分类/启停、快捷按钮、提示词、检索深度、缓存、主题和输出设置。索引包含用于兼容的旧资料，实际检索范围遵循各库开关；2.0 模拟资料保留当前关闭状态。

完成上述迁移和管理员初始化后，本地执行：

```sh
npx pnpm@11.8.0 campus:check   # 检查文件完整性，不修改数据库
npx pnpm@11.8.0 campus:init    # 导入当前配置与知识内容
```

Docker 部署完成首次 seed 后执行：

```sh
docker cp deploy/profiles/ucass cagent-api:/tmp/ucass-profile
docker compose exec api node scripts/import-campus-profile.mjs /tmp/ucass-profile --apply
```

**集体课表补充恢复**：完成初始化后，在管理端「知识库 → 上传集体课表」上传仓库的 `knowledge/collective-timetable/catalog.json`，即可获得 666 条课程安排及学期总览，并自动创建独立启停的知识库与快捷按钮。学校系统变动后按 [更新说明](knowledge/collective-timetable/README.md) 重新采集上传。

站内资料链接自动使用自己的 `SITE_ORIGIN`。初始化默认要求没有知识库和聊天记录的数据库；重复执行会跳过，保留后台后续修改。已有站点先备份，确需追加时使用 `--allow-existing`，不删除原有条目。

**模型 API Key、接口地址、公众号登录和外部数据库凭据不随包共享。** 导入后在后台配置自己的模型供应商和有效模型，或使用 `.env` 中对应模型密钥；自有接口地址与密钥会保留。默认模型名称/能力参数随包提供，供应商支持的实际模型需自己确认，必要时切换模型。公众号保留账号名称配置，需在自己的采集器重新订阅并登录；外部连接在补齐配置前保持关闭。账户、个人记忆、聊天记录和运行缓存不会复制。

公众号可使用 [WeRSS 部署通道](deploy/werss/README.md)，支持微信读书 Web 扫码、批量订阅、定时采集与正文检查。扫码授权和文章目录读取成功，不代表正文可读；微信验证或限流时会明确显示状态并暂停重复请求，只有可用正文才同步为知识库草稿。

完整导入步骤和范围见 [初始化包说明](deploy/profiles/ucass/README.md)。测试在独立本地数据库 schema 完整导入全部资料，验证业务规则、库开关、站内链接及重复导入保护，无外部模型调用。

## 技术结构

前端：Vue 3、TypeScript、Vite、Pinia、Element Plus。后端：NestJS、Prisma、PostgreSQL、模型标准工具调用和 SSE。AgentRuntime 采用显式状态节点、工具结果缓存、写入账本与私有检查点，**目前不是 LangGraph SDK 应用**。

模型负责理解任务和组织数据，UI 协议负责组件选择，前端渲染器负责展示。来源、链接动作与工具参数在服务端校验；正文中的伪工具调用不会直接执行。

```text
apps/api/       API、AgentRuntime、知识管理、批量测试
apps/web/       学生端、管理端、匿名体验页
knowledge/collective-timetable/ 全校课表初始快照和更新说明
presentation/   呈现协议与同步工具
evaluation/     测试集格式协议与同步工具
knowledge/      知识处理、索引与地图
deploy/         通用反向代理及部署配置
docs/           部署与测试接口说明
```

## 快速开始

本项目使用 Node.js 22 进行本地测试。包管理器版本以 `package.json` 的 `packageManager` 为准。

```sh
cp .env.example .env
# 填写自己的数据库、独立认证/加密密钥和初始管理员账号
npx pnpm@11.8.0 install --frozen-lockfile
npx pnpm@11.8.0 --filter @cagent/api db:generate
npx pnpm@11.8.0 --filter @cagent/api db:deploy
npx pnpm@11.8.0 db:seed
npx pnpm@11.8.0 dev
```

本地前端默认 `http://localhost:5173`，接口文档 `http://localhost:3001/api/docs`。模型供应商自行配置。不要提交真实 `.env`、数据库备份和密钥。

完整步骤见 [部署说明](docs/deployment.md)，输入格式与下载接口见 [批量对话测试](docs/evaluation-api.md)。默认单 API 实例；批量任务重启后标记中断并保留结果，需要重新创建任务才能继续执行。

## 验证

```sh
node presentation/sync.mjs
node evaluation/sync.mjs
npx pnpm@11.8.0 build
npx pnpm@11.8.0 --filter @cagent/api exec ts-node --transpile-only scripts/verify-evaluation-platform.ts
npx pnpm@11.8.0 agent:verify
```

数据库验证仅允许本地数据库，使用临时夹具并清理自身数据。结构测试通过不等同于线上模型可靠率保证。当前可公开知识索引与共享配置随初始化包发布；原始资料文件、运行记录、个人数据、密钥和生产交接资料不上传。资料截至包内导出日期，部署方负责核对来源、适用时间及后续更新。
