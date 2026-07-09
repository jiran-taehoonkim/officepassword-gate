// safebox 안전 접근 게이트 — MCP 서버 (stdio)
// AI가 safebox 자격증명을 "보지 않고" 쓰게 한다: 목록→선택→브로커가 대신 호출→결과만 반환.
// 감사 기록은 "어떤 계정의 AI 토큰으로 · 어떤 리소스에 접근했나"까지 (브로커가 정직히 보증 가능한 층).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listSecrets, resolveAndDecrypt, resolveResource, getResourceFields } from "./safebox.mjs";
import { recentLogs, listLogGroups } from "./aws.mjs";
import { getAccount } from "./auth.mjs";
import { appendAudit } from "./audit.mjs";

const cfg = { base: process.env.SAFEBOX_BASE, masterPw: process.env.MASTER_PW };
const AGENT = process.env.AGENT_NAME || "AI agent";
const DEFAULT_REGION = process.env.AWS_REGION || "ap-northeast-2";

const server = new McpServer({ name: "safebox-gate", version: "0.4.0" });

// 접속한 AI 클라이언트의 자기소개(MCP clientInfo: 이름·버전) — Claude Code / Codex 등 자동 식별.
// 클라이언트가 신고하는 값이라 위조 가능(귀속·표시용). 없으면 AGENT_NAME env로 폴백.
function clientName() {
  try {
    const c = server.server.getClientVersion();
    if (c?.name) return c.name;
  } catch {}
  return AGENT;
}

// "어떤 계정의 AI 토큰으로 · 어떤 리소스에 접근" — 정직히 보증 가능한 감사 층
async function logAccess({ resource, result }) {
  let account = "-";
  try { account = (await getAccount()).email || "-"; } catch {}
  appendAudit({ agent: clientName(), account, resource: resource || "-", result });
}

server.registerTool("list_credentials", {
  title: "safebox 자격증명 목록",
  description: "safebox에 보관된 자격증명 목록(라벨·종류만, 값 없음)을 조회한다.",
  inputSchema: {},
}, async () => {
  const list = await listSecrets(cfg);
  // 목록 조회는 값(비밀)에 접근하지 않으므로 감사 피드에 남기지 않음 (실제 사용만 기록)
  return { content: [{ type: "text", text: `safebox 자격증명 목록 (값 미포함):\n${JSON.stringify(list.map((r) => ({ credential: r.title, type: r.icon })), null, 2)}` }] };
});

server.registerTool("use_credential", {
  title: "자격증명으로 API 호출 (safebox 게이트)",
  description: "safebox 자격증명(라벨/id)을 사용해 지정 API를 호출한다. 브로커가 Authorization 헤더에 비밀을 주입해 대신 호출하고 결과만 반환한다. 비밀 원본은 반환하지 않는다.",
  inputSchema: { credential: z.string(), url: z.string(), method: z.string().optional(), authScheme: z.string().optional() },
}, async ({ credential, url, method = "GET", authScheme = "Bearer" }) => {
  const { value: secret, resourceTitle } = await resolveAndDecrypt({ ...cfg, credential });
  let status, bodyText, err;
  try {
    const r = await fetch(url, { method, headers: { Authorization: `${authScheme} ${secret}`, "User-Agent": "safebox-gate", Accept: "application/json" } });
    status = r.status; bodyText = await r.text();
  } catch (e) { err = e.message; }
  await logAccess({ resource: resourceTitle, result: err ? "실패" : `사용(HTTP ${status})` });
  if (err) return { content: [{ type: "text", text: `호출 실패: ${err}` }] };
  let body; try { body = JSON.parse(bodyText); } catch { body = bodyText.slice(0, 300); }
  return { content: [{ type: "text", text: `[safebox 게이트] '${resourceTitle}'로 ${method} ${url} 호출 (비밀 미노출). HTTP ${status}\n${JSON.stringify(body, null, 2).slice(0, 1200)}` }] };
});

async function awsCreds(credential) {
  const res = await resolveResource({ base: cfg.base, credential });
  if (!res) throw new Error(`'${credential}' 자격증명을 safebox에서 못 찾음`);
  const { fields, resourceTitle } = await getResourceFields({ ...cfg, resourceId: res.id });
  const awsId = fields.AWS_ID || fields.aws_id || fields.AccessKeyId;
  const awsSecret = fields.AWS_SECRET || fields.aws_secret || fields.SecretAccessKey;
  if (!awsId || !awsSecret) throw new Error(`'${resourceTitle}'에 AWS_ID/AWS_SECRET 필드가 없음`);
  return { awsId, awsSecret, resourceTitle };
}

server.registerTool("aws_list_log_groups", {
  title: "AWS 로그그룹 목록 (safebox 게이트)",
  description: "safebox의 AWS 자격증명으로 CloudWatch 로그그룹 목록을 조회한다. AWS 키는 반환하지 않는다.",
  inputSchema: { credential: z.string(), prefix: z.string().optional(), region: z.string().optional() },
}, async ({ credential, prefix, region = DEFAULT_REGION }) => {
  const { awsId, awsSecret, resourceTitle } = await awsCreds(credential);
  let groups, err;
  try { groups = await listLogGroups({ awsId, awsSecret, region, prefix }); }
  catch (e) { err = `${e.name}: ${e.message}`; }
  await logAccess({ resource: resourceTitle, result: err ? "실패" : `사용(로그그룹 ${groups.length})` });
  if (err) return { content: [{ type: "text", text: `로그그룹 조회 실패: ${err}` }] };
  return { content: [{ type: "text", text: `[safebox 게이트] '${resourceTitle}'로 조회한 로그그룹(${region}):\n${JSON.stringify(groups, null, 2)}` }] };
});

server.registerTool("aws_recent_logs", {
  title: "AWS 최근 로그 조회 (safebox 게이트)",
  description: "safebox의 AWS 자격증명으로 지정 CloudWatch 로그그룹의 최근 N분 로그 이벤트를 가져온다. AWS 키는 반환하지 않으며 로그 이벤트만 반환한다.",
  inputSchema: { credential: z.string(), logGroup: z.string(), minutes: z.number().optional(), region: z.string().optional() },
}, async ({ credential, logGroup, minutes = 10, region = DEFAULT_REGION }) => {
  const { awsId, awsSecret, resourceTitle } = await awsCreds(credential);
  let events, err;
  try { events = await recentLogs({ awsId, awsSecret, region, logGroup, minutes }); }
  catch (e) { err = `${e.name}: ${e.message}`; }
  await logAccess({ resource: resourceTitle, result: err ? "실패" : `사용(로그 ${events.length}건)` });
  if (err) return { content: [{ type: "text", text: `로그 조회 실패: ${err}` }] };
  return { content: [{ type: "text", text: `[safebox 게이트] '${resourceTitle}'로 ${logGroup} 최근 ${minutes}분 로그 ${events.length}건 (AWS 키 미노출):\n${JSON.stringify(events, null, 2).slice(0, 5000)}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[safebox-gate] MCP 서버 시작 (v0.4 — 계정·리소스 접근 감사)\n");
