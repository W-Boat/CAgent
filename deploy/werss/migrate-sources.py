"""Copy subscriptions and available article bodies from a read-only old DB.

Old transport jobs, credentials and backoff are retained in the old directory;
they do not describe the new independently authorized Web session.
"""
import sqlite3
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
from service import AppDB
from wechat_mp_fetcher import Article, save_article

source = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
if source == destination:
    raise ValueError('source and destination must differ')
old = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
old.row_factory = sqlite3.Row
new = AppDB(destination)
if new.list_sources():
    raise ValueError('destination already contains subscriptions')
for row in old.execute('SELECT * FROM sources'):
    item = new.add_source(source_value=row['book_id'], name=row['name'], interval_minutes=row['sync_interval_minutes'],
                          fetch_content=False, rss_limit=row['rss_limit'])
    new.set_enabled(item.id, bool(row['enabled']))
    with new.connect() as conn:
        conn.execute('UPDATE sources SET next_sync_at=? WHERE id=?', (max(int(time.time())+60, row['next_sync_at']) if row['enabled'] else 0, item.id))
        conn.commit()
count = 0
for row in old.execute('SELECT * FROM articles'):
    fields = {k:row[k] for k in ('review_id','book_id','title','summary','cover_url','url','publish_at','original_id','read_num','like_num','content_html','author')}
    with new.connect() as conn:
        save_article(conn, Article(**fields))
        conn.commit()
    count += 1
old.close()
print('MIGRATED_SUBSCRIPTIONS',len(new.list_sources()),'PRESERVED_ARTICLES',count)
