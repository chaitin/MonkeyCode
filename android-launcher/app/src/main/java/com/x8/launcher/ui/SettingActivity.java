package com.x8.launcher.ui;

import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;
import com.x8.launcher.R;

public class SettingActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_setting);
        initSettingView();
    }

    private void initSettingView() {
        // 绑定各个设置项点击事件 - 完整实现待补充
    }
}
