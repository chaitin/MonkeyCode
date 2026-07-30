// 极简持久化 cookie 罐(agent/internal/baizhi/cookies.go 的 Rust 移植):
// RFC 6265 的域后缀 + 路径前缀匹配,JSON 落盘(0600,登录凭证)。
// 公共后缀防护做最小化:update() 拒收 TLD 级(无点)Domain 属性——
// Service::fetch() 是 pub 的、对任意 URL 用本罐收发 cookie(微信授权页等
// 第三方页面),放行 Domain=cloud/com 会让被刮取站点种下匹配 *.cloud 的
// cookie 污染后续请求;完整 PSL 表仍不引入,流量面窄,TLD 级已覆盖实际风险。
//
// 会话 cookie(无过期时间)也持久化——它就是登录凭证本身,桌面场景的
// 预期是"登录一次长期有效",真实有效期以服务端 401 为准。

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use crate::util::LockExt;

#[derive(Clone, Serialize, Deserialize)]
struct StoredCookie {
    name: String,
    value: String,
    /// 无前导点;host_only 区分匹配语义
    domain: String,
    /// 缺省 "/"
    path: String,
    /// RFC3339;None = 会话 cookie。与 Go 侧 time.Time JSON 格式互通。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expires: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    host_only: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    secure: bool,
}

fn parse_rfc3339(s: &str) -> Option<SystemTime> {
    // 只需秒级精度判断过期。time 已在依赖树(cookie crate 的 Expires 解析),
    // 直接用它:严格校验月/日范围,2026-13-45 这类非法日期解析即失败,
    // 不会像手写历算那样"算出"一个错误时刻。
    let dt = time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()?;
    let unix = dt.unix_timestamp();
    if unix < 0 {
        return None;
    }
    Some(UNIX_EPOCH + Duration::from_secs(unix as u64))
}

fn to_rfc3339(t: SystemTime) -> String {
    let ms = t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    crate::config::ms_to_rfc3339(ms)
}

impl StoredCookie {
    fn expired(&self, now: SystemTime) -> bool {
        match &self.expires {
            Some(s) => parse_rfc3339(s).map(|t| now > t).unwrap_or(false),
            None => false,
        }
    }

    /// cookie 是否随发给 host+path 的请求携带。
    fn matches(&self, host: &str, path: &str) -> bool {
        if self.host_only {
            if host != self.domain {
                return false;
            }
        } else if host != self.domain && !host.ends_with(&format!(".{}", self.domain)) {
            return false;
        }
        let cp = if self.path.is_empty() { "/" } else { &self.path };
        path == cp || path.starts_with(&format!("{}/", cp.trim_end_matches('/')))
    }
}

/// 持久化 cookie 罐;path 为 None 时仅内存(测试)。
pub struct CookieStore {
    path: Option<PathBuf>,
    list: Mutex<Vec<StoredCookie>>,
}

impl CookieStore {
    /// 创建并尝试从磁盘恢复;文件不存在或损坏都从空开始(登录态可重建)。
    pub fn new(path: Option<PathBuf>) -> Self {
        let mut list = Vec::new();
        if let Some(p) = &path {
            if let Ok(data) = std::fs::read(p) {
                if let Ok(loaded) = serde_json::from_slice::<Vec<StoredCookie>>(&data) {
                    let now = SystemTime::now();
                    list = loaded.into_iter().filter(|c| !c.expired(now)).collect();
                }
            }
        }
        Self { path, list: Mutex::new(list) }
    }

    /// 吸收一条响应的 Set-Cookie 集合(覆盖同名同域同路径;过期/负 Max-Age 删除)。
    /// req_url 为发起请求的 URL(host-only 归属判定)。
    pub fn update(&self, req_url: &reqwest::Url, set_cookies: &[String]) {
        if set_cookies.is_empty() {
            return;
        }
        let now = SystemTime::now();
        let host = req_url.host_str().unwrap_or("").to_string();
        let mut list = self.list.lock_ok();
        for raw in set_cookies {
            let Ok(c) = cookie::Cookie::parse(raw.clone()) else { continue };
            let mut sc = StoredCookie {
                name: c.name().to_string(),
                value: c.value().to_string(),
                domain: c.domain().unwrap_or("").trim_start_matches('.').to_string(),
                path: c.path().unwrap_or("").to_string(),
                expires: None,
                host_only: false,
                secure: c.secure().unwrap_or(false),
            };
            // 公共后缀最小防护:Domain=cloud/com/cn 这类 TLD 级(无点)后缀能
            // 域匹配同 TLD 下任意主机——fetch() 对任意 URL 用本罐收发 cookie,
            // 放行等于允许被刮取的第三方页面污染 *.cloud 请求,整条拒收
            // (RFC 6265 §5.3 对公共后缀的处置)。与请求 host 完全相等的单标签
            // 主机(localhost 联调)不在此列,照常入罐。
            if !sc.domain.is_empty() && sc.domain != host && !sc.domain.contains('.') {
                continue;
            }
            // RFC 6265:无 Domain 属性,或属性与请求 host 不匹配,都按 host-only 处理
            if sc.domain.is_empty()
                || (host != sc.domain && !host.ends_with(&format!(".{}", sc.domain)))
            {
                sc.domain = host.clone();
                sc.host_only = true;
            }
            if sc.path.is_empty() {
                sc.path = "/".into();
            }
            match c.max_age() {
                Some(ma) if ma.whole_seconds() > 0 => {
                    sc.expires =
                        Some(to_rfc3339(now + Duration::from_secs(ma.whole_seconds() as u64)));
                }
                Some(_) => {
                    // 零/负 Max-Age = 立即过期(删除)
                    sc.expires = Some(to_rfc3339(now - Duration::from_secs(3600)));
                }
                None => {
                    if let Some(cookie::Expiration::DateTime(dt)) = c.expires() {
                        let unix = dt.unix_timestamp();
                        if unix > 0 {
                            sc.expires = Some(to_rfc3339(UNIX_EPOCH + Duration::from_secs(unix as u64)));
                        }
                    }
                }
            }
            if let Some(slot) = list
                .iter_mut()
                .find(|e| e.name == sc.name && e.domain == sc.domain && e.path == sc.path)
            {
                *slot = sc;
            } else {
                list.push(sc);
            }
        }
        list.retain(|c| !c.expired(now));
        // 锁内只序列化出字节,写盘放到锁外:update 的调用点都在 async 请求链上,
        // 持锁跨同步磁盘 IO 会把并发请求的 cookie 读写一起卡在盘上。
        // 并发 update 的两次落盘理论上可能乱序(旧快照后写),但罐以内存为准、
        // 每次 update 全量重写,偶发旧快照会被下一次写覆盖,可接受。
        let data = serde_json::to_vec_pretty(&*list).ok();
        drop(list);
        if let Some(data) = data {
            self.persist(&data);
        }
    }

    /// 拼请求应携带的 Cookie 头;无匹配返回 None。
    pub fn header(&self, url: &reqwest::Url) -> Option<String> {
        let now = SystemTime::now();
        let host = url.host_str().unwrap_or("");
        let path = if url.path().is_empty() { "/" } else { url.path() };
        let secure = url.scheme() == "https";
        let list = self.list.lock_ok();
        let parts: Vec<String> = list
            .iter()
            .filter(|c| !c.expired(now) && (!c.secure || secure) && c.matches(host, path))
            .map(|c| format!("{}={}", c.name, c.value))
            .collect();
        if parts.is_empty() {
            None
        } else {
            Some(parts.join("; "))
        }
    }

    /// 清空全部 cookie 并删除落盘文件(登出)。
    pub fn clear(&self) {
        let mut list = self.list.lock_ok();
        list.clear();
        if let Some(p) = &self.path {
            let _ = std::fs::remove_file(p);
        }
    }

    /// 是否没有任何(未过期)cookie。
    pub fn is_empty(&self) -> bool {
        let now = SystemTime::now();
        self.list.lock_ok().iter().all(|c| c.expired(now))
    }

    /// 把序列化好的罐内容落盘(调用方须已释放 list 锁)。
    ///
    /// 与权威配置共用 `config::atomic_write_private`——凭证文件不该比
    /// config.json 落得更弱:该函数以 0600 **创建**临时文件(旧实现先
    /// `fs::write` 后 `set_permissions`,登录 cookie 有一瞬间是默认 umask)、
    /// fsync 文件与父目录、再做跨平台原子替换(Windows 上裸 `fs::rename`
    /// 覆盖既有目标会直接失败)。
    fn persist(&self, data: &[u8]) {
        let Some(p) = &self.path else { return };
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
        }
        // 落盘失败此前完全静默(登出后 cookie 仍在盘上、或登录态丢失都无征兆)。
        if let Err(e) = crate::config::atomic_write_private(p, data) {
            eprintln!("[desktop] cookie 罐落盘失败({}): {e}", p.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> reqwest::Url {
        reqwest::Url::parse(s).unwrap()
    }

    /// 凭证落盘的终态不变量:文件 0600、覆盖既有文件不失败、重开可读回、
    /// 不留临时文件残渣。
    ///
    /// 注意本测试**不能**证明"0600 在创建瞬间即生效"——那是先 write 后
    /// chmod 留下的 umask 时间窗,终态与正确实现一致,单测观察不到。该性质
    /// 由 persist() 走 config::atomic_write_private(以 mode(0o600) 创建)
    /// 保证;此处锁住的是回归防线。
    #[test]
    fn persisted_jar_is_private_and_reloadable() {
        let dir = std::env::temp_dir().join(format!("mc-cookie-persist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("baizhi-cookies.json");

        let store = CookieStore::new(Some(path.clone()));
        store.update(&url("https://baizhi.cloud/api/v1/login"), &["sid=abc; Path=/; Domain=baizhi.cloud".into()]);
        assert!(path.is_file(), "首次落盘应创建罐文件");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "cookie 罐必须只有属主可读写");
        }

        // 覆盖既有文件:旧实现的裸 rename 在 Windows 上会失败。
        store.update(&url("https://baizhi.cloud/x"), &["other=1; Path=/; Domain=baizhi.cloud".into()]);
        let reloaded = CookieStore::new(Some(path.clone()));
        let header = reloaded.header(&url("https://baizhi.cloud/api/v1/user/profile")).unwrap();
        assert!(header.contains("sid=abc"), "重开后应读回 sid: {header}");
        assert!(header.contains("other=1"), "重开后应读回 other: {header}");

        // 登出删文件,且不留临时文件残渣。
        reloaded.clear();
        assert!(!path.exists());
        let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).collect();
        assert!(leftovers.is_empty(), "目录应无临时文件残留: {:?}", leftovers.iter().map(|e| e.file_name()).collect::<Vec<_>>());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_and_match() {
        let store = CookieStore::new(None);
        store.update(&url("https://baizhi.cloud/api/v1/login"), &["sid=abc; Path=/; Domain=baizhi.cloud".into()]);
        // 域后缀匹配:子域也带
        assert_eq!(store.header(&url("https://baizhi.cloud/api/v1/user/profile")).unwrap(), "sid=abc");
        assert_eq!(store.header(&url("https://app.baizhi.cloud/x")).unwrap(), "sid=abc");
        assert!(store.header(&url("https://other.cloud/x")).is_none());
        assert!(!store.is_empty());
    }

    #[test]
    fn host_only_when_no_domain_attr() {
        let store = CookieStore::new(None);
        store.update(&url("https://baizhi.cloud/"), &["sid=abc; Path=/".into()]);
        assert!(store.header(&url("https://app.baizhi.cloud/")).is_none());
        assert_eq!(store.header(&url("https://baizhi.cloud/")).unwrap(), "sid=abc");
    }

    #[test]
    fn mismatched_domain_attr_becomes_host_only() {
        // 联调假服务在 localhost 却声明 .baizhi.cloud → host-only 处理
        let store = CookieStore::new(None);
        store.update(&url("http://localhost:8080/"), &["sid=abc; Domain=baizhi.cloud".into()]);
        assert!(store.header(&url("https://baizhi.cloud/")).is_none());
        assert_eq!(store.header(&url("http://localhost:8080/")).unwrap(), "sid=abc");
    }

    #[test]
    fn secure_requires_https() {
        let store = CookieStore::new(None);
        store.update(&url("https://baizhi.cloud/"), &["sid=abc; Secure".into()]);
        assert!(store.header(&url("http://baizhi.cloud/")).is_none());
        assert_eq!(store.header(&url("https://baizhi.cloud/")).unwrap(), "sid=abc");
    }

    #[test]
    fn negative_max_age_deletes() {
        let store = CookieStore::new(None);
        store.update(&url("https://baizhi.cloud/"), &["sid=abc".into()]);
        assert!(!store.is_empty());
        store.update(&url("https://baizhi.cloud/"), &["sid=; Max-Age=0".into()]);
        assert!(store.is_empty());
    }

    #[test]
    fn path_prefix_match() {
        let store = CookieStore::new(None);
        store.update(&url("https://x.cn/api/"), &["a=1; Path=/api".into()]);
        assert!(store.header(&url("https://x.cn/api/v1")).is_some());
        assert!(store.header(&url("https://x.cn/apix")).is_none());
    }

    #[test]
    fn rfc3339_roundtrip() {
        let t = UNIX_EPOCH + Duration::from_secs(1_789_000_000);
        let s = to_rfc3339(t);
        assert_eq!(parse_rfc3339(&s).unwrap(), t);
        // Go 侧格式(带偏移)也能读
        assert!(parse_rfc3339("2026-07-19T12:00:00+08:00").is_some());
        assert!(parse_rfc3339("2026-07-19T12:00:00.123456789Z").is_some());
    }

    #[test]
    fn rfc3339_rejects_invalid_dates() {
        // 非法月/日必须失败(手写历算曾把 2026-13-45 "算成"一个错误时刻)
        assert!(parse_rfc3339("2026-13-45T12:00:00Z").is_none());
        assert!(parse_rfc3339("2026-02-30T00:00:00Z").is_none());
        assert!(parse_rfc3339("2026-00-01T00:00:00Z").is_none());
        // 缺时区/纯垃圾也失败
        assert!(parse_rfc3339("2026-07-19T12:00:00").is_none());
        assert!(parse_rfc3339("垃圾").is_none());
    }

    #[test]
    fn tld_level_domain_rejected() {
        let store = CookieStore::new(None);
        // 被刮取的第三方页面尝试种 Domain=cloud 污染 *.cloud 请求 → 整条拒收
        store.update(&url("https://evil.cloud/x"), &["sid=hack; Domain=cloud; Path=/".into()]);
        assert!(store.is_empty());
        assert!(store.header(&url("https://baizhi.cloud/")).is_none());
        // 单标签主机自身声明同名 Domain(localhost 联调)不受影响
        store.update(&url("http://localhost/"), &["a=1; Domain=localhost".into()]);
        assert_eq!(store.header(&url("http://localhost/")).unwrap(), "a=1");
    }
}
