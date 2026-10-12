import data from './campus-maps.data.json'
export const campusMaps=data
const norm=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu,'').replace(/([一二三四五六七八])号/g,(_,n)=>'一二三四五六七八'.indexOf(n)+1+'号')
export interface CampusMapMatch {campus:string;placeIds:string[]}
export interface CampusMapAnswer {answer:string;card:{type:'map';title:string;campus:string;matches:CampusMapMatch[]}}
/** Location answers are rendered from the supplied maps, without LLM-generated coordinates. */
export function resolveCampusMap(query:string,previousQuery=''):CampusMapAnswer|null {
  if(query.length>500 || !/在哪|哪里|何处|位置|地址|怎么走|怎么去|怎么到|怎么前往|如何去|如何到|地图|方位|离.{0,12}近|找.{0,12}(楼|馆|门|场|食堂)/.test(query))return null
  const shortFollowup=/^(那|它|这个|那个|这里|那里)/.test(query) || /^(在哪|在哪里|位置|怎么走)[？?。]*$/.test(query.trim())
  const subject=shortFollowup?previousQuery+' '+query:query
  const bothCampuses=query.includes('良乡')&&query.includes('望京')
  const explicitCampus=bothCampuses?null:query.includes('良乡')?'liangxiang':query.includes('望京')?'wangjing':null
  const previousAmbiguous=previousQuery.includes('良乡')&&previousQuery.includes('望京')
  const inheritedCampus=previousAmbiguous?null:!explicitCampus && previousQuery.includes('良乡')?'liangxiang':!explicitCampus && previousQuery.includes('望京')?'wangjing':null
  const scope=bothCampuses?null:explicitCampus || inheritedCampus
  const q=norm(subject)
  const candidates=data.campuses.filter(c=>!scope || c.id===scope).flatMap(c=>c.places.flatMap(p=>{
    const aliases=[p.name,...p.aliases].map(norm).filter(a=>a.length>=2&&q.includes(a))
    return aliases.length?[{campus:c,place:p,alias:aliases.sort((a,b)=>b.length-a.length)[0]}]:[]
  }))
  // A longer building name owns its embedded short alias: 教工食堂 is not 学生食堂.
  const matches=candidates.filter(c=>!candidates.some(other=>other.campus.id===c.campus.id&&other.alias.length>c.alias.length&&other.alias.includes(c.alias)))
  const wantsOverview=/校园地图|校区地图|学校地图/.test(query) || /^(良乡|望京)(校区)?地图/.test(query)
  if(!matches.length&&!wantsOverview)return null
  const campuses=matches.length?data.campuses.filter(c=>matches.some(m=>m.campus.id===c.id)):data.campuses.filter(c=>!scope||c.id===scope)
  const card={type:'map' as const,title:matches.length?'建筑位置 · 校园地图':'校园地图',campus:campuses[0].id,matches:campuses.map(c=>({campus:c.id,placeIds:matches.filter(m=>m.campus.id===c.id).map(m=>m.place.id)}))}
  const lines=matches.map(m=>`**${m.campus.name} · ${m.place.name}**：${m.place.description}`)
  const answer=(matches.length?lines.join('\n\n'):'可在下方切换校区、搜索建筑并查看位置。')+
    (campuses.length>1?'\n\n两个校区均有相关位置，请在地图卡片中选择校区。':'')+
    '\n\n位置按用户提供的手绘校园图标示，为示意图。'+campuses.map(c=>`${c.name}原图：${c.edition}。`).join('')
  return {answer,card}
}
export function mapAnswerContent(answer:CampusMapAnswer){return answer.answer+'\n\n```card\n'+JSON.stringify(answer.card)+'\n```'}
