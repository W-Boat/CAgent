// Generated from evaluation/batch-format.ts; run node evaluation/sync.mjs after editing.
export type DatasetSplit='test'|'validation'
export interface TestBatch {id:string;split:DatasetSplit;questions:string[]}
export interface TestTurn {batchId:string;split:DatasetSplit;turn:number;question:string}
export const MAX_TEST_TURNS=500
function fail(message:string):never{throw new Error(message)}
export function parseCsv(text:string):string[][] {
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false
 for(let i=0;i<text.length;i++){const c=text[i]
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c;continue}
  if(c==='"'){if(cell||closed)fail('CSV 引号位置错误');quoted=true;continue}
  if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[]}continue}
  if(closed&&c.trim())fail('CSV 闭合引号后只能有分隔符');if(!closed)cell+=c
 }
 if(quoted)fail('CSV 引号未闭合');if(cell||row.length){row.push(cell);if(row.some(v=>v.trim()))rows.push(row)}return rows
}
function split(value:unknown,fallback:DatasetSplit):DatasetSplit {if(value===undefined||value==='')return fallback;if(value==='test'||value==='测试集')return 'test';if(value==='validation'||value==='验证集')return 'validation';return fail('数据集类型只能为 test 或 validation')}
function question(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.length>6000)fail('每道题须为 1–6000 字的文本');return value.trim()}
export function parseTestSet(data:string,format:'json'|'csv',fallback:DatasetSplit='test'):TestBatch[]{
 if(typeof data!=='string'||!data.trim()||data.length>1_500_000)fail('测试集不能为空且最多 1.5MB')
 const batches:TestBatch[]=[]
 if(format==='json'){
  let value:any;try{value=JSON.parse(data.replace(/^\uFEFF/,''))}catch{fail('JSON 格式无效')}
  if(Array.isArray(value)&&value.every(v=>typeof v==='string'))value={batches:value.map((q,i)=>({id:String(i+1),questions:[q]}))}
  const list=Array.isArray(value)?value:value?.batches;if(!Array.isArray(list)||!list.length)fail('JSON 需要 batches 数组，或问题文本数组')
  for(const [i,b] of list.entries()){if(!b||typeof b!=='object'||!Array.isArray(b.questions)||!b.questions.length)fail(`第 ${i+1} 个批次缺少 questions`);batches.push({id:typeof b.id==='string'?b.id.trim():String(i+1),split:split(b.split,fallback),questions:b.questions.map(question)})}
 }else if(format==='csv'){
  const rows=parseCsv(data.replace(/^\uFEFF/,'')),headers=rows.shift()?.map(s=>s.trim().toLowerCase())||[],q=headers.findIndex(s=>['question','题目','问题'].includes(s)),b=headers.findIndex(s=>['batch_id','batch','批次'].includes(s)),t=headers.findIndex(s=>['turn','轮次'].includes(s)),s=headers.findIndex(s=>['split','数据集'].includes(s));if(q<0)fail('CSV 需要 question（题目）列')
  const groups=new Map<string,{split:DatasetSplit;items:{turn:number;question:string}[]}>()
  for(const [i,row] of rows.entries()){if(row.length!==headers.length)fail(`CSV 第 ${i+2} 行列数不一致`);const id=b>=0?row[b].trim():String(i+1),kind=split(s>=0?row[s]:undefined,fallback),group=groups.get(id)||{split:kind,items:[]};if(group.split!==kind)fail('同一批次的数据集类型须一致');const turn=t>=0?Number(row[t]):group.items.length+1;if(!Number.isInteger(turn)||turn<1)fail('轮次须为正整数');group.items.push({turn,question:question(row[q])});groups.set(id,group)}
  for(const [id,g] of groups){g.items.sort((a,b)=>a.turn-b.turn);if(g.items.some((v,i)=>v.turn!==i+1))fail(`批次 ${id} 的轮次必须从 1 连续递增且不重复`);batches.push({id,split:g.split,questions:g.items.map(v=>v.question)})}
 }else fail('只支持 JSON 或 CSV')
 const ids=new Set<string>();let total=0
 for(const b of batches){if(!b.id||b.id.length>100||ids.has(b.id))fail('批次 ID 须唯一且为 1–100 字');ids.add(b.id);if(b.questions.length>100)fail('每个批次最多 100 轮');total+=b.questions.length}
 if(!total||total>MAX_TEST_TURNS)fail(`每次任务最多 ${MAX_TEST_TURNS} 道题`);return batches
}
export function flattenTestSet(batches:TestBatch[]):TestTurn[]{return batches.flatMap(b=>b.questions.map((question,i)=>({batchId:b.id,split:b.split,turn:i+1,question})))}
export function csvCell(value:unknown){let text=String(value??'');if(/^[\s]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'}
export const TEST_SET_EXAMPLE=JSON.stringify({batches:[{id:'通勤-01',split:'test',questions:['良乡校区附近的地铁站是哪个？','怎么去？']},{id:'图书馆-01',split:'validation',questions:['望京校区图书馆需要预约吗？']}]},null,2)
