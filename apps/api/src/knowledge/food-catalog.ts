export interface FoodItem {id:number;name:string;price:string;place:string;pgroup:string;category:string;verdict:'good'|'mixed'|'bad';reviews:string[];sources:string[];drawable:boolean}
export const foodSource='社科大外卖红黑榜_RAG.json'
export function foodItem(value:any):FoodItem|null{
 if(!value||!Number.isSafeInteger(value.id)||!['good','mixed','bad'].includes(value.verdict)||!['name','price','place','pgroup','category'].every(k=>typeof value[k]==='string')||!value.name.trim()||!['reviews','sources'].every(k=>Array.isArray(value[k])&&value[k].every((s:any)=>typeof s==='string'))||typeof value.drawable!=='boolean')return null
 return {id:value.id,name:value.name,price:value.price,place:value.place,pgroup:value.pgroup,category:value.category,verdict:value.verdict,reviews:value.reviews,sources:value.sources,drawable:value.drawable}
}
/** The same complete red list powers the directory and meal choices; filters belong in the UI. */
export function dinnerEligible(item:FoodItem){return item.verdict==='good'}
export function mealName(item:FoodItem){return item.pgroup==='一食堂'&&!/^一食堂/.test(item.name)?'一食堂 · '+item.name:item.pgroup==='二食堂窗口'&&!/^二食堂/.test(item.name)?'二食堂 · '+item.name:item.name}
