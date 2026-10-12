import {ref,watch,onBeforeUnmount,type Ref} from 'vue'
import {compressImage,imageDataUrl} from '@/utils/image-compression'
export interface ImageTransferState {label:string;percent?:number;note?:string;failed?:boolean}
const size=(n:number)=>n>=1024*1024?(n/1024/1024).toFixed(1)+'MB':Math.round(n/1024)+'KB'
export function useImageAttachments(images:Ref<string[]>,conversation:Ref<string>,warn:(message:string)=>void){
 const imagePreparing=ref(false),imageTransfer=ref<ImageTransferState>(),uploadActive=ref(false);let controller:AbortController|undefined
 function cancel(){controller?.abort();controller=undefined;imagePreparing.value=false;imageTransfer.value=undefined;uploadActive.value=false}
 watch(conversation,cancel,{flush:'sync'});onBeforeUnmount(cancel)
 async function prepare(files:File[]){
  if(imagePreparing.value||!files.length)return
  const room=4-images.value.length;if(room<=0){warn('最多附加4张图片');return}if(files.length>room)warn(`最多附加4张图片，已取前${room}张`)
  const selected=files.slice(0,room),scope=new AbortController();controller=scope;imagePreparing.value=true;let before=0,after=0,added=0
  try{for(let i=0;i<selected.length;i++){
   if(scope.signal.aborted)break
   imageTransfer.value={label:`正在压缩图片 ${i+1}/${selected.length}`}
   try{const blob=await compressImage(selected[i],scope.signal);const url=await imageDataUrl(blob,percent=>{if(!scope.signal.aborted)imageTransfer.value={label:`正在准备图片 ${i+1}/${selected.length}`,percent}},scope.signal)
    if(scope.signal.aborted)break;images.value.push(url);before+=selected[i].size;after+=blob.size;added++
   }catch(e){if(scope.signal.aborted)break;warn(`${selected[i].name}：${(e as Error).message}`)}
  }if(!scope.signal.aborted)imageTransfer.value=added?{label:`${added}张图片已就绪`,percent:100,note:after<before?`${size(before)} → ${size(after)}，减少${Math.round((1-after/before)*100)}%`:size(after)}:{label:'图片未能添加，请重新选择',failed:true}
  }finally{if(controller===scope){imagePreparing.value=false;controller=undefined}}
 }
 function beginUpload(){uploadActive.value=true;imageTransfer.value={label:'正在上传图片',percent:0}}
 function uploadProgress(percent:number){if(!uploadActive.value)return;imageTransfer.value={label:percent===100?'图片已上传，等待回复':'正在上传图片',percent}}
 function finishUpload(status?:string){if(!uploadActive.value)return;uploadActive.value=false;imageTransfer.value=status==='SUCCESS'?undefined:{label:status==='ABORTED'?'图片发送已停止':'图片发送未完成，请重新发送',failed:true}}
 return {imagePreparing,imageTransfer,prepare,beginUpload,uploadProgress,finishUpload,cancel}
}
