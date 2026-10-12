import json
import re
import sqlite3
db=sqlite3.connect('file:/app/data/wechrss.db?mode=ro',uri=True)
print('SOURCE_STATUS',db.execute('SELECT book_id,last_status,last_sync_at,next_sync_at FROM sources').fetchall())
rows=db.execute("SELECT value FROM app_settings WHERE key LIKE 'job:%'").fetchall()
print('JOBS',[{key:json.loads(row[0]).get(key) for key in ('id','status','collected','metadataCount','retryAfter')}for row in rows])
for source,error in db.execute('SELECT book_id,last_error FROM sources'):
    print('ERROR_CLASSIFICATION',source,{'codes':re.findall(r'(?:errcode|errCode|code|ret|status|HTTP)[^0-9-]{0,20}(-?[0-9]+)',error),
        'timeout':'Timeout' in error or 'timed out' in error,'auth':any(s in error for s in ('授权','凭证','认证','401')),
        'schema':any(s in error for s in ('JSON','格式','KeyError','TypeError')),
        'risk':any(s in error for s in ('风控','限制','429')),'notFound':'404' in error})
db.close()
