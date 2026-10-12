from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parent;raw=json.loads((root/'src/ucass_guide_slim.json').read_text(encoding='utf-8'));items=[];ids=set()
for n,row in enumerate(raw['items']):
 key='ucass_guide_slim.json:'+str(n);ident=1100000000+int(hashlib.sha256(key.encode()).hexdigest()[:12],16)%100000000
 assert ident not in ids;ids.add(ident)
 detail='\n'.join(str(row.get(k,'')) for k in ['title','url','category','content_type'])
 items.append({'id':ident,'title':row['title'],'url':row.get('url',''),'cat':row.get('category','未分类'),'type':row.get('content_type','入口'),'source':'ucass_guide_slim.json · 同源精简视图','detail_status':'link_only','summary_short':detail,'detail':detail,'extra':{'kb':{'schema':'kb/v2','file':'ucass_guide_slim.json','collection':'portal','parent':key,'locator':'items['+str(n)+']','trust':'official_index','derivedFrom':'ucass_guide.json','aliases':[]}},'search_text':detail.lower()})
(root/'dist/campus-slim-source.json').write_text(json.dumps({'meta':{'schema':'kb/v2','total':len(items)},'items':items},ensure_ascii=False),encoding='utf-8')
print(json.dumps({'source':'ucass_guide_slim.json','records':len(items),'defaultMounted':False,'derivedFrom':'ucass_guide.json'}))
