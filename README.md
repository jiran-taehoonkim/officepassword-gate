# safebox 「AI 안전 접근 게이트」 — Broker (MVP)

> 지란지교 해커톤 2026 출품작

AI가 회사의 접속키·비밀번호를 **직접 보지 않고도**, safebox에 보관된 자격증명으로 필요한 일을 수행하게 하는 **MCP 브로커**입니다.

핵심 문장: **"AI가 비밀을 알 필요 없이, 비밀을 쓰게 한다."**
— 복호화는 사용자 기기에서만 순간적으로 일어나고, **safebox 서버도·AI도 원본을 보지 못합니다(제로지식).**

---

## 이 저장소에 포함된 것 / 포함하지 않은 것

### ✅ 포함 (우리가 이번에 직접 작성한 코드)
| 파일 | 역할 |
| --- | --- |
| `server.mjs` | MCP 서버(브로커 본체) + 도구 4개 + 접속 AI 식별 + 감사 연동 |
| `safebox.mjs` | safebox REST 클라이언트(목록·사용자키·리소스), 토큰 만료 시 자동 재시도 |
| `auth.mjs` | 액세스 토큰 **자동 갱신**(refresh) + 회전 토큰 영속 + 계정 조회 |
| `crypto.mjs` | **제로지식 복호화 체인**(PBKDF2 → AES-CBC → RSA-OAEP) — safebox의 암호 방식을 Node로 재구현 |
| `aws.mjs` | AWS CloudWatch Logs 어댑터 |
| `audit.mjs` | 접근 기록(계정·AI·리소스) |
| `console.mjs` + `console.html` | 실시간 감사 대시보드(HTTP + SSE) |

### ❌ 포함하지 않은 것
- **officepassword(safebox) 기존 제품 코드** — 별도 사내 프로젝트라 이 저장소에 담지 않습니다. 브로커는 safebox의 **공개 API**와 **동일한 암호 방식**을 *이용*할 뿐, safebox 제품 소스는 포함하지 않습니다.
- **비밀·자격증명** — 토큰·마스터 비밀번호·AWS 키 등은 저장하지 않습니다. (`gate_state.json`, `node_modules`, 로그는 `.gitignore`로 제외)

---

## 동작 개요

```
AI(Claude Code / Codex 등) ──MCP(stdio)──▶ 브로커(server.mjs)
                                             │ 1. 접속 AI 식별(clientInfo)
                                             │ 2. 유효 토큰 확보(만료 시 자동 refresh)
                                             │ 3. safebox에서 암호문 + 사용자 개인키 fetch
                                             │ 4. 사용자 기기에서 복호화 (서버·AI 미노출)
                                             │ 5. 그 비밀로 대상 API(AWS/GitHub 등) 대신 호출
                                             │ 6. "계정·AI·리소스 접근" 감사 기록
                                             └──▶ AI에는 결과만 반환
```

## 도구(MCP tools)
- `list_credentials` — safebox 자격증명 목록(값 없이 라벨만)
- `use_credential` — 선택한 자격증명으로 임의 API 호출(Bearer 주입), 결과만 반환
- `aws_list_log_groups` / `aws_recent_logs` — AWS 자격증명으로 CloudWatch 로그 조회

---

## 세팅 & 사용

> ⚠️ 이 저장소를 clone한다고 **바로 실행되지 않습니다.** 브로커는 독립 앱이 아니라 **safebox에 붙는 게이트**라, 아래 4가지를 직접 준비해야 합니다.

### 0. 사전 준비 (내려받은 사람이 갖춰야 할 것)

| # | 준비물 | 설명 |
| --- | --- | --- |
| 1 | **Node.js 18+** | 런타임(저장소에 없음). `npm install`에 필요 |
| 2 | **safebox 계정** | 브로커는 safebox의 클라이언트. 본인 계정과 **네트워크 접근**이 있어야 함 |
| 3 | **safebox에 저장된 자격증명** | AI가 대신 쓸 API 토큰/AWS 키 등을 미리 safebox에 넣어둠 (아래 2절 필드 규칙) |
| 4 | **MCP 클라이언트** | Claude Code 등. `claude mcp add`로 이 브로커를 등록 |

### 1. 설치

```bash
npm install   # package.json 기준으로 의존성 4개 복구
```

### 2. safebox에 자격증명 저장 (필드 규칙)

브로커는 safebox 리소스의 **암호화(secure) 필드** 값만 복호화해서 씁니다. 도구별로 읽는 필드가 다릅니다.

- **일반 API 토큰** (`use_credential` 용): 리소스의 **첫 번째 암호화 필드**를 비밀로 사용합니다. GitHub PAT·API Key 등을 secure 필드에 저장하세요.
- **AWS 자격증명** (`aws_*` 용): 한 리소스 안에 아래 라벨의 secure 필드 **2개**를 만듭니다.
  - Access Key ID → 라벨 `AWS_ID` (또는 `aws_id`, `AccessKeyId`)
  - Secret Access Key → 라벨 `AWS_SECRET` (또는 `aws_secret`, `SecretAccessKey`)

### 3. 세션 토큰 확보 (데모 방식)

지금 MVP는 **사람 세션 토큰을 대여**하는 데모 방식입니다(정식은 브로커 전용 OAuth — 로드맵).
safebox 웹앱에 로그인한 상태에서 브라우저 개발자도구로 세션의 **refresh token**을 확보해 `SAFEBOX_REFRESH_TOKEN`에 넣습니다. 브로커가 만료 시 자동 갱신(회전 토큰 영속)합니다.

### 4. Claude Code에 등록

```bash
claude mcp add safebox-gate \
  -e SAFEBOX_BASE=<safebox API base, 예: https://dev-api.officepassword.kr> \
  -e SAFEBOX_AUTH_BASE=<auth API base, 예: https://auth.officemail.app/api/v1> \
  -e SAFEBOX_REFRESH_TOKEN=<세션 refresh token> \
  -e MASTER_PW=<safebox 마스터 비밀번호> \
  -e AWS_REGION=ap-northeast-2 \
  -- node /절대경로/safebox_broker/server.mjs
```

등록되면 Claude Code의 MCP 목록에 `safebox-gate ✔ Connected`로 뜹니다.

### 5. 사용 (AI에게 이렇게 시킵니다)

AI는 비밀을 **보지 않고** 브로커에게 "그 자격증명으로 대신 해줘"라고만 합니다.

```
> safebox의 AWS 자격증명으로 /ecs/officepassword-kr-dev 로그그룹의 최근 10분 로그 특이사항을 분석해줘
```

- AI는 `list_credentials`로 라벨을 고르고 → `aws_recent_logs`/`use_credential`을 호출
- 브로커가 사용자 기기에서 복호화 → AWS/GitHub API를 **대신 호출** → **결과만** AI에 반환
- **AWS 키·토큰 원본은 AI에게 전달되지 않음**

### 6. 실시간 감사 콘솔 (선택)

```bash
SAFEBOX_BASE=<safebox API base> SAFEBOX_AUTH_BASE=<auth API base> \
SAFEBOX_REFRESH_TOKEN=<...> node console.mjs
# → http://localhost:8899  (어떤 계정의 AI가 · 어떤 리소스에 접근했나 실시간 표시)
```

### 환경변수 레퍼런스

| 변수 | 필수 | 기본값 | 용도 |
| --- | :---: | --- | --- |
| `SAFEBOX_BASE` | ✅ | (없음) | safebox REST API base |
| `MASTER_PW` | ✅ | (없음) | 제로지식 복호화용 마스터 비밀번호 |
| `SAFEBOX_REFRESH_TOKEN` | ✅* | (없음) | 세션 refresh token(자동 갱신). *또는 `SAFEBOX_TOKEN`(단기 access token) |
| `SAFEBOX_AUTH_BASE` | | `https://auth.officemail.app/api/v1` | 토큰 갱신 엔드포인트 base |
| `AWS_REGION` | | `ap-northeast-2` | AWS 도구 기본 리전 |
| `CONSOLE_PORT` | | `8899` | 콘솔 포트 |
| `AGENT_NAME` | | `AI agent` | MCP clientInfo 없을 때 표시할 AI 이름 폴백 |

> 이 값들은 전부 비밀이라 저장소에 포함하지 않습니다. `gate_state.json`(갱신된 토큰 캐시)은 실행 중 자동 생성되며 `.gitignore` 대상입니다.

---

## 정직한 범위 (MVP)
- **실제 작동 검증 완료**: safebox에 보관된 GitHub PAT / AWS 자격증명으로 실 API 호출, AI엔 비밀 미노출, 접근 감사 기록.
- **데모 방식**: 지금은 *사람 세션 토큰 대여 + 마스터 비밀번호 env 전달*. 정식은 **브로커 전용 인증(OAuth) + 잠금해제 UI**가 필요 — 로드맵.
- **보안/신뢰**: 로컬 브로커는 기기 장악 시 사용 순간 노출 위험(모든 로컬 도구 공통). **권위 있는 감사는 서버측(safebox 접근 로그 + AWS CloudTrail 수집)**에 두는 것이 정석 — 로드맵.
- **배포**: npm/원격 MCP/데스크탑 앱으로 "원클릭 설치"화 — 로드맵.

## ⚠️ 주의
- 데모/PoC 코드입니다. **실제 비밀을 커밋하지 마세요**(`.gitignore` 참고).
