# Two stages: build the web UI, then the runtime with the server and web/dist only.
# Node 26 only (rulebook). Docker on OrbStack, never Docker Desktop.
# No host tools in the image: nothing here can read the host, and the actors are in-process mocks.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts
COPY web web
RUN npm run build -w @chatgpt-mcp-flow/web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production MCP_FLOW_PORT=6650
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w @chatgpt-mcp-flow/server --ignore-scripts && npm cache clean --force
COPY server/src server/src
COPY server/diagrams server/diagrams
COPY customer.config.json ./
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 6650
# Inside the container the server must listen on all interfaces, so MCP_FLOW_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
# The mock actors (6651-6655) always bind 127.0.0.1 inside the container and are never published.
ENV MCP_FLOW_BIND=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:6650/api/health').then(r=>r.json()).then(j=>process.exit(j.state==='ready'?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
