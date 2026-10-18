# 服务商缓存支持与命中优化

服务商的提示词缓存会复用请求的共同前缀。DeepSeek自动启用这项能力，接口仍然会返回完整输入token数；缓存部分由服务商按其实际规则计费。资料参考：[DeepSeek上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)、[Chat Completions用量字段](https://api-docs.deepseek.com/api/create-chat-completion/)。

## 接入支持

OpenAI兼容适配器读取DeepSeek的`usage.prompt_cache_hit_tokens`与`prompt_cache_miss_tokens`，也识别标准的`usage.prompt_tokens_details.cached_tokens`。流式响应最后一帧即使`choices`为空，也会读取`usage`。

没有返回缓存字段时记录为“未报告”；明确返回0才表示本次零命中。无法从缺字段推断服务商不支持缓存。校验计数范围及总量，避免异常统计影响结果。

多轮工具调用、协议自动重试和严格模式的额外审核均累计服务商缓存用量。单次调用收到多次usage快照时只采用最终快照，避免重复累计。指标保存在消息的`attachments.agentRun.providerCache`，并在`POST /api/chat/completions`的SSE `usage`事件中返回：

```json
{
  "providerCache": {
    "reportedCalls": 2,
    "unreportedCalls": 0,
    "hitTokens": 1540,
    "missTokens": 660
  }
}
```

`hitTokens / (hitTokens + missTokens)`只描述已报告调用的输入命中比例。存在`unreportedCalls`时，此比例不代表全部请求。`promptTokens`仍包含命中输入，不应再次加上`hitTokens`。

当前费用字段继续按管理员配置的普通输入、输出价格估算；未配置服务商专属缓存价格，因此不将用量统计伪装成实际折扣账单。历史消息未保存这些字段，无法补算历史命中率。

## 前缀优化

固定系统与Agent指令放在前面，分钟级“当前时间”放在动态上下文尾部。时间信息完整保留，模型仍可处理日期问题；跨分钟时，固定指令前缀能继续被服务商复用。知识证据、用户记忆、工具预算及本轮策略均按实际内容发送，不为了命中删除上下文或混用用户资料。

不向兼容服务商强行添加`prompt_cache_key`、`cache_control`等可能不被支持的参数，也不固定密钥或修改已有轮询策略。服务商自身的容量、缓存粒度、异步写入及路由都会影响命中，不能保证每次重复请求必然命中。

本站完整回答缓存直接复用已完成答案，命中时不请求模型；其SSE标记是`cache.hit=true`/`cacheHit=true`。服务商缓存是在实际模型请求中复用输入前缀，使用上面的`providerCache`指标。两项指标单独统计。

## 验证

```sh
cd apps/api
npx ts-node --transpile-only scripts/verify-provider-cache.ts
npx ts-node --transpile-only scripts/verify-agent-runtime.ts
```

前者使用本机HTTP合成SSE与模拟多轮模型，后者使用本地开发PostgreSQL和模拟模型；均不调用外部服务商。验证真实服务商时，应使用有限次数、短输出的合成公开文本，不发送真实用户对话或导出密钥。
