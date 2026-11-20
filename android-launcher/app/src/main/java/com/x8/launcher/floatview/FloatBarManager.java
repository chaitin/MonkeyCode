package com.x8.launcher.floatview;

import android.content.Context;
import android.graphics.PixelFormat;
import android.os.Build;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import com.x8.launcher.R;

public class FloatBarManager {
    private Context mContext;
    private WindowManager windowManager;
    private View floatSideView;
    private WindowManager.LayoutParams layoutParams;

    public FloatBarManager(Context context) {
        this.mContext = context;
        windowManager = (WindowManager) mContext.getSystemService(Context.WINDOW_SERVICE);
    }

    public void createSideFloatView() {
        if (floatSideView != null) return;
        floatSideView = LayoutInflater.from(mContext).inflate(R.layout.layout_float_sidebar, null);
        initWindowParams();
        try {
            windowManager.addView(floatSideView, layoutParams);
        } catch (Exception e) {
            // ignore if cannot add (permission)
        }
        bindFloatEvent();
    }

    private void initWindowParams() {
        layoutParams = new WindowManager.LayoutParams();
        layoutParams.width = (int) (260 * mContext.getResources().getDisplayMetrics().density);
        layoutParams.height = WindowManager.LayoutParams.MATCH_PARENT;
        layoutParams.format = PixelFormat.TRANSLUCENT;
        layoutParams.type = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        layoutParams.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
        layoutParams.gravity = Gravity.START | Gravity.TOP;
        layoutParams.x = 0;
        layoutParams.y = 0;
    }

    private void bindFloatEvent() {
        floatSideView.setOnTouchListener(new View.OnTouchListener() {
            private int lastX, lastY;
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                int rawX = (int) event.getRawX();
                int rawY = (int) event.getRawY();
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        lastX = rawX;
                        lastY = rawY;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = rawX - lastX;
                        int dy = rawY - lastY;
                        layoutParams.x += dx;
                        layoutParams.y += dy;
                        try { windowManager.updateViewLayout(floatSideView, layoutParams); } catch (Exception ignored) {}
                        lastX = rawX; lastY = rawY;
                        return true;
                }
                return false;
            }
        });
    }

    public void destroyFloatView() {
        if (floatSideView != null) {
            try { windowManager.removeView(floatSideView); } catch (Exception ignored) {}
            floatSideView = null;
        }
    }
}
