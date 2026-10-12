<template>
  <div class="map-canvas" :class="{'map-compact':compact}">
    <div class="map-compass" :title="`北方向${campus.northRotation===90?'右':'右上'}`"><svg viewBox="0 0 40 40" aria-hidden="true"><g :transform="`rotate(${campus.northRotation} 20 20)`"><path d="M20 3 12 24l8-4 8 4Z" fill="currentColor"/><path d="M20 20v17" stroke="currentColor" stroke-width="2"/></g></svg><span>北</span></div>
    <svg ref="svgEl" class="map-drawing" :viewBox="viewBox" :style="{aspectRatio:campus.width+'/'+campus.height}" role="img" :aria-label="`${campus.name}校园示意地图`" @wheel.prevent="onWheel" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
      <image :href="campus.imageUrl" x="0" y="0" :width="campus.width" :height="campus.height" preserveAspectRatio="xMidYMid meet"/>
      <g v-for="p in campus.places" :key="p.id" class="map-place" :class="{'is-selected':focusIds.includes(p.id)}" :data-place="p.id" tabindex="0" role="button" :aria-label="`${p.name}，${p.description}`" :aria-pressed="focusIds.includes(p.id)" @keydown.enter.prevent="$emit('select',p.id)" @keydown.space.prevent="$emit('select',p.id)">
        <title>{{p.name}} · {{p.description}}</title>
        <polygon v-if="p.shape==='polygon'" :points="p.points" class="map-footprint"/>
        <rect v-else :x="p.x" :y="p.y" :width="p.width" :height="p.height" rx="6" class="map-footprint"/>
        <g class="map-point" :transform="`translate(${p.markerX ?? p.x+p.width/2} ${p.markerY ?? p.y+p.height/2})`" aria-hidden="true">
          <circle class="map-point-halo" r="13"/><circle class="map-point-dot" r="6"/>
          <g v-if="focusIds.includes(p.id)" class="map-pin"><path d="M0 0C-6-7-12-11-12-19a12 12 0 0 1 24 0C12-11 6-7 0 0Z" fill="var(--nx-accent,var(--cg-brand,#6159b9))" stroke="white" stroke-width="2"/><circle cy="-19" r="4" fill="white"/></g>
        </g>
      </g>
    </svg>
    <div class="map-zoom" aria-label="地图缩放"><button type="button" aria-label="放大地图" @click="setZoom(zoom*1.3)">＋</button><button type="button" aria-label="缩小地图" @click="setZoom(zoom/1.3)">−</button><button type="button" aria-label="查看全校地图" @click="reset">全图</button></div>
    <span class="map-scale-note">原图标记 · 可拖动</span>
  </div>
</template>
<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import type {CampusMap} from './map-data'
const props=withDefaults(defineProps<{campus:CampusMap;focusIds?:string[];compact?:boolean}>(),{focusIds:()=>[],compact:false})
const emit=defineEmits<{(e:'select',id:string):void}>()
const svgEl=ref<SVGSVGElement>(),zoom=ref(1),cx=ref(500),cy=ref(370)
const viewWidth=computed(()=>props.campus.width/zoom.value),viewHeight=computed(()=>props.campus.height/zoom.value)
const viewBox=computed(()=>`${Math.max(0,Math.min(props.campus.width-viewWidth.value,cx.value-viewWidth.value/2))} ${Math.max(0,Math.min(props.campus.height-viewHeight.value,cy.value-viewHeight.value/2))} ${viewWidth.value} ${viewHeight.value}`)
function setZoom(n:number){zoom.value=Math.max(1,Math.min(4,n))}
function reset(){zoom.value=1;cx.value=props.campus.width/2;cy.value=props.campus.height/2}
function focus(){const places=props.campus.places.filter(p=>props.focusIds.includes(p.id));if(!places.length){reset();return}const left=Math.min(...places.map(p=>p.x)),right=Math.max(...places.map(p=>p.x+p.width)),top=Math.min(...places.map(p=>p.y)),bottom=Math.max(...places.map(p=>p.y+p.height));cx.value=(left+right)/2;cy.value=(top+bottom)/2;setZoom(Math.min(2,props.campus.width/(right-left+380),props.campus.height/(bottom-top+260)))}
watch(()=>[props.campus.id,props.focusIds.join(',')],focus,{immediate:true})
function onWheel(e:WheelEvent){setZoom(zoom.value*(e.deltaY<0?1.12:1/1.12))}
const pointers=new Map<number,{x:number;y:number}>();let moved=false,travel=0,pendingPlace='',pinchSpan=0,pinchZoom=1
function onDown(e:PointerEvent){if(e.button!==0)return;if(!pointers.size){moved=false;travel=0;pendingPlace=(e.target as Element).closest('[data-place]')?.getAttribute('data-place') || ''}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){moved=true;const [a,b]=[...pointers.values()];pinchSpan=Math.hypot(a.x-b.x,a.y-b.y);pinchZoom=zoom.value}svgEl.value?.setPointerCapture(e.pointerId)}
function onMove(e:PointerEvent){const old=pointers.get(e.pointerId);if(!old)return;const dx=e.clientX-old.x,dy=e.clientY-old.y;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});travel+=Math.hypot(dx,dy);if(travel>5)moved=true;if(pointers.size===2){const [a,b]=[...pointers.values()];if(pinchSpan)setZoom(pinchZoom*Math.hypot(a.x-b.x,a.y-b.y)/pinchSpan);return}const bounds=svgEl.value?.getBoundingClientRect();if(!bounds)return;cx.value=Math.max(viewWidth.value/2,Math.min(props.campus.width-viewWidth.value/2,cx.value-dx*viewWidth.value/bounds.width));cy.value=Math.max(viewHeight.value/2,Math.min(props.campus.height-viewHeight.value/2,cy.value-dy*viewHeight.value/bounds.height))}
function onUp(e:PointerEvent){if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);if(svgEl.value?.hasPointerCapture(e.pointerId))svgEl.value.releasePointerCapture(e.pointerId);if(!pointers.size && !moved && pendingPlace && e.type!=='pointercancel')emit('select',pendingPlace)}
</script>
<style scoped>
.map-canvas{position:relative;overflow:hidden;background:#f6f4ed;border:1px solid #d8e1d7;border-radius:20px;isolation:isolate}.map-drawing{display:block;width:100%;aspect-ratio:1000/740;touch-action:none;user-select:none}.map-place{cursor:pointer;outline:none}.map-footprint{fill:#a1bbb0;stroke:#688c7c;stroke-width:2;transition:stroke .15s,fill .15s}.residence .map-footprint{fill:#e4c897;stroke:#b29c71}.dining .map-footprint{fill:#daa788;stroke:#b58268}.sports .map-footprint{fill:#c19c84;stroke:#9a7964}.service .map-footprint{fill:#bdc7c7;stroke:#879b99}.landscape .map-footprint{fill:#d2ddb1;stroke:#aab98b}.gate .map-footprint{fill:#ead7a3;stroke:#bda66f}.map-place:hover .map-footprint,.map-place:focus-visible .map-footprint{stroke:#324e43;stroke-width:4}.is-selected .map-footprint{stroke:#d76849!important;stroke-width:5;filter:drop-shadow(0 3px 3px #ad614336)}.map-label{fill:#233d32;text-anchor:middle;font-weight:650;pointer-events:none;paint-order:stroke;stroke:#f9f7ee;stroke-width:3;stroke-linejoin:round}.map-street text{fill:#79887e;font-size:15px;letter-spacing:4px;text-anchor:middle}.map-compass{position:absolute;right:16px;top:12px;display:flex;align-items:center;color:#355347;font-size:12px;z-index:1;pointer-events:none}.map-compass svg{width:35px;height:35px}.map-zoom{position:absolute;right:14px;bottom:14px;display:flex;gap:1px;border:1px solid #d4ddd3;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px #213e3110}.map-zoom button{border:0;background:#fffdf7;color:#294d3c;min-width:38px;height:38px;font:inherit;font-size:19px;cursor:pointer}.map-zoom button:last-child{font-size:12px;padding:0 10px}.map-zoom button:hover{background:#e9f0e6}.map-scale-note{position:absolute;left:14px;bottom:14px;font-size:11px;color:#627668;background:#fffdf5dc;border-radius:6px;padding:4px 7px}.map-compact{border-radius:14px}.map-compact .map-zoom{right:10px;bottom:10px}
</style>
<style scoped>
.map-zoom{border-color:var(--nx-border,var(--cg-border))}
.map-zoom button{color:var(--nx-accent,var(--cg-brand));background:var(--nx-surface,var(--cg-card-bg))}
.map-zoom button:hover{background:var(--nx-accent-soft,var(--cg-brand-soft))}
.map-place:hover .map-footprint,.map-place:focus-visible .map-footprint{stroke:var(--nx-accent,var(--cg-brand))}
.is-selected .map-footprint{stroke:var(--nx-accent,var(--cg-brand))!important}
</style>

<style scoped>
.map-footprint{fill:transparent!important;stroke:transparent;stroke-width:2}.is-selected .map-footprint{fill:color-mix(in srgb,var(--nx-accent,var(--cg-brand,#6159b9)) 12%,transparent)!important;stroke-width:3;filter:none}.map-point{pointer-events:none}.map-point-halo{fill:#fff;opacity:.9;stroke:#29254d;stroke-width:1}.map-point-dot{fill:var(--nx-accent,var(--cg-brand,#6159b9));stroke:white;stroke-width:1.5}.map-place:hover .map-point-halo,.map-place:focus-visible .map-point-halo{stroke-width:3}.map-canvas{background:#e9e6dc}.map-compass{padding:3px 6px;border-radius:8px;background:#fffffff0}
</style>
