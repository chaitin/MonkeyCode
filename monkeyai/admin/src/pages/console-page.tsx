import { Skeleton } from "@/components/ui/skeleton"

export function ConsolePage() {
  return (
    <section className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <div className="grid auto-rows-min gap-4 md:grid-cols-3">
        <Skeleton className="aspect-video rounded-xl" />
        <Skeleton className="aspect-video rounded-xl" />
        <Skeleton className="aspect-video rounded-xl" />
      </div>
      <Skeleton className="min-h-96 flex-1 rounded-xl" />
    </section>
  )
}
