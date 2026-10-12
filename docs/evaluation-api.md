# 批量对话测试接口

访问入口 `/admin/evaluations`。接口需登录 Bearer 令牌和 `conversation:read` 权限。普通管理员只操作自己创建的任务，超管可审查全部任务。

## 输入

JSON 可用问题文本数组（每题独立批次），或显式多轮批次：

```json
{"batches":[
 {"id":"通勤-01","split":"test","questions":["附近有什么地铁站？","怎么去？"]},
 {"id":"图书馆-01","split":"validation","questions":["图书馆要预约吗？"]}
]}
```

CSV 支持 UTF-8/BOM、引号、逗号和单元格内换行：

```csv
batch_id,split,turn,question
通勤-01,test,1,附近有什么地铁站？
通勤-01,test,2,怎么去？
图书馆-01,validation,1,图书馆要预约吗？
```

question 必填；无 batch_id 则每行独立，无 turn 则按文件顺序。指定轮次须从 1 连续递增且不重复。同一批次的 split 一致。最多 500 题，每批 100 轮，每题 6000 字，输入 1.5MB。

## 创建

`POST /api/evaluations`：

```json
{
 "title":"导览验证",
 "format":"json",
 "data":"{\"batches\":[{\"id\":\"a\",\"questions\":[\"图书馆在哪？\",\"开放时间呢？\"]}]}",
 "split":"test",
 "bypassCache":true,
 "outputPreference":"adaptive"
}
```

modelId、agentId 可选，使用自己平台有效 ID。outputPreference 支持 cards/adaptive/text。默认绕过缓存，设为 false 可验证缓存。真实 Agent 按正常额度计费，不读写长期记忆，仅执行只读工具。

返回 `{code,message,data}`，data 含任务 id。后台逐题执行，浏览器关闭不停止任务；每账号最多两个待执行任务。任务串行执行。

## 状态与下载

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/evaluations` | 最近 50 个可访问任务 |
| GET | `/api/evaluations/{id}` | 进度和逐题预览 |
| POST | `/api/evaluations/{id}/cancel` | 停止并保留结果 |
| GET | `/api/evaluations/{id}/export?format=json` | 完整 JSON |
| GET | `/api/evaluations/{id}/export?format=csv` | UTF-8 CSV |

下载直接返回文件。JSON 按 batch_id / split / turns 分组，每轮包含 turn、question、reply、status、error、用量与来源。CSV 每轮一行，含 task_id、batch_id、split、turn、question、reply、status、error、延迟与用量；可能被电子表格解释为公式的字段加安全前缀。

状态：QUEUED、RUNNING、COMPLETED、FAILED、CANCELLED、INTERRUPTED。COMPLETED 表示所有题已处理，不代表全成功，需看 succeeded/failed。前轮失败时同批后续 SKIPPED，其他批次继续。重启标记中断，不自动重复调用，部分结果仍可下载。

预览最多 4000 字，下载保留完整原始回复及结构化卡片描述。接口负责执行与导出，不自动判分；按使用方的参考答案和标准分析。
