# korea-stats-mcp — KOSIS 국가통계를 자연어로 조회하는 MCP 서버

## 왜 있나

- 누구를 위한 무엇인가: Claude Code·Codex 등 MCP 클라이언트가 통계청 KOSIS OpenAPI로 최신 공식 통계를 조회하게 한다. 원격(Vercel)과 로컬(npm/stdio) 두 경로로 제공한다.
- 지금 상태: 운영 중. package.json 버전 2.0.0, npm 패키지 `@kimdayoun/korea-stats-mcp`, 원격 `https://korea-stats-mcp.vercel.app/mcp`.

## 구조

```
src/        MCP 서버 본체 (index.ts·server.ts·remoteProxy.ts, tools/ api/ cache/ data/ prompts/ resources/ utils/)
api/mcp.ts  Vercel 서버리스 진입점 (vercel.json 이 /mcp, / 를 여기로 보낸다)
tests/      node --test 단위(*.test.mjs) + Playwright 스펙(*.spec.ts, release-*)
docs/       USER_GUIDE.md (운영자 절차 포함), USABILITY_IMPROVEMENT.md
dist/       tsc 빌드 산출물 (bin 진입점)
```

## 명령

|할 일|명령|
|---|---|
|설치|`pnpm install --frozen-lockfile` (vercel.json installCommand 기준. 로컬 설치 명령은 미확인)|
|개발 실행|`npm run dev` (tsc --watch), `npm run start` (node dist/index.js)|
|테스트|`npm run test:core` (빌드 후 node --test), `npm run test:offline`, `npm run test:live`, `npm test` (playwright)|
|빌드·린트|`npm run build`, `npm run lint`|
|배포|npm: `prepublishOnly` 가 빌드. Vercel: 명령 미확인 (vercel.json 존재, CI 워크플로 없음)|

## 배포와 확인

- 어디에 도나: Vercel `korea-stats-mcp.vercel.app` (함수 리전 icn1, 최대 15초), npm `@kimdayoun/korea-stats-mcp`.
- 자동/수동: 미확인. `.github/` 없음.
- 배포 확인: 실제 배포본의 `tools/list` 로 확인한다(README 지침). 로컬 성공이나 npm 게시를 운영 배포 완료로 보지 않는다. 절차는 docs/USER_GUIDE.md 운영자 절차.

## 이 저장소에서 승인이 필요한 일

- Vercel 운영 배포: 공개 원격 서버가 바뀐다. 환경 변수 `KOSIS_API_KEY`, `DATA_GO_KR_SERVICE_KEY` 설정 변경 포함.
- npm 게시: 공개 패키지 버전은 되돌리기 어렵다.
- 과거 공개 키 폐기: 새 키 정상 동작을 확인한 뒤에만 한다(README).

## 하지 않는 것

- API 키를 프런트엔드 공개 환경변수·저장소·로그에 넣지 않는다: README가 명시한다. `.env.example` 만 두고 `.env` 값은 출력하지 않는다.
- 스코프 없는 `kosis-mcp` 등을 이 프로젝트 배포본으로 취급하지 않는다: 제3자 패키지다(README).
- 소스 개선이 npm·운영 배포본에 이미 반영됐다고 가정하지 않는다: 소스·npm·Vercel 버전이 별개다(README).
- `test-results.json` 등 테스트 산출물의 수정분을 임의로 되돌리거나 커밋하지 않는다: 로컬 작업트리에서 수정 상태일 수 있다.

## 사고 이력

- 과거 공개 KOSIS 키가 소스·Git 이력에 노출됐던 정황이 있다(README: 소스 삭제로 이력에서 사라지지 않음) → 새 키로 검증 후 폐기한다.
- 최근 커밋 `fix(tools): make itemId optional for item-less KOSIS tables` → 항목 없는 KOSIS 통계표가 있으므로 itemId 를 필수로 가정하지 않는다.
