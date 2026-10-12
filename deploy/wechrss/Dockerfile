FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY upstream/ ./
COPY bridge.py ./
RUN mkdir -p /app/data
EXPOSE 8001
CMD ["python", "bridge.py"]
