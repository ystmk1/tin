<p align="left">
  <img src="public/android-chrome-192x192.png" alt="tin" width="72" height="72" />
</p>

# tin

독서 발췌 노트 탐색기. 메인 화면은 세 층으로 구성됩니다.

1. **랜덤 한 줄** — 노트 본문의 `**볼드**` 텍스트 중 무작위 하나 + 제목 / 저자 / 페이지
2. **나무 그래프** — 노트 간 연결을 force-directed로 표시. 연결도 높은 노드가 굵고 중심에서 가지처럼 뻗어나감.
3. **책등 스택** — 한 권당 한 줄. 최근 읽은 책이 위, 과거가 아래.

웹 앱(Vite 정적 사이트)이 메인이고, 같은 코드가 옵시디언 플러그인으로도 빌드됩니다.

## 구조

```
.
├── index.html             웹 엔트리
├── src/                   웹 + 공유 소스
│   ├── main.ts            웹 진입점
│   ├── view-web.ts        웹 메인 뷰
│   ├── notes.ts           build-time 노트 로더
│   ├── dom-polyfill.ts    옵시디언 DOM helper 폴리필
│   ├── parser-core.ts     [공유] frontmatter / 페이지 / 볼드 파서
│   ├── graph.ts           [공유] 그래프 빌더
│   ├── graphView.ts       [공유] d3-force 그래프 렌더러
│   ├── bookStack.ts       [공유] 책등 스택 렌더러
│   ├── types.ts           [공유] 타입
│   └── styles.css         웹 스타일
├── notes/                 발췌 노트 (.md, 빌드 타임에 번들)
├── public/                정적 자산 (favicon 등)
└── plugin/                옵시디언 플러그인 (선택 빌드)
    ├── manifest.json
    ├── esbuild.config.mjs
    ├── package.json
    └── src/               { main.ts, view.ts, parser.ts }
```

## 개발 (웹)

```powershell
npm install
# .env.local 만들기 (git에 안 들어감)
"NL_API_KEY=발급받은_국립중앙도서관_API_키" | Out-File -Encoding ascii .env.local
npm run dev       # http://localhost:5180
npm run build     # → dist/
```

`notes/` 의 `.md` 파일을 추가/수정하면 dev 서버가 HMR로 자동 갱신.

## 환경변수

| 이름              | 용도                                                | 어디서               |
| ----------------- | --------------------------------------------------- | -------------------- |
| `NL_API_KEY`      | 국립중앙도서관 openAPI 인증키 (서버 사용)           | `.env.local`, Vercel |
| `ALADIN_TTB_KEY`  | 알라딘 TTB OpenAPI 키 (한국 책 표지·서지 제공)      | `.env.local`, Vercel |

키는 클라이언트 번들에 들어가지 않습니다 — `api/nl-search.ts` (Vercel 서버리스) 또는 `vite.config.ts`의 dev middleware 안에서만 읽습니다. 따라서 브라우저 개발자도구로 키를 볼 수 없습니다. 두 키 중 하나만 있어도 검색은 동작합니다 (양쪽 다 있으면 결과를 병합·중복제거).

## 배포 (Vercel)

이 레포는 Vite + Serverless functions 조합으로 자동 인식됩니다.

- **Framework Preset**: Vite (자동 감지)
- **Build Command**: `npm run build` (자동)
- **Output Directory**: `dist` (자동)
- **Install Command**: `npm install` (자동)
- **Functions**: `api/*` 가 자동으로 Serverless로 빌드됨

배포 전에 **Settings → Environment Variables** 에서 `NL_API_KEY` + `ALADIN_TTB_KEY` 추가 (Production/Preview/Development 모두 체크).

이전에 빌드가 실패했다면 **Settings → Build & Development Settings** 에서 모든 항목의 "Override"를 해제해 자동 감지에 맡기세요.

## 노트 양식

```markdown
---
author: 저자명
status: 완독            # 또는 "읽는 중" / "142페이지 중단"
start_date: 2025-11-02
end_date: 2025-11-09
tags:
  - 문학/한국문학/소설
  - SF
publisher: 출판사
comment: 짧은 코멘트
---

> 책 외부의 글 (서평, 작가의 말 등). 첫 페이지 마커 전까지만 인식.

##### 12
페이지 본문...
**메인 화면 랜덤 발췌 후보가 되는 볼드 문장.**

##### 47
다음 페이지 본문. 빈 줄, 페이지 내 공백은 그대로 보존됩니다.
```

### 파싱 규칙

- 페이지 마커: `##### <숫자>` (그 줄 단독).
- 다음 페이지 마커 전까지 모두 해당 페이지 본문. 연속 페이지를 합쳐 쓴 경우 첫 페이지 번호로 묶입니다.
- `**…**` 안의 짧은 텍스트가 메인 화면 한 줄 발췌 후보로 인덱싱됩니다.
- 상단 `> …` 인용 블록은 책 외부 자료(서평/작가의 말)로 분류되어 발췌 대상에서 제외됩니다.
- 페이지 내 공백 줄(엔터)은 원본 그대로 유지됩니다.

## 연결 기준 (그래프 필터)

- **저자**: 같은 `author` 값을 가진 노트끼리 연결.
- **태그**: 태그 경로의 최하위 카테고리가 같은 노트끼리. 예) `문학/한국문학/소설`과 `문학/한국문학/시`는 각각 `소설`/`시`가 잎이므로 연결되지 않음.

상단 토글로 두 기준을 즉시 전환할 수 있습니다.

## 옵시디언 플러그인 빌드 (선택)

```powershell
cd plugin
npm install
npm run build           # plugin/main.js 생성
# 자동 배포 (자신의 vault 경로)
$env:DOKKI_VAULT = "C:\path\to\your\vault"
npm run dev             # 변경 시마다 vault의 .obsidian/plugins/dokki/ 로 복사
```

플러그인은 vault의 `.md` 노트를 직접 읽습니다. 웹 데모와 동일한 파서·그래프·책등 로직(`src/parser-core.ts`, `src/graph.ts`, `src/graphView.ts`, `src/bookStack.ts`)을 공유합니다.

## 알려진 한계

- 그래프는 표시 정리를 위해 같은 그룹 내 노드 수를 12개까지만 연결합니다.
- 노드 레이블은 연결도 상위 40% 노드만 표시 (그 외는 hover).
- `**볼드**` 발췌가 없는 노트는 메인 한 줄 풀에 등장하지 않습니다.
