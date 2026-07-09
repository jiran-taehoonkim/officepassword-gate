import { appendFileSync } from "fs";
import { fileURLToPath } from "url";

const LOG = fileURLToPath(new URL("./gate-audit.log", import.meta.url));

// 접근·발급 기록 (누가·언제·무엇에·결과) — 시크릿 값은 절대 기록하지 않음
export function appendAudit(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  try { appendFileSync(LOG, line); } catch {}
  process.stderr.write("[audit] " + line);
}
export { LOG as AUDIT_LOG };
