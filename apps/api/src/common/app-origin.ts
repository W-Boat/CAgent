/** Deployment-specific URLs come from configuration, never from a hard-coded production host. */
export function appOrigin(){
 const value=process.env.SITE_ORIGIN||process.env.WEB_ORIGIN?.split(',')[0]||'http://localhost:5173'
 try{const url=new URL(value);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url.origin}catch{}
 return 'http://localhost:5173'
}
