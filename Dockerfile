FROM node:22-alpine AS builder

WORKDIR /excalidraw-room

# Install dependencies needed for native modules
RUN apk add --no-cache python3 make g++

RUN npm install -g yarn

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN yarn build

FROM node:22-alpine

WORKDIR /excalidraw-room

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

RUN npm install -g yarn

COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile && yarn cache clean

COPY --from=builder /excalidraw-room/dist ./dist

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:80/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

EXPOSE 80

# Use non-root user for security
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["yarn", "start"]
