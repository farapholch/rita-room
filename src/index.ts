import debug from "debug";
import express from "express";
import http from "http";
import { Server as SocketIO } from "socket.io";
import { Gauge, Counter, register } from "prom-client";
import Redis from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import dotenv from "dotenv";

type UserToFollow = {
  socketId: string;
  username: string;
};

type OnUserFollowedPayload = {
  userToFollow: UserToFollow;
  action: "FOLLOW" | "UNFOLLOW";
};

// Load environment variables
dotenv.config(
  process.env.NODE_ENV !== "development"
    ? { path: ".env.production" }
    : { path: ".env.development" },
);

// Debuggers
const serverDebug = debug("server");
const ioDebug = debug("io");
const socketDebug = debug("socket");

// Setup Express
const app = express();
const port =
  process.env.PORT || (process.env.NODE_ENV !== "development" ? 80 : 3002);

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Server för Ritas samarbetsrum är aktiv :)");
});

// Create HTTP server
const server = http.createServer(app);

// Prometheus metrics
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

// Main setup
async function main() {
  const sentinelHosts = process.env.REDIS_SENTINELS?.split(",") || [];
  const sentinels = sentinelHosts.map((hostPort) => {
    const [host, port] = hostPort.split(":");
    return { host, port: parseInt(port, 10) };
  });

  const baseRedis = new Redis({
    sentinels,
    name: process.env.REDIS_MASTER_NAME,
    password: process.env.REDIS_PASSWORD,
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
    reconnectOnError: () => true,
    retryStrategy: (retries) => {
      const delay = Math.min(retries * 100, 3000);
      console.warn(
        `🔁 Redis reconnect attempt #${retries}, retrying in ${delay}ms...`,
      );
      return delay;
    },
    lazyConnect: true,
  });

  baseRedis.on("reconnecting", (attempt: number) => {
    console.log(`🔁 Redis reconnecting... attempt #${attempt}`);
  });

  let hasConnectedInitially = false;

  baseRedis.on("ready", () => {
    if (!hasConnectedInitially) {
      hasConnectedInitially = true;
      console.log("✅🐆 Initial Redis connection established!");
    } else {
      console.log("🔁 Redis has successfully reconnected!");
    }
  });

  const pubClient = baseRedis;
  const subClient = baseRedis.duplicate();

  pubClient.on("error", (err) =>
    console.error("❌ Redis Pub Client Error:", err),
  );
  subClient.on("error", (err) =>
    console.error("❌ Redis Sub Client Error:", err),
  );

  console.log("🔌 Connecting to Redis Sentinel...");
  await Promise.all([pubClient.connect(), subClient.connect()]);
  console.log("✅ Connected to Redis Sentinel");

  const io = new SocketIO(server, {
    transports: ["websocket", "polling"],
    cors: {
      allowedHeaders: ["Content-Type", "Authorization"],
      origin: process.env.CORS_ORIGIN || "*",
      credentials: true,
    },
    allowEIO3: true,
  });

  io.adapter(createAdapter(pubClient, subClient));

  // Helper to update number of connected sockets
  const updateConnectedSocketsCount = async () => {
    const sockets = await io.fetchSockets();
    connectedSocketsGauge.set(sockets.length);
  };

  // Update active room count
  const updateActiveRoomsCount = () => {
    const rooms = io.sockets.adapter.rooms;
    const socketIds = new Set(io.sockets.sockets.keys());
    let activeRoomsCount = 0;

    for (const [roomID, sockets] of rooms.entries()) {
      if (!socketIds.has(roomID) && sockets.size > 0) {
        activeRoomsCount++;
      }
    }

    activeRoomsGauge.set(activeRoomsCount);
  };

  // Socket.IO logic
  io.on("connection", (socket) => {
    ioDebug("connection established!");
    updateConnectedSocketsCount();

    let currentRoomId: string | null = null;

    io.to(socket.id).emit("init-room");

    socket.on("join-room", async (roomID) => {
      currentRoomId = roomID;
      socketDebug(`${socket.id} has joined ${roomID}`);
      await socket.join(roomID);

      const redisKey = `user-room:${socket.id}`;
      await baseRedis.set(redisKey, roomID);

      const sockets = await io.in(roomID).fetchSockets();
      roomUserCountGauge.set({ room: roomID }, sockets.length);
      updateActiveRoomsCount();

      if (sockets.length <= 1) {
        io.to(socket.id).emit("first-in-room");
      } else {
        socket.broadcast.to(roomID).emit("new-user", socket.id);
      }

      io.in(roomID).emit(
        "room-user-change",
        sockets.map((s) => s.id),
      );
    });

    socket.on("reconnect", async () => {
      const redisKey = `user-room:${socket.id}`;
      const previousRoom = await baseRedis.get(redisKey);

      if (previousRoom) {
        await socket.join(previousRoom);
        socket.emit("reconnect-room", previousRoom);
      }
    });

    socket.on("server-broadcast", (roomID, encryptedData, iv) => {
      messageEmitCounter.inc({ event: "server-broadcast" });
      socketDebug(`${socket.id} sends update to ${roomID}`);
      socket.broadcast.to(roomID).emit("client-broadcast", encryptedData, iv);
    });

    socket.on("server-volatile-broadcast", (roomID, encryptedData, iv) => {
      messageEmitCounter.inc({ event: "server-volatile-broadcast" });
      socketDebug(`${socket.id} sends volatile update to ${roomID}`);
      socket.volatile.broadcast
        .to(roomID)
        .emit("client-broadcast", encryptedData, iv);
    });

    socket.on("user-follow", async (payload: OnUserFollowedPayload) => {
      const roomID = `follow@${payload.userToFollow.socketId}`;
      followEmitCounter.inc({ action: payload.action });

      switch (payload.action) {
        case "FOLLOW":
          await socket.join(roomID);
          break;
        case "UNFOLLOW":
          await socket.leave(roomID);
          break;
      }

      const sockets = await io.in(roomID).fetchSockets();
      const followedBy = sockets.map((s) => s.id);
      io.to(payload.userToFollow.socketId).emit(
        "user-follow-room-change",
        followedBy,
      );
    });

    socket.on("disconnecting", async () => {
      const redisKey = `user-room:${socket.id}`;
      await baseRedis.del(redisKey);

      const rooms = Array.from(socket.rooms) as string[];

      for (const roomId of rooms) {
        const otherClients = (await io.in(roomId).fetchSockets()).filter(
          (_socket) => _socket.id !== socket.id,
        );

        roomUserCountGauge.set({ room: roomId }, otherClients.length);

        if (otherClients.length === 0) {
          roomUserCountGauge.remove({ room: roomId });
        } else {
          roomUserCountGauge.set({ room: roomId }, otherClients.length);
        }

        updateActiveRoomsCount();

        const isFollowRoom = roomId.startsWith("follow@");

        if (!isFollowRoom && otherClients.length > 0) {
          socket.broadcast.to(roomId).emit(
            "room-user-change",
            otherClients.map((s) => s.id),
          );
        }

        if (isFollowRoom && otherClients.length === 0) {
          const socketId = roomId.replace("follow@", "");
          io.to(socketId).emit("broadcast-unfollow");
        }
      }

      disconnectCounter.inc();
      await updateConnectedSocketsCount();
    });

    socket.on("disconnect", () => {
      socket.removeAllListeners();
    });
  });

  server.listen(port, () => {
    serverDebug(`listening on port: ${port}`);
  });
}

// Start server
main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

// Prometheus metrics endpoint
server.on("request", async (req, res) => {
  if (req.url === "/metrics") {
    try {
      const metrics = await register.metrics();
      res.setHeader("Content-Type", register.contentType);
      res.end(metrics);
    } catch (err) {
      res.statusCode = 500;
      res.end("Error collecting metrics");
      console.error("Error while fetching metrics:", err);
    }
  }
});
