// 按键组合解析 → CDP Input.dispatchKeyEvent 参数。契约对齐 agent/internal/browser/keys.go。

// 修饰键位掩码(CDP Input.dispatchKeyEvent modifiers)。
pub const MOD_ALT: i64 = 1;
pub const MOD_CTRL: i64 = 2;
pub const MOD_META: i64 = 4;
pub const MOD_SHIFT: i64 = 8;

/// 一个按键的 CDP Input.dispatchKeyEvent 参数(调用方据此拼 CDP params)。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyPress {
    /// DOM key 值。
    pub key: String,
    /// 物理键 code。
    pub code: String,
    /// windowsVirtualKeyCode。
    pub key_code: i64,
    /// char 事件文本(可打印键/回车)。
    pub text: String,
    /// 修饰键位掩码。
    pub modifiers: i64,
}

/// 常用命名键(键名不区分大小写):(key, code, keyCode, text)。
fn named_key(lower: &str) -> Option<(&'static str, &'static str, i64, &'static str)> {
    Some(match lower {
        "enter" => ("Enter", "Enter", 13, "\r"),
        "escape" | "esc" => ("Escape", "Escape", 27, ""),
        "tab" => ("Tab", "Tab", 9, ""),
        "backspace" => ("Backspace", "Backspace", 8, ""),
        "delete" => ("Delete", "Delete", 46, ""),
        "space" => (" ", "Space", 32, " "),
        "arrowup" => ("ArrowUp", "ArrowUp", 38, ""),
        "arrowdown" => ("ArrowDown", "ArrowDown", 40, ""),
        "arrowleft" => ("ArrowLeft", "ArrowLeft", 37, ""),
        "arrowright" => ("ArrowRight", "ArrowRight", 39, ""),
        "pageup" => ("PageUp", "PageUp", 33, ""),
        "pagedown" => ("PageDown", "PageDown", 34, ""),
        "home" => ("Home", "Home", 36, ""),
        "end" => ("End", "End", 35, ""),
        _ => return None,
    })
}

/// 解析 "Enter"、"Control+A"、"Shift+Tab" 形态的按键描述,
/// 返回按键定义与修饰键位掩码。
pub fn parse_key_combo(combo: &str) -> Result<KeyPress, String> {
    let parts: Vec<&str> = combo.split('+').collect();
    let n = parts.len();
    let mut mods: i64 = 0;
    let mut key_part = "";
    for (i, raw) in parts.iter().enumerate() {
        let p = raw.trim();
        let lower = p.to_lowercase();
        let is_last = i == n - 1;
        match lower.as_str() {
            "control" | "ctrl" => mods |= MOD_CTRL,
            "alt" => mods |= MOD_ALT,
            "shift" => mods |= MOD_SHIFT,
            "meta" | "cmd" | "command" => mods |= MOD_META,
            _ => {
                if !is_last {
                    return Err(format!(
                        "无法识别的修饰键 {:?}(支持 Control/Alt/Shift/Meta)",
                        p
                    ));
                }
                key_part = p;
            }
        }
        if is_last && key_part.is_empty() {
            return Err(format!("按键 {:?} 缺少主键(如 Control+A)", combo));
        }
    }
    // 命名键直接返回:不清 text(Ctrl+Enter 仍要产生回车文本,与 Go 一致)。
    if let Some((key, code, key_code, text)) = named_key(&key_part.to_lowercase()) {
        return Ok(KeyPress {
            key: key.to_string(),
            code: code.to_string(),
            key_code,
            text: text.to_string(),
            modifiers: mods,
        });
    }
    // 单字符键(字母/数字/符号)
    let chars: Vec<char> = key_part.chars().collect();
    if chars.len() != 1 {
        return Err(format!(
            "不支持的按键 {:?};支持单字符或 {}",
            key_part,
            named_key_list()
        ));
    }
    let ch = chars[0];
    let mut code = String::new();
    let mut key_code: i64 = 0;
    if ch.is_ascii_lowercase() {
        code = format!("Key{}", ch.to_ascii_uppercase());
        key_code = ch.to_ascii_uppercase() as i64;
    } else if ch.is_ascii_uppercase() {
        code = format!("Key{}", ch);
        key_code = ch as i64;
    } else if ch.is_ascii_digit() {
        code = format!("Digit{}", ch);
        key_code = ch as i64;
    }
    // 带 Ctrl/Meta 的组合键不产生 char 文本(避免把字符输入进页面)
    let text = if mods & (MOD_CTRL | MOD_META | MOD_ALT) != 0 {
        String::new()
    } else {
        ch.to_string()
    };
    Ok(KeyPress {
        key: ch.to_string(),
        code,
        key_code,
        text,
        modifiers: mods,
    })
}

fn named_key_list() -> &'static str {
    "Enter/Escape/Tab/Backspace/Delete/Space/Arrow*/PageUp/PageDown/Home/End"
}

#[cfg(test)]
mod tests {
    use super::*;

    // 契约对齐 snapshot_test.go 的 TestParseKeyCombo。
    #[test]
    fn test_parse_key_combo() {
        let kp = parse_key_combo("Enter").expect("Enter 应解析成功");
        assert!(
            kp.key == "Enter" && kp.key_code == 13 && kp.text == "\r" && kp.modifiers == 0,
            "Enter: {:?}",
            kp
        );
        let kp = parse_key_combo("Control+A").expect("Control+A 应解析成功");
        assert!(
            kp.modifiers == MOD_CTRL && kp.code == "KeyA" && kp.text.is_empty(),
            "Control+A: {:?}(组合键不应产生 char 文本)",
            kp
        );
        let kp = parse_key_combo("shift+Tab").expect("shift+Tab 应解析成功");
        assert_eq!(kp.modifiers, MOD_SHIFT, "shift+Tab: {:?}", kp);
        assert!(parse_key_combo("Foo+Bar").is_err(), "未知修饰键应报错");
        assert!(parse_key_combo("F13").is_err(), "不支持的键名应报错");
        let kp = parse_key_combo("a").expect("单字符键应解析成功");
        assert!(
            kp.text == "a" && kp.key_code == 'A' as i64,
            "单字符键: {:?}",
            kp
        );
    }
}
