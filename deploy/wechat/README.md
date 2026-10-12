# CAgent 私有公众号采集器补丁

此目录是原 WeRSS 的历史补丁与回滚资料。2026-10-09 已由 [deploy/wechrss](../wechrss/README.md) 的微信读书直连采集器替代；新安装或更新应使用新目录，勿重新执行此处旧安装脚本覆盖当前实例。以下状态、错误码与数据路径仅适用于旧实例。

固定镜像为 `rachelos/we-mp-rss@sha256:7873205d40610ef894a419ab2691d1039cf3f0e442fee11a13df4aa3997c53d1`。以下文件以只读挂载覆盖对应模块：

| 文件 | 容器位置 | 作用 |
| --- | --- | --- |
| wx-managed.py | /app/driver/wx.py | 二维码任务去重、从有效持久化授权恢复登录显示 |
| mps-managed.py | /app/apis/mps.py | 首次订阅与更新进入统一采集任务，增加进度查询 |
| cagent_collect.py | /app/apis/cagent_collect.py | 单线程有界采集、状态持久化、重复任务复用、限流暂停 |

这是针对固定镜像原代码的补丁，不可直接套用到未知版本。`install-collector.sh` 保留这些挂载；既有生产实例由 `deploy-collector-jobs.sh` 校验旧源文件、备份 SQLite、保留旧容器后替换。部署脚本所需文件位于 `/tmp`，部署目录 `/opt/cagent-wechat`；凭据沿用该目录的私有配置，不写在仓库中。

`python deploy/wechat/verify-collection-jobs.py` 验证去重、跨公众号限流冷却、后台定时任务不能绕过冷却、状态持久化及任务记录不保存凭据。没有真实微信请求。

`data/cagent-collection-tasks.json` 记录状态和采集数，不保存 token/cookie。收到微信 `200013` 后保守等待一小时，所有来源共用授权冷却，重启不能绕过。这个窗口不是微信保证的解限时间。`200003` 提示重新授权，其他失败保留可重试状态。每次只采集最新一页；数据库中的重复记录不计作空页面。

资料入库仍走 CAgent 的“测试正文 → 同步草稿 → 审核发布 → 挂载查询”，采集完成不会直接发布。任务响应只暴露已知状态、计数和时间，原始采集器响应与访问凭据不传给前端。
