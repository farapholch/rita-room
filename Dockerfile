FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:1 AS builder

WORKDIR /excalidraw-room

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN yarn build

FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:1

WORKDIR /excalidraw-room

COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

COPY --from=builder /excalidraw-room/dist ./dist

EXPOSE 80
CMD ["yarn", "start"]
