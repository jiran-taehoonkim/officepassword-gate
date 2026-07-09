// safebox Gate Console — 브로커 활동을 실시간으로 보여주는 로컬 대시보드
// 좌: 자격증명 목록 / 우: 실시간 접근 감사 피드(gate-audit.log tail, SSE)
import { createServer } from "http";
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "fs";
import { fileURLToPath } from "url";
import { listSecrets } from "./safebox.mjs";

const PORT = process.env.CONSOLE_PORT || 8899;
const BASE = process.env.SAFEBOX_BASE;
const LOG = fileURLToPath(new URL("./gate-audit.log", import.meta.url));
const HTML = fileURLToPath(new URL("./console.html", import.meta.url));

function tailNew(state) {
  if (!existsSync(LOG)) return [];
  const size = statSync(LOG).size;
  if (size < state.pos) state.pos = 0; // 로그 리셋 대응
  if (size === state.pos) return [];
  const fd = openSync(LOG, "r");
  const buf = Buffer.alloc(size - state.pos);
  readSync(fd, buf, 0, buf.length, state.pos);
  closeSync(fd);
  state.pos = size;
  return buf.toString("utf8").split("\n").filter(Boolean);
}

const server = createServer(async (req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(HTML));
    return;
  }
  if (req.url === "/api/credentials") {
    try {
      const list = await listSecrets({ base: BASE });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list.map((r) => ({ title: r.title, icon: r.icon }))));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  if (req.url === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const state = { pos: existsSync(LOG) ? statSync(LOG).size : 0 };
    // 접속 시 기존 로그 전량 1회 전송
    if (existsSync(LOG)) {
      for (const line of readFileSync(LOG, "utf8").split("\n").filter(Boolean)) res.write(`data: ${line}\n\n`);
    }
    const timer = setInterval(() => {
      for (const line of tailNew(state)) res.write(`data: ${line}\n\n`);
    }, 800);
    req.on("close", () => clearInterval(timer));
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => console.log(`Gate Console → http://localhost:${PORT}`));
