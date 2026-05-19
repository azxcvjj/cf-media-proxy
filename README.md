# cf-media-proxy

基于 Cloudflare Workers 的媒体库反向代理管理平台，支持多节点负载均衡、访客统计分析、Telegram Bot 通知。
原作者MakkaPakka | Telegram: https://t.me/MakkaPakkaOvO
本项目主要进行日常同步问题修复，前端及tg通知优化。

## 功能特性

- 多节点负载均衡
- 通用反代开关控制
- 访客日志统计
- Cloudflare Analytics 聚合流量数据
- Telegram Bot 通知
- Dark OLED 管理界面

## 部署

详细部署教程请参阅：[部署指南](https://placid-lobster-76a.notion.site/342c1cddefa180b9972ce0b2190302ff)

## 文件说明

- cf-media-proxy.js - 混淆版（用于部署）
- cf-media-proxy-source.js - 源码备份

## 更新日志

### v2.1.1.0
- 优化 TG 通知展示：热门来源改为 `国家-城市 · IP`，热门节点 Top3 统一格式并追加今日流量
- 精简 TG 通知结构：增加简版健康摘要与异常节点提示，流量消耗改为“累计 + 趋势词”表达
- 优化节点状态消息：直达链接改为短标签超链接，末播时间支持“从未播放”弱提示与相对时间显示
- 增强数据大屏展示：最新独立播放记录的归属地支持精确城市显示并统一中文化

### v2.1.0.8
- 修复在线更新版本解析在浏览器端偶发失效的问题，增强对版本注释与 `CURRENT_VERSION` 的兼容识别
- 优化 Cloudflare 在线部署变量处理：保留 `secret_text` 类型并启用 `bindings_inherit=strict`，避免部署时把密钥覆盖成明文
- 增强通用反代入口兼容性：同时支持 legacy `/https://...` 与编码格式 `/{scheme}/{domain}/{port}/{path}`
- 提升管理面板稳定性：为关键加载流程增加超时保护、重试保护和异常兜底，降低“登录后一直加载中”概率

### v2.1.0.7
- 加固 DNS 更新流程：先校验 A/AAAA/CNAME 记录格式和数量，再执行 Cloudflare 更新；新增失败回滚旧记录逻辑，降低解析被清空风险
- 修复管理面板外部数据渲染风险：图标库、自定义 API 节点、测速列表、DNS 状态统一增加 URL 校验和 HTML/属性/JS 字符串转义
- 为 JSON、M3U8 和可重试请求体重写增加大小上限，超过阈值时跳过重写或拒绝重试，避免大体积内容压垮 Worker 内存
- 登录 Cookie 增加 `Secure; SameSite=Strict`，降低跨站请求自动携带管理登录态的风险

### v2.1.0.6
- 优化 Cloudflare API 错误提示：部署、在线更新、放置地区、DNS、缓存清理和 Analytics 查询失败时，会显示错误代码对应的中文排查建议
- 细化不同 Cloudflare 操作的权限提示：Workers、DNS、缓存清理、Analytics 分别提示对应 Token 权限和资源 ID 检查方向
- 在线更新和手动部署失败弹窗改为直接展示可读错误信息，避免只看到原始 JSON 字符串

### v2.1.0.5
- 修复管理 API 鉴权顺序：`/api/placement`、通用反代开关等接口现在必须通过 `ADMIN_TOKEN` 校验
- 增强管理面板安全：节点、访问日志、统计卡片等动态内容增加 HTML/属性转义，降低持久型 XSS 风险
- 增加路由配置校验：限制 prefix、mode、源站 URL 和图标 URL 格式，避免异常配置写入 D1
- 修复通用反代相对重定向处理，`Location: /path` 会按实际源站继续代理
- 优化 Cloudflare GraphQL 流量查询中的 prefix 字符串编码，避免异常前缀破坏查询语法

### v2.1.0.4
- 修复在线更新检测失败问题：使用纯字符串处理替代正则匹配，完全避免压缩工具对正则的破坏

### v2.1.0.3
- 修复前端探针 `coloToCountry` 映射不完整的问题，新增 150+ 机场代码

### v2.1.0.3
- 修复前端探针 `coloToCountry` 映射不完整的问题，新增 150+ 机场代码

### v2.1.0.2
- 统一问候语函数：`sendTgStats` 改用 `getGreeting()` 替代本地计算
- 混淆流程优化：先混淆后压缩，体积比源码减少 17%
- 完善 Cloudflare 机房代码映射：新增 60+ 城市代码（SJC、OKC、CLE 等），修复未知机房显示「地球」的问题

### v2.1.0.1 (对比 v2.1.0.0)
- 修复 Forward iOS 客户端通过 UHD 节点反代播放时，媒体地址前缀丢失问题
- 修复 Forward "自动更新服务器地址"功能导致的服务器地址变回源站问题
- 媒体文件路径（/videos/...、/Audio/...）始终返回完整代理 URL 格式
- 服务器地址字段（LocalAddress、ServerUrl 等）正确重写为代理地址

### v2.1.0.0
- 参考 Go 项目 emby-reverse-proxy-go 优化架构
- 🆕 通用反代编码格式支持：支持 `/{scheme}/{domain}/{port}/{path}` 格式（如 `/https/emby.example.com/443/videos/123.m3u8`）
- 🆕 高效 URL 重写引擎：使用 indexOf 字节扫描代替正则匹配，提升性能
- 🆕 增强型媒体识别：添加扩展名白名单（mp4/mkv/m3u8 等），Go 项目风格
- 🆕 日志分级系统：支持 `[API]` `[STREAM]` `[PROXY]` `[WS]` 请求分类日志（可通过 ENABLE_DETAILED_LOGGING 开关）

### v2.0.9.1
- 修复 UHD 节点媒体地址前缀消失问题：Forward iOS 客户端通过 UHD 节点反代播放时，媒体地址前缀丢失变回源站地址

### v2.0.9.0
- 代码优化：提取工具函数 (formatBytes, parseClientName, getClientIcon) 减少重复代码
- GraphQL 查询优化：批量查询避免复杂度限制，每批最多 10 个前缀
- 数据库性能优化：添加 visitor_logs 表索引 (country, timestamp)
- visitor_logs 清理移至 scheduled 定时任务，避免请求阻塞
- TG 通知代码重构：简化空值判断逻辑，使用可选链 (?. , ??) 提升可读性

### v2.0.8.5
- TG Bot 安全增强：添加 Chat ID 白名单验证，防止未授权用户访问

### v2.0.8.4
- TG 通知美化：横线缩短至 16 个字符，标题加粗
- TG 通知新增随机壁纸顶部图
- 客户端分布重构：按平台分类显示（iOS/Android/Windows 等），图标对应平台

### v2.0.8.3
- 修复 OK 服务器播放请求中损坏的 URL 路径（如 embyhttps://...）导致的播放失败
- 修复 UHD 透传模式下响应被错误重写的问题，透传模式现在会跳过响应重写

### v2.0.8.2
- 修复同源/跨域 URL 处理逻辑，同时支持 Hills Windows (OK服务器) 和 Forward iOS (UHD服务器) 播放
- 混淆版添加版本注释，修复在线更新检测功能
