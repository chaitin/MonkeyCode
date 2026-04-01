# Stream Attach 最新论次设计

## 背景

当前任务流的 `mode=attach` 目标语义是：

- 只拉取最新一个论次的消息
- 如果该论次已结束（已出现 `task-ended`），完整回放后立即关闭 WebSocket
- 如果该论次未结束，先回放该论次已有历史，再持续接收该论次后续实时消息
- 一旦收到该论次的 `task-ended`，立即关闭 WebSocket

现有实现存在两个问题：

1. `attach` 的历史阶段调用了 `loki.Tail()`，它会在历史结束后继续停留在 Loki 实时阶段，导致后续 `TaskLive` 拼接逻辑无法按预期工作。
2. `attach` 只按“最后一个 `user-input`”估算起点，无法准确表达“最新一个论次”的完整边界语义。

这会导致任务运行中刷新页面时，`attach` 返回的数据被截断；稍后再次刷新，由于 Loki 数据补齐，又会看到完整论次。

## 目标

将 `mode=attach` 改为严格的“最新论次订阅”语义：

- 历史阶段和实时阶段都只覆盖最新论次
- 运行中刷新不会丢失当前论次开头，也不会串入上一论次
- 已结束论次只回放一次，不进入实时订阅

## 论次定义

系统中的一个完整论次定义为：

`user-input -> ... -> task-started -> ... -> task-ended`

其中：

- `user-input` 表示本轮用户输入
- `task-started` 表示本轮任务正式启动
- `task-ended` 表示本轮任务结束

历史分页已经按 `task-started` 进行分割，但在论次内容中仍包含与该 `task-started` 对应的前导 `user-input`。

## attach 语义

### 1. 最新论次判定

`attach` 需要定位“最新一个论次”的起点时间。

规则如下：

1. 直接取最近一个 `user-input` 作为最新论次起点
2. 如果不存在 `user-input`，则退回任务创建时间

该规则保证：

- `attach` 的起点语义足够简单，和用户视角一致
- `user-input` 已发送但 `task-started` 尚未落日志时，不会漏掉新一轮开头
- 不依赖 `task-started` 是否及时落日志

### 2. 历史阶段

`attach` 建立时记录一个固定时间点 `attachNow`。

历史阶段只查询区间 `[latestRoundStart, attachNow]` 内的日志，并按时间正序回放。

如果这段历史中已经包含 `task-ended`，说明最新论次在 attach 开始时已经结束：

- 直接完成回放
- 立即关闭 WebSocket

### 3. 实时阶段

如果历史阶段未发现 `task-ended`，说明最新论次仍在进行中：

- 继续消费 `TaskLive` 缓冲和后续实时流
- 实时阶段只关注最新论次后续消息
- 收到 `task-ended` 后立即关闭 WebSocket

## 实现方案

### Loki 客户端

在 `pkg/loki/client.go` 新增仅查询历史区间的接口，避免复用 `Tail()`：

- 支持按时间窗口读取历史日志
- 支持在窗口内查找最后一个指定事件
- 支持在指定上界之前查找“某事件前最近的另一个事件”

### TaskHandler

在 `biz/task/handler/v1/task.go` 中：

- 将 `attach` 过程拆成“定位最新论次起点 -> 回放窗口历史 -> 按需消费实时流”
- 不再把 `loki.Tail()` 当作历史回放接口
- 关闭条件严格绑定到最新论次的 `task-ended`

## 测试策略

需要覆盖以下场景：

1. 最新论次已结束：`attach` 只回放这一论并关闭
2. 最新论次运行中：`attach` 回放历史后继续等待实时流，收到 `task-ended` 后关闭
3. 存在多轮历史：应以最近一个 `user-input` 作为最新论次起点
4. 存在多论历史：`attach` 只返回最新一论

## 影响范围

- `mode=new` 实时推送语义不变
- `/rounds` 历史分页逻辑不变
- 只修正 `mode=attach` 的论次选择与拼接方式
