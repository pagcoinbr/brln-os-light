# Development (local)

## Prerequisites
- Go 1.21+
- Node.js 18+

## Quick start
1) Build the UI
```bash
cd ui
npm install
npm run build
```

2) Generate a local TLS cert
```bash
mkdir -p configs/tls
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -subj "/CN=localhost" \
  -keyout configs/tls/server.key \
  -out configs/tls/server.crt
```

3) Run the manager
```bash
go build -o bin/lightningos-manager ./cmd/lightningos-manager
./bin/lightningos-manager --config ./configs/config.yaml
```

By default, the manager binds to `0.0.0.0:8443` so you can access it from another machine on the same LAN. Use your server's LAN IP, for example: `https://192.168.1.10:8443`.
