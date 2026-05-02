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
