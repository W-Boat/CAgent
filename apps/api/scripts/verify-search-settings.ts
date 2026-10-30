import 'reflect-metadata'
import assert from 'node:assert/strict'
import {SettingsService} from '../src/settings/settings.service'
import {SETTING_DEFS} from '../src/settings/setting-defs'
async function main(){const values=new Map<string,unknown>(),db={setting:{findMany:async()=>[...values].map(([key,value])=>({key,value})),upsert:async({create}:any)=>{values.set(create.key,create.value);return create}},$transaction:async(jobs:any[])=>Promise.all(jobs)},service=new SettingsService(db as any,{log:async()=>{}} as any),admin={id:'fixture',email:'fixture@example.invalid',permissions:['setting:read','setting:write'],roles:['super_admin']};
const groups=await service.grouped(admin.permissions,admin.roles);assert.equal(groups.search.length,5);assert(groups.search.some(x=>x.key==='web_search_enabled'));await service.updateMany({web_search_enabled:true,web_search_provider:'tavily',web_search_count:3},admin);assert.equal(values.get('web_search_enabled'),true);await assert.rejects(()=>service.updateMany({web_search_count:9},admin),/1–8/);const ordinary={...admin,roles:['admin']};assert(!(await service.grouped(ordinary.permissions,ordinary.roles)).search);await assert.rejects(()=>service.updateMany({web_search_enabled:true},ordinary),/仅超级管理员/);console.log('PASS 超管角色无通配符和feature权限仍能读取保存5项搜索配置；普通管理员不可越权；数量范围校验有效')}
main().catch(e=>{console.error(e);process.exitCode=1})
