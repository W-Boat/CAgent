import raw from '@/data/campus-maps.json'
export interface CampusPlace {id:string;name:string;kind:string;x:number;y:number;width:number;height:number;description:string;aliases:string[];shape:string;points?:string;markerX?:number;markerY?:number}
export interface CampusMap {id:string;name:string;edition:string;northRotation:number;source:string;sourceFile:string;imageUrl:string;width:number;height:number;places:CampusPlace[];roads:{name:string;x:number;y:number;rotate:number}[]}
export const campuses=raw.campuses as CampusMap[]
export const kinds:Record<string,string>={academic:'教学与办公',residence:'宿舍',dining:'餐饮',sports:'运动',service:'生活服务',gate:'校门',landscape:'花园与广场'}
export function campusById(id:unknown){return campuses.find(c=>c.id===id)}
export function validPlaceIds(campus:CampusMap,value:unknown){return Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'&&campus.places.some(p=>p.id===id)).slice(0,30):[]}
