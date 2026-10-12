#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const data=JSON.parse(readFileSync(resolve(root,'knowledge/src/campus-maps.json'),'utf8'))
if(data.schema!=='campus-map/v1' || data.coordinateSystem!=='schematic')throw new Error('Invalid campus map schema')
const campusIds=new Set()
for(const campus of data.campuses){
  if(campusIds.has(campus.id))throw new Error('Duplicate campus')
  campusIds.add(campus.id);const ids=new Set()
  for(const p of campus.places){
    if(ids.has(p.id))throw new Error('Duplicate place '+p.id)
    ids.add(p.id)
    if(!p.name || !p.description || !['rect','garden','ellipse','stadium','dome','polygon'].includes(p.shape))throw new Error('Incomplete place '+p.id)
    if([p.x,p.y,p.width,p.height].some(v=>!Number.isFinite(v)) || p.x<0 || p.y<0 || p.width<=0 || p.height<=0 || p.x+p.width>campus.width || p.y+p.height>campus.height)throw new Error('Out-of-bounds place '+p.id)
  }
}
const json=JSON.stringify(data,null,2)+'\n'
for(const path of ['apps/api/src/campus/campus-maps.data.json','apps/web/src/data/campus-maps.json']){
  const target=resolve(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,json)
}
console.log('Campus maps generated: '+data.campuses.map(c=>`${c.name} ${c.places.length} 个位置`).join(' / '))
