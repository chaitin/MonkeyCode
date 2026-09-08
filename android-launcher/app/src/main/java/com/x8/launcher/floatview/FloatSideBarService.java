package com.x8.launcher.floatview;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

public class FloatSideBarService extends Service {
    private FloatBarManager floatBarManager;

    @Override
    public void onCreate() {
        super.onCreate();
        floatBarManager = new FloatBarManager(this);
        floatBarManager.createSideFloatView();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (floatBarManager != null) {
            floatBarManager.destroyFloatView();
        }
        try { startService(new Intent(this, FloatSideBarService.class)); } catch (Exception ignored) {}
    }
}
