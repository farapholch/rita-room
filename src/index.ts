import debug from "debug";
import express from "express";
import http from "http";
import { Server as SocketIO } from "socket.io";
import { Gauge, Counter, Histogram, register } from "prom-client";
import Redis from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import dotenv from "dotenv";

// === Types ===
type UserToFollow = {
  socketId: string;
  username: string;
};

type OnUserFollowedPayload = {
  userToFollow: UserToFollow;
  action: "FOLLOW" | "UNFOLLOW";
};

// === Load env ===
dotenv.config(
  process.env.NODE_ENV !== "development"
    ? { path: ".env.production" }
    : { path: ".env.development" },
);

// === Debuggers ===
const serverDebug = debug("server");
const ioDebug = debug("io");

// === Express setup ===
const app = express();
const port =
  process.env.PORT || (process.env.NODE_ENV !== "development" ? 80 : 3002);
app.use(express.static("public"));
app.get("/", (_, res) => {
  res.send("🐉 Dragonfly-backed Rita Room server is running!");
});

// Health check endpoint for Docker/Kubernetes
app.get("/health", (_, res) => {
  const isRedisConnected = pubClient?.status === "ready";
  const healthStatus = {
    status: isRedisConnected ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    redis: {
      connected: isRedisConnected,
      status: pubClient?.status || "unknown",
    },
    uptime: process.uptime(),
  };

  if (isRedisConnected) {
    res.status(200).json(healthStatus);
  } else {
    res.status(503).json(healthStatus);
  }
});

const server = http.createServer(app);

// === Prometheus metrics ===
const connectedSocketsGauge = new Gauge({
  name: "socket_io_connected",
  help: "Number of currently connected sockets",
});
const roomUserCountGauge = new Gauge({
  name: "socket_io_room_user_count",
  help: "Number of users in each room",
  labelNames: ["room"],
});
const activeRoomsGauge = new Gauge({
  name: "socket_io_active_rooms",
  help: "Number of currently active rooms with at least one user",
});
const messageEmitCounter = new Counter({
  name: "socket_io_message_emit_count",
  help: "Total number of message emits from the server",
  labelNames: ["event"],
});
const followEmitCounter = new Counter({
  name: "socket_io_follow_emit_count",
  help: "Total number of follow event emits from the server",
  labelNames: ["action"],
});
const disconnectCounter = new Counter({
  name: "socket_io_disconnect_count",
  help: "Total number of socket disconnections",
});
const redisUpGauge = new Gauge({
  name: "redis_up",
  help: "1 if connected to Redis/Dragonfly pub client, 0 if disconnected",
});
const messageSizeHistogram = new Histogram({
  name: "socket_io_message_size_bytes",
  help: "Size of broadcast messages in bytes",
  labelNames: ["event"],
  buckets: [1e4, 1e5, 5e5, 1e6, 5e6, 10e6, 25e6], // 10KB, 100KB, 500KB, 1MB, 5MB, 10MB, 25MB
});
const largeMessageCounter = new Counter({
  name: "socket_io_large_message_count",
  help: "Number of messages exceeding 1MB",
  labelNames: ["event"],
});

// === Redis clients (declared at module scope) ===
let pubClient: Redis;
let subClient: Redis;

// === Redis helpers: retry on master ===
async function safeSet(
  client: Redis,
  key: string,
  value: string,
  ttlSeconds?: number,
  retries = 3,
) {
  for (let i = 0; i < retries; i++) {
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await client.setex(key, ttlSeconds, value);
      } else {
        await client.set(key, value);
      }
      return;
    } catch (err: unknown) {
      const msg = String((err as any)?.message || err);
      if (msg.includes("READONLY")) {
        console.warn(
          `[safeSet] READONLY key="${key}" — retrying in 200ms (attempt ${i + 1})`,
        );
        await new Promise((r) => setTimeout(r, 200));
      } else {
        throw err;
      }
    }
  }
  console.error(
    `[safeSet] Failed to write key "${key}" after ${retries} retries`,
  );
}

async function safeDel(client: Redis, key: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await client.del(key);
      return;
    } catch (err: unknown) {
      const msg = String((err as any)?.message || err);
      if (msg.includes("READONLY")) {
        console.warn(
          `[safeDel] READONLY key="${key}" — retrying in 200ms (attempt ${i + 1})`,
        );
        await new Promise((r) => setTimeout(r, 200));
      } else {
        throw err;
      }
    }
  }
  console.error(
    `[safeDel] Failed to delete key "${key}" after ${retries} retries`,
  );
}

// === MAIN ===
async function main() {
  // === Environment validation ===
  const requiredEnvVars = ["DRAGONFLY_MASTER_HOST"];
  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    console.error("❌ Missing required environment variables:");
    missingVars.forEach((v) => console.error(`   - ${v}`));
    console.error("\nRequired variables:");
    console.error("  DRAGONFLY_MASTER_HOST  Redis/Dragonfly host");
    console.error("\nOptional variables:");
    console.error("  DRAGONFLY_PORT         Redis port (default: 6379)");
    console.error("  DRAGONFLY_PASSWORD     Redis password");
    console.error("  PORT                   Server port (default: 80)");
    console.error("  CORS_ORIGIN            CORS origins (default: *)");
    console.error("  MAX_PAYLOAD_SIZE       Max message size (default: 25MB)");
    console.error("  ROOM_CLEANUP_TTL       Room key TTL in seconds (default: 3600)");
    process.exit(1);
  }

  const masterHost = process.env.DRAGONFLY_MASTER_HOST;
  const dragonflyPort = Number(process.env.DRAGONFLY_PORT || 6379);
  const dragonflyPassword = process.env.DRAGONFLY_PASSWORD || "";
  const roomCleanupTtl = Number(process.env.ROOM_CLEANUP_TTL || 3600); // 1 hour default

  console.log(
    `🐉 Connecting both pub/sub clients to Dragonfly master at ${masterHost}:${dragonflyPort}`,
  );

  // --- Shared Redis clients (pub/sub on same node) ---
  pubClient = new Redis({
    host: masterHost,
    port: dragonflyPort,
    password: dragonflyPassword || undefined,
    lazyConnect: true,
    retryStrategy(times) {
      return Math.min(times * 200, 3000);
    },
  });

  subClient = pubClient.duplicate();

  const setupClientLogging = (client: Redis, name: string, isPub = false) => {
    client.on("connect", () => console.log(`✅ ${name} TCP connect`));
    client.on("ready", () => {
      console.log(`✅ ${name} ready`);
      if (isPub) redisUpGauge.set(1);
    });
    client.on("reconnecting", (delay: number) =>
      console.warn(`🔁 ${name} reconnecting in ${delay}ms`),
    );
    client.on("close", () => {
      console.warn(`❌ ${name} connection closed`);
      if (isPub) redisUpGauge.set(0);
    });
    client.on("end", () => {
      console.warn(`❌ ${name} connection ended`);
      if (isPub) redisUpGauge.set(0);
    });
    client.on("error", (err) => {
      console.error(`❌ ${name} error:`, err);
      if (isPub) redisUpGauge.set(0);
    });
  };

  setupClientLogging(pubClient, "Dragonfly Pub Client", true);
  setupClientLogging(subClient, "Dragonfly Sub Client", false);

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    console.log("🚀 Connected to Dragonfly pub/sub successfully!");
  } catch (err) {
    console.warn("Initial Dragonfly connect failed:", err);
  }

  // === Socket.IO setup ===
  const maxPayloadSize = Number(process.env.MAX_PAYLOAD_SIZE) || 25e6; // 25 MB default
  console.log(`📦 Max payload size: ${(maxPayloadSize / 1e6).toFixed(1)} MB`);
  console.log(`🧹 Room cleanup TTL: ${roomCleanupTtl} seconds`);

  const io = new SocketIO(server, {
    transports: ["websocket", "polling"],
    cors: {
      allowedHeaders: ["Content-Type", "Authorization"],
      origin: process.env.CORS_ORIGIN || "*",
      credentials: true,
    },
    allowEIO3: true,
    pingInterval: 25000,
    pingTimeout: 60000,
    maxHttpBufferSize: maxPayloadSize,
  });

  // ✅ Shared adapter (fixes multi-pod sync)
  io.adapter(createAdapter(pubClient, subClient));
  console.log("🔗 Socket.IO Redis adapter initialized and shared across pods.");

  // === Metrics helpers ===
  const updateConnectedSocketsCount = async () => {
    try {
      const sockets = await io.fetchSockets();
      connectedSocketsGauge.set(sockets.length);
    } catch (err) {
      console.error("updateConnectedSocketsCount failed:", err);
    }
  };

  const updateActiveRoomsCount = async () => {
    try {
      const rooms = io.sockets.adapter.rooms;
      const socketIds = new Set(io.sockets.sockets.keys());
      let activeRoomsCount = 0;
      roomUserCountGauge.reset();

      for (const [roomID, sockets] of rooms.entries()) {
        if (socketIds.has(roomID)) continue;
        if (sockets.size === 0) await safeDel(pubClient, `room:${roomID}`);
        else {
          activeRoomsCount++;
          roomUserCountGauge.set({ room: roomID }, sockets.size);
        }
      }
      activeRoomsGauge.set(activeRoomsCount);
    } catch (err) {
      console.error("updateActiveRoomsCount failed:", err);
    }
  };

  // === Socket.IO events ===
  io.on("connection", (socket) => {
    ioDebug("connection established!");
    updateConnectedSocketsCount();

    io.to(socket.id).emit("init-room");

    socket.on("join-room", async (roomID: string) => {
      await socket.join(roomID);
      try {
        await safeSet(
          pubClient,
          `user-room:${socket.id}`,
          roomID,
          roomCleanupTtl,
        );
      } catch (err) {
        console.error("safeSet failed in join-room:", err);
      }

      const sockets = await io.in(roomID).fetchSockets();
      roomUserCountGauge.set({ room: roomID }, sockets.length);
      updateActiveRoomsCount();

      if (sockets.length <= 1) io.to(socket.id).emit("first-in-room");
      else socket.broadcast.to(roomID).emit("new-user", socket.id);

      io.in(roomID).emit(
        "room-user-change",
        sockets.map((s) => s.id),
      );
    });

    socket.on("server-broadcast", (roomID, encryptedData, iv) => {
      const dataSize = encryptedData?.length || 0;
      messageEmitCounter.inc({ event: "server-broadcast" });
      messageSizeHistogram.observe({ event: "server-broadcast" }, dataSize);
      if (dataSize > 1e6) {
        largeMessageCounter.inc({ event: "server-broadcast" });
        console.log(
          `📦 Large broadcast: ${(dataSize / 1e6).toFixed(2)} MB to room ${roomID}`,
        );
      }
      socket.broadcast.to(roomID).emit("client-broadcast", encryptedData, iv);
    });

    socket.on("server-volatile-broadcast", (roomID, encryptedData, iv) => {
      const dataSize = encryptedData?.length || 0;
      messageEmitCounter.inc({ event: "server-volatile-broadcast" });
      messageSizeHistogram.observe(
        { event: "server-volatile-broadcast" },
        dataSize,
      );
      if (dataSize > 1e6) {
        largeMessageCounter.inc({ event: "server-volatile-broadcast" });
        console.log(
          `📦 Large volatile broadcast: ${(dataSize / 1e6).toFixed(2)} MB to room ${roomID}`,
        );
      }
      socket.volatile.broadcast
        .to(roomID)
        .emit("client-broadcast", encryptedData, iv);
    });

    socket.on("user-follow", async (payload: OnUserFollowedPayload) => {
      const roomID = `follow@${payload.userToFollow.socketId}`;
      followEmitCounter.inc({ action: payload.action });
      if (payload.action === "FOLLOW") await socket.join(roomID);
      else await socket.leave(roomID);

      const sockets = await io.in(roomID).fetchSockets();
      io.to(payload.userToFollow.socketId).emit(
        "user-follow-room-change",
        sockets.map((s) => s.id),
      );
    });

    socket.on("disconnecting", async () => {
      try {
        await safeDel(pubClient, `user-room:${socket.id}`);
      } catch (err) {
        console.error("safeDel failed in disconnecting:", err);
      }

      const rooms = Array.from(socket.rooms);
      for (const roomId of rooms) {
        const others = (await io.in(roomId).fetchSockets()).filter(
          (s) => s.id !== socket.id,
        );
        if (others.length === 0) roomUserCountGauge.remove({ room: roomId });
        else roomUserCountGauge.set({ room: roomId }, others.length);

        if (!roomId.startsWith("follow@") && others.length > 0) {
          socket.broadcast.to(roomId).emit(
            "room-user-change",
            others.map((s) => s.id),
          );
        }
      }

      disconnectCounter.inc();
      await updateConnectedSocketsCount();
      await updateActiveRoomsCount();
    });
  });

  server.listen(port, () => serverDebug(`listening on port: ${port}`));

  // === Graceful shutdown ===
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
      console.log("✅ HTTP server closed");
    });

    // Close all socket connections
    try {
      const sockets = await io.fetchSockets();
      console.log(`📡 Disconnecting ${sockets.length} socket(s)...`);
      io.close(() => {
        console.log("✅ Socket.IO closed");
      });
    } catch (err) {
      console.error("Error closing Socket.IO:", err);
    }

    // Close Redis connections
    try {
      await Promise.race([
        Promise.all([pubClient.quit(), subClient.quit()]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Redis quit timeout")), 5000),
        ),
      ]);
      console.log("✅ Redis connections closed");
    } catch (err) {
      console.error("Error closing Redis:", err);
      // Force disconnect if quit times out
      pubClient.disconnect();
      subClient.disconnect();
    }

    console.log("👋 Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // === Metrics endpoint ===
  server.on("request", async (req, res) => {
    if (req.url === "/metrics") {
      try {
        const metrics = await register.metrics();
        res.setHeader("Content-Type", register.contentType);
        res.end(metrics);
      } catch (err) {
        res.statusCode = 500;
        res.end("Error collecting metrics");
        console.error("Metrics fetch error:", err);
      }
    }
  });
}

// === Global error guards ===
process.on("unhandledRejection", (reason) =>
  console.error("Unhandled Rejection:", reason),
);
process.on("uncaughtException", (err) =>
  console.error("Uncaught Exception:", err),
);

main().catch((err) => console.error("Fatal startup error:", err));
