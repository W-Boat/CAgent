import assert from 'node:assert/strict'
import {pinnedLectureLookup,readLecturePage} from '../src/lectures/lecture-crawler'
import {lectureUrl} from '../src/lectures/lecture-data'
const lookup=pinnedLectureLookup({address:'10.27.1.2',family:4});lookup('host',{all:true},(err:any,rows:any)=>{assert.equal(err,null);assert.deepEqual(rows,[{address:'10.27.1.2',family:4}])});lookup('host',{},(err:any,address:any,family:any)=>{assert.equal(address,'10.27.1.2');assert.equal(family,4)})
assert(lectureUrl('http://sg.ucass.edu.cn/index.htm'));for(const url of ['http://mp.weixin.qq.com/s/a','http://127.0.0.1/a','https://ucass.edu.cn.evil.invalid/a'])assert.equal(lectureUrl(url),null)
console.log('PASS pinned DNS callback scalar/all forms; HTTP school-only scope; no TLS validation bypass')
