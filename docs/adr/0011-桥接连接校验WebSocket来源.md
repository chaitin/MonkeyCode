# 桥接连接校验 WebSocket 来源

桥接连接复用登录 Cookie，因此 WebSocket 升级请求携带非空 `Origin` 时必须匹配配置的可信域名白名单，原生客户端未携带 `Origin` 时仍需通过用户会话鉴权。新桥接端点不得使用现有 WebSocket 工具中的宽松跨域升级设置，避免恶意网页借用用户 Cookie 建立跨站连接。
