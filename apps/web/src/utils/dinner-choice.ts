export const dinnerCategories=['全部','炸鸡汉堡','粉面米线','饭粥饺子','披萨','烧烤火锅','其他店家'] as const
export const dinnerChannels=['全部','外卖红榜','一食堂','二食堂','三食堂'] as const
export function dinnerChannel(name:string):string {
  if(/^一食堂|^第一食堂/.test(name))return '一食堂'
  if(/^二食堂|^第二食堂/.test(name))return '二食堂'
  if(/^三食堂/.test(name))return '三食堂'
  return '外卖红榜'
}
export function dinnerCategory(name:string):string {
  if(/披萨|达美乐/.test(name))return '披萨'
  if(/炸鸡|鸡架|肯德基|麦当劳|华莱士|塔斯汀/.test(name))return '炸鸡汉堡'
  if(/米线|[粉面]|麻辣烫|刘文祥/.test(name))return '粉面米线'
  if(/烧烤|烤肉|火锅|牛肉串|肉筋/.test(name))return '烧烤火锅'
  if(/[饭粥饺]|和合谷|吉野家|乡村基|红烧肉/.test(name))return '饭粥饺子'
  return '其他店家'
}
export function dinnerNames(value:unknown):string[] {
  if(!Array.isArray(value))return []
  return [...new Set(value.filter((name):name is string=>typeof name==='string').map(name=>name.trim()).filter(name=>!!name&&name.length<=80))].slice(0,500)
}
/** An exhausted bag is refilled, keeping the previous choice out of its first draw. */
export function nextDinner(names:string[],bag:string[],previous:string,random= Math.random):{name:string;remaining:string[]} {
  let pool=bag.filter(name=>names.includes(name))
  if(!pool.length)pool=[...names]
  const candidates=pool.length>1?pool.filter(name=>name!==previous):pool
  if(!candidates.length)return {name:'',remaining:[]}
  const value=Math.max(0,Math.min(.999999999,random())),name=candidates[Math.floor(value*candidates.length)]
  return {name,remaining:pool.filter(item=>item!==name)}
}
