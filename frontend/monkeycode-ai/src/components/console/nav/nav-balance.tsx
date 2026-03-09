import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { Dialog } from "@radix-ui/react-dialog";
import { DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DialogContent } from "@/components/ui/dialog";
import { IconInfoCircle, IconWallet } from "@tabler/icons-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { apiRequest } from "@/utils/requestUtils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";
import type { DomainTransactionLog } from "@/api/Api";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import dayjs from "dayjs";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommonData } from "../data-provider";

export default function NavBalance() {
  const [transcations, setTranscations] = useState<DomainTransactionLog[]>([]);
  const [exchangeCode, setExchangeCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState<number>(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const { balance, bonus, reloadWallet, user } = useCommonData();

  const fetchTranscations = async () => {
    setIsLoadingMore(true);
    await apiRequest('v1UsersWalletTransactionList', { 
      size: 10, 
      page: page 
    }, [], (resp) => {
      if (resp.code === 0) {
        const newTransactions = resp.data?.transactions || [];
        setTranscations(prev => [...prev, ...newTransactions]);
        setHasNextPage(resp.data?.page?.has_next_page || false);
        setPage(page + 1);
      } else {
        toast.error(resp.message || "获取交易记录失败");
      }
    });
    setIsLoadingMore(false);
  }

  const loadMore = useCallback(() => {
    if (hasNextPage && !isLoadingMore) {
      fetchTranscations();
    }
  }, [hasNextPage, isLoadingMore]);

  const handleExchange = async () => {
    if (!exchangeCode.trim()) {
      toast.error("请输入兑换码");
      return;
    }
    
    setIsLoading(true);
    await apiRequest('v1UsersWalletExchangeCreate', { code: exchangeCode.trim() }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("兑换成功");
        setExchangeCode("");
        reloadWallet();
      } else {
        toast.error(resp.message || "兑换失败");
      }
    })
    setIsLoading(false);
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [loadMore]);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setTranscations([]);
      setHasNextPage(false);
      fetchTranscations();
    } else {
      setPage(1)
    }
  };


  const handleCopyInvitationLink = () => {
    const invitationLink = `https://monkeycode-ai.com/?ic=${user.id}`;
    navigator.clipboard.writeText(invitationLink);
    toast.success("邀请链接已复制到剪贴板");
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="cursor-pointer">
              <IconWallet className="size-5" />
              余额: {Math.ceil(balance + bonus).toLocaleString()} 点
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>点数余额</DialogTitle>
          <DialogDescription>
            点数用来兑换计算资源，详情见
            <a className="text-primary hover:underline mx-1"
              href="https://monkeycode.docs.baizhi.cloud/node/019b2134-e832-7425-a916-137fe8bb4c8c"
              target="_blank">
              说明
            </a>
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 border rounded-md p-4">
          <div className="flex flex-1 flex-row gap-2">
            <div className="text-3xl content-end text-primary">
              {Math.ceil(balance + bonus).toLocaleString()}
            </div>
            <div className="content-end text-muted-foreground">点</div>
          </div>
          <Separator orientation="vertical" className="mx-4" />
          <div className="flex flex-1 flex-col gap-2">
            <Label className="text-muted-foreground">充值余额: {Math.ceil(balance).toLocaleString()} 点</Label>
            <Label className="text-muted-foreground">赠送余额: {Math.ceil(bonus).toLocaleString()} 点</Label>
          </div>
        </div>
        <Label>兑换点数</Label>
        <div className="flex gap-2">
          <Input 
            placeholder="请输入兑换码" 
            value={exchangeCode}
            onChange={(e) => setExchangeCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleExchange()}
          />
          <Button 
            variant="outline" 
            onClick={handleExchange}
            disabled={isLoading}
          >
            {isLoading && <Spinner />}
            兑换
          </Button>
        </div>
        <div className="flex flex-row items-center -mb-3">
          <Label className="">邀请注册</Label>
          <Button variant="link" size="sm" className="cursor-pointer" onClick={() => { 
            window.open(`https://monkeycode.docs.baizhi.cloud/node/019b2134-e832-7425-a916-137fe8bb4c8c`, '_blank')
          }}>
            活动说明
          </Button>
        </div>
        <div className="flex flex-row justify-between gap-2 mb-2">
          <Input value="邀请好友注册并激活，可获得 2000 点数" readOnly />
          <Button variant="outline" onClick={handleCopyInvitationLink}>复制邀请链接</Button>
        </div>
        <Label className="">交易记录</Label>
        <ItemGroup className="flex flex-col gap-2 overflow-y-auto max-h-[300px] -mx-2 px-2">
          {transcations.map((transaction) => (
            <Item key={Math.random().toString()} variant="outline" size="sm">
              <ItemContent>
                <ItemTitle className="flex flex-row w-full">
                  <div className={cn("flex flex-1 flex-row items-center", (transaction.kind === "signup_bonus" || transaction.kind === "voucher_exchange" || transaction.kind === "invitation_reward") ? "text-primary" : "")}>
                    {(transaction.kind === "signup_bonus" || transaction.kind === "voucher_exchange" || transaction.kind === "invitation_reward") ? "+" : "-"}
                    {Math.ceil((transaction.amount || 0) / 1000).toLocaleString()}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex flex-row items-center gap-1 text-muted-foreground text-xs font-normal cursor-pointer">
                        {transaction.kind === "signup_bonus" && "新用户注册赠送"}
                        {transaction.kind === "voucher_exchange" && "通过兑换码领取"}
                        {transaction.kind === "invitation_reward" && "邀请注册奖励"}
                        {transaction.kind === "vm_consumption" && "开发环境消耗"}
                        {transaction.kind === "model_consumption" && "大模型消耗"}
                        <IconInfoCircle className="size-3" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {transaction.remark}
                    </TooltipContent>
                  </Tooltip>
                  <div className="text-muted-foreground text-xs ml-4">
                    {dayjs((transaction.created_at || 0) * 1000).format("YYYY-MM-DD HH:mm:ss")}
                  </div>
                </ItemTitle>
              </ItemContent>
            </Item>
          ))}
          {hasNextPage && (
            <div ref={loadMoreRef} className="flex justify-center py-2">
              {isLoadingMore && <Spinner className="size-4" />}
            </div>
          )}
        </ItemGroup>

      </DialogContent>
    </Dialog>
  )
}