<template>
  <section class="campus-map-card" :data-campus-entry="'map:'+campus.id+':'+(focusIds[0]||'all')" data-campus-collection="maps">
    <div class="map-card-heading"><div><span class="map-kicker">CAMPUS MAP</span><h4>{{selectedPlaces.length?selectedPlaces.map(p=>p.name).join(' · '):'校园地图'}}</h4></div><RouterLink class="map-open" :to="mapLink" target="_blank" rel="noopener">展开地图 ↗</RouterLink></div>
    <div class="map-card-tabs" aria-label="地图校区"><button v-for="c in campuses" :key="c.id" type="button" :class="{'is-active':c.id===campus.id}" :aria-pressed="c.id===campus.id" @click="switchCampus(c.id)">{{c.name}}</button></div>
    <CampusMapCanvas :key="campus.id" :campus="campus" :focus-ids="focusIds" compact @select="picked=$event"/>
    <div class="map-card-details"><p v-for="p in selectedPlaces.slice(0,3)" :key="p.id"><strong>{{p.name}}</strong> · {{p.description}}</p><p v-if="!selectedPlaces.length">点击建筑查看位置；可切换校区、拖动和缩放地图。</p><small>据 {{campus.edition}} 手绘原图标记 · 示意位置</small></div>
  </section>
</template>
<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {trackCampus} from '@/utils/campus-activity'
import CampusMapCanvas from './CampusMapCanvas.vue'
import {campuses,campusById,validPlaceIds} from './map-data'
const props=defineProps<{card:Record<string,unknown>}>()
const campusId=ref(campusById(props.card.campus)?.id || campuses[0].id),picked=ref('')
const campus=computed(()=>campusById(campusId.value)!)
const focusIds=computed(()=>{if(picked.value)return validPlaceIds(campus.value,[picked.value]);const matches=Array.isArray(props.card.matches)?props.card.matches:[];const m=matches.find(m=>m&&typeof m==='object'&&m.campus===campus.value.id);return validPlaceIds(campus.value,m?.placeIds)})
const selectedPlaces=computed(()=>campus.value.places.filter(p=>focusIds.value.includes(p.id)))
const mapLink=computed(()=>({path:'/map',query:{campus:campus.value.id,...(focusIds.value[0]?{place:focusIds.value[0]}:{})}}))
watch(()=>[campusId.value,picked.value].join(':'),()=>{trackCampus('MAP_VIEW',{entryId:'map:'+campusId.value+':'+(picked.value||focusIds.value[0]||'all'),collection:'maps',title:campus.value.name+' · '+(selectedPlaces.value[0]?.name||'全校地图')})},{immediate:true})
function switchCampus(id:string){campusId.value=id;picked.value=''}
// Display sanitation creates new objects during parent renders. Reset only for new map data.
watch(()=>JSON.stringify([props.card.campus,props.card.matches]),()=>{campusId.value=campusById(props.card.campus)?.id || campuses[0].id;picked.value=''})
</script>
<style scoped>
.campus-map-card{padding:20px;background:#fffdf8;color:#2f463b;border:1px solid #d8e3d9;border-radius:20px;font-family:inherit}.map-card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.map-kicker{font-size:10px;letter-spacing:2px;color:#7b917f}.map-card-heading h4{margin:5px 0 0;font-size:18px;font-weight:650}.map-open{font-size:12px;text-decoration:none;color:#426e55;white-space:nowrap}.map-card-tabs{display:flex;gap:6px;margin-bottom:12px}.map-card-tabs button{font:inherit;font-size:12px;border:1px solid #d6e0d4;background:transparent;color:#62786a;padding:6px 12px;border-radius:20px;cursor:pointer}.map-card-tabs .is-active{background:#284e3d;border-color:#284e3d;color:white}.map-card-details{padding-top:11px}.map-card-details p{margin:4px 0;font-size:12px;line-height:1.6}.map-card-details small{display:block;color:#819085;font-size:10px;margin-top:7px}@media(max-width:600px){.campus-map-card{padding:12px}.map-card-heading h4{font-size:16px}}
</style>
<style scoped>
.campus-map-card{background:var(--nx-surface,var(--cg-card-bg));color:var(--nx-text,var(--cg-text));border-color:var(--nx-border,var(--cg-border))}
.map-kicker,.map-card-details small{color:var(--nx-text-2,var(--cg-text-muted))}
.map-open{color:var(--nx-accent,var(--cg-brand))}
.map-card-tabs button{color:var(--nx-text-2,var(--cg-text-secondary));border-color:var(--nx-border,var(--cg-border))}
.map-card-tabs .is-active{background:var(--nx-accent,var(--cg-brand));border-color:var(--nx-accent,var(--cg-brand));color:var(--platform-on-accent,#fff)}
</style>
