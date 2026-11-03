# Excel 验证集测试

仅支持最新验证集流程。入口 /admin/evaluations；需登录及 conversation:read 权限。

1. GET /api/evaluations/template 下载空白 .xlsx 模板。
2. 填写唯一工作表的两列「问题、预期答案」，每行独立问答，最大1MB、500题。不执行宏、公式或外部链接。
3. POST /api/evaluations，JSON请求包含 title、format:"xlsx"、data:文件纯Base64；可选 modelId、knowledgeBaseIds:库ID数组。不选模型用平台默认模型，不选库用当前公共挂载库；所选库必须已挂载、未移除且未绑定私有智能体。
4. GET /api/evaluations/knowledge-options 获取可选库；GET /api/evaluations/{id} 查看进度；POST /api/evaluations/{id}/cancel 停止；GET /api/evaluations/{id}/export?format=xlsx 导出。

回答模式由服务端固定为精简模式：纯文字、直接结论与必要事实/步骤，不提供卡片或自由切换。固定绕过回答缓存、关闭个人记忆；每题独立会话，并发2批。参考答案按原始题目位置保存，不传给模型。失败题保留，异常不拖停其他独立题。导出前三列为问题、预期答案、智能体实际回复，含状态、耗时与异常，超长回复通过续列保留。

原 JSON/CSV 输入及导出、多轮/严格/排版参数已不再支持；不能通过接口改变回答模式。历史任务可查看和导出Excel。评审算法与人工得分由评审指定，不虚构评分。
