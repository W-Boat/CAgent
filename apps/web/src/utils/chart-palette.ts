import type { EChartsOption } from './echarts'

/** Resolve CSS variables and color-mix to hex: ECharts' color parser does not
 * accept browser color functions, even when canvas itself supports them. */
export function resolvedColor(el: HTMLElement, name: string, fallback: string): string {
 const value=getComputedStyle(el).getPropertyValue(name).trim()||fallback
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1
 const ctx=canvas.getContext('2d',{willReadFrequently:true})
 if(!ctx)return fallback
 ctx.fillStyle=fallback
 if(CSS.supports('color',value))ctx.fillStyle=value
 ctx.fillRect(0,0,1,1)
 const [r,g,b]=ctx.getImageData(0,0,1,1).data
 return '#'+[r,g,b].map(n=>n.toString(16).padStart(2,'0')).join('')
}

/** Adapt legacy chart options without mutating caller data or status colors. */
export function themedChartOption(option:EChartsOption,el:HTMLElement):EChartsOption {
 const accent=resolvedColor(el,'--cg-brand','#4f46e5'),text=resolvedColor(el,'--cg-text-secondary','#55555e'),border=resolvedColor(el,'--cg-border','#e8e8ec'),surface=resolvedColor(el,'--cg-card-bg','#ffffff')
 const replace:Record<string,string>={'#2563eb':accent,'#e2e8f0':border,'#eef1f7':border,'#f1f5f9':border,'#64748b':text,'#6b7280':text}
 const alpha=(a:string)=>`rgba(${parseInt(accent.slice(1,3),16)},${parseInt(accent.slice(3,5),16)},${parseInt(accent.slice(5,7),16)},${a})`
 const walk=(value:any):any=>{
  if(typeof value==='string')return replace[value.toLowerCase()]||value.replace(/rgba\(37,\s*99,\s*235,\s*([\d.]+)\)/gi,(_,a)=>alpha(a))
  if(Array.isArray(value))return value.map(walk)
  if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,walk(item)]))
  return value
 }
 const result=walk(option)
 result.color ||= [accent,'#16a34a','#f59e0b','#8b5cf6','#ef4444','#94a3b8']
 result.textStyle={color:text,...result.textStyle}
 const decorate=(value:any,fn:(item:any)=>any)=>Array.isArray(value)?value.map(fn):fn(value)
 if(result.tooltip)result.tooltip=decorate(result.tooltip,item=>({...item,backgroundColor:surface,borderColor:border,textStyle:{...item.textStyle,color:text}}))
 if(result.legend)result.legend=decorate(result.legend,item=>({...item,textStyle:{color:text,...item.textStyle}}))
 for(const key of ['xAxis','yAxis'])if(result[key])result[key]=decorate(result[key],item=>({...item,axisLabel:{color:text,...item.axisLabel},axisLine:{...item.axisLine,lineStyle:{color:border,...item.axisLine?.lineStyle}},splitLine:{...item.splitLine,lineStyle:{color:border,...item.splitLine?.lineStyle}}}))
 return result
}
