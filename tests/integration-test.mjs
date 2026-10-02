import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3002";
const TIMEOUT = 10000;
const clients = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, receive);
      reject(new Error(`Timed out waiting for ${name}`));
    }, TIMEOUT);
    const receive = (...args) => {
      clearTimeout(timer);
      resolve(args);
    };
    socket.once(name, receive);
  });
}

async function connect() {
  const socket = io(SERVER_URL, {
    transports: ["websocket"],
    autoConnect: false,
    reconnection: false,
  });
  clients.push(socket);
  const connected = event(socket, "connect");
  socket.connect();
  await connected;
  return socket;
}

async function join(socket, room) {
  const joined = event(socket, "room-user-change");
  socket.emit("join-room", room);
  const [members] = await joined;
  assert.ok(members.includes(socket.id));
  return members;
}

async function runTests() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if ((await fetch(`${SERVER_URL}/health`)).ok) break;
    } catch {
      // Server may still be starting.
    }
    await sleep(1000);
  }
  const health = await fetch(`${SERVER_URL}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).redis.connected, true);
  console.log("✓ Health endpoint");

  // Repeated scrapes catch duplicate HTTP handlers / headers already sent.
  for (let i = 0; i < 3; i++) {
    const metrics = await fetch(`${SERVER_URL}/metrics`);
    assert.equal(metrics.status, 200);
    assert.match(metrics.headers.get("content-type"), /text\/plain/);
    assert.match(await metrics.text(), /socket_io_connected/);
  }
  console.log("✓ Prometheus metrics");

  const first = await connect();
  const second = await connect();
  const outsider = await connect();
  const room = `test-${randomUUID()}`;
  const firstInRoom = event(first, "first-in-room");
  assert.deepEqual(await join(first, room), [first.id]);
  await firstInRoom;
  const newUser = event(first, "new-user");
  assert.deepEqual(
    (await join(second, room)).sort(),
    [first.id, second.id].sort(),
  );
  assert.deepEqual(await newUser, [second.id]);
  console.log("✓ Room membership and peer notification");

  const received = [];
  const outsideReceived = [];
  second.on("client-broadcast", (...args) => received.push(args));
  outsider.on("client-broadcast", (...args) => outsideReceived.push(args));
  const payload = Buffer.from([1, 2, 3, 4]);
  const iv = Buffer.alloc(12, 7);
  for (const name of ["server-broadcast", "server-volatile-broadcast"]) {
    const delivered = event(second, "client-broadcast");
    first.emit(name, room, payload, iv);
    const [data, deliveredIv] = await delivered;
    assert.deepEqual(Buffer.from(data), payload);
    assert.deepEqual(Buffer.from(deliveredIv), iv);
  }
  assert.equal(received.length, 2);
  console.log("✓ Encrypted normal and volatile relay");

  outsider.emit("server-broadcast", room, payload, iv);
  outsider.emit("server-volatile-broadcast", room, payload, iv);
  outsider.emit("join-room", null);
  outsider.emit("join-room", { invalid: true });
  outsider.emit("join-room", "");
  outsider.emit("join-room", `follow@${first.id}`);
  outsider.emit("join-room", first.id);
  await sleep(500);
  assert.equal(received.length, 2, "Non-member must not broadcast to room");
  first.emit("server-broadcast", `follow@${first.id}`, payload, iv);
  first.emit("server-broadcast", first.id, payload, iv);
  const validDelivery = event(second, "client-broadcast");
  first.emit("server-broadcast", room, payload, iv);
  await validDelivery;
  await sleep(100);
  assert.equal(outsideReceived.length, 0, "Invalid joins must not expose data");
  const survivor = await connect();
  await join(survivor, `test-${randomUUID()}`);
  console.log("✓ Room isolation, invalid joins, server stays responsive");

  const remainingMembers = event(first, "room-user-change");
  second.disconnect();
  assert.deepEqual(await remainingMembers, [[first.id]]);
  console.log("✓ Disconnect updates room membership");
}

try {
  await runTests();
  console.log("✅ All integration tests passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clients.forEach((socket) => socket.disconnect());
}
