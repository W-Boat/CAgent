import {readFileSync,writeFileSync} from 'node:fs'
const source=readFileSync(new URL('./batch-format.ts',import.meta.url),'utf8')
writeFileSync(new URL('../apps/api/src/evaluation/batch-format.ts',import.meta.url),'// Generated from evaluation/batch-format.ts; run node evaluation/sync.mjs after editing.\n'+source)
console.log('Evaluation format contract synced')
