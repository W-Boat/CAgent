# WeRSS 公众号采集通道

使用 [rachelos/we-mp-rss](https://github.com/rachelos/we-mp-rss) 的微信读书 **Web** 登录和文章读取路径。CAgent 的适配器继续负责批量订阅、定时计划、正文缓存、冷却和知识库同步；不调用原 WechRss 的移动端目录接口。普通微信读书授权即可使用，无需公众号运营权限。

## 版本与服务

- 原生运行时：WeRSS 1.5.3 官方镜像，摘要固定在 `Dockerfile` 中。
- 四份读取/授权模块：上游提交 `9b40351fd1913e7f74cf88f65740cd67a28baf81`，保存在 `upstream/`，附上游 MIT 许可证。其余运行时来自固定镜像，不声称是完整最新上游镜像。
- `cagent-werss-native`：原生 FastAPI，保存 Web Cookie。关闭原生定时任务，由适配器统一调度。
- `cagent-wechat`：CAgent 兼容 API，后台引擎标识 `WEMP`；管理员接口返回经过裁剪的状态，不返回原生 Cookie、ticket 或登录结果。
- 两个服务只接入应用内部 Docker 网络，均不映射公网端口。持久卷分别保存原生授权和适配器订阅/缓存。

首次拉取原生镜像需预留至少 8 GB 空间；现有固定镜像可以直接复用。不要将旧版本补丁挂载到未知新版镜像上。CAgent 扩展代码包括 `adapter.py`、`bootstrap-native.py`、`cagent_web.py` 和 `cagent_content.py`，未修改四份上游模块。初始化只创建专用账号，已有账号密码不匹配时拒绝覆盖；不创建默认弱密码账号，也不打印环境变量。

## 全新部署

先按根目录部署文档启动 CAgent，在根目录 `.env` 设置以下变量。密码与签名密钥请分别生成独立随机值，密码至少 12 字符：

```dotenv
WECHAT_COLLECTOR_URL=http://cagent-wechat:8001
WECHAT_COLLECTOR_USER=cagent
WECHAT_COLLECTOR_PASSWORD=你自己生成的强随机密码
WERSS_SECRET_KEY=你自己生成的随机签名密钥
CAGENT_NETWORK=cagent_default
```

从仓库根目录运行：

```bash
# 这里只复用其存储、调度和兼容 API 所需库，不启用移动端采集。
docker build -t cagent-wechrss:base deploy/wechrss
docker compose --env-file .env -f deploy/werss/compose.yml build
docker compose --env-file .env -f deploy/werss/compose.yml up -d
docker compose up -d --no-deps --force-recreate api
```

自定义了 Docker 项目名时，请将 `CAGENT_NETWORK` 改为实际网络名。如果已有名为 `cagent-wechat` 的采集器，先备份其数据并停止、改名保留，再启动新服务，不能直接删除旧数据或让两个采集器共享写入同一个目录。

在管理端「知识库」扫码连接微信读书，选择公众号或批量粘贴文章链接。每个公众号可以独立设置开关和 1–168 小时的间隔。完成采集后测试正文，再同步为草稿、审核发布并挂载；已恢复的校园配置不会因此自动开放公众号知识库。

## 旧订阅迁移

对旧 WechRss 数据库做一致性 SQLite 备份，再将备份复制到新适配器 `/tmp/legacy.db`；不要只复制仍在写入的主数据库而遗漏 WAL。把 `migrate-sources.py` 复制到容器 `/tmp/`，运行：

```bash
docker exec -w /app cagent-wechat python /tmp/migrate-sources.py /tmp/legacy.db /app/data/wechrss.db
```

只用于尚无订阅的新适配器。脚本只读旧库，保留公众号 ID、名称、采集开关、频率及可用文章；已有订阅时拒绝覆盖。原通道的任务、限制状态和授权保留在旧数据中，新 Web 会话须独立扫码。普通重启复用内部 API 令牌和授权，不要求再次扫码。知识库 ID、挂载、AI 审核和摘要设置不变。

## 判断是否成功

**登录成功、文章标题可读、正文可读是三个不同状态。** 原生接口有可能返回「采集成功」但正文为空；适配器检查正文，摘要不会代替正文导入。

正文使用已授权的微信读书 Web 接口，按原生文章 ID 重建 reviewId，并同时校验公众号与文章所属关系。已有目录但正文为空的文章也能补采；成功后写入原生 RSS 和适配器两层缓存。旧公开页面通道的失败冷却不阻止新通道首次尝试，后续仍遵守上游授权、限流和验证状态。

保存过 Cookie 不代表授权仍然有效。实际读取返回授权失效时，任务标记 `AUTH_REQUIRED`、暂停自动重试；重新生成二维码时，即使仍有旧 Cookie，也显示等待扫码。扫码确认后才能恢复采集。普通内部 API 令牌过期可自动刷新一次，采集写操作不自动重放。

| 状态 | 含义 |
| --- | --- |
| `SUCCEEDED` | 有可用正文，可以同步 |
| `PARTIAL` | 部分正文可用，只同步这些正文 |
| `CONTENT_BLOCKED` | 有文章目录，正文要求验证或暂不可读，不能当成已导入 |
| `RATE_LIMITED` | 上游限制请求，共享冷却至少 1 小时 |
| `AUTH_REQUIRED` | Web 授权需重新扫码 |
| `EMPTY` | 当前未获得文章 |

正文被拦截时，至少 6 小时内不重复请求正文；不会自动绕过微信验证。列表接口不可用时，上游可能只返回最新一篇，不能承诺历史文章完整回补。失败后不重复调用模型，也不把空白正文或验证页加入 RAG。

特殊版式无法解析属于单篇失败，记录该篇的重试时间，继续读取其他文章；不触发账号共享的正文验证冷却。后台“测试正文”最多检查最近 3 篇，最新一篇不可读但其他样例可读时报告部分可用；正式同步仍只导入已经缓存的完整正文。

验证命令：

```bash
docker compose --env-file .env -f deploy/werss/compose.yml run --rm --no-deps --entrypoint python werss-adapter /app/verify-adapter.py
```

`verify-adapter.py` 包含 12 项隔离协议/存储测试；原生镜像内可运行 `python verify-content.py` 的 7 项正文范围、缓存、验证页和授权测试。这些不是微信采集成功率测试。真实采集应分别核对目录数量、正文数量和知识库草稿数量。授权有效也可能受到微信验证或访问限制，不能保证历史文章完整采集。
