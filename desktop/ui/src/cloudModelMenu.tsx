// 云端模型分组菜单体:newtask 建任务与 cloudtask 会话切换共用同一分类
// 展示(档位/付费/我的/团队 + 徽标,groupCloudModels 的产物)。加载/空态
// 文案留在调用点(两处语境文案不同);onPick 传整个 model——newtask 需要
// 读 owner.type 做「公共模型 → 强制公共宿主机」。
import { ModelMenuItem } from "./chat";
import { cloudModelLabel, groupedCloudModelLabel, type McCloudModel, type McCloudModelGroup } from "./cloud";

export function CloudModelGroups({
  groups,
  selectedId,
  onPick,
}: {
  groups: McCloudModelGroup[];
  selectedId?: string;
  onPick: (model: McCloudModel) => void;
}) {
  return (
    <>
      {groups.map((group, index) => (
        <span
          key={group.key}
          style={{
            display: "flex",
            flexDirection: "column",
            paddingTop: index === 0 ? 0 : 4,
            marginTop: index === 0 ? 0 : 4,
            borderTop: index === 0 ? "none" : "1px solid var(--line2)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "5px 9px 3px" }}>
            <span className="ellipsis" style={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 750, color: "var(--t4)" }}>
              {group.label}
            </span>
            {group.badge && <span style={{ flex: "none", fontSize: 9.5, color: "var(--t6)" }}>{group.badge}</span>}
          </span>
          {group.models.map((model) => (
            // 组头已表达档位,条目不再带档位 tag;hover 兜底完整展示名。
            // locked(超会员档)灰态禁选,title 说明解锁路径
            <ModelMenuItem
              key={model.id}
              label={groupedCloudModelLabel(model)}
              title={model.locked ? `${cloudModelLabel(model)} · 当前会员档不可用,升级会员后可用` : cloudModelLabel(model)}
              selected={model.id === selectedId}
              disabled={model.locked}
              onClick={() => onPick(model)}
            />
          ))}
        </span>
      ))}
    </>
  );
}
