package com.x8.launcher.util;

import android.content.Context;
import android.content.SharedPreferences;

public class SPUtil {
    private static final String SP_NAME = "xiaoba_launcher_config";
    private static SharedPreferences sp;

    public static void init(Context context) {
        if (sp == null) sp = context.getSharedPreferences(SP_NAME, Context.MODE_PRIVATE);
    }

    public static void putString(String key, String value) { sp.edit().putString(key, value).apply(); }
    public static String getString(String key, String defVal) { return sp.getString(key, defVal); }
    public static void putBoolean(String key, boolean value) { sp.edit().putBoolean(key, value).apply(); }
    public static boolean getBoolean(String key, boolean defVal) { return sp.getBoolean(key, defVal); }
    public static void putInt(String key, int value) { sp.edit().putInt(key, value).apply(); }
    public static int getInt(String key, int defVal) { return sp.getInt(key, defVal); }
    public static void clearAll() { sp.edit().clear().apply(); }
}
