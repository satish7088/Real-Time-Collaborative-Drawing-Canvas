# Validation record

Environment: Windows, Node.js v22.14.0, npm 10.9.2. Validation performed during project generation on September 10, 2026.

| Check | Result |
| --- | --- |
| `npm install --no-audit --no-fund` | Passed; 29 packages installed, dependency lockfile generated |
| `npm start` | Passed; server announced ready at `http://localhost:3000` |
| Automated state, rendering and real-socket integration suite | Passed; see `npm test` |
| JavaScript syntax checks | Passed for client, server and load script |
| HTTP health and all client assets | Passed as part of integration suite |
| Save/load and server restart | Passed with temporary on-disk rooms |
| Load probe: 20 clients × 30 rounds | Passed; 600 completed strokes, 36,000 received events |
| Load probe operation acknowledgement p50 / p95 | Approximately 29.6 ms / 51.0 ms on this machine |

The load measurement is local and environment-specific. It measures a complete begin/points/end acknowledgement cycle, not drawing paint latency or internet conditions. It does not certify 1,000-user capacity.

Browser visual inspection, screenshot comparison, physical mobile testing and a 1,000-client run were **not performed**. The manual acceptance checklist is provided in `TESTING.md`. The rendering test checks native Canvas API/compositing calls using a mock context, not actual pixels. The reconnect test exercises the shipped connection wrapper with real Socket.IO transport and an EventTarget-compatible Node environment.
