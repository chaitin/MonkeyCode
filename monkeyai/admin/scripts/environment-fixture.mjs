import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dist = process.env.FIXTURE_DIST ? path.resolve(process.env.FIXTURE_DIST) : path.resolve(fileURLToPath(new URL("../dist/", import.meta.url)))
const GiB = 1024 ** 3
const uuid = (value) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
const userID = uuid(900),
  hostID = uuid(901)
const profile = {
  architecture: "amd64",
  image: `example.com/dev@sha256:${"a".repeat(64)}`,
  network_policy: "isolated",
  resource: {
    cpu_millis: 2000,
    memory_bytes: 4 * GiB,
    host_tasks: 1024,
    temporary_bytes: GiB / 2,
  },
  storage: {
    workspace_bytes: 20 * GiB,
    home_bytes: 10 * GiB,
    runtime_bytes: 2 * GiB,
    inodes: 100000,
  },
}
let nextHostId=2000
const nextHost=()=>uuid(nextHostId++)
const setups = new Map()
const quotaOverrides = new Map()
let mode = "",
  requests = [],
  operations = new Map(),
  idempotency = new Map()
const capacity = {
  host_id: hostID,
  enabled: false,
  cpu_millis: 16000,
  memory_bytes: 32 * GiB,
  max_environments: 20,
  protocol: 1,
  architecture: "amd64",
  status: "active",
}
const hosts = [
  {
    id: hostID,
    name: "开发宿主机",
    architecture: "amd64",
    version: "dev",
    status: "active",
    online: true,
    enabled: true,
    max_environments: 100,
    user_id: userID,
    activated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    report: {
      prerequisites_met: false,
      system: {
        hostname: "dev-worker-01",
        network: {receive_bytes_per_second: 153600, transmit_bytes_per_second: 5242880},
        disk_io: {read_bytes_per_second: 10485760, write_bytes_per_second: 2097152},
        private_ips: ["10.0.1.12"], public_ips: ["203.0.113.12"],
        os_name: "Ubuntu 24.04",
        kernel_version: "6.8.0-48-generic",
        cpu: { model: "AMD EPYC 7B13", logical_cores: 16, usage_percent: 32.6 },
        memory: {
          total_bytes: 32 * GiB,
          used_bytes: Math.round(12.8 * GiB),
          available_bytes: 32 * GiB - Math.round(12.8 * GiB),
        },
        disk: {
          path: "/var/lib/monkeyai-engine/data",
          total_bytes: 500 * GiB,
          used_bytes: 185 * GiB,
          available_bytes: 290 * GiB,
        },
      },
      checks: [
        { name: "cgroup_v2", passed: true, detail: "cgroup v2 已启用" },
        { name: "network", passed: false, detail: "尚未配置公网出站网络" },
      ],
    },
  },
]
hosts.push(
  {
    ...hosts[0],
    id: uuid(910),
    name: "构建宿主机",
    online: false,
    last_seen_at: new Date(Date.now() - 600000).toISOString(),
    report: {
      ...hosts[0].report,
      prerequisites_met: true,
      system: {
        ...hosts[0].report.system,
        hostname: "build-worker-02",
        os_name: "CentOS 7",
        cpu: {
          model: "Intel Xeon Platinum",
          logical_cores: 8,
          usage_percent: 91.2,
        },
      },
    },
  },
  {
    ...hosts[0],
    id: uuid(911),
    name: "旧版宿主机",
    report: { os: "linux", prerequisites_met: true, checks: [] },
  }
)
for (const host of hosts) {
  host.version = "v26110405"
  host.upgrade = {
    target_version: "v26110406", version_state: "available", update_available: true,
    supported: host.name !== "旧版宿主机", can_upgrade: host.online && host.name !== "旧版宿主机", task: null,
  }
}
const quota = {user_id:userID,max_environments:3}
const setupFor = (id) => {
  if (!setups.has(id)) setups.set(id, {resource:null,max_environments:100,user_max_environments:3,billing:{enabled:false,cpu_credits_per_core_hour:"0.1",memory_credits_per_gib_hour:"0.025"},grants:[{group_id:uuid(0)}]})
  return setups.get(id)
}
const environments = Array.from({ length: 21 }, (_, i) => ({
  id: uuid(i + 1),
  name: `验收项目 ${i + 1}`,
  user: { name: "测试用户", email: "test@example.test", avatar_url: "" },
  host: { name: "开发宿主机", hostname: "dev-worker-01", os_name: "Ubuntu 24.04" },
  user_id: userID,
  host_id: hostID,
  generation: 1,
  observed_generation: 1,
  instance_id: uuid(100 + i),
  desired: "running",
  phase: "running",
  reason: "",
  observed_at: new Date().toISOString(),
  usage: i === 0 ? {at: new Date().toISOString(), cpu_cores: 0.38, memory_bytes: 512 * 1024 ** 2} : undefined,
  storage_retained: true,
  connectable: true, runtime_ready: true, stale: false,
  workload_verified: false,
  created_at: new Date().toISOString(),
  spec: {
    image: profile.image,
    resource: profile.resource,
    network_policy: "isolated",
    volumes: ["workspace", "home", "runtime"].map((purpose, index) => ({
      id: uuid(500 + i * 3 + index),
      purpose,
      bytes: [20, 10, 2][index] * GiB,
      inodes: 100000,
    })),
  },
}))
environments[1] = { ...environments[1], generation: 2, desired: "stopped" }
environments[2] = {
  ...environments[2],
  desired: "deleted",
  phase: "failed",
  reason: "apply_failed",
}
environments[3] = {...environments[3], desired: "deleted", phase: "deleted"}
environments[4] = {...environments[4], usage: {at: new Date().toISOString(), cpu_cores: 0.8, memory_bytes: 128 * 1024 ** 2}}
const creditUnits = (value) => {
  const [whole, fraction = ""] = value.split(".")
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"))
}
const creditDecimal = (value) => {
  const fraction = (value % 1000000n).toString().padStart(6, "0").replace(/0+$/, "")
  return `${value / 1000000n}${fraction ? "." + fraction : ""}`
}
const hourlyUnits = (env) => {
  const setupBilling = setupFor(env.host_id).billing
  const resource = env.spec.resource
  const denominator = 1000n * 1073741824n
  const numerator = creditUnits(setupBilling.cpu_credits_per_core_hour) * BigInt(resource.cpu_millis) * 1073741824n + creditUnits(setupBilling.memory_credits_per_gib_hour) * BigInt(resource.memory_bytes) * 1000n
  return (numerator + denominator / 2n) / denominator
}
const withBilling = (env) => {
  const setupBilling = setupFor(env.host_id).billing
  const active = environments.filter(item => item.phase === "running" && item.desired === "running" && setupFor(item.host_id).billing.enabled)
  const total = active.reduce((sum, item) => sum + hourlyUnits(item), 0n)
  const enabled = setupBilling.enabled && total > 0n
  return {...env, billing: {
    enabled, state: !enabled ? "disabled" : env.phase === "stopped" || env.phase === "deleted" ? "stopped" : env.phase === "running" ? "running" : "waiting",
    hourly_credits: enabled ? creditDecimal(hourlyUnits(env)) : "0",
    settled_credits: enabled ? "0.0125" : "0", settled_seconds: enabled ? 150 : 0,
    ...(enabled ? {budget: {balance: creditDecimal(total / 15n), hourly_credits: creditDecimal(total), remaining_seconds: 240, running_environments: active.length, low_balance: true}} : {}),
  }}
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
}
if (process.env.FIXTURE_STATE) {
  const saved = JSON.parse(await readFile(process.env.FIXTURE_STATE,"utf8"))
  requests = saved.requests ?? []
  mode = saved.mode ?? ""
  if (saved.capacity) Object.assign(capacity,saved.capacity)
  if (saved.quota) Object.assign(quota,saved.quota)
  if (saved.environments) environments.splice(0,environments.length,...saved.environments)
  if (saved.setups) {
    for (const [id,setup] of Object.entries(saved.setups)) {
      const normalized={...setupFor(id),...setup,max_environments:setup.max_environments ?? saved.capacity?.max_environments ?? 100,user_max_environments:setup.user_max_environments ?? setup.quota?.max_environments ?? 3}
      delete normalized.revision;delete normalized.billing_revision;delete normalized.quota
      setups.set(id,normalized)
    }
  } else {
    const last = requests.filter(item=>item.path.endsWith("/setup") && item.method==="PUT").at(-1)?.body
    for (const host of hosts) {
      const setup=setupFor(host.id)
      if(last?.resource) setup.resource=last.resource
      if(last?.quota) setup.user_max_environments=last.quota.max_environments
      if(last?.billing || saved.billing) setup.billing=last?.billing ?? saved.billing
    }
  }
  if(saved.hosts) hosts.splice(0,hosts.length,...saved.hosts.map(h=>({...h,enabled:h.enabled ?? h.scheduling_enabled ?? false,max_environments:h.max_environments ?? 100,user_id:h.user_id ?? userID,activated_at:h.activated_at ?? null})))
  if(saved.quota_overrides)for(const [key,value]of Object.entries(saved.quota_overrides))quotaOverrides.set(key,value)
  if(saved.operations)operations=new Map(Object.entries(saved.operations))
  if(saved.idempotency)idempotency=new Map(Object.entries(saved.idempotency))
  nextHostId=saved.next_host_id ?? Math.max(2000,...hosts.map(h=>Number(h.id.slice(-12))+1))
  for(const h of hosts){h.max_environments=setupFor(h.id).max_environments;delete h.scheduling_enabled;delete h.enrollment_expires_at}
  for(const env of environments)delete env.compute_reserved
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1")
  const send = (value, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    res.end(JSON.stringify(value))
  }
  const fail = (status, message) => send({ error: { message } }, status)
  try {
    let body
    if (req.method !== "GET") {
      let raw = ""
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > 65536) return fail(400, "请求过大")
      }
      body = raw ? JSON.parse(raw) : {}
    }
    if (url.pathname === "/__fixture") {
      if (req.method === "POST") {
        mode = body.mode ?? ""
        if (body.clearRequests) requests = []
        if (body.upgradeStatus && hosts[0].upgrade.task) {
          const value = hosts[0].upgrade
          value.task.status = body.upgradeStatus
          value.task.updated_at = new Date().toISOString()
          value.task.reason = body.upgradeStatus === "failed" ? "upgrade_failed" : ""
          value.can_upgrade = body.upgradeStatus === "failed"
          if (body.upgradeStatus === "succeeded") {
            hosts[0].version = value.target_version
            value.version_state = "current"
            value.update_available = false
          }
        }
      }
      return send({ mode, requests, environments: environments.map(withBilling), capacity, quota, hosts, next_host_id:nextHostId, quota_overrides:Object.fromEntries(quotaOverrides), operations:Object.fromEntries(operations), idempotency:Object.fromEntries(idempotency), billing: setupFor(hostID).billing, setups: Object.fromEntries(setups) })
    }
    if (url.pathname.startsWith("/api/")) {
      const route = url.pathname.replace("/api/admin/v1/", "")
      if (req.method !== "GET")
        requests.push({ path: url.pathname, method: req.method, body })
      if (url.pathname === "/api/auth/v1/session")
        return send({
          authenticated: true,
          user: {
            id: userID,
            name: "测试管理员",
            email: "admin@example.test",
            role: "admin",
            status: "active",
          },
        })
      if (route === "license/status") return fail(404, "未提供")
      if (url.pathname.endsWith("/branding"))
        return send({ product_name: "MonkeyAI", workspace_name: "本地测试" })
      if (route === "resources/authorization-subjects") return send({groups:[{id:uuid(0),name:"本地测试",parent_id:null},{id:uuid(920),name:"研发组",parent_id:uuid(0)},{id:uuid(921),name:"平台组",parent_id:uuid(920)}],users:[{id:userID,name:"环境测试用户",email:"user@example.test",group_id:[uuid(921)]},{id:uuid(902),name:"开发用户",email:"developer@example.test",group_id:[uuid(920)]}]})
      if (route === "billing/users")
        return send({
          items: [
            {
              id: userID,
              name: "环境测试用户",
              email: "user@example.test",
              deleted: false,
            },
          ],
          has_next: false,
        })
      if (route === "engine-upgrade") return send({ version: "v26110406", command: `sudo bash -c "$(curl -kfsSL 'https://server.example.test/api/host/v1/install.sh?version=v26110406')"` })
      if (/^engine-hosts\/[^/]+\/upgrade$/.test(route) && req.method === "POST") {
        if (mode === "upgrade-error") return fail(409, "服务器目标版本已变化，请刷新后重试")
        const host = hosts.find(item => item.id === route.split("/")[1])
        if (!host?.upgrade.can_upgrade || body.version !== host.upgrade.target_version) return fail(409, "当前宿主不可升级")
        host.upgrade.task = { id: uuid(4000 + requests.length), from_version:host.version, version: body.version, status: "pending", reason: "", updated_at: new Date().toISOString() }
        host.upgrade.can_upgrade = false
        return send(host.upgrade.task, 202)
      }
      if (route === "engine-hosts") {
        if (mode === "host-error") return fail(503, "宿主列表暂不可用")
        const page = Number(url.searchParams.get("page") || 1)
        return send({
          items:
            mode === "host-empty"
              ? []
              : hosts.slice((page - 1) * 20, page * 20).map(host => ({
                  ...host,
                  environment_count: environments.filter(env => env.host_id === host.id && !(env.desired === "deleted" && env.phase === "deleted" && env.generation === env.observed_generation)).length,
                })),
          total: mode === "host-empty" ? 0 : hosts.length,
        })
      }
      if (route === "engine-host-enrollments" && req.method === "POST") {
        if (mode === "enrollment-error")
          return fail(503, "安装命令生成失败，请重试")
        const id = nextHost()
        const expires = new Date(
          Date.now() + (mode === "enrollment-expired" ? -1000 : 1800000)
        ).toISOString()
        hosts.unshift({
          id,
          name: "待接入宿主机",
          architecture: "",
          version: "dev",
          status: "pending",
          online: false,
          enabled:false,
          max_environments:0,
          user_id:userID,
          activated_at:null,
          last_seen_at: null,
          report: {},
        })
        return send(
          {
            host_id: id,
            command:
              "sudo bash -c \"$(curl -kfsSL 'https://server.example.test/api/host/v1/install.sh?token=fixture')\"",
            version: "dev",
            expires_at: expires,
          },
          201
        )
      }
      if (/^engine-hosts\/[^/]+\/enrollment$/.test(route) && req.method === "POST") {
        if (mode === "enrollment-error") return fail(503, "安装命令生成失败，请重试")
        const host = hosts.find((item) => item.id === route.split("/")[1])
        if (!host || host.status !== "pending") return fail(409, "宿主不可重新生成安装命令")
        const expires=new Date(Date.now()+1800000).toISOString()
        const id=nextHost()
        const replacement={...host,id,created_at:new Date().toISOString()}
        hosts.splice(hosts.indexOf(host),1,replacement)
        return send({ host_id: id, version: host.version, expires_at: expires,
          command: `sudo bash -c "$(curl -kfsSL 'https://server.example.test/api/host/v1/install.sh?token=renewed-${Date.now()}')"` })
      }
      if (route.startsWith("engine-hosts/") && req.method === "DELETE") {
        const host = hosts.find((item) => item.id === route.split("/")[1])
        if (route.endsWith("/record")) {
          if (
            environments.some(
              (env) =>
                env.host_id === host?.id &&
                !(
                  env.desired === "deleted" &&
                  env.phase === "deleted" &&
                  env.generation === env.observed_generation
                )
            )
          )
            return fail(409, "宿主仍有关联云环境，请先删除环境并等待清理完成")
          if (host) hosts.splice(hosts.indexOf(host), 1)
          res.writeHead(204)
          return res.end()
        }
        if (!host) return fail(404, "宿主不存在")
        host.status = "revoked"
        res.writeHead(204)
        return res.end()
      }
      if (/^environment-hosts\/[^/]+\/scheduling$/.test(route) && req.method === "PATCH") {
        const host = hosts.find((item) => item.id === route.split("/")[1])
        if (!host || host.status !== "active") return fail(409, "宿主不可调度")
        host.enabled = body.enabled
        return send({enabled: body.enabled})
      }
      if (/^environment-hosts\/[^/]+\/setup$/.test(route)) {
        if (mode === "setup-load-error" && req.method === "GET") return fail(503, "配置暂不可用")
        const id = route.split("/")[1]
        const setup = setupFor(id)
        if (req.method === "PUT") {
          if (mode === "setup-save-error") return fail(503, "配置暂时无法保存")
          setup.resource = body.resource
          setup.max_environments=body.max_environments
          setup.user_max_environments=body.user_max_environments
          const host=hosts.find(h=>h.id===id);if(host)host.max_environments=body.max_environments
          if (body.billing) setup.billing = body.billing
          if (body.grants) setup.grants = body.grants
        }
        return send({...setup,host_id:id,host_name:hosts.find(h=>h.id===id)?.name ?? id,image_ready:true,capacity})
      }
      const paginate = (items) => {
        const page = Number(url.searchParams.get("page") || 1)
        return {
          items: items.slice((page - 1) * 20, page * 20),
          page,
          page_size: 20,
        }
      }
      if (route === "environment-hosts")
        return send(
          paginate([
            {
              ...capacity,
              sync_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            },
          ])
        )
      if (route.startsWith("environment-hosts/") && req.method === "PUT") {
        const host=hosts.find(h=>h.id===route.split("/")[1])
        if(!host)return fail(404,"宿主不存在")
        host.enabled=body.enabled;host.max_environments=body.max_environments
        setupFor(host.id).max_environments=body.max_environments
        Object.assign(capacity,body)
        return send({...capacity,host_id:host.id})
      }
      if (route.startsWith("environment-quotas/")) {
        const host = url.searchParams.get("host_id")
        if (!host) return fail(400,"请指定宿主")
        const user = route.split("/")[1], key = `${host}:${user}`
        if (req.method === "PUT") quotaOverrides.set(key,{...body,host_id:host,user_id:user})
        return send(quotaOverrides.get(key) ?? {max_environments:setupFor(host).user_max_environments,host_id:host,user_id:user})
      }
      if (route === "environments") {
        if (mode === "list-error") return fail(503, "环境列表暂不可用")
        const state = (env) => env.generation !== env.observed_generation ? `pending_${env.desired}` : env.phase
        const status = url.searchParams.get("status") || "active"
        const sort = url.searchParams.get("sort") || "newest"
        const metric = (env) => {
          if (state(env) !== "running" || env.desired !== "running" || !env.usage || Date.now() - Date.parse(env.usage.at) > 90000) return null
          return env.usage[sort.startsWith("cpu") ? "cpu_cores" : "memory_bytes"] ?? null
        }
        const host = url.searchParams.get("host_id")
        const rows = environments.filter(env => (!host || env.host_id === host) && (status === "all" || (status === "active" ? state(env) !== "deleted" : state(env) === status)))
        if (sort !== "newest") rows.sort((a,b) => {
          const x = metric(a), y = metric(b)
          if (x === null) return y === null ? 0 : 1
          if (y === null) return -1
          return (x-y) * (sort.endsWith("desc") ? -1 : 1)
        })
        return send(paginate(mode === "list-empty" ? [] : rows.map(withBilling)))
      }
      if (route.startsWith("environments/")) {
        const [, id, action] = route.split("/"),
          env = environments.find((item) => item.id === id)
        if (!env) return fail(404, "环境不存在")
        if (req.method === "GET")
          return send(
            action === "operations" ? paginate(operations.get(id) ?? []) : withBilling(env)
          )
        if (mode === "generation-conflict") return fail(409, "环境版本已变化")
        const key = `${id}:${body.request_key}`
        if (idempotency.has(key)) return send(idempotency.get(key), 202)
        if (body.generation !== env.generation)
          return fail(409, "环境版本已变化")
        env.generation++
        env.desired = action === "stop" ? "stopped" : "deleted"
        const op = {
          id: uuid(2000 + requests.length),
          generation: env.generation,
          desired: env.desired,
          status: "pending",
          reason: "",
          created_at: new Date().toISOString(),
          finished_at: null,
        }
        operations.set(id, [op, ...(operations.get(id) ?? [])])
        const result = { environment: structuredClone(env), operation: op }
        idempotency.set(key, result)
        if (mode === "lost-response") {
          mode = ""
          return fail(503, "响应丢失，请重试")
        }
        return send(result, 202)
      }
      return send({})
    }
    let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`)
    if (!file.startsWith(dist + path.sep)) file = path.join(dist, "index.html")
    if (!(await stat(file).catch(() => null))?.isFile())
      file = path.join(dist, "index.html")
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
    })
    res.end(await readFile(file))
  } catch (error) {
    fail(500, error.message)
  }
})
server.listen(Number(process.env.PORT || 4187), "127.0.0.1", () =>
  console.log(`环境界面测试服务：http://127.0.0.1:${server.address().port}`)
)
