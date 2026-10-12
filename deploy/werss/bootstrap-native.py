"""Initialize only the dedicated native API user, without printing credentials."""
import os
import sys
import uuid

password = os.getenv('CAgent_PASSWORD') or os.getenv('CAGENT_COLLECTOR_PASSWORD', '')
username = os.getenv('CAgent_USER', 'cagent')
if len(password) < 12:
    raise ValueError('A private collector password of at least 12 characters is required')

# Register the pinned runtime's models without calling its default-user seed.
import init_sys
from core.db import DB
from core.models.user import User
from core.auth import pwd_context
DB.create_tables()
session = DB.get_session()
try:
    user = session.query(User).filter(User.username == username).first()
    if user is None:
        session.add(User(id=str(uuid.uuid4()), username=username, password_hash=pwd_context.hash(password), role='admin', is_active=True))
        session.commit()
    elif not user.is_active or not pwd_context.verify(password, user.password_hash):
        raise ValueError('Existing native user does not match configured credential; refusing to overwrite')
finally:
    session.close()

print('PRIVATE_NATIVE_USER_READY')
if '--init-only' not in sys.argv:
    os.execv(sys.executable, [sys.executable, '-m', 'uvicorn', 'web:app', '--host', '0.0.0.0', '--port', '8001', '--workers', '1'])
