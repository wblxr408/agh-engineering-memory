# Release 0.1.0 verification

Recorded 2026-11-20 on Windows with Node.js 24.20.0. Scope: this new connector's behavior, not model benchmark accuracy.

## Focused TDD and protocol behavior

The initial search/read case failed its expected source-identifier assertion while the connector was unimplemented. After implementation, `node --test` passed seven behavior cases:

1. Search followed by exact Chinese source retrieval retains the latest correction and original punctuation across fragmented frames.
2. Writes require owner opt-in, always send create-only semantics, and preserve queued versus saved receipts.
3. A connection lost after a write is sent causes one request and an explicit unknown-outcome error, with no retry.
4. Project overrides, path traversal, unexpected arguments, unknown operations and out-of-range pagination fail before dispatch.
5. Cancellation and deadline expiry end requests without replay.
6. Oversized/malformed responses and broker errors fail without revealing the endpoint authentication value.
7. A real subprocess stdio session reads original evidence, refuses disabled writes, and resumes valid requests after oversized input.

These cases use a temporary loopback protocol fixture. They establish connector behavior against that contract, not that another implementation obeys the protocol or that a model chooses the correct final answer.

## AGH native tool invocation

An additional case passed through AGH's `createPluginTestHost` production registration bridge using the real package manifest, native entry and configured protocol fixture. It invoked the registered original-source read tool, preserved the returned Chinese correction, refused a project override and a disabled save, and registered the usage skill.

The author used an installed matching AGH source checkout and its tsx loader. To reproduce, install the plugin's development dependency with `npm ci --ignore-scripts`, set `AGH_SOURCE_ROOT` to your own compatible AGH source directory, then run (replace the loader's absolute path):

```sh
node --import file:///PATH/TO/AGH/node_modules/tsx/dist/loader.mjs --test acceptance/agh-host.mjs
```

The full AGH session approval/ledger path and market-UI installation were not exercised by this lightweight fixture. No full AGH regression suite was run. The AGH toolchain wrapper was omitted because it includes startup/runtime probes outside this task's allowed checks; the fixture ran directly with the pinned Node executable.

## Existing personal service

A live search through the new connector timed out. A subsequent original-note read was rejected by the existing service, and an independent read through the already-installed Basic Memory connector returned **Memory service busy: queue deadline exceeded**. Therefore, live personal-vault retrieval and a new live save are not claimed as passing acceptance for this release. No listener was replaced or restarted, and no private note or real endpoint was included in the release.

The protocol fixture and native registration results do not remove that live-service gap. Retry meaningful source retrieval when the existing service is idle. Antigravity's actual model invocation and final-answer quality remain separate host acceptance tasks.

## Market process

The root manifest, root MIT license, immutable version tag and `agh.market.json` follow the [market submission guide](https://github.com/AgnesAI-Labs/agh-plugin-market/blob/main/docs/submit-plugin.md). The market submission changes only `plugins.txt` and `docs/index.json`, pins the release commit, and must pass the market index validator. The published PR and its current review reports are the authority for submission status.

Nonempty file, loopback-network, tool-registration and skill capabilities are declared intentionally; this release requires manual capability/runtime API review under that guide. Do not remove real declarations to obtain automatic admission. Market scanning does not establish functional correctness or service availability.

No LongMemEval-S or MemoryAgentBench evaluation was run for this plugin.
