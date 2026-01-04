# 🇰🇷 Korea Stats MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io/)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-green)](https://nodejs.org/)

> **AI가 한국 통계를 이해하도록 돕는 MCP 서버**

통계청 KOSIS OpenAPI 기반의 MCP(Model Context Protocol) 서버입니다.
Claude, Cursor, Windsurf 등 AI 도구에서 **자연어로 한국 통계 데이터**를 검색하고 분석할 수 있습니다.

---

## 🎯 왜 만들었나요?

AI에게 **"한국 인구가 몇 명이야?"** 라고 물으면, AI는 학습 데이터의 오래된 정보를 답합니다.
Korea Stats MCP를 연결하면 **실시간 공식 통계**를 조회해서 정확한 답변을 제공합니다.

### Before (MCP 없이)
```
Q: 한국 인구가 몇 명이야?
A: 2023년 기준 약 5,100만 명입니다. (outdated)
```

### After (Korea Stats MCP 연결)
```
Q: 한국 인구가 몇 명이야?
A: 2024년 한국의 총인구는 51,712,619명입니다. (KOSIS 실시간 조회)
```

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| ⚡ **빠른 조회** | "실업률", "GDP", "출산율" 등 43개 키워드 즉시 조회 |
| 📈 **추세 분석** | 최근 N년간 데이터 추이 및 변화율 분석 |
| 🔍 **통계 검색** | KOSIS 90만+ 통계표에서 키워드 검색 |
| 📊 **비교 분석** | 연도별, 지역별, 항목별 통계 비교 |
| 🗺️ **지역별 조회** | 17개 시도별 통계 조회 지원 |

---

## 🚀 빠른 시작

### 1. 설치

```bash
# 저장소 클론
git clone https://github.com/your-username/korea-stats-mcp.git
cd korea-stats-mcp

# 의존성 설치 (pnpm 권장)
pnpm install

# 빌드
pnpm run build
```

### 2. AI 도구에 연결

#### Claude Desktop
`claude_desktop_config.json`에 추가:
```json
{
  "mcpServers": {
    "korea-stats": {
      "command": "node",
      "args": ["/path/to/korea-stats-mcp/dist/index.js"]
    }
  }
}
```

#### Cursor
설정 → MCP Servers에서 추가:
```json
{
  "korea-stats": {
    "command": "node",
    "args": ["/path/to/korea-stats-mcp/dist/index.js"]
  }
}
```

### 3. 사용하기

연결 후 AI에게 자연어로 질문하세요:

```
"한국 인구가 몇 명이야?"
"서울 실업률 알려줘"
"최근 10년 출산율 추이 보여줘"
"GDP 성장률은?"
```

---

## 📊 지원하는 통계 (43개 키워드)

### 인구/출산/사망
| 키워드 | 설명 | 예시 질문 |
|--------|------|-----------|
| `인구`, `총인구` | 총인구수 | "한국 인구 몇 명?" |
| `출산율`, `합계출산율` | 합계출산율 | "올해 출산율은?" |
| `출생아수`, `출생아` | 출생아 수 | "출생아 수 추이" |
| `사망자수`, `사망률` | 사망자 수 | "사망률 통계" |
| `기대수명`, `평균수명` | 기대여명 | "평균수명이 몇 살?" |

### 혼인/이혼
| 키워드 | 설명 | 예시 질문 |
|--------|------|-----------|
| `혼인율`, `혼인건수` | 혼인 통계 | "혼인율 추이" |
| `이혼율`, `이혼건수` | 이혼 통계 | "이혼율 알려줘" |

### 고용/노동
| 키워드 | 설명 | 예시 질문 |
|--------|------|-----------|
| `실업률` | 실업률 | "실업률이 몇 %?" |
| `고용률` | 고용률 | "고용률 추이" |
| `취업자수`, `취업자` | 취업자 수 | "취업자 몇 명?" |
| `실업자수`, `실업자` | 실업자 수 | "실업자 현황" |
| `경제활동인구` | 경제활동인구 | "경제활동인구 통계" |

### 경제
| 키워드 | 설명 | 예시 질문 |
|--------|------|-----------|
| `GDP`, `국내총생산` | GDP | "한국 GDP?" |
| `경제성장률`, `성장률` | 경제성장률 | "올해 성장률은?" |
| `물가`, `소비자물가` | 소비자물가지수 | "물가 상승률" |

### 무역
| 키워드 | 설명 | 예시 질문 |
|--------|------|-----------|
| `수출액`, `수출` | 수출액 | "수출 현황" |
| `수입액`, `수입` | 수입액 | "수입 통계" |
| `무역수지` | 무역수지 | "무역수지 추이" |

---

## 🗺️ 지역별 조회

17개 광역시도별 통계를 조회할 수 있습니다:

```
"서울 인구"
"부산 실업률"
"제주 출산율"
"경기도 고용률"
```

**지원 지역:** 전국, 서울, 부산, 대구, 인천, 광주, 대전, 울산, 세종, 경기, 강원, 충북, 충남, 전북, 전남, 경북, 경남, 제주

---

## 🛠️ 제공 도구 (Tools)

### 핵심 도구 ⭐

#### `quick_stats` - 빠른 통계 조회
```json
{
  "query": "실업률",
  "region": "서울",
  "year": 2024
}
```
→ "2024년 서울의 실업률은 3.2%입니다."

#### `quick_trend` - 추세 분석
```json
{
  "keyword": "출산율",
  "yearCount": 10
}
```
→ 10년간 출산율 추이 및 변화율 분석

### 고급 도구

| 도구 | 설명 |
|------|------|
| `search_statistics` | KOSIS 통계표 키워드 검색 |
| `get_statistics_list` | 주제별/기관별 통계 목록 탐색 |
| `get_statistics_data` | 특정 통계표 데이터 조회 |
| `compare_statistics` | 시점별/항목별 비교 분석 |
| `analyze_time_series` | 상세 시계열 분석 |
| `get_recommended_statistics` | 분야별 추천 통계 |

---

## 🔧 개발자 가이드

### 로컬 개발

```bash
# 개발 모드 (watch)
pnpm run dev

# MCP Inspector로 테스트
pnpm run inspector

# E2E 테스트
node e2e-test.js
```

### 프로젝트 구조

```
korea-stats-mcp/
├── src/
│   ├── index.ts          # 진입점
│   ├── server.ts         # MCP 서버 설정
│   ├── tools/            # 도구 구현
│   │   ├── quickStats.ts # 빠른 조회
│   │   ├── quickTrend.ts # 추세 분석
│   │   └── ...
│   ├── data/
│   │   └── quickStatsParams.ts  # 43개 키워드 매핑
│   └── api/
│       └── client.ts     # KOSIS API 클라이언트
├── api/
│   └── mcp.ts            # Vercel 서버리스 엔드포인트
└── tests/                # Playwright 테스트
```

### 키워드 추가하기

`src/data/quickStatsParams.ts`에 새 키워드를 추가할 수 있습니다:

```typescript
'새키워드': {
  orgId: '101',           // 기관 코드
  tableId: 'DT_XXXXX',    // 통계표 ID
  tableName: '통계표명',
  description: '설명',
  objL1: '00',            // 분류값 코드
  itemId: 'T10',          // 항목 코드
  unit: '단위',
}
```

---

## 🌐 Vercel 배포 (원격 MCP)

GitHub 연결 후 Vercel에서 자동 배포됩니다.

```bash
# Vercel CLI로 배포
vercel --prod
```

배포 후 URL: `https://your-project.vercel.app/mcp`

이 URL을 Kakao PlayMCP 등에 등록하여 원격 MCP로 사용할 수 있습니다.

---

## 📋 API 키

**API 키가 내장되어 있어 별도 설정 없이 바로 사용 가능합니다.**

> 💡 자체 API 키를 사용하려면 [KOSIS OpenAPI](https://kosis.kr/openapi/)에서 발급받아
> `src/config/index.ts`의 `apiKey` 값을 변경하세요.

---

## 🤝 기여하기

기여를 환영합니다!

1. 이 저장소를 Fork 합니다
2. 새 브랜치를 생성합니다 (`git checkout -b feature/새기능`)
3. 변경사항을 커밋합니다 (`git commit -m 'feat: 새 기능 추가'`)
4. 브랜치에 Push 합니다 (`git push origin feature/새기능`)
5. Pull Request를 생성합니다

### 기여 아이디어

- [ ] 새로운 통계 키워드 추가
- [ ] 영문 키워드 지원
- [ ] 지역명 풀네임 지원 (서울특별시 → 서울)
- [ ] 더 많은 테스트 케이스

---

## 📄 라이선스

[MIT License](LICENSE) - 자유롭게 사용, 수정, 배포할 수 있습니다.

---

## 🔗 관련 링크

- [KOSIS 국가통계포털](https://kosis.kr/)
- [KOSIS OpenAPI 개발 가이드](https://kosis.kr/openapi/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

---

## 💬 문의

이슈나 질문이 있으시면 [GitHub Issues](https://github.com/your-username/korea-stats-mcp/issues)에 등록해 주세요.

---

**Made with ❤️ for Korean Statistics**
