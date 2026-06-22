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
import TeamManagerManager from "./manager";
import { useTranslation } from "react-i18next";

export default function TeamManagerMembers() {
  const { t } = useTranslation();
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
        toast.error(resp.message || t("managerMembers.toast.fetchMembersFailed"))
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
        toast.error(resp.message || t("managerMembers.toast.fetchGroupsFailed"))
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
    <div className="flex w-full flex-1 flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("managerMembers.sections.admins")}</h2>
        </div>
        <TeamManagerManager />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("managerMembers.sections.members")}</h2>
        </div>
        <div className="flex flex-col gap-4 xl:flex-row">
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
      </section>
    </div>
  )
}
