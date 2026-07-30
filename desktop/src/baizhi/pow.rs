// Cap.js PoW 验证码求解(agent/internal/baizhi/pow.go 的 Rust 移植)。
// PoW 算法与服务端 github.com/ackcoder/go-cap 逐位对齐:
// FNV-1a 播种 + xorshift32 PRNG 生成盐与目标前缀,SHA-256 爆破 nonce。

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// PoW 质询参数:c 个子质询,盐长 s,目标前缀长 d(难度)。
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Challenge {
    pub c: usize,
    pub s: usize,
    pub d: usize,
}

/// FNV-1a 32 位哈希(按字节,对齐 JS charCodeAt(i)&0xff)。
fn fnv1a32(seed: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for b in seed.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

/// 确定性十六进制串:FNV-1a 播种 + xorshift32,每轮输出 8 位 hex。
fn prng(seed: &str, length: usize) -> String {
    let mut state = fnv1a32(seed);
    let mut out = String::new();
    while out.len() < length {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        out.push_str(&format!("{state:08x}"));
    }
    out.truncate(length);
    out
}

/// difficulty=3 一般几千次内命中,与移动端同上限。
const MAX_NONCE: u64 = 5_000_000;

/// 爆破单个子质询:找 nonce 使 sha256hex(salt+nonce) 以 target 为前缀。
fn solve_one(salt: &str, target: &str) -> Result<u64, String> {
    for nonce in 0..MAX_NONCE {
        let mut hasher = Sha256::new();
        hasher.update(salt.as_bytes());
        hasher.update(nonce.to_string().as_bytes());
        let digest = hasher.finalize();
        if has_hex_prefix(&digest, target) {
            return Ok(nonce);
        }
    }
    Err(format!("验证码计算超时(nonce 上限 {MAX_NONCE})"))
}

/// digest 的十六进制表示是否以 target 为前缀(逐 nibble 比对)。
fn has_hex_prefix(digest: &[u8], target: &str) -> bool {
    for (k, c) in target.bytes().enumerate() {
        let b = digest[k / 2];
        let nib = if k % 2 == 0 { b >> 4 } else { b & 0x0f };
        let want = match c {
            b'0'..=b'9' => c - b'0',
            b'a'..=b'f' => c - b'a' + 10,
            _ => return false,
        };
        if nib != want {
            return false;
        }
    }
    true
}

/// 求解整组质询:第 i 个(1 起)的盐 = prng(token+i, s),目标 = prng(token+i+"d", d)。
pub fn solve_challenges(token: &str, ch: Challenge) -> Result<Vec<u64>, String> {
    let mut solutions = Vec::with_capacity(ch.c);
    for i in 0..ch.c {
        let idx = (i + 1).to_string();
        let salt = prng(&format!("{token}{idx}"), ch.s);
        let target = prng(&format!("{token}{idx}d"), ch.d);
        let nonce = solve_one(&salt, &target).map_err(|e| format!("子质询 {}: {e}", i + 1))?;
        solutions.push(nonce);
    }
    Ok(solutions)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 对照 Go 测试(pow_test.go)的确定性行为:同种子同输出
    #[test]
    fn prng_deterministic() {
        assert_eq!(prng("abc", 8), prng("abc", 8));
        assert_ne!(prng("abc", 8), prng("abd", 8));
        assert_eq!(prng("x", 20).len(), 20);
    }

    #[test]
    fn solve_roundtrip() {
        // 用低难度自校验:解出的 nonce 满足前缀条件
        let token = "testtoken";
        let ch = Challenge { c: 2, s: 16, d: 2 };
        let sols = solve_challenges(token, ch).expect("solve");
        for (i, nonce) in sols.iter().enumerate() {
            let idx = (i + 1).to_string();
            let salt = prng(&format!("{token}{idx}"), ch.s);
            let target = prng(&format!("{token}{idx}d"), ch.d);
            let mut hasher = Sha256::new();
            hasher.update(salt.as_bytes());
            hasher.update(nonce.to_string().as_bytes());
            assert!(has_hex_prefix(&hasher.finalize(), &target));
        }
    }

    #[test]
    fn fnv_matches_reference() {
        // FNV-1a 32 参考向量:空串 = 0x811c9dc5,"a" = 0xe40c292c
        assert_eq!(fnv1a32(""), 0x811c9dc5);
        assert_eq!(fnv1a32("a"), 0xe40c292c);
    }
}
