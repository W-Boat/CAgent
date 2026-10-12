/** Keep machine citations for attribution; never expose index IDs in answer text. */
export function cleanAnswerReferences(text:string,known:Set<string>=new Set()):string{
  let fence=''
  return text.split('\n').map(line=>{
    const marker=/^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim())fence='';return line}
    if(marker){fence=marker[1];return line}
    return line.replace(/\[\s*((?:S\d+|\d+)(?:[\s,，]+(?:S\d+|\d+))*)\s*\](?:\((https?:\/\/[^\s)]*)\))?/g,(all,body,url)=>{
    const ids=body.split(/[\s,，]+/).filter(Boolean)
    const citation=ids.every((id:string)=>known.has(id)||/^S\d+$/.test(id)||(url?/^\d{8,}$/:/^\d{4,}$/).test(id))
    return citation?'':all
    })
  }).join('\n')
}
