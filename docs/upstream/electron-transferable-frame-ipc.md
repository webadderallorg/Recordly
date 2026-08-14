# Electron transferable ArrayBuffer renderer-to-main IPC

Status: benchmark and narrow upstream proposal. This document is intentionally not a
Recordly product or frame-pipeline design.

## Reproducer

Run from the repository root:

```text
node scripts/benchmark-native-frame-transport.mjs
```

The default run sends four payloads per route at each size, with two unacknowledged
payloads allowed at once:

```text
RECORDLY_IPC_BENCH_ITERATIONS=4
RECORDLY_IPC_BENCH_WINDOW=2
RECORDLY_IPC_BENCH_TIMEOUT_MS=120000
```

The script always exercises 1 MiB and 33 MiB payloads. `RECORDLY_IPC_BENCH_ITERATIONS`
and `RECORDLY_IPC_BENCH_WINDOW` can be lowered for a quick smoke run. The fixture is
created under the operating system temporary directory, sets Electron `userData` and
`sessionData` inside that fixture, and is removed on exit. It does not load Recordly,
write project files, or use Recordly application data. Set
`RECORDLY_IPC_BENCH_KEEP_TEMP=1` only when inspecting the temporary fixture.

The fixture uses a hidden, disposable BrowserWindow. Main creates a
`MessageChannelMain`, transfers one endpoint with `webContents.postMessage`, and the
renderer sends a two-byte transferable probe before the benchmark. If Electron cannot
create the channel, transfer the port, detach the probe ArrayBuffer, or deliver the
probe to `MessagePortMain`, the script exits with an explanatory unavailable message
instead of silently substituting another transport.

Each payload is checked in main and acknowledged. The report includes:

| Field | Meaning |
| --- | --- |
| Electron version, Node version, platform, arch | Runtime identity for comparison |
| throughput | Total logical payload bytes divided by elapsed time, in MiB/s |
| ACK latency | Average, median, and p95 time from post to main ACK receipt, in ms |
| buffer ownership | Whether `ArrayBuffer.byteLength` became zero immediately after a transfer-list post |
| peak in-flight payload bytes | Largest sum of unacknowledged logical payload sizes; with defaults this is 2 MiB or 66 MiB |
| physicalZeroCopy | Explicitly reports that physical zero-copy was not measured or guaranteed |

The legacy route calls `ipcRenderer.send("legacy-frame", { payload })` without a
transfer list. The stream route calls `MessagePort.postMessage(message, [payload])`.
Both routes receive an ACK after main validates the payload. Ownership transfer is
reported separately from physical copying: a detached sender buffer proves an
ownership handoff, not that the OS, Chromium, Electron, or V8 avoided every physical
copy.

A quick invocation is useful for launch/resource diagnostics, but it is not a stable
performance sample:

```text
RECORDLY_IPC_BENCH_ITERATIONS=1 RECORDLY_IPC_BENCH_WINDOW=1 node scripts/benchmark-native-frame-transport.mjs
```

On shells without an Electron display/runtime, or on a version that cannot carry the
probe across `MessagePortMain`, the expected result is a nonzero exit with the reason
on stderr. That is a capability failure, not a claim that the legacy route is faster.

## Relevant Electron API facts

These facts are based on the Electron APIs used by the reproducer and the Electron
43.1.0 declarations installed in this checkout:

1. `ipcRenderer.send(channel, ...args)` serializes arguments with the Structured Clone
   Algorithm. It has no transfer-list parameter. Passing an ArrayBuffer this way is a
   normal IPC serialization path; the renderer retains its ArrayBuffer ownership.
2. `ipcRenderer.postMessage(channel, message, transfer)` is the Electron API for
   transferring `MessagePort` objects to main. Its documented transfer resources are
   MessagePorts, not a general renderer-to-main raw ArrayBuffer streaming primitive.
3. `webContents.postMessage(channel, message, transfer)` can transfer
   `MessagePortMain` objects to a renderer. The received endpoint is a native DOM
   `MessagePort` and must be started before queued messages are delivered.
4. `MessageChannelMain` creates `MessagePortMain` endpoints. `MessagePortMain` exposes
   `on("message")`, `start()`, `close()`, and `postMessage()`. The type contract for
   its transfer argument is `MessagePortMain[]`; support for an ArrayBuffer transfer
   from a renderer endpoint through this Electron boundary must therefore be tested,
   not assumed from the browser MessagePort API alone.
5. Browser/DOM MessagePort APIs define ownership transfer for transferable objects in
   a transfer list. Electron's process boundary still has to preserve that resource;
   an API that accepts the call is not by itself proof that the bytes travelled
   physically zero-copy.

References:

- Electron IPC renderer API: https://www.electronjs.org/docs/latest/api/ipc-renderer
- Electron webContents API: https://www.electronjs.org/docs/latest/api/web-contents
- Electron MessageChannelMain API: https://www.electronjs.org/docs/latest/api/message-channel-main
- Electron MessagePortMain API: https://www.electronjs.org/docs/latest/api/message-port-main
- Electron IPC tutorial and Structured Clone notes: https://www.electronjs.org/docs/latest/tutorial/ipc
- MDN `MessagePort.postMessage`: https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/postMessage

## Narrow upstream proposal

Electron should provide one of the following supported, documented capabilities:

A. A high-throughput renderer-to-main binary IPC primitive that accepts transferable
   ArrayBuffers (or an equivalent explicitly transferable binary resource). It should
   define ownership after submission, ordering, lifecycle/error behavior, capability
   detection, and a usable backpressure signal. It should not require an application to
   encode binary payloads as JSON or rely on undocumented structured-clone behavior.

B. Fix `MessagePortMain` transferable resources so a renderer DOM MessagePort can send
   an ArrayBuffer in its transfer list and the paired `MessagePortMain` receives the
   intact ArrayBuffer with the expected detached sender state. The fix should include
   cross-platform tests, declarations, and API documentation that state exactly which
   resources are supported.

Either option should document that ownership transfer and physical zero-copy are
separate guarantees. Ownership transfer can eliminate a sender-side usable reference
while the implementation still copies bytes internally. Physical zero-copy would need
an explicit implementation guarantee and measurement; it must not be inferred from a
successful `postMessage` or a detached ArrayBuffer.

The proposal is deliberately limited to Electron's generic IPC/resource contract. It
does not prescribe application frame formats, video codecs, editor behavior, or any
other Recordly-specific business logic.

## Current limitations

This benchmark measures end-to-end renderer-post-to-main-ACK behavior, not allocator
copies, RSS, page faults, GPU mappings, or kernel transfers. Its peak in-flight metric
is a logical unacknowledged-payload watermark, not total process memory. Payloads use
sentinel bytes for integrity and do not model a particular media format. Results are
sensitive to Electron build, OS, scheduler, renderer process state, payload window, and
iteration count.

In this checkout, the quick smoke command reached the `MessagePortMain` probe on
Electron 43.1.0 / Windows but the main side received no data for the transferred
ArrayBuffer. The script exited nonzero with an explanatory capability error and did not
publish partial throughput numbers. This is the unsupported-resource case the
reproducer is intended to expose.

If the transferable probe fails, the benchmark intentionally stops before presenting a
partial legacy-versus-MessagePort comparison. This keeps unsupported runtime behavior
visible and avoids silently degrading the experiment to a copied path.
