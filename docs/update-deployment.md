# CAgent 更新与知识库还原

在项目根目录执行；账号、数据库名按实际修改。先结束批量测试。

## 1. 停止 API 并备份

```sh
docker compose stop api
docker compose exec -T db pg_dump -U cagent -d cagent -Fc -f /tmp/before-upgrade.dump
docker cp cagent-db:/tmp/before-upgrade.dump ./before-upgrade.dump
```

另存 `.env`、storage 和上一版构建。

## 2. 清空审计日志

备份成功后执行，永久删除历史操作审计：

```sh
docker compose exec -T db psql -U cagent -d cagent -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE public.audit_logs;"
```

## 3. 更新版本

保存本机修改，在 `.env` 设置自己的 `SITE_ORIGIN`：

```sh
git pull --ff-only
npx pnpm@11.8.0 install --frozen-lockfile
node tools/write-build-info.mjs
npx pnpm@11.8.0 --filter @cagent/api db:generate
npx pnpm@11.8.0 --filter @cagent/web build
docker compose build api
docker compose up -d --no-deps api web
```

API 启动自动迁移。已有站点不要重复 seed 或删除数据卷。原生 Windows 部署须自行构建 API/Web、执行 `prisma migrate deploy`，再重启原服务。

## 4. 还原知识库

解压知识库部署包，取出 `ucass-profile`。以下仅用于完成迁移和管理员初始化、业务数据为空的新环境：

```sh
docker cp ucass-profile cagent-api:/tmp/ucass-profile
docker compose exec api node scripts/import-campus-profile.mjs /tmp/ucass-profile
docker compose exec api node scripts/import-campus-profile.mjs /tmp/ucass-profile --apply
```

先校验，再用 `--apply` 导入。包含 30,850 条索引、45 个库、289 条已发布条目；之后配置模型密钥并核对库开关。

`knowledge.sqlite` 仅供离线查看，主库仍为 PostgreSQL。已有站点升级跳过此步骤；不要删除初始化标记强行覆盖。已有资料误删，应从 PostgreSQL 备份恢复。

## 5. 验收与回退

在「系统设置」核对两端版本，测试登录、知识查询和 Excel 测试。异常查看 `docker compose logs --tail=100 api`；必要时回退 API/Web，数据库不兼容时停机恢复匹配备份。
