// 壳内跨模块小工具(自给自足,不为一个函数引第三方 crate)。

/// 百分号编码:RFC 3986 unreserved(字母/数字/-_.~)之外的字节一律 %XX。
/// query 参数与 fragment 通用(main.rs 错误页 hash、monkeycode 云端 API 共用,
/// 之前两处各自手写一份逐字节相同的实现,合并于此)。
pub fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// 取锁并忽略中毒。
///
/// 桌面壳是长驻进程:一个线程在持锁期间 panic 后,若其余代码继续用裸
/// `unwrap()` 取锁,该锁保护的整个功能面(会话、桥、cookie 罐…)就在进程
/// 剩余生命周期里永久不可用——用户看到的是"重启才能好",而壳恰恰是不轻易
/// 重启的。宁可拿着可能不一致的数据继续跑并让上层自愈(壳有会话和解、
/// 引擎重启、配置备份三重兜底),也不要把一次局部 panic 放大成功能性死亡。
///
/// 此前壳内两种取锁姿势并存(裸 unwrap 与显式 into_inner),取哪种全看作者;
/// 统一到本方法后只剩一种。用扩展 trait 而非自由函数,是为了保住
/// `x.lock_ok()` 的链式调用形态。
pub trait LockExt<T> {
    fn lock_ok(&self) -> std::sync::MutexGuard<'_, T>;
}

impl<T> LockExt<T> for std::sync::Mutex<T> {
    fn lock_ok(&self) -> std::sync::MutexGuard<'_, T> {
        // 唯一允许直接处理 PoisonError 的地方。
        self.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 中毒后仍能取到锁,并且看得到 panic 前写入的数据。
    #[test]
    fn lock_ok_survives_poisoning() {
        let m = std::sync::Arc::new(std::sync::Mutex::new(0u32));
        let m2 = m.clone();
        let _ = std::thread::spawn(move || {
            // guard 必须在 panic 时仍然存活才会中毒:写成
            // `*m2.lock_ok() = 7;` 的话临时 guard 当场就 drop 了,锁不中毒。
            let mut held = m2.lock_ok();
            *held = 7;
            panic!("毒化持有中的锁");
        })
        .join();
        assert!(m.lock().is_err(), "前置条件:锁应已中毒");
        assert_eq!(*m.lock_ok(), 7);
    }

    #[test]
    fn urlencode_unreserved_passthrough() {
        assert_eq!(urlencode("AZaz09-_.~"), "AZaz09-_.~");
    }

    #[test]
    fn urlencode_escapes_reserved_and_utf8() {
        assert_eq!(urlencode("a b&c=d"), "a%20b%26c%3Dd");
        // 多字节 UTF-8 按字节逐个转义
        assert_eq!(urlencode("中"), "%E4%B8%AD");
    }
}
