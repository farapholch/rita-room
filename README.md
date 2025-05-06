# Excalidraw collaboration server with metrics from socket.io

This is collaboration server for Excalidraw with metrics support from socket io and prom client with updated packages. Also built for support for Redis with Sentinel failover.

If you need to use cluster mode with pm2. Checkout: https://socket.io/docs/v4/pm2/

If you are not familiar with pm2: https://pm2.keymetrics.io/docs/usage/quick-start/

# Development

- install

  ```sh
  yarn
  ```

- run development server

  ```sh
  yarn start:dev
  ```

# Start with pm2

```
pm2 start pm2.production.json
```
