import {randomUUID} from 'node:crypto'
import {abortable,abortScope,checkAbort} from '../../common/abort'
import type {ChatMessage,LlmToolCall} from '../llm/types'
import {estimateTokens} from '../llm/types'
import {fitContext} from './context-budget'
import {canonicalArguments,parseToolArguments} from './tool-validation'
import {ToolMarkupStream} from '../../presentation/output-boundary'
import {copyState,restoreRuntime,runtimeContract,type RuntimeState} from './runtime-state'
import type {RunOptions,RunResult,ToolOutcome,ToolRecord,RunStage,RunProgress} from './agent-runtime'

class UnparsedToolOutputError extends Error {
  constructor(){super('模型返回了未解析的工具调用，本次未执行，请重新生成。')}
}

/** Business-free execution core, inspired by Pi's separation of loop, tools and session. */
export class AgentRuntime {
  async run(options:RunOptions):Promise<RunResult> {
    const started=Date.now(),checkpoint=options.checkpoint,limit=Math.min(20,Math.max(1,options.maxToolRounds||5))
    const fresh:RunResult={text:'',reasoning:'',promptTokens:0,completionTokens:0,aborted:false,tools:[],modelMessages:[],metrics:{modelTurns:0,toolCalls:0,cachedCalls:0,failedTools:0,removedTurns:0,truncatedResults:0,peakInputTokens:0,latencyMs:0,limitReached:false}}
    const state:RuntimeState=checkpoint?.resume?restoreRuntime(options,checkpoint):{version:1,runId:checkpoint?.runId||randomUUID(),scopeKey:checkpoint?.scopeKey||'0'.repeat(64),contract:runtimeContract(options),sequence:0,node:'context',round:0,limit,messages:options.messages.map(m=>({...m})),result:fresh,pendingCalls:[],completed:{},inFlight:{},writeLedger:[],toolCache:[],updatedAt:Date.now()}
    const result=state.result,working=state.messages,previousLatency=result.metrics.latencyMs
    result.metrics.checkpointWrites ||= 0;result.metrics.nodeTransitions ||= 0;result.metrics.resumedFromCheckpoint=!!checkpoint?.resume
    let persisted=!!checkpoint?.resume,checkpointEnabled=!!checkpoint,checkpointQueue=Promise.resolve()
    const persist=()=>{const work=checkpointQueue.then(async()=>{if(!checkpointEnabled)return;state.sequence++;state.updatedAt=Date.now();state.result.metrics.latencyMs=previousLatency+Date.now()-started;state.toolCache=[...cache].map(([key,outcome])=>({key,outcome}));const ok=await checkpoint!.save(copyState(state));persisted=ok!==false;checkpointEnabled=persisted;if(persisted)result.metrics.checkpointWrites!++});checkpointQueue=work.catch(()=>undefined);return work}
    const tools=new Map(options.tools.map(t=>[t.name,t])),cache=new Map<string,ToolOutcome>(state.toolCache.map(c=>[c.key,c.outcome])),pendingCache=new Map<string,Promise<ToolOutcome>>()
    const ids=new Set<string>([...result.tools.map(t=>t.id),...state.pendingCalls.map(c=>c.id)])
    const defs=options.tools.map(({name,description,parameters})=>({name,description,parameters}))
    const progress=(stage:RunStage,round:number,extra={})=>options.emit('runtime',{stage,round,maxRounds:limit,node:state.node,stateVersion:state.sequence,resumed:!!checkpoint?.resume,...(state.protocolRecoveryPending?{retryAttempt:1}:{}),...extra} satisfies RunProgress)
    const execute=async(call:LlmToolCall,round:number):Promise<ChatMessage>=>{
      if(state.completed[call.id])return state.completed[call.id]
      const at=Date.now(),tool=tools.get(call.name);let outcome:ToolOutcome={text:''},cached=false,status:ToolRecord['status']='SUCCESS',args:Record<string,unknown>={},startedTool=false
      const scope=abortScope(options.signal,45_000)
      try{
        checkAbort(scope.signal)
        if(!tool)throw new Error('工具未在本轮授权，不能执行。')
        if(tool.available?.()===false)throw new Error('该工具已达到本轮可用预算，请依据已获得的结果回答。')
        args=parseToolArguments(tool,call.arguments)
        options.emit('tool_start',{id:call.id,name:call.name,arguments:args,round})
        startedTool=true
        if(options.hooks?.beforeTool)await abortable(options.hooks.beforeTool(tool,args,scope.signal),scope.signal);checkAbort(scope.signal)
        const key=call.name+':'+canonicalArguments(args)
        if(!tool.readOnly&&state.writeLedger.includes(key))throw new Error('相同写操作已执行或结果未确认，禁止重复执行；请确认后发起新任务。')
        const perform=async()=>{
          state.inFlight[call.id]={name:call.name,readOnly:tool.readOnly===true};if(!tool.readOnly)state.writeLedger.push(key)
          await persist();checkAbort(scope.signal)
          const value=await abortable(tool.execute(args,scope.signal),scope.signal)
          checkAbort(scope.signal)
          let output:ToolOutcome=typeof value==='string'?{text:value}:value
          if(options.hooks?.afterTool)output=(await abortable(options.hooks.afterTool(tool,output,scope.signal),scope.signal))||output
          return output
        }
        if(tool.readOnly&&cache.has(key)){outcome=cache.get(key)!;cached=true}
        else if(tool.readOnly&&pendingCache.has(key)){outcome=await abortable(pendingCache.get(key)!,scope.signal);cached=true}
        else{
          const work=perform();if(tool.readOnly)pendingCache.set(key,work)
          try{outcome=await work;if(tool.readOnly&&!outcome.isError)cache.set(key,outcome)}finally{pendingCache.delete(key)}
        }
        if(outcome.isError)status='FAILED'
      }catch(error){
        status=options.signal.aborted?'ABORTED':'FAILED'
        outcome={text:status==='ABORTED'?'本次工具执行已停止。':'工具执行失败：'+((error as Error)?.message||'未知错误'),isError:true}
        if(!startedTool)options.emit('tool_start',{id:call.id,name:call.name,arguments:{},round})
      }finally{scope.dispose()}
      const record:ToolRecord={...call,result:outcome.text.slice(0,4000),status,durationMs:Date.now()-at,cached,round}
      const existing=result.tools.findIndex(t=>t.id===call.id);if(existing>=0)result.tools[existing]=record;else result.tools.push(record);result.metrics.toolCalls++;if(cached)result.metrics.cachedCalls++;if(status==='FAILED')result.metrics.failedTools++
      options.emit('tool_result',{...record,isError:status!=='SUCCESS'})
      const reply:ChatMessage={role:'tool',content:outcome.text.slice(0,20000),toolCallId:call.id,name:call.name}
      if(status!=='ABORTED')state.completed[call.id]=reply
      if(status==='SUCCESS')delete state.inFlight[call.id]
      await persist();return reply
    }
    try{
      while(state.node!=='end'){
        const round=state.round;result.metrics.nodeTransitions!++
        checkAbort(options.signal)
        // The last turn always summarizes obtained results with tools disabled.
        const last=round===limit,activeDefs=last?[]:defs.filter(def=>tools.get(def.name)?.available?.()!==false)
        if(state.node==='context'&&last&&!state.protocolRecoveryPending){result.metrics.limitReached=true;const notice='工具调用已达到本轮预算。请根据已获得的结果完成回答，明确仍不确定的部分，不再请求工具。';const system=working.find(m=>m.role==='system');if(system)system.content+='\n'+notice;else working.unshift({role:'system',content:notice})}
        if(state.node==='context'){
        progress('context',round+1)
        const transformed=options.hooks?.beforeModel?await abortable(options.hooks.beforeModel({messages:working.map(m=>({...m})),round:round+1},options.signal),options.signal):undefined
        checkAbort(options.signal)
        const fitted=fitContext(transformed||working,activeDefs,options.contextWindow,options.request.maxTokens||4096)
        result.metrics.removedTurns+=fitted.budget.removedTurns;result.metrics.truncatedResults+=fitted.budget.truncatedResults
        result.metrics.peakInputTokens=Math.max(result.metrics.peakInputTokens,fitted.budget.inputTokens)
        // Keep the pruned context for following rounds, avoiding repeated work and stale results.
        working.splice(0,working.length,...fitted.messages);state.budget=fitted.budget
        state.node='model';await persist();continue
        }
        if(state.node==='model'){
        progress('model',round+1,state.budget)
        state.modelStart={text:result.text.length,reasoning:result.reasoning.length}
        await persist()
        const calls:LlmToolCall[]=[],seen=new Set<string>();let text='',reasoning='',rawText='',rawReasoning='',prompt=0,completion=0,gotUsage=false,gotDone=false,streamFailed=false,visibleTextEmitted=false,retryProtocol=false
        const textBoundary=new ToolMarkupStream(),reasonBoundary=new ToolMarkupStream()
        const iterator=options.provider.stream({...options.request,messages:working,tools:activeDefs.length?activeDefs:undefined,signal:options.signal})
        try{
          while(true){
            const item=await abortable(iterator.next(),options.signal);if(item.done)break
            const event=item.value;checkAbort(options.signal)
            if(event.type==='text'){rawText+=event.text;const visible=textBoundary.push(event.text);text+=visible;if(!activeDefs.length){result.text+=visible;if(visible){visibleTextEmitted=true;options.emit('text',{text:visible})}}}
            else if(event.type==='reasoning'){rawReasoning+=event.text;const visible=reasonBoundary.push(event.text);reasoning+=visible;result.reasoning+=visible;if(visible)options.emit('reasoning',{text:visible})}
            else if(event.type==='tool_call'){
              if(!event.call.id||seen.has(event.call.id)||ids.has(event.call.id))throw new Error('模型返回重复或无效的工具调用标识，请重试。')
              if(calls.length>=12)throw new Error('模型单轮请求的工具过多，请缩小问题范围。')
              seen.add(event.call.id);ids.add(event.call.id);calls.push(event.call);options.emit('tool_call',event.call)
            }else if(event.type==='usage'){gotUsage=true;prompt=event.usage.promptTokens;completion=event.usage.completionTokens}
            else if(event.type==='done'){gotDone=true;result.finishReason=event.finishReason;if(event.finishReason==='aborted'){result.aborted=true;break}}
            else if(event.type==='error'){result.providerError=true;throw new Error(event.message)}
          }
          if(!gotDone&&!result.aborted){result.providerError=true;throw new Error('模型响应提前中断，请稍后重试。')}
          const tail=textBoundary.finish(),reasonTail=reasonBoundary.finish();text+=tail;if(!activeDefs.length){result.text+=tail;if(tail){visibleTextEmitted=true;options.emit('text',{text:tail})}}reasoning+=reasonTail;result.reasoning+=reasonTail;if(reasonTail)options.emit('reasoning',{text:reasonTail})
          if(textBoundary.removed&&!calls.length&&!result.aborted)throw new UnparsedToolOutputError()
        }catch(error){
          streamFailed=true
          // Retry only the uncommitted model turn. Serialized text never becomes an executable call.
          // Existing tool results and write ledgers stay in the graph; no prior operation is replayed.
          retryProtocol=error instanceof UnparsedToolOutputError&&!visibleTextEmitted&&!calls.length&&!options.signal.aborted&&(result.metrics.automaticRetries||0)<1
          if(!retryProtocol){
            if(error instanceof UnparsedToolOutputError&&(result.metrics.automaticRetries||0)>0)throw new Error('自动重试后模型仍返回未解析的工具调用，未执行额外操作。请点击重新生成。')
            throw error
          }
        }finally{
          if(!retryProtocol&&(streamFailed||result.aborted)&&activeDefs.length&&!calls.length&&text){result.text+=text;options.emit('text',{text})}
          result.metrics.modelTurns++
          result.promptTokens+=gotUsage?prompt:state.budget?.inputTokens||result.metrics.peakInputTokens
          result.completionTokens+=gotUsage?completion:estimateTokens(rawText+rawReasoning+JSON.stringify(calls))
          // Closing an SDK iterator may be asynchronous; cancellation must not wait for it.
          void iterator.return?.(undefined).catch(()=>undefined)
        }
        if(result.aborted)break
        if(retryProtocol){
          result.metrics.automaticRetries=1;state.protocolRecoveryPending=true;state.modelStart=undefined;result.finishReason=undefined
          const instruction='【工具协议纠正】上一轮输出格式无效，工具没有执行。需要工具时仅使用接口提供的标准工具调用字段，禁止在正文输出 DSML、invoke、function_calls 或伪造执行结果。已有工具结果继续使用，不要重复已完成的操作；无需或已无可用工具时，直接基于现有证据回答。'
          const system=working.find(m=>m.role==='system');if(system)system.content+='\n'+instruction;else working.unshift({role:'system',content:instruction})
          state.node='context';progress('retrying',round+1);await persist();continue
        }
        state.protocolRecoveryPending=false
        if(!calls.length&&activeDefs.length&&text){result.text+=text;options.emit('text',{text})}
        // Invalid calls still receive an error reply. Provider envelopes require object arguments;
        // this normalization is for the transcript only and never permits executing invalid input.
        const protocolCalls=calls.map(call=>{try{const args=JSON.parse(call.arguments||'{}');if(args&&typeof args==='object'&&!Array.isArray(args))return call}catch{};return {...call,arguments:JSON.stringify({invalidArguments:call.arguments.slice(0,1000)})}})
        const assistant:ChatMessage={role:'assistant',content:text,...(calls.length?{toolCalls:protocolCalls}:{})}
        working.push(assistant);result.modelMessages.push(assistant)
        state.modelStart=undefined;state.pendingCalls=calls;state.completed={};for(const [id,flight] of Object.entries(state.inFlight))if(flight.readOnly)delete state.inFlight[id]
        if(!calls.length){state.node='finalize';await persist();continue}
        if(last)throw new Error('模型在工具预算结束后仍请求工具，未执行额外操作。')
        state.node='tools';await persist();continue
        }
        if(state.node==='tools'){
        const calls=state.pendingCalls
        progress('tools',round+1)
        const toolMessages:ChatMessage[]=[]
        // Mutable or unclassified tools keep source order. Read-only batches have at most 3 workers.
        if(calls.every(c=>tools.get(c.name)?.readOnly)){
          for(let start=0;start<calls.length;start+=3){checkAbort(options.signal);toolMessages.push(...await Promise.all(calls.slice(start,start+3).map(c=>execute(c,round+1))))}
        }else for(const call of calls){checkAbort(options.signal);toolMessages.push(await execute(call,round+1))}
        checkAbort(options.signal)
        working.push(...toolMessages);result.modelMessages.push(...toolMessages)
        state.pendingCalls=[];state.completed={};state.round++;state.node='context';await persist();continue
        }
        if(state.node==='finalize'){state.node='end';await persist();break}
      }
    }catch(error){
      if(options.signal.aborted&&options.signal.reason?.name!=='TimeoutError')result.aborted=true
      else result.failure=(error as Error)?.message||'Agent 执行失败'
    }finally{
      result.metrics.latencyMs=previousLatency+Date.now()-started
      if(result.failure||result.aborted)try{await persist()}catch{}
      result.metrics.checkpointAvailable=persisted&&checkpointEnabled&&state.node!=='end'&&state.node!=='finalize'&&!Object.values(state.inFlight).some(t=>!t.readOnly)
      progress('finalizing',result.metrics.modelTurns)
    }
    // Persist tools in source order even when completion events were concurrent.
    result.tools.sort((a,b)=>a.round-b.round||[...ids].indexOf(a.id)-[...ids].indexOf(b.id))
    return result
  }
}
