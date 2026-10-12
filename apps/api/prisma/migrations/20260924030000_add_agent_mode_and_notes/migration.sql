-- Agent 应用模式（参考 Dify）+ 技能/智能体管理备注
--
-- 1) AgentMode 枚举：CHAT 纯对话不给工具；AGENT 由模型自主决定调用哪些工具。
-- 2) agents.max_tool_rounds：限制单轮工具调用轮数，防止模型无限循环烧额度。
-- 3) skills.note / agents.note：给管理员写「适用场景 / 维护人 / 注意事项」的地方，
--    仅后台可见，不进入模型上下文。

CREATE TYPE "AgentMode" AS ENUM ('CHAT', 'AGENT');

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "mode" "AgentMode" NOT NULL DEFAULT 'AGENT',
  ADD COLUMN IF NOT EXISTS "max_tool_rounds" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "note" TEXT;

ALTER TABLE "skills"
  ADD COLUMN IF NOT EXISTS "note" TEXT;
