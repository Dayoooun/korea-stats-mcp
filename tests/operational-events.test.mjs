import assert from "node:assert/strict";
import test from "node:test";

const {
  elapsedTimeMsSince,
  emitOperationalEvent,
  setOperationalEventSink,
  statusCategoryForCode,
} = await import("../dist/utils/operationalEvents.js");
const { CacheManager } = await import("../dist/cache/index.js");

const SENTINEL = "operational-event-secret-query-url-session";

function captureEvents() {
  const events = [];
  const restore = setOperationalEventSink((event) => events.push(event));
  return { events, restore };
}

function close(manager) {
  manager.cache.close();
}

test("projects only the allowlisted fields and enums", () => {
  const { events, restore } = captureEvents();
  try {
    emitOperationalEvent({
      kind: "cache_hit",
      cache: "statistics_data",
      approximateBytes: 42,
      query: SENTINEL,
      requestBody: SENTINEL,
    });
    emitOperationalEvent({
      kind: "mcp_request_complete",
      elapsedTimeMs: 8,
      statusCategory: "success",
      error: SENTINEL,
    });
    emitOperationalEvent({
      kind: "mcp_initialize",
      elapsedTimeMs: 5,
      statusCategory: "success",
      requestBody: SENTINEL,
    });

    assert.deepEqual(events, [
      { kind: "cache_hit", cache: "statistics_data", approximateBytes: 42 },
      {
        kind: "mcp_request_complete",
        elapsedTimeMs: 8,
        statusCategory: "success",
      },
      {
        kind: "mcp_initialize",
        elapsedTimeMs: 5,
        statusCategory: "success",
      },
    ]);
    assert.ok(!JSON.stringify(events).includes(SENTINEL));
  } finally {
    restore();
  }
});

test("ignores malformed events without passing sentinels to the sink", () => {
  const { events, restore } = captureEvents();
  try {
    emitOperationalEvent({
      kind: "cache_miss",
      cache: SENTINEL,
      query: SENTINEL,
    });
    emitOperationalEvent({
      kind: "mcp_request_complete",
      elapsedTimeMs: Number.NaN,
      statusCategory: "server_error",
      responseBody: SENTINEL,
    });
    emitOperationalEvent({
      kind: "not-an-event",
      payload: SENTINEL,
    });

    assert.deepEqual(events, []);
    assert.ok(!JSON.stringify(events).includes(SENTINEL));
  } finally {
    restore();
  }
});

test("a throwing sink cannot break the caller", () => {
  const restore = setOperationalEventSink(() => {
    throw new Error(SENTINEL);
  });
  try {
    assert.doesNotThrow(() => {
      emitOperationalEvent({
        kind: "credentials_configured",
        configured: false,
      });
    });
  } finally {
    restore();
  }
});

test("default sink writes JSON to stderr and never stdout", () => {
  let stderr = "";
  let stdout = "";
  const originalStderrWrite = process.stderr.write;
  const originalStdoutWrite = process.stdout.write;
  process.stderr.write = (chunk) => {
    stderr += String(chunk);
    return true;
  };
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  try {
    emitOperationalEvent({
      kind: "mcp_transport_close",
      elapsedTimeMs: 3,
      statusCategory: "success",
    });
  } finally {
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
  }

  assert.deepEqual(JSON.parse(stderr), {
    kind: "mcp_transport_close",
    elapsedTimeMs: 3,
    statusCategory: "success",
  });
  assert.equal(stdout, "");
});

test("cache events preserve hit/miss, refusal, eviction, and expiry outcomes", async () => {
  const { events, restore } = captureEvents();
  const manager = new CacheManager();
  try {
    manager.cache.options.maxKeys = 1;
    await manager.getOrFetch("list", { id: 1 }, async () => ({ id: 1 }));
    await manager.getOrFetch("list", { id: 1 }, async () => {
      throw new Error("cache hit should not fetch");
    });
    await manager.getOrFetch("list", { id: 2 }, async () => ({ id: 2 }));

    manager.cache.options.maxKeys = 0;
    await manager.getOrFetch("data", { id: 3 }, async () => ({ id: 3 }));

    manager.cache.options.maxKeys = 1;
    await manager.getOrFetch("search", { id: 4 }, async () => "expiring", 0.01);
    await new Promise((resolve) => setTimeout(resolve, 30));
    manager.getCachedBytes();

    const kinds = events.map((event) => event.kind);
    assert.ok(kinds.includes("cache_miss"));
    assert.ok(kinds.includes("cache_hit"));
    assert.ok(kinds.includes("cache_eviction"));
    assert.ok(kinds.includes("cache_admission_refused"));
    assert.ok(kinds.includes("cache_expiry"));
    assert.ok(
      events.every((event) => !JSON.stringify(event).includes(SENTINEL)),
    );
    assert.ok(
      events.every((event) =>
        Object.keys(event).every((key) =>
          [
            "kind",
            "cache",
            "reason",
            "approximateBytes",
            "elapsedTimeMs",
            "statusCategory",
            "configured",
          ].includes(key),
        ),
      ),
    );
  } finally {
    close(manager);
    restore();
  }
});

test("lifecycle helpers produce bounded enum fields", () => {
  const elapsed = elapsedTimeMsSince(Date.now() - 10);
  assert.equal(typeof elapsed, "number");
  assert.ok(elapsed >= 0);
  assert.equal(statusCategoryForCode(200), "success");
  assert.equal(statusCategoryForCode(404), "client_error");
  assert.equal(statusCategoryForCode(503), "server_error");
  assert.equal(statusCategoryForCode(SENTINEL), "unknown");
});

test("actual HTTP handler reports OPTIONS and rejected methods without request contents", async () => {
  const { default: handler } = await import("../api/mcp.ts");
  const { events, restore } = captureEvents();
  try {
    for (const [method, expectedStatus] of [
      ["OPTIONS", 200],
      ["GET", 405],
    ]) {
      const response = {
        statusCode: 0,
        setHeader() {},
        status(code) {
          this.statusCode = code;
          return this;
        },
        end() {},
        json() {},
      };
      await handler(
        {
          method,
          body: { query: SENTINEL },
          headers: { authorization: SENTINEL },
        },
        response,
      );
      assert.equal(response.statusCode, expectedStatus);
    }
    assert.deepEqual(
      events.map(({ kind, statusCategory }) => ({ kind, statusCategory })),
      [
        { kind: "mcp_request_complete", statusCategory: "success" },
        { kind: "mcp_request_complete", statusCategory: "client_error" },
      ],
    );
    assert.equal(JSON.stringify(events).includes(SENTINEL), false);
  } finally {
    restore();
  }
});

for (const configuredKey of ["", "   "]) {
  test(`actual keyless initialize treats ${configuredKey.length ? "whitespace" : "empty"} credentials as absent`, async () => {
    const { createServer } = await import("node:http");
    const { once } = await import("node:events");
    const { config } = await import("../dist/config/index.js");
    const { default: handler } = await import("../api/mcp.ts");
    const originalKey = config.kosis.apiKey;
    const { events, restore } = captureEvents();
    config.kosis.apiKey = configuredKey;
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      request.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.status = (status) => {
        response.statusCode = status;
        return response;
      };
      response.json = (body) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(body));
      };
      await handler(request, response);
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const result = await fetch(
        `http://127.0.0.1:${server.address().port}/mcp`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: SENTINEL, version: "1" },
            },
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      assert.equal(result.status, 200);
      assert.equal((await result.json()).result.serverInfo.version, "2.0.0");
      assert.deepEqual(
        events.filter((event) => event.kind === "credentials_configured"),
        [{ kind: "credentials_configured", configured: false }],
      );
      assert.equal(
        events.filter((event) => event.kind === "mcp_initialize").length,
        1,
      );
      assert.equal(JSON.stringify(events).includes(SENTINEL), false);
      assert.equal(
        events.some((event) => event.kind === "provider_outcome"),
        false,
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      config.kosis.apiKey = originalKey;
      restore();
    }
  });
}
