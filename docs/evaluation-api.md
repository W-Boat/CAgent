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


## Excel 验证集与评分材料

在 `/admin/evaluations` 点击「下载 Excel 模板」，填写唯一工作表的两列「问题」「预期答案」，再点「上传验证集 / 导入文件」选择 `.xlsx`。每行独立答题，默认验证集、文字为主、绕过缓存；仍可调整并发和知识范围。Excel 最大 1MB，最多 500 题，仅接受单元格文本值，不执行公式、宏或外部链接。参考答案可为空，但应按评审要求填写。

接口：`GET /api/evaluations/template` 下载空模板。`POST /api/evaluations/import-xlsx` 接收 `{data:"文件的纯Base64",split:"validation"}`，返回 `{batches,total}`；把 batches JSON 序列化后按原 `POST /api/evaluations` 的 `format:json`、`data` 创建任务。所有接口沿用登录及权限校验。读取文件本身不调用模型。

JSON 批次可附加 `expectedAnswers` 数组，数量必须与 questions 一致；CSV 可添加 `expected_answer`（或「预期答案」）列。参考答案保存在任务配置中，按原始题目位置关联，不注入提示词、对话或知识库。任务保存规范化输入 SHA-256 指纹，结果含模型、范围、策略版本及状态，便于复核。无需新增数据库迁移；历史任务参考答案为空。

`GET /api/evaluations/{id}/export?format=xlsx` 下载真实 Excel，前三列固定为「问题、预期答案、智能体实际回复」，随后记录状态、异常、耗时、批次、轮次和数据集。超长回复使用续列保存，拼接原列与续列可恢复完整内容；JSON/CSV 仍保留完整回复和 expected_answer。失败、空回复、取消和未完成题均保留，不通过丢题提高得分。单题模型异常仅影响该批次，其他独立批次继续。

默认不自动打分。正式相似度算法由评审方统一指定；按附件口径，机选分为相似度总和除以验证集总题数乘 100，失败题计 0 且计入分母。人工通常随机抽取 10 题，不足 10 题全部评阅，并保留抽样记录；建议机选/人工权重 60%/40%，以评审公告为准。不能以结构测试通过代替真实问答得分。

为改善可核对性，批量回答优先直接结论并覆盖有证据的时间、地点、条件、材料、步骤与入口，不猜参考答案。建议正式运行前核对知识库挂载、资料有效期及模型可用性，先使用独立练习题检查关键要素；严格模式有独立审核及额外耗时，仅 2.0 范围可能缺少最新资料，应根据评测要求选择。
