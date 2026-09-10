import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  searchIndicators,
  searchIndicatorsSchema,
  getIndicator,
  getIndicatorSchema,
} from "./indicators.js";
import { searchBusinesses, searchBusinessesSchema } from "./businesses.js";
import {
  searchMicrodata,
  searchMicrodataSchema,
  getMicrodataInfo,
  getMicrodataInfoSchema,
} from "./mdis.js";

const textResult = (result: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
});

/** Both transports use complete schemas, including cross-field refinements. */
export function registerPublicTools(server: McpServer): void {
  server.registerTool(
    searchIndicatorsSchema.name,
    {
      description: searchIndicatorsSchema.description,
      inputSchema: searchIndicatorsSchema.inputSchema,
    },
    (args) => searchIndicators(args).then(textResult),
  );
  server.registerTool(
    getIndicatorSchema.name,
    {
      description: getIndicatorSchema.description,
      inputSchema: getIndicatorSchema.inputSchema,
    },
    (args) => getIndicator(args).then(textResult),
  );
  server.registerTool(
    searchBusinessesSchema.name,
    {
      description: searchBusinessesSchema.description,
      inputSchema: searchBusinessesSchema.inputSchema,
    },
    (args) => searchBusinesses(args).then(textResult),
  );
  server.registerTool(
    searchMicrodataSchema.name,
    {
      description: searchMicrodataSchema.description,
      inputSchema: searchMicrodataSchema.inputSchema,
    },
    (args) => searchMicrodata(args).then(textResult),
  );
  server.registerTool(
    getMicrodataInfoSchema.name,
    {
      description: getMicrodataInfoSchema.description,
      inputSchema: getMicrodataInfoSchema.inputSchema,
    },
    (args) => getMicrodataInfo(args).then(textResult),
  );
}
