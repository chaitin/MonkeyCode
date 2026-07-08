package com.x8.launcher.bean;

import android.graphics.drawable.Drawable;

public class AppInfo {
    private String appName;
    private String packageName;
    private Drawable appIcon;
    private String versionName;
    private boolean isSystemApp;
    private boolean isHideApp;
    private boolean isDockApp;

    public String getAppName() { return appName; }
    public void setAppName(String appName) { this.appName = appName; }
    public String getPackageName() { return packageName; }
    public void setPackageName(String packageName) { this.packageName = packageName; }
    public Drawable getAppIcon() { return appIcon; }
    public void setAppIcon(Drawable appIcon) { this.appIcon = appIcon; }
    public String getVersionName() { return versionName; }
    public void setVersionName(String versionName) { this.versionName = versionName; }
    public boolean isSystemApp() { return isSystemApp; }
    public void setSystemApp(boolean systemApp) { isSystemApp = systemApp; }
    public boolean isHideApp() { return isHideApp; }
    public void setHideApp(boolean hideApp) { isHideApp = hideApp; }
    public boolean isDockApp() { return isDockApp; }
    public void setDockApp(boolean dockApp) { isDockApp = dockApp; }
}
