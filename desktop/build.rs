fn main() {
    // 统计上报端点经 option_env! 在编译期内联(src/telemetry.rs)。option_env!
    // 的取值不在 cargo 的默认依赖图里:不显式声明,改了环境变量也命中旧缓存,
    // 打出来的包会带着上一次的地址——CI 换 secret 时静默失效。
    println!("cargo:rerun-if-env-changed=MC_MATOMO_URL");
    println!("cargo:rerun-if-env-changed=MC_MATOMO_SITE_ID");

    // uidist 产物完整性:release 在编译期整目录嵌入二进制,错位现场会被
    // 原样打进包里,必须在这里拦住。
    println!("cargo:rerun-if-changed=uidist/index.html");
    println!("cargo:rerun-if-changed=uidist/assets");
    validate_uidist();

    // 为应用自定义命令生成 ACL 权限(allow-<command>):
    // capability 中引用的每个自定义命令都必须在此登记。
    //
    // 新增一条命令要同时动三处:main.rs 的 invoke_handler、这里、以及
    // tauri.conf.json 里**用得到它的每个** capability。两个方向的失手代价
    // 不对称:capability 里名字写错是编译期硬错(UnknownPermission),而漏加
    // capability 只在运行期被 ACL 拒掉——UI 侧若把 invoke 的报错 catch 掉,
    // 症状就是"按钮点了没反应",编译与测试全绿。桌宠页与主窗口是两个
    // capability,只给一边放行同样是这个症状。
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "get_config",
                "save_config",
                "take_ui_intent",
                "host_info",
                "show_main",
                "pet_native_render",
                "sound_enabled",
                "set_sound_enabled",
                "update_check",
                "update_install",
                "open_extension_dir",
                "open_log_dir",
                "open_app_dir",
                "export_engine_log",
                "open_devtools",
                "window_system_menu",
                "list_wsl_distros",
                "wsl_workdir_base",
                "engine_restart",
                "engine_status",
                "probe_log",
                // 引擎驱动层(driver/mod.rs)
                "engine_caps",
                "browser_status",
                "browser_repair",
                "sessions_list",
                "session_create",
                "session_delete",
                "session_patch",
                "models_list",
                "usage_stats",
                "session_open",
                "session_history",
                "session_outline",
                "session_frame",
                "session_close",
                "session_send",
                "session_call",
                "upload_begin",
                "upload_chunk",
                "upload_finish",
                "upload_abort",
                "upload_file_path",
                "upload_read",
                "stat_dropped_file",
                "read_dropped_file",
                "cloud_ws_open",
                "cloud_ws_send",
                "cloud_ws_close",
                // 百智云/云端(baizhi/)
                "baizhi_status",
                "baizhi_send_code",
                "baizhi_login",
                "baizhi_logout",
                "baizhi_wechat_start",
                "baizhi_wechat_poll",
                "baizhi_sync",
                "mc_status",
                "mc_login",
                "mc_password_login",
                "mc_logout",
                "mc_usage",
                "mc_checkin",
                "mc_models_sync",
                "mc_models_revoke",
                "mc_tasks",
                "mc_projects",
                "mc_task_info",
                "mc_task_rounds",
                "mc_task_user_inputs",
                "mc_task_stop",
                "mc_task_delete",
                "mc_task_create",
                "mc_task_options",
                "mc_upload",
                "mc_file_upload",
                "mc_file_download",
                "mc_file_download_cancel",
                "mc_terminal_list",
            ]),
        ),
    )
    .expect("tauri_build 失败")
}

/// uidist 完整性:index.html 引用的 /assets/ 产物必须齐全。vite 开着
/// emptyOutDir(先清空再写),构建被打断或两次构建互踩会留下 index.html
/// 指向不存在 hash 的现场;运行期症状是资产协议 SPA 回退返回 text/html、
/// WKWebView 拒执行模块脚本——macOS 白屏,只有一条晦涩的 MIME 报错。
/// 在编译期把它变成一句人话。uidist 整体缺失沿用 tauri 宏自身的报错。
fn validate_uidist() {
    let Ok(index) = std::fs::read_to_string("uidist/index.html") else {
        return;
    };
    let mut missing = Vec::new();
    for part in index.split("\"/assets/").skip(1) {
        let Some(name) = part.split('"').next() else {
            continue;
        };
        if !std::path::Path::new("uidist/assets").join(name).is_file() {
            missing.push(name.to_string());
        }
    }
    assert!(
        missing.is_empty(),
        "desktop/uidist 产物不完整,index.html 引用了不存在的文件: {missing:?}\n\
         多半是上次 UI 构建被打断/互踩——先 `cd desktop/ui && npm run build` 重建再编译"
    );
}
