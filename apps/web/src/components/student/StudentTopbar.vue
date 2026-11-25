<template>
  <header class="campus-topbar" :class="{'topbar-menu-only':menuOnly}">
    <div v-if="!menuOnly" class="topbar-brand">
      <slot name="leading"/>
      <RouterLink v-if="!chat" :to="returnPath" class="nx-icon-btn" aria-label="返回对话" title="返回对话"><el-icon><Back/></el-icon></RouterLink>
      <strong class="topbar-title" :title="title">{{title}}</strong>
      <span v-if="subtitle" class="topbar-live" :title="subtitle" :aria-label="subtitle" role="status"></span>
    </div>
    <nav class="campus-tools" aria-label="校园服务">
      <button v-for="item in quick" :key="item.id" class="campus-quick" type="button" @click="run(item.id)" :aria-label="item.label" :title="item.label"><el-icon><component :is="item.icon"/></el-icon><span>{{item.label}}</span></button>
      <el-dropdown trigger="click" placement="bottom-end" @command="run">
        <button class="campus-menu-trigger" type="button" aria-label="校园功能" title="校园功能"><el-icon><Grid/></el-icon><span>校园功能</span><el-icon><ArrowDown/></el-icon></button>
        <template #dropdown><el-dropdown-menu class="campus-feature-menu">
          <el-dropdown-item v-for="item in menuItems" :key="item.id" :command="item.id"><el-icon><component :is="item.icon"/></el-icon>{{item.label}}</el-dropdown-item>
          <el-dropdown-item v-if="!menuItems.length" disabled>暂无菜单入口</el-dropdown-item>
        </el-dropdown-menu></template>
      </el-dropdown>
      <button v-if="auth.user" class="campus-edit" type="button" title="编辑顶栏" aria-label="编辑顶栏" @click="openEditor"><el-icon><Setting/></el-icon></button>
    </nav>
    <div v-if="!menuOnly" class="topbar-controls">
      <button v-if="chat&&petHidden" class="nx-icon-btn show-mascot" type="button" title="显示校园助手" aria-label="显示校园助手" @click="emit('show-pet')">
        <MascotImage/>
      </button>
      <img v-if="auth.settings?.student_logo_url" :src="auth.settings.student_logo_url" class="campus-logo" alt=""/>
      <el-dropdown v-if="chat&&auth.user" trigger="click" @command="emit('account',$event)">
        <button class="nx-avatar campus-avatar" type="button" aria-label="个人菜单" :title="auth.displayName">{{(auth.displayName||'同').slice(0,1)}}</button>
        <template #dropdown><el-dropdown-menu>
          <el-dropdown-item command="usage">我的用量</el-dropdown-item>
          <el-dropdown-item v-if="auth.settings?.memory_enabled!==false" command="memory">我的记忆</el-dropdown-item>
          <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
        </el-dropdown-menu></template>
      </el-dropdown>
    </div>

    <el-dialog v-model="editing" append-to-body destroy-on-close title="编辑顶栏" width="min(640px, 94vw)" top="6dvh" class="student-topbar-dialog">
      <TopbarShortcutEditor v-model="draftLayout" :items="sorted(draftLayout.order)" :limit="pinLimit"/>
      <div class="mobile-panel-setting"><span>手机打开方式</span><el-radio-group v-model="draftMobile" size="small" aria-label="手机打开方式"><el-radio-button value="drawer">半屏抽屉</el-radio-button><el-radio-button value="full">全屏</el-radio-button></el-radio-group></div>
      <template #footer><el-button text @click="resetEditor">恢复默认</el-button><el-button @click="editing=false">取消</el-button><el-button type="primary" @click="save">保存顶栏</el-button></template>
    </el-dialog>

    <el-dialog v-model="themeOpen" append-to-body title="外观" width="min(360px, 92vw)">
      <el-radio-group :model-value="theme.preference" aria-label="外观模式" @change="chooseTheme">
        <el-radio-button value="system">自动（跟随系统）</el-radio-button>
        <el-radio-button value="light">浅色</el-radio-button>
        <el-radio-button value="dark">深色</el-radio-button>
      </el-radio-group>
    </el-dialog>

    <CampusFeatureHost ref="featureHost" :narrow="small" :mobile-mode="prefs.mobile" @ask="askOnChat"/>
  </header>
</template>

<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch,type Component} from 'vue'
import {ArrowDown,Back,Calendar,Collection,Food,Grid,MapLocation,Moon,Phone,Present,Setting,Sunny,Tickets} from '@element-plus/icons-vue'
import {useRoute,useRouter} from 'vue-router'
import {get} from '@/api/client'
import {useAuthStore} from '@/stores/auth'
import {useThemeStore} from '@/stores/theme'
import CampusFeatureHost from './CampusFeatureHost.vue'
import MascotImage from '@/components/experience/MascotImage.vue'
import TopbarShortcutEditor, {type TopbarLayout} from './TopbarShortcutEditor.vue'
import {chatReturn,isCampusFeature,type CampusFeature} from '@/utils/campus-features'

const props=defineProps<{title?:string;subtitle?:string;chat?:boolean;menuOnly?:boolean;takeout?:boolean;showMap?:boolean;petHidden?:boolean}>()
const emit=defineEmits<{'show-pet':[];account:[command:string];ask:[text:string]}>()
const auth=useAuthStore(),theme=useThemeStore(),route=useRoute(),router=useRouter()
const featureHost=ref<InstanceType<typeof CampusFeatureHost>>(),small=ref(false)
const returnPath=computed(()=>chatReturn(route.query.back)||(auth.user&&!auth.isStudent?'/chat':'/student'))
type Shortcut={id:CampusFeature|'theme';label:string;icon:Component;to?:string}
const availableFeatures=ref<{label:string;question:string}[]>([])
const hasFeature=(name:RegExp)=>availableFeatures.value.some(item=>name.test(item.label+' '+item.question))
const catalog=computed<Shortcut[]>(()=>[
  {id:'dinner',icon:Food,label:'今天吃什么'},
  {id:'game',icon:Present,label:'校园助手小游戏'},
  {id:'calendar',to:'/student/academic-calendar',icon:Calendar,label:'学年校历'},
  {id:'lecture',icon:Calendar,label:'讲座日历'},
  ...(props.showMap===false?[]:[{id:'map' as const,to:'/map',icon:MapLocation,label:'校园地图'}]),
  {id:'information',to:'/student/information',icon:Collection,label:'校园资讯'},
  {id:'phone',to:'/student/directory',icon:Phone,label:'部门电话'},
  {id:'services',to:'/student/services',icon:Tickets,label:'办事大厅'},
  {id:'apps',to:'/student/applications',icon:Grid,label:'应用中心'},
  ...((props.chat?props.takeout:hasFeature(/外卖红黑榜/))?[{id:'takeout' as const,icon:Food,label:'外卖红黑榜'}]:[]),
  ...(theme.allowToggle?[{id:'theme' as const,icon:theme.isDark?Moon:Sunny,label:'外观设置'}]:[]),
])
const defaultPinned=['dinner','game']
const pinLimit=2
const initialLayout=():TopbarLayout=>({order:[],hidden:[],pinned:[...defaultPinned]})
const prefs=ref<TopbarLayout&{mobile:'drawer'|'full'}>({...initialLayout(),mobile:'drawer'})
const editing=ref(false),draftLayout=ref<TopbarLayout>(initialLayout())
const themeOpen=ref(false)
const draftMobile=ref<'drawer'|'full'>('drawer')
const prefKey=computed(()=> 'cagent.topbar.'+(auth.user?.id||'guest'))
const media=window.matchMedia('(max-width: 768px), (max-width: 960px) and (pointer: coarse)')
const syncWidth=()=>{small.value=media.matches}
const mobileMode=computed(()=>prefs.value.mobile)
function read(){
  try {
    const stored=JSON.parse(localStorage.getItem(prefKey.value)||'{}')
    const order:string[]=Array.isArray(stored.order)?stored.order:[]
    const hidden:string[]=Array.isArray(stored.hidden)?stored.hidden:[]
    const savedPins=Array.isArray(stored.pinned)?stored.pinned:order.length?[...order,...defaultPinned]:defaultPinned
    const pinned=[...new Set<string>(savedPins)].filter(id=>!hidden.includes(id)).slice(0,pinLimit)
    prefs.value={order,hidden,pinned,mobile:stored.mobile==='full'?'full':'drawer'}
  }catch{prefs.value={...initialLayout(),mobile:'drawer'}}
}
watch(prefKey,read,{immediate:true})
function sorted(order:string[]){const positions=new Map(order.map((id,index)=>[id,index]));return [...catalog.value].sort((a,b)=>(positions.get(a.id)??Infinity)-(positions.get(b.id)??Infinity))}
const visible=computed(()=>sorted(prefs.value.order).filter(item=>!prefs.value.hidden.includes(item.id)))
const quick=computed(()=>visible.value.filter(item=>prefs.value.pinned.includes(item.id)))
const menuItems=computed(()=>visible.value.filter(item=>!quick.value.some(pin=>pin.id===item.id)))
function openEditor(){
  const {order, hidden, pinned, mobile}=prefs.value
  draftLayout.value={order:[...order],hidden:[...hidden],pinned:[...pinned]}
  draftMobile.value=mobile
  editing.value=true
}
function resetEditor(){
  draftLayout.value=initialLayout()
  draftMobile.value='drawer'
}
function save(){
  prefs.value={...draftLayout.value,mobile:draftMobile.value}
  try{localStorage.setItem(prefKey.value,JSON.stringify(prefs.value))}catch{}
  editing.value=false
}
function run(id:unknown){
  if(id==='theme'){themeOpen.value=true;return}
  if(isCampusFeature(id))void showFeature(id)
}
function chooseTheme(value:unknown){
  if(value==='system'||value==='light'||value==='dark')theme.set(value)
  themeOpen.value=false
}
function showFeature(id:CampusFeature,card?:Record<string,unknown>){return featureHost.value?.show(id,card)}
function askOnChat(text:string){if(props.chat||props.menuOnly)emit('ask',text);else void router.push({path:returnPath.value,query:{ask:text}})}
defineExpose({showFeature,small,mobileMode})
onMounted(()=>{
  syncWidth();media.addEventListener('change',syncWidth)
  if(!props.chat)void get<typeof availableFeatures.value>('/campus/shortcuts').then(items=>availableFeatures.value=items).catch(()=>undefined)
})
onBeforeUnmount(()=>media.removeEventListener('change',syncWidth))
</script>

<style scoped>
.campus-topbar{display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr) auto;align-items:center;gap:12px;position:relative;z-index:2;min-height:52px;padding:0 clamp(10px,2vw,24px);flex:none;border-bottom:1px solid var(--nx-border);background:var(--nx-bg)}
.topbar-brand,.topbar-controls{display:flex;align-items:center;min-width:0;gap:6px}.topbar-brand{max-width:230px}.topbar-title{color:var(--nx-text);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.topbar-live{width:6px;height:6px;border-radius:50%;background:var(--nx-accent);flex:none}.campus-logo{max-width:92px;max-height:26px;object-fit:contain}.campus-avatar{width:32px;height:32px;border:0;cursor:pointer;color:var(--nx-accent);background:var(--nx-accent-soft);font:inherit}
.campus-tools{min-width:0;display:flex;align-items:center;gap:3px;overflow:auto;scrollbar-width:thin;padding:5px 0;overscroll-behavior-x:contain}
.campus-tools :is(a,button){min-height:34px;display:inline-flex;align-items:center;gap:5px;flex:none;white-space:nowrap;border:0;background:transparent;border-radius:8px;padding:5px 9px;color:var(--nx-text-2);font:inherit;font-size:12px;text-decoration:none;cursor:pointer;transition:background .16s ease,color .16s ease,transform .13s ease}
.campus-tools :is(a,button):hover,.campus-tools a[aria-current=page]{color:var(--nx-accent);background:var(--nx-accent-soft)}.campus-tools button:active{transform:scale(.96)}.campus-tools .el-icon{font-size:15px}.campus-tools :is(a,button):focus-visible{outline:2px solid var(--nx-accent);outline-offset:-2px}
@media(max-width:720px){.campus-topbar{gap:6px;min-height:49px}.topbar-brand{max-width:110px;gap:3px}.topbar-title{font-size:12px}.topbar-controls{gap:2px}.campus-logo{display:none}.campus-tools :is(a,button){padding-inline:7px;min-height:35px}}
@media(prefers-reduced-motion:reduce){.campus-tools :is(a,button){transition:none}}
.campus-topbar{grid-template-columns:minmax(0,1fr) auto auto;gap:8px;height:52px;min-height:52px}
.topbar-brand{height:100%;max-width:none}.topbar-title{max-width:min(38vw,34ch);line-height:30px}.topbar-controls{height:100%}
.campus-tools{height:100%;overflow:visible;align-items:center;padding:0;justify-content:end}.campus-tools button{height:32px;min-height:32px}.campus-tools .campus-menu-trigger{background:var(--nx-surface-2);border:1px solid var(--nx-border);border-radius:999px;padding-inline:10px}.campus-tools .campus-menu-trigger:hover{background:var(--nx-accent-soft)}
.topbar-menu-only{height:auto;min-height:0;display:inline-flex;padding:0;border:0;background:transparent}.topbar-menu-only .campus-tools{height:auto}.topbar-menu-only .campus-quick span{display:none}
.mobile-panel-setting{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:12px;font-size:13px}
@media(max-width:720px){.campus-topbar{height:49px;min-height:49px}.topbar-menu-only{height:auto;min-height:0}.topbar-title{max-width:100%}.campus-quick span{display:none}}
.campus-tools .campus-edit{width:32px;padding:0;justify-content:center}
.show-mascot{width:32px;height:32px;padding:2px;border-radius:50%;background:var(--nx-accent-soft);overflow:hidden}
.show-mascot .mascot-image{width:100%;height:100%;transition:transform .18s ease}
.show-mascot:is(:hover,:focus-visible) .mascot-image{transform:scale(1.1) rotate(-7deg)}
@media(prefers-reduced-motion:reduce){.show-mascot .mascot-image{transition:none;transform:none}}
@media(max-width:370px){.campus-menu-trigger>.el-icon:last-child{display:none}}
</style>
<style>
.campus-feature-menu .el-dropdown-menu__item{min-width:154px;min-height:30px}
</style>
