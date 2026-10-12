import {gzipSync,gunzipSync} from 'node:zlib'
import {readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=new URL('../dist/assets/',import.meta.url);let count=0,total=0,compressed=0
for(const file of readdirSync(root)){
 if(!/\.(js|css|svg)$/.test(file))continue
 const bytes=readFileSync(new URL(file,root));assert(!bytes.includes(Buffer.from('__VITE_PRELOAD__')),'Vite has not finished rewriting '+file)
 if(bytes.length<1024)continue
 const gz=gzipSync(bytes,{level:9});assert(gunzipSync(gz).equals(bytes),'Compressed bytes mismatch '+file)
 if(gz.length>=bytes.length)continue
 writeFileSync(fileURLToPath(new URL(file+'.gz',root)),gz);count++;total+=bytes.length;compressed+=gz.length
}
console.log(JSON.stringify({precompressed:count,originalBytes:total,gzipBytes:compressed,verified:'Every gzip decompresses to the final emitted asset, no build placeholders'}))
