const features = [
  {id:'calendar',title:'学年校历',names:'学年校历|学校校历|教学日历|校历',baseId:'kb-ucass-academic-calendar'},
  {id:'phone',title:'部门电话',names:'部门(?:办公)?电话(?:列表|目录)?|校园通讯录|办公电话(?:列表|目录)?',baseId:'kb-ucass-office-phones'},
  {id:'lecture',title:'讲座日历',names:'(?:校园)?讲座日历|讲座日程',baseId:'lectures'},
  {id:'map',title:'校园地图',names:'校园地图|校区地图|学校地图|地图',baseId:'campus-maps'},
  {id:'services',title:'办事大厅',names:'(?:校园)?办事大厅|办事指南|校园服务大厅',baseId:'services'},
  {id:'apps',title:'应用中心',names:'(?:校园)?应用中心|校园应用(?:列表|目录)?|学校应用',baseId:'kb-ucass-portal-navigation'},
  {id:'information',title:'校园资讯',names:'校园资讯|学校要闻|校园要闻|学校资讯',baseId:'kb-ucass-public-news'},
  {id:'dinner',title:'今天吃什么',names:'今天吃什么|今晚吃什么|帮我选餐|帮我选一家吃饭',baseId:'dinner'},
  {id:'takeout',title:'外卖红黑榜',names:'(?:校园)?外卖红黑榜|外卖红榜',baseId:'takeout'},
  {id:'game',title:'辛瓜小游戏',names:'辛瓜小游戏|玩辛瓜小游戏|辛瓜游戏|玩辛瓜游戏',baseId:'game'},
] as const

export function campusFeatureIntent(input:string) {
  const text=input.normalize('NFKC').replace(/[\s。！!？?，,「」“”《》]/g,'')
  return features.find(feature=>new RegExp(`^(?:请|能不能|可以|麻烦)?(?:帮我|给我|带我)?(?:去|打开|查看|看看|显示|浏览|调出|进入|切到|切换到|玩|看)?(?:一下)?(?:${feature.names})(?:页面|入口)?(?:一下|吧|吗|呢)?$`).test(text))
}
