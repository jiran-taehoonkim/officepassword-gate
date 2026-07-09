// safebox 암호 체인 (extension/src/utils/crypto.ts 포팅, Node ESM)
// 마스터PW → PBKDF2/AES로 private key 복호화 → RSA-OAEP로 rsKey unwrap → AES로 필드 복호화
import forge from "node-forge";

const webCryptoPbkdf2 = async (password, salt, numIterations, keySize) => {
  const saltBuffer = new Uint8Array(salt.length);
  for (let i = 0; i < salt.length; i++) saltBuffer[i] = salt.charCodeAt(i);

  let passwordBuffer;
  if (typeof password === "string") passwordBuffer = new TextEncoder().encode(password);
  else passwordBuffer = password;

  const keyMaterial = await crypto.subtle.importKey(
    "raw", passwordBuffer, { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBuffer, iterations: numIterations, hash: "SHA-256" },
    keyMaterial, keySize << 3);
  return forge.util.createBuffer(bits).getBytes();
};

const generateKey = async (password, salt, numIterations = 100000, keySize = 32) =>
  webCryptoPbkdf2(password, salt, numIterations, keySize);

function decryptAES(ciphertext, key) {
  const ivStr = ciphertext.slice(0, 16);
  const iv = forge.util.createBuffer(ivStr);
  const decipher = forge.cipher.createDecipher("AES-CBC", key);
  decipher.start({ iv });
  decipher.update(forge.util.createBuffer(ciphertext.slice(16)));
  decipher.finish();
  return decipher.output.getBytes();
}

export async function decryptAESByKey(ciphertext, key, numIterations) {
  const salt = ciphertext.slice(0, 16);
  const keyBuffer = new Uint8Array(key.length);
  for (let i = 0; i < key.length; i++) keyBuffer[i] = key.charCodeAt(i);
  const enKey = await generateKey(keyBuffer, salt, numIterations);
  return decryptAES(ciphertext.slice(16), enKey);
}

const oaepOpts = {
  md: forge.md.sha256.create(),
  mgf1: forge.mgf.mgf1.create(forge.md.sha256.create()),
};

export const decodeBase64 = (b64) => forge.util.decode64(b64);

// JSON-quoted("...") 래핑 제거
function unquote(s) {
  if (typeof s === "string" && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  return s;
}

// 마스터 비밀번호로 암호화된 private key(base64) → PEM
export async function decryptPrivateKey(encryptedPrivateKeyBase64, masterPassword) {
  const clean = unquote(encryptedPrivateKeyBase64);
  const bytes = decodeBase64(clean);
  const pem = await decryptAESByKey(bytes, masterPassword.trim());
  if (typeof pem !== "string" || !(pem.includes("-----BEGIN") && pem.includes("PRIVATE KEY")))
    throw new Error("마스터 비밀번호 불일치 또는 private key 복호화 실패");
  return pem;
}

// enc_user_rs_key(base64) + privateKeyPem → rsKey(binary string)
export function unwrapResourceKey(encRsKeyBase64, privateKeyPem) {
  const encryptedBytes = forge.util.decode64(encRsKeyBase64);
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  return privateKey.decrypt(encryptedBytes, "RSA-OAEP", oaepOpts);
}

// 암호화된 필드값(base64) + enc_user_rs_key(base64) + privateKeyPem → 평문
export async function decryptField(encFieldBase64, encRsKeyBase64, privateKeyPem) {
  if (!encFieldBase64) return null;
  const rsKey = unwrapResourceKey(encRsKeyBase64, privateKeyPem);
  const bytes = forge.util.decode64(encFieldBase64);
  const decrypted = await decryptAESByKey(bytes, rsKey);
  return forge.util.decodeUtf8(decrypted);
}
