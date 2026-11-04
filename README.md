# CAgent

CAgent 是面向校园场景的智能体基础平台。校园导览应用组合知识检索、办事入口、校内地图和结构化回答；管理端提供资料维护、智能体配置、反馈纠错与使用统计。

## 功能

- 多供应商模型、权限与额度控制，流式多轮对话和回答版本切换。供应商模型嗅探支持勾选去重导入，新模型默认禁用。内置模型、供应商、智能体及技能均可移除，关联历史保留。
- 内嵌与外挂知识库：独立启停、文件/表浏览、固定问答、管理员纠错、主题检索与来源面板。支持 PostgreSQL/MySQL 外部只读资料源与可配置公众号采集接入。
- 受约束的呈现协议：卡片、流程清单、表格、图表、表单和地图；结构校验、文字回退、首错自动重新渲染与错误反馈。支持固定卡片、新式排版、文字为主三种偏好。
- 导览及链接点击统计。
- 回答缓存，保留天数和开关可配置；支持服务商上下文缓存统计与固定提示词前缀优化，区分命中、未命中和未报告。详见[服务商缓存说明](docs/provider-cache.md)。图片自动压缩与真实上传进度。
- **验证集批量测试**：仅支持两列 Excel 上传与结果 Excel 下载；模型、公共知识库可选，回答固定精简模式，参考答案与模型隔离。访问 `/admin/evaluations`。
- 全站长期记忆与进入引导弹窗开关。关闭记忆同时停止读取、注入、自动提取与创建，当前会话上下文继续有效。

个人课表及浏览器扩展方案已移除。改为独立「集体课表」知识库，支持普通 HTTP 采集、管理员 JSON 上传、课程/院系/周次/时间查询及独立启停；不代表用户实际选课。资料由部署方自行导入与更新。

## 模型最佳实践

本项目推荐的最佳实践模型为 **deepseek-v4.1-flash**，用于校园问答、工具调用与新式排版。请在「模型与供应商」配置实际可用的模型 ID、接口和自己的密钥；名称以接入服务商为准。本仓库不附带模型访问权限。

## 知识库与部署配置

地图仅保留通用占位示例，实际地图需部署方配置。

源码仓库不附带知识库正文、知识索引、评测数据、课表快照或校园配置初始化包。新部署需自行维护资料，或通过受控渠道获取有权使用的部署包；模型密钥、公众号授权和外部数据库凭据由部署方配置。

导入工具继续保留。取得部署包后，将其中的 `ucass-profile` 放到仓库外的受控位置，再按 [更新与还原说明](docs/update-deployment.md) 校验并导入。请勿把资料包、数据库或测试结果提交回 Git。

公众号采集部署见 [WeRSS 说明](deploy/werss/README.md)。

## 技术结构

前端：Vue 3、TypeScript、Vite、Pinia、Element Plus。后端：NestJS、Prisma、PostgreSQL、模型标准工具调用和 SSE。AgentRuntime 采用显式状态节点、工具结果缓存、写入账本与私有检查点，**目前不是 LangGraph SDK 应用**。

模型负责理解任务和组织数据，UI 协议负责组件选择，前端渲染器负责展示。来源、链接动作与工具参数在服务端校验；正文中的伪工具调用不会直接执行。

```text
apps/api/       API、AgentRuntime、知识管理、批量测试
apps/web/       学生端、管理端、匿名体验页
presentation/   呈现协议与同步工具
evaluation/     测试集格式协议与同步工具
knowledge/      知识处理工具（不含资料）
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

数据库验证仅允许本地数据库，使用临时夹具并清理自身数据。结构测试通过不等同于线上模型可靠率保证。知识资料与部署配置由部署方单独管理，不随源码发布。

## 校园讲座与日历


`/lectures` 支持日历、筛选与原通知跳转。讲座资料由部署方通过后台导入或配置采集，不附带历史快照。详见 [讲座采集配置](docs/lectures.md)。

版本升级步骤见 [更新部署说明](docs/update-deployment.md)。系统设置展示前端及服务端构建版本；构建前运行 `node tools/write-build-info.mjs`。
