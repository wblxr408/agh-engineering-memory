# Existing local service protocol, version 1

This plugin connects to the already-running Engineering Memory resource broker used by the author's shared Basic Memory setup. That broker is a separate prerequisite, not included or installed by the plugin. This is not the network transport of upstream Basic Memory, and the plugin cannot be pointed directly at an ordinary upstream MCP stdio server.

Owner configuration specifies an absolute service directory. Its `resource-endpoint.json` must contain an integer `port` (1–65535) and a nonempty string `token`. The file is limited to 64 KiB, reread for every call so normal listener rotation is supported, and must be protected by the OS owner. Never commit this file. The host is always `127.0.0.1`; any host field in that document is ignored.

Each request uses a new TCP connection. A frame is a four-byte unsigned big-endian payload length followed by a UTF-8 JSON object. Request payloads are limited to 1 MiB and response payloads to 8 MiB.

Request envelope:

```json
{
  "token": "OWNER_LOCAL_TOKEN",
  "message": {
    "jsonrpc": "2.0",
    "id": "unique-request-id",
    "method": "tools/call",
    "params": {
      "name": "bm_read",
      "arguments": {"project": "main", "identifier": "main/decisions/example.md"}
    },
    "_engineering_request_key": "unique-request-id"
  }
}
```

`OWNER_LOCAL_TOKEN` is a placeholder. The actual value is never supplied as a model tool argument or shown in a transport error. The broker must validate the token before dispatch. `_engineering_request_key` allows the existing service to correlate a request; the plugin does not claim service-side deduplication guarantees.

The response frame contains a JSON-RPC response with the matching `id`, `jsonrpc: "2.0"`, and MCP `result`. Text-only MCP content blocks are supported and passed through without summarizing or rewriting. Optional `structuredContent` is passed to AGH's `structured` output for successful results. `isError` remains an error. A broker error or JSON-RPC error is surfaced as a generic rejection without exposing broker internals or the local token. Unsupported or malformed responses fail the request.

The allowlist is `bm_search`, `bm_read`, `bm_write` (only when enabled), and `memory_write_status`. Parameters are defined in `lib/contracts.mjs`; all unknown parameters are rejected. Search and read bind the configured project. Note paths are normalized to its qualified prefix; path traversal, absolute paths, other-project memory URLs and model-supplied project overrides are refused. Save sends `overwrite: false` explicitly. The broker must support these qualified identifiers and enforce its own authorization; client-side routing is not an authorization boundary.

There is no retry after a request is sent, including writes. A disconnect, timeout or cancellation after send can leave the outcome unknown. If a write_id was returned, query it; otherwise inspect the target note through the existing service before any retry. A `queued`/`confirming` receipt is not a confirmed save. Confirm `saved`, then read back the note. No new daemon, fallback model, cache database or indexing task is created.

The separate `bin/mcp.mjs` entry translates newline-delimited stdio MCP requests into the same allowlisted client operations. It serves initialize, ping, tools/list and tools/call. Tool content remains untrusted source material. AGH and Antigravity retain their own permission policies.
