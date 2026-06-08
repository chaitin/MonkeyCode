/**
 * SHA-256：原生优先，JS 兜底。
 *
 * 验证码 PoW 需要约 20w 次 sha256（c≈50、difficulty=3）。原生 JSI 实现
 * （react-native-quick-crypto，基于 nitro-modules）比纯 JS 快一个量级。
 * 原生模块在 Expo Go / 旧二进制里不存在 —— 此时回退到 @noble/hashes 的纯 JS 实现，
 * 保证两端都能跑（只是 Expo Go 里慢些）。
 */
import { sha256 as nobleSha256 } from '@noble/hashes/sha256';

type HashFn = (input: Uint8Array) => Uint8Array;

let nativeHash: HashFn | null = null;
try {
  // 守卫式 require：Expo Go / 未打入原生模块时会抛错，落到 JS 兜底。
  const qc = require('react-native-quick-crypto');
  const createHash = qc?.createHash ?? qc?.default?.createHash;
  if (typeof createHash === 'function') {
    const fn: HashFn = (input) => {
      const h = createHash('sha256');
      h.update(input);
      const out = h.digest();
      return out instanceof Uint8Array ? out : new Uint8Array(out);
    };
    fn(new Uint8Array([0x61])); // 冒烟测试，确认原生路径可用
    nativeHash = fn;
  }
} catch {
  nativeHash = null;
}

/** 当前是否走原生 SHA-256（true=quick-crypto，false=@noble JS 兜底）。 */
export const NATIVE_SHA256 = !!nativeHash;

/** 统一的 SHA-256：原生可用则原生，否则 @noble。 */
export const sha256Bytes: HashFn = nativeHash ?? ((input) => nobleSha256(input));
