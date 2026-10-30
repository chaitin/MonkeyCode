import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dist = path.resolve(fileURLToPath(new URL("../dist/", import.meta.url)))
const GiB = 1024 ** 3
const uuid = (value) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
const userID = uuid(900),
  hostID = uuid(901),
  presetID = uuid(902)
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
let mode = "",
  requests = [],
  operations = new Map(),
  idempotency = new Map()
const presets = [
  {
    id: presetID,
    name: "开发环境 2C4G",
    enabled: true,
    configuration: profile,
    created_at: new Date().toISOString(),
  },
]
const capacity = {
  host_id: hostID,
  enabled: false,
  cpu_millis: 16000,
  memory_bytes: 32 * GiB,
  storage_bytes: 500 * GiB,
  max_environments: 20,
  protocol: 1,
  architecture: "amd64",
  status: "active",
}
const quota = {
  user_id: userID,
  max_environments: 3,
  max_running: 2,
  cpu_millis: 8000,
  memory_bytes: 16 * GiB,
  storage_bytes: 100 * GiB,
}
const environments = Array.from({ length: 21 }, (_, i) => ({
  id: uuid(i + 1),
  name: `验收项目 ${i + 1}`,
  user_id: userID,
  host_id: hostID,
  preset_id: presetID,
  generation: 1,
  observed_generation: 1,
  instance_id: uuid(100 + i),
  desired: "running",
  phase: "running",
  reason: "",
  observed_at: new Date().toISOString(),
  compute_reserved: true,
  storage_retained: true,
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
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
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
      }
      return send({ mode, requests, environments, presets, capacity, quota })
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
      if (route === "environment-presets" && req.method === "POST") {
        const preset = {
          id: uuid(1000 + presets.length),
          ...body,
          enabled: true,
          created_at: new Date().toISOString(),
        }
        presets.unshift(preset)
        return send(preset, 201)
      }
      if (route.startsWith("environment-presets/") && req.method === "PATCH") {
        Object.assign(
          presets.find((item) => item.id === route.split("/")[1]),
          body
        )
        res.writeHead(204)
        return res.end()
      }
      const paginate = (items) => {
        const page = Number(url.searchParams.get("page") || 1)
        return {
          items: items.slice((page - 1) * 20, page * 20),
          page,
          page_size: 20,
        }
      }
      if (route === "environment-presets") return send(paginate(presets))
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
        if (mode === "capacity-conflict")
          return fail(409, "容量不能低于已有预留")
        Object.assign(capacity, body)
        return send(capacity)
      }
      if (route.startsWith("environment-quotas/")) {
        if (req.method === "PUT") Object.assign(quota, body)
        return send(quota)
      }
      if (route === "environments") {
        if (mode === "list-error") return fail(503, "环境列表暂不可用")
        return send(paginate(mode === "list-empty" ? [] : environments))
      }
      if (route.startsWith("environments/")) {
        const [, id, action] = route.split("/"),
          env = environments.find((item) => item.id === id)
        if (!env) return fail(404, "环境不存在")
        if (req.method === "GET")
          return send(
            action === "operations" ? paginate(operations.get(id) ?? []) : env
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
