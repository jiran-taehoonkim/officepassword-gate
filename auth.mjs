// 브로커 토큰 매니저 — access token 만료 시 refresh token으로 자동 갱신.
// (데모: 사람 세션 refresh token 대여 / 프로덕션: 브로커 전용 OAuth = 로드맵)
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const AUTH_BASE = process.env.SAFEBOX_AUTH_BASE || "https://auth.officemail.app/api/v1";
const STATE_FILE = fileURLToPath(new URL("./gate_state.json", import.meta.url));

// 회전형 refresh token 체인을 파일로 유지 (재시작에도 최신 토큰 사용). 파일이 있으면 파일이 우선.
function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return null; } }
const saved = loadState();
const state = {
  access: saved?.access || process.env.SAFEBOX_TOKEN || null,
  refresh: saved?.refresh || process.env.SAFEBOX_REFRESH_TOKEN || null,
  exp: saved?.exp || 0,
};
function persist() { try { writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} }

function decodeExpMs(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return (p.exp || 0) * 1000;
  } catch { return 0; }
}

async function doRefresh() {
  if (!state.refresh) throw new Error("refresh_token이 없어 갱신 불가 (SAFEBOX_REFRESH_TOKEN 필요)");
  const r = await fetch(`${AUTH_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: state.refresh }),
  });
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) throw new Error(`/auth/refresh 비정상 HTTP ${r.status}`);
  const j = await r.json();
  const d = j.data || j;
  if (!d.access_token) throw new Error(`refresh 실패: code=${j.code ?? r.status} ${j.message ?? ""}`);
  state.access = d.access_token;
  if (d.refresh_token) state.refresh = d.refresh_token; // 회전형 → 새 값 유지
  state.exp = decodeExpMs(state.access) || Date.now() + (d.expires_in ? d.expires_in * 1000 : 1200000);
  persist();
  process.stderr.write(`[auth] access token 갱신 완료 (만료 ${new Date(state.exp).toISOString()})\n`);
  return state.access;
}

export async function getAccessToken() {
  if (state.access && !state.exp) state.exp = decodeExpMs(state.access);
  if (state.access && Date.now() < state.exp - 60000) return state.access; // 만료 1분 전까진 재사용
  return doRefresh();
}

export async function forceRefresh() {
  return doRefresh();
}

// 현재 access token이 속한 계정(감사 표시용)
export async function getAccount() {
  const tok = await getAccessToken();
  try {
    const p = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString("utf8"));
    return { email: p.email || p.sub, userId: p.user_id, workspaceId: p.workspace_id };
  } catch { return {}; }
}
