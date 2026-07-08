package com.x8.launcher.adapter;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.GridView;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import com.x8.launcher.R;
import com.x8.launcher.bean.AppInfo;
import java.util.List;

public class DesktopPageAdapter extends RecyclerView.Adapter<DesktopPageAdapter.PageViewHolder> {
    private Context mContext;
    private List<AppInfo> desktopAppList;

    public DesktopPageAdapter(Context context, List<AppInfo> list) {
        this.mContext = context;
        this.desktopAppList = list;
    }

    @NonNull
    @Override
    public PageViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        // 加载单页桌面图标网格布局
        View v = LayoutInflater.from(mContext).inflate(R.layout.item_desktop_page, parent, false);
        return new PageViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull PageViewHolder holder, int position) {
        // 简化：目前每页显示全部应用的一个 GridView，实际应按行列分页
        GridView gv = holder.itemView.findViewById(R.id.gv_app_grid);
        // adapter and drag logic to be implemented in full version
    }

    @Override
    public int getItemCount() {
        // 根据应用数量、桌面行列配置计算总页数，简化为 1
        return 1;
    }

    public static class PageViewHolder extends RecyclerView.ViewHolder {
        public PageViewHolder(@NonNull View itemView) {
            super(itemView);
        }
    }
}
