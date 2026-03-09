import { Link, useNavigate } from "react-router-dom";
import Header from "@/components/welcome/header"
import Footer from "@/components/welcome/footer";
import { Item, ItemContent, ItemDescription, ItemFooter, ItemHeader, ItemMedia, ItemTitle } from "@/components/ui/item";
import { useEffect, useState } from "react";
import { apiRequest } from "@/utils/requestUtils";
import { ConstsPostKind, type DomainPlaygroundPost } from "@/api/Api";
import { Separator } from "@/components/ui/separator";
import { IconEye, IconMoodEmpty } from "@tabler/icons-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { AuthProvider, useAuth } from "@/components/auth-provider";

const PlaygroundContent = () => {
  const [posts, setPosts] = useState<DomainPlaygroundPost[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")

  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();

  const fetchPosts = async () => {
    setLoading(true)
    await apiRequest('v1PlaygroundPostsList', { content: search }, [], (resp) => {
      if (resp.code === 0) {
        setPosts(resp.data?.playground_posts || [])
      } else {
        toast.error(resp.message || "获取内容失败")
      }
    })
    setLoading(false)
  }

  useEffect(() => {
    fetchPosts()
  }, [])

  return (
    <main className="flex flex-col w-full px-10 flex-1 pt-16">
      <div className="w-full mx-auto my-20 text-center text-4xl font-bold">
        开发者广场
      </div>
      <div className="w-full mx-auto text-center max-w-[1200px] flex flex-row gap-4 mb-6">
        <Input
          placeholder="搜索内容"
          className="h-10 rounded-full px-6"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              fetchPosts();
            }
          }}
          disabled={loading}
        />
        <Button variant="secondary" className="h-10 rounded-full px-6" onClick={fetchPosts} disabled={loading}>搜索</Button>
        <Button variant="secondary" className="h-10 rounded-full px-6" onClick={() => {
          if (isLoggedIn) {
            window.open("/playground/create", "_blank")
          } else {
            navigate("/login")
          }
        }}>发布</Button>
      </div>
      {posts.length > 0 ? (
        <div className="w-full mx-auto mb-10 max-w-[1200px] grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4">
          {posts.map((post, index) => (
            <Item key={index} variant="outline" className="group hover:border-primary/50 pb-2">
              <ItemHeader className="bg-muted/50">
                <Link to={`/playground/detail?id=${post.id}`} className="w-full">
                  <ItemMedia className="w-full">
                    <img src={post.task_post?.images?.[0] || post.normal_post?.images?.[0] || "/logo-colored.png"} className="max-w-full h-[140px]" />
                  </ItemMedia>
                </Link>
              </ItemHeader>
              <ItemContent>
                <Link to={`/playground/detail?id=${post.id}`}>
                  <ItemTitle className="group-hover:text-primary hover:underline cursor-pointer line-clamp-1">
                    {post.kind === ConstsPostKind.PostKindTask ? post?.task_post?.title : post?.normal_post?.title}
                  </ItemTitle>
                </Link>
                <ItemDescription className="line-clamp-1 whitespace-normal break-all">
                  {post.kind === ConstsPostKind.PostKindTask ? post?.task_post?.content : post?.normal_post?.content}
                </ItemDescription>
              </ItemContent>
              <ItemFooter className="flex flex-col gap-2">
                <Separator />
                <div className="flex flex-row items-center gap-2 justify-between w-full">
                  <div className="flex flex-row items-center gap-2">
                    <Avatar className="size-4">
                      <AvatarImage src={post.user?.avatar_url || "/logo-colored.png"} />
                      <AvatarFallback>{(post.user?.name || "-").charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    {post.user?.name}
                  </div>
                  <div className="flex flex-row items-center gap-2 text-sm text-muted-foreground">
                    <IconEye className="size-4" />
                    {post.views}
                  </div>
                </div>
              </ItemFooter>
            </Item>
          ))}
        </div>
      ) : (
        <Empty className="w-full mx-auto mb-10 max-w-[1200px] border rounded-md">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconMoodEmpty className="" />
            </EmptyMedia>
            <EmptyTitle>没有找到内容</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </main>
  )
}

const PlaygroundPage = () => {
  return (
    <AuthProvider>
      <div className="flex flex-col h-screen">
        <Header />
        <PlaygroundContent />
        <Footer />
      </div>
    </AuthProvider>
  )
}

export default PlaygroundPage


