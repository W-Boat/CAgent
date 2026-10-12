const KEY='cagent-display-policy'
export interface DisplayPolicy {accent:string;unified:boolean;theme:'system'|'light'|'dark';allowToggle:boolean}
export const validAccent=(value:unknown):value is string=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)
export function readDisplayPolicy():DisplayPolicy {
 const fallback:DisplayPolicy={accent:'#4f46e5',unified:true,theme:'system',allowToggle:true}
 try{const value=JSON.parse(localStorage.getItem(KEY)||'null');if(!value)return fallback;return {accent:validAccent(value.accent)?value.accent.toLowerCase():fallback.accent,unified:value.unified!==false,theme:['light','dark','system'].includes(value.theme)?value.theme:'system',allowToggle:value.allowToggle!==false}}catch{return fallback}
}
export function saveDisplayPolicy(policy:DisplayPolicy){try{localStorage.setItem(KEY,JSON.stringify(policy))}catch{}}
function luminance(rgb:number[]){return rgb.map(v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0)}
export function accentText(color:string,dark=false){
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));const l=luminance(dark?rgb.map(c=>c*.72+255*.28):rgb)
 return (l+0.05)/(luminance([24,24,27])+0.05)>1.05/(l+0.05)?'#18181b':'#ffffff'
}
