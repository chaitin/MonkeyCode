/**
 * Cap.js 工作量证明（PoW）验证码求解器。
 *
 * 后端用 github.com/ackcoder/go-cap（WithChallenge(50, 32, 3)）。协议：
 *  1. POST /api/v1/public/captcha/challenge  -> { challenge:{c,s,d}, token }
 *  2. 对 c 个子质询，按确定性 PRNG 推导 salt / target，
 *     爆破 nonce 使 sha256hex(salt+nonce) 以 target 为前缀。
 *  3. POST /api/v1/public/captcha/redeem  { token, solutions } -> { success, token }
 *     返回的 token 即登录所需的 captcha_token。
 *
 * 算法与 go-cap 的 prng / calculateHashHex 完全一致：
 *  - prng: 用 FNV-1a(32) 作种子，xorshift32 迭代，每轮输出 8 位十六进制。
 *  - 校验: sha256 十六进制前缀匹配。
 */
import { utf8ToBytes } from '@noble/hashes/utils';
import { authHeaders } from './client';
import { sha256Bytes } from './sha256fast';

interface ChallengeResp {
  challenge: { c: number; s: number; d: number };
  token: string;
  expires?: number;
}

interface RedeemResp {
  success: boolean;
  token?: string;
  message?: string;
  expires?: number;
}

/** FNV-1a 32 位哈希（对 ASCII 种子按字节计算）。 */
function fnv1a32(seed: string): number {
  let hash = 0x811c9dc5; // 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i) & 0xff;
    // 32 位乘法（FNV prime 0x01000193），用 imul 保证不丢精度
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 确定性十六进制串生成（对应 go-cap 的 prng）。 */
function prng(seed: string, length: number): string {
  let state = fnv1a32(seed);
  let result = '';
  while (result.length < length) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    result += state.toString(16).padStart(8, '0');
  }
  return result.slice(0, length);
}

const MAX_NONCE = 5_000_000; // difficulty=3 时一般几千次内命中，留足上限

/**
 * 求解单个子质询，返回命中的 nonce。
 * 热路径优化（c≈50、约 20w 次哈希）：
 *  - salt 字节只编码一次，nonce 的十进制 ASCII 直接写进复用缓冲区，避免每次 utf8ToBytes(salt+nonce)；
 *  - 只按目标长度逐个 nibble 比较 digest，避免每次把 32 字节 digest 转成 64 字符 hex。
 */
function solveOne(salt: string, target: string): number {
  const saltBytes = utf8ToBytes(salt);
  const sLen = saltBytes.length;
  const d = target.length;
  const targetNibbles = new Uint8Array(d);
  for (let k = 0; k < d; k++) targetNibbles[k] = parseInt(target[k], 16);

  const buf = new Uint8Array(sLen + 8); // nonce < 5e6 → 最多 7 位十进制
  buf.set(saltBytes, 0);

  for (let nonce = 0; nonce < MAX_NONCE; nonce++) {
    const ns = '' + nonce;
    const nLen = ns.length;
    for (let j = 0; j < nLen; j++) buf[sLen + j] = ns.charCodeAt(j);
    const digest = sha256Bytes(buf.subarray(0, sLen + nLen));

    let ok = true;
    for (let k = 0; k < d; k++) {
      const byte = digest[k >> 1];
      const nib = (k & 1) === 0 ? byte >> 4 : byte & 0x0f;
      if (nib !== targetNibbles[k]) { ok = false; break; }
    }
    if (ok) return nonce;
  }
  throw new Error('验证码计算超时');
}

/** 求解整组质询，返回 nonce 数组。 */
export function solveChallenges(challenge: ChallengeResp): number[] {
  const { c, s, d } = challenge.challenge;
  const { token } = challenge;
  const solutions: number[] = new Array(c);
  for (let i = 0; i < c; i++) {
    const idx = i + 1;
    const salt = prng(token + idx, s);
    const target = prng(token + idx + 'd', d);
    solutions[i] = solveOne(salt, target);
  }
  return solutions;
}

/**
 * 完整跑一遍验证码流程，返回可用于登录的 captcha_token。
 * baseUrl 形如 https://monkeycode-ai.com（无尾斜杠）。
 */
export async function obtainCaptchaToken(baseUrl: string): Promise<string> {
  const jsonHeaders = { 'Content-Type': 'application/json', ...authHeaders() };
  const challengeRes = await fetch(`${baseUrl}/api/v1/public/captcha/challenge`, {
    method: 'POST',
    headers: jsonHeaders,
  });
  if (!challengeRes.ok) {
    throw new Error(`获取验证码失败（${challengeRes.status}）`);
  }
  const challenge = (await challengeRes.json()) as ChallengeResp;
  if (!challenge?.token || !challenge?.challenge) {
    throw new Error('验证码响应格式异常');
  }

  const solutions = solveChallenges(challenge);

  const redeemRes = await fetch(`${baseUrl}/api/v1/public/captcha/redeem`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ token: challenge.token, solutions }),
  });
  const redeem = (await redeemRes.json()) as RedeemResp;
  if (!redeem?.success || !redeem.token) {
    throw new Error(redeem?.message || '验证码校验失败');
  }
  return redeem.token;
}
