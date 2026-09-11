# WebSocket protocol

## Version 2 extensions (document schema remains version 1)

Error acknowledgements now contain `{ok:false, error, code, resync}`. Stable codes include `VALIDATION`, `NOTHING_TO_UNDO`, `NOTHING_TO_REDO`, `ACTIVE_STROKES`, `STALE_REVISION`, `SEQUENCE_GAP`, and `SAVE_FAILED`. Ordinary errors return `resync:false`. Rejected point/end commands return `resync:true`, because a streamed operation may be incomplete. Client-generated `OFFLINE`, `ACK_TIMEOUT` and `BACKPRESSURE` codes describe transport conditions; uncertain transport is closed and rejoined rather than replaying mutations.

`snapshot` adds `savedSeq` and the recent `activity` list. Operations add a persisted `author` display label. Two broadcasts are added:

- `save:status`: `{room,state,seq,savedSeq,savedAt?}`, with `state` in `unsaved|saving|saved|failed`. Clients compare `savedSeq` to current room revision and also account for active local/remote ink; a saved status for an earlier revision does not mean later changes are saved.
- `activity`: `{actor,action,target,seq,at}` for successful undo, redo, clear and import. The room retains up to 20 entries in memory; activity is not persisted. It is not part of the authoritative mutation sequence.

The client permits at most eight outstanding acknowledgements and 64 KiB ordinary pending command payload. A single import has a 5 MiB allowance. Excess pressure pauses drawing and reconnects. Server outbound guards close a transport at 64 queued Engine.IO packets or over 1 MiB WebSocket buffering. Snapshots remain bounded by document limits. Cursors are suppressed when four or more acknowledged commands are pending.

## Transport

Socket.IO 4.x at `/socket.io/`, configured to use WebSocket only. This is **not** a raw JSON WebSocket endpoint; use a Socket.IO client. The browser client is served at `/socket.io/socket.io.js`. WebSocket-only mode simplifies deployment; a proxy that blocks upgrades will prevent connection rather than fall back to polling.

All command payloads are JSON-serializable. Normal commands return an acknowledgement:

```js
{ ok: true, ...optionalResult }
{ ok: false, error: 'Human-readable reason' }
```

The shipped client uses a 6,000 ms acknowledgement timeout and no automatic command retry. Cursor packets are volatile and have no required ack. For a command without an ack callback, the server emits a `notice` on failure. Errors now include structured codes as described above, alongside readable messages.

## Client → server

| Event | Payload | Success / semantics |
| --- | --- | --- |
| `join` | `{room, name}` | `{ok:true, room}`; installs membership, emits snapshot and presence list; leaves previous room |
| `sync` | `{}` | Cancels caller's uncertain active stroke; emits a fresh snapshot |
| `begin` | `{id, kind, color, width, text?, point:{x,y}}` | Creates an owned active operation at the next drawing order |
| `points` | `{id, batch, points:[{x,y}]}` | Appends a nonempty batch; `batch` starts at 1 and increments exactly once per batch |
| `end` | `{id}` | Completes owned stroke and clears global redo |
| `cancel` | `{id}` | Removes owned active stroke; does not clear redo |
| `undo` | `{}` | Hides latest eligible globally ordered operation |
| `redo` | `{}` | Restores last globally undone operation |
| `cursor` | `{x,y}` or `null` | Volatile room broadcast to other users; null removes cursor |
| `save` | `{}` | `{ok:true,savedAt,seq}` after serialized disk write; rejects while strokes are active |
| `load` | `{document, expectedSeq}` | Atomically replaces board after validation and revision match; no active strokes allowed |
| `ping:app` | `{}` | `{ok:true,time}`; client measures full request/ack round-trip |

`join` and `ping:app` do not require prior membership. Other commands do. Each connection may have one active stroke at a time; another connection cannot append/end/cancel it. Global undo/redo intentionally cross ownership boundaries.

Room names: 1–40 lowercase ASCII letters/digits/hyphens/underscores, beginning with a letter or digit. Names: 1–32 characters after validating a nonempty trimmed value. IDs: 8–80 ASCII alphanumeric/hyphen/underscore characters; unique within current room history. Tools: `brush`, `eraser`, `line`, `rectangle`, `ellipse`, `text`, `clear`. Colors: `#RRGGBB`. Width: finite number in 1–64. Text: nonblank, at most 200 characters for text operations. Points must have finite numeric coordinates and are clamped to 1600 × 1000. Import coordinates use the same normalization.

## Server → client

### `snapshot`

```js
{
  version: 1, width: 1600, height: 1000,
  room: 'studio', seq: 37,
  self: {id: 'socket-id', name: 'Alice', color: '#ef6b45'},
  operations: [/* ordered complete and active operations */],
  redo: ['operation-id']
}
```

Replaces the complete local replica and clears speculative state. `operations` include `id`, `owner`, `order`, `kind`, `color`, `width`, `text`, `points`, `done`, `hidden`, `batch`, and optionally an internal `touched` timestamp. Clients should ignore unrecognized fields.

### `event`

Every accepted room mutation increments `seq` once and broadcasts to all room members, including the sender. Apply in order. Duplicate/old events can be ignored; a gap requires `sync`.

| `type` | Other fields | Meaning |
| --- | --- | --- |
| `begin` | `operation` | Add operation at its server-assigned position |
| `points` | `id,batch,points` | Append points to that operation |
| `end` | `id,redo:[]` | Mark complete; clear redo |
| `cancel` | `id` | Remove active operation |
| `visibility` | `id,hidden,redo` | Undo/redo visibility change plus authoritative redo stack |
| `reset` | `snapshot` | Replace drawing state after import; outer event sequence is authoritative |

The reset's nested snapshot contains drawing state, not user membership. Its `seq` is the same revision as the enclosing event. All clients retain room/user identity when applying reset.

### Other broadcasts

- `users`: array of `{id,name,color}`; complete replacement of the room's online list.
- `cursor`: `{id,point:{x,y}|null}` to peers only. Not part of history or durable sequence.
- `notice`: `{message}` for recoverable errors, including autosave failure.

## Example stroke

```js
socket.emit('begin', {
  id: 'stroke_12345', kind: 'brush', color: '#263c32', width: 5,
  point: {x: 100, y: 100}
}, console.log);
socket.emit('points', {
  id: 'stroke_12345', batch: 1,
  points: [{x: 104, y: 105}, {x: 108, y: 109}]
}, console.log);
socket.emit('end', {id: 'stroke_12345'}, console.log);
```

Messages on a healthy connection remain ordered. The browser does not need to await each batch acknowledgement before sending the next. If a command times out, do not blindly resend global mutations: ask for a snapshot. A failed points command causes the shipped client to cancel/resync its uncertain stroke through `sync`.

## Portable JSON document (version 1)

```json
{"version":1,"width":1600,"height":1000,"operations":[{"kind":"brush","color":"#263c32","width":5,"text":"","points":[{"x":100,"y":100},{"x":120,"y":110}]}]}
```

Exported documents contain completed visible vector operations only. Width/height metadata describes the fixed board; import always interprets points in the fixed 1600 × 1000 space. Unknown metadata is ignored. IDs, owners, redo, visibility and revisions from imported files are not trusted or preserved. Text is plain text. Native shapes use first and last streamed points; intermediate points remain in the operation for a uniform streaming format.

## Resource/error rules

At most 128 points per batch, 4,096 points per operation, 120,000 total room points, 1,500 operations per room, 5 MiB message size. At most 50 participants per room and 100 loaded/loading rooms. Excess packet size is rejected by the transport and may disconnect the client. Application validation failures return an error without partial mutation. Room capacity includes hidden operations.

There is no authentication, durable per-command receipt ledger, offline replay, or cross-process consensus in protocol version 1. Origin checks protect browser access only; native clients without an Origin header are allowed. See the architecture before exposing this server publicly.
