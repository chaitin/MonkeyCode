import { createContext, useContext } from 'react';
import type {
  DomainGitIdentity,
  DomainHost,
  DomainImage,
  DomainModel,
  DomainProject,
  DomainProjectTask,
  DomainUser,
  DomainVirtualMachine,
} from '@/api/Api';

export type CommonData = {
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
  bonus: number;
  reloadWallet: () => void;

  members: DomainUser[];
  loadingMembers: boolean;
  reloadMembers: () => void;

  projects: DomainProject[];
  loadingProjects: boolean;
  reloadProjects: () => void;

  /** 未关联项目的任务（quick_start），用于侧边栏「默认」分组展示 */
  unlinkedTasks: DomainProjectTask[];
  loadingUnlinkedTasks: boolean;
  reloadUnlinkedTasks: () => void;
};

export const DataContext = createContext<CommonData | null>(null);

export const useCommonData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useCommonData must be used within DataProvider');
  return ctx;
};
