package com.x8.launcher.receiver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.x8.launcher.manager.AppLoadManager;

public class AppInstallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        // 应用变更后重新加载应用列表，刷新桌面图标
        AppLoadManager manager = new AppLoadManager(context);
        manager.loadInstallAppList();
        // Note: to notify UI, use LocalBroadcast or observer pattern in a full implementation
    }
}
