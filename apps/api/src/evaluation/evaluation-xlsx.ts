import AdmZip from 'adm-zip'
import {load} from 'cheerio'
import {posix} from 'node:path'
import {parseTestSet,type TestBatch,type DatasetSplit} from './batch-format'

export const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_FILE=1_000_000,MAX_XML=4_000_000,MAX_TOTAL=20_000_000
/** Reads values only. Never evaluates formulas, external links, macros, or embedded code. */
export function parseValidationWorkbook(base64:string,split:DatasetSplit='validation'):TestBatch[]{
 if(!base64||base64.length>Math.ceil(MAX_FILE/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw Error('Excel 文件须为有效 Base64，文件最大 1MB')
 const bytes=Buffer.from(base64,'base64');if(bytes.length<4||bytes.length>MAX_FILE||bytes.readUInt16LE(0)!==0x4b50)throw Error('请选择有效的 .xlsx 文件')
 const zip=new AdmZip(bytes),entries=zip.getEntries();let total=0
 const names=new Set<string>()
 for(const e of entries){total+=e.header.size;if(names.has(e.entryName)||e.entryName.includes('..')||e.header.size>MAX_XML||e.header.flags&1||/vbaProject|externalLinks|\.bin$/i.test(e.entryName))throw Error('Excel 包含不支持的内容或文件过大');names.add(e.entryName)}
 if(entries.length>100||total>MAX_TOTAL)throw Error('Excel 解压内容超过限制')
 const xml=(name:string)=>{const e=zip.getEntry(name);if(!e)throw Error('Excel 缺少工作簿内容');const s=e.getData().toString('utf8');if(Buffer.byteLength(s)>MAX_XML||/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('Excel XML 内容无效');return load(s,{xmlMode:true})}
 const book=xml('xl/workbook.xml'),sheets=book('sheet');if(sheets.length!==1)throw Error('验证集请只保留一个工作表')
 const rels=xml('xl/_rels/workbook.xml.rels'),id=sheets.attr('r:id'),rel=rels('Relationship').toArray().find(n=>rels(n).attr('Id')===id)
 if(!rel||rels(rel).attr('TargetMode')==='External')throw Error('不支持外部工作表')
 const target=rels(rel).attr('Target')||'',path=target.startsWith('/')?posix.normalize(target.slice(1)):posix.normalize('xl/'+target)
 if(!/^xl\/worksheets\/[^/]+\.xml$/.test(path))throw Error('工作表路径无效')
 const strings:string[]=[]
 if(zip.getEntry('xl/sharedStrings.xml')){const $=xml('xl/sharedStrings.xml');$('si').each((_,n)=>{strings.push($(n).find('t').toArray().map(t=>$(t).text()).join(''))})}
 const $=xml(path),rows:string[][]=[];const seenRows=new Set<number>()
 if($('row').length>10000||$('c').length>20000||$('f').length)throw Error('工作表过大或含公式，请粘贴为文本值后上传')
 $('row').each((_,r)=>{const rowNumber=Number($(r).attr('r'));if(!Number.isSafeInteger(rowNumber)||rowNumber<1||seenRows.has(rowNumber))throw Error('Excel 行号无效');seenRows.add(rowNumber);const row:string[]=['',''];const seen=new Set<string>()
  $(r).children('c').each((_,c)=>{const cell=$(c),ref=cell.attr('r')||'',match=ref.match(/^([A-Z]+)(\d+)$/);if(!match||Number(match[2])!==rowNumber||seen.has(ref))throw Error('Excel 单元格位置无效');seen.add(ref)
   const type=cell.attr('t'),v=cell.find('v').text();let text=''
   if(type==='s'){const index=Number(v);if(!/^\d+$/.test(v)||index>=strings.length)throw Error('Excel 文本索引无效');text=strings[index]}
   else if(type==='inlineStr')text=cell.find('is t').toArray().map(t=>$(t).text()).join('')
   else if(type==='e')throw Error('Excel 含错误单元格')
   else text=v
   if(match[1]==='A')row[0]=text;else if(match[1]==='B')row[1]=text;else if(text.trim())throw Error('验证集仅允许两列：问题、预期答案')
  });if(row.some(v=>v.trim()))rows.push(row)
 })
 const headers=rows.shift()?.map(v=>v.trim())
 if(!headers||headers[0]!=='问题'||!['预期答案','参考答案','预期答案（参考答案）','预期答案(参考答案)'].includes(headers[1]))throw Error('Excel 首行须为「问题」「预期答案」两列')
 const batches=rows.map((row,i)=>({id:String(i+1),split,questions:[row[0]],expectedAnswers:[row[1]]}))
 return parseTestSet(JSON.stringify({batches}),'json',split)
}

const escapeXml=(v:unknown)=>String(v??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const column=(index:number):string=>{let out='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out}
export function writeWorkbook(rows:unknown[][]):Buffer{
 const zip=new AdmZip(),add=(name:string,text:string)=>zip.addFile(name,Buffer.from(text,'utf8'))
 add('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
 add('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
 add('xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="验证结果" sheetId="1" r:id="rId1"/></sheets></workbook>')
 add('xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
 add('xl/worksheets/sheet1.xml','<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="3" width="65" customWidth="1"/></cols><sheetData>'+rows.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((value,c)=>'<c r="'+column(c)+(r+1)+'" t="inlineStr"><is><t xml:space="preserve">'+escapeXml(value)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>')
 return zip.toBuffer()
}
export function validationTemplate(){return writeWorkbook([['问题','预期答案']])}
export function resultWorkbook(rows:{question:string;expected_answer:string;reply:string;status:string;error:string;latency_ms:number;batch_id:string;turn:number;split:string}[]){
 // An Excel cell holds at most 32767 UTF-16 units. Preserve long replies in named continuation columns.
 const chunks=(text:string)=>{const result:string[]=[];while(text.length){let end=Math.min(text.length,32000);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;result.push(text.slice(0,end));text=text.slice(end)}return result.length?result:['']}
 const replies=rows.map(r=>chunks(r.reply)),extra=Math.max(1,...replies.map(r=>r.length))-1
 return writeWorkbook([['问题','预期答案','智能体实际回复','状态','异常信息','耗时（毫秒）','批次','轮次','数据集',...Array.from({length:extra},(_,i)=>`智能体实际回复（续${i+1}）`)],...rows.map((r,i)=>[r.question,r.expected_answer,replies[i][0],r.status,r.error,r.latency_ms,r.batch_id,r.turn,r.split,...Array.from({length:extra},(_,j)=>replies[i][j+1]||'')])])
}
