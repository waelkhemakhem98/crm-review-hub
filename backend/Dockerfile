FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py db.py build_db.py export_xlsx.py entrypoint.sh ./
COPY seed/ ./seed/
RUN chmod +x entrypoint.sh

ENV DB_PATH=/app/data/app.db
VOLUME ["/app/data"]
# No EXPOSE: the frontend reaches this at http://backend:8000 over the compose
# network by service name. Leaving it un-exposed keeps the frontend as the
# single app port the deployment CLI routes to. uvicorn still binds 0.0.0.0:8000
# (see entrypoint.sh), which is what makes it reachable internally.

ENTRYPOINT ["./entrypoint.sh"]
