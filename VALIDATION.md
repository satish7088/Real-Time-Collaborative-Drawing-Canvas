# FlamAI Pro 2.0 — validation record

Environment: Windows, Node.js 22.14.0, npm 10.9.2, headless Chrome 152.0.7977.83, Playwright 1.62.1 (preinstalled).

## Results

- **15 Node unit/integration tests passed**, including real WebSocket streaming, room isolation, ownership, restart recovery, error codes, failed-write recovery and acknowledgement limits.
- **21 browser acceptance checks passed** in independent desktop contexts plus a mobile context.
- Exact canvas pixels agree across collaborating sessions after concurrent strokes, eraser undo, clear undo, imports and recovery.
- Worker/checkpoint output matches a full main-thread replay pixel-for-pixel near room capacity.
- Native Chromium touch cancellation and pinch paths passed; orientation resize and emulated pen input passed.
- Server outbound overflow was injected at the socket buffer boundary; the peer reconnected and converged.
- Browser save-failure feedback and retry recovery passed with an injected filesystem rename failure.
- Browser JavaScript errors: **none**.
- Normal installation and Node test suite passed. Optional Playwright tooling is separate from application dependencies.

## Final browser stress measurements

| Workload | Median | p95 |
| --- | ---: | ---: |
| 12 active overlapping strokes / 48,000 points | 353.5 ms | 399.3 ms |
| Undo at 1,490 operations / 119,200 points | 218.0 ms | 328.5 ms |

These values include worker raster completion and delivery to the main thread. A 16 ms main-thread probe ticked 587 times during the workload; its largest observed gap was **89.9 ms**. This is evidence of continuing UI-thread activity, not a guarantee of perfect responsiveness. Raster work remains expensive and these stress scenes do not render at 60 FPS. CPU/GPU, headless execution, readback, structured cloning and other machine load affect results.

Final run: **2026-09-10T17:58:43.834Z → 2026-09-10T17:59:13.212Z** (29.4 seconds). Full samples: [browser-results.json](evidence/browser-results.json). Earlier diagnostic methods are retained separately and are **not directly comparable speed benchmarks**; see UPGRADE.md.

## Evidence

- [Desktop studio](evidence/pro-studio-desktop.png)
- [Two-user session A](evidence/01-two-user-studio.png) and [session B](evidence/02-peer-studio.png)
- [Mobile layout](evidence/03-mobile-studio.png)
- [Final tested board](evidence/04-final-studio.png)
- [Two-user walkthrough](evidence/demo.html), with [WebM video](evidence/two-user-demo.webm)

The 24-second video is a labeled sequence of real screenshots taken from two independent sessions. It shows live-before-release drawing and cross-user history actions; it is not continuous screen capture.

Physical mobile/stylus devices, Safari, Firefox and a 1,000-user run remain **unverified**. An earlier v1 server probe used 20 clients and 600 operations successfully; it is not a new v2 capacity certification. Public deployment still needs authentication and operational safeguards described in ARCHITECTURE.md.
