/** Conservative exclusion: utility-only calculations do not need automatic campus evidence.
 * Campus/business queries keep grounding; explicit knowledge_search remains available.
 */
export function needsAutomaticKnowledge(query:string):boolean {
  const text=query.trim().toLowerCase()
  if(/社科|国科|ucass|校园|学校|校内|校外|良乡|望京|学生|学费|学分|成绩|课程|教务|食堂|图书馆|宿舍|超市|社团|奖学金|申请|办理|退学|补贴|知识库/.test(text))return true
  if(/^(?:你好|您好|谢谢|感谢|早上好|下午好|晚上好|再见|hello|hi|thanks)[！!。,.，?？\s]*$/.test(text))return false
  // Unit conversions need no campus catalog or incidental numeric matches.
  if(/\d+(?:\.\d+)?\s*(?:小时|分钟|秒|千米|公里|厘米|毫米|米|千克|公斤|克|毫升|升)\s*(?:等于|换算成|是多少|换成|转换为)[^\n]{0,12}(?:小时|分钟|秒|千米|公里|厘米|毫米|米|千克|公斤|克|毫升|升)/.test(text))return false
  if(/calculator|数学计算|四则运算/.test(text))return false
  if(/计算|算出|算一下/.test(text)&&/\d\s*[+\-*/×÷^]\s*\d/.test(text))return false
  if(/(?:刚才|上述|上次|前面).*(?:结果|计算).*(?:除以|乘以|加上|减去)\s*\d/.test(text))return false
  if(/^[\s\d().+\-*/×÷^=？?]+$/.test(text)&&/\d\s*[+\-*/×÷^]/.test(text))return false
  return true
}
