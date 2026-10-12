/** Recover syntax only: BOM, JSON comments and trailing commas. Never eval or complete missing data. */
export function parseCardJson(raw:string):unknown {
 if(raw.length>128*1024)throw new Error('卡片内容过大')
 const text=raw.replace(/^\uFEFF/,'').trim()
 try{return JSON.parse(text)}catch{}
 let clean='',quoted=false,escape=false
 for(let i=0;i<text.length;i++){
  const c=text[i],next=text[i+1]
  if(quoted){clean+=c;if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue}
  if(c==='"'){quoted=true;clean+=c;continue}
  if(c==='/'&&next==='/'){while(i<text.length&&text[i]!=='\n')i++;clean+='\n';continue}
  if(c==='/'&&next==='*'){const end=text.indexOf('*/',i+2);if(end<0)throw new Error('卡片注释未完整');i=end+1;clean+=' ';continue}
  if(c===','){let j=i+1;while(/\s/.test(text[j]||'')&&j<text.length)j++;if(text[j]===']'||text[j]==='}')continue}
  clean+=c
 }
 // Comments may separate the comma from its closing bracket; make a second bounded pass.
 return clean!==text?parseCardJson(clean):JSON.parse(clean)
}
