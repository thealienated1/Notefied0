FROM postgres:17-alpine

# Set environment variables
ENV POSTGRES_DB=notes_app_db
ENV POSTGRES_USER=postgres


# Set the default locale
ENV LANG=en_US.utf8

# Create database directory and set permissions
RUN mkdir -p /var/lib/postgresql/data && \
    chown -R postgres:postgres /var/lib/postgresql/data && \
    chmod 700 /var/lib/postgresql/data

# Copy initialization scripts
COPY init.sql /docker-entrypoint-initdb.d/

# Ensure proper permissions on init scripts
RUN chmod 644 /docker-entrypoint-initdb.d/init.sql

# Expose PostgreSQL port
EXPOSE 5432

# Set the default command
CMD ["postgres"]
