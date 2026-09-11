# Testing and verification

## Version 2 automated browser acceptance

The shipped `test/browser.mjs` runs two independent Chromium contexts and a separate mobile context against a temporary server. It tests live pixels before release, simultaneous overlap, exact eraser/clear undo restoration, room isolation, imports, reconnect, ordinary errors during drawing, delayed acknowledgements, outbound backpressure, failed-save recovery, touch cancellation, pinch, orientation, pen input and worker/full-replay pixel equivalence. It also captures screenshots and raw stress benchmark samples.

Install the optional tool with `npm install --no-save playwright@1.62.1`, then `npx playwright install chromium`, then `npm run test:browser`. For an already installed Chrome/Edge, set `BROWSER_CHANNEL=chrome` or `msedge`. An explicit `PLAYWRIGHT_MODULE` absolute path can point to a preinstalled Playwright `index.mjs`; this is how the generation environment ran the tests without a new dependency download. This option is not needed for a normal local Playwright installation.

Run `node scripts/record-demo.mjs` with the same prerequisite to regenerate the 24-second WebM walkthrough and `evidence/demo.html`. It records a labeled sequence of actual screenshots from two independent sessions, rather than continuous screen capture. The optional tooling does not change the framework-free application or require a browser for `npm test`.

The reliability suite now injects an atomic-rename failure, verifies the previous saved file remains intact, and confirms subsequent recovery. It also checks stable error codes and the eight-command cap. Raw evidence is included in the ZIP; emulation is explicitly distinguished from physical-device validation.

## Automated tests

From the project directory:

```sh
npm install
npm test
```

The Node test runner launches temporary servers on loopback ephemeral ports and removes its own temporary room directories afterward. It does not touch your runtime `data/` folder.

Coverage includes:

- Deterministic overlap order when completion order differs from begin order.
- Cross-user undo/redo, redo invalidation, active-stroke eligibility, and undoable clear.
- Stroke ownership, duplicate IDs, out-of-order and duplicate point batches.
- Input normalization, atomic invalid-batch rejection, batch and stroke point limits.
- Atomic import validation, stale revision rejection, active drawing rejection.
- Disk restoration of completed history and redo, exclusion of unfinished marks.
- Real Socket.IO point delivery to peers **before end**, presence cursor delivery and room isolation.
- Disconnect cancellation, rejoin snapshot, manual resync and persistence across a server restart.
- Invalid room names and preservation of corrupt persisted data.
- HTTP public asset serving and private file exclusion.
- Native render/compositing method contracts for erasers, clear, text and shapes. This test mocks the Canvas context; it is not a pixel screenshot comparison.

## Manual acceptance checks

Use two browser tabs as Alice and Bob in `studio`, and a third in `other-room`.

1. Alice holds a brush stroke and moves slowly. Bob must see it growing **before Alice releases**. The isolated room stays unchanged. User chips show distinct assigned colors for the first eight participants.
2. Draw crossing strokes simultaneously. Compare the completed boards; later-started strokes occupy the upper layer. Repeat with an eraser started after a brush, including continued brush movement after the eraser begins.
3. Bob invokes undo on Alice's latest eligible mark. Both boards change. Redo from Alice restores it. Undo, create a new completed mark, then confirm redo is disabled.
4. Undo an eraser and verify underlying ink returns. Clear, undo clear, and verify the full earlier composition returns.
5. While Alice draws, Bob joins the room in a new tab. Bob should see the active prefix and subsequent points. Move cursors and verify names appear on peer canvases only.
6. Switch Alice's room mid-stroke. That partial stroke disappears in the old room. Each room retains its separate completed history.
7. Use browser developer tools to go offline during a stroke, or stop the server. The board pauses and the connection indicator changes. Restore the connection/server; completed saved marks return and local speculative marks disappear. No duplicate history action should be replayed.
8. Save to server, stop with Ctrl+C, restart, and rejoin. Compare operations and redo state. Sudden force-kill before autosave is deliberately not a durability guarantee.
9. Export JSON, clear, then load the JSON. Both tabs receive the replacement. Try malformed JSON and an invalid document; the current board must survive. Change the room in another tab while selecting a file and confirm stale imports are rejected.
10. Download PNG. It should include completed visible content with a white background and no remote cursors. Export while a stroke is active; only completed marks are included.
11. On a phone, test brush, eraser, all shapes, text, room controls and file actions in portrait and landscape. A single drawing pointer should capture movement without page scrolling inside the canvas; page scrolling outside it remains possible. Canceling a pointer should discard the partial stroke.
12. Verify shortcuts and keyboard focus. Typing in the text/name/room fields must not trigger tool shortcuts or global undo.
13. Near capacity, verify rejection is visible and the user can export and move to a fresh room. Stop moving with a pointer held down for over 40 seconds; the server expires that unfinished stroke.

## Load experiment

Run a disposable server with a separate data directory. The script creates persistent `load-*` rooms, so do not run it against a live shared deployment.

```sh
npm start
# In a second terminal:
npm run test:load -- 20 30
```

Arguments are client count and rounds. `TARGET_URL` can point to another **disposable** server. The script supports 1–1,000 clients, dividing them into rooms of at most 25. Each round creates one short stroke per participant and reports p50/p95 operation acknowledgement time and observed event count. Room history allows at most 60 rounds with 25 users per room; use at most 50 rounds for full rooms to leave headroom. The script accepts higher rounds for smaller client groups, but the normal room capacity still applies.

This is a correctness/traffic probe, not a professional benchmark. It does not render canvases, emulate pointer timings, measure browser FPS or prove 1,000-user capacity. Run it from a separate host for more representative server measurements. Inspect memory, CPU, event-loop delay, bandwidth and disk latency externally. See ARCHITECTURE.md for the scaling model and bottlenecks.

## Validation record

The package includes executable automated tests. The generation session's actual test and smoke results are recorded in `VALIDATION.md`. Manual browser, physical-phone and 1,000-user checks must not be assumed to have run unless explicitly recorded there.
