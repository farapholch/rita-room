import debug from "debug";
import express from "express";
import http from "http";
import { Server as SocketIO } from "socket.io";
import { Gauge, Counter } from "prom-client";

type UserToFollow = {
  socketId: string;
  username: string;
};
type OnUserFollowedPayload = {
  userToFollow: UserToFollow;
  action: "FOLLOW" | "UNFOLLOW";
};

const serverDebug = debug("server");
const ioDebug = debug("io");
const socketDebug = debug("socket");

require("dotenv").config(
  process.env.NODE_ENV !== "development"
    ? { path: ".env.production" }
    : { path: ".env.development" },
);

const app = express();
const port =
  process.env.PORT || (process.env.NODE_ENV !== "development" ? 80 : 3002); // default port to listen

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Excalidraw collaboration server is up :)");
});

const server = http.createServer(app);

server.listen(port, () => {
  serverDebug(`listening on port: ${port}`);
});

// Create Prometheus metrics
const { register } = require('prom-client');

// Socket connected users gauge
const connectedSocketsGauge = new Gauge({
  name: 'socket_io_connected',
  help: 'Number of currently connected sockets',
});

// Socket connections by room gauge
const roomUserCountGauge = new Gauge({
  name: 'socket_io_room_user_count',
  help: 'Number of users in each room',
  labelNames: ['room'], // Room name as a label
});

// Gauge to track the number of active rooms
const activeRoomsGauge = new Gauge({
  name: 'socket_io_active_rooms',
  help: 'Number of currently active rooms with at least one user',
});

// Function to update the active rooms count
const updateActiveRoomsCount = () => {
  const rooms = io.sockets.adapter.rooms; // Get all rooms
  let activeRoomsCount = 0;

  for (const [roomID, sockets] of rooms) {
    // Count only rooms that are NOT socket IDs (default behavior of Socket.IO)
    if (!io.sockets.sockets.has(roomID) && sockets.size > 0) {
      activeRoomsCount++;
    }
  }

  // Update the active rooms gauge
  activeRoomsGauge.set(activeRoomsCount);
};

// Event emit count counters
const messageEmitCounter = new Counter({
  name: 'socket_io_message_emit_count',
  help: 'Total number of message emits from the server',
  labelNames: ['event'], // Event name as a label
});

const followEmitCounter = new Counter({
  name: 'socket_io_follow_emit_count',
  help: 'Total number of follow event emits from the server',
  labelNames: ['action'], // Follow action as a label
});

// Socket disconnections counter
const disconnectCounter = new Counter({
  name: 'socket_io_disconnect_count',
  help: 'Total number of socket disconnections',
});

// Initialize socket.io
try {
  const io = new SocketIO(server, {
    transports: ["websocket", "polling"],
    cors: {
      allowedHeaders: ["Content-Type", "Authorization"],
      origin: process.env.CORS_ORIGIN || "*",
      credentials: true,
    },
    allowEIO3: true,
  });

  io.on("connection", (socket) => {
    ioDebug("connection established!");

    // Increment the connected socket count
    connectedSocketsGauge.inc();

    io.to(`${socket.id}`).emit("init-room");

    socket.on("join-room", async (roomID) => {
      socketDebug(`${socket.id} has joined ${roomID}`);
      await socket.join(roomID);
      const sockets = await io.in(roomID).fetchSockets();
      
      // Track room user count
      roomUserCountGauge.set({ room: roomID }, sockets.length);

      if (sockets.length <= 1) {
        io.to(`${socket.id}`).emit("first-in-room");
      } else {
        socketDebug(`${socket.id} new-user emitted to room ${roomID}`);
        socket.broadcast.to(roomID).emit("new-user", socket.id);
      }

      io.in(roomID).emit(
        "room-user-change",
        sockets.map((socket) => socket.id),
      );
    });

    // Track message emits
    socket.on("server-broadcast", (roomID, encryptedData, iv) => {
      messageEmitCounter.inc({ event: 'server-broadcast' });
      socketDebug(`${socket.id} sends update to ${roomID}`);
      socket.broadcast.to(roomID).emit("client-broadcast", encryptedData, iv);
    });

    socket.on("server-volatile-broadcast", (roomID, encryptedData, iv) => {
      messageEmitCounter.inc({ event: 'server-volatile-broadcast' });
      socketDebug(`${socket.id} sends volatile update to ${roomID}`);
      socket.volatile.broadcast
        .to(roomID)
        .emit("client-broadcast", encryptedData, iv);
    });

    socket.on("user-follow", async (payload: OnUserFollowedPayload) => {
      const roomID = `follow@${payload.userToFollow.socketId}`;

      // Track follow actions
      followEmitCounter.inc({ action: payload.action });

      switch (payload.action) {
        case "FOLLOW": {
          await socket.join(roomID);
          const sockets = await io.in(roomID).fetchSockets();
          const followedBy = sockets.map((socket) => socket.id);

          io.to(payload.userToFollow.socketId).emit(
            "user-follow-room-change",
            followedBy,
          );
          break;
        }
        case "UNFOLLOW": {
          await socket.leave(roomID);
          const sockets = await io.in(roomID).fetchSockets();
          const followedBy = sockets.map((socket) => socket.id);

          io.to(payload.userToFollow.socketId).emit(
            "user-follow-room-change",
            followedBy,
          );
          break;
        }
      }
    });

    socket.on("disconnecting", async () => {
      socketDebug(`${socket.id} has disconnected`);

      // Decrement connected socket count
      connectedSocketsGauge.dec();

      for (const roomID of Array.from(socket.rooms)) {
        const otherClients = (await io.in(roomID).fetchSockets()).filter(
          (_socket) => _socket.id !== socket.id,
        );

        // Update room user count
        roomUserCountGauge.set({ room: roomID }, otherClients.length);

        const isFollowRoom = roomID.startsWith("follow@");

        if (!isFollowRoom && otherClients.length > 0) {
          socket.broadcast.to(roomID).emit(
            "room-user-change",
            otherClients.map((socket) => socket.id),
          );
        }

        if (isFollowRoom && otherClients.length === 0) {
          const socketId = roomID.replace("follow@", "");
          io.to(socketId).emit("broadcast-unfollow");
        }
      }

      // Increment disconnection counter
      disconnectCounter.inc();
    });

    socket.on("disconnect", () => {
      socket.removeAllListeners();
      socket.disconnect();
    });
  });
} catch (error) {
  console.error(error);
}

// Expose Prometheus metrics
server.on('request', async (req, res) => {
  if (req.url === '/metrics') {
    try {
      const metrics = await register.metrics(); // Resolve the promise
      res.setHeader('Content-Type', register.contentType);
      res.end(metrics); // Send the resolved metrics string
    } catch (err) {
      res.statusCode = 500;
      res.end('Error collecting metrics');
      console.error('Error while fetching metrics:', err);
    }
  }
});
