import {writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
let revision='unknown';try{revision=execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim()}catch{}
const info={version:process.env.BUILD_VERSION||new Date().toISOString().replace(/[-:]/g,'').slice(0,15),builtAt:new Date().toISOString(),revision}
for(const file of ['apps/api/src/common/build-info.json','apps/web/src/data/build-info.json'])writeFileSync(file,JSON.stringify(info,null,2)+'\n')
console.log('Build version: '+info.version)
