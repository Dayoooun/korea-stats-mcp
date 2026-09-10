#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config/index.js";
import { createRemoteProxy } from "./remoteProxy.js";

async function main(): Promise<void> {
  const hasPersonalKey = Boolean(config.kosis.apiKey);
  const server = hasPersonalKey
    ? (await import("./server.js")).createServer()
    : await createRemoteProxy();
  await server.connect(new StdioServerTransport());
  console.error(
    hasPersonalKey
      ? "Korea Stats MCP: 개인 키로 로컬 통계 서버에 연결했습니다."
      : "Korea Stats MCP: 키 없이 공개 원격 서버에 연결했습니다. 조회 조건은 원격 서버로 전달됩니다.",
  );

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch(() => {
  console.error(
    "통계 서버 연결에 실패했습니다. 네트워크 또는 설정한 KOSIS_API_KEY를 확인해주세요.",
  );
  process.exitCode = 1;
});
