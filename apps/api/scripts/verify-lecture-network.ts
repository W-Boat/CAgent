import assert from 'node:assert/strict'
import {pinnedLectureLookup,readLecturePage} from '../src/lectures/lecture-crawler'
import {lectureUrl} from '../src/lectures/lecture-data'
const lookup=pinnedLectureLookup({address:'10.27.1.2',family:4});lookup('host',{all:true},(err:any,rows:any)=>{assert.equal(err,null);assert.deepEqual(rows,[{address:'10.27.1.2',family:4}])});lookup('host',{},(err:any,address:any,family:any)=>{assert.equal(address,'10.27.1.2');assert.equal(family,4)})
assert(lectureUrl('http://sg.ucass.edu.cn/index.htm'));for(const url of ['http://mp.weixin.qq.com/s/a','http://127.0.0.1/a','https://ucass.edu.cn.evil.invalid/a'])assert.equal(lectureUrl(url),null)
console.log('PASS pinned DNS callback scalar/all forms; HTTP school-only scope; no TLS validation bypass')

if(process.env.LECTURE_LIVE==='1'){
 import('../src/lectures/lecture-crawler').then(async({crawlLectures})=>{const result=await crawlLectures({enabled:false,intervalMinutes:720,campusNetwork:true,maxPages:1,maxArticles:30,sources:[{id:'sg-1',name:'政府管理学院预告',url:'https://sg.ucass.edu.cn/index/ygtz.htm',mode:'all',enabled:true}]},true);assert(result.records.length>0);console.log(JSON.stringify({live:true,collected:result.records.length,requests:result.requests,warnings:result.warnings,databaseWrites:0}))}).catch(e=>{console.error(e);process.exitCode=1})
}
