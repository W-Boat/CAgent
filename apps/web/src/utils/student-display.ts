export interface StudentDisplaySettings {
 unified_theme_enabled?:boolean
 student_default_theme?:'system'|'light'|'dark'
 student_allow_theme_toggle?:boolean
 student_brand_subtitle?:string
 student_welcome_title?:string
 student_welcome_description?:string
 student_input_placeholder?:string
 student_footer_text?:string
 student_recommended_questions?:string[]
 student_show_recommendations?:boolean
 student_show_agent_cards?:boolean
 student_show_map_entry?:boolean
 student_show_knowledge_shortcuts?:boolean
 student_show_knowledge_sources?:boolean
 student_show_tool_activity?:boolean
 student_feedback_enabled?:boolean
 student_show_weather?:boolean
 onboarding_enabled?:boolean
 memory_enabled?:boolean
 student_onboarding_enabled?:boolean
}
export function studentDisplay(settings:StudentDisplaySettings|null|undefined){
 const enabled=(key:keyof StudentDisplaySettings)=>settings?.[key]!==false
 return {
  subtitle:settings?.student_brand_subtitle??'校园智能助手',
  welcomeTitle:settings?.student_welcome_title||'',welcomeDescription:settings?.student_welcome_description||'',
  placeholder:settings?.student_input_placeholder??'说点什么…（Enter 发送，Shift + Enter 换行）',
  footer:settings?.student_footer_text??'回答仅供参考，请以学校最新通知为准。',
  questions:Array.isArray(settings?.student_recommended_questions)?settings.student_recommended_questions.filter(q=>typeof q==='string'&&q.trim()).slice(0,12):[],
  recommendations:enabled('student_show_recommendations'),agentCards:enabled('student_show_agent_cards'),mapEntry:enabled('student_show_map_entry'),
  knowledgeShortcuts:enabled('student_show_knowledge_shortcuts'),sources:enabled('student_show_knowledge_sources'),toolActivity:enabled('student_show_tool_activity'),
  feedback:enabled('student_feedback_enabled'),weather:enabled('student_show_weather'),onboarding:enabled('student_onboarding_enabled')&&settings?.onboarding_enabled!==false
 }
}
