import type MarkdownIt from 'markdown-it'
/** CommonMark treats adjacent CJK text and book-title punctuation as a delimiter conflict. */
export function cjkStrong(md:MarkdownIt){
 md.inline.ruler.before('emphasis','cjk_book_strong',(state,silent)=>{
  const start=state.pos;if(state.src.slice(start,start+2)!=='**'||state.src[start+2]==='*')return false
  let end=start+2
  while((end=state.src.indexOf('**',end))>=0){if(state.src[end-1]!=='\\')break;end+=2}
  if(end<0||end>state.posMax||end-start>4096)return false
  const inner=state.src.slice(start+2,end)
  if(!/^[《「『“（【].+[》」』”）】]$/u.test(inner)||inner.includes('\n'))return false
  if(silent)return false
  state.push('strong_open','strong',1)
  const tokens:any[]=[];md.inline.parse(inner,md,state.env,tokens);for(const token of tokens){token.level+=state.level;state.tokens.push(token)}
  state.push('strong_close','strong',-1);state.pos=end+2;return true
 })
}
