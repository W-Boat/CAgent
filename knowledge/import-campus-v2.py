"""Import only knowledge and SQLite; never execute archive tools or ingest evaluation answers."""
from pathlib import Path
import zipfile,json,hashlib,sqlite3,sys,collections
root=Path(__file__).resolve().parent
archive=Path(sys.argv[1]);source=root/'src'/'campus-v2-contest';source.mkdir(parents=True,exist_ok=True)
z=zipfile.ZipFile(archive);prefix=next(n.split('/')[0] for n in z.namelist() if n.startswith('01_'))+'/'
manifest=json.loads(z.read(prefix+'manifest.json'))
allowed=[n for n in z.namelist() if n.startswith(prefix+'knowledge/') and n.endswith('.md')]
allowed += [prefix+n for n in ['database/campus.sqlite','database/schema.sql','database/README.md','README.md','公开来源索引.md']]
for name in allowed:
    relative=name[len(prefix):];target=(source/relative).resolve()
    if not target.is_relative_to(source.resolve()):raise ValueError('Unsafe archive path')
    data=z.read(name)
    if hashlib.sha256(data).hexdigest()!=manifest[relative]:raise ValueError('Manifest mismatch: '+relative)
    counterpart='02_Excel与Markdown版/'+relative
    if relative.startswith(('knowledge/','database/')) and counterpart in z.namelist() and z.read(counterpart)!=data:raise ValueError('Versions differ: '+relative)
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
db=sqlite3.connect((source/'database/campus.sqlite').resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
tables=[r[0] for r in db.execute("select name from sqlite_master where type='table' order by name")]
assert set(tables)=={'services','departments','aliases','announcements','resource_slots','service_outages','application_windows','graduation_fixture'}
records={t:[dict(r) for r in db.execute('select * from '+t)] for t in tables};services={r['service_id']:r for r in records['services']}
aliases=collections.defaultdict(list)
for r in records['aliases']:aliases[r['service_id']].append(r['expression'])
items=[];ids=set();skipped=[];existing={r['id'] for r in json.loads((root/'dist/campus-kb.json').read_text(encoding='utf-8'))['items']}
collection='campus-v2-contest';notice='【赛事模拟数据】不代表社科大实际运营规则、当前资源余量或用户本人状态。'
def add(key,title,body,kind='知识',service_id=None,table=None,row=None,part=0,indexable=True):
    if '人文之光' in title+' '+body:skipped.append(key);return
    ident=900000000+int(hashlib.sha256(key.encode()).hexdigest()[:12],16)%100000000
    if ident in ids or ident in existing:raise ValueError('ID collision: '+key)
    ids.add(ident);service=services.get(service_id,{});detail=notice+'\n\n'+body
    kb={'schema':'kb/v2','collection':collection,'parent':key.split('/part-')[0],'key':key,'file':'database/campus.sqlite' if table else key.split('/part-')[0],'locator':table+'/'+key.split('/')[-1] if table else 'Markdown/'+str(part+1),'trust':'simulation','simulation':True,'sourceClaim':'赛事模拟快照 v2.2','relations':['contest:service:'+service_id] if service_id else [],'sectionPath':[table or service.get('category','通用规则')],'aliases':aliases.get(service_id,[]) if kind=='事项' else [],'indexable':indexable,'part':part}
    if table:kb.update({'table':table,'record':row})
    items.append({'id':ident,'title':title,'url':'','cat':service.get('category') or '赛事数据库','type':kind,'source':'校园事务 2.0 · 赛事模拟（包内 v2.2）','detail_status':'full','summary_short':detail[:1500],'detail':detail,'steps':[],'key_facts':[],'verified_at':'2026-10-09','note':notice,'extra':{'kb':kb},'search_text':(' '.join([title,detail,*kb['aliases']])).lower()})
for name in sorted(allowed):
    if '/knowledge/' not in name:continue
    relative=name[len(prefix):];body=z.read(name).decode('utf-8');stem=Path(relative).stem
    title=next((line.lstrip('# ').strip() for line in body.splitlines() if line.startswith('# ')),stem)
    for part,start in enumerate(range(0,len(body),900)):add(relative+'/part-'+str(part),title,body[start:start+900],'事项' if stem in services else '知识',stem if stem in services else None,part=part)
labels={'services':'事项目录','departments':'模拟部门','announcements':'动态公告','aliases':'事项别名','resource_slots':'模拟资源时段','service_outages':'模拟服务维护','application_windows':'模拟申请批次','graduation_fixture':'DEMO 离校状态'}
for table,rows in records.items():
    pk=[r['name'] for r in db.execute('pragma table_info('+table+')') if r['pk']]
    for row in rows:
        locator='|'.join(str(row[k]) for k in pk);service_id=row.get('service_id');service=services.get(service_id,{})
        title=row.get('title') or row.get('expression') or row.get('name') or ' · '.join(str(row[k]) for k in ['resource_type','campus','room','service_date','batch','case_id','step'] if row.get(k)) or service.get('name') or locator
        body='来源表：'+table+'\n主键：'+locator+'\n'+json.dumps(row,ensure_ascii=False,indent=2)
        add('database/'+table+'/'+locator,labels[table]+' · '+title,body,'数据库记录',service_id,table,row,indexable=table not in {'aliases','services'})
db.close()
report={'collection':collection,'displayVersion':'2.0','packageVersion':'2.2','simulation':True,'defaultMounted':False,'markdownFiles':len([n for n in allowed if '/knowledge/' in n]),'tables':{t:len(v) for t,v in records.items()},'sqliteRecords':sum(map(len,records.values())),'blocks':len(items),'searchableBlocks':sum(r['extra']['kb']['indexable'] for r in items),'skippedRetired':skipped,'evaluationImported':0,'sourceArchiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'sqliteSha256':hashlib.sha256((source/'database/campus.sqlite').read_bytes()).hexdigest()}
(root/'dist/campus-v2-contest.json').write_text(json.dumps({'meta':{'schema':'kb/v2','total':len(items),'dataset':report},'items':items},ensure_ascii=False),encoding='utf-8')
(source/'import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
