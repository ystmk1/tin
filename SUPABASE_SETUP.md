# Supabase 클라우드 동기화 설정

서지정보 선택을 기기마다 따로 저장하지 않고, **Google / Kakao 로그인 계정**에 묶어 어디서나 동기화합니다. 무료 티어 안에서 동작합니다.

> 이 설정을 안 해도 앱은 정상 동작합니다 — 그냥 기존처럼 브라우저(localStorage)에만 저장돼요. 아래를 끝내고 env 변수를 채우면 자동으로 클라우드 모드로 전환됩니다.

---

## 1. Supabase 프로젝트 생성

1. https://supabase.com → 가입 (GitHub 계정으로 가능)
2. **New project** → 이름/비밀번호/리전(Northeast Asia - Seoul 추천) 입력 → 생성 (1~2분)
3. 좌측 **Project Settings → API** 에서 두 값 복사:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`
   - (anon key는 공개돼도 안전합니다. 아래 RLS가 데이터를 보호해요.)

## 2. 테이블 + 보안 규칙 (RLS) 생성

좌측 **SQL Editor → New query** 에 아래를 붙여넣고 **Run**:

```sql
create table public.note_selections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  note_path   text not null,
  control_no  text,
  title       text,
  author      text,
  publisher   text,
  pub_year    text,
  isbn        text,
  cover_url   text,
  detail_link text,
  source      text,
  updated_at  timestamptz not null default now(),
  unique (user_id, note_path)
);

alter table public.note_selections enable row level security;

create policy "own rows - select"
  on public.note_selections for select
  using (auth.uid() = user_id);

create policy "own rows - insert"
  on public.note_selections for insert
  with check (auth.uid() = user_id);

create policy "own rows - update"
  on public.note_selections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own rows - delete"
  on public.note_selections for delete
  using (auth.uid() = user_id);
```

RLS 덕분에 각 사용자는 **자기 행만** 읽고 쓸 수 있습니다 (멀티유저 안전).

## 3. 로그인 제공자 설정

좌측 **Authentication → Sign In / Providers** (또는 **URL Configuration**).

### 공통: 리디렉트 URL
**Authentication → URL Configuration → Redirect URLs** 에 사이트 주소 추가:
- 로컬: `http://localhost:5180`
- 배포: `https://<your-app>.vercel.app` (실제 Vercel 도메인)

**Site URL** 도 배포 도메인으로 설정.

### Google
1. https://console.cloud.google.com → 프로젝트 생성/선택
2. **APIs & Services → OAuth consent screen** 설정 (External, 앱 이름/이메일)
3. **Credentials → Create Credentials → OAuth client ID → Web application**
4. **Authorized redirect URIs** 에 Supabase가 알려주는 콜백 URL 추가:
   `https://<project-ref>.supabase.co/auth/v1/callback`
   (Supabase Google provider 설정 화면에 정확한 URL이 표시됩니다)
5. 발급된 **Client ID / Client Secret** 을 Supabase **Google provider** 에 입력 → Enable

### Kakao
1. https://developers.kakao.com → 애플리케이션 추가
2. **앱 키 → REST API 키** 확인
3. **카카오 로그인 → 활성화 ON**
4. **Redirect URI** 에 Supabase 콜백 추가:
   `https://<project-ref>.supabase.co/auth/v1/callback`
5. **동의 항목** 에서 닉네임/이메일 등 필요한 항목 설정
6. Supabase **Kakao provider** 에 REST API 키(= Client ID)와 Client Secret(보안 → Client Secret 발급) 입력 → Enable

## 4. env 변수 채우기

### 로컬 (`.env.local`)
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```
→ `npm run dev` 재시작.

### Vercel
**Settings → Environment Variables** 에 동일하게 두 개 추가 (Production / Preview / Development 모두 체크) → Redeploy.

## 5. 동작 확인

1. 사이트 우상단 **로그인** → Google 또는 Kakao
2. 책 노트 → **+ 도서 정보 검색** → 선택
3. 다른 기기(또는 시크릿 창)에서 같은 계정 로그인 → 같은 선택이 보이면 성공

> 처음 로그인 시, 기존에 이 브라우저(localStorage)에 저장돼 있던 선택들은 자동으로 클라우드로 1회 마이그레이션됩니다.

## 무료 티어 주의점

- 프로젝트가 **7일간 요청이 전혀 없으면 일시정지**됩니다. 대시보드에서 **Restore** 클릭 한 번이면 재개돼요. 가끔이라도 접속하면 유지됩니다.
- 500MB DB / 5만 MAU — 개인·소규모 용도엔 충분합니다.
