# Superset Dockerfile for Railway
# Extends official Superset image with custom configuration

FROM apache/superset:latest

USER root

# Install PostgreSQL driver into Superset's venv site-packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/* && \
    pip install --no-cache-dir --target=/app/.venv/lib/python3.10/site-packages psycopg2-binary && \
    /usr/local/bin/python3 -c "import sys; sys.path.insert(0, '/app/.venv/lib/python3.10/site-packages'); import psycopg2; print('psycopg2 OK:', psycopg2.__version__)"

# Copy custom configuration
COPY superset_config.py /app/superset_config.py
RUN chown superset:superset /app/superset_config.py

# Copy startup script
COPY start-superset.sh /app/start-superset.sh
RUN chmod +x /app/start-superset.sh && chown superset:superset /app/start-superset.sh

# Set environment variable to use custom config
ENV SUPERSET_CONFIG_PATH=/app/superset_config.py

# Switch back to superset user
USER superset

EXPOSE 8088

CMD ["/app/start-superset.sh"]
