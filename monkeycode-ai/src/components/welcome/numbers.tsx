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
    <div className="w-full px-10 py-24">
      <div className="border rounded-md flex flex-col md:flex-row gap-10 md:gap-0 justify-between max-w-[1200px] w-full mx-auto py-6 px-16">
        <div className="text-center flex flex-col items-center gap-2">
          <div className="text-muted-foreground">注册用户</div>
          <div className="text-4xl cursor-default hover:font-semibold">{ntos(stats.users_count || 0)}</div>
        </div>
        <div className="text-center flex flex-col items-center gap-2">
          <div className="text-muted-foreground">完成开发任务</div>
          <div className="text-4xl cursor-default hover:font-semibold">{ntos(stats.tasks_count || 0)}</div>
        </div>
        <div className="text-center flex flex-col items-center gap-2">
          <div className="text-muted-foreground">GitHub Star</div>
          <div className="text-4xl cursor-default hover:font-semibold cursor-pointer" onClick={() => window.open("https://github.com/chaitin/monkeycode", "_blank")}>{ntos(stats.repo_stars || 0)}</div>
        </div>
      </div>
    </div>
  )
};

export default Numbers;