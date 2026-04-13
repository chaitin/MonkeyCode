import { ConstsGitPlatform, ConstsOwnerType, type DomainGitIdentity, type DomainHost, type DomainImage, type DomainModel, type DomainProject, type DomainProjectTask, type DomainSubscriptionResp, type DomainUser, type DomainVirtualMachine } from '@/api/Api';
import { getImageShortName } from '@/utils/common';
import { apiRequest } from '@/utils/requestUtils';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

type CommonData = {
  user: DomainUser;
  reloadUser: () => void;

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
  dailyBalance: number;
  dailyRefreshedAt?: string;
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

  /** 未关联项目的任务（quick_start），用于侧边栏「空项目」分组展示 */
  unlinkedTasks: DomainProjectTask[];
  loadingUnlinkedTasks: boolean;
  reloadUnlinkedTasks: () => void;
};

const DataContext = createContext<CommonData | null>(null);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userInfo, setUserInfo] = useState<DomainUser>({});

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
  const [dailyBalance, setDailyBalance] = useState(0);
  const [dailyRefreshedAt, setDailyRefreshedAt] = useState<string | undefined>(undefined);
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

  const fetchUserInfo = () => {
    apiRequest('v1UsersStatusList', {}, [], (resp) => {
      setUserInfo(resp.data?.user || {});
    })
  }

  const fetchHosts = async () => {
    setLoadingHosts(true)
    await apiRequest('v1UsersHostsList', {}, [],(resp) => {
      if (resp.code === 0) {
        setHosts(resp.data?.hosts || [])
      } else {
        toast.error("获取宿主机列表失败: " + resp.message)
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
        // 为每个 VM 添加所属 host 信息
        const vmWithHost = {
          ...vm,
          host: vm.host || host, // 如果 VM 本身已有 host 信息则保留，否则使用所属的 host
        }
        return vmWithHost
      })
    })
    const sortedVms = allVms.sort((a, b) => {
      // 正在运行的排在最上面
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
        const modelsList = resp.data?.models || [];
        
        // 排序：先按 owner.type (private > team > public)，然后按名字
        const sortedModels = [...modelsList].sort((a, b) => {
        // 定义 owner.type 的优先级
        const getOwnerTypePriority = (type?: ConstsOwnerType): number => {
            if (type === ConstsOwnerType.OwnerTypePrivate) return 1;
            if (type === ConstsOwnerType.OwnerTypeTeam) return 2;
            if (type === ConstsOwnerType.OwnerTypePublic) return 0;
            return 3; // 未知类型排在最后
        };
        
        const priorityA = getOwnerTypePriority(a.owner?.type);
        const priorityB = getOwnerTypePriority(b.owner?.type);
        
        // 先按 owner.type 排序
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        
        // 如果 owner.type 相同，按名字排序
        const nameA = a.model || '未知模型';
        const nameB = b.model || '未知模型';
        return nameA.localeCompare(nameB);
        });
        setModels(sortedModels);
      } else {
        toast.error("获取模型列表失败: " + resp.message)
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
        
        // 排序：先按 owner.type (private > team > public)，然后按名字
        const sortedImages = [...imagesList].sort((a, b) => {
          // 定义 owner.type 的优先级
          const getOwnerTypePriority = (type?: ConstsOwnerType): number => {
            if (type === ConstsOwnerType.OwnerTypePrivate) return 0;
            if (type === ConstsOwnerType.OwnerTypeTeam) return 1;
            if (type === ConstsOwnerType.OwnerTypePublic) return 2;
            return 3; // 未知类型排在最后
          };
          
          const priorityA = getOwnerTypePriority(a.owner?.type);
          const priorityB = getOwnerTypePriority(b.owner?.type);
          
          // 先按 owner.type 排序
          if (priorityA !== priorityB) {
            return priorityA - priorityB;
          }
          
          // 如果 owner.type 相同，按名字排序
          const nameA = a.remark || getImageShortName(a.name || '');
          const nameB = b.remark || getImageShortName(b.name || '');
          return nameA.localeCompare(nameB);
        });
        
        setImages(sortedImages);
      } else {
        toast.error("获取镜像列表失败: " + resp.message)
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
        // 隐藏 platform 为 internal 的身份凭证
        setIdentities(list.filter((i: DomainGitIdentity) => i.platform !== ConstsGitPlatform.GitPlatformInternal));
      } else {
        toast.error("获取身份列表失败: " + resp.message)
      }
    })
    setTimeout(() => {
      setLoadingIdentities(false)
    }, 500)
  }

  const fetchWallet = () => {
    apiRequest('v1UsersWalletList', {}, [], (resp) => {
      if (resp.code === 0) {
        setBalance((resp.data?.balance || 0) / 1000);
        setDailyBalance((resp.data?.daily_balance || 0) / 1000);
        setDailyRefreshedAt(resp.data?.daily_refreshed_at || undefined);
      } else {
        toast.error("获取余额失败: " + resp.message);
      }
    })
  }

  const fetchCheckinStatus = async (showLoading = true) => {
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

  const fetchSubscription = async (showLoading = true) => {
    if (showLoading) {
      setLoadingSubscription(true)
    }
    await apiRequest('v1UsersSubscriptionList', {}, [], (resp) => {
      if (resp.code === 0) {
        setSubscription(resp.data || null)
      } else {
        toast.error("获取会员信息失败: " + resp.message)
      }
    }, () => {
      if (showLoading) {
        setLoadingSubscription(false)
      }
    })
    if (showLoading) {
      setLoadingSubscription(false)
    }
  }

  const fetchMembers = async () => {
    setLoadingMembers(true)
    await apiRequest('v1UsersMembersList', {}, [], (resp) => {
      if (resp.code === 0) {
        setMembers(resp.data || [])
      } else {
        toast.error("获取协作成员失败: " + resp.message)
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
        toast.error("获取项目列表失败: " + resp.message)
      }
    })

    setLoadingProjects(false)
  }

  const UNLINKED_TASKS_LIMIT = 5
  const UNLINKED_TASKS_FETCH_SIZE = 50
  const UNLINKED_TASKS_STATUS = "pending,processing"

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

  useEffect(() => {
    fetchUserInfo();
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
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetchWallet();
      fetchCheckinStatus(false);
      fetchSubscription(false);
    }, 60 * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
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
        dailyBalance: dailyBalance,
        dailyRefreshedAt: dailyRefreshedAt,
        checkedInToday: checkedInToday,
        loadingCheckinStatus: loadingCheckinStatus,
        reloadCheckinStatus: () => fetchCheckinStatus(),
        reloadWallet: fetchWallet,
        subscription: subscription,
        loadingSubscription: loadingSubscription,
        reloadSubscription: () => fetchSubscription(),

        members: members,
        loadingMembers: loadingMembers,
        reloadMembers: fetchMembers,

        projects: projects,
        loadingProjects: loadingProjects,
        reloadProjects: fetchProjects,

        unlinkedTasks: unlinkedTasks,
        loadingUnlinkedTasks: loadingUnlinkedTasks,
        reloadUnlinkedTasks: fetchUnlinkedTasks,
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useCommonData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useCommonData must be used within DataProvider');
  return ctx;
};
