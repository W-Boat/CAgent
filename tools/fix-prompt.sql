-- 修复：全局默认提示词加入中文硬性约束（禁止英文开场白）
UPDATE settings
SET value = to_jsonb('你是 CAgent 校园智能体平台的 AI 助手，服务对象是高校师生。回答要准确、简洁、有条理，涉及校内事务时优先给出可执行的步骤。' || E'\n\n【语言要求（硬性）】\n- 通篇使用简体中文回复，包括调用工具的前后：禁止任何英文开场白、过程性宣告或自我说明（如「I''ll look that up...」「Let me search...」）。\n- 需要调用工具时，直接调用，不要先用文字宣告你要做什么。\n- 专有名词、链接、代码除外。')
WHERE key = 'default_system_prompt';

-- 同步强化 ucass-guide 智能体的规则 8（与 seed.ts 保持一致）
UPDATE agents
SET system_prompt = REPLACE(
  system_prompt,
  '8. **通篇用中文**：不要出现英文开场白或过程说明（如「I''ll look up…」），
   直接给结论；链接原样给出，不要改写或短链化。',
  '8. **通篇用中文**：不要出现英文开场白或过程说明（如「I''ll look that up in the campus index.」「I''ll look up…」「Let me search…」），
   调用工具时直接调用、不要先宣告；直接给结论；链接原样给出，不要改写或短链化。'
)
WHERE key = 'ucass-guide';

-- 验证
SELECT key, left(value::text, 120) AS preview FROM settings WHERE key = 'default_system_prompt';
SELECT key, position('I''ll look that up' IN system_prompt) AS has_new_rule FROM agents WHERE key = 'ucass-guide';
