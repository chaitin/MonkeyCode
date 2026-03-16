import { useState, useEffect } from "react";
import { apiRequest } from "@/utils/requestUtils";
import type { DomainStats } from "@/api/Api";
import { toast } from "sonner";

const Numbers = () => {
  const [stats, setStats] = useState<DomainStats>({
    users_count: 0,
    tasks_count: 0,
    repo_stars: 0,
  });

  useEffect(() => {
    apiRequest('v1PublicStatsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setStats(resp.data);
      } else {
        toast.error(resp.message || '获取统计数据失败');
      }
    })
  }, []);

  const ntos = (num: number) => {
    return num.toLocaleString();
  };

  return (
    <div className="w-full px-6 sm:px-10 py-12 sm:py-16">
      <div className="max-w-[1200px] w-full mx-auto flex flex-col sm:flex-row gap-8 sm:gap-0 sm:divide-x divide-border">
        <div className="flex-1 flex flex-col items-center justify-center gap-1 py-4">
          <div className="text-sm text-muted-foreground">注册用户</div>
          <div className="text-3xl sm:text-4xl font-bold tabular-nums">{ntos(stats.users_count || 0)}</div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-1 py-4">
          <div className="text-sm text-muted-foreground">完成开发任务</div>
          <div className="text-3xl sm:text-4xl font-bold tabular-nums">{ntos(stats.tasks_count || 0)}</div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-1 py-4">
          <div className="text-sm text-muted-foreground">GitHub Star</div>
          <div className="text-3xl sm:text-4xl font-bold tabular-nums cursor-pointer hover:text-primary transition-colors" onClick={() => window.open("https://github.com/chaitin/monkeycode", "_blank")}>{ntos(stats.repo_stars || 0)}</div>
        </div>
      </div>
    </div>
  )
};

export default Numbers;