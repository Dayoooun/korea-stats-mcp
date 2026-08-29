# 🇰🇷 Korea Stats MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io/)
[![Deploy](https://img.shields.io/badge/Vercel-Deployed-black)](https://korea-stats-mcp-yxup.vercel.app/)
[![npm](https://img.shields.io/npm/v/@kimdayoun/korea-stats-mcp)](https://www.npmjs.com/package/@kimdayoun/korea-stats-mcp)

> **이 저장소가 원본입니다.** 정본: https://github.com/Dayoooun/korea-stats-mcp
> npm 배포본은 **`@kimdayoun/korea-stats-mcp`** 하나뿐입니다.
> `kosis-mcp` 등 스코프 없는 동명 패키지는 이 프로젝트와 무관한 제3자 배포본입니다.

> **자연어로 KOSIS 통계를 조회하는 MCP 서버**

통계청 KOSIS OpenAPI 기반의 MCP(Model Context Protocol) 서버입니다.
Claude, Cursor, Windsurf 등 AI 도구에서 **자연어로 한국 통계 데이터**를 검색하고 분석할 수 있습니다.

**🌐 원격 서버 URL:** `https://korea-stats-mcp-yxup.vercel.app/mcp`

**📦 로컬 설치:**

```bash
npx -y @kimdayoun/korea-stats-mcp
```

MCP 클라이언트 설정:

```json
{
  "mcpServers": {
    "korea-stats": {
      "command": "npx",
      "args": ["-y", "@kimdayoun/korea-stats-mcp"],
      "env": { "KOSIS_API_KEY": "발급받은_키" }
    }
  }
}
```

---

## 🎯 왜 만들었나요?

AI에게 **"한국 인구가 몇 명이야?"** 라고 물으면, AI는 학습 데이터의 오래된 정보를 답합니다.
Korea Stats MCP를 연결하면 **실시간 공식 통계**를 조회해서 정확한 답변을 제공합니다.

| Before (MCP 없이) | After (Korea Stats MCP 연결) |
|-------------------|------------------------------|
| Q: 한국 인구가 몇 명이야? | Q: 한국 인구가 몇 명이야? |
| A: 2023년 기준 약 5,100만 명입니다. ❌ | A: 2024년 한국의 총인구는 51,712,619명입니다. ✅ |

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| ⚡ **빠른 조회** | "실업률", "GDP", "출산율", "미세먼지" 등 83개 키워드 즉시 조회 |
| 📈 **추세 분석** | 최근 N년간 데이터 추이 및 변화율 분석 |
| 🔍 **통계 검색** | KOSIS 90만+ 통계표에서 키워드 검색 |
| 📊 **비교 분석** | 연도별, 지역별, 항목별 통계 비교 |
| 🗺️ **지역별 조회** | 17개 시도별 통계 조회 지원 |

---

## 🚀 사용 방법

### 방법 1: 원격 서버 사용 (설치 없이 바로 사용) ⭐ 권장

설치 없이 원격 MCP 서버에 바로 연결할 수 있습니다.

#### Claude Desktop

`claude_desktop_config.json` 파일 위치:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "korea-stats": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://korea-stats-mcp-yxup.vercel.app/mcp"
      ]
    }
  }
}
```

#### Cursor

설정 → MCP → Add new MCP server:

```json
{
  "korea-stats": {
    "command": "npx",
    "args": [
      "-y",
      "mcp-remote",
      "https://korea-stats-mcp-yxup.vercel.app/mcp"
    ]
  }
}
```

#### Windsurf

MCP 설정에 추가:

```json
{
  "korea-stats": {
    "serverUrl": "https://korea-stats-mcp-yxup.vercel.app/mcp"
  }
}
```

---

### 방법 2: 로컬 설치

직접 서버를 실행하고 싶다면 로컬에 설치할 수 있습니다.

#### 1단계: 설치

```bash
# 저장소 클론
git clone https://github.com/Dayoooun/korea-stats-mcp.git
cd korea-stats-mcp

# 의존성 설치 (pnpm 권장)
pnpm install

# 빌드
pnpm run build
```

#### 2단계: AI 도구에 연결

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "korea-stats": {
      "command": "node",
      "args": ["/절대경로/korea-stats-mcp/dist/index.js"]
    }
  }
}
```

**Cursor** (설정 → MCP Servers):
```json
{
  "korea-stats": {
    "command": "node",
    "args": ["/절대경로/korea-stats-mcp/dist/index.js"]
  }
}
```

---

### 방법 3: Kakao PlayMCP

[Kakao PlayMCP](https://playmcp.com/)에서도 사용할 수 있습니다.

1. PlayMCP 사이트 접속
2. **korea-stats-mcp** 검색
3. 클릭 한 번으로 연결 완료!

---

## 💬 사용 예시

연결 후 AI에게 자연어로 질문하세요:

```
"한국 인구가 몇 명이야?"
"서울 실업률 알려줘"
"최근 10년 출산율 추이 보여줘"
"GDP 성장률은?"
"부산과 대구 인구 비교해줘"
"서울 아파트가격 알려줘"
"경기도 GRDP 얼마야?"
"평균 임금 알려줘"
"2024년 10월 출생아수 알려줘"   # 월별 데이터
"서울 전세가격"                # 🆕 전세
"경기 자동차 등록대수"          # 🆕 자동차
"부산 범죄율"                  # 🆕 범죄
"외래관광객 몇 명이야?"
"교통사고 발생건수"            # 🆕 교통사고
"서울 의사수 알려줘"           # 🆕 의료
```

**실제 응답 예시:**
```
✅ "2025년 한국의 주민등록 총인구는 51,117,378명입니다."
✅ "2024년 서울의 실업률은 3%입니다."
✅ "2025년 3월 서울의 아파트매매가격지수는 99.687 (2021.6=100)입니다."
✅ "2025년 한국의 상용근로자 월평균 임금은 4,094,615원입니다."
✅ "2024년 경기의 지역내총생산(명목)은 651,417,234백만원입니다."
✅ "2025년 3월 서울의 주택전세가격지수는 94.134 (2021.6=100)입니다."
✅ "2024년 서울의 자동차 등록대수는 3,176,933대입니다."
✅ "2024년 부산의 인구 천명당 범죄발생건수는 34.4건입니다."
✅ "2025년 11월 한국의 외래관광객수는 1,596,939명입니다."
✅ "2024년 한국의 교통사고 발생건수는 168,585건입니다."
✅ "2024년 서울의 의료기관 종사 의사수는 43,547명입니다."
```

---

## 📊 지원하는 통계 (83개 키워드)

### 인구/출산/사망
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `인구`, `총인구` | 총인구수 | 연 |
| `출산율`, `합계출산율` | 합계출산율 | 연 |
| `출생아수`, `출생아`, `조출생률` | 출생 통계 | 연/분기/월 |
| `사망자수`, `사망자`, `조사망률`, `사망률` | 사망 통계 | 연/분기/월 |
| `자연증가`, `자연증가율` | 자연증감 | 연/분기/월 |
| `기대수명`, `기대여명`, `평균수명` | 기대수명 | 연 |

### 혼인/이혼
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `혼인율`, `혼인건수`, `조혼인율` | 혼인 통계 | 연/분기/월 |
| `이혼율`, `이혼건수`, `조이혼율` | 이혼 통계 | 연/분기/월 |

### 고용/노동
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `실업률` | 실업률 (시도별 지원) | 연 |
| `고용률` | 고용률 (시도별 지원) | 연 |
| `취업자수`, `취업자` | 취업자 수 | 연 |
| `실업자수`, `실업자` | 실업자 수 | 연 |
| `경제활동인구`, `비경제활동인구` | 경제활동인구 | 연 |
| `임금`, `월평균임금`, `월급`, `평균임금` | 상용근로자 월평균 임금 (시도별) | 연 |

### 경제
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `GDP`, `국내총생산` | GDP (국내총생산) | 연 |
| `GRDP`, `지역내총생산` | 지역내총생산 (시도별) | 연 |
| `경제성장률`, `성장률`, `GDP성장률` | 경제성장률 | 연 |
| `물가`, `소비자물가`, `소비자물가지수` | 소비자물가 (시도별) | 연/월 |

### 무역
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `수출액`, `수출` | 수출액 | 연 |
| `수입액`, `수입` | 수입액 | 연 |
| `무역수지` | 무역수지 | 연 |

### 부동산
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `주택가격`, `주택매매가격`, `주택가격지수` | 주택매매가격지수 (시도별) | 월 |
| `아파트`, `아파트가격`, `아파트매매가격`, `아파트가격지수` | 아파트매매가격지수 (시도별) | 월 |
| `전세`, `전세가격`, `전세가격지수`, `주택전세` | 주택전세가격지수 (시도별) | 월 |
| `아파트전세`, `아파트전세가격` | 아파트전세가격지수 (시도별) | 월 |

### 자동차/교통 🆕
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `자동차`, `자동차등록`, `자동차대수` | 자동차 등록대수 (시도별) | 연 |

### 범죄/치안 🆕
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `범죄`, `범죄율`, `범죄발생` | 인구 천명당 범죄발생건수 (시도별) | 연 |

### 관광
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `관광객`, `외래관광객`, `입국자` | 외래관광객 입국자수 | 월 |

### 교통/안전 🆕
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `교통사고`, `교통사고발생`, `사고건수` | 교통사고 발생건수 (시도별) | 연 |

### 의료/건강
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `의사`, `의사수`, `의료인력` | 의료기관 종사 의사수 (시도별) | 연 |

### 대기환경 🆕
| 키워드 | 설명 | 주기 |
|--------|------|------|
| `미세먼지`, `PM2.5`, `초미세먼지`, `대기오염` | 초미세먼지(PM2.5) 농도 (시도별) | 월 |
| `PM10` | 미세먼지(PM10) 농도 (시도별) | 월 |

---

## 🗺️ 지역별 조회

17개 광역시도별 통계를 조회할 수 있습니다:

**지원 지역:**
전국, 서울, 부산, 대구, 인천, 광주, 대전, 울산, 세종, 경기, 강원, 충북, 충남, 전북, 전남, 경북, 경남, 제주

**예시:**
```
"서울 인구"
"부산 실업률"
"제주 출산율"
"경기도 고용률"
"서울 아파트가격"
"경기 GRDP"
"울산 임금"
"서울 전세가격"
"경기 자동차"
"부산 범죄율"
"서울 교통사고"           # 🆕 교통사고
"부산 의사수"             # 🆕 의료
```

---

## 📅 월별/분기별 조회 🆕

일부 통계는 월별 또는 분기별 조회가 가능합니다:

**예시:**
```
"2024년 10월 출생아수"    # 월별 조회
"2024년 3분기 사망자수"   # 분기별 조회
"2025년 1월 주택가격"     # 월별 조회
```

**지원 통계:** 출생아수, 사망자수, 혼인건수, 이혼건수, 자연증가, 물가, 주택가격, 아파트가격, 전세가격, 관광객

---

## 🛠️ 제공 도구 (8개)

### 핵심 도구 ⭐

| 도구 | 설명 | 예시 |
|------|------|------|
| `quick_stats` | 83개 키워드 빠른 조회 | "실업률", "GDP", "미세먼지", "교통사고", "의사수" |
| `quick_trend` | 시계열 추세 분석 | "출산율 10년 추이" |

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
│   ├── index.ts              # 진입점 (stdio 트랜스포트)
│   ├── server.ts             # MCP 서버 설정
│   ├── tools/                # 8개 도구 구현
│   │   ├── quickStats.ts     # 빠른 조회
│   │   ├── quickTrend.ts     # 추세 분석
│   │   └── ...
│   ├── data/
│   │   └── quickStatsParams.ts  # 83개 키워드 매핑
│   └── api/
│       └── client.ts         # KOSIS API 클라이언트
├── api/
│   └── mcp.ts                # Vercel 서버리스 (원격 MCP)
└── tests/                    # Playwright 테스트
```

### 새 키워드 추가하기

`src/data/quickStatsParams.ts`에 새 키워드를 추가할 수 있습니다:

```typescript
'새키워드': {
  orgId: '101',           // 기관 코드 (101 = 통계청)
  tableId: 'DT_XXXXX',    // 통계표 ID
  tableName: '통계표명',
  description: '설명',
  objL1: '00',            // 분류값 코드
  itemId: 'T10',          // 항목 코드
  unit: '단위',
}
```

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
- [ ] 영문 키워드 지원 (population, unemployment 등)
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

이슈나 질문이 있으시면 [GitHub Issues](https://github.com/Dayoooun/korea-stats-mcp/issues)에 등록해 주세요.

---

<p align="center">
  <b>Made with ❤️ for Korean Statistics</b><br>
  <sub>KOSIS OpenAPI 기반 | MCP Compatible</sub>
</p>
