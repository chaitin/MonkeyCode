import { ConstsGitPlatform, ConstsOwnerType, type DomainGitIdentity, type DomainHost, type DomainImage, type DomainModel, type DomainProject, type DomainProjectTask, type DomainSubscriptionResp, type DomainUser, type DomainVirtualMachine } from '@/api/Api';
import { useAppRuntime } from '@/components/app-runtime-provider';
import { WechatMpBindDialog } from '@/components/console/wechat-mp-bind-dialog';
import { getImageShortName } from '@/utils/common';
import { IS_OFFLINE_EDITION } from '@/utils/edition';
import { apiRequest } from '@/utils/requestUtils';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

type CommonData = {
  user: DomainUser;
  reloadUser: () => Promise<DomainUser>;

  hosts: DomainHost[];
  vms: DomainVirtualMachine[];
  loadingHosts: boolean;
  hostsInited: boolean;
  reloadHosts: () => void;

  models: DomainModel[];
  loadingModels: boolean;
  reloadModels: () => void;

  images: DomainImage[];
  loadingImages: boolean;
  reloadImages: () => void;

  identities: DomainGitIdentity[];
  loadingIdentities: boolean;
  reloadIdentities: () => void;

  balance: number;
  dailyBasicTokenBalance: number;
  dailyProTokenBalance: number;
  dailyUltraTokenBalance: number;
  checkedInToday: boolean | null;
  loadingCheckinStatus: boolean;
  reloadCheckinStatus: () => void;
  reloadWallet: () => void;
  subscription: DomainSubscriptionResp | null;
  loadingSubscription: boolean;
  reloadSubscription: () => void;

  members: DomainUser[];
  loadingMembers: boolean;
  reloadMembers: () => void;

  projects: DomainProject[];
  loadingProjects: boolean;
  reloadProjects: () => void;

  /** Unlinked quick_start tasks for the empty project group in the sidebar. */
  unlinkedTasks: DomainProjectTask[];
  loadingUnlinkedTasks: boolean;
  reloadUnlinkedTasks: () => void;

  /** Recent tasks for the history group in the sidebar. */
  historicalTasks: DomainProjectTask[];
  loadingHistoricalTasks: boolean;
  reloadHistoricalTasks: () => void;
};

const DataContext = createContext<CommonData | null>(null);
const WECHAT_MP_BIND_DIALOG_SNOOZE_MS = 24 * 60 * 60 * 1000;
const WECHAT_MP_BIND_DIALOG_CLOSED_AT_PREFIX = "wechat_mp_bind_dialog_closed_at:";

function getWechatMpBindDialogStorageKey(user: DomainUser) {
  return `${WECHAT_MP_BIND_DIALOG_CLOSED_AT_PREFIX}${user.id || user.email || "anonymous"}`;
}

function isWechatMpBindDialogSnoozed(user: DomainUser) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const key = getWechatMpBindDialogStorageKey(user);
    const closedAt = Number(window.localStorage.getItem(key));

    if (!Number.isFinite(closedAt) || closedAt <= 0) {
      window.localStorage.removeItem(key);
      return false;
    }

    if (Date.now() - closedAt < WECHAT_MP_BIND_DIALOG_SNOOZE_MS) {
      return true;
    }

    window.localStorage.removeItem(key);
    return false;
  } catch {
    return false;
  }
}

function recordWechatMpBindDialogClosed(user: DomainUser) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getWechatMpBindDialogStorageKey(user), String(Date.now()));
  } catch {
    // Ignore storage failures. The dialog should still be closable.
  }
}

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const { auth, reloadAuth, serverConfig } = useAppRuntime();
  const userInfo = auth.user || {};
  const [wechatMpBindDialogOpen, setWechatMpBindDialogOpen] = useState(false);
  const checkedWechatMpBindRef = useRef(false);
  const autoOpenedWechatMpBindDialogRef = useRef(false);

  const [hosts, setHosts] = useState<DomainHost[]>([]);
  const [hostsInited, setHostsInited] = useState<boolean>(false);
  const [loadingHosts, setLoadingHosts] = useState(true);

  const [models, setModels] = useState<DomainModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  const [images, setImages] = useState<DomainImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(true);

  const [identities, setIdentities] = useState<DomainGitIdentity[]>([]);
  const [loadingIdentities, setLoadingIdentities] = useState(true);

  const [balance, setBalance] = useState(0);
  const [dailyBasicTokenBalance, setDailyBasicTokenBalance] = useState(0);
  const [dailyProTokenBalance, setDailyProTokenBalance] = useState(0);
  const [dailyUltraTokenBalance, setDailyUltraTokenBalance] = useState(0);
  const [checkedInToday, setCheckedInToday] = useState<boolean | null>(null);
  const [loadingCheckinStatus, setLoadingCheckinStatus] = useState(true);
  const [subscription, setSubscription] = useState<DomainSubscriptionResp | null>(null);
  const [loadingSubscription, setLoadingSubscription] = useState(true);
  
  const [members, setMembers] = useState<DomainUser[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const [projects, setProjects] = useState<DomainProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [unlinkedTasks, setUnlinkedTasks] = useState<DomainProjectTask[]>([]);
  const [loadingUnlinkedTasks, setLoadingUnlinkedTasks] = useState(true);
  const [historicalTasks, setHistoricalTasks] = useState<DomainProjectTask[]>([]);
  const [loadingHistoricalTasks, setLoadingHistoricalTasks] = useState(true);

  const maybeOpenWechatMpBindDialog = useCallback((nextUser: DomainUser) => {
    if (IS_OFFLINE_EDITION || checkedWechatMpBindRef.current || serverConfig?.region !== "cn") {
      return;
    }

    checkedWechatMpBindRef.current = true;
    if (nextUser.wechat_mp_bound === true || isWechatMpBindDialogSnoozed(nextUser)) {
      return;
    }

    autoOpenedWechatMpBindDialogRef.current = true;
    setWechatMpBindDialogOpen(true);
  }, [serverConfig?.region]);

  const handleWechatMpBindDialogOpenChange = useCallback((open: boolean) => {
    setWechatMpBindDialogOpen(open);

    if (!open && autoOpenedWechatMpBindDialogRef.current) {
      recordWechatMpBindDialogClosed(userInfo);
      autoOpenedWechatMpBindDialogRef.current = false;
    }
  }, [userInfo]);

  const fetchUserInfo = useCallback(async () => {
    const nextAuth = await reloadAuth();
    const nextUser = nextAuth.user || {};
    maybeOpenWechatMpBindDialog(nextUser);
    return nextUser;
  }, [maybeOpenWechatMpBindDialog, reloadAuth]);

  const fetchHosts = async () => {
    setLoadingHosts(true)
    await apiRequest('v1UsersHostsList', {}, [],(resp) => {
      if (resp.code === 0) {
        setHosts(resp.data?.hosts || [])
      } else {
        toast.error(t("consoleDataProvider.toast.fetchHostsFailed", { message: resp.message }))
      }
    })
    setTimeout(() => {
      setHostsInited(true)
      setLoadingHosts(false)
    }, 500)
  }

  const showHosts = useMemo(() => {
    return hosts.filter((host: DomainHost) => !host.id?.startsWith("public_host"))
  }, [hosts])

  const vms = useMemo(() => {
    const allVms = hosts.flatMap((host) => {
      const hostVms = host.virtualmachines || []
      return hostVms.map((vm) => {
        const vmWithHost = {
          ...vm,
          host: vm.host || host,
        }
        return vmWithHost
      })
    })
    const sortedVms = allVms.sort((a, b) => {
      let aRunning = 0 
      if (a.status === 'offline') {
        aRunning = 5
      }
      let bRunning = 0 
      if (b.status === 'offline') {
        bRunning = 5
      }

      if (aRunning === bRunning) {
        return (b.created_at as number) - (a.created_at as number)
      }
      return aRunning - bRunning
    })
    return sortedVms
  }, [hosts])

  const fetchModels = async () => {
    setLoadingModels(true)
    await apiRequest('v1UsersModelsList', {}, [], (resp) => {
      if (resp.code === 0) {
        const modelsList = (resp.data?.models || []).filter((model: DomainModel) => (
          model.is_hidden !== true
        ));
        
        const sortedModels = [...modelsList].sort((a, b) => {
        const getOwnerTypePriority = (type?: ConstsOwnerType): number => {
            if (type === ConstsOwnerType.OwnerTypePrivate) return 1;
            if (type === ConstsOwnerType.OwnerTypeTeam) return 2;
            if (type === ConstsOwnerType.OwnerTypePublic) return 0;
            return 3;
        };
        
        const priorityA = getOwnerTypePriority(a.owner?.type);
        const priorityB = getOwnerTypePriority(b.owner?.type);
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        
        const nameA = a.model || t("consoleDataProvider.fallback.unknownModel");
        const nameB = b.model || t("consoleDataProvider.fallback.unknownModel");
        return nameA.localeCompare(nameB);
        });
        setModels(sortedModels);
      } else {
        toast.error(t("consoleDataProvider.toast.fetchModelsFailed", { message: resp.message }))
      }
    });
    setTimeout(() => {
      setLoadingModels(false)
    }, 500)
  }

  const fetchImages = async () => {
    setLoadingImages(true)
    await apiRequest('v1UsersImagesList', {}, [], (resp) => {
      if (resp.code === 0) {
        const imagesList = resp.data?.images || [];
        
        const sortedImages = [...imagesList].sort((a, b) => {
          const getOwnerTypePriority = (type?: ConstsOwnerType): number => {
            if (type === ConstsOwnerType.OwnerTypePrivate) return 0;
            if (type === ConstsOwnerType.OwnerTypeTeam) return 1;
            if (type === ConstsOwnerType.OwnerTypePublic) return 2;
            return 3;
          };
          
          const priorityA = getOwnerTypePriority(a.owner?.type);
          const priorityB = getOwnerTypePriority(b.owner?.type);
          
          if (priorityA !== priorityB) {
            return priorityA - priorityB;
          }
          
          const nameA = a.remark || getImageShortName(a.name || '');
          const nameB = b.remark || getImageShortName(b.name || '');
          return nameA.localeCompare(nameB);
        });
        
        setImages(sortedImages);
      } else {
        toast.error(t("consoleDataProvider.toast.fetchImagesFailed", { message: resp.message }))
      }
    })
    setTimeout(() => {
      setLoadingImages(false)
    }, 500)
  }

  const fetchIdentities = () => {
    setLoadingIdentities(true)
    apiRequest('v1UsersGitIdentitiesList', {}, [], (resp) => {
      if (resp.code === 0) {
        const list = resp.data || [];
        setIdentities(list.filter((i: DomainGitIdentity) => i.platform !== ConstsGitPlatform.GitPlatformInternal));
      } else {
        toast.error(t("consoleDataProvider.toast.fetchIdentitiesFailed", { message: resp.message }))
      }
    })
    setTimeout(() => {
      setLoadingIdentities(false)
    }, 500)
  }

  const fetchWallet = useCallback(() => {
    if (IS_OFFLINE_EDITION) {
      return;
    }

    apiRequest('v1UsersWalletList', {}, [], (resp) => {
      if (resp.code === 0) {
        setBalance((resp.data?.balance || 0) / 1000);
        setDailyBasicTokenBalance(resp.data?.daily_basic_token_balance || 0);
        setDailyProTokenBalance(resp.data?.daily_pro_token_balance || 0);
        setDailyUltraTokenBalance(resp.data?.daily_ultra_token_balance || 0);
      } else {
        toast.error(t("consoleDataProvider.toast.fetchBalanceFailed", { message: resp.message }));
      }
    })
  }, [t])

  const fetchCheckinStatus = async (showLoading = true) => {
    if (IS_OFFLINE_EDITION) {
      setCheckedInToday(null)
      setLoadingCheckinStatus(false)
      return
    }

    if (showLoading) {
      setLoadingCheckinStatus(true)
    }

    await apiRequest(
      'v1UsersWalletCheckinList',
      {},
      [],
      (resp) => {
        setCheckedInToday(resp.data?.checked_in === true)
        if (showLoading) {
          setLoadingCheckinStatus(false)
        }
      },
      () => {
        setCheckedInToday(null)
        if (showLoading) {
          setLoadingCheckinStatus(false)
        }
      },
    )
  }

  const fetchSubscription = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoadingSubscription(true)
    }
    await apiRequest('v1UsersSubscriptionList', {}, [], (resp) => {
      if (resp.code === 0) {
        setSubscription(resp.data || null)
      } else {
        toast.error(t("consoleDataProvider.toast.fetchSubscriptionFailed", { message: resp.message }))
      }
    }, () => {
      if (showLoading) {
        setLoadingSubscription(false)
      }
    })
    if (showLoading) {
      setLoadingSubscription(false)
    }
  }, [t])

  const fetchMembers = async () => {
    setLoadingMembers(true)
    await apiRequest('v1UsersMembersList', {}, [], (resp) => {
      if (resp.code === 0) {
        setMembers(resp.data || [])
      } else {
        toast.error(t("consoleDataProvider.toast.fetchMembersFailed", { message: resp.message }))
      }
    })
    setLoadingMembers(false)
  }

  const fetchProjects = async () => {
    setLoadingProjects(true)

    await apiRequest('v1UsersProjectsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setProjects(resp.data?.projects || [])
      } else {
        toast.error(t("consoleDataProvider.toast.fetchProjectsFailed", { message: resp.message }))
      }
    })

    setLoadingProjects(false)
  }

  const UNLINKED_TASKS_LIMIT = 5
  const UNLINKED_TASKS_FETCH_SIZE = 50
  const UNLINKED_TASKS_STATUS = "pending,processing"
  const HISTORICAL_TASKS_LIMIT = 5
  const HISTORICAL_TASKS_FETCH_SIZE = 50
  const HISTORICAL_TASKS_STATUS = "error,finished"

  const fetchUnlinkedTasks = async () => {
    setLoadingUnlinkedTasks(true)
    await apiRequest('v1UsersTasksList', { page: 1, size: UNLINKED_TASKS_FETCH_SIZE, quick_start: true, status: UNLINKED_TASKS_STATUS }, [], (resp) => {
      if (resp.code === 0) {
        const allTasks = resp.data?.tasks || []
        const unlinked = allTasks
          .sort((a: DomainProjectTask, b: DomainProjectTask) => (b.created_at || 0) - (a.created_at || 0))
          .slice(0, UNLINKED_TASKS_LIMIT)
        setUnlinkedTasks(unlinked)
      }
      setLoadingUnlinkedTasks(false)
    }, () => setLoadingUnlinkedTasks(false))
  }

  const fetchHistoricalTasks = async () => {
    setLoadingHistoricalTasks(true)
    await apiRequest('v1UsersTasksList', { page: 1, size: HISTORICAL_TASKS_FETCH_SIZE, status: HISTORICAL_TASKS_STATUS }, [], (resp) => {
      if (resp.code === 0) {
        const allTasks = resp.data?.tasks || []
        const recentTasks = allTasks
          .sort((a: DomainProjectTask, b: DomainProjectTask) => (b.created_at || 0) - (a.created_at || 0))
          .slice(0, HISTORICAL_TASKS_LIMIT)
        setHistoricalTasks(recentTasks)
      }
      setLoadingHistoricalTasks(false)
    }, () => setLoadingHistoricalTasks(false))
  }

  useEffect(() => {
    fetchHosts();
    fetchModels();
    fetchImages();
    fetchIdentities();
    fetchWallet();
    fetchCheckinStatus();
    fetchSubscription();
    fetchMembers();
    fetchProjects();
    fetchUnlinkedTasks();
    fetchHistoricalTasks();
  }, []);

  useEffect(() => {
    if (auth.status === "authenticated" && auth.user) {
      maybeOpenWechatMpBindDialog(auth.user);
    }
  }, [auth.status, auth.user, maybeOpenWechatMpBindDialog]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetchWallet();
      fetchCheckinStatus(false);
      fetchSubscription(false);
    }, 30 * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <>
      <DataContext.Provider value={{
        user: userInfo,
        reloadUser: fetchUserInfo,

        hosts: showHosts,
        vms: vms,
        loadingHosts: loadingHosts,
        hostsInited: hostsInited,
        reloadHosts: fetchHosts,

        models: models,
        loadingModels: loadingModels,
        reloadModels: fetchModels,

        images: images,
        loadingImages: loadingImages,
        reloadImages: fetchImages,

        identities: identities,
        loadingIdentities: loadingIdentities,
        reloadIdentities: fetchIdentities,

        balance: balance,
        dailyBasicTokenBalance: dailyBasicTokenBalance,
        dailyProTokenBalance: dailyProTokenBalance,
        dailyUltraTokenBalance: dailyUltraTokenBalance,
        checkedInToday: checkedInToday,
        loadingCheckinStatus: loadingCheckinStatus,
        reloadCheckinStatus: () => fetchCheckinStatus(),
        reloadWallet: fetchWallet,
        subscription: subscription,
        loadingSubscription: loadingSubscription,
        reloadSubscription: fetchSubscription,

        members: members,
        loadingMembers: loadingMembers,
        reloadMembers: fetchMembers,

        projects: projects,
        loadingProjects: loadingProjects,
        reloadProjects: fetchProjects,

        unlinkedTasks: unlinkedTasks,
        loadingUnlinkedTasks: loadingUnlinkedTasks,
        reloadUnlinkedTasks: fetchUnlinkedTasks,

        historicalTasks: historicalTasks,
        loadingHistoricalTasks: loadingHistoricalTasks,
        reloadHistoricalTasks: fetchHistoricalTasks,
      }}>
        {children}
      </DataContext.Provider>
      <WechatMpBindDialog
        open={wechatMpBindDialogOpen}
        onOpenChange={handleWechatMpBindDialogOpenChange}
      />
    </>
  );
};

export const useCommonData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useCommonData must be used within DataProvider');
  return ctx;
};
