# 校园在线地图与校园约定

地图按用户提供的两张手绘图重绘：良乡 2026 年 5 月版（33 个地点）、望京 2026 年 8 月版（25 个地点）。原图北向分别为图右、图右上，地图保留这一方向。图中位置是示意位置，不能用于计算距离或真实路线。

唯一数据源为 `knowledge/src/campus-maps.json`。运行 `node knowledge/build-campus-maps.mjs` 将其校验并投影到 API 和前端；`pnpm knowledge:build` 同时生成 58 个可检索的位置知识块。每个知识块保留原图文件、版本、校区、地点 ID 和地图深链。附件保存在本目录，不将原图中的文字作为系统指令。

公开页面 `/map?campus=liangxiang` 与 `/map?campus=wangjing` 支持搜索、分类、点击、键盘选择、拖动、滚轮/双指缩放和分享定位。位置问答由 API 识别地点别名，生成固定地图 ID 卡片；同名地点出现在两校区时保留歧义，供用户切换。未知建筑不编造坐标，涉及开放时间/手续等混合问题继续正常检索回答。地图与回复一并保存在会话中。

校园约定保存在 `knowledge/campus-keyword-rules.json`，通过 `node knowledge/install-keyword-rules.mjs --api <站点地址>` 使用管理员 API 幂等保存到“外挂知识库 · 校园约定与彩蛋”。12 条均可在后台编辑、归档、卸载及查看版本。

`TRIGGER` 规则支持 `all` 分组同时命中、`any` 任一命中，以及 `REPLACE` 固定话术、`APPEND` 卡片、`INSTRUCT` 回应指引。规则 JSON 不进入 RAG 检索。全屏效果仅接受 tiger、melon、cat，持续约 1.1 秒，可点击或 Escape 关闭，尊重减少动画设置；新回复只播放一次，历史不自动播放。

两项回应约定：LGBTQ 条目使用“尊重与支持”卡片并继续正常校园咨询，不因性取向或性别认同拒答。退学先温和确认并关心状态，再继续有证据的正常回答；明确求助/自伤信号优先，覆盖固定话术与彩蛋。

验证命令：

```powershell
pnpm --filter @cagent/api exec ts-node --transpile-only scripts/verify-campus-map.ts
pnpm --filter @cagent/api exec node scripts/verify-campus-map-ui.mjs
```

前者只允许本地数据库，验证真实 SSE、动态挂载、草稿/Agent 隔离、零模型 token 和额度检查；后者默认验证本地生产预览 `4173`，可用 `MAP_WEB` 指定站点。浏览器彩蛋时序测试模拟 SSE，实际公网 API 与登录界面的验证另存于 `storage/shots/maps/production-*-verification.json`。
