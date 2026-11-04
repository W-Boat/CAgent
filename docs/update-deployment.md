# CAgent 保留数据更新说明

在项目根目录执行。先结束批量任务，保存本机未提交修改；不要清空数据库、审计日志、知识库或 storage，不要重新执行 seed/campus:init。

## 1. 备份

```sh
docker compose stop api
docker compose exec -T db pg_dump -U cagent -d cagent -Fc -f /tmp/before-upgrade.dump
docker cp cagent-db:/tmp/before-upgrade.dump ./before-upgrade.dump
```

另存 `.env`、storage、上一版 API 镜像和前端 dist。数据库名及账号按实际配置替换。

## 2. 同时更新前后端

```sh
git pull --ff-only
npx pnpm@11.8.0 install --frozen-lockfile
node tools/write-build-info.mjs
npx pnpm@11.8.0 --filter @cagent/api db:generate
npx pnpm@11.8.0 --filter @cagent/web build
docker compose build api
docker compose up -d --no-deps api web
```

构建前将 SITE_ORIGIN 环境变量设为自己的站点地址。API 启动自动执行增量迁移。沿用原 `.env`、数据库卷及 storage 卷；不要运行 `docker compose down -v`。不要用空白初始化包覆盖当前资料。

原生 Windows 部署：执行同样的拉取、依赖安装及版本生成；构建 API/Web，执行 `npx pnpm@11.8.0 --filter @cagent/api db:deploy`，再重启原 Node 服务及反向代理。仅替换程序与网页文件，数据库和运行目录继续沿用。

## 3. 验收

在系统设置查看前后端构建版本。确认原用户、会话与知识库仍在，检查新版 Excel 批量测试、配置移除和供应商「嗅探模型」。新嗅探模型默认禁用，核对能力及价格后再启用。

全站删除兼容使用 POST 加 X-CAgent-Method 请求头；须同时更新 API 与前端。移除模型、供应商、智能体、技能会停用并隐藏配置，保留历史记录；移除供应商同时移除其模型的可用配置。知识库仍须输入全名确认，资料保留。内置身份不再禁止移除。

异常时查看 `docker compose logs --tail=100 api`；恢复上一版 API/Web。涉及数据库回退时先停机，再恢复匹配备份。知识库部署包只用于新环境导入，不参与日常升级。
