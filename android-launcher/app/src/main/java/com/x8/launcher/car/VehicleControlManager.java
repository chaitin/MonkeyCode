package com.x8.launcher.car;

import android.content.Context;
import android.content.Intent;

public class VehicleControlManager {
    private Context mContext;

    public VehicleControlManager(Context context){
        this.mContext = context;
    }

    // 设置空调温度
    public void setAcTemp(int temp){
        Intent intent = new Intent("com.lynk.action.HVAC_CONTROL");
        intent.putExtra("temp_main",temp);
        mContext.sendBroadcast(intent);
    }

    // 控制电动尾门开关
    public void openTailGate(boolean open){
        Intent intent = new Intent("com.lynk.action.TAILGATE_CONTROL");
        intent.putExtra("open", open);
        mContext.sendBroadcast(intent);
    }

    // 切换驾驶模式 经济/舒适/运动
    public void changeDriveMode(int mode){
        Intent intent = new Intent("com.lynk.action.DRIVE_MODE_CHANGE");
        intent.putExtra("mode", mode);
        mContext.sendBroadcast(intent);
    }

    // 唤起360全景影像
    public void open360Camera(){
        Intent intent = new Intent("com.lynk.action.OPEN_360_CAMERA");
        mContext.sendBroadcast(intent);
    }
}
