const distributions: [RegExp, string][] = [
  [/ubuntu/i, "ubuntu"],
  [/debian/i, "debian"],
  [/centos/i, "centos"],
  [/red\s*hat|\brhel\b/i, "redhat"],
  [/rocky/i, "rockylinux"],
  [/alma/i, "almalinux"],
  [/fedora/i, "fedora"],
  [/alpine/i, "alpinelinux"],
  [/arch\s*linux/i, "archlinux"],
  [/suse/i, "opensuse"],
]

export function OSIcon({ name }: { name?: string }) {
  const icon =
    distributions.find(([pattern]) => pattern.test(name ?? ""))?.[1] ?? "linux"
  return (
    <span
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-inset ring-black/5"
      aria-hidden="true"
    >
      <img
        src={`${import.meta.env.BASE_URL}os/${icon}.svg`}
        alt=""
        className="size-4"
        width={16}
        height={16}
      />
    </span>
  )
}
