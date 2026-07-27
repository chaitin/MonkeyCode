fn main() {
    // 统计上报端点经 option_env! 在编译期内联(src/telemetry.rs)。option_env!
    // 的取值不在 cargo 的默认依赖图里:不显式声明,改了环境变量也命中旧缓存,
    // 打出来的包会带着上一次的地址——CI 换 secret 时静默失效。
    println!("cargo:rerun-if-env-changed=MC_MATOMO_URL");
    println!("cargo:rerun-if-env-changed=MC_MATOMO_SITE_ID");

    // 为应用自定义命令生成 ACL 权限(allow-<command>):
    // capability 中引用的每个自定义命令都必须在此登记。
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "get_config",
                "save_config",
                "take_ui_intent",
                "host_info",
                "show_main",
                "pet_native_render",
                "update_check",
                "update_install",
                "open_extension_dir",
                "open_log_dir",
                "list_wsl_distros",
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
                "session_open",
                "session_history",
                "session_outline",
                "session_frame",
                "session_close",
                "session_send",
                "session_call",
                "upload_file",
                "upload_read",
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
                "mc_logout",
                "mc_tasks",
                "mc_projects",
                "mc_task_info",
                "mc_task_rounds",
                "mc_task_stop",
                "mc_task_delete",
                "mc_task_create",
                "mc_task_options",
                "mc_upload",
                "mc_file_upload",
                "mc_file_download",
            ]),
        ),
    )
    .expect("tauri_build 失败")
}
