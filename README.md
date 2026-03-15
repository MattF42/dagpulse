# DAGPulse

**See the fastest BlockDAG. Live.**

DAGPulse is a real-time BlockDAG visualization dashboard for [HTND](https://github.com/HoosatNetwork/HTND) — the Hoosat Network's GhostDAG node. It connects to your local HTND node via a **WebSocket bridge** and visualises the directed acyclic graph as blocks arrive at ~5 per second.

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

## Architecture

DAGPulse uses a Python **WebSocket bridge** that holds a persistent native gRPC connection to HTND and fans out live block notifications to all connected browser clients over WebSocket. This design avoids the fundamental limitation of gRPC-web proxies (grpcwebproxy, Envoy), which cannot proxy true bidi-streaming RPCs such as HTND's `RPC.MessageStream`.

```
Browser (WebSocket ws://host/dagpulse/ws)
    ↕
nginx :443  (TLS termination, serves dist/, proxies /dagpulse/ws → bridge)
    ↕
dagpulse bridge  :8765  (Python FastAPI + grpc.aio)
    ↕
HTND :42420  (native gRPC / HTTP2 — never exposed to internet)
```

## Tech Stack

- **Frontend**: [Svelte 5](https://svelte.dev) + [Vite](https://vite.dev) + TypeScript
- **Styling**: [TailwindCSS 4](https://tailwindcss.com)
- **Rendering**: HTML5 Canvas API (60fps render loop)
- **Transport**: WebSocket (browser) → FastAPI bridge → native gRPC (`grpc.aio`)
- **Proto**: `protowire.RPC.MessageStream` — the canonical Kaspa/HTND gRPC service

## Getting Started

### Prerequisites

1. A running **HTND node** with gRPC enabled (default port `42420`).
2. **Python 3.11+** for the bridge server.

### Start the bridge

```bash
cd bridge
pip install -r requirements.txt
python main.py
```

The bridge will connect to HTND at `localhost:42420` and listen for WebSocket connections on port `8765`.

### Development

```bash
git clone https://github.com/MattF42/dagpulse.git
cd dagpulse

# Install frontend dependencies
npm install

# Start the bridge (in a separate terminal)
cd bridge && pip install -r requirements.txt && python main.py

# Start the dev server – it proxies /dagpulse/ws to the bridge on :8765
npm run dev
```

The app will be available at `http://localhost:5173/dagpulse/`.

### Build for production

```bash
npm run build
# Output in dist/
```

## Public Deployment with nginx

DAGPulse can be made publicly accessible using nginx as a reverse proxy.
nginx terminates TLS, serves the static SPA, and forwards WebSocket connections to the bridge.

```
Internet (HTTPS)
    │
    ▼
nginx :443
  ├── /dagpulse/         → dist/ (static SPA)
  └── /dagpulse/ws       → bridge :8765 → HTND :42420
```

### Option A — docker compose (recommended)

```bash
# 1. Build the app
npm run build

# 2. Edit nginx/nginx.conf:
#    - Replace `your-domain.example.com` with your real domain
#    - Put TLS certs in nginx/certs/

# 3. Start everything
docker compose up -d
```

### Option B — manual setup

```bash
# 1. Build and copy dist/ to /var/www/dagpulse
npm run build
sudo cp -r dist/* /var/www/dagpulse/

# 2. Copy and adapt the nginx config
sudo cp nginx/nginx.conf /etc/nginx/conf.d/dagpulse.conf
# Edit server_name and ssl_certificate paths, then:
sudo nginx -t && sudo systemctl reload nginx

# 3. Run the bridge (keep running as a service)
cd bridge
pip install -r requirements.txt
HTND_HOST=localhost HTND_PORT=42420 python main.py
```

See [`nginx/nginx.conf`](./nginx/nginx.conf) for the full annotated configuration.

## Project Structure

```
bridge/
├── main.py               # FastAPI app: /ws WebSocket endpoint + /health REST
├── htnd_client.py        # gRPC client: HtndThread pattern from htn-rest-server
├── requirements.txt      # Python dependencies
├── Dockerfile            # Container build
├── README.md             # Bridge-specific docs
└── htnd/                 # Compiled protobuf stubs (from htn-rest-server)
    ├── __init__.py
    ├── messages_pb2.py
    ├── messages_pb2_grpc.py
    ├── rpc_pb2.py
    └── p2p_pb2.py

src/
├── App.svelte                    # Root layout + client wiring
├── main.ts                       # Entry point
├── app.css                       # Tailwind + theme variables + animations
├── lib/
│   ├── kaspa/
│   │   ├── client.ts             # KaspaClient: WebSocket transport + mock fallback
│   │   ├── ws-transport.ts       # WebSocket transport with reconnect + backoff
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

docker-compose.yml                # Turnkey deployment: nginx + WebSocket bridge
.env.example                      # Environment variable reference
```

## License

MIT

