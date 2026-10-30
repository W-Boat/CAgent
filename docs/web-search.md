# Agent 联网搜索

系统设置 → 联网搜索：选择 DeepSeek 或 Tavily，配置有效密钥后开启总开关。默认只查 `ucass.edu.cn` 及全部子域名；需要校外报道时再开启外部搜索。保存后可直接测试关键词、校内、校外或全网模式。默认关闭，不会因更新代码而自动产生接口费用。

DeepSeek 推荐在服务器环境设置独立 `DEEPSEEK_SEARCH_API_KEY`；也可使用 `DEEPSEEK_API_KEY`，或后台 key 为 `deepseek` 的启用供应商密钥。后两者仅适用于实际有效的 DeepSeek 官方密钥，自定义中转商密钥不保证适用。搜索直连官方独立接口，不复用聊天中转地址。Tavily 使用 `TAVILY_API_KEY` 或后台同名供应商密钥。密钥不填入系统设置、不返回前端、不写入初始化包。

Agent 可调用 `web_search({query, scope, after?})`，scope 为 campus、external、all；日期使用 YYYY-MM-DD。默认 campus。服务端强制追加范围并核验结果实际域名，过滤伪装域名，支持关键词引号匹配。返回标题、链接、摘要和上游提供的日期，未知日期不推断。来源进入原有来源面板，模型可使用真实来源 ID 编排界面。

DeepSeek 还支持 `web_fetch({url})`，仅可读取本轮搜索已返回的公开链接。正文最多保留8000字符；搜索默认仅附摘要，可选附有限正文。网页中的指令不执行，结果不自动写入知识库。Tavily 可随搜索返回原文片段，不提供本工具的独立 Fetch。

每题最多3次联网调用，每次1–8条结果。相同搜索按引擎、密钥、范围、内容开关与结果数缓存2分钟；结果最多缓存100份，仅进程内保存。联网回答不进入长期回答缓存；搜索设置改变也会使旧回答缓存失效。搜索调用记录到审计日志，不把供应商密钥或上游错误正文写入日志。接口费用独立于模型 token 计费。

尊重对话的工具开关和 Agent 纯聊天模式；严格评测、仅2.0数据库评测以及批量评测不提供联网工具。搜索不开启或密钥缺失时不向模型声明工具。开启后需使用支持工具调用的模型。

管理员接口：GET `/api/search/status`，POST `/api/search/test`（请求体与 web_search 一致）；均要求 `setting:write`。测试只读、不会导入知识库，会消耗搜索供应商额度。空结果与授权失败、限流分别提示；请求20秒超时、不自动重试。

搜索范围只覆盖引擎已收录的公开网页，不能承诺校园所有新闻的完整覆盖，也不能访问仅内网、登录后或禁止抓取的资料。正式公告仍应核对原文，不能以摘要替代办事依据。

官方协议：[DeepSeek Search](https://api-docs.deepseek.com/zh-cn/api/search/)、[DeepSeek Fetch](https://api-docs.deepseek.com/api/fetch/)、[Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)。
