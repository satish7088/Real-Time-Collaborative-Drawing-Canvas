# FlamAI Pro · Real-Time Collaborative Canvas

A complete drawing application built with **vanilla JavaScript, HTML5 Canvas, Node.js and Socket.IO**. No frontend framework, bundler, drawing library, external font, or hosted service is required. All assets are served by the Node server.

**Version 2** adds a redesigned studio, automated browser tests, structured error recovery, bounded network traffic, adaptive OffscreenCanvas rendering, raster checkpoints, zoom/pan/pinch, activity attribution and revision-aware save feedback. Read [UPGRADE.md](UPGRADE.md) for the changes and measurements. Open [evidence/demo.html](evidence/demo.html) for a 24-second labeled replay of real screenshots from two independent browser sessions.

**New controls:** Pan moves the view; +/− and pinch zoom from 100–400%; Fit resets the view; Grid toggles guides; Focus hides secondary desktop panels. These view changes do not affect exported artwork. The history panel identifies the next undoable mark and shows who performed shared actions. Save status shows unsaved, saving, saved and failed states with revisions.

**Browser tests (optional tooling):** install `playwright@1.62.1` with `npm install --no-save playwright@1.62.1`, then run `npx playwright install chromium` and `npm run test:browser`. Set `BROWSER_CHANNEL=chrome` or `msedge` to use an installed browser instead. Run `node scripts/record-demo.mjs` to regenerate the demo. Playwright is a test tool, not an application dependency; normal startup and `npm test` need no browser tooling. Screenshots, raw measurements and the WebM demo are in `evidence/`.

## Quick start

Install Node.js 20 or newer (Node 22 recommended). Extract this ZIP and open a terminal in `flamai-canvas`:

```sh
npm install
npm start
```

Open **http://localhost:3000**. Open another tab or browser, enter a different name, and use the same room to collaborate. In shells supporting `&&`, the equivalent is `npm install && npm start`. Windows PowerShell 5 users should run the two commands separately.

The server listens on all interfaces. For phones on your local network, visit `http://YOUR_COMPUTER_LAN_IP:3000`; allow the port through your local firewall if needed. A shared localhost link only works on the same computer. Use your LAN address or deployed domain when sharing with others. Clipboard access may be unavailable on plain LAN HTTP; copy the address bar manually. Use HTTPS/WSS for internet deployment.

## Features

| Area | Implemented behavior |
| --- | --- |
| Drawing | Smooth brush, true eraser, palette/custom colors, 1–64 px widths |
| Shapes and text | Live line, rectangle and ellipse previews; text placement, up to 200 characters |
| Collaboration | Points stream while the pointer is down; immediate local prediction |
| Presence | Named online users, assigned identity colors, transient labeled remote cursors |
| History | Room-global undo/redo, including erasing and clearing |
| Rooms | URL-based rooms, join/switch, copy room link, isolated histories |
| Persistence | Automatic disk snapshots, explicit save acknowledgement, restart recovery |
| Portable files | Export/load vector JSON, PNG download with white background |
| Devices | Pointer Events, mouse/pen/touch, coalesced events, pointer capture, responsive controls |
| Recovery | Reconnect with backoff, fresh snapshots, sequence-gap detection, abandoned stroke cleanup |
| Observability | Displayed animation-loop FPS, application round-trip latency and mark count |

Identity colors indicate who is present; drawing colors remain independently selectable. Colors repeat after the eight-color presence palette is exhausted. Each tab is a separate participant.

## Controls

- **B** brush, **E** eraser, **L** line, **R** rectangle, **O** ellipse, **T** text.
- Drag to draw. Text is entered in the toolbar, then placed with a tap. Its font size is `max(14, width × 3)` canvas pixels.
- **Ctrl/Command + Z**: undo the latest visible completed operation in the room's drawing order, even if someone else drew it.
- **Ctrl/Command + Shift + Z**, or **Ctrl/Command + Y**: redo.
- **Escape**: cancel your current stroke.
- Clear creates an undoable operation. Load JSON replaces the room and its undo history after a confirmation; export a backup first.
- Keyboard shortcuts are ignored while editing text fields. Controls have labels, focus indicators and selected states. The freehand canvas itself requires a pointer; this is not a fully keyboard-accessible drawing editor.

## Save/load behavior

Completed operations and undo/redo state autosave within approximately 800 ms of a history change. **Save to server** waits for a disk write and reports its revision. Active strokes are never persisted; explicit save asks users to finish drawing first. JSON export includes completed visible operations, excluding undone history and in-flight marks. Loading validates the whole file before replacing anything and rejects a stale revision or an active stroke. Import is shared and is not undoable.

Rooms reload from `data/<room>.json` when first joined after restart. Writes use a temporary file and atomic rename; per-room writes are serialized. Corrupt saved files are preserved and that room refuses to load. Back up or repair the file, or use another room. Autosave failures show a visible notice; use JSON export as a backup. Files are not a database: sudden power loss may lose the most recent snapshot, and no `fsync` durability guarantee is claimed.

## Project layout

```text
flamai-canvas/
├── client/
│   ├── index.html             # Accessible controls and canvas layers
│   ├── style.css              # Responsive studio interface
│   ├── canvas.js              # Pointer input, prediction, rendering and exports
│   ├── websocket.js           # Socket transport and reconnection lifecycle
│   └── main.js                # UI bindings and replica sequencing
├── server/
│   ├── server.js              # HTTP assets, Socket.IO handlers, validation/rate gate
│   ├── rooms.js               # Room lifecycle and serialized atomic persistence
│   └── drawing-state.js       # Authoritative ordered operations and undo/redo
├── test/
│   ├── state.test.js
│   ├── render.test.js
│   └── integration.test.js
├── scripts/load-test.js       # Optional disposable-room traffic generator
├── package.json
├── package-lock.json
├── README.md
├── ARCHITECTURE.md
├── PROTOCOL.md
└── TESTING.md
```

`data/` is created at runtime. Dependencies, runtime room data and temporary test files are intentionally excluded from the ZIP.

## Configuration

Environment variables are optional. The app does not read `.env` automatically.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket listen port |
| `DATA_DIR` | Project's `data/` directory | Writable persistent room storage |
| `ALLOWED_ORIGIN` | Same host as request | Exact allowed browser origin behind a reverse proxy, e.g. `https://draw.example.com` |
| `TARGET_URL` | `http://localhost:3000` | Only for the optional load script |

PowerShell example: `$env:PORT = '3001'`, then `npm start`. POSIX shell example: `PORT=3001 npm start`. Keep a persistent volume mounted at `DATA_DIR` in containers. Proxy WebSocket upgrades to the same Node process; do not serve the application as a static-only site.

## Tests

```sh
npm test
```

Tests use Node's built-in runner, real Socket.IO connections on ephemeral ports, and temporary storage. No running application is needed. See **TESTING.md** for coverage, reproducible multi-user/manual checks, and load testing. `npm run dev` enables Node's development file watcher.

## Limits and known tradeoffs

- This is a complete single-process assignment implementation, not an authenticated production service. Anyone who knows a room name can enter, undo, clear, save, or replace it. Room names are not secrets. There are no accounts, roles, audit identities or permissions.
- Up to 50 people per room and 100 loaded/loading rooms; idle empty rooms are saved and evicted after about five minutes. Saved files are not automatically deleted or globally disk-quota managed.
- Up to 1,500 operations, 4,096 points per operation and 120,000 points per room, including hidden history. Export and use a new room at capacity. No automatic history compaction because it would remove global undo semantics.
- Drawing pauses offline. An unfinished disconnected, canceled, timed-out, or uncertain stroke is discarded; completed acknowledged state is recovered from the server. No offline editing or exactly-once delivery guarantee is claimed.
- The fixed logical board is 1600 × 1000, with view-only pan/zoom. There is no infinite canvas, selection, object editing, pressure response or image upload. Mobile/pen tests use Chromium emulation; physical devices remain unverified.
- Stable prefixes and bounded checkpoints are cached. Heavy boards use a worker where supported, with a main-thread fallback. Extreme scenes still have substantial raster latency; see measured results. A worker improves responsiveness, not the amount of raster work. FPS is animation-loop rate; latency is round-trip time.
- Logical drawing state converges. Font rasterization and edge anti-aliasing may vary across operating systems; pixel-identical screenshots are not guaranteed.
- The token bucket and payload limits are basic application safeguards, not comprehensive abuse protection. There is no aggregate/IP connection limiter or room creation quota on disk. Put authentication, network limits, TLS and monitoring in front of any public deployment.
- One Node writer owns a room. Do not run multiple servers against the same data directory. A Redis broadcast adapter alone would not make state mutation distributed-safe.
- 1,000 concurrent users is a documented scaling target, not a capacity certification. See the architecture's explicit scaling plan and load-test caveats.

## Time spent

This AI-assisted session included an interruption for an account usage limit. **TIME-SPENT.md** records the measured review/optimization segment and exact browser run timestamps, separately from earlier untracked work. It does not invent human developer hours. Add your own personal review/modification hours if your evaluator requires them.

## Technical documentation

Read **ARCHITECTURE.md** for data flow, ordering, caching, consistency and scaling; **PROTOCOL.md** for every event and error contract. The dependency lockfile fixes the tested dependency tree. Socket.IO handles transport ordering, not durable application state; the application supplies its own snapshot recovery. Reference: [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/) and [offline behavior](https://socket.io/docs/v4/client-offline-behavior/).
