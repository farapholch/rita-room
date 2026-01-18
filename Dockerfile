FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:1 AS builder

WORKDIR /excalidraw-room

RUN npm install -g yarn

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN yarn build

FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:1

WORKDIR /excalidraw-room

RUN npm install -g yarn

COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile && yarn cache clean

COPY --from=builder /excalidraw-room/dist ./dist

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:80/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

EXPOSE 80

# Use non-root user for security
USER 1001

CMD ["yarn", "start"]
