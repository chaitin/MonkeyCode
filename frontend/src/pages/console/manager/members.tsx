import { useEffect, useState } from "react";
import { apiRequest } from "@/utils/requestUtils";
import TeamMembersCard from "@/components/manager/team-members-card";
import TeamGroupsCard from "@/components/manager/team-groups-card";
import { toast } from "sonner";

export default function TeamManagerMembers() {
  const [members, setMembers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [memberLimit, setMemberLimit] = useState(0);

  const fetchMembers = async () => {
    await apiRequest('v1TeamsUsersList', { role: "user" }, [], (resp) => {
      if (resp.code === 0) {
        setMembers(resp.data?.members || []);
        setMemberLimit(resp.data?.member_limit || 0);
      } else {
        toast.error(resp.message || "获取成员列表失败")
      }
    })
  }

  const fetchGroups = async () => {
    await apiRequest('v1TeamsGroupsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setGroups(resp.data?.groups || []);
      } else {
        toast.error(resp.message || "获取分组列表失败")
      }
    })
  }

  useEffect(() => {
    fetchMembers();
    fetchGroups();
  }, []);

  return (
    <div className="flex flex-row gap-4 w-full flex-1">
      <TeamMembersCard 
        members={members}
        memberLimit={memberLimit}
        groups={groups}
        onRefreshMembers={fetchMembers}
      />
      <TeamGroupsCard 
        groups={groups}
        members={members}
        onRefreshGroups={fetchGroups}
      />
    </div>
  )
}
