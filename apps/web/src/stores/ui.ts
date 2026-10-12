import {defineStore} from 'pinia'
import {readDisplayPolicy,validAccent,accentText} from '@/utils/display-policy'
const ACCENT_KEY='cagent-accent'
export const ACCENT_PRESETS = [
  { key: "indigo", label: "靛蓝", value: "#4f46e5" },
  { key: "blue", label: "品牌蓝", value: "#2563eb" },
  { key: "violet", label: "紫罗兰", value: "#7c3aed" },
  { key: "emerald", label: "翠绿", value: "#059669" },
  { key: "amber", label: "琥珀", value: "#d97706" },
  { key: "rose", label: "玫红", value: "#e11d48" }
] as const


export const useUiStore=defineStore('ui',{
 state:()=>({accent:'',serverAccent:readDisplayPolicy().accent,managed:readDisplayPolicy().unified}),
 actions:{
  setAccent(value:string){if(this.managed||!validAccent(value))return;try{localStorage.setItem(ACCENT_KEY,value.toLowerCase())}catch{};this.applyAccent()},
  applyAccent(){
   if(typeof window==='undefined')return
   let personal='';try{personal=localStorage.getItem(ACCENT_KEY)||''}catch{}
   const color=!this.managed&&validAccent(personal)?personal.toLowerCase():validAccent(this.serverAccent)?this.serverAccent.toLowerCase():'#4f46e5'
   this.accent=color;const root=document.documentElement
   root.style.setProperty('--nx-accent-raw',color)
   root.style.setProperty('--platform-accent-text',accentText(color))
   root.style.setProperty('--platform-accent-text-dark',accentText(color,true))
  },
  applyServerAccent(color:string,managed=true){this.serverAccent=validAccent(color)?color.toLowerCase():'#4f46e5';this.managed=managed;this.applyAccent()}
 }
})
