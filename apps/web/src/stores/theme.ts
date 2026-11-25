import {defineStore} from 'pinia'
import {readDisplayPolicy} from '@/utils/display-policy'
export type ThemeMode='light'|'dark'
export type ThemePreference=ThemeMode|'system'
const STORAGE_KEY='cagent-theme'
const systemMode=():ThemeMode=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light'
function savedMode(){try{const value=localStorage.getItem(STORAGE_KEY);return value==='light'||value==='dark'||value==='system'?value:null}catch{return null}}
const resolveMode=(preference:ThemePreference)=>preference==='system'?systemMode():preference
function apply(mode:ThemeMode){const root=document.documentElement;root.classList.toggle('dark',mode==='dark');root.style.colorScheme=mode;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',mode==='dark'?'#18181b':'#fafafa')}
let initialized=false
export const useThemeStore=defineStore('theme',{
 state:()=>{
  const policy=readDisplayPolicy(),preference=(policy.allowToggle?savedMode():null)||policy.theme
  return {mode:resolveMode(preference),preference,allowToggle:policy.allowToggle}
 },
 getters:{isDark:state=>state.mode==='dark'},
 actions:{
  init(){apply(this.mode);if(initialized)return;initialized=true;window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(this.preference==='system'){this.mode=systemMode();apply(this.mode)}})},
  applyPolicy(mode:ThemePreference='system',allowToggle=true){this.allowToggle=allowToggle;this.preference=(allowToggle?savedMode():null)||mode;this.mode=resolveMode(this.preference);apply(this.mode)},
  set(mode:ThemePreference){if(!this.allowToggle)return;this.preference=mode;this.mode=resolveMode(mode);try{localStorage.setItem(STORAGE_KEY,mode)}catch{};apply(this.mode)},
  toggle(){this.set(this.mode==='dark'?'light':'dark')}
 }
})
