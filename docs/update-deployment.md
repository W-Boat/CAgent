# CAgent 更新部署版本

适用于已有部署。先在测试环境检查，再更新正式环境；不要删除数据库卷、重新初始化数据库或重复执行 seed。

## 备份与记录
记录设置页的前端/服务端构建版本、当前 Git 提交、镜像及环境变量文件位置。备份 PostgreSQL、storage 与私有环境配置；不要上传备份或密钥到 GitHub。

```sh
docker compose exec -T db pg_dump -U cagent -d cagent -Fc > before-upgrade.dump
git rev-parse HEAD
```

数据库账号和数据库名按自己的部署替换。备份应确认可被 pg_restore -l 读取。

## 获取、构建和迁移
先保存本机未提交的配置变更，禁止 git reset --hard 覆盖。代码仓库更新：

```sh
git pull --ff-only
npx pnpm@11.8.0 install --frozen-lockfile
node tools/write-build-info.mjs
npx pnpm@11.8.0 --filter @cagent/api db:generate
npx pnpm@11.8.0 --filter @cagent/web build
docker compose build api
```

设置自己的 SITE_ORIGIN 后再构建网页；可设置 BUILD_VERSION 为发布标签后运行版本生成脚本。Docker API 启动会执行 prisma migrate deploy，再启动服务；先确认备份及迁移兼容性，不能重复运行 db:seed 覆盖业务配置。

```sh
docker compose up -d --no-deps api web
docker compose logs --tail=100 api
```

网页发布路径取决于 compose/nginx 配置。若使用宿主机 dist 目录绑定，更新现有目录内的文件，保留目录本身和旧哈希资产，防止挂载失效或已打开页面出现 404。原生 Windows 部署同样先生成版本、构建 API/Web、执行 prisma migrate deploy，再通过原有服务或计划任务重启 Node 和反向代理；按实际服务管理方式操作，禁止同时开启两份 API 消费批量任务。

## 版本核对与验收
登录「系统设置」查看前端与服务端构建版本和构建时间，两端应对应本次发布。不同通常表示静态文件未更新、API 未重启或缓存未刷新；不要通过修改页面文字冒充更新。检查登录、普通知识查询、所选模型和知识库、两列 Excel 上传、固定精简回复及三列 Excel 结果。失败/取消题也应保留在导出结果中。

## 知识库部署包
本次交付的 knowledge.sqlite 便于离线查看，完整字段保存在 data_json；CAgent 主数据库仍使用 PostgreSQL，不能直接拿 SQLite 设置 DATABASE_URL。新环境请使用包内 ucass-profile 和 README 的原生导入命令。它不含用户、聊天、验证集或密钥。已有环境更新代码通常不需要再次导入知识库；不要删除初始化标记或强行重复导入，资料更新应走后台维护或经过核对的增量流程。

## 回滚
保留上一版构建、环境配置及数据库备份。应用更新失败时恢复上一镜像和前端文件并重启；只有在确实需要数据库回滚、已确认写入影响及停机窗口后，才恢复匹配的数据库备份。涉及不兼容迁移时不能只回退应用。批量任务更新前应等待完成或手动停止；重启中断的任务保留结果，需要重新创建任务继续测试。
