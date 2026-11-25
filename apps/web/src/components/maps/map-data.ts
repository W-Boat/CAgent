import raw from '@/data/campus-maps.json'
import { shallowRef } from 'vue'
import { get } from '@/api/client'
export interface CampusPlace {id:string;name:string;kind:string;x:number;y:number;width:number;height:number;description:string;aliases:string[];shape:string;points?:string;markerX?:number;markerY?:number}
export interface CampusMap {id:string;name:string;edition:string;northRotation:number;source:string;sourceFile:string;imageUrl:string;width:number;height:number;places:CampusPlace[];roads:{name:string;x:number;y:number;rotate:number}[]}
export const campuses=shallowRef(raw.campuses as CampusMap[])
let pending:Promise<void>|undefined
let loadedAt=0
export function loadCampusMaps(){
  if(Date.now()-loadedAt<15000)return Promise.resolve()
  if(!pending)pending=get<{campuses:CampusMap[]}>('/campus/map').then(result=>{if(result.campuses?.length){campuses.value=result.campuses;loadedAt=Date.now()}}).catch(()=>undefined).finally(()=>{pending=undefined})
  return pending
}
export const kinds:Record<string,string>={academic:'教学与办公',residence:'宿舍',dining:'餐饮',sports:'运动',service:'生活服务',gate:'校门',landscape:'花园与广场'}
export function campusById(id:unknown){return campuses.value.find(c=>c.id===id)}
export function validPlaceIds(campus:CampusMap,value:unknown){return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&campus.places.some(p=>p.id===id)).slice(0,30):[]}
