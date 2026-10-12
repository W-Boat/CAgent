import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { SettingsService } from '../settings/settings.service'
import { TimetableBrowserActionDto } from './timetable.dto'
import { extractAcademicTimetable } from './timetable-extract'
import { parseTimetable, type Capture } from './timetable-parser'

const START='https://ut.ucass.edu.cn/Navigation/Default.htm',TABLE='https://ut.ucass.edu.cn/Student/CourseTimetable/MyCourseTimeTable.aspx'
/** Only school hosts; document navigation further limited to login, navigation and timetable. */
export function allowedSchoolUrl(value:string,document=false):boolean {
  try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port))return false
    if(u.hostname!=='ucass.edu.cn'&&!u.hostname.endsWith('.ucass.edu.cn'))return false
    if(!document)return true
    const p=u.pathname.toLowerCase()
    return p==='/'||p==='/index.html'||p==='/index.htm'||p==='/default.aspx'||p==='/default.htm'||p==='/skyloginhandler.ashx'||p.startsWith('/navigation/')||p==='/student/coursetimetable/mycoursetimetable.aspx'||/login|\/cas(?:\/|$)|\/auth|\/oauth|\/sso/.test(p)
  }catch{return false}
}
interface Session {id:string;ownerId:string;context:BrowserContext;page:Page;createdAt:number;seenAt:number;busy:boolean}
@Injectable()
export class TimetableBrowserService implements OnModuleDestroy {
  private browser:Browser|null=null
  private launching:Promise<Browser>|null=null
  private closing:Promise<void>|null=null
  private readonly sessions=new Map<string,Session>()
  private readonly starting=new Set<string>()
  private readonly maxSessions=2
  constructor(private readonly settings:SettingsService){}
  private async getBrowser(){
    if(this.closing)await this.closing
    if(this.browser?.isConnected())return this.browser
    if(!this.launching)this.launching=(async()=>{
      const executablePath=process.env.TIMETABLE_CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)
      const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking']})
      this.browser=browser;browser.on('disconnected',()=>{if(this.browser===browser){this.browser=null;this.sessions.clear()}});return browser
    })().catch(()=>{throw new ServiceUnavailableException('课表浏览器暂时无法启动，请稍后重试')}).finally(()=>{this.launching=null})
    return this.launching
  }
  async start(ownerId:string){
    if(await this.settings.get('timetable_enabled')===false)throw new BadRequestException('课表读取暂未开放')
    if(this.starting.has(ownerId))throw new BadRequestException('正在打开教务，请稍候')
    this.starting.add(ownerId)
    let session:Session|undefined
    try{
      for(const s of this.sessions.values())if(s.ownerId===ownerId)await this.close(ownerId,s.id)
      if(this.sessions.size+this.starting.size>this.maxSessions)throw new ServiceUnavailableException('当前课表浏览器使用人数较多，请稍后重试')
      const browser=await this.getBrowser(),context=await browser.newContext({viewport:{width:1280,height:800},locale:'zh-CN',timezoneId:'Asia/Shanghai',acceptDownloads:false,serviceWorkers:'block'})
      const page=await context.newPage(),id=randomUUID(),now=Date.now();session={id,ownerId,context,page,createdAt:now,seenAt:now,busy:false};this.sessions.set(id,session)
      page.setDefaultTimeout(10000)
      await context.route('**/*',async route=>{const req=route.request();if(allowedSchoolUrl(req.url(),req.isNavigationRequest()))await route.continue();else await route.abort()})
      context.on('page',popup=>{if(session&&!session.page.isClosed())session.page=popup;popup.setDefaultTimeout(10000)})
      await page.goto(START,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(600)
      return {id,...await this.frame(ownerId,id)}
    }catch(error){if(session)await this.close(ownerId,session.id);if(error instanceof BadRequestException||error instanceof ServiceUnavailableException)throw error;throw new ServiceUnavailableException('教务页面连接失败，请稍后重试')}
    finally{this.starting.delete(ownerId)}
  }
  private own(ownerId:string,id:string){const s=this.sessions.get(id);if(!s||s.ownerId!==ownerId)throw new NotFoundException('教务窗口已关闭或过期，请重新打开');if(Date.now()-s.createdAt>20*60000||Date.now()-s.seenAt>10*60000){void this.close(ownerId,id);throw new NotFoundException('教务登录窗口已超时，请重新打开')}s.seenAt=Date.now();return s}
  async frame(ownerId:string,id:string){const s=this.own(ownerId,id);if(await this.settings.get('timetable_enabled')===false){await this.close(ownerId,id);throw new BadRequestException('课表读取服务已关闭')}return {image:'data:image/jpeg;base64,'+(await s.page.screenshot({type:'jpeg',quality:70})).toString('base64'),width:1280,height:800,pagePath:new URL(s.page.url()).pathname,expiresAt:new Date(s.createdAt+20*60000).toISOString()}}
  async action(ownerId:string,id:string,dto:TimetableBrowserActionDto){
    const s=this.own(ownerId,id);if(await this.settings.get('timetable_enabled')===false){await this.close(ownerId,id);throw new BadRequestException('课表读取服务已关闭')}
    if(s.busy)throw new BadRequestException('上一步正在处理中，请稍候');s.busy=true
    try{
      if(dto.action==='click'){if(dto.x===undefined||dto.y===undefined)throw new BadRequestException('缺少点击位置');await s.page.mouse.click(dto.x,dto.y)}
      else if(dto.action==='type'){if(!dto.text)throw new BadRequestException('请输入要发送的内容');await s.page.keyboard.insertText(dto.text)}
      else if(dto.action==='press'){if(!dto.key)throw new BadRequestException('缺少按键');await s.page.keyboard.press(dto.key)}
      else if(dto.action==='scroll')await s.page.mouse.wheel(0,dto.delta||400)
      else if(dto.action==='timetable')await s.page.goto(TABLE,{waitUntil:'domcontentloaded',timeout:30000})
      else if(dto.action==='login')await s.page.goto(START,{waitUntil:'domcontentloaded',timeout:30000})
      await s.page.waitForTimeout(350)
      return this.frame(ownerId,id)
    }catch(error){if(error instanceof BadRequestException)throw error;throw new BadRequestException('教务操作未完成，请刷新画面后重试')}
    finally{s.busy=false}
  }
  async capture(ownerId:string,id:string){
    const s=this.own(ownerId,id);if(s.busy)throw new BadRequestException('请等待上一操作完成');s.busy=true
    try{
      const captures:Capture[]=[]
      for(const frame of s.page.frames())if(frame.url().split('?')[0]===TABLE){const capture=await frame.evaluate(extractAcademicTimetable);if(capture)captures.push(capture)}
      if(captures.length!==1)throw new BadRequestException('尚未找到唯一课表。请先登录，再点击「打开我的课表」，选择学期并确定')
      const capture=captures[0],preview=parseTimetable(capture)
      await this.close(ownerId,id)
      return {capture,preview,sessionClosed:true}
    }finally{s.busy=false}
  }
  async close(ownerId:string,id:string){const s=this.sessions.get(id);if(!s||s.ownerId!==ownerId)return {success:true};this.sessions.delete(id);await s.context.close().catch(()=>undefined);return {success:true}}
  async closeOwner(ownerId:string){for(const s of this.sessions.values())if(s.ownerId===ownerId)await this.close(ownerId,s.id);return {success:true}}
  @Interval(30000) async reap(){for(const s of this.sessions.values())if(Date.now()-s.createdAt>20*60000||Date.now()-s.seenAt>10*60000)await this.close(s.ownerId,s.id);if(!this.sessions.size&&!this.starting.size&&this.browser){const b=this.browser;this.browser=null;this.closing=b.close().catch(()=>undefined).finally(()=>{this.closing=null});await this.closing}}
  async onModuleDestroy(){for(const s of this.sessions.values())await this.close(s.ownerId,s.id);await this.browser?.close().catch(()=>undefined)}
}
