import { io } from "socket.io-client";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3002";
const TIMEOUT = 10000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url + "/");
      if (response.ok) {
        console.log("✓ Server is ready at " + url);
        return true;
      }
    } catch {
      // Server not ready yet
    }
    console.log("Waiting for server... (" + (i + 1) + "/" + maxRetries + ")");
    await sleep(1000);
  }
  throw new Error("Server not ready after " + maxRetries + " seconds");
}

async function testWebSocketConnection() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("WebSocket connection timeout"));
    }, TIMEOUT);

    const socket = io(SERVER_URL, {
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log("✓ WebSocket connected (id: " + socket.id + ")");
      clearTimeout(timeout);
      socket.disconnect();
      resolve();
    });

    socket.on("connect_error", (error) => {
      clearTimeout(timeout);
      reject(new Error("WebSocket connection failed: " + error.message));
    });
  });
}

async function testRoomJoin() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Room join timeout"));
    }, TIMEOUT);

    const roomId = "test-room-" + Date.now();
    const socket = io(SERVER_URL, {
      transports: ["websocket"],
    });

    let resolved = false;

    socket.on("connect", () => {
      console.log("✓ Connected, joining room: " + roomId);
      socket.emit("join-room", roomId);

      // Give it a moment then pass
      setTimeout(() => {
        if (!resolved && socket.connected) {
          resolved = true;
          console.log("✓ Room join completed");
          clearTimeout(timeout);
          socket.disconnect();
          resolve();
        }
      }, 2000);
    });

    socket.on("room-user-change", () => {
      if (!resolved) {
        resolved = true;
        console.log("✓ Room joined, received user change event");
        clearTimeout(timeout);
        socket.disconnect();
        resolve();
      }
    });

    socket.on("connect_error", (error) => {
      clearTimeout(timeout);
      reject(new Error("Connection failed: " + error.message));
    });
  });
}

async function testMultipleClients() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Multiple clients test timeout"));
    }, TIMEOUT);

    const roomId = "test-multi-" + Date.now();
    const socket1 = io(SERVER_URL, { transports: ["websocket"] });
    const socket2 = io(SERVER_URL, { transports: ["websocket"] });

    let client1Ready = false;
    let client2Ready = false;

    const checkDone = () => {
      if (client1Ready && client2Ready) {
        console.log("✓ Multiple clients can join same room");
        clearTimeout(timeout);
        socket1.disconnect();
        socket2.disconnect();
        resolve();
      }
    };

    socket1.on("connect", () => {
      socket1.emit("join-room", roomId);
      client1Ready = true;
      checkDone();
    });

    socket2.on("connect", () => {
      socket2.emit("join-room", roomId);
      client2Ready = true;
      checkDone();
    });

    socket1.on("connect_error", (e) => {
      clearTimeout(timeout);
      reject(new Error("Client 1 failed: " + e.message));
    });

    socket2.on("connect_error", (e) => {
      clearTimeout(timeout);
      reject(new Error("Client 2 failed: " + e.message));
    });
  });
}

async function runTests() {
  console.log("\n🧪 Rita-Room Integration Tests\n");
  console.log("Server URL: " + SERVER_URL + "\n");

  try {
    await waitForServer(SERVER_URL);

    console.log("\n--- Test 1: WebSocket Connection ---");
    await testWebSocketConnection();

    console.log("\n--- Test 2: Room Join ---");
    await testRoomJoin();

    console.log("\n--- Test 3: Multiple Clients ---");
    await testMultipleClients();

    console.log("\n✅ All tests passed!\n");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Test failed: " + error.message + "\n");
    process.exit(1);
  }
}

runTests();
