FROM node:26.13.1-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json catalog.mjs state.mjs auto-import.mjs instance-lock.mjs weather.mjs sessions.mjs login-client.mjs shutdown.mjs server.mjs ./
COPY --chown=node:node public ./public

USER node
EXPOSE 8088
CMD ["node", "server.mjs"]

