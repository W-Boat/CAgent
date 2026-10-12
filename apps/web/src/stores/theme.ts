import {defineStore} from 'pinia'
import {readDisplayPolicy} from '@/utils/display-policy'
export type ThemeMode='light'|'dark'
const STORAGE_KEY='cagent-theme'
const systemMode=():ThemeMode=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light'
function savedMode(){try{const value=localStorage.getItem(STORAGE_KEY);return value==='light'||value==='dark'?value:null}catch{return null}}
function initial(){const policy=readDisplayPolicy();return policy.allowToggle&&savedMode()|| (policy.theme==='system'?systemMode():policy.theme)}
function apply(mode:ThemeMode){const root=document.documentElement;root.classList.toggle('dark',mode==='dark');root.style.colorScheme=mode;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',mode==='dark'?'#18181b':'#fafafa')}
let initialized=false
export const useThemeStore=defineStore('theme',{
 state:()=>({mode:initial() as ThemeMode,defaultMode:readDisplayPolicy().theme,allowToggle:readDisplayPolicy().allowToggle}),
 getters:{isDark:state=>state.mode==='dark'},
 actions:{
  init(){apply(this.mode);if(initialized)return;initialized=true;window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(this.defaultMode==='system'&&(!this.allowToggle||!savedMode())){this.mode=systemMode();apply(this.mode)}})},
  applyPolicy(mode:'system'|'light'|'dark'='system',allowToggle=true){this.defaultMode=['system','light','dark'].includes(mode)?mode:'system';this.allowToggle=allowToggle;this.mode=(allowToggle?savedMode():null)|| (this.defaultMode==='system'?systemMode():this.defaultMode);apply(this.mode)},
  set(mode:ThemeMode){if(!this.allowToggle)return;this.mode=mode;try{localStorage.setItem(STORAGE_KEY,mode)}catch{};apply(mode)},
  toggle(){this.set(this.mode==='dark'?'light':'dark')}
 }
})
