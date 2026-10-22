FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=80 DB_PATH=/data/lgs.db NODE_NO_WARNINGS=1
COPY server.mjs ./
COPY public ./public
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/api/health || exit 1
CMD ["node", "server.mjs"]
