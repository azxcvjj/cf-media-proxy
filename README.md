# cf-media-proxy

基于 Cloudflare Workers 的媒体库反向代理管理平台，支持多节点负载均衡、访客统计分析、Telegram Bot 通知。

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

- `cf-media-proxy.js` - 混淆版（用于部署）
- `cf-media-proxy-source.js` - 源码备份

## 更新日志

### v2.0.8.2
- 修复同源/跨域 URL 处理逻辑，同时支持 Hills Windows (OK服务器) 和 Forward iOS (UHD服务器) 播放
- 混淆版添加版本注释，修复在线更新检测功能

## 作者

MakkaPakka | Telegram: https://t.me/MakkaPakkaOvO
