ARG WERSS_BASE=rachelos/we-mp-rss@sha256:7873205d40610ef894a419ab2691d1039cf3f0e442fee11a13df4aa3997c53d1
FROM ${WERSS_BASE}
WORKDIR /app
# Fixed 1.5.3 runtime plus four unmodified upstream modules at COMMIT.
COPY upstream/core/ ./core/
COPY upstream/apis/ ./apis/
COPY upstream/driver/ ./driver/
COPY bootstrap-native.py ./cagent-bootstrap.py
COPY cagent_content.py cagent_web.py verify-content.py ./
ENV ENABLE_JOB=False GATHER.CONTENT_AUTO_CHECK=False AUTO_RELOAD=False \
    WEREAD_MP_MAX_PAGES=1 WEREAD_AUTO_ADD_TO_SHELF=False GATHER.CONTENT=False
# Upstream main.py prints environment variables; start FastAPI directly.
ENTRYPOINT ["/app/env_x86_64/bin/python3"]
CMD ["cagent-bootstrap.py"]
