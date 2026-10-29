"""Use upstream routes and add the authenticated body-backfill endpoint."""
from web import app
from cagent_content import router
app.include_router(router, prefix='/api/v1/wx')
