FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN groupadd -r talent && useradd -r -g talent -u 10001 talent
COPY --chown=talent:talent criteria.py server.py setup_pins.py manage_users.py ./
COPY --chown=talent:talent public ./public
RUN mkdir -p /data && chown talent:talent /data
USER talent
ENV TALENT_DB_PATH=/data/talent.sqlite3 TALENT_COOKIE_SECURE=true
EXPOSE 8088
CMD ["uvicorn","server:app","--host","0.0.0.0","--port","8088","--workers","1","--proxy-headers","--forwarded-allow-ips","*"]
