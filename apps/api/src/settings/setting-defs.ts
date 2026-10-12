export interface SettingDef {
  key: string
  group: string
  label: string
  description?: string
  type: "string" | "number" | "boolean" | "json" | "text"
  defaultValue: unknown
  /** 敏感项不回传明文 */
  secret?: boolean
  /**
   * 只有超管可改。
   *
   * 用于「决定平台露出哪些内容」的功能开关：内置 admin 角色带
   * setting:write，所以仅靠系统设置权限挡不住普通管理员。
   * 校验在 SettingsService.updateMany 里，靠 feature:toggle 权限码判定。
   */
  superAdminOnly?: boolean
  options?: { label: string; value: unknown }[]
}

/**
 * 系统设置目录：后台管理页据此渲染表单。
 * 新增设置项只需在此登记，seed 会自动补齐默认值。
 */
export const SETTING_DEFS: SettingDef[] = [
  {key:'memory_enabled',group:'general',label:'全站记忆功能',description:'关闭后不注入、提取或创建长期记忆，同时隐藏记忆入口；保留已有数据，可重新开启。仅影响长期记忆，多轮会话上下文继续有效。',type:'boolean',defaultValue:true},
  {key:'onboarding_enabled',group:'general',label:'进入引导弹窗',description:'全站总开关。关闭后所有用户进入页面均不弹首次使用引导；学生端首次使用引导设置还需同时开启。',type:'boolean',defaultValue:true},
  {key:'knowledge_retrieval_depth',group:'knowledge',label:'检索深度（最大次数）',description:'每个问题最多检索 1–8 次，默认 3 次；首轮自动检索也计入。较浅更快、更省 token，较深可补充缺失证据。仅限制知识库查询，不限制其他工具。',type:'number',defaultValue:3},
  {key:'knowledge_continuous_retrieval',group:'knowledge',label:'允许连续检索',description:'开启后，Agent 可在最大次数内继续查询；关闭后仅查询一次，使用已有证据回答，缺项如实说明。修改后从下一次提问生效。',type:'boolean',defaultValue:true},
  {key:'answer_cache_enabled',group:'chat',label:'回答缓存',description:'同一用户的相同问题、模型、输出偏好与上下文可复用服务器回答；重新生成绕过。时效性问题、图片及有操作副作用的回答不缓存。',type:'boolean',defaultValue:true},
  {key:'answer_cache_days',group:'chat',label:'回答缓存保留天数',description:'1–30 天，默认 3 天；缩短立即影响读取有效期。资料、权限或配置改变后旧缓存不再命中。',type:'number',defaultValue:3},
  {key:'knowledge_ai_review_enabled',group:'knowledge',label:'AI 自动审核',description:'总开关；还需在具体知识库开启。普通资料通过后自动发布，不确定内容转人工；固定答案及关键词规则仍需人工发布。',type:'boolean',defaultValue:false},
  {key:'knowledge_ai_summary_enabled',group:'knowledge',label:'AI 自动总结',description:'总开关；还需在具体知识库开启。总结独立保存，保留原文与来源。',type:'boolean',defaultValue:false},
  {key:'knowledge_ai_model_id',group:'knowledge',label:'知识自动化模型',description:'在知识中心的 AI 自动化页选择模型；留空使用平台默认模型。',type:'string',defaultValue:''},
  {key:'knowledge_ai_batch_size',group:'knowledge',label:'每轮 AI 处理条数',description:'每分钟处理 1–5 条；遵守启用管理员的模型额度。',type:'number',defaultValue:2},
  // 通用
  {
    key: "site_name",
    group: "general",
    label: "站点名称",
    type: "string",
    defaultValue: "CAgent 校园智能体平台"
  },
  {
    key: "site_description",
    group: "general",
    label: "站点描述",
    type: "string",
    defaultValue: "面向校园场景的 AI 智能体平台"
  },
  {
    key: "allow_registration",
    group: "general",
    label: "开放注册",
    description: "关闭后仅管理员可创建账号",
    type: "boolean",
    defaultValue: true
  },
  {
    key: "default_daily_token_quota",
    group: "general",
    label: "新用户默认每日 token 配额",
    description: "0 表示不限",
    type: "number",
    defaultValue: 0
  },
  {
    key: "default_model_id",
    group: "general",
    label: "默认模型 ID",
    description: "新建会话使用的模型",
    type: "string",
    defaultValue: ""
  },

  // 对话
  {
    key: "default_system_prompt",
    group: "chat",
    label: "默认系统提示词",
    type: "text",
    defaultValue:
      "你是 CAgent 校园智能体平台的 AI 助手，服务对象是高校师生。回答要准确、简洁、有条理，涉及校内事务时优先给出可执行的步骤。\n\n【语言要求（硬性）】\n- 通篇使用简体中文回复，包括调用工具的前后：禁止任何英文开场白、过程性宣告或自我说明（如「I'll look that up...」「Let me search...」）。\n- 需要调用工具时，直接调用，不要先用文字宣告你要做什么。\n- 专有名词、链接、代码除外。"
  },
  {
    key: "max_context_messages",
    group: "chat",
    label: "最大上下文消息数",
    type: "number",
    defaultValue: 20
  },
  {
    key: "default_temperature",
    group: "chat",
    label: "默认温度",
    type: "number",
    defaultValue: 0.7
  },
  {
    key: "enable_stream",
    group: "chat",
    label: "启用流式输出",
    type: "boolean",
    defaultValue: true
  },
  {
    key: "enable_tools",
    group: "chat",
    label: "默认启用技能调用",
    type: "boolean",
    defaultValue: true
  },

  // 学生端（管理端可配，经 /settings/public 公开）
  {
    key: "student_logo_url",
    group: "student",
    label: "学生端右上角学校 Logo",
    description: "图片地址（https:// 或 /static/…），留空则不显示",
    type: "string",
    defaultValue: ""
  },
  {
    key: "default_accent_color",
    group: "student",
    label: "全局默认强调色",
    description: "十六进制色值（如 #4f46e5）。管理、学生和体验页面共用；支持任意六位十六进制色值",
    type: "string",
    defaultValue: "#4f46e5"
  },
  {
    key: "student_default_model_id",
    group: "student",
    label: "学生端默认模型 ID",
    description: "留空则用平台默认模型",
    type: "string",
    defaultValue: ""
  },
  {
    key: "student_fallback_model_id",
    group: "student",
    label: "学生端出错轮换模型 ID",
    description: "默认模型生成失败时自动换用该模型重试一次；留空不轮换",
    type: "string",
    defaultValue: ""
  },

  // 统一页面显示：公开下发，同一配置控制学生端与体验页。
  {
    "key": "unified_theme_enabled",
    "group": "student",
    "label": "统一主题色",
    "description": "开启后所有页面使用后台主题色，个人强调色不覆盖平台配色",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_default_theme",
    "group": "student",
    "label": "默认明暗模式",
    "description": "用户首次进入时使用；禁止个人切换时持续按此策略显示",
    "type": "string",
    "defaultValue": "system",
    "options": [
        {
            "label": "跟随系统",
            "value": "system"
        },
        {
            "label": "浅色",
            "value": "light"
        },
        {
            "label": "深色",
            "value": "dark"
        }
    ]
},
  {
    "key": "student_allow_theme_toggle",
    "group": "student",
    "label": "允许切换明暗模式",
    "description": "影响管理、学生和体验页的明暗切换入口",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_brand_subtitle",
    "group": "student",
    "label": "品牌副标题",
    "description": "学生端与体验页侧栏和空会话标题使用",
    "type": "string",
    "defaultValue": "校园智能助手"
},
  {
    "key": "student_welcome_title",
    "group": "student",
    "label": "欢迎标题",
    "description": "留空时使用当前智能体名称",
    "type": "string",
    "defaultValue": ""
},
  {
    "key": "student_welcome_description",
    "group": "student",
    "label": "欢迎说明",
    "description": "留空时使用当前智能体简介",
    "type": "text",
    "defaultValue": ""
},
  {
    "key": "student_input_placeholder",
    "group": "student",
    "label": "输入框提示",
    "description": "学生端与体验页共用，体验额度用完时显示额度提示",
    "type": "string",
    "defaultValue": "说点什么…（Enter 发送，Shift + Enter 换行）"
},
  {
    "key": "student_footer_text",
    "group": "student",
    "label": "页面底部说明",
    "description": "留空不显示；显示为普通文本",
    "type": "string",
    "defaultValue": "回答仅供参考，请以学校最新通知为准。"
},
  {
    "key": "student_recommended_questions",
    "group": "student",
    "label": "推荐问题",
    "description": "最多 12 条，每条最多 120 字；空数组使用智能体开场问题",
    "type": "json",
    "defaultValue": []
},
  {
    "key": "student_show_recommendations",
    "group": "student",
    "label": "显示推荐问题",
    "description": "控制欢迎页推荐问题",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_show_agent_cards",
    "group": "student",
    "label": "显示智能体卡片",
    "description": "控制学生端欢迎页智能体列表",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_show_timetable_entry",
    "group": "student",
    "label": "个人课表入口",
    "type": "boolean",
    "defaultValue": true
  },
  {
    "key": "student_show_map_entry",
    "group": "student",
    "label": "显示校园地图入口",
    "description": "控制学生端与体验页侧栏地图入口，不影响回答中的地图卡片",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_show_knowledge_shortcuts",
    "group": "student",
    "label": "显示知识库快捷入口",
    "description": "控制输入区上方知识库快捷查询",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_show_knowledge_sources",
    "group": "student",
    "label": "显示知识来源",
    "description": "控制学生端与体验页来源面板，后台聊天始终可审阅来源",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_show_tool_activity",
    "group": "student",
    "label": "显示查询处理过程",
    "description": "控制学生端与体验页工具过程，后台聊天始终可审阅",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_feedback_enabled",
    "group": "student",
    "label": "显示回答反馈",
    "description": "控制学生端评价按钮和体验页反馈入口",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_show_weather",
    "group": "student",
    "label": "显示欢迎页天气",
    "description": "关闭后不请求天气服务",
    "type": "boolean",
    "defaultValue": true
},
  {
    "key": "student_onboarding_enabled",
    "group": "student",
    "label": "显示首次使用引导",
    "description": "不改变用户已保存的记忆偏好",
    "type": "boolean",
    "defaultValue": true
},

  // 内容安全
  {
    key: "content_moderation",
    group: "security",
    label: "启用内容审计标记",
    type: "boolean",
    defaultValue: true
  },
  {
    key: "sensitive_words",
    group: "security",
    label: "敏感词列表",
    description: "命中后消息会被自动标记，供管理员复核",
    type: "json",
    defaultValue: []
  },
  {
    key: "log_message_ip",
    group: "security",
    label: "记录消息来源 IP",
    type: "boolean",
    defaultValue: true
  },

  // 浏览器操控
    {
      key: "timetable_enabled",
      group: "browser",
      label: "个人课表服务",
      description: "仅开放服务器端临时教务登录和课表读取；关闭后暂停新导入、个人课程问答和站内提醒，已有课表仍可查看、导出、删除",
      type: "boolean",
      defaultValue: true
    },
  {
    key: "browser_enabled",
    group: "browser",
      label: "旧版浏览器开关（通用操控暂未开放）",
    type: "boolean",
    defaultValue: true
  },
  {
    key: "browser_headless",
    group: "browser",
    label: "无头模式",
    description: "关闭后会弹出可见窗口，便于调试",
    type: "boolean",
    defaultValue: true
  },
  {
    key: "browser_domain_whitelist",
    group: "browser",
    label: "允许访问的域名白名单",
    description: "留空表示不限制",
    type: "json",
    defaultValue: []
  },
  {
    key: "browser_max_sessions_per_user",
    group: "browser",
    label: "每用户最大并发会话数",
    type: "number",
    defaultValue: 3
  },

  // 技能
  {
    key: "skill_enabled",
    group: "skill",
    label: "启用技能系统",
    type: "boolean",
    defaultValue: true
  },
  {
    key: "skill_max_steps",
    group: "skill",
    label: "智能体单轮最大技能调用次数",
    type: "number",
    defaultValue: 5
  }
]

export const SETTING_MAP = new Map(SETTING_DEFS.map((s) => [s.key, s]))
