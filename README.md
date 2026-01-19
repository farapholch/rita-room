# Rita Room - Real-time Collaboration Server

A high-performance WebSocket server for real-time collaboration, powered by Socket.IO and Dragonfly/Redis. Designed as a scalable backend for collaborative drawing and editing applications like Excalidraw.

## Features

- **Real-time Collaboration**: WebSocket-based communication for instant synchronization across users
- **Redis/Dragonfly Backend**: Distributed state management with pub/sub messaging
- **Multi-Pod Ready**: Horizontal scaling with Redis adapter for cross-pod communication
- **Health & Metrics**: Built-in health checks and Prometheus metrics endpoints
- **Production Optimized**: Includes reconnection logic, error handling, and performance monitoring
- **Room Management**: Dynamic room creation with automatic cleanup and user tracking

## Quick Start

```bash
docker run -d \
  -p 3002:80 \
  -e DRAGONFLY_MASTER_HOST=your-redis-host \
  -e DRAGONFLY_PORT=6379 \
  -e CORS_ORIGIN=https://your-domain.com \
  farapholch/rita-room:latest
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DRAGONFLY_MASTER_HOST` | Redis/Dragonfly host (required) | - |
| `DRAGONFLY_PORT` | Redis/Dragonfly port | 6379 |
| `DRAGONFLY_PASSWORD` | Redis/Dragonfly password | - |
| `CORS_ORIGIN` | CORS allowed origins | * |
| `PORT` | Server listening port | 80 |
| `NODE_ENV` | Environment mode | production |

## Docker Compose Example

```yaml
version: '3.8'

services:
  dragonfly:
    image: docker.dragonflydb.io/dragonflydb/dragonfly
    ports:
      - "6379:6379"
    
  rita-room:
    image: farapholch/rita-room:latest
    ports:
      - "3002:80"
    environment:
      - DRAGONFLY_MASTER_HOST=dragonfly
      - DRAGONFLY_PORT=6379
      - CORS_ORIGIN=*
    depends_on:
      - dragonfly
```

## Endpoints

- **GET /** - Server status
- **GET /health** - Health check with Redis connection status
- **GET /metrics** - Prometheus metrics
- **WebSocket** - Socket.IO connection for real-time collaboration

## Technology Stack

- **Node.js** - Runtime environment
- **Socket.IO** - WebSocket library with fallback support
- **Redis/Dragonfly** - In-memory data store and pub/sub
- **Express** - HTTP server
- **Prometheus** - Metrics and monitoring
- **TypeScript** - Type-safe development

## Use Cases

- Collaborative drawing and whiteboarding
- Real-time document editing
- Multi-user game servers
- Live collaboration tools
- Interactive presentations

## Repository & Documentation

- GitHub: https://github.com/farapholch/rita-room
- Issues: https://github.com/farapholch/rita-room/issues
- License: MIT

## Monitoring

Monitor your deployment with built-in metrics:
- Connected sockets count
- Active rooms and user distribution
- Message emit rates
- Redis connection status
- Server uptime and health

Access metrics at `http://your-server:3002/metrics`

---

Built with ❤️ for real-time collaboration
