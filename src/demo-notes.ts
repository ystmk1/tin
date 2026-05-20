import { load as yamlLoad } from "js-yaml";
import { BookNote } from "./types";
import { parseBookContent } from "./parser-core";

// Demo notes shown when logged out or when a signed-in user has no notes yet.
// Their content doubles as a tutorial for the expected .md format. They share
// an author/tags so the graph shows a connection.

const yaml = (s: string) => yamlLoad(s) as Record<string, unknown>;

interface DemoFile {
  filename: string;
  content: string;
}

const DEMO_FILES: DemoFile[] = [
  {
    filename: "1. 노트 양식 안내.md",
    content: `---
author: DoKKi 가이드
status: 완독
start: 2026-01-01
finish: 2026-01-02
tags:
  - ☆☆☆☆☆
  - 안내
  - 사용법
publisher: DoKKi
comment: 로그인하고 본인의 .md 파일을 올리면 이 데모 대신 내 노트가 보입니다. 이 노트는 양식 설명용이에요.
---

> 이렇게 > 로 시작하는 인용 블록은 책 외부의 글(서평·작가의 말 등)로 인식되어, 상단 랜덤 발췌 대상에서는 제외됩니다.

##### 12
페이지는 다섯 개의 우물 정 기호 뒤에 숫자를 적어 구분합니다. "##### 12" 또는 "##### 12p." 처럼요.

**다섯 글자 이상의 볼드 문장은 메인 화면 상단의 랜덤 발췌 후보가 됩니다.**

##### 47
한 줄만 비우면(엔터 두 번) 책 조판처럼 단락 간격이 그대로 유지됩니다.

여러 줄을 비우면(엔터 세 번 이상) 중간 생략으로 보고, 페이지 사이 간격과 동일한 하나의 갭으로 정리됩니다.

### 단편집 소제목
이렇게 우물 정 세 개로 쓴 소제목은 본문보다 살짝 큰 서식으로 표시됩니다.

##### 88
"대사는 큰따옴표로 감싸 두면, 발췌로 떠올랐을 때 앞뒤 따옴표가 자동으로 정리됩니다."`,
  },
  {
    filename: "2. 별점과 상태.md",
    content: `---
author: DoKKi 가이드
status: 132p. 중단
start: 2026-02-10
tags:
  - ☆☆☆
  - 안내
  - 속성
publisher: DoKKi
comment: properties(프론트매터)의 별점·상태·저자·출판사가 어떻게 표시되는지 보여주는 데모입니다.
---

> tags에 별 기호(☆/★)만으로 된 항목은 태그가 아니라 별점으로 인식되어 제목 옆에 표시됩니다.

##### 23
status에 "완독", "읽는 중", "132p. 중단" 처럼 적으면 제목 아래 어두운 칩으로 분류되어 보입니다.

**서지 정보를 입력하지 않으면 properties의 저자·출판사가 그대로 쓰이고, 표지 검색으로 연결하면 그 정보로 대체됩니다.**

##### 24
저자와 출판사는 노트를 열었을 때 제목 아래에 표시됩니다.`,
  },
  {
    filename: "3. 연결망 그래프.md",
    content: `---
author: DoKKi 가이드
status: 읽는 중
start: 2026-03-01
tags:
  - ☆☆☆☆
  - 안내
  - 사용법
publisher: DoKKi
comment: 같은 저자나 같은 태그를 공유하는 노트끼리 그래프에서 가지로 이어집니다. 이 데모 셋은 모두 "DoKKi 가이드"가 저자라 서로 연결돼요.
---

##### 5
메인 화면 가운데 그래프는 노트 사이의 관계를 보여줍니다.

**연결을 많이 가진 노트일수록 크고 중심에 가깝게, 적은 노트는 가지 끝으로 뻗어 나갑니다.**

##### 6
상단 검색이나 필터를 쓰면, 조건에 맞지 않는 노드는 흐려지고 맞는 것만 또렷하게 남습니다.

##### 7
노드에 마우스를 올리면 제목이 나타나고, 클릭하면 그 노트가 열립니다.`,
  },
];

export function demoBooks(): BookNote[] {
  return DEMO_FILES.map((f) =>
    parseBookContent(f.content, `demo/${f.filename}`, f.filename.replace(/\.md$/i, ""), yaml),
  );
}
