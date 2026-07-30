// 元素引用表:snapshot 建立 "e1".."eN" → ElemRef 映射。契约对齐 agent/internal/browser/refs.go。
// 无并发要求(外层会包锁)。

use std::collections::HashMap;

/// 一个元素引用的定位信息:object_id 定位远端对象;session_id 非空时
/// 该对象在跨源 iframe(OOPIF)的 flat 子会话里,CDP 命令须带此 sessionId。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ElemRef {
    pub session_id: String,
    pub object_id: String,
}

/// 元素引用表:页面导航/刷新即整表失效(交互工具据此报错引导重新 snapshot)。
#[derive(Debug, Default)]
pub struct RefTable {
    /// 快照代号,与页面内 window.__mcAgentGen 对应。
    gen: i64,
    /// None = 尚无快照 / 已失效(对齐 Go 的 nil map 语义)。
    refs: Option<HashMap<String, ElemRef>>,
}

/// ref 失效的统一错误(模型收到后会重新 snapshot,闭环)。文案逐字对齐 Go。
pub fn err_ref_stale(r: &str) -> String {
    format!(
        "元素引用 {} 不存在或已过期(页面可能已导航/刷新/重渲染),请先调用 browser_snapshot 获取最新元素列表",
        r
    )
}

impl RefTable {
    /// 新建空表(尚无快照)。
    #[allow(dead_code)] // Default 即空表;显式构造器保留对齐 Go
    pub fn new() -> Self {
        Self::default()
    }

    /// 本代快照的 CDP 对象组名(整组释放防泄漏)。
    pub fn object_group(&self) -> String {
        format!("mc-gen-{}", self.gen)
    }

    /// 用新一代映射整表替换(引用名按序为 e1..eN)。
    pub fn rebuild(&mut self, gen: i64, refs: Vec<ElemRef>) {
        self.gen = gen;
        let mut m = HashMap::with_capacity(refs.len());
        for (i, r) in refs.into_iter().enumerate() {
            m.insert(format!("e{}", i + 1), r);
        }
        self.refs = Some(m);
    }

    /// 按 ref 取定位信息。
    pub fn lookup(&self, r: &str) -> Result<ElemRef, String> {
        let Some(refs) = &self.refs else {
            return Err("尚无元素快照,请先调用 browser_snapshot".to_string());
        };
        match refs.get(r) {
            Some(e) => Ok(e.clone()),
            None => Err(err_ref_stale(r)),
        }
    }

    /// 整表失效(主 frame 导航时调用)。
    /// 当前快照代号(objectGroup 命名与递增判断用)。
    pub fn gen(&self) -> i64 {
        self.gen
    }

    pub fn invalidate(&mut self) {
        self.refs = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 契约对齐 snapshot_test.go 的 TestRefTable。
    #[test]
    fn test_ref_table() {
        let mut rt = RefTable::new();
        assert!(rt.lookup("e1").is_err(), "无快照时 lookup 应报错");
        rt.rebuild(
            2,
            vec![
                ElemRef {
                    object_id: "obj-a".to_string(),
                    ..Default::default()
                },
                ElemRef {
                    object_id: "obj-b".to_string(),
                    ..Default::default()
                },
            ],
        );
        assert_eq!(rt.object_group(), "mc-gen-2", "对象组名不对");
        let r = rt.lookup("e2").expect("lookup e2 应成功");
        assert!(
            r.object_id == "obj-b" && r.session_id.is_empty(),
            "lookup e2: {:?}",
            r
        );
        assert!(rt.lookup("e3").is_err(), "越界 ref 应报失效错");
        rt.invalidate();
        assert!(rt.lookup("e1").is_err(), "失效后 lookup 应报错");
    }
}
