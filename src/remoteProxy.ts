import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { PACKAGE_VERSION } from "./version.js";

export const PUBLIC_MCP_URL = "https://korea-stats-mcp.vercel.app/mcp";
const REQUEST_TIMEOUT_MS = 30_000;

/** Forward MCP over stdio without storing or distributing the operator's key. */
export async function createRemoteProxy(): Promise<Server> {
  const remote = new Client({
    name: "korea-stats-mcp-stdio",
    version: PACKAGE_VERSION,
  });
  const transport = new StreamableHTTPClientTransport(new URL(PUBLIC_MCP_URL), {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([
              init.signal,
              AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
  });
  try {
    await remote.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
  } catch {
    await remote.close();
    throw new Error(
      "공개 원격 통계 서버에 연결할 수 없습니다. 네트워크와 원격 서비스 상태를 확인해주세요.",
    );
  }
  const serverInfo = remote.getServerVersion();
  if (!serverInfo) {
    await remote.close();
    throw new Error(
      "공개 원격 통계 서버가 서버 식별 정보를 제공하지 않았습니다.",
    );
  }

  const server = new Server(serverInfo, {
    capabilities: remote.getServerCapabilities() ?? {},
    instructions: `사용자 API 키 없이 ${PUBLIC_MCP_URL}의 도구를 이용합니다. 질문과 조회 조건은 이 공개 서버로 전달됩니다.`,
  });
  server.fallbackRequestHandler = async (request, extra) =>
    remote.request(
      { method: request.method, params: request.params },
      ResultSchema,
      { signal: extra.signal, timeout: REQUEST_TIMEOUT_MS },
    );
  server.fallbackNotificationHandler = (notification) =>
    remote.notification(notification);
  remote.fallbackNotificationHandler = (notification) =>
    server.notification(notification);
  server.onclose = () => {
    void remote.close();
  };
  return server;
}
