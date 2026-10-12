"""Read-only legacy subscriptions. Run in new container with old DB snapshot."""
import sqlite3
from pathlib import Path
from bridge import Bridge

old = sqlite3.connect('file:/tmp/legacy.db?mode=ro', uri=True)
old.row_factory = sqlite3.Row
app = Bridge(Path('/app/data'))
for row in old.execute('SELECT * FROM feeds'):
    value = dict(row)
    book_id = str(value.get('id') or value.get('mp_id') or '')
    name = str(value.get('mp_name') or value.get('name') or '')
    if not book_id.startswith('MP_WXS_') or not book_id[7:].isdigit() or not name:
        continue
    if not app.source(book_id):
        source = app.db.add_source(source_value=book_id, name=name)
        if value.get('status') == 0:
            app.db.set_enabled(source.id, False)
print('MIGRATED_SUBSCRIPTIONS', [(s.book_id, s.name, s.enabled) for s in app.db.list_sources()])
