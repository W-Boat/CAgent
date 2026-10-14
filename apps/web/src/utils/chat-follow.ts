/** Large atomic cards should stay at their beginning; only an explicit jump follows their tail. */
export function retainCardReadingPosition(content:string,distance:number,viewport:number){
  return /```(?:card|json)\s*\n/.test(content)&&distance>Math.max(96,Math.min(280,viewport*0.45))
}
