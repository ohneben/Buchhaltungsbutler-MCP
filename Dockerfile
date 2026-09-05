# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Default to the hosted HTTP transport in containers.
ENV MCP_TRANSPORT=http
ENV PORT=3000

# Eigentumsnachweis für das MCP-Registry: der Wert muss exakt dem Feld "name"
# in server.json entsprechen, sonst lehnt die Registry das Image ab.
LABEL io.modelcontextprotocol.server.name="io.github.ohneben/buchhaltungsbutler-mcp"

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY spec.json ./spec.json

# Run as the unprivileged node user shipped with the image.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
