FROM node:20-alpine

WORKDIR /app
COPY package.json server.mjs ./
COPY site ./site
RUN mkdir -p /app/data/datasets && chown -R node:node /app

USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O - http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.mjs"]
