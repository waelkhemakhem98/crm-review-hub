FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py db.py build_db.py export_xlsx.py entrypoint.sh ./
COPY seed/ ./seed/
RUN chmod +x entrypoint.sh

ENV DB_PATH=/app/data/app.db
VOLUME ["/app/data"]
EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
