#!/usr/bin/env node
// Register query tools through audited admin APIs; retain existing enablement.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const envFile = fileURLToPath(new URL('../.env',import.meta.url))
if (existsSync(envFile)) for (const line of readFileSync(envFile,'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/)
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
}
const apiIndex = process.argv.indexOf('--api')
const origin = apiIndex >= 0 ? process.argv[apiIndex+1] : 'http://127.0.0.1:3001'
const email = process.env.INTEGRATE_EMAIL || process.env.SEED_ADMIN_EMAIL
const password = process.env.INTEGRATE_PASSWORD || process.env.SEED_ADMIN_PASSWORD
if (!email || !password) throw new Error('请配置 INTEGRATE_EMAIL/INTEGRATE_PASSWORD 或本地 SEED_ADMIN 账号')
async function request(method,path,body,token) {
  const response = await fetch(`${origin}/api${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined})
  const result = await response.json()
  if (!response.ok || result.code !== 0) throw new Error(`${method} ${path}: ${result.message || response.status}`)
  return result.data
}
const {accessToken} = await request('POST','/auth/login',{email,password})
for (const entry of [
  {key:'ucass-kb-survival',name:'辛瓜生存指北',collection:'survival',icon:'🍢'},
  {key:'ucass-kb-takeout',name:'外卖红黑榜',collection:'takeout',icon:'🥡'}
]) {
  const existing=await request('GET',`/skills?keyword=${encodeURIComponent(entry.key)}&pageSize=100`,undefined,accessToken)
  const skill = (existing.items || existing).find(s => s.key === entry.key)
  if(skill){
    await request('PATCH',`/skills/${skill.id}`,{enabled:false,note:'该参考内容已迁移到统一知识库；保留旧记录用于审计，不作为技能展示或调用。'},accessToken)
    console.log(`已停用旧知识技能入口：${entry.name}`)
  }

}
const agents=await request('GET','/agents',undefined,accessToken)
const guide=(agents.items || agents).find(agent=>agent.key==='ucass-guide')
if(guide){
  await request('PATCH',`/agents/${guide.id}`,{systemPrompt:readFileSync(fileURLToPath(new URL('./agent-guide.md',import.meta.url)),'utf8')},accessToken)
  console.log('已更新校园导办 Agent 的证据与查询指引')
}
