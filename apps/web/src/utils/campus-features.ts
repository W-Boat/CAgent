export const campusPages={
  calendar:'/student/academic-calendar',phone:'/student/directory',map:'/map',information:'/student/information',services:'/student/services',apps:'/student/applications',
} as const
export const campusDrawers=['dinner','takeout','game','lecture'] as const
export type CampusDrawer=typeof campusDrawers[number]
export type CampusFeature=keyof typeof campusPages|CampusDrawer
export const campusFeatureLabels:Record<CampusFeature,string>={calendar:'学年校历',phone:'部门电话',map:'校园地图',information:'校园资讯',services:'办事大厅',apps:'应用中心',dinner:'今天吃什么',takeout:'外卖红黑榜',game:'校园助手小游戏',lecture:'讲座日历'}
export const isCampusFeature=(value:unknown):value is CampusFeature=>typeof value==='string'&&Object.prototype.hasOwnProperty.call(campusFeatureLabels,value)

export function featureFromCard(card:Record<string,unknown>):CampusFeature|undefined {
  if(card.type==='campus-feature')return isCampusFeature(card.feature)?card.feature:undefined
  if(card.type==='lecture-calendar'||card.type==='lectures')return 'lecture'
  if(card.type==='map'||card.type==='dinner'||card.type==='takeout')return card.type
}

export function chatReturn(value:unknown){
  return typeof value==='string'&&/^\/(?:student|chat(?:\/[a-z\d_-]{1,100})?)$/i.test(value)?value:undefined
}
