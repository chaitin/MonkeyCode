package com.x8.launcher.car;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import com.x8.launcher.bean.CarStatusInfo;

public class VehicleDataManager {
    private Context mContext;
    private CarStatusInfo current;

    public VehicleDataManager(Context context){
        this.mContext = context;
        current = new CarStatusInfo();
        registerCarStatusReceiver();
    }

    // 注册车况广播监听，解析车速、油量、空调、门窗数据
    private void registerCarStatusReceiver(){
        IntentFilter filter = new IntentFilter();
        // 示例私有广播，具体以车厂为准
        filter.addAction("com.lynk.action.VEHICLE_STATUS");
        mContext.registerReceiver(new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                // 解析车况数据并填充 current（示例字段）
                if ("com.lynk.action.VEHICLE_STATUS".equals(intent.getAction())){
                    current.setSpeed(intent.getFloatExtra("speed", 0f));
                    current.setFuelLevel(intent.getFloatExtra("fuel", 0f));
                }
            }
        }, filter);
    }

    // 获取最新整车状态数据
    public CarStatusInfo getCurrentCarInfo(){
        return current;
    }
}
