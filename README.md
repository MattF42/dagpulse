# DAGPulse

**See the fastest BlockDAG. Live.**

DAGPulse is a real-time BlockDAG visualization dashboard for [HTND](https://github.com/HoosatNetwork/HTND) — the Hoosat Network's GhostDAG node. It connects **directly to your local HTND node via gRPC** and visualises the directed acyclic graph as blocks arrive at ~5 per second.

> HTND is a fork of [Kaspa](https://kaspa.org) and uses the same GhostDAG consensus algorithm and gRPC API, so DAGPulse is compatible with any kaspanet/kaspad-compatible node.

## Features

- **Live BlockDAG Visualization** — Canvas-based animated DAG with real HTND blocks arriving in real-time; Bezier-curve edges connect parent blocks
- **Real-time block streaming** — Subscribes to the node's `NotifyBlockAdded` gRPC stream (no polling); handles ≥ 5 BPS with zero dropped blocks
- **Real-time Network Stats** — Blocks per second, transactions per second, hashrate, DAA score — all live from your local node
- **Block Inspector** — Click any block to see hash, blue score, DAA score, timestamp, transaction count, parent count, and GHOSTDAG classification
- **Interactive Canvas** — Zoom (scroll wheel), pan (click-drag), auto-follow mode that tracks the DAG tip
- **Speed Benchmark** — Live comparison showing HTND's confirmation speed vs Ethereum and Bitcoin
- **Responsive Design** — Works on desktop, tablet, and mobile
- **Mock fallback** — If the node is unreachable the app falls back to simulated data so you can still explore the UI

## How It Works

DAGPulse connects to the HTND gRPC endpoint and uses a long-lived **server-streaming** subscription (`NotifyBlockAdded`) to receive every new block the moment it is added to the DAG. The gRPC-web protocol makes this possible from a browser without any plugin.

```
┌─────────────────────────────────────────────────┐
│  DAGPulse (Svelte SPA)                          │
│  ┌──────────┐  ┌──────────────────────────────┐ │
│  │Stats     │  │  DAG Canvas                  │ │
│  │Panel     │  │  ○──○──○                     │ │
│  │          │  │ /    \ /                     │ │
│  │BPS: 5    │  │○──────○──○                   │ │
│  │Score:... │  │       \ /                    │ │
│  └──────────┘  │        ○                     │ │
│                └──────────────────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │ gRPC-web (streaming)
                   ▼
        ┌──────────────────────┐
        │ grpcwebproxy :4242   │  gRPC-web ↔ gRPC bridge
        └──────────┬───────────┘
                   │ gRPC / HTTP2
                   ▼
        ┌──────────────────────┐
        │ HTND node :42420     │  local node
        └──────────────────────┘
```

## Tech Stack

- **Frontend**: [Svelte 5](https://svelte.dev) + [Vite](https://vite.dev) + TypeScript
- **Styling**: [TailwindCSS 4](https://tailwindcss.com)
- **Rendering**: HTML5 Canvas API (60fps render loop)
- **RPC**: gRPC-web over HTTP/1.1 using the browser Fetch API + [protobufjs](https://protobufjs.github.io/protobuf.js/)
- **Proto**: `protowire.RPC.MessageStream` — the canonical Kaspa/HTND gRPC service

## Getting Started

### Prerequisites

1. A running **HTND node** with gRPC enabled (default port `42420`).
2. **grpcwebproxy** — translates browser gRPC-web requests into the gRPC/HTTP2 protocol HTND speaks:

```bash
# Install (requires Go ≥ 1.21)
go install github.com/improbable-eng/grpc-web/go/grpcwebproxy@latest

# Run alongside HTND
grpcwebproxy \
  --backend_addr=localhost:42420 \
  --allow_all_origins \
  --run_tls_server=false \
  --server_http_debug_port=4242
```

### Development

```bash
git clone https://github.com/MattF42/dagpulse.git
cd dagpulse

# Install dependencies
npm install

# (Optional) copy the example env and customise
cp .env.example .env

# Start the dev server – it proxies /protowire.RPC/* to grpcwebproxy
npm run dev
```

The app will be available at `http://localhost:5173/dagpulse/`.

By default the Vite dev-server proxies gRPC-web requests to `http://localhost:42420`.
If you are running grpcwebproxy on a different port, set `VITE_RPC_HOST` in `.env`:

```
VITE_RPC_HOST=http://localhost:4242
```

### Build for production

```bash
npm run build
# Output in dist/
```

## Public Deployment with nginx

DAGPulse can be made publicly accessible using nginx as a reverse proxy.  
nginx terminates TLS, serves the static SPA, and forwards gRPC-web API calls to grpcwebproxy.

```
Internet (HTTPS)
    │
    ▼
nginx :443
  ├── /dagpulse/         → dist/ (static SPA)
  └── /protowire.RPC/    → grpcwebproxy :4242 → HTND :42420
```

### Option A — docker compose (recommended)

```bash
# 1. Build the app (VITE_RPC_HOST left empty = same-origin, nginx handles routing)
npm run build

# 2. Edit nginx/nginx.conf:
#    - Replace `your-domain.example.com` with your real domain
#    - Put TLS certs in nginx/certs/

# 3. Start everything
docker compose up -d
```

### Option B — manual nginx

```bash
# 1. Build and copy dist/ to /var/www/dagpulse
npm run build
sudo cp -r dist/* /var/www/dagpulse/

# 2. Copy and adapt the nginx config
sudo cp nginx/nginx.conf /etc/nginx/conf.d/dagpulse.conf
# Edit server_name and ssl_certificate paths, then:
sudo nginx -t && sudo systemctl reload nginx

# 3. Run grpcwebproxy (keep running as a service)
grpcwebproxy \
  --backend_addr=localhost:42420 \
  --allow_all_origins \
  --run_tls_server=false \
  --server_http_debug_port=4242
```

See [`nginx/nginx.conf`](./nginx/nginx.conf) for the full annotated configuration.

## Project Structure

```
src/
├── App.svelte                    # Root layout + client wiring
├── main.ts                       # Entry point
├── app.css                       # Tailwind + theme variables + animations
├── lib/
│   ├── kaspa/
│   │   ├── client.ts             # gRPC client: streaming + stats + block detail
│   │   ├── grpc-transport.ts     # Minimal gRPC-web transport (fetch + frame parser)
│   │   ├── kaspa-proto.ts        # Inline protobuf descriptor for Kaspa/HTND messages
│   │   ├── types.ts              # TypeScript interfaces
│   │   └── mock.ts               # Mock data generator (fallback)
│   ├── dag/
│   │   ├── renderer.ts           # Canvas DAG renderer (blocks, edges, glow)
│   │   ├── layout.ts             # Column-based layout algorithm
│   │   └── interaction.ts        # Pan/zoom state machine
│   └── stats/
│       └── engine.ts             # Formatters and utilities
├── components/
│   ├── DagCanvas.svelte
│   ├── StatsPanel.svelte
│   ├── BlockInspector.svelte
│   ├── SpeedBenchmark.svelte
│   ├── Header.svelte
│   └── ConnectionStatus.svelte
└── stores/
    ├── dag.ts                    # Block data + BPS/TPS calculation
    ├── stats.ts                  # Network stats state
    └── ui.ts                     # UI state (selection, connection)

nginx/
├── nginx.conf                    # Production HTTPS nginx configuration
└── nginx-http.conf               # HTTP-only config (testing / behind load-balancer)

docker-compose.yml                # Turnkey deployment: nginx + grpcwebproxy
.env.example                      # Environment variable reference
```

## gRPC Endpoints Used

| Method | KaspadMessage field | Purpose |
|--------|---------------------|---------|
| Subscribe | `notifyBlockAddedRequest` | Real-time block stream (server-push) |
| Unary | `getBlockDagInfoRequest` | DAG tip hashes, virtual DAA score |
| Unary | `getBlockRequest` | Individual block data (initial load + inspector) |
| Unary | `getInfoRequest` | Node version, sync status, mempool size |
| Unary | `estimateNetworkHashesPerSecondRequest` | Network hashrate |

All calls use the single `protowire.RPC.MessageStream` bidirectional stream, wrapped as gRPC-web for browser compatibility.

## License

MIT

