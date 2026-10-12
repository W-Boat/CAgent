import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
const root=new URL('../',import.meta.url)
for(const name of ['agent-ui','output-boundary','card-json','answer-presentation']){
const source=readFileSync(new URL('presentation/'+name+'.ts',root),'utf8')
for(const path of ['apps/api/src/presentation/'+name+'.ts','apps/web/src/utils/'+name+'.ts']){
 const target=new URL(path,root);mkdirSync(new URL('./',target),{recursive:true})
 if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==source)throw new Error('UI contract drift: '+path)}else writeFileSync(target,source)
}
}
console.log(process.argv.includes('--check')?'UI contracts match':'UI contracts synchronized')
