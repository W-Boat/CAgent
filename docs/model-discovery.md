# 供应商模型嗅探与配置移除

在模型供应商页面先保存基础地址与密钥，启用后点「嗅探模型」。支持 OpenAI 兼容、Anthropic、Google 与 Ollama 的列表协议；Azure 暂请手动添加。密钥只在后端使用，禁止携带密钥跨重定向；请求超时20秒，响应最大2MB。上游分页时显示本次结果不完整提示，不推测完整列表。

勾选后导入，重复模型跳过，不覆盖已有模型的能力、价格及配置。新模型默认禁用；核对工具调用、视觉、上下文、输出限制及价格后启用。供应商未提供的能力不凭名称猜测。嗅探不发起模型推理，也不保证列表中每个模型实际可调用。结果10分钟有效，服务重启后需重新嗅探。

接口 POST /api/providers/{id}/models/discover 需 provider:write；POST /api/providers/{id}/models/import，body为 keys 数组，需 model:write，一次最多200个。只允许导入当前有效嗅探结果中的模型，导入操作记审计。

内置身份不再限制移除。模型、供应商、智能体、技能采用事务内停用并隐藏配置，保留原始记录及历史引用；原标识释放，可重新添加同名配置。移除供应商同时停用并隐藏所属模型及停用密钥；不会删除聊天、记忆、学习或运行记录。移除标记存在 settings 中，不需要新增数据库迁移；不要清空这些标记或重新seed。移除后的配置不能通过编辑/启用接口直接复活。

知识库维持已有全名确认与软移除机制。全站DELETE网络兼容仍复用原权限和归属校验。升级必须同时更新 API/Web，步骤见 update-deployment.md。

协议依据：[DeepSeek Models](https://api-docs.deepseek.com/api/list-models/)、[Anthropic Models](https://platform.claude.com/docs/en/api/models/list)。
