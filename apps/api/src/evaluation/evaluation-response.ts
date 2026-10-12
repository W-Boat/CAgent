import {EventEmitter} from 'node:events'
/** Internal SSE sink: shares actual chat finalization, persistence, quotas and rendering. */
export class EvaluationResponse extends EventEmitter {
 headersSent=false;writableEnded=false;destroyed=false;buffer=''
 conversationId?:string;assistantMessageId?:string;reply='';error?:string;status='FAILED';usage:Record<string,unknown>={};runtime:unknown;sources:unknown=[]
 setHeader(){return this} flushHeaders(){this.headersSent=true}
 write(chunk:string){this.buffer+=chunk;let boundary:number
  while((boundary=this.buffer.indexOf('\n\n'))>=0){const frame=this.buffer.slice(0,boundary);this.buffer=this.buffer.slice(boundary+2);const event=frame.match(/^event: (.+)$/m)?.[1],data=JSON.parse(frame.match(/^data: (.+)$/m)?.[1]||'{}')
   if(event==='meta'){this.conversationId=data.conversationId;this.assistantMessageId=data.assistantMessageId}
   if(event==='text')this.reply+=data.text||''
   if(event==='error')this.error=data.message
   if(event==='kb')this.sources=data.hits||[]
   if(event==='usage')this.usage=data
   if(event==='done'){this.status=data.status;this.runtime=data.runtime}
  }return true
 }
 end(){this.writableEnded=true;return this}
}
