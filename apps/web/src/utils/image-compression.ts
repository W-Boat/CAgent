const MAX_INPUT = 20 * 1024 * 1024
export const IMAGE_TARGET_BYTES = 256 * 1024
const MAX_EDGE = 2048
function check(signal?:AbortSignal){if(signal?.aborted)throw new DOMException('已取消图片处理','AbortError')}
export async function compressImage(file:File,signal?:AbortSignal):Promise<Blob>{
 check(signal)
 if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw new Error('请选择 JPG、PNG、WebP 或 GIF 图片')
 if(file.size>MAX_INPUT)throw new Error('原图超过20MB，请先缩小图片')
 if(file.type==='image/gif'){if(file.size>IMAGE_TARGET_BYTES)throw new Error('动图请控制在256KB以内，避免压缩丢失动画');return file}
 const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'})
 try{
  check(signal)
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40_000_000)throw new Error('图片尺寸过大，请选择4000万像素以内的图片')
  if(file.size<=IMAGE_TARGET_BYTES&&Math.max(bitmap.width,bitmap.height)<=MAX_EDGE)return file
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw new Error('浏览器无法处理图片，请更换浏览器后重试')
  let scale=Math.min(1,MAX_EDGE/Math.max(bitmap.width,bitmap.height))
  for(let resize=0;resize<6;resize++){
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));context.drawImage(bitmap,0,0,canvas.width,canvas.height)
   for(const quality of [.86,.76,.64]){
    check(signal);const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));check(signal)
    if(blob&&blob.size<=IMAGE_TARGET_BYTES)return blob.size<file.size||Math.max(bitmap.width,bitmap.height)>MAX_EDGE?blob:file
   }
   scale*=.8
  }
  throw new Error('图片压缩后仍过大，请裁剪后再试')
 }finally{bitmap.close()}
}
export function imageDataUrl(blob:Blob,onProgress:(percent:number)=>void,signal?:AbortSignal):Promise<string>{
 return new Promise((resolve,reject)=>{
  const reader=new FileReader(),abort=()=>reader.abort(),clean=()=>signal?.removeEventListener('abort',abort)
  reader.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100))}
  reader.onload=()=>{clean();onProgress(100);resolve(String(reader.result))}
  reader.onerror=()=>{clean();reject(new Error('图片读取失败，请重新选择'))}
  reader.onabort=()=>{clean();reject(new DOMException('已取消图片处理','AbortError'))}
  if(signal?.aborted){reject(new DOMException('已取消图片处理','AbortError'));return}
  signal?.addEventListener('abort',abort,{once:true});reader.readAsDataURL(blob)
 })
}
