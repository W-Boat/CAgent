// Plain HTTP collection, with a short-lived cookie jar; no browser or credentials.
import {writeFileSync,readFileSync} from 'node:fs'
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return i<0?[a.replace(/^--/,''),true]:[a.slice(2,i),a.slice(i+1)]}))
const origin=new URL(String(args.source||process.env.COLLECTIVE_TIMETABLE_SOURCE_ORIGIN||''))
if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Use --source=http(s)://campus-host without credentials or a path')
const pageUrl=new URL('/Student/AllCourseTimeTable.aspx',origin)
const page=await fetch(pageUrl,{redirect:'error',signal:AbortSignal.timeout(15000)})
if(!page.ok)throw new Error('Cannot read collective timetable page')
const html=await page.text(),options=[...html.matchAll(/<option\s+value="(\d+)"[^>]*>(20\d{2}-20\d{2}学年第[一二三123]学期)<\/option>/g)]
const option=args['semester-id']?options.find(v=>v[1]===String(args['semester-id'])):options[0]
if(!option)throw new Error('Semester unavailable; check the source page')
const cookie=page.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')
const form=new URLSearchParams({semId:option[1],ddlSemester:option[1],ddlOrganization:'0',ddlDelymethod:'0',ddlDayOfWeek:'0',ddlTimeSpan:'0',courseName:'',sNumber:'',teacherName:'',ddlCampus:'0',ddlBuilding:'0',ddlClassRoom:'0',StartDate:'',EndDate:'',mergeTeacher:'1'})
const response=await fetch(new URL('/Student/AllCourseTimeTableHandler.ashx?method=search3',origin),{method:'POST',headers:{Cookie:cookie,Referer:pageUrl.href},body:form,redirect:'error',signal:AbortSignal.timeout(30000)})
if(!response.ok)throw new Error('Course query failed')
const raw=await response.json()
if(raw.Result!==true||!Array.isArray(raw.Data?.List)||!raw.Data.List.length)throw new Error('Source did not return a successful nonempty course catalog')
const fields=['CourseId','DCId','CourseName','CourseCode','DCSN','OrgName','Credit','CreditHour','Classes','GradeName','RoomName','DayOfWeek','DayOfWeekIndex','PatternInfo','PatternTime','CGMethod','WeekInfo']
const campusMatch=html.match(/var camousInfo=(\[[^;]+\]);/),campuses=campusMatch?JSON.parse(campusMatch[1]):[]
const payload={complete:true,semester:option[2],capturedAt:new Date().toISOString(),sourcePage:pageUrl.href,campus:campuses.length===1?String(campuses[0].Name).replace(/校区$/,''):'通用',
 records:raw.Data.List.map(row=>({...Object.fromEntries(fields.map(k=>[k,row[k]??''])),TRs:(row.TRs||[]).map(t=>({FullName:t.FullName||''}))}))}
const data=JSON.stringify(payload,null,2)
if(Buffer.byteLength(data)>1_900_000)throw new Error('Catalog exceeds import size limit')
const file=String(args.output||'collective-timetable.json');writeFileSync(file,data)
console.log(JSON.stringify({semester:payload.semester,rows:payload.records.length,output:file}))
if(args.upload){
 const server=new URL(String(args.upload));if(!['http:','https:'].includes(server.protocol)||server.username||server.password||server.search||server.hash)throw new Error('Invalid application origin')
 if(server.protocol==='http:'&&!['localhost','127.0.0.1'].includes(server.hostname))throw new Error('Use HTTPS for server upload')
 const token=args['token-file']?readFileSync(String(args['token-file']),'utf8').trim():process.env.CAGENT_ACCESS_TOKEN
 if(!token)throw new Error('Provide an administrator token in a private --token-file or CAGENT_ACCESS_TOKEN')
 const upload=await fetch(new URL('/api/knowledge/collective-timetable/import',server),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data,redirect:'error',signal:AbortSignal.timeout(150000)})
 const result=await upload.json();if(!upload.ok||result.code!==0)throw new Error('Server import failed; check administrator permission and catalog format')
 console.log(JSON.stringify({imported:result.data}))
}
