/** Per-question budget. Reserve synchronously before I/O so concurrent calls cannot overspend. */
export class KnowledgeRetrievalBudget {
 readonly depth:number
 readonly continuous:boolean
 readonly limit:number
 count=0
 constructor(depth:unknown=3,continuous:unknown=true){this.depth=Number.isInteger(depth)&&Number(depth)>=1&&Number(depth)<=8?Number(depth):3;this.continuous=continuous!==false;this.limit=this.continuous?this.depth:1}
 available=()=>this.count<this.limit
 reserve=()=>{if(!this.available())throw new Error('本轮知识库检索已达管理员设置的上限，请根据已有证据回答并说明缺项。');this.count++}
}
