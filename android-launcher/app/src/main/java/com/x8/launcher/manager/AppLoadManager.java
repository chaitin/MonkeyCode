package com.x8.launcher.manager;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import com.x8.launcher.bean.AppInfo;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class AppLoadManager {
    private Context mContext;
    private List<AppInfo> allAppList = new ArrayList<>();
    private List<AppInfo> desktopShowAppList = new ArrayList<>();

    public AppLoadManager(Context context) {
        this.mContext = context;
    }

    public void loadInstallAppList() {
        allAppList.clear();
        desktopShowAppList.clear();
        PackageManager pm = mContext.getPackageManager();
        Intent intent = new Intent(Intent.ACTION_MAIN, null);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> resolveInfoList = pm.queryIntentActivities(intent, 0);

        for (ResolveInfo resolveInfo : resolveInfoList) {
            AppInfo appInfo = new AppInfo();
            appInfo.setAppName(resolveInfo.loadLabel(pm).toString());
            String pkgName = resolveInfo.activityInfo.packageName;
            appInfo.setPackageName(pkgName);
            appInfo.setAppIcon(resolveInfo.loadIcon(pm));
            try {
                PackageInfo packageInfo = pm.getPackageInfo(pkgName, 0);
                appInfo.setSystemApp((packageInfo.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0);
            } catch (Exception e) {
                appInfo.setSystemApp(false);
            }
            allAppList.add(appInfo);
        }
        filterHideApp();
    }

    private void filterHideApp() {
        desktopShowAppList.addAll(allAppList);
    }

    public void sortAppByName() {
        Collections.sort(allAppList, new Comparator<AppInfo>() {
            @Override
            public int compare(AppInfo a, AppInfo b) {
                if (a.getAppName() == null) return -1;
                return a.getAppName().compareToIgnoreCase(b.getAppName());
            }
        });
        filterHideApp();
    }

    public void sortAppByUseCount() {
        // Placeholder: usage stats not implemented here. Keep original order.
    }

    public List<AppInfo> getAllAppList() {
        return allAppList;
    }

    public List<AppInfo> getDesktopShowAppList() {
        return desktopShowAppList;
    }
}
