package com.x8.launcher.receiver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.x8.launcher.floatview.FloatSideBarService;

public class BootCompleteReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            Intent service = new Intent(context, FloatSideBarService.class);
            context.startService(service);
            Intent launcherIntent = new Intent(context, com.x8.launcher.MainLauncherActivity.class);
            launcherIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launcherIntent);
        }
    }
}
