import { useEffect, useState } from "react";
import { apiRequest } from "@/utils/requestUtils";
import TeamMembersCard from "@/components/manager/team-members-card";
import TeamGroupsCard from "@/components/manager/team-groups-card";
import { toast } from "sonner";
import {
  resolveMemberLimit,
  resolveUsedSeats,
  type LicenseSeatStatus,
} from "./member-seat";

export default function TeamManagerMembers() {
  const [members, setMembers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [fallbackMemberLimit, setFallbackMemberLimit] = useState(0);
  const [licenseSeatStatus, setLicenseSeatStatus] = useState<LicenseSeatStatus | null>(null);
  const isOfflineEdition = import.meta.env.VITE_APP_EDITION === "offline";
  const memberLimit = resolveMemberLimit(fallbackMemberLimit, licenseSeatStatus);
  const usedSeats = resolveUsedSeats(members.length, licenseSeatStatus);

  const fetchMembers = async () => {
    await apiRequest('v1TeamsUsersList', { role: "user" }, [], (resp) => {
      if (resp.code === 0) {
        setMembers(resp.data?.members || []);
        setFallbackMemberLimit(resp.data?.member_limit || 0);
      } else {
        toast.error(resp.message || "获取成员列表失败")
      }
    })
  }

  const fetchLicenseStatus = async () => {
    await apiRequest('v1LicenseStatusList', {}, [], (resp) => {
      if (resp.code === 0) {
        setLicenseSeatStatus((resp.data ?? null) as LicenseSeatStatus | null);
      }
    }, () => {})
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

  const refreshMembers = async () => {
    await fetchMembers();
    if (isOfflineEdition) {
      await fetchLicenseStatus();
    }
  }

  useEffect(() => {
    fetchMembers();
    fetchGroups();
    if (isOfflineEdition) {
      fetchLicenseStatus();
    }
  }, [isOfflineEdition]);

  return (
    <div className="flex flex-row gap-4 w-full flex-1">
      <TeamMembersCard 
        members={members}
        memberLimit={memberLimit}
        usedSeats={usedSeats}
        groups={groups}
        onRefreshMembers={refreshMembers}
        onRefreshGroups={fetchGroups}
      />
      <TeamGroupsCard 
        groups={groups}
        members={members}
        onRefreshGroups={fetchGroups}
      />
    </div>
  )
}
