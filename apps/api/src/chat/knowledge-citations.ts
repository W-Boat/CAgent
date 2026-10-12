/** Keep machine citations for attribution; never expose index IDs in answer text. */
export function stripKnowledgeCitations(text:string,known:Set<string>=new Set()):string{
  let fence=''
  return text.split('\n').map(line=>{
    const marker=/^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim())fence='';return line}
    if(marker){fence=marker[1];return line}
    return line.replace(/\[\s*((?:S\d+|-?\d+)(?:[\s,，]+(?:S\d+|-?\d+))*)\s*\](?:\((https?:\/\/[^\s)]*)\))?/g,(all,body,url)=>{
    const ids=body.split(/[\s,，]+/).filter(Boolean)
    const citation=ids.every((id:string)=>known.has(id)||/^S\d+$/.test(id)||(url?/^-?\d{8,}$/:/^-?\d{4,}$/).test(id))
    return citation?'':all
    })
  }).join('\n')
}
/** Buffer incomplete numeric brackets so streamed IDs never flash on screen. */
export class KnowledgeCitationStream {
  private pending=''
  private prefix=''
  private lineStart=true
  private fence=''
  private opening=false
  private codeLine=''
  constructor(private readonly known:()=>Set<string>){}
  push(text:string){
    let output='',plain=''
    const flush=()=>{if(plain){output+=this.plain(plain);plain=''}}
    for(const char of text){
      if(this.fence){
        flush();output+=char
        if(this.opening&&this.codeLine.trimStart()===this.fence&&char===this.fence[0])this.fence+=char
        if(char==='\n'){
          const close=/^\s*(`{3,}|~{3,})\s*$/.exec(this.codeLine)
          if(!this.opening&&close&&close[1][0]===this.fence[0]&&close[1].length>=this.fence.length)this.fence=''
          this.opening=false;this.codeLine='';this.lineStart=true
        }else this.codeLine=this.codeLine.length<512?this.codeLine+char:this.codeLine.slice(0,512)+'!'
        continue
      }
      if(this.lineStart){
        this.prefix+=char
        if(/^\s*(`{3}|~{3})$/.test(this.prefix)){
          flush();output+=stripKnowledgeCitations(this.pending,this.known());this.pending='';output+=this.prefix
          this.fence=this.prefix.trim();this.codeLine=this.prefix;this.opening=true;this.prefix='';this.lineStart=false;continue
        }
        if(char!=='\n'&&this.prefix.length<=64&&/^\s*(?:`{0,2}|~{0,2})$/.test(this.prefix))continue
        plain+=this.prefix;this.prefix='';this.lineStart=char==='\n'
      }else {plain+=char;if(char==='\n')this.lineStart=true}
    }
    flush();return output
  }
  private plain(text:string){
    const combined=this.pending+text
    const match=combined.match(/\[\s*(?:S)?[-\d,，\s]*(?:\](?:\([^\n)]*)?)?$/)
    this.pending=match&&match[0].length<256?match[0]:''
    return stripKnowledgeCitations(this.pending?combined.slice(0,-this.pending.length):combined,this.known())
  }
  finish(){const text=this.pending+this.prefix;this.pending='';this.prefix='';return stripKnowledgeCitations(text,this.known())}
}
