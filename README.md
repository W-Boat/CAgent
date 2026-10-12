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

个人课表按平台设置控制，启用时须另行配置学校网络及教务接入。代码已移除退役的社论检索和情侣空间实现，不提供重新启用入口。

## 技术结构

前端：Vue 3、TypeScript、Vite、Pinia、Element Plus。后端：NestJS、Prisma、PostgreSQL、模型标准工具调用和 SSE。AgentRuntime 采用显式状态节点、工具结果缓存、写入账本与私有检查点，**目前不是 LangGraph SDK 应用**。

模型负责理解任务和组织数据，UI 协议负责组件选择，前端渲染器负责展示。来源、链接动作与工具参数在服务端校验；正文中的伪工具调用不会直接执行。

```text
apps/api/       API、AgentRuntime、知识管理、批量测试
apps/web/       学生端、管理端、匿名体验页
apps/extension/ 可选浏览器扩展
presentation/   呈现协议与同步工具
evaluation/     测试集格式协议与同步工具
knowledge/      知识处理、示例索引与地图
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

数据库验证仅允许本地数据库，使用临时夹具并清理自身数据。结构测试通过不等同于线上模型可靠率保证。原始知识资料、运行记录、个人数据、密钥和生产交接资料不随源码发布；部署方负责替换资料的来源和适用时间。
