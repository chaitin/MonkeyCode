package com.monkeycode.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidDownloaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
