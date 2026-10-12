# WechRss 服务器采集器

上游：<https://github.com/johamwon/wechrss>，MIT。固定提交
`412d316073228ce7b306e25de6a21ea730b059fb`（2026-09-27），原始四个 Python 文件及许可证保存在 `upstream/`，未修改上游代码。

替换 WeRSS 的公众平台采集通道，使用上游直接连接微信读书的扫码、续期、公众号目录和文章详情模块。凭据仅存在本机，未使用 WeWe RSS 的第三方凭据转发服务。旧库、授权和旧容器保留以便回滚；公众平台授权无法迁移为微信读书授权。

上游仅同步目录。`bridge.py` 是 CAgent 扩展：受保护的兼容接口、最新 20 篇的正文缓存、按公众号独立定时采集、串行任务与重复任务合并、共享限流冷却、持久化任务状态、正文失败六小时退避和只读测试。正文仅从 HTTPS `mp.weixin.qq.com/s` 获取，每次跳转验证、限制响应大小，不向文章地址发送读书凭据；需要验证或无 `#js_content` 时不把摘要当正文。QR PNG 用纯 Python 生成，无浏览器或原生图像库依赖。

上游 SQLite 上下文仅提交事务而不关闭连接；适配层使用 `ManagedDB` 自动关闭每次事务连接。上游刷新会清空正文列，适配层保留文章 ID、标题、发布时间未变的缓存。

数据目录 `/opt/cagent-wechrss/data`；环境文件 `/opt/cagent-wechrss/collector.env` 为 0600，仅存 CAgent 内部访问凭据。容器最终名 `cagent-wechat`，网络 `cagent_default`，无公网端口，内存 256 MiB。不要输出凭据文件、原始上游错误或二维码确认 URL。

默认每 6 小时采集，可在后台按公众号设置 1/6/12/24 小时并启停。停用自动采集后仍可手动采集。知识库里的「自动同步到知识库」单独控制缓存正文增量导入，由保存配置的有效管理员权限执行；AI 开关、挂载状态、人工审核不随采集开关改变。失败同步最少等待 30 分钟，无新正文不写库，不删除窗口之外的历史。

后台支持最多 50 项批量订阅，以每行文章链接或「名称 | 链接」输入。适配层后台串行处理，保留逐项结果，重复订阅复用原来源，部分失败仅重试失败项；前端持久化任务 ID，刷新可继续查看。可同时建立独立知识库并开启增量同步：新库默认不挂载且 AI 关闭，已有库的配置保留。按名字搜索只搜索已订阅目录，新公众号需提供文章链接，不承诺全网公众号搜索。

生产版本 `cagent-wechrss:20261009-204000`，镜像 `sha256:fcb8affe3935bd8053ea01cd8a9b87a616ea01ecc86658090cbb80a6b2176c3c`。截至 2026-10-09 20:46，微信读书已授权，首次真实目录请求遇到风控，正文仍为零；所有来源保持共享退避并按计划重试。授权成功和隔离测试通过均不等于真实文章已抓取，不要重置冷却。只读诊断用 `probe-readonly.py`，不能通过实例化 Bridge 查询状态，因为构造过程会更新恢复任务。

知识库移除采用完整名称确认和墓碑，保留历史且阻止查询/自动化；不会取消此独立采集器的订阅。相关接口、开关及验证范围见 [公众号知识库说明](../../docs/wechat-knowledge.md)。

本地验证：`python deploy/wechrss/verify-bridge.py`（需要 requirements，测试自动加 upstream 路径，11 项含批量去重、部分失败与重启恢复）；API：`pnpm --filter @cagent/api exec ts-node --transpile-only scripts/verify-wechrss-auto.ts`、`scripts/verify-knowledge-removal-batch.ts`。这些是隔离测试，不证明真实文章已采集。

安装：打包此目录后使用 `install.sh <archive> <sha256>`，先以 `cagent-wechrss` 启动检查，再复制只读旧 SQLite 快照并运行 `migrate-sources.py`。新实例检查通过才停用旧采集器、保留回滚名，并将新容器改为 `cagent-wechat`。须同时上线新的 API/web，旧 API 不认识新 QR 图片接口与正文状态。
