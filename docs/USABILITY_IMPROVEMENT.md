# Korea Stats MCP 사용성 안내

이 문서는 현재 소스에 등록된 도구를 처음 사용하는 호출자와 LLM을 위한 **정적 사용 안내**다. 이 문서와 `kosis://indicators/list` 리소스는 현재 수치나 최신 관측값을 제공하지 않는다. 실제 값은 도구가 제공하는 출처·관측 시각·기간·단위·검증 상태만 근거로 설명하며, 없는 근거는 추측하지 않는다.

## 현재 도구 목록

개발 소스에는 다음 14개 도구가 등록된다. 공개 원격 서버나 npm 배포본의 목록은 해당 배포본의 `tools/list` 응답으로 다시 확인한다.

### KOSIS 통계표

| 도구 | 용도 |
| --- | --- |
| `quick_stats` | 지원 키워드의 단일 수치 조회 |
| `quick_trend` | 지원 키워드의 연도별 추세 조회 |
| `search_statistics` | 키워드로 통계표 검색 |
| `get_statistics_list` | 주제·기관 등 분류별 목록 탐색 |
| `get_table_info` | 통계표의 실제 분류·항목 코드와 기간 메타데이터 확인 |
| `get_statistics_data` | 확인된 코드로 통계표 데이터 조회 |
| `compare_statistics` | 확인된 시점 또는 항목 비교 |
| `analyze_time_series` | 확인된 연·월·분기 시계열 분석 |
| `get_recommended_statistics` | 분야별 통계표 추천 |

### 공식 지표·공개 메타데이터

| 도구 | 용도 |
| --- | --- |
| `search_indicators` | 공식 지표를 이름·ID·수록주기로 검색 |
| `get_indicator` | 공식 지표의 정의 또는 원자료 값 조회 |
| `search_businesses` | 지역·업종별 상가업소를 페이지 단위로 조회 |
| `search_microdata` | MDIS 공개 조사 카탈로그 검색 |
| `get_microdata_info` | MDIS dataset·변수·공개 코드북 메타데이터 확인 |

## KOSIS 통계표 조회 순서

1. 단일 키워드 수치면 `quick_stats`를, 연도별 변화면 `quick_trend`를 먼저 사용한다. 도구가 지원하지 않는 키워드는 성공한 수치처럼 바꾸지 말고 `search_statistics`로 통계표를 찾는다.
2. 일반 통계표를 직접 조회할 때는 `search_statistics` 또는 `get_recommended_statistics`로 후보를 찾은 뒤 `get_table_info({ orgId, tableId })`를 호출한다.
3. `get_table_info` 응답에서 실제로 확인한 `objL1`·`itemId`와 표의 `periodType`을 사용해 `get_statistics_data`를 호출한다. 임의의 지역·항목 코드를 만들거나 다른 표의 코드를 재사용하지 않는다.
4. 기간을 지정했다면 `startPeriod`·`endPeriod` 또는 `recentCount`를 명시하고 결과의 `validationLevel`과 `metadata.periodRange`를 확인한다. `Y`, `M`, `Q`는 각각 연·월·분기이며 `S`, `D`, `F`, `IR`은 제공자별 의미를 자동으로 확정하지 않는다.
5. 응답의 `unit`이 없거나 관측별 단위가 섞이면 단위를 추측하지 않는다. `response_incomplete`로 실패한 범위 조회는 `data[].raw`에 남은 원자료를 성공한 완전한 시계열로 요약하지 않는다.

지역은 표 메타데이터에서 실제로 관찰된 코드만 사용한다. KOSIS 분류코드와 `search_businesses`의 행정구역 코드는 서로 다른 공급자의 코드이므로 바꿔 쓰지 않는다. 지역이 확인되지 않거나 동명이 여러 개인 경우 전국·상위 지역으로 임의 대체하지 않는다.

## 공식 지표 조회

`search_indicators`는 `filters.indicatorName`, `filters.indicatorId`, `filters.period` 중 하나 이상을 포함해야 하며, 페이지 인자는 `page`와 `pageSize`다.

`get_indicator`는 검색 결과의 `indicatorId`와 `kind`를 사용한다.

- `kind: "definition"`은 정의 조회이며 값 조회용 기간 인자를 함께 보내지 않는다.
- `kind: "values"`는 검색 결과의 공식 `indicatorName`을 함께 보내야 한다.
- `startPeriod`·`endPeriod`는 범위 검증용이고 `recentReference`·`recentCount`는 제공자 최근 조건이다. 최근 조건을 사용했다고 최신성이 입증되는 것은 아니다.
- 응답의 `validationLevel`, `completeness`, `unit`, `uncertainty`를 그대로 전달한다. 원자료 행의 식별자·주기·시점·항목이 부족하면 검증되지 않은 값으로 단정하지 않는다.

공급자 필드명(`jipyoId`, `jipyoNm`, `prdSe`, `startPrdDe`, `rn`, `srvRn`)을 공용 입력 별칭으로 만들지 않는다. 스키마에 없는 필드는 거부된다.

## 공개 사업체 조회

`search_businesses`는 다음 두 조건 중 하나를 사용한다.

- 지역: `regionType`과 `regionCode`를 함께 지정한다.
- 업종: `industryType`과 `industryCode`를 함께 지정한다.

`regionType`은 `ctprvnCd`, `signguCd`, `adongCd` 중 하나이며 `industryType`은 `indsLclsCd`, `indsMclsCd`, `indsSclsCd` 중 하나다. 각 코드도 공급자의 공식 값이어야 한다.

지역과 업종을 함께 주면 지역 API의 업종 필터로 결합된다. `page`·`pageSize`와 응답의 `returnedCount`, `providerTotal`, `hasMore`, `nextPage`, `completeness`를 확인한다. 한 페이지를 받았다고 전체 사업체 자료를 취득한 것으로 표현하지 않는다. `stdrYm`는 제공기관 기준월이며 안정적인 snapshot을 보장하지 않는다.

공개 호출자는 API 키나 회원가입을 제공하지 않는다. 승인된 `KOSIS_API_KEY`와 `DATA_GO_KR_SERVICE_KEY`는 서버 운영자 환경변수에서만 읽으며 호출 인자나 프롬프트에 노출하지 않는다.

## MDIS 공개 메타데이터와 수동 연구자 절차

MDIS 도구는 공식 API가 아닌 익명 공개 웹 `adapter`(공개 웹 응답을 MCP 형식으로 연결하는 모듈)다.

1. `search_microdata({ query, page, pageSize })`로 공개 카탈로그를 검색한다.
2. 결과의 `survId`, `itmDiv`로 `get_microdata_info`를 호출해 실제 `datasets` 선택지를 확인한다. 첫 dataset을 자동 선택하지 않는다.
3. 변수나 코드북을 확인하려면 detail에서 관찰한 `mappId`, `survAreaId`, `ofrSurvYm`를 모두 지정한다. `pmsSurvAreaId`는 선택한 dataset에 근거가 있을 때만 사용한다.
4. `detailPage`는 MDIS 상세 탐색 문맥이고 dataset 페이지라는 뜻이 아니다. `variablePage`는 선택된 변수 배열의 별도 페이지다.
5. `downloadCodebook: true`의 결과는 공개 코드북의 출처·바이트 수·해시와 검증 상태다. `validation.level: "header-only"`는 파일 형식과 XLS 헤더까지만 확인했다는 뜻이며 워크시트 본문 검증, 원자료 다운로드, 이용 승인 완료를 뜻하지 않는다.

연구자 로그인, 일반 원자료 다운로드, RAS/SDC 신청과 분석은 사용자가 MDIS 공식 페이지에서 수동으로 진행한다. 이 서버는 연구자 비밀번호·쿠키를 받거나 저장하지 않으며, 로그인·신청·승인을 완료했다고 주장하지 않는다. `surveyId`, `areaId`, `year`, `includeCodebook` 같은 선언되지 않은 별칭은 사용하지 않는다.

## 값과 완전성 해석 원칙

- 정적 목록의 `orgId`, `tableId`, `periodType`은 조회를 시작하기 위한 참고값이다. 단위·지역 범위·최신성·전체 자료 취득 여부를 의미하지 않는다.
- 최신값이라고 쓰려면 제공자 응답에 그 근거가 있어야 한다. 근거가 없으면 시점을 그대로 표시하고 `unknown` 또는 `unverified`로 표시한다.
- 페이지 응답은 현재 페이지일 뿐이다. `hasMore`, 다음 페이지와 `wholeDataset`을 확인한다.
- 단위가 누락되거나 섞인 경우 하나의 단위로 합치지 않는다. 기준값이 0일 때 변화율을 `0%`로 만들지 않고 절대 변화량과 미정 상태를 유지한다.
- 누락 기간을 0으로 채우지 않는다. 주기를 입증할 수 없는 경우 주기와 완전성을 검증되지 않은 것으로 남긴다.
- 제공되는 출처, `sourceUrl`, `observedAt`, 요청 식별자, `validationLevel`, `completeness`를 함께 제시하고, 없는 근거는 `unknown` 또는 `unverified`로 남긴다. 실제 관측값이 아닌 예시 숫자를 답변에 넣지 않는다.

## 정적 주요 지표 리소스

`kosis://indicators/list` (`key-indicators`)는 위 원칙에 따른 정적 식별자 목록이다. `lastUpdated`는 목록 생성일일 뿐 통계값의 최신 시점이 아니다. 목록에서 고른 `orgId`·`tableId`는 먼저 `get_table_info`로 확인하고, 실제 지역·항목·기간·단위는 그 후속 공식 응답만 사용한다.

리소스 URI와 이름은 다음과 같이 유지된다.

- `category-tree` → `kosis://categories/tree`
- `key-indicators` → `kosis://indicators/list`

이 안내와 리소스는 현재 수치, 사설 분석, 자동 로그인, 전체 원자료 취득 또는 연구자 신청 완료를 광고하지 않는다.
