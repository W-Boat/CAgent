/** Verification pages are transport failures, never knowledge article content. */
export function isVerificationPage(html:string){
 return /当前环境异常|完成验证后即可继续访问|环境异常[\s\S]{0,80}去验证|访问过于频繁|操作频繁|Please enable JavaScript and refresh|checking your browser|access denied|wappoc_appmsgcaptcha|jsl[_-]?clearance/i.test(html)
}
