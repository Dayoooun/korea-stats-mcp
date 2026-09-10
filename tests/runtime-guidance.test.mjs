import assert from "node:assert/strict";
import test from "node:test";
import * as tools from "../dist/tools/index.js";
import { getKeyIndicatorsJson } from "../dist/resources/keyIndicators.js";
import {
  getCategoryTree,
  getCategoryTreeJson,
} from "../dist/resources/categoryTree.js";
import { generateStatisticsAssistantPrompt } from "../dist/prompts/statisticsAssistant.js";

test("runtime prompt names actual tools and preserves provider access boundaries", () => {
  const names = Object.entries(tools)
    .filter(
      ([key, value]) =>
        key.endsWith("Schema") &&
        value?.inputSchema &&
        typeof value.name === "string",
    )
    .map(([, value]) => value.name);
  assert.equal(new Set(names).size, 14);
  const text = generateStatisticsAssistantPrompt("인구")
    .messages.map((message) => message.content.text)
    .join("\n");
  for (const name of names) assert.ok(text.includes(`**${name}**`), name);
  for (const field of [
    "indicatorId",
    "detailPage",
    "variablePage",
    "downloadCodebook",
    "header-only",
    "partition_split",
    "requested_period_traversal",
  ]) {
    assert.ok(text.includes(field), field);
  }
  assert.match(text, /pmsSurvAreaId[^\n]+호출 인자가 아닙니다/);
  assert.match(text, /서버 운영자 환경/);
  assert.match(text, /워크시트 본문 검증이나 원자료 접근 승인 증거가 아닙니다/);
  assert.ok(!text.includes("get_recommended_stats"));
});

test("static indicator metadata cannot masquerade as current observations", () => {
  const resource = JSON.parse(getKeyIndicatorsJson());
  assert.equal(resource.metadataStatus, "static_reference");
  assert.match(resource.lastUpdatedSemantics, /통계값의 최신 시점이 아닙니다/);
  assert.ok(
    Array.isArray(resource.limitations) && resource.limitations.length > 0,
  );
  assert.ok(resource.indicators.length > 0);
  for (const indicator of resource.indicators) {
    assert.equal(typeof indicator.orgId, "string");
    assert.equal(typeof indicator.tableId, "string");
    assert.equal(Object.hasOwn(indicator, "value"), false);
  }
});

test("static category guidance does not claim a provider refresh or complete live taxonomy", () => {
  const resource = JSON.parse(getCategoryTreeJson());
  assert.equal(resource.metadataStatus, "static_reference");
  assert.match(resource.description, /실시간 조회가 아닙니다/);
  assert.match(
    resource.lastUpdatedSemantics,
    /공식 분류의 갱신 시점이 아닙니다/,
  );
  assert.ok(
    resource.limitations.some((note) => note.includes("get_statistics_list")),
  );
  assert.ok(resource.limitations.some((note) => note.includes("차원 선택값")));
  assert.deepEqual(resource.categories, getCategoryTree());
  assert.ok(resource.categories.length > 0);
});
