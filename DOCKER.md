# Rita Room Docker Images

Docker images are automatically built and published to GitHub Container Registry on every release.

## Available Tags

- `ghcr.io/farapholch/rita-room:latest` - Latest release
- `ghcr.io/farapholch/rita-room:1` - Latest v1.x release
- `ghcr.io/farapholch/rita-room:1.1` - Latest v1.1.x release
- `ghcr.io/farapholch/rita-room:1.1.0` - Specific version

## Usage

### Using Docker

```bash
docker pull ghcr.io/farapholch/rita-room:latest

docker run -d \
  -p 3002:80 \
  -e DRAGONFLY_MASTER_HOST=your-dragonfly-host \
  -e DRAGONFLY_PORT=6379 \
  -e DRAGONFLY_PASSWORD=your-password \
  -e CORS_ORIGIN=https://your-domain.com \
  ghcr.io/farapholch/rita-room:latest
```

### Using Docker Compose

```yaml
version: '3.8'

services:
  rita-room:
    image: ghcr.io/farapholch/rita-room:latest
    ports:
      - "3002:80"
    environment:
      - DRAGONFLY_MASTER_HOST=dragonfly
      - DRAGONFLY_PORT=6379
      - DRAGONFLY_PASSWORD=${DRAGONFLY_PASSWORD}
      - CORS_ORIGIN=*
    restart: unless-stopped
```

### Environment Variables

- `DRAGONFLY_MASTER_HOST` - Dragonfly/Redis master host (required)
- `DRAGONFLY_PORT` - Dragonfly/Redis port (default: 6379)
- `DRAGONFLY_PASSWORD` - Dragonfly/Redis password
- `CORS_ORIGIN` - CORS allowed origins (default: *)
- `PORT` - Server port (default: 80)
- `NODE_ENV` - Environment mode (development/production)

## Health Check

The container includes a health check endpoint at `/health` that monitors:
- Redis connection status
- Server uptime
- Overall health status

## Metrics

Prometheus metrics are available at `/metrics` endpoint.
