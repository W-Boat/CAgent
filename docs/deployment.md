# 通用部署说明

本文不包含既有生产服务器地址、账号或密钥。`campus.example.org` 是占位域名，部署时替换为自己的域名。运行密钥、模型和资料源均由部署方配置。

## 环境和配置

准备 Linux 主机、Docker Engine / Docker Compose、Git、Node.js 22 和根目录指定版本的 pnpm。前端在主机或 CI 中编译，API 由 Dockerfile 编译。

```sh
git clone https://github.com/W-Boat/CAgent.git
cd CAgent
cp .env.example .env
chmod 600 .env
openssl rand -hex 32  # JWT_SECRET，填入 .env
openssl rand -hex 32  # 独立的 ENCRYPTION_KEY
openssl rand -hex 24  # DB_PASSWORD
```

填写自己的配置，不要使用样例密码：

```dotenv
NODE_ENV=production
DB_PASSWORD=<自行生成>
DATABASE_URL=postgresql://cagent:<URL编码后的密码>@127.0.0.1:5432/cagent?schema=public
JWT_SECRET=<独立认证密钥>
ENCRYPTION_KEY=<独立加密密钥>
SEED_ADMIN_EMAIL=<自己的邮箱>
SEED_ADMIN_PASSWORD=<自己的强密码>
SEED_ADMIN_NAME=管理员
WEB_ORIGIN=https://campus.example.org
SITE_ORIGIN=https://campus.example.org
VITE_SITE_ORIGIN=https://campus.example.org
ENABLE_DOCS=false
```

本地开发使用自己的 PostgreSQL 地址；Compose 在 API 容器中将数据库主机覆盖为服务名 `db`，密码来自 `DB_PASSWORD`。默认不对外开放数据库端口。不要随意改变已有 ENCRYPTION_KEY，它用于解密后台保存的供应商密钥。

## 编译、启动和初始化

```sh
npx pnpm@11.8.0 install --frozen-lockfile
node presentation/sync.mjs
node evaluation/sync.mjs
SITE_ORIGIN=https://campus.example.org npx pnpm@11.8.0 --filter @cagent/web build
docker compose up -d --build
docker compose logs --tail=100 api
# 首次安装执行一次，升级时不应无条件重新 seed
docker compose exec api node dist/prisma/seed.js
```

API 启动时执行 `prisma migrate deploy`。在后台添加自己的模型供应商，或通过环境变量配置密钥。未配置可用模型时聊天会提示先配置。

初始管理员密码至少 12 个字符，初始化不会打印密码。默认不创建演示账号；确需本地演示时显式设置 `SEED_DEMO_USERS=true` 和自己的 `SEED_DEMO_PASSWORD`。

Web 默认监听主机 8080 端口；用自己的 HTTPS 反向代理转发该端口，模板见 `deploy/site.example.conf`，证书路径须替换为有效证书。保留 SSE 关闭缓冲和 300 秒读取超时。内置 Nginx 禁止访问私有运行目录，不应移除相关规则。扩展属于可选组件，使用时将其站点配置改为自己的部署地址。

## 知识资料

原始资料不随源码发布。可通过后台维护资料库，或导入提供的示例索引：

```sh
docker cp knowledge/dist/campus-kb.json cagent-api:/tmp/campus-kb.json
docker compose exec api node scripts/import-campus-guide.mjs /tmp/campus-kb.json
```

2.0 资料按 `scripts/import-campus-v2.mjs` 的参数说明单独导入。升级时不要无条件重导，避免覆盖已有配置。外部 PostgreSQL/MySQL 使用所需表的专用只读账号。公众号采集为可选项，需要自己的采集器地址、访问凭据和订阅列表，先测试文章读取，再开启自动同步。

## 测试和全站控制

`conversation:read` 管理员可访问 `/admin/evaluations` 和 `/api/evaluations`，导入 JSON/CSV，按批次执行多轮对话，导出包含题目及完整回复的 JSON/CSV。最多 500 题、每批 100 轮；使用执行账号的正常额度，默认绕过缓存，不读写个人长期记忆，仅执行只读工具。

任务保存在 PostgreSQL。当前执行器面向**单 API 实例**，不要横向运行多个实例共享该队列。重启后未完成任务标记中断，已完成结果保留；重新创建任务后再次执行。详情见 [批量测试接口](evaluation-api.md)。

后台「系统设置 → 通用」提供「全站记忆功能」与「进入引导弹窗」开关。关闭记忆不删除旧记忆，也不清空当前会话上下文；引导还受学生端独立开关控制。

## 备份和升级

保存数据库、`.env`、存储卷、镜像标识和静态构建。通用示例：

```sh
mkdir -p backups
docker compose exec -T db pg_dump -U cagent -d cagent -Fc > backups/database.dump
docker compose exec -T db pg_restore -l < backups/database.dump > backups/database-contents.txt
# storage 卷和 .env 另行备份到受控位置，不提交 GitHub
git pull --ff-only
npx pnpm@11.8.0 install --frozen-lockfile
SITE_ORIGIN=https://campus.example.org npx pnpm@11.8.0 --filter @cagent/web build
docker compose up -d --build
docker compose logs --tail=100 api
```

升级后验证登录、模型配置、校园查询、来源链接和小测试集下载。创建夹具的验证脚本仅在本地数据库运行。回滚时恢复对应镜像和静态文件；需要数据库回滚时使用匹配版本的备份，不能直接删除迁移记录。

## 部署方声明

部署方负责自己的域名、HTTPS、运行密钥、数据库、备份、模型供应商，以及资料更新和使用授权。真实密钥仅通过环境变量或后台加密存储配置，不得放入源码仓库或测试结果。校园办事要求以对应部门最新正式通知为准。
