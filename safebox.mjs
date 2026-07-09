import { decryptPrivateKey, decryptField } from "./crypto.mjs";
import { getAccessToken, forceRefresh } from "./auth.mjs";

async function fetchJson(base, path, token) {
  const r = await fetch(`${base}${path}`, { headers: { Authorization: `JWT ${token}` } });
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return { httpStatus: r.status, nonJson: true };
  return { httpStatus: r.status, j: await r.json() };
}

// access token 만료(401) 시 자동 갱신 후 1회 재시도
async function getJson(base, path) {
  let token = await getAccessToken();
  let res = await fetchJson(base, path, token);
  if (res.j && res.j.code === 401) {
    token = await forceRefresh();
    res = await fetchJson(base, path, token);
  }
  if (res.nonJson) throw new Error(`safebox 비정상 응답 HTTP ${res.httpStatus} (서버 상태 확인)`);
  if (res.j.code !== 200) throw new Error(`safebox API ${res.j.code}: ${res.j.message}`);
  return res.j;
}

export async function listSecrets({ base }) {
  const j = await getJson(base, `/v1/resources`);
  return j.data.map((d) => ({ id: d.id, title: d.title, icon: d.icon, url: d.url }));
}

export async function resolveResource({ base, credential }) {
  const list = await listSecrets({ base });
  return (
    list.find((r) => r.id === credential) ||
    list.find((r) => r.title?.toLowerCase() === credential.toLowerCase()) ||
    list.find((r) => r.title?.toLowerCase().includes(credential.toLowerCase()))
  );
}

async function getPrivateKey({ base, masterPw }) {
  const me = await getJson(base, `/v1/users/me`);
  return decryptPrivateKey(me.data.user_key, masterPw);
}

export async function getSecretByResourceId({ base, masterPw, resourceId }) {
  const pem = await getPrivateKey({ base, masterPw });
  const j = await getJson(base, `/v1/resources/${resourceId}`);
  const rk = j.data.resource_key?.key;
  const sec = j.data.items.find((i) => i.encrypt && i.content);
  if (!rk || !sec) throw new Error("암호화 필드 또는 resource_key 없음");
  return { value: await decryptField(sec.content, rk, pem), label: sec.label, resourceTitle: j.data.title };
}

export async function getResourceFields({ base, masterPw, resourceId }) {
  const pem = await getPrivateKey({ base, masterPw });
  const j = await getJson(base, `/v1/resources/${resourceId}`);
  const rk = j.data.resource_key?.key;
  const fields = {};
  for (const it of j.data.items) {
    if (it.encrypt && it.content) fields[it.label] = await decryptField(it.content, rk, pem);
  }
  return { fields, resourceTitle: j.data.title };
}

export async function resolveAndDecrypt({ base, masterPw, credential }) {
  const hit = await resolveResource({ base, credential });
  if (!hit) throw new Error(`'${credential}' 자격증명을 safebox에서 못 찾음`);
  const dec = await getSecretByResourceId({ base, masterPw, resourceId: hit.id });
  return { ...dec, resourceId: hit.id, resourceTitle: hit.title };
}
