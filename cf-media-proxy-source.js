// VERSION: 2.1.1.1
// 🟢 面板核心配置区 (放在最顶端方便修改)
const CURRENT_VERSION = "2.1.1.1";
const GITHUB_RAW_URL = "https://raw.githubusercontent.com/azxcvjj/cf-media-proxy/main/cf-media-proxy.js";

// ==========================================
// 🟢 通用反代开关配置
// ==========================================
// 设置为 true = 允许通用反代 (格式: /http://xxx 或 /https://xxx)
// 设置为 false = 禁止通用反代 (只能通过已配置的节点访问)
const ALLOW_GENERAL_PROXY = true;

// ==========================================
// 🟢 通用反代 URL 格式配置
// ==========================================
// 支持两种通用反代 URL 格式：
// 1. 传统格式: /https://example.com/path (直接拼接)
// 2. 编码格式: /https/example.com/443/path (Go项目风格，更规范)
// 设置为 true = 优先使用编码格式 /{scheme}/{domain}/{port}/{path}
// 设置为 false = 仅使用传统格式 /{scheme}://{full-url}
const ENABLE_ENCODED_PROXY_FORMAT = true;

// ==========================================
// 🟢 日志分级配置
// ==========================================
// 设置为 true = 启用详细日志分级 [API]/[STREAM]/[PROXY]
// 设置为 false = 仅保留基本错误日志
const ENABLE_DETAILED_LOGGING = false;

// ==========================================
// 🟢 数据库查询优化配置
// ==========================================
// 日期筛选常量（统一时区和查询条件）
const DATE_FILTER_CST = "date(timestamp, '+8 hours') = date('now', '+8 hours')";  // 中国时区当天
const DATE_FILTER_7D = "timestamp >= datetime('now', '-7 days')";                  // 7天内
const DATE_FILTER_30D = "timestamp >= datetime('now', '-30 days')";                 // 30天内
const MAX_DNS_RECORDS = 20;
const MAX_REWRITE_BODY_BYTES = 5 * 1024 * 1024;
const MAX_REPLAY_BODY_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_IP_LIST_BYTES = 512 * 1024;
const MAX_JSON_REWRITE_DEPTH = 12;
const ROUTE_CACHE_TTL_MS = 30 * 1000;
const SETTINGS_CACHE_TTL_MS = 30 * 1000;
const GRAPHQL_TRAFFIC_CACHE_TTL_MS = 5 * 60 * 1000;
const PLAY_SESSION_DEDUPE_TTL_MS = 60 * 1000;

const ROUTE_BY_PREFIX_CACHE = new Map();
const GENERAL_PROXY_ENABLED_CACHE = new Map();
const CF_TOTAL_TRAFFIC_CACHE = new Map();
const CF_PREFIX_TRAFFIC_CACHE = new Map();
const PLAY_SESSION_DEDUPE_CACHE = new Map();

function getMemoryCache(cache, key) {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
        cache.delete(key);
        return undefined;
    }
    return hit.value;
}

function setMemoryCache(cache, key, value, ttlMs) {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
}

function buildPlaySessionDedupeKey(prefix, ip, ua) {
    const normalizedPrefix = String(prefix || '').trim();
    const normalizedIp = String(ip || 'Unknown').trim();
    const normalizedUa = String(ua || 'Unknown').slice(0, 160);
    return `${normalizedPrefix}|${normalizedIp}|${normalizedUa}`;
}

function shouldRecordPlaySession(prefix, ip, ua) {
    const key = buildPlaySessionDedupeKey(prefix, ip, ua);
    if (getMemoryCache(PLAY_SESSION_DEDUPE_CACHE, key)) return false;
    setMemoryCache(PLAY_SESSION_DEDUPE_CACHE, key, true, PLAY_SESSION_DEDUPE_TTL_MS);
    return true;
}

// 统一时间格式化（北京时间，固定格式）
function fmtTime(ts) {
    const ms = typeof ts === 'number' ? ts : ts.getTime();
    const d = new Date(ms + 8 * 3600000);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${d.getUTCHours().toString().padStart(2,'0')}:${d.getUTCMinutes().toString().padStart(2,'0')}`;
}

// 统一字节格式化函数
function formatBytes(bytes) {
    if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(2) + " TB";
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
    if (bytes > 0) return bytes + " B";
    return "0 B";
}

// 统一客户端名称解析函数
function parseClientName(ua) {
    if (!ua || ua === 'Unknown') return null;
    const lowerUA = ua.toLowerCase();
    const detectOS = () => {
        if (lowerUA.includes('windows phone')) return 'Windows Phone';
        if (lowerUA.includes('iphone') || lowerUA.includes('ipad') || lowerUA.includes('ios')) return 'iOS';
        if (lowerUA.includes('android')) return 'Android';
        if (lowerUA.includes('mac os') || lowerUA.includes('macintosh')) return 'macOS';
        if (lowerUA.includes('windows')) return 'Windows';
        if (lowerUA.includes('ubuntu')) return 'Ubuntu';
        if (lowerUA.includes('linux')) return 'Linux';
        return null;
    };
    const os = detectOS();
    let cleanUA = lowerUA.replace(/\/(?:[\d.]+|\d+)/g, '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    // iOS 客户端
    if (cleanUA.includes('infuse')) return 'Infuse iOS';
    if (cleanUA.includes('yybx')) return 'yybx iOS';
    if (cleanUA.includes('iemc')) return 'iemc iOS';
    if (cleanUA.includes('fileball')) return 'Fileball iOS';
    if (cleanUA.includes('hamhub')) return 'HamHub iOS';
    if (cleanUA.includes('senplayer')) return 'SenPlayer iOS';
    if (cleanUA.includes('conflux')) return 'Conflux iOS';
    if (cleanUA.includes('iplay')) return os ? `iPlay ${os}` : 'iPlay';
    if (cleanUA.includes('forward')) return 'Forward iOS';
    if (cleanUA.includes('reflix')) return 'Reflix iOS';
    if (cleanUA.includes('capyplayer')) return 'CapyPlayer iOS';
    // Android 客户端
    if (cleanUA.includes('afusekt')) return 'Afusekt Android';
    if (cleanUA.includes('yamby')) return 'Yamby Android';
    if (cleanUA.includes('findroid')) return 'Findroid Android';
    if (cleanUA.includes('femor')) return 'Femor Android';
    // Windows 客户端
    if (cleanUA.includes('tsukimi')) return 'Tsukimi Windows';
    // 跨平台客户端
    if (/\bhills\b/i.test(cleanUA)) return os ? `Hills ${os}` : 'Hills';
    if (cleanUA.includes('emby')) return os ? `Emby ${os}` : 'Emby';
    if (cleanUA.includes('jellyfin')) return os ? `Jellyfin ${os}` : 'Jellyfin';
    if (cleanUA.includes('plex')) return os ? `Plex ${os}` : 'Plex';
    if (cleanUA.includes('kodi')) return os ? `Kodi ${os}` : 'Kodi';
    // 浏览器
    if (cleanUA.includes('chrome') && !cleanUA.includes('edg')) return os ? `Chrome ${os}` : 'Chrome';
    if (cleanUA.includes('firefox')) return os ? `Firefox ${os}` : 'Firefox';
    if (cleanUA.includes('safari') && !cleanUA.includes('chrome')) return os ? `Safari ${os}` : 'Safari';
    if (cleanUA.includes('edge') || cleanUA.includes('edg')) return os ? `Edge ${os}` : 'Edge';
    if (cleanUA.includes('opera') || cleanUA.includes('opr')) return os ? `Opera ${os}` : 'Opera';
    if (cleanUA.includes('brave')) return os ? `Brave ${os}` : 'Brave';
    // 播放器
    if (cleanUA.includes('vlc')) return os ? `VLC ${os}` : 'VLC';
    if (cleanUA.includes('mpv')) return os ? `MPV ${os}` : 'MPV';
    if (cleanUA.includes('mplayer')) return os ? `MPlayer ${os}` : 'MPlayer';
    if (cleanUA.includes('curl') || cleanUA.includes('wget')) return '命令行工具';
    if (os) return os;
    if (cleanUA.length > 0 && cleanUA.length < 80) return cleanUA.substring(0, 50);
    return '其他';
}

// 统一客户端图标获取函数
function getClientIcon(name) {
    const osMatch = name.match(/(iOS|Android|Windows|macOS|Linux|Ubuntu|Windows Phone)/);
    const os = osMatch ? osMatch[1] : name;
    if (os === 'iOS' || os === 'macOS') return '🍎';
    if (os === 'Android') return '🤖';
    if (os === 'Windows') return '💻';
    if (os === 'Linux' || os === 'Ubuntu') return '🐧';
    if (os === 'Windows Phone') return '📱';
    if (name === '命令行工具') return '⚙️';
    return '📱';
}
// ==========================================

// ==========================================
// 1. 网页界面-单播报版本
// ==========================================

// ==========================================
// 🟢 SVG 图标库 (替换 Emoji)
// ==========================================
const SVG_SHIELD = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>`;
const SVG_EYE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
const SVG_ANALYTICS = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>`;
const SVG_LOCATION = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
const SVG_ROCKET = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c-4.76 0-8.5 3.74-8.5 8.5 0 3.13 1.63 5.86 4.19 7.38L12 22l4.31-3.62c2.56-1.52 4.19-4.25 4.19-7.38 0-4.76-3.74-8.5-8.5-8.5zm0 12c-1.93 0-3.5-1.57-3.5-3.5S10.07 7.5 12 7.5s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
const SVG_SETTINGS = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`;
const SVG_CHECK = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
const SVG_CLOSE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
const SVG_COPY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
const SVG_DELETE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
const SVG_DNS = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/></svg>`;
const SVG_RADAR = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;
const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
const SVG_UPLOAD = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2v2h6v-2H5z"/></svg>`;
const SVG_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const SVG_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
const SVG_EDIT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
const SVG_SEARCH = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
const SVG_THEME = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>`;
const SVG_LOGOUT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>`;
const SVG_TG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/></svg>`;
const SVG_FILE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
const SVG_CLEAR = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
const SVG_REFRESH = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`;
const SVG_SPEED = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.38 8.57l-1.23 1.85a8 8 0 01-.22 7.58H5.07A8 8 0 0115.58 6.85l1.85-1.23A10 10 0 003.35 19a2 2 0 001.72 1h13.85a2 2 0 001.74-1 10 10 0 00-.27-10.44zm-9.79 6.84a2 2 0 002.83 0l5.66-8.49-8.49 5.66a2 2 0 000 2.83z"/></svg>`;
const SVG_LINK = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`;
const SVG_WARNING = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`;
const SVG_INFO = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
const SVG_STAR = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
const SVG_MOON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>`;
const SVG_SUN = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/></svg>`;
const SVG_DOWN_ARROW = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/></svg>`;

// ==========================================
// 🟢 工具函数区
// ==========================================
// 防抖函数：防止频繁触发
function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 节流函数：限制调用频率
function throttle(func, limit = 300) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// 统一的错误日志函数
function logError(context, error, details = {}) {
    const timestamp = new Date().toISOString();
    const errorInfo = {
        timestamp,
        context,
        message: error.message || String(error),
        stack: error.stack || '',
        ...details
    };
    console.error(`[${timestamp}] [${context}] Error:`, errorInfo);
    return errorInfo;
}

// ==========================================
// 🟢 Cloudflare GraphQL 流量查询工具函数
// ==========================================
// 通用函数：按前缀分批查询流量，避免复杂度限制
// 返回 Map<prefix, bytes>
async function queryTrafficByPrefixes(env, routes, startISO, endISO, batchSize = 10) {
    const bytesMap = new Map(routes.map(r => [r.prefix, 0]));
    const batchTimeoutMs = 2500;
    const totalBudgetMs = 8000;
    const deadline = Date.now() + totalBudgetMs;
    
    // 分批查询避免 GraphQL 复杂度限制
    const batches = [];
    for (let i = 0; i < routes.length; i += batchSize) {
        batches.push(routes.slice(i, i + batchSize));
    }

    for (const batch of batches) {
        if (Date.now() > deadline) {
            console.warn('GraphQL query budget exceeded, return partial traffic data.');
            break;
        }
        const prefixLike = batch.map(r => `{clientRequestPath_like:${JSON.stringify('/' + r.prefix + '%')}}`).join(',');
        const graphqlQuery = {
            query: `query {
              viewer {
                zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
                  httpRequestsAdaptiveGroups(
                    limit: 5000,
                    filter: {
                      OR: [${prefixLike}],
                      datetime_geq: "${startISO}",
                      datetime_leq: "${endISO}"
                    }
                  ) {
                    dimensions { clientRequestPath }
                    sum { edgeResponseBytes }
                  }
                }
              }
            }`
        };

        let timeoutId = null;
        try {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), batchTimeoutMs);
            const cfRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(graphqlQuery),
                signal: controller.signal
            });

            const cfData = await cfRes.json();
            if (cfData.errors && cfData.errors.length > 0) {
                console.error(formatCloudflareApiError(cfData.errors, cfRes.status, '查询 Cloudflare GraphQL 流量'));
                continue;
            }
            const groups = cfData?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];

            groups.forEach(g => {
                const path = g.dimensions?.clientRequestPath || '';
                const bytes = g.sum?.edgeResponseBytes || 0;
                routes.forEach(r => {
                    if (path.startsWith('/' + r.prefix)) {
                        bytesMap.set(r.prefix, (bytesMap.get(r.prefix) || 0) + bytes);
                    }
                });
            });
        } catch(e) {
            if (e && e.name === 'AbortError') {
                console.error('GraphQL query timeout, skip this batch.');
            } else {
                console.error('GraphQL query failed:', e.message);
            }
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    }

    return bytesMap;
}

function buildPrefixTrafficCacheKey(env, routes, startISO) {
    const routeKey = routes.map(r => r.prefix).join('|');
    return `${env.CF_ZONE_ID || ''}:${startISO}:${routeKey}`;
}

async function queryTrafficByPrefixesCached(env, routes, startISO, endISO, batchSize = 10) {
    const key = buildPrefixTrafficCacheKey(env, routes, startISO);
    const cached = getMemoryCache(CF_PREFIX_TRAFFIC_CACHE, key);
    if (cached instanceof Map) return new Map(cached);

    const bytesMap = await queryTrafficByPrefixes(env, routes, startISO, endISO, batchSize);
    setMemoryCache(CF_PREFIX_TRAFFIC_CACHE, key, new Map(bytesMap), GRAPHQL_TRAFFIC_CACHE_TTL_MS);
    return bytesMap;
}

function isValidRoutePrefix(prefix) {
    return typeof prefix === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(prefix);
}

function isValidRouteMode(mode) {
    return ['off', 'realip_only', 'dual', 'strict'].includes(mode);
}

function normalizeHttpUrl(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().replace(/\/+$/g, '');
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        parsed.hash = '';
        return parsed.toString().replace(/\/+$/g, '');
    } catch(e) {
        return null;
    }
}

function validateRouteInput(data, options = {}) {
    const prefix = String(data?.prefix || '').trim().replace(/^\/+/g, '');
    if (!isValidRoutePrefix(prefix)) {
        return { ok: false, error: 'prefix 只能包含字母、数字、下划线或中划线，长度 1-64' };
    }

    const oldPrefixRaw = String(data?.oldPrefix || '').trim().replace(/^\/+/g, '');
    const oldPrefix = oldPrefixRaw || '';
    if (oldPrefix && !isValidRoutePrefix(oldPrefix)) {
        return { ok: false, error: 'oldPrefix 格式无效' };
    }

    const targets = String(data?.target || '').split(',').map(normalizeHttpUrl).filter(Boolean);
    if (targets.length === 0) {
        return { ok: false, error: '至少需要一个 http/https 源站地址' };
    }
    if (targets.length > 8) {
        return { ok: false, error: '单个节点最多允许 8 条源站线路' };
    }

    const mode = String(data?.mode || 'off');
    if (!isValidRouteMode(mode)) {
        return { ok: false, error: '节点模式无效' };
    }

    const remark = String(data?.remark || '').trim().slice(0, 128);
    const icon = data?.icon ? normalizeHttpUrl(String(data.icon)) : '';
    if (data?.icon && !icon) {
        return { ok: false, error: '图标地址必须是 http/https URL' };
    }

    const cache_img = data?.cache_img === 'off' ? 'off' : 'on';
    const sort_order = Number.isFinite(Number(data?.sort_order)) ? Number(data.sort_order) : (options.defaultSortOrder || 0);
    const last_play = String(data?.last_play || '').trim().slice(0, 32);

    return {
        ok: true,
        route: { oldPrefix, prefix, target: targets.join(','), mode, remark, icon, cache_img, sort_order, last_play }
    };
}

function isValidIpv4(value) {
    if (typeof value !== 'string') return false;
    const parts = value.split('.');
    return parts.length === 4 && parts.every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

function isPrivateIpv4(value) {
    if (!isValidIpv4(value)) return true;
    const parts = value.split('.').map(Number);
    return parts[0] === 10
        || parts[0] === 127
        || (parts[0] === 169 && parts[1] === 254)
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168)
        || parts[0] === 0
        || parts[0] >= 224;
}

function isValidIpv6(value) {
    if (typeof value !== 'string') return false;
    const raw = value.replace(/^\[|\]$/g, '');
    if (!raw.includes(':')) return false;
    try {
        const parsed = new URL(`http://[${raw}]/`);
        return parsed.hostname.length > 2;
    } catch(e) {
        return false;
    }
}

function isPrivateIpv6(value) {
    const raw = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
    return raw === '::1' || raw.startsWith('fc') || raw.startsWith('fd') || raw.startsWith('fe80:');
}

function isValidDnsHostname(value) {
    if (typeof value !== 'string') return false;
    const hostname = value.trim().replace(/\.$/, '').toLowerCase();
    if (hostname.length < 4 || hostname.length > 253 || hostname.includes('..')) return false;
    if (/^https?:\/\//i.test(hostname) || /[/?#\s"'<>`]/.test(hostname)) return false;
    return hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
        && /[a-z]/i.test(hostname.split('.').at(-1) || '');
}

function normalizeDnsRecordInput(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const clean = raw.replace(/^\[|\]$/g, '').replace(/\.$/, '');

    if (isValidIpv4(clean) && !isPrivateIpv4(clean)) {
        return { type: 'A', content: clean };
    }
    if (isValidIpv6(clean) && !isPrivateIpv6(clean)) {
        return { type: 'AAAA', content: clean };
    }
    if (isValidDnsHostname(clean)) {
        return { type: 'CNAME', content: clean.toLowerCase() };
    }
    return null;
}

function validateDnsRecordInputs(values) {
    if (!Array.isArray(values)) {
        return { ok: false, error: 'DNS 记录必须以数组形式提交' };
    }
    if (values.length === 0) {
        return { ok: false, error: '至少需要 1 条 DNS 记录' };
    }
    if (values.length > MAX_DNS_RECORDS) {
        return { ok: false, error: `一次最多允许提交 ${MAX_DNS_RECORDS} 条 DNS 记录` };
    }

    const deduped = new Map();
    for (const value of values) {
        const normalized = normalizeDnsRecordInput(value);
        if (!normalized) {
            return { ok: false, error: `DNS 记录格式无效: ${String(value ?? '').slice(0, 80)}` };
        }
        deduped.set(`${normalized.type}:${normalized.content}`, normalized);
    }

    const records = Array.from(deduped.values());
    const hasCname = records.some(record => record.type === 'CNAME');
    if (hasCname && records.length > 1) {
        return { ok: false, error: 'CNAME 记录不能与 A/AAAA 记录同时存在，也不能设置多条' };
    }
    return { ok: true, records };
}

function sanitizeExternalDnsItems(values, limit = 15) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
        const normalized = normalizeDnsRecordInput(value);
        if (!normalized) continue;
        const display = normalized.type === 'AAAA' ? `[${normalized.content}]` : normalized.content;
        if (seen.has(display)) continue;
        seen.add(display);
        result.push(display);
        if (result.length >= limit) break;
    }
    return result;
}

async function readStreamTextWithinLimit(stream, maxBytes) {
    if (!stream) return '';
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
            throw new Error(`响应体超过 ${Math.round(maxBytes / 1024 / 1024)}MB，跳过重写以保护 Worker 内存`);
        }
        text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
}

async function readResponseTextWithinLimit(response, maxBytes = MAX_REWRITE_BODY_BYTES) {
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) {
        throw new Error(`响应体超过 ${Math.round(maxBytes / 1024 / 1024)}MB，跳过重写以保护 Worker 内存`);
    }
    return readStreamTextWithinLimit(response.body, maxBytes);
}

async function readRequestArrayBufferWithinLimit(request, maxBytes = MAX_REPLAY_BODY_BYTES) {
    const length = Number(request.headers.get('content-length') || 0);
    if (length > maxBytes) {
        throw new Error(`请求体超过 ${Math.round(maxBytes / 1024 / 1024)}MB，无法安全重试`);
    }
    const reader = request.body?.getReader();
    if (!reader) return new ArrayBuffer(0);
    const chunks = [];
    let bytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
            throw new Error(`请求体超过 ${Math.round(maxBytes / 1024 / 1024)}MB，无法安全重试`);
        }
        chunks.push(value);
    }
    const result = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result.buffer;
}

const CLOUDFLARE_API_ERROR_TIPS = {
    10000: 'Cloudflare API Token 认证失败。',
    10001: 'Cloudflare API 请求认证信息无效。请重新生成 CF_API_TOKEN，并确认使用 Bearer Token 方式授权。',
    9103: 'Cloudflare API Token 权限不足或账号不匹配。',
    9109: 'Cloudflare API Token 无效。请重新复制或重新创建 CF_API_TOKEN。',
    7000: 'Cloudflare API 路径无法识别。',
    7003: 'Cloudflare 资源 ID 无效。',
    8000000: 'Cloudflare 请求参数无效。'
};

function getCloudflareActionContext(action = '') {
    const text = String(action).toLowerCase();
    if (/dns/.test(text)) {
        return {
            permission: 'Zone - DNS - Edit/Write',
            resource: 'CF_ZONE_ID、CF_DOMAIN 和 DNS 记录是否属于同一个 Zone',
            params: 'DNS 记录类型、记录值、域名和 TTL 是否有效'
        };
    }
    if (/缓存|cache|purge/.test(text)) {
        return {
            permission: 'Zone - Cache Purge',
            resource: 'CF_ZONE_ID 是否为当前域名所在 Zone',
            params: '清理缓存请求是否作用在正确的 Zone 上'
        };
    }
    if (/analytics|graphql|流量/.test(text)) {
        return {
            permission: 'Zone - Analytics - Read，或账号侧 Account Analytics - Read',
            resource: 'CF_ZONE_ID 是否为当前域名所在 Zone',
            params: 'GraphQL 查询条件、时间范围和 Zone ID 是否有效'
        };
    }
    if (/worker|部署|代码|绑定|配置|放置/.test(text)) {
        return {
            permission: 'Account - Workers Scripts - Edit/Write（读取配置至少需要 Read，在线更新最终部署需要 Edit/Write）',
            resource: 'CF_ACCOUNT_ID、CF_WORKER_NAME 是否属于同一个 Cloudflare 账号',
            params: 'Worker 名称、兼容日期、绑定配置和上传代码是否有效'
        };
    }
    return {
        permission: '当前操作所需的 Cloudflare API Token 权限',
        resource: 'CF_ACCOUNT_ID、CF_ZONE_ID、CF_WORKER_NAME 等资源 ID 是否匹配',
        params: '请求参数是否符合 Cloudflare API 要求'
    };
}

function getCloudflareApiErrorTip(error, status = 0, action = '') {
    const code = Number(error?.code || 0);
    const message = String(error?.message || '').toLowerCase();
    const context = getCloudflareActionContext(action);

    if (code === 10000) {
        return `${CLOUDFLARE_API_ERROR_TIPS[code]} 请检查 CF_API_TOKEN 是否为 API Token（不是 Global API Key），是否复制完整且没有空格/引号，Token 是否过期或被删除；同时确认 Token 属于当前资源所在账号，并具备 ${context.permission} 权限。`;
    }
    if (code === 9103) {
        return `${CLOUDFLARE_API_ERROR_TIPS[code]} 请确认 Token 属于当前资源所在账号，并具备 ${context.permission} 权限。`;
    }
    if (code === 9109) {
        return `${CLOUDFLARE_API_ERROR_TIPS[code]} 重新生成后只粘贴 Token 本体，不要带引号、空格或换行。`;
    }
    if (code === 7000 || code === 7003) {
        return `${CLOUDFLARE_API_ERROR_TIPS[code]} 请确认 ${context.resource}。`;
    }
    if (code === 8000000) {
        return `${CLOUDFLARE_API_ERROR_TIPS[code]} 请检查 ${context.params}；如果是在线更新，确认代码语法正确，且 KV/D1/R2 等绑定没有被删除或改名。`;
    }
    if (CLOUDFLARE_API_ERROR_TIPS[code]) return CLOUDFLARE_API_ERROR_TIPS[code];
    if (status === 401 || /authentication|authenticate|invalid token|access token/.test(message)) {
        return `Cloudflare 认证失败。请检查 CF_API_TOKEN 是否正确、是否过期，是否误用了 Global API Key，并确认 Token 具备 ${context.permission} 权限。`;
    }
    if (status === 403 || /permission|forbidden|not authorized|unauthorized|scope/.test(message)) {
        return `Cloudflare 权限不足。请确认 API Token 已授予 ${context.permission} 权限，并且 Token 与当前资源所在账号匹配。`;
    }
    if (status === 404 || /not found|could not route|no route|does not exist|identifier/.test(message)) {
        return `Cloudflare 找不到目标资源。请确认 ${context.resource}。`;
    }
    if (status === 429 || /rate limit|too many requests/.test(message)) {
        return 'Cloudflare API 请求过于频繁。请不要连续点击更新/保存，等待 1-5 分钟后再试；如果多人共用同一个 Token，也要降低调用频率。';
    }
    if (status >= 500 || /internal error|temporarily unavailable|service unavailable/.test(message)) {
        return 'Cloudflare 服务端暂时异常。请稍后重试，或到 Cloudflare 状态页确认服务状态；这类失败通常不会自动改动当前 Worker 代码。';
    }
    if (/validation|invalid|malformed|bad request/.test(message)) {
        return `Cloudflare 拒绝了请求参数。请检查 ${context.params}。`;
    }
    return 'Cloudflare API 返回了未识别错误。请根据原始错误代码和消息检查 Token、账号 ID、Worker 名称与权限。';
}

function formatCloudflareApiError(errors, status = 0, action = 'Cloudflare 操作') {
    const list = Array.isArray(errors) ? errors : [errors].filter(Boolean);
    if (list.length === 0) {
        return `${action}失败：Cloudflare API 没有返回具体错误。`;
    }

    const lines = [`${action}失败：`];
    const tips = new Set();
    list.forEach((error, index) => {
        const code = error?.code ?? 'unknown';
        const message = error?.message || JSON.stringify(error);
        lines.push(`${index + 1}. [${code}] ${message}`);
        tips.add(getCloudflareApiErrorTip(error, status, action));
    });
    lines.push('', '排查建议：');
    tips.forEach(tip => lines.push(`- ${tip}`));
    return lines.join('\n');
}

// ==========================================
// 🟢 国家代码转旗帜 Emoji
// ==========================================
const CF_COLO_TO_COUNTRY = {
    // 亚洲
    'SIN': '🇸🇬', 'NRT': '🇯🇵', 'TYO': '🇯🇵', 'KIX': '🇯🇵', 'NGO': '🇯🇵',
    'HKG': '🇭🇰', 'TPE': '🇹🇼', 'KUL': '🇲🇾', 'BKK': '🇹🇭', 'MNL': '🇵🇭',
    'ICN': '🇰🇷', 'SEL': '🇰🇷', 'PUS': '🇰🇷',
    'DEL': '🇮🇳', 'BOM': '🇮🇳', 'CCU': '🇮🇳', 'MAA': '🇮🇳', 'BLR': '🇮🇳', 'HYD': '🇮🇳',
    'DXB': '🇦🇪', 'DUB': '🇦🇪', 'AUH': '🇦🇪', 'SHJ': '🇦🇪',
    'JNB': '🇿🇦', 'CPT': '🇿🇦', 'LOS': '🇳🇬', 'KGL': '🇷🇼', 'DOH': '🇶🇦',
    // 大洋洲
    'SYD': '🇦🇺', 'MEL': '🇦🇺', 'BNE': '🇦🇺', 'PER': '🇦🇺', 'AKL': '🇳🇿', 'WLG': '🇳🇿',
    // 欧洲
    'LHR': '🇬🇧', 'LGW': '🇬🇧', 'STN': '🇬🇧', 'MAN': '🇬🇧', 'BHX': '🇬🇧', 'GLA': '🇬🇧',
    'FRA': '🇩🇪', 'MUC': '🇩🇪', 'BER': '🇩🇪', 'DTM': '🇩🇪', 'HAM': '🇩🇪',
    'AMS': '🇳🇱', 'CDG': '🇫🇷', 'PAR': '🇫🇷', 'LYS': '🇫🇷', 'MRS': '🇫🇷',
    'MAD': '🇪🇸', 'BCN': '🇪🇸', 'AGP': '🇪🇸', 'VAL': '🇪🇸',
    'FCO': '🇮🇹', 'ROM': '🇮🇹', 'MIL': '🇮🇹', 'NAP': '🇮🇹', 'TRN': '🇮🇹',
    'ZRH': '🇨🇭', 'GVA': '🇨🇭', 'BSL': '🇨🇭',
    'VIE': '🇦🇹', 'WAR': '🇵🇱', 'PRG': '🇨🇿', 'CPH': '🇩🇰', 'STO': '🇸🇪', 'ARN': '🇸🇪',
    'OSL': '🇳🇴', 'HEL': '🇫🇮', 'DUB': '🇮🇪', 'LIS': '🇵🇹', 'OPO': '🇵🇹',
    'ATH': '🇬🇷', 'IST': '🇹🇷', 'SAW': '🇹🇷',
    // 北美洲
    'LAX': '🇺🇸', 'SFO': '🇺🇸', 'SEA': '🇺🇸', 'PDX': '🇺🇸', 'LAS': '🇺🇸',
    'ORD': '🇺🇸', 'MSP': '🇺🇸', 'ATL': '🇺🇸', 'IAH': '🇺🇸', 'BNA': '🇺🇸',
    'DFW': '🇺🇸', 'DEN': '🇺🇸', 'PHX': '🇺🇸', 'IND': '🇺🇸', 'OKC': '🇺🇸',
    'JFK': '🇺🇸', 'NYC': '🇺🇸', 'BOS': '🇺🇸', 'IAD': '🇺🇸', 'DCA': '🇺🇸',
    'MIA': '🇺🇸', 'TPA': '🇺🇸', 'MSY': '🇺🇸', 'PHL': '🇺🇸', 'CLT': '🇺🇸',
    'SJC': '🇺🇸', 'SAT': '🇺🇸', 'AUS': '🇺🇸', 'SAN': '🇺🇸', 'STL': '🇺🇸',
    'MCI': '🇺🇸', 'OMA': '🇺🇸', 'MEM': '🇺🇸', 'JAX': '🇺🇸', 'PIT': '🇺🇸',
    'CLE': '🇺🇸', 'CMH': '🇺🇸', 'RIC': '🇺🇸', 'RDU': '🇺🇸', 'ABQ': '🇺🇸',
    'SLC': '🇺🇸', 'SMF': '🇺🇸', 'FSD': '🇺🇸', 'BUF': '🇺🇸', 'ANC': '🇺🇸',
    'HNL': '🇺🇸', 'BGR': '🇺🇸', 'ORF': '🇺🇸', 'TLH': '🇺🇸',
    'YYZ': '🇨🇦', 'YVR': '🇨🇦', 'YUL': '🇨🇦', 'YYC': '🇨🇦', 'YEG': '🇨🇦',
    'YOW': '🇨🇦', 'YHZ': '🇨🇦', 'YWG': '🇨🇦', 'YXE': '🇨🇦', 'YQM': '🇨🇦',
    'MEX': '🇲🇽', 'GDL': '🇲🇽', 'MTY': '🇲🇽', 'CUN': '🇲🇽',
    'LIM': '🇵🇪', 'BOG': '🇨🇴', 'MDE': '🇨🇴', 'SCL': '🇨🇱', 'EZE': '🇦🇷',
    'GYE': '🇪🇨', 'UIO': '🇪🇨', 'HAV': '🇨🇺', 'SDQ': '🇩🇴', 'SJO': '🇨🇷',
    'PTY': '🇵🇦', 'GRU': '🇧🇷', 'BSB': '🇧🇷', 'SSA': '🇧🇷', 'FOR': '🇧🇷', 'REC': '🇧🇷',
    'VCP': '🇧🇷', 'GIG': '🇧🇷', 'POA': '🇧🇷', 'CWB': '🇧🇷', 'MCO': '🇧🇷',
    'MVD': '🇺🇾', 'SYD': '🇦🇺',
    // 中国大陆 (CF 常用城市代码)
    'PEK': '🇨🇳', 'PVG': '🇨🇳', 'CAN': '🇨🇳', 'SZX': '🇨🇳', 'CTU': '🇨🇳',
    'NKG': '🇨🇳', 'XIY': '🇨🇳', 'HAK': '🇨🇳', 'SYX': '🇨🇳', 'WXN': '🇨🇳',
    'NJN': '🇨🇳', 'TYN': '🇨🇳', 'TSN': '🇨🇳', 'CKG': '🇨🇳', 'NBO': '🇰🇪',
    'KTM': '🇳🇵', 'RGN': '🇲🇲', 'CMB': '🇱🇰', 'KHI': '🇵🇰', 'LHE': '🇵🇰', 'ISB': '🇵🇰',
};

// 获取 Cloudflare 机房代码对应的国旗
function getCountryFlag(coloCode) {
    if (!coloCode || coloCode === '探测中...' || coloCode === '获取超时' || coloCode === '未知') {
        return '';
    }
    // 直接匹配
    if (CF_COLO_TO_COUNTRY[coloCode]) {
        return CF_COLO_TO_COUNTRY[coloCode];
    }
    // 尝试匹配前3位（有些代码可能是4位如 "NJTT"）
    const prefix3 = coloCode.substring(0, 3);
    if (CF_COLO_TO_COUNTRY[prefix3]) {
        return CF_COLO_TO_COUNTRY[prefix3];
    }
    // 未知代码
    return '🌍';
}

// ==========================================
// 🟢 全新 Dark OLED 设计系统 v3.0
// ==========================================
const CSS_COMMON = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Fira+Code:wght@400;500&display=swap');

    :root {
        /* Dark OLED 主色调 - 深邃科技感 */
        --primary: #3B82F6;
        --primary-hover: #60A5FA;
        --primary-glow: rgba(59, 130, 246, 0.4);
        --primary-bg: rgba(59, 130, 246, 0.15);
        --secondary: #06B6D4;
        --secondary-hover: #22D3EE;

        /* 背景层次 - 从浅到深 */
        --bg-primary: #0F172A;
        --bg-secondary: #020617;
        --bg-card: rgba(30, 41, 59, 0.7);
        --bg-card-hover: rgba(30, 41, 59, 0.9);
        --bg-elevated: rgba(51, 65, 85, 0.5);
        --bg-input: rgba(15, 23, 42, 0.8);

        /* 文字层次 */
        --text-primary: #F8FAFC;
        --text-secondary: #94A3B8;
        --text-muted: #64748B;

        /* 边框与分割线 */
        --border-subtle: rgba(148, 163, 184, 0.1);
        --border-default: rgba(148, 163, 184, 0.2);
        --border-accent: rgba(59, 130, 246, 0.5);

        /* 功能色 */
        --success: #10B981;
        --success-bg: rgba(16, 185, 129, 0.15);
        --warning: #F59E0B;
        --warning-bg: rgba(245, 158, 11, 0.15);
        --danger: #EF4444;
        --danger-bg: rgba(239, 68, 68, 0.15);
        --info: #3B82F6;
        --info-bg: rgba(59, 130, 246, 0.15);

        /* 渐变 */
        --gradient-primary: linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%);
        --gradient-surface: linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%);
        --gradient-glow: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(6, 182, 212, 0.2) 100%);

        /* 阴影 - 多层次光效 */
        --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
        --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4);
        --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
        --shadow-glow: 0 0 20px var(--primary-glow);
        --shadow-card: 0 4px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--border-subtle);
        --shadow-btn: 0 4px 16px rgba(59, 130, 246, 0.3);

        /* 圆角 */
        --radius-sm: 8px;
        --radius-md: 12px;
        --radius-lg: 16px;
        --radius-xl: 20px;

        /* 动画 */
        --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
        --transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1);
        --transition-slow: 400ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Light Mode - 清新浅色主题 */
    body {
        --bg-primary: #F8FAFC;
        --bg-secondary: #E2E8F0;
        --bg-card: rgba(255, 255, 255, 0.9);
        --bg-card-hover: rgba(255, 255, 255, 1);
        --bg-elevated: rgba(241, 245, 249, 0.8);
        --bg-input: rgba(255, 255, 255, 0.95);
        --text-primary: #0F172A;
        --text-secondary: #475569;
        --text-muted: #94A3B8;
        --border-subtle: rgba(0, 0, 0, 0.05);
        --border-default: rgba(0, 0, 0, 0.1);
        --border-accent: rgba(59, 130, 246, 0.3);
        --shadow-card: 0 4px 24px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.05);
        --shadow-btn: 0 4px 16px rgba(59, 130, 246, 0.2);
        --primary-glow: rgba(59, 130, 246, 0.2);
        --primary-bg: rgba(59, 130, 246, 0.12);
    }

    /* Dark Mode - 强制覆盖所有卡片和容器颜色 */
    body.dark {
        --bg-primary: #0F172A;
        --bg-secondary: #020617;
        --bg-card: rgba(30, 41, 59, 0.7);
        --bg-card-hover: rgba(30, 41, 59, 0.9);
        --bg-elevated: rgba(51, 65, 85, 0.5);
        --bg-input: rgba(15, 23, 42, 0.8);
        --text-primary: #F8FAFC;
        --text-secondary: #94A3B8;
        --text-muted: #64748B;
        --border-subtle: rgba(148, 163, 184, 0.1);
        --border-default: rgba(148, 163, 184, 0.2);
        --border-accent: rgba(59, 130, 246, 0.5);
        --shadow-card: 0 4px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--border-subtle);
        --shadow-btn: 0 4px 16px rgba(59, 130, 246, 0.3);
        --primary-glow: rgba(59, 130, 246, 0.4);
    }

    * {
        box-sizing: border-box;
        touch-action: manipulation;
        margin: 0;
        padding: 0;
    }

    body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: linear-gradient(180deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
        background-attachment: fixed;
        color: var(--text-primary);
        margin: 0;
        padding: 20px;
        -webkit-text-size-adjust: 100%;
        transition: background var(--transition-base), color var(--transition-base);
        line-height: 1.6;
        min-height: 100vh;
    }

    .container {
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
        min-height: 90vh;
        display: flex;
        flex-direction: column;
        padding-bottom: 100px;
    }

    .content-wrap { flex: 1; }

    input, select, button, textarea {
        font-family: inherit;
        outline: none;
        font-size: 15px;
    }

    /* ===== 卡片系统 ===== */
    .card {
        background: var(--bg-card);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        padding: 24px;
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-card);
        margin-bottom: 24px;
        border: 1px solid var(--border-subtle);
        transition: all var(--transition-base);
    }

    .card:hover {
        background: var(--bg-card-hover);
        box-shadow: var(--shadow-lg), 0 0 30px var(--primary-glow);
        border-color: var(--border-accent);
    }

    .card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        border-bottom: 1px solid var(--border-subtle);
        padding-bottom: 16px;
        margin-bottom: 16px;
    }

    /* ===== Toast 通知 ===== */
    #toast {
        position: fixed;
        top: -60px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, var(--bg-card) 0%, var(--bg-elevated) 100%);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        color: var(--text-primary);
        padding: 14px 28px;
        border-radius: var(--radius-lg);
        font-size: 14px;
        font-weight: 500;
        transition: top var(--transition-slow);
        z-index: 9999;
        max-width: 90vw;
        word-wrap: break-word;
        box-shadow: var(--shadow-lg), 0 0 0 1px var(--border-subtle);
        border: 1px solid var(--border-default);
    }

    #toast.show { top: 20px; }

    /* ===== 工具栏 ===== */
    .toolbar {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 16px;
        align-items: center;
        background: var(--bg-elevated);
        padding: 16px;
        border-radius: var(--radius-lg);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
        border: 1px solid var(--border-subtle);
    }

    /* ===== 按钮系统 ===== */
    .btn-submit {
        padding: 12px 20px;
        background: var(--gradient-primary);
        color: white;
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        font-weight: 600;
        white-space: nowrap;
        transition: all var(--transition-base);
        box-shadow: var(--shadow-btn);
        position: relative;
        overflow: hidden;
    }

    .btn-submit::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
        transition: left 0.5s ease;
    }

    .btn-submit:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-lg), var(--shadow-glow);
        filter: brightness(1.1);
    }

    .btn-submit:hover::before { left: 100%; }
    .btn-submit:active { transform: translateY(0); filter: brightness(0.95); }
    .btn-submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        filter: grayscale(0.3);
        box-shadow: none;
    }

    /* ===== 表格系统 ===== */
    .table-wrapper {
        width: 100%;
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-subtle);
        overflow: hidden;
        background: var(--bg-card);
        box-shadow: var(--shadow-sm);
    }

    table { width: 100%; border-collapse: collapse; text-align: left; }

    th, td {
        padding: 16px;
        border-bottom: 1px solid var(--border-subtle);
        font-size: 14px;
        vertical-align: middle;
    }

    th {
        color: var(--text-secondary);
        font-weight: 600;
        background: var(--bg-elevated);
        letter-spacing: 0.5px;
        text-transform: uppercase;
        font-size: 12px;
        border-bottom: 1px solid var(--border-default);
    }

    tr:last-child td { border-bottom: none; }

    tr {
        transition: all var(--transition-fast);
    }

    tr:hover td {
        background: var(--gradient-glow);
    }

    /* ===== 操作组 ===== */
    .action-group {
        display: inline-flex;
        gap: 8px;
        background: var(--bg-elevated);
        padding: 8px 12px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-subtle);
        align-items: flex-start;
        max-width: 100%;
        flex-wrap: wrap;
    }

    /* ===== 图标按钮 ===== */
    .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-subtle);
        background: var(--bg-card);
        cursor: pointer;
        color: var(--text-secondary);
        padding: 0;
        box-shadow: var(--shadow-sm);
        transition: all var(--transition-base);
    }

    .icon-btn:hover {
        color: var(--primary);
        border-color: var(--primary);
        box-shadow: var(--shadow-md), var(--shadow-glow);
        transform: scale(1.05);
    }

    .icon-btn svg { width: 18px !important; height: 18px !important; fill: currentColor; }

    /* ===== 浮动底部标签栏 ===== */
    .page-tabs {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 8px;
        padding: 10px 16px;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: 50px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
        z-index: 1000;
    }
    .page-tab {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 10px 16px;
        border-radius: 20px;
        cursor: pointer;
        font-weight: 500;
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif;
        transition: all 0.25s ease;
        background: transparent;
        color: #9CA3AF;
        min-width: 60px;
        border: none;
        outline: none;
    }
    .page-tab span {
        font-size: 11px;
        font-weight: 500;
    }
    .page-tab svg {
        width: 24px;
        height: 24px;
        fill: currentColor;
        transition: transform 0.2s ease;
    }
    .page-tab:hover {
        color: #6B7280;
    }
    .page-tab.active {
        background: linear-gradient(135deg, #3B82F6, #06B6D4);
        color: #fff;
        box-shadow: 0 2px 12px rgba(59, 130, 246, 0.4);
    }
    .page-tab.active svg {
        color: #fff;
        transform: scale(1.1);
    }

    /* Dark Mode - 浮动标签栏 */
    body.dark .page-tabs {
        background: rgba(30, 41, 59, 0.95);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.3);
    }
    body.dark .page-tab {
        color: #64748B;
    }
    body.dark .page-tab:hover {
        color: #94A3B8;
    }
    body.dark .page-tab.active {
        background: linear-gradient(135deg, #3B82F6, #06B6D4);
        color: #fff;
        box-shadow: 0 2px 12px rgba(59, 130, 246, 0.5);
    }
    body.dark .page-tab.active svg {
        color: #fff;
    }
    .page-section {
        display: none;
    }
    .page-section.active {
        display: block;
    }

    /* 主题切换图标动效 */
    #themeIcon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    #themeIcon svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
    }

    /* ===== SVG 图标统一尺寸规则 ===== */
    /* 通用的 SVG 图标尺寸 - 应用于主要容器内的所有 SVG */
    .container svg, .card svg, .toolbar svg, .header svg,
    .content-wrap svg, .modal svg {
        width: 18px !important;
        height: 18px !important;
        fill: currentColor;
        flex-shrink: 0;
        vertical-align: middle;
    }

    /* 按钮内的 SVG */
    .btn-submit svg, button svg {
        width: 16px !important;
        height: 16px !important;
        fill: currentColor;
        flex-shrink: 0;
        vertical-align: middle;
    }

    /* 大尺寸图标 */
    .icon-lg svg, .emby-icon svg {
        width: 24px !important;
        height: 24px !important;
    }

    /* 小尺寸图标 */
    .icon-sm svg {
        width: 14px !important;
        height: 14px !important;
    }

    /* 确保 logout-btn 内的 SVG 也有正确尺寸 */
    .logout-btn svg {
        width: 16px !important;
        height: 16px !important;
        fill: currentColor;
        flex-shrink: 0;
        vertical-align: middle;
    }

    /* ===== 徽章 ===== */
    .badge {
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        display: inline-block;
        background: var(--gradient-primary);
        color: white;
        box-shadow: var(--shadow-sm);
    }

    /* ===== 编辑/删除/DNS 按钮 ===== */
    .btn-edit {
        padding: 10px 16px;
        background: transparent;
        color: var(--primary);
        border: 2px solid var(--primary);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all var(--transition-base);
    }

    .btn-edit:hover {
        background: var(--primary);
        color: white;
        box-shadow: var(--shadow-glow);
    }

    .btn-del {
        padding: 10px 16px;
        background: transparent;
        color: var(--danger);
        border: 2px solid var(--danger);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all var(--transition-base);
    }

    .btn-del:hover {
        background: var(--danger);
        color: white;
        box-shadow: 0 4px 16px rgba(239, 68, 68, 0.4);
    }

    .btn-dns {
        padding: 10px 16px;
        background: transparent;
        color: var(--success);
        border: 2px solid var(--success);
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all var(--transition-base);
        white-space: nowrap;
    }

    .btn-dns:hover {
        background: var(--success);
        color: white;
        box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
    }

    .btn-dns:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ===== 复选框 ===== */
    .ip-checkbox {
        width: 18px;
        height: 18px;
        cursor: pointer;
        accent-color: var(--primary);
    }

    /* ===== 代码文本 ===== */
    .secret-text {
        font-family: 'Fira Code', monospace;
        letter-spacing: 1px;
        color: var(--text-secondary);
    }

    /* ===== 动态 URL ===== */
    .dynamic-url {
        display: block;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        text-align: right;
    }

    .actual-text.dynamic-url {
        white-space: normal;
        max-width: 100%;
        overflow: visible;
        text-align: left !important;
        word-break: break-all;
        font-size: 13px;
        font-family: 'Fira Code', monospace;
        color: var(--primary);
        letter-spacing: normal;
    }

    .url-list-item {
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        padding: 8px 12px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        margin-top: 6px;
        word-break: break-all;
        line-height: 1.5;
        color: var(--text-primary);
        font-family: 'Fira Code', monospace;
    }

    .url-list-item:first-child { margin-top: 0; }

    /* ===== 输入框 ===== */
    body.dark input,
    body.dark select,
    body.dark textarea {
        background: var(--bg-input);
        color: var(--text-primary);
        border: 1px solid var(--border-default);
    }

    input, select, textarea {
        background: var(--bg-input);
        color: var(--text-primary);
        border: 1px solid var(--border-default);
        transition: all var(--transition-fast);
    }

    input:focus, select:focus, textarea:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--primary-glow);
    }

    .search-input {
        padding: 12px 18px;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: 14px;
        width: 260px;
        transition: all var(--transition-base);
    }

    .search-input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--primary-glow), var(--shadow-glow);
    }

    /* ===== 节点列表 ===== */
    .node-grid {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 24px;
    }

    .emby-card {
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-xl);
        padding: 16px 20px;
        box-shadow: var(--shadow-card);
        display: flex;
        flex-direction: column;
        gap: 12px;
        transition: all var(--transition-base);
        position: relative;
        overflow: hidden;
    }

    .emby-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: var(--gradient-primary);
        opacity: 0;
        transition: opacity var(--transition-base);
    }

    .emby-card:hover {
        transform: translateY(-4px);
        border-color: var(--primary);
        box-shadow: var(--shadow-lg), 0 0 40px var(--primary-glow);
    }

    .emby-card:hover::before { opacity: 1; }

    .card-title-group { display: flex; align-items: center; gap: 14px; }

    .emby-icon {
        font-size: 32px;
        background: var(--gradient-glow);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
        padding: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        flex-shrink: 0;
        box-shadow: var(--shadow-sm);
    }

    .info-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        font-size: 13px;
        padding: 8px 0;
        border-bottom: 1px solid var(--border-subtle);
    }

    .info-row:last-child { border-bottom: none; }

    .info-label {
        color: var(--text-muted);
        font-weight: 600;
        min-width: 80px;
    }

    .info-value {
        color: var(--text-secondary);
        text-align: right;
        flex: 1;
    }

    .card-footer {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: auto;
        padding-top: 16px;
        border-top: 1px dashed var(--border-default);
    }

    /* ===== Ping 徽章 ===== */
    .ping-badge {
        color: var(--success);
        cursor: pointer;
        padding: 6px 12px;
        background: var(--success-bg);
        border-radius: var(--radius-sm);
        font-size: 13px;
        font-weight: 600;
        transition: all var(--transition-base);
        border: 1px solid rgba(16, 185, 129, 0.3);
        user-select: none;
        font-family: 'Fira Code', monospace;
    }

    .ping-badge:hover {
        background: var(--success);
        color: white;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
        transform: scale(1.05);
    }

    /* ===== 图标网格 ===== */
    .icon-item {
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-sm);
        border: 2px solid transparent;
        display: flex;
        justify-content: center;
        align-items: center;
        box-sizing: border-box;
        transition: all var(--transition-base);
        background: var(--bg-elevated);
        height: 44px;
    }

    .icon-item:hover {
        border-color: var(--primary) !important;
        box-shadow: var(--shadow-glow);
        transform: scale(1.1);
    }

    #iconGrid::-webkit-scrollbar { width: 8px; }
    #iconGrid::-webkit-scrollbar-thumb {
        background: var(--gradient-primary);
        border-radius: 4px;
    }

    /* ===== 拖拽排序 ===== */
    .emby-card.sortable-ghost {
        opacity: 0.4;
        background: var(--gradient-primary);
    }

    .emby-card .btn-expand:hover {
        border-color: var(--primary);
        color: var(--primary);
    }
    .emby-card .card-summary .icon-btn {
        transition: all 0.2s;
    }
    .emby-card .card-summary .icon-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
    }

    .emby-card.sortable-drag {
        cursor: grabbing !important;
        box-shadow: var(--shadow-lg) !important;
        transform: scale(1.02) rotate(2deg) !important;
    }

    .drag-handle {
        cursor: grab;
        padding-right: 12px;
        font-size: 20px;
        color: var(--text-muted);
        display: flex;
        align-items: center;
        user-select: none;
        touch-action: none;
        transition: all var(--transition-fast);
    }

    .drag-handle:active {
        cursor: grabbing;
        color: var(--primary);
        transform: scale(1.2);
    }

    /* ===== 头部样式 ===== */
    .header h1 {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    /* ===== 退出按钮 ===== */
    .logout-btn {
        background: var(--danger);
        color: white;
        border: none;
        border-radius: var(--radius-md);
        font-weight: 600;
        padding: 10px 16px;
        cursor: pointer;
        transition: all var(--transition-base);
    }

    .logout-btn:hover {
        background: #DC2626;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
    }

    /* ===== 指示灯 ===== */
    .status-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--success);
        box-shadow: 0 0 8px var(--success);
        animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.9); }
    }

    /* ===== 代码块 ===== */
    code {
        background: var(--bg-elevated);
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        font-family: 'Fira Code', monospace;
        font-size: 0.9em;
        color: var(--secondary);
    }

    /* ===== 分割线 ===== */
    hr {
        border: none;
        height: 1px;
        background: var(--border-default);
        margin: 24px 0;
    }

    /* ===== 响应式移动端适配 ===== */
    @media (max-width: 768px) {
        body { padding: 12px; }
        .card { padding: 16px; border-radius: var(--radius-lg); margin-bottom: 16px; }
        .header h1 { font-size: 20px; flex-wrap: wrap; }
        .toolbar { flex-direction: column; align-items: stretch; gap: 12px; }
        .search-input { width: 100%; }
        .node-grid { grid-template-columns: 1fr; gap: 16px; }
        .table-wrapper { border: none; background: transparent; overflow: visible; }
        table, thead, tbody, th, td, tr { display: block; width: 100%; }
        thead { display: none; }
        tr {
            margin-bottom: 16px;
            background: var(--bg-card);
            border-radius: var(--radius-lg);
            border: 1px solid var(--border-subtle);
            box-shadow: var(--shadow-sm);
        }
        td {
            display: flex;
            align-items: center;
            padding: 14px 16px;
            border-bottom: 1px solid var(--border-subtle);
            text-align: right;
            gap: 12px;
            min-height: 50px;
        }
        td:last-child { border-bottom: none; }
        td[colspan] { justify-content: center; text-align: center; }
        td[colspan]::before { display: none !important; }
        td::before {
            content: attr(data-label);
            font-weight: 600;
            color: var(--text-muted);
            flex-shrink: 0;
            margin-right: auto;
            text-align: left;
            min-width: 80px;
        }

        #dashboardModal { padding: 10px !important; }
        #dashboardModal .card { margin: 10px auto !important; padding: 16px !important; box-sizing: border-box; }
        #dashboardModal h2 { font-size: 18px; flex-direction: column; align-items: flex-start; }
        #dashboardModal h2 span { font-size: 12px; }
    }
`;

const LOGIN_UI = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>系统授权</title>
    <style>
        ${CSS_COMMON}

        /* 登录页面专属样式 - Dark OLED */
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            padding: 16px;
            margin: 0;
            background: linear-gradient(135deg, #020617 0%, #0F172A 50%, #1E293B 100%);
            position: relative;
            overflow: hidden;
        }

        /* 动态网格背景 */
        body::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background-image:
                radial-gradient(circle at 20% 30%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
                radial-gradient(circle at 80% 70%, rgba(6, 182, 212, 0.15) 0%, transparent 50%),
                linear-gradient(rgba(148, 163, 184, 0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(148, 163, 184, 0.03) 1px, transparent 1px);
            background-size: 100% 100%, 100% 100%, 60px 60px, 60px 60px;
            animation: gridMove 20s linear infinite;
            pointer-events: none;
        }

        /* 光晕效果 */
        body::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 600px;
            height: 600px;
            background: radial-gradient(circle, rgba(59, 130, 246, 0.2) 0%, transparent 70%);
            transform: translate(-50%, -50%);
            pointer-events: none;
            animation: glowPulse 4s ease-in-out infinite;
        }

        @keyframes gridMove {
            0% { transform: translate(0, 0); }
            100% { transform: translate(30px, 30px); }
        }

        @keyframes glowPulse {
            0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
            50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.1); }
        }

        .login-box {
            background: rgba(15, 23, 42, 0.8);
            backdrop-filter: blur(30px);
            -webkit-backdrop-filter: blur(30px);
            padding: 48px 40px;
            border-radius: 24px;
            box-shadow:
                0 25px 50px -12px rgba(0, 0, 0, 0.5),
                0 0 0 1px rgba(148, 163, 184, 0.1),
                inset 0 1px 0 rgba(255, 255, 255, 0.05);
            text-align: center;
            width: 100%;
            max-width: 420px;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 10;
        }

        .login-box h2 {
            margin: 0 0 32px 0;
            font-size: 28px;
            font-weight: 700;
            background: linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            letter-spacing: 2px;
        }

        .login-icon {
            width: 72px;
            height: 72px;
            margin: 0 auto 24px;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(6, 182, 212, 0.2) 100%);
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow:
                0 8px 32px rgba(59, 130, 246, 0.3),
                inset 0 1px 0 rgba(255, 255, 255, 0.1);
            animation: iconFloat 3s ease-in-out infinite;
        }

        .login-icon svg {
            width: 36px;
            height: 36px;
            fill: #3B82F6;
        }

        @keyframes iconFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
        }

        .login-box input {
            width: 100%;
            padding: 16px 20px;
            margin-bottom: 20px;
            border: 2px solid rgba(148, 163, 184, 0.2);
            border-radius: 14px;
            font-size: 15px;
            background: rgba(15, 23, 42, 0.6);
            color: #F8FAFC;
            transition: all 0.3s ease;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .login-box input::placeholder {
            color: #64748B;
        }

        .login-box input:focus {
            border-color: #3B82F6;
            box-shadow:
                0 0 0 4px rgba(59, 130, 246, 0.2),
                0 8px 16px rgba(59, 130, 246, 0.2),
                inset 0 2px 4px rgba(0, 0, 0, 0.2);
            outline: none;
            transform: scale(1.02);
        }

        .login-box button {
            width: 100%;
            padding: 16px;
            background: linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%);
            color: white;
            border: none;
            border-radius: 14px;
            cursor: pointer;
            font-weight: 700;
            font-size: 16px;
            letter-spacing: 3px;
            transition: all 0.3s ease;
            box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
            position: relative;
            overflow: hidden;
        }

        .login-box button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
            transition: left 0.6s ease;
        }

        .login-box button:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 32px rgba(59, 130, 246, 0.5);
            filter: brightness(1.1);
        }

        .login-box button:hover::before {
            left: 100%;
        }

        .login-box button:active {
            transform: translateY(0);
            filter: brightness(0.95);
        }

        .login-hint {
            margin-top: 28px;
            font-size: 13px;
            color: #64748B;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .login-hint svg {
            width: 16px;
            height: 16px;
            fill: #3B82F6;
        }

        /* 版本号 */
        .version-tag {
            position: absolute;
            bottom: 16px;
            right: 16px;
            font-size: 11px;
            color: #475569;
            font-family: 'Fira Code', monospace;
        }
    </style>
</head>
<body>
    <div id="toast"></div>
    <div class="login-box">
        <div class="login-icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
            </svg>
        </div>
        <h2>安全中心</h2>
        <input type="password" id="tokenInput" placeholder="请输入密钥 TOKEN" onkeydown="if(event.key==='Enter') login()">
        <button onclick="login()">验 证 登 录</button>
        <div class="login-hint">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
            </svg>
            <span>受保护的管理面板</span>
        </div>
        <div class="version-tag">v${CURRENT_VERSION}</div>
    </div>
    <script>
        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg; t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2000);
        }
        function login() {
            const token = document.getElementById('tokenInput').value.trim();
            if(!token) return showToast('请输入正确的密钥');
            document.cookie = 'admin_token=' + encodeURIComponent(token) + '; path=/; max-age=2592000; Secure; SameSite=Strict';
            window.location.reload();
        }
    </script>
</body>
</html>
`;

const HTML_UI = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <link rel="icon" href="https://ghfast.top/https://raw.githubusercontent.com/ginibond/ginibond/main/Icons/emby/Emby1.png" type="image/x-icon">
    <title>Emby反代面板</title>
    <style>${CSS_COMMON}</style>
    <script src="https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flag-icons@6.6.6/css/flag-icons.min.css">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div id="toast"></div>

    <div class="container">
        <!-- 版本更新提示 -->
        <!-- 版本更新提示 -->
        <div id="updateAlert" class="card" style="display: none; border-left: 4px solid var(--success); background: var(--success-bg); margin-top: 20px;">
            <div style="display:flex; justify-content: space-between; align-items:center; flex-wrap:wrap; gap:16px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="color: var(--success);">${SVG_STAR}</span>
                    <div>
                        <h3 style="margin:0; color: var(--success); font-size: 16px;">发现新版本！</h3>
                        <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--text-secondary);" id="updateMsg">当前版本: v${CURRENT_VERSION} | 最新版本: v?.?.?</p>
                    </div>
                </div>
                <button onclick="doOnlineUpdate()" id="onlineUpdateBtn" class="btn-submit" style="background: var(--success); box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);">
                    ${SVG_DOWNLOAD} 一键拉取并升级
                </button>
            </div>
        </div>

        <!-- CF 追踪卡片 -->
        <div id="cf-trace-card" class="card" style="padding: 20px 24px; margin-top: 20px;">
            <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 20px;">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="width: 48px; height: 48px; background: var(--info-bg); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; color: var(--info);">
                        ${SVG_LOCATION}
                    </div>
                    <div>
                        <div style="color:var(--text-muted); font-size: 12px; margin-bottom: 4px;">访客入口 (地区与机房)</div>
                        <div id="trace-entry" style="font-weight:600; color:var(--text-primary); font-family: 'Fira Code', monospace; font-size: 15px;">雷达扫描中...</div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="width: 48px; height: 48px; background: var(--success-bg); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; color: var(--success);">
                        ${SVG_ROCKET}
                    </div>
                    <div>
                        <div style="color:var(--text-muted); font-size: 12px; margin-bottom: 4px;">Worker 实际落地机房</div>
                        <div id="trace-egress" style="font-weight:600; color:var(--success); font-family: 'Fira Code', monospace; font-size: 15px;">雷达扫描中...</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="content-wrap">
            <div class="header" style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap:wrap; gap:16px;">
                <h1 style="margin: 0; font-size: 24px; display:flex; align-items:center; gap: 12px;">
                    <span style="background: var(--gradient-primary); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-weight: 700;">私有调度与反代核心</span>
                    <button id="themeToggle" onclick="toggleDarkMode()" class="icon-btn" style="width:40px; height:40px;" title="切换深色模式">
                        <span id="themeIcon">${SVG_SUN}</span>
                    </button>
                </h1>
                <div style="display:flex; gap:12px; align-items:center; flex-wrap: wrap;">
                    <div style="font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: var(--radius-md); background: var(--bg-elevated); border: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 10px;" title="你的设备到云端边缘节点的真实往返延迟">
                        <span class="status-dot" id="rttDot"></span>
                        <span style="color: var(--text-muted);">RTT:</span>
                        <span id="rttValue" style="font-family: 'Fira Code', monospace; font-size: 14px; min-width: 50px; text-align: right;">测算中</span>
                    </div>

                    <button class="logout-btn" onclick="logout()">
                        ${SVG_LOGOUT} 退出系统
                    </button>
                </div>
            </div>

            <!-- 分页导航 -->
            <div class="page-tabs">
                <button class="page-tab active" onclick="switchPage(1)">${SVG_CHECK}<span>节点</span></button>
                <button class="page-tab" onclick="switchPage(2)">${SVG_SPEED}<span>测速</span></button>
                <button class="page-tab" onclick="switchPage(3)">${SVG_ANALYTICS}<span>数据</span></button>
                <button class="page-tab" onclick="switchPage(4)">${SVG_SETTINGS}<span>设置</span></button>
            </div>

            <!-- 第1页：节点 -->
            <div id="page-1" class="page-section active">
            <!-- 部署/编辑反代节点 -->
            <div class="card">
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
                    <h2 style="margin:0; font-size:18px; display: flex; align-items: center; gap: 10px;">
                        <span style="color: var(--primary);">${SVG_UPLOAD}</span>
                        部署 / 编辑反代节点
                    </h2>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn-submit" onclick="exportConfig()" style="background:#5856d6; padding: 10px 16px; font-size: 13px;">
                            ${SVG_DOWNLOAD} 导出配置
                        </button>
                        <button class="btn-submit" onclick="importConfig()" style="background:#f59e0b; padding: 10px 16px; font-size: 13px;">
                            ${SVG_UPLOAD} 导入配置
                        </button>
                    </div>
                </div>

                <form id="addForm" style="display: flex; flex-direction: column; gap: 16px;">
                    <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                        <input type="hidden" id="oldPrefix" value="">
                        <input type="text" id="remark" placeholder="节点备注 (如: Misaka服)" style="padding: 14px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background:var(--bg-input); flex: 1;" required>
                        <input type="text" id="prefix" placeholder="短路径后缀 (如: misaka)" style="padding: 14px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background:var(--bg-input); flex: 1;" required>
                        <select id="mode" style="padding: 14px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background:var(--bg-input); flex: 1;">
                            <option value="off">🔒 保守 (抹除IP)</option>
                            <option value="realip_only">🎯 严格 (透传IP)</option>
                            <option value="dual">🔄 兼容 (双重透传)</option>
                            <option value="strict">🛡️ 强力 (防403)</option>
                        </select>
                    </div>

                    <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-start;">
                        <div style="position: relative; flex: 2; min-width: 200px;">
                            <div style="display:flex; gap:12px; align-items:center;">
                                <div style="display:flex; gap:12px; align-items:center; background:var(--bg-card); padding:10px 16px; border-radius:10px; border:1px solid var(--border-default); cursor: pointer; transition:0.2s; flex: 1;" onclick="toggleIconPicker(event)" id="iconSelectBtn">
                                    <img id="iconPreview" src="" style="width:24px;height:24px;display:none;border-radius:4px;object-fit:cover;">
                                    <span id="iconDefault" style="font-size:20px;line-height:1;">🎬</span>
                                    <span id="iconSelectText" style="flex:1; color: var(--text-sec); font-size:14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">点击选择图标 (默认 🎬)</span>
                                    <input type="hidden" id="iconUrl" value="">
                                </div>
                            </div>

                            <div id="iconPickerPanel" style="display:none; position: absolute; top: 100%; left: 0; width: 100%; background:var(--bg-card); border:1px solid var(--border-default); border-radius:10px; padding:12px; box-shadow:0 10px 30px rgba(0,0,0,0.15); z-index:100; margin-top:8px; flex-direction:column; gap:10px;">
                                <div style="display:flex; gap:8px; align-items:center; flex-wrap:nowrap;">
                                    <input type="text" id="customIconUrlInput" placeholder="输入自定义 JSON 图标库链接..." style="flex:1; padding:8px 10px; border:1px solid var(--border-default); border-radius:8px; background:var(--bg-input); font-size:13px;">
                                    <button type="button" onclick="setCustomIconLibrary()" class="btn-submit" style="padding:8px 12px; font-size:13px; white-space:nowrap;">加载</button>
                                    <button type="button" onclick="resetIconLibrary()" style="padding:8px 12px; background:var(--text-muted); color:white; border:none; border-radius:8px; cursor:pointer; font-size:13px; white-space:nowrap;">默认</button>
                                </div>
                                <input type="text" id="iconSearch" placeholder="🔍 搜索图标名称..." style="width:100%; padding:10px 12px; border:1px solid var(--border-default); border-radius:8px; background:var(--bg-input); font-size:14px; box-sizing:border-box;" onkeyup="filterIcons()">
                                <div id="iconGrid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(44px, 1fr)); gap:8px; overflow-y:auto; max-height:240px; padding-right:4px;">
                                    <div style="text-align:center; color:var(--text-sec); grid-column:1 / -1; font-size:13px; padding:16px;">加载图标库中...</div>
                                </div>
                            </div>
                        </div>
                        <label style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:500; cursor:pointer; padding: 12px 16px; background: var(--bg-elevated); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                            <input type="checkbox" id="nodeCache" class="ip-checkbox" checked>
                            开启海报及静态资源缓存
                        </label>
                        <button type="submit" id="submitBtn" class="btn-submit" style="flex: 1; padding: 14px 20px;">
                            ${SVG_CHECK} 保存部署
                        </button>
                    </div>

                    <div style="background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 20px;">
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                            <span style="color: var(--secondary);">${SVG_DNS}</span>
                            服务器线路配置 (支持魔改分离版推流，支持无限条备用线路)
                        </div>
                        <div id="targetInputs" style="display: flex; flex-direction: column; gap: 12px;">
                            <input type="url" class="target-input" placeholder="主线路地址 (如: http://1.1.1.1:8096)" style="padding: 14px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background:var(--bg-input); width: 100%;" required oninput="handleTargetInputs()">
                            <input type="url" class="target-input" placeholder="备用线路 1 (选填，主源挂掉时触发)" style="padding: 14px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background:var(--bg-input); width: 100%;" oninput="handleTargetInputs()">
                        </div>
                    </div>
                </form>
            </div>

            <!-- 已反代的媒体库 -->
            <div class="card">
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
                    <h2 style="margin:0; font-size:18px; display: flex; align-items: center; gap: 10px;">
                        <span style="color: var(--secondary);">${SVG_DNS}</span>
                        已反代的媒体库
                    </h2>
                    <div style="display: flex; gap: 10px; align-items:center; flex-wrap: wrap;">
                        <button class="btn-submit" onclick="pingAllNodes()" style="background:#32ade6; padding: 10px 14px; font-size: 13px;">
                            ${SVG_SPEED} 全局测速
                        </button>
                        <button id="btnPurge" class="btn-submit" onclick="purgeCache()" style="background:#ff2d55; padding: 10px 14px; font-size: 13px;">
                            ${SVG_REFRESH} 刷新全站海报
                        </button>
                        <input type="text" id="searchNode" class="search-input" placeholder="搜索备注或后缀查找..." onkeyup="filterNodesList()">
                    </div>
                </div>
                <div style="background: var(--info-bg); padding: 16px 20px; border-radius: var(--radius-md); border: 1px dashed rgba(59, 130, 246, 0.3); margin-bottom: 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                    <label style="cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" id="selectAllNodes" onchange="toggleSelectAll(this)" style="width: 18px; height: 18px; accent-color: var(--primary);">
                        全选节点
                    </label>

                    <div style="width: 1px; height: 24px; background: var(--border-default);"></div>
                    <select id="batch-mode-select" style="padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-default); background: var(--bg-input); color: var(--text-primary); font-weight: 600;">
                        <option value="">🔄 读取模式中...</option>
                    </select>

                    <button onclick="batchUpdateModes()" class="btn-submit" style="background: var(--primary); padding: 8px 14px; font-size: 13px;">
                        ${SVG_CHECK} 批量应用
                    </button>

                    <span id="batch-status" style="font-size: 13px; font-weight: 600;"></span>
                </div>
                <div id="list-grid" class="node-grid">
                    <div style="text-align:center; color:var(--text-muted); grid-column: 1 / -1; padding: 40px;">读取数据中...</div>
                </div>
            </div>
            </div>

            <!-- 第2页：测速 -->
            <div id="page-2" class="page-section">
            <!-- 专属线路测速与动态 DNS 解析 -->
            <div class="card">
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
                    <h2 style="margin:0; font-size:18px; display: flex; align-items: center; gap: 10px;">
                        <span style="color: var(--primary);">${SVG_SPEED}</span>
                        专属线路测速与动态 DNS 解析
                    </h2>
                </div>

                <div style="background: var(--bg-elevated); padding: 16px 20px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-bottom: 20px;">
                    <div style="font-size: 14px; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                        <span style="color: var(--secondary);">${SVG_DNS}</span>
                        当前域名生效的 DNS 解析：
                    </div>
                    <div id="dnsStatus" style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <span style="color:var(--text-muted); font-size: 14px;">加载中...</span>
                    </div>
                </div>

                <div class="toolbar">
                    <select id="ipType" style="font-weight: 600; color: var(--primary); padding: 12px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-card);">
                        <option value="all">🌐 综合混合源</option>
                        <option value="电信">🔵 电信专属</option>
                        <option value="联通">🟠 联通专属</option>
                        <option value="移动">🟢 移动专属</option>
                        <option value="多线">🟣 多线BGP</option>
                        <option value="ipv6">🚀 IPv6节点</option>
                        <option value="优选">🌟 顶尖优选库</option>
                    </select>

                    <button class="btn-submit" id="btnFetchRemote" onclick="fetchRemoteAndTest()">
                        ${SVG_SEARCH} 提取预设源并测速
                    </button>
                    <button class="btn-submit" onclick="batchTcpPing()" style="background: var(--warning); box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);">
                        ${SVG_LINK} 复制去 ITDog
                    </button>
                    <button class="btn-submit" onclick="clearTest()" style="background: var(--text-muted);">
                        ${SVG_CLEAR} 清空列表
                    </button>
                </div>

                <div style="background: var(--bg-elevated); padding: 20px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-bottom: 16px;">
                    <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center; flex-wrap: wrap;">
                        <input type="text" id="customApiUrl" value="https://ip.v2too.top/api/nodes" placeholder="填入自定义 JSON 或 文本 API 链接" style="flex: 1; min-width: 200px; padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-default); background: var(--bg-input);">
                        <button class="btn-submit" id="btnFetchCustomApi" onclick="fetchCustomApiAndTest()" style="background: var(--info);">
                            ${SVG_DOWNLOAD} 拉取 API 并测速
                        </button>
                    </div>

                    <textarea id="customIps" rows="3" placeholder="在此粘贴自定义 IPv4、IPv6 或 优选域名 (支持混杂文本，自动提取)" style="width: 100%; padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-default); margin-bottom: 16px; font-family: 'Fira Code', monospace; resize: vertical; background: var(--bg-input); line-height: 1.5;"></textarea>

                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="btn-submit" id="btnTestCustom" onclick="testCustomIPs()" style="background: #5856d6;">
                            ${SVG_SPEED} 测试粘贴的节点
                        </button>
                        <button class="btn-submit" id="btnDirectCname" onclick="directSubmitCname()" style="background: #af52de;">
                            ${SVG_LINK} 直推 CNAME (免测速)
                        </button>
                        <div style="width: 100%; height: 1px; background: var(--border-default); margin: 8px 0;"></div>
                        <button class="btn-submit" id="btnTop3Dns" onclick="updateTop3ToDns()" style="background: #ff2d55;">
                            ${SVG_STAR} 更新 TOP3 至 DNS
                        </button>
                        <button class="btn-submit" id="btnSelectedDns" onclick="updateSelectedToDns()" style="background: var(--success);">
                            ${SVG_CHECK} 提交选中节点至 DNS
                        </button>
                    </div>
                </div>

                <div id="statusText" style="line-height: 1.6; font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; padding: 14px 20px; background: var(--success-bg); border-radius: var(--radius-md); border-left: 4px solid var(--success); display: flex; align-items: center; gap: 10px;">
                    <span style="color: var(--success);">${SVG_INFO}</span>
                    测速完成后，可勾选复选框自由组合，点击【提交选中节点至 DNS】自动分发。
                </div>

                <div class="table-wrapper">
                    <table style="width: 100%;">
                        <thead>
                            <tr>
                                <th style="width: 40px; text-align: center;"><input type="checkbox" id="selectAll" class="ip-checkbox" onclick="toggleSelectAll()"></th>
                                <th>专属节点 (点击复制)</th>
                                <th>预估延迟</th>
                                <th>连通状态</th>
                                <th>记录类型/归属地</th>
                                <th>单节点操作</th>
                            </tr>
                        </thead>
                        <tbody id="testTableBody">
                            <tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding: 30px;">暂无数据，请拉取节点或输入自定义 IP/域名 测试</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
            </div>

            <!-- 第3页：数据 -->
            <div id="page-3" class="page-section">
            <div class="card">
                <h2 style="margin-top:0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="color: var(--primary);">${SVG_ANALYTICS}</span>
                        <span style="font-size: 20px; font-weight: 700;">数据大屏</span>
                        <span style="font-size:14px; font-weight: normal; color: var(--text-secondary);">精确访客画像分析</span>
                    </div>
                    <div style="font-size: 13px; background: var(--info-bg); color: var(--info); padding: 8px 16px; border-radius: var(--radius-md); border: 1px solid rgba(59, 130, 246, 0.2); display: flex; gap: 20px; flex-wrap: wrap;">
                        <span>今日: <strong id="trafficToday">加载中...</strong></span>
                        <span>1周内: <strong id="traffic7d">加载中...</strong></span>
                        <span>1月内: <strong id="traffic30d">加载中...</strong></span>
                    </div>
                </h2>

                <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-top:24px;">
                    <div style="flex: 2; min-width: 300px; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 20px; background: var(--bg-elevated);">
                        <canvas id="trendChart"></canvas>
                    </div>
                    <div style="flex: 1; min-width: 300px; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 20px; background: var(--bg-elevated); display: flex; justify-content: center; align-items: center;">
                        <canvas id="locationChart"></canvas>
                    </div>
                </div>

                <div id="top5-container" style="margin-top: 24px;"></div>

                <h3 style="margin-top: 32px; margin-bottom:16px; display: flex; align-items: center; gap: 10px;">
                    <span style="color: var(--secondary);">${SVG_RADAR}</span>
                    最新独立播放记录
                    <span style="font-size:12px; color:var(--text-muted); font-weight: normal;">(仅拦截 PlaybackInfo 真实播放)</span>
                </h3>
                <div class="table-wrapper" style="max-height: 400px; overflow-y: auto;">
                    <table style="width: 100%;">
                        <thead><tr><th>访问时间</th><th>目标节点</th><th>真实 IP 地址</th><th>归属地</th><th>客户端/设备标识 (User-Agent)</th></tr></thead>
                        <tbody id="logTableBody"><tr><td colspan="5" style="text-align:center; padding: 30px; color: var(--text-muted);">加载数据中...</td></tr></tbody>
                    </table>
                </div>
            </div>
            </div>

            <!-- 第4页：设置 -->
            <div id="page-4" class="page-section">
            <!-- Worker 调度模式与区域设置 -->
            <div class="card" style="padding: 20px 24px; margin-top: 0;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <span style="color: var(--primary);">${SVG_SETTINGS}</span>
                    <div style="font-weight: 700; font-size: 16px;">Worker 调度模式与区域设置</div>
                </div>
                <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                    <select id="cf-mode-select" onchange="handleModeChange()" style="flex: 1; min-width: 200px; padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-default); background: var(--bg-input); color: var(--text-primary);">
                        <option value='{"mode":"smart"}'>${SVG_RADAR} 智能调度 (Smart Placement)</option>
                        <option value='{"mode":"off"}'>${SVG_LOCATION} 边缘节点 (Edge - 默认离访客近)</option>
                        <optgroup label="指定云厂商物理机房落地">
                            <option value="aws">☁️ AWS (亚马逊云)</option>
                            <option value="gcp">☁️ GCP (谷歌云)</option>
                            <option value="azure">☁️ Azure (微软云)</option>
                        </optgroup>
                        <option value="custom">${SVG_EDIT} 手动输入区域代码...</option>
                    </select>

                    <select id="cf-region-select" style="display: none; flex: 1.5; min-width: 200px; padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-default); background: var(--bg-input); color: var(--text-primary);">
                    </select>

                    <input type="text" id="cf-custom-input" placeholder="输入云代码 (如 gcp:us-west1)" style="display: none; flex: 1.5; min-width: 200px; padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border-default); background: var(--bg-input); color: var(--text-primary);">

                    <button onclick="updatePlacement()" class="btn-submit" style="background: var(--info);">
                        ${SVG_CHECK} 提交修改
                    </button>
                </div>
                <div id="place-status" style="margin-top: 12px; font-size: 13px; color: var(--text-muted); display: flex; align-items: center; gap: 8px;">
                    ${SVG_SHIELD} 后台全自动安全调度，不暴露任何私钥
                </div>
            </div>

            <!-- 通用反代访问控制 -->
            <div class="card" style="border-left: 4px solid var(--warning);">
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
                    <h2 style="margin:0; font-size:18px; display: flex; align-items: center; gap: 10px;">
                        <span style="color: var(--warning);">${SVG_SETTINGS}</span>
                        通用反代访问控制
                    </h2>
                </div>
                <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; display: flex; align-items: flex-start; gap: 8px;">
                    <span style="color: var(--info);">${SVG_INFO}</span>
                    <span>控制是否允许通过 <code>/http://xxx</code> 或 <code>/https://xxx</code> 格式直接访问任意 URL</span>
                </div>
                <div style="display: flex; align-items: center; gap: 20px; flex-wrap: wrap; padding: 16px; background: var(--bg-elevated); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <label style="cursor: pointer; font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 10px;">
                            <input type="checkbox" id="generalProxyToggle" onchange="toggleGeneralProxy()" class="ip-checkbox" style="width: 22px; height: 22px;">
                            <span id="generalProxyStatus" style="font-size: 14px; color: var(--text-secondary);">加载中...</span>
                        </label>
                    </div>
                    <div style="font-size: 13px; color: var(--text-muted); border-left: 1px solid var(--border-subtle); padding-left: 20px;">
                        <div style="margin-bottom: 4px;"><strong style="color: var(--success);">开启</strong>：允许通用反代（灵活但可能有安全风险）</div>
                        <div><strong style="color: var(--danger);">关闭</strong>：仅允许通过已配置的节点访问（更安全）</div>
                    </div>
                </div>
            </div>

            <!-- 一键覆盖/更新 Worker 代码 -->
            <div class="card" style="border-left: 4px solid var(--danger);">
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
                    <h2 style="margin:0; font-size:18px; display: flex; align-items: center; gap: 10px;">
                        <span style="color: var(--danger);">${SVG_UPLOAD}</span>
                        一键覆盖/更新 Worker 核心层代码
                    </h2>
                </div>
                <div style="font-size: 14px; color: var(--danger); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--danger-bg); border-radius: var(--radius-md); border: 1px solid rgba(239, 68, 68, 0.2);">
                    <span>${SVG_WARNING}</span>
                    警告：提交错误的代码会导致面板瞬间崩溃（500 错误）。请确保代码已在本地测试通过！
                </div>
                <textarea id="codeArea" rows="6" placeholder="方式一：在此处直接粘贴修改好的最新代码全文..." style="width: 100%; padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-default); margin-bottom: 16px; font-family: 'Fira Code', monospace; resize: vertical; background: var(--bg-input); font-size:13px; line-height: 1.5;"></textarea>
                <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center; justify-content: space-between;">
                    <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                        <span style="font-size:14px; font-weight:600; color: var(--text-secondary);">或 方式二：</span>
                        <input type="file" id="fileInput" accept=".js" style="font-size:14px; padding: 8px 12px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-input);">
                    </div>
                    <button class="btn-submit" id="deployBtn" onclick="deployWorker()" style="background: var(--danger); box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3);">
                        ${SVG_UPLOAD} 立即覆盖部署并重启节点
                    </button>
                </div>
            </div>
            </div>

        </div>

        <!-- 页脚 -->
        <div style="text-align: center; padding: 32px 20px; margin-top: auto;">
            <a href="https://t.me/MakkaPakkaOvO" target="_blank" style="text-decoration: none; color: var(--text-primary); font-weight: 600; display: inline-flex; align-items: center; gap: 10px; padding: 14px 28px; background: var(--bg-card); border-radius: 50px; box-shadow: var(--shadow-md); transition: all 0.3s ease; font-size: 14px; border: 1px solid var(--border-subtle);" onmouseover="this.style.boxShadow='var(--shadow-glow), 0 0 20px var(--primary-glow)'; this.style.borderColor='var(--primary)';" onmouseout="this.style.boxShadow='var(--shadow-md)'; this.style.borderColor='var(--border-subtle)';">
                ${SVG_TG}
                联系作者 MakkaPakkaOvO
            </a>
            <div style="margin-top: 16px; font-size: 12px; color: var(--text-muted);">
                二次修改 by: 我夜不能寐
            </div>
            <div style="margin-top: 24px; font-size: 12px; color: var(--text-muted); line-height: 1.8; max-width: 640px; margin-left: auto; margin-right: auto; padding: 20px 24px; background: var(--bg-elevated); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                <strong style="color: var(--warning);">⚠️ 免责声明:</strong> 本项目仅供学习与技术测试使用，请遵守当地法律法规。使用者对配置、转发内容与访问行为承担全部责任，开发者不对任何直接或间接损失负责。
            </div>
            <div style="margin-top: 20px; font-size: 11px; color: var(--text-muted); font-family: 'Fira Code', monospace;">
                v${CURRENT_VERSION} | Powered by Cloudflare Workers
            </div>
        </div>
    </div>

    <script>
        // SVG 图标常量（内联避免作用域问题）
        const SVG_MOON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>';
        const SVG_SUN = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/></svg>';

        const modeNames = { 'off': '保守', 'realip_only': '严格', 'dual': '兼容', 'strict': '强力' };
        const modeColors = {
            'off': { bg: 'rgba(16, 185, 129, 0.1)', color: '#10b981' },
            'realip_only': { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' },
            'dual': { bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' },
            'strict': { bg: 'rgba(249, 115, 22, 0.1)', color: '#f97316' }
        };
        
        const DEFAULT_ICON_URL = 'https://emby-icon.vercel.app/TFEL-Emby.json';
        let globalIcons = [];
        let proxyNodesForPing = [];
        let sortableInstance = null;
        let trendChartInstance = null;
        let locationChartInstance = null;

        function escapeHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, ch => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[ch]));
        }

        function escapeAttr(value) {
            return escapeHtml(value).replace(/\x60/g, '&#96;');
        }

        function jsStringAttr(value) {
            return escapeAttr(JSON.stringify(String(value ?? '')));
        }

        const uiCityNameZh = {
            taizhou: '泰州',
            nanjing: '南京',
            beijing: '北京',
            shanghai: '上海',
            guangzhou: '广州',
            shenzhen: '深圳',
            chengdu: '成都',
            hangzhou: '杭州',
            suzhou: '苏州',
            wuxi: '无锡',
            changzhou: '常州',
            nantong: '南通',
            yangzhou: '扬州',
            zhenjiang: '镇江',
            xuzhou: '徐州',
            yancheng: '盐城',
            huaian: '淮安',
            lianyungang: '连云港',
            suqian: '宿迁',
            kunshan: '昆山',
            wuhan: '武汉',
            xian: '西安',
            xianyang: '咸阳',
            zhengzhou: '郑州',
            changsha: '长沙',
            chongqing: '重庆',
            tianjin: '天津',
            qingdao: '青岛',
            jinan: '济南',
            ningbo: '宁波',
            xiamen: '厦门',
            fuzhou: '福州',
            dongguan: '东莞',
            foshan: '佛山',
            zhuhai: '珠海'
        };

        function uiCountryNameZh(code) {
            const normalized = String(code || '').trim().toUpperCase();
            const map = {
                CN: '中国',
                US: '美国',
                JP: '日本',
                KR: '韩国',
                HK: '中国香港',
                TW: '中国台湾',
                SG: '新加坡',
                DE: '德国',
                FR: '法国',
                GB: '英国',
                AU: '澳大利亚',
                CA: '加拿大'
            };
            return map[normalized] || normalized || '未知';
        }

        function uiTranslateCityNameZh(city) {
            const text = String(city || '').trim();
            if (!text) return '';
            if (/[\u4e00-\u9fff]/.test(text)) return text;
            const normalized = text
                .normalize('NFKC')
                .toLowerCase()
                .replace(/['\x60]/g, '')
                .replace(/[\s-]+/g, '')
                .replace(/[^a-z]/g, '');
            return uiCityNameZh[normalized] || text;
        }

        function formatLogLocation(log) {
            const countryName = uiCountryNameZh(log.country);
            const cityName = uiTranslateCityNameZh(log.city);
            if (cityName) return countryName + '-' + cityName;
            return countryName;
        }

        function isSafeHttpUrl(value) {
            try {
                const parsed = new URL(String(value ?? ''));
                return parsed.protocol === 'http:' || parsed.protocol === 'https:';
            } catch(e) {
                return false;
            }
        }

        // =====================================
        // 通用反代开关控制
        // =====================================
        async function loadGeneralProxyStatus() {
            try {
                const res = await fetch('/api/general-proxy-status');
                const data = await res.json();
                if (data.success) {
                    document.getElementById('generalProxyToggle').checked = data.enabled;
                    updateGeneralProxyStatusText(data.enabled);
                } else {
                    console.error('获取通用反代状态失败:', data.error);
                    updateGeneralProxyStatusText(null);
                }
            } catch(e) {
                console.error('获取通用反代状态异常:', e);
                updateGeneralProxyStatusText(null);
            }
        }

        function updateGeneralProxyStatusText(enabled) {
            const statusEl = document.getElementById('generalProxyStatus');
            if (enabled === null) {
                statusEl.innerHTML = '<span style="color: #ff9500;">⚠️ 获取状态失败</span>';
            } else if (enabled) {
                statusEl.innerHTML = '<span style="color: #34c759;">✅ 已开启 - 允许通用反代</span>';
            } else {
                statusEl.innerHTML = '<span style="color: #ff3b30;">🔒 已关闭 - 仅限节点访问</span>';
            }
        }

        async function toggleGeneralProxy() {
            const enabled = document.getElementById('generalProxyToggle').checked;
            try {
                const res = await fetch('/api/general-proxy-toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: enabled })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(data.msg || '设置成功！');
                    updateGeneralProxyStatusText(enabled);
                } else {
                    showToast(data.error || '设置失败');
                    // 恢复原状态
                    document.getElementById('generalProxyToggle').checked = !enabled;
                }
            } catch(e) {
                showToast('网络异常，请重试');
                document.getElementById('generalProxyToggle').checked = !enabled;
            }
        }

        // 页面加载时获取状态
        window.addEventListener('DOMContentLoaded', () => {
            loadGeneralProxyStatus();
        });
        // =====================================

        // 设置 Chart.js 响应暗色模式
        function updateChartColors() {
            Chart.defaults.color = document.body.classList.contains('dark') ? '#98989d' : '#86868b';
            Chart.defaults.borderColor = document.body.classList.contains('dark') ? '#38383a' : '#d2d2d7';
        }

        // =====================================
        // 数据大屏与统计逻辑 (适配手机端表格排版)
        // =====================================
        function parseTrafficToBytes(str) {
            if (!str || str === '0 B' || str.includes('异常') || str.includes('获取')) return 0;
            let val = parseFloat(str);
            if (str.includes('TB')) return val * 1099511627776;
            if (str.includes('GB')) return val * 1073741824;
            if (str.includes('MB')) return val * 1048576;
            if (str.includes('KB')) return val * 1024;
            return val;
        }

        function refreshTop5() {
            const top5Container = document.getElementById('top5-container');
            if (!top5Container) return;

            // 从预存的全局数据获取流量，而不是从 DOM 抓取
            const routesData = window.globalRoutesData || [];
            let nodesWithBandwidth = [];

            if (routesData.length > 0) {
                routesData.forEach(r => {
                    nodesWithBandwidth.push({
                        prefix: r.prefix || '未知',
                        remark: r.remark || r.prefix || '未知',
                        todayBandwidth: r.todayBandwidth || '0 B'
                    });
                });
            }

            let html = '<h3 style="margin: 0 0 16px 0; display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600;"><span style="color: var(--primary);">🏆</span>今日节点流量 TOP 3</h3>';
            html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">';

            if (nodesWithBandwidth.length > 0) {
                const validNodes = nodesWithBandwidth.filter(r => parseTrafficToBytes(r.todayBandwidth) > 0);
                const top5 = validNodes.sort((a, b) => parseTrafficToBytes(b.todayBandwidth) - parseTrafficToBytes(a.todayBandwidth)).slice(0, 3);

                if (top5.length > 0) {
                    const rankColors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff'];
                    const maxBytes = parseTrafficToBytes(top5[0].todayBandwidth);

                    top5.forEach((r, idx) => {
                        const rankColor = rankColors[idx] || 'var(--text-sec)';
                        const percentage = maxBytes > 0 ? Math.round(parseTrafficToBytes(r.todayBandwidth) / maxBytes * 100) : 0;
                        const itemStyle = 'background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 14px;';
                        const rowStyle = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
                        const badgeStyle = 'width: 24px; height: 24px; background: ' + rankColor + '; color: #fff; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;';
                        const barStyle = 'height: 6px; background: var(--border); border-radius: 3px; overflow: hidden;';
                        const progressStyle = 'width: ' + percentage + '%; height: 100%; background: linear-gradient(90deg, ' + rankColor + ', ' + rankColor + '88); border-radius: 3px;';

                        html += '<div style="' + itemStyle + '">';
                        html += '<div style="' + rowStyle + '">';
                        html += '<div style="display: flex; align-items: center; gap: 8px;">';
                        html += '<span style="' + badgeStyle + '">' + (idx + 1) + '</span>';
                        html += '<span style="font-weight: 600; font-size: 14px; color: var(--text);">' + escapeHtml(r.remark) + '</span>';
                        html += '</div>';
                        html += '<span style="font-family: monospace; font-size: 14px; font-weight: 600; color: var(--primary);">' + r.todayBandwidth + '</span>';
                        html += '</div>';
                        html += '<div style="' + barStyle + '">';
                        html += '<div style="' + progressStyle + '"></div>';
                        html += '</div>';
                        html += '</div>';
                    });
                } else {
                    html += '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">今日暂无节点产生流量</div>';
                }
            } else {
                html += '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px;">暂无节点数据</div>';
            }
            html += '</div>';
            top5Container.innerHTML = html;
        }

        async function loadDashboardData() {
            // 渲染 TOP 5 到数据页
            refreshTop5();

            // ==========================================
            // 🌟 正常加载下面的图表数据 (带有10秒防卡死超时保护)
            // ==========================================
            document.getElementById('logTableBody').innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 30px;">数据分析引擎计算中...</td></tr>';
            document.getElementById('trafficToday').innerText = '拉取中...';
            document.getElementById('traffic7d').innerText = '拉取中...';
            document.getElementById('traffic30d').innerText = '拉取中...';

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                const res = await fetch('/api/analytics', { signal: controller.signal });
                clearTimeout(timeoutId);
                
                const data = await res.json();
                if(!data.success) throw new Error(data.error);

                updateChartColors();

                document.getElementById('trafficToday').innerText = data.trafficToday || '未知';
                document.getElementById('traffic7d').innerText = data.traffic7d || '未知';
                document.getElementById('traffic30d').innerText = data.traffic30d || '未知';

                const labels = data.trend.map(i => i.date.substring(5)); 
                const counts = data.trend.map(i => i.count);
                const trendCtx = document.getElementById('trendChart').getContext('2d');
                if(trendChartInstance) trendChartInstance.destroy();
                trendChartInstance = new Chart(trendCtx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{ label: '有效播放 (次)', data: counts, borderColor: '#0071e3', backgroundColor: 'rgba(0,113,227,0.1)', fill: true, tension: 0.3 }]
                    },
                    options: { responsive: true, plugins: { title: { display: true, text: '过去 7 天全站播放并发趋势', font: {size: 16} } } }
                });

                const locLabels = data.locations.map(i => i.country === 'CN' ? '中国大陆' : (i.country || '未知'));
                const locCounts = data.locations.map(i => i.count);
                const locCtx = document.getElementById('locationChart').getContext('2d');
                if(locationChartInstance) locationChartInstance.destroy();
                locationChartInstance = new Chart(locCtx, {
                    type: 'doughnut',
                    data: {
                        labels: locLabels,
                        datasets: [{ data: locCounts, backgroundColor: ['#34c759', '#0071e3', '#ff9500', '#af52de', '#ff2d55', '#8e8e93'], borderWidth: 0 }]
                    },
                    options: { responsive: true, plugins: { title: { display: true, text: '独立访客来源地占比', font: {size: 16} } } }
                });

                const tbody = document.getElementById('logTableBody');
                tbody.innerHTML = '';
                if(data.recents.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 30px;">暂无日志记录</td></tr>';
                } else {
                    data.recents.slice(0, 10).forEach(log => {
                        const tr = document.createElement('tr');
                        const isChina = log.country === 'CN';
                        const locationText = formatLogLocation(log);
                        tr.innerHTML = \`
                            <td data-label="访问时间" style="font-size:12px; white-space:nowrap;">\${escapeHtml(log.timestamp)}</td>
                            <td data-label="目标节点"><span class="badge" style="background:rgba(0,113,227,0.1);color:var(--primary);">\${escapeHtml(log.prefix)}</span></td>
                            <td data-label="真实 IP" style="font-family:monospace; font-size:13px; color:var(--text-sec); word-break:break-all;">\${escapeHtml(log.ip)}</td>
                            <td data-label="归属地"><span class="badge" style="background:\${isChina ? 'rgba(52,199,89,0.1)' : 'rgba(255,149,0,0.1)'}; color:\${isChina ? '#34c759' : '#ff9500'};">\${escapeHtml(locationText)}</span></td>
                            <td data-label="设备标识 (UA)" style="font-size:12px; color:var(--text-sec); word-break: break-all; white-space: normal; text-align: right; line-height: 1.4;" title="\${escapeAttr(log.ua)}">\${escapeHtml(log.ua)}</td>
                        \`;
                        tbody.appendChild(tr);
                    });
                }

            } catch (e) {
                const errMsg = e.name === 'AbortError' ? '网络超时，CF 接口拥堵，请稍后重试' : e.message;
                document.getElementById('logTableBody').innerHTML = \`<tr><td colspan="5" style="text-align:center;color:#ff3b30; padding: 30px;">独立图表数据拉取失败: \${escapeHtml(errMsg)}</td></tr>\`;
            }
        }

        async function loadIcons(forceUrl = null) {
            const grid = document.getElementById('iconGrid');
            grid.innerHTML = '<div style="grid-column: 1/-1; color: var(--text-sec); font-size: 13px; text-align: center;">加载图标库中...</div>';
            const targetUrl = forceUrl || localStorage.getItem('custom_icon_url') || DEFAULT_ICON_URL;
            const urlInput = document.getElementById('customIconUrlInput');
            if (urlInput) urlInput.value = targetUrl === DEFAULT_ICON_URL ? '' : targetUrl;
            
            // URL 安全验证
            try {
                const urlObj = new URL(targetUrl);
                if (!['http:', 'https:'].includes(urlObj.protocol)) {
                    throw new Error('仅支持 HTTP/HTTPS 协议');
                }
            } catch(e) {
                grid.innerHTML = '<div style="grid-column: 1/-1; color: #ff3b30; font-size: 13px; text-align: center;">无效的图标库链接</div>';
                return;
            }
            
            try {
                // 添加超时控制
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);
                const res = await fetch(targetUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                const data = await res.json();
                if (data && data.icons && Array.isArray(data.icons)) {
                    globalIcons = data.icons;
                } else if (Array.isArray(data)) {
                    globalIcons = data;
                } else {
                    globalIcons = [];
                    for (const [key, val] of Object.entries(data)) { globalIcons.push({ name: key, url: val }); }
                }
                renderIconGrid('');
            } catch(e) { 
                const errMsg = e.name === 'AbortError' ? '请求超时，请检查链接或网络状态' : '获取图标库失败，请检查链接或网络状态';
                const errDiv = '<div style="grid-column: 1/-1; color: #ff3b30; font-size: 13px; text-align: center;">' + errMsg + '</div>';
                grid.innerHTML = errDiv;
            }
        }

        function setCustomIconLibrary() {
            const url = document.getElementById('customIconUrlInput').value.trim();
            if (!url) return showToast('⚠️ 请输入图标库 JSON 链接');
            if (!isSafeHttpUrl(url)) return showToast('⚠️ 请输入合法的 HTTP/HTTPS URL');
            localStorage.setItem('custom_icon_url', url);
            showToast('⏳ 正在加载自定义图标库...');
            loadIcons(url);
        }

        function resetIconLibrary() {
            localStorage.removeItem('custom_icon_url');
            document.getElementById('customIconUrlInput').value = '';
            showToast('🔄 已恢复默认图标库');
            loadIcons(DEFAULT_ICON_URL);
        }

        function renderIconGrid(filterText) {
            const grid = document.getElementById('iconGrid');
            const lowerFilter = filterText.toLowerCase();
            const filtered = globalIcons.filter(item => (item.name || '').toLowerCase().includes(lowerFilter));
            let html = \`<div class="icon-item" onclick="selectIcon('', '默认 🎬')" title="使用默认图标"><span style="font-size:22px;">🎬</span></div>\`;
            filtered.forEach(item => {
                const rawUrl = String(item.url || '');
                if (!isSafeHttpUrl(rawUrl)) return;
                const rawName = String(item.name || '未命名图标');
                html += \`<div class="icon-item" onclick="selectIcon(\${jsStringAttr(rawUrl)}, \${jsStringAttr(rawName)})" title="\${escapeAttr(rawName)}">
                            <img src="\${escapeAttr(rawUrl)}" loading="lazy" style="width: 32px; height: 32px; object-fit: contain; border-radius: 4px;">
                        </div>\`;
            });
            grid.innerHTML = html;
        }

        function filterIcons() { renderIconGrid(document.getElementById('iconSearch').value); }

        function toggleIconPicker(e) {
            e.stopPropagation();
            const panel = document.getElementById('iconPickerPanel');
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
        }

        function selectIcon(url, name) {
            document.getElementById('iconUrl').value = url;
            const preview = document.getElementById('iconPreview');
            const def = document.getElementById('iconDefault');
            const text = document.getElementById('iconSelectText');
            if(url) {
                preview.src = url; preview.style.display = 'block'; def.style.display = 'none';
                text.textContent = name; text.style.color = 'var(--text)';
            } else {
                preview.src = ''; preview.style.display = 'none'; def.style.display = 'block';
                text.textContent = '点击选择图标 (默认 🎬)'; text.style.color = 'var(--text-sec)';
            }
            document.getElementById('iconPickerPanel').style.display = 'none';
        }

        document.addEventListener('click', (e) => {
            const panel = document.getElementById('iconPickerPanel');
            const btn = document.getElementById('iconSelectBtn');
            if (panel && btn && panel.style.display !== 'none') {
                if (!panel.contains(e.target) && !btn.contains(e.target)) panel.style.display = 'none';
            }
        });

        // 分页切换函数
        let dataLoaded = false; // 标记数据大屏是否已加载
        function switchPage(pageNum) {
            // 隐藏所有页面
            document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
            // 显示目标页面
            const targetPage = document.getElementById('page-' + pageNum);
            if (targetPage) targetPage.classList.add('active');
            // 更新标签样式
            document.querySelectorAll('.page-tab').forEach((el, idx) => {
                if (idx + 1 === pageNum) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            });
            // 懒加载：首次切换到数据页时加载大屏数据
            if (pageNum === 3 && !dataLoaded) {
                dataLoaded = true;
                loadDashboardData();
            } else if (pageNum === 3) {
                // 每次切换到数据页都刷新 TOP 5
                refreshTop5();
            }
            // 滚动到顶部
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function toggleDarkMode() {
            const isDark = document.body.classList.toggle('dark');
            document.body.style.background = isDark
                ? 'linear-gradient(180deg, #020617 0%, #0F172A 50%, #1E293B 100%)'
                : 'linear-gradient(180deg, #F8FAFC 0%, #E2E8F0 100%)';
            localStorage.setItem('emby_proxy_dark', isDark ? '1' : '0');

            // 直接切换图标
            const icon = document.getElementById('themeIcon');
            if (icon) {
                icon.innerHTML = isDark ? SVG_MOON : SVG_SUN;
            } else {
                console.log('themeIcon not found');
            }

            if(trendChartInstance) { updateChartColors(); trendChartInstance.update(); locationChartInstance.update(); }
        }

        // 初始化主题状态 - 默认深色模式
        (function initTheme() {
            // 默认使用深色模式
            document.body.classList.add('dark');
            document.body.style.background = 'linear-gradient(180deg, #020617 0%, #0F172A 50%, #1E293B 100%)';
            localStorage.setItem('emby_proxy_dark', '1');

            // 设置月亮图标
            const initIcon = document.getElementById('themeIcon');
            if (initIcon) {
                initIcon.innerHTML = SVG_MOON;
            }
        })();

        // 也监听 DOMContentLoaded 确保初始化
        document.addEventListener('DOMContentLoaded', () => {
            if (localStorage.getItem('emby_proxy_dark') === '1') {
                const initIcon = document.getElementById('themeIcon');
                if (initIcon) initIcon.innerHTML = SVG_MOON;
            }
        });

        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg; t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 3000);
        }

        async function purgeCache() {
            if(!confirm('确定要清理 Cloudflare 节点的全站海报和静态缓存吗？\\n\\n清理后可能导致短时间的加载缓慢。')) return;
            const btn = document.getElementById('btnPurge');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = SVG_REFRESH + ' 正在清理...';
            btn.disabled = true;
            try {
                const res = await fetch('/api/purge-cache', { method: 'POST' });
                const data = await res.json();
                if(data.success) showToast('✅ 缓存清理成功，新海报已生效！');
                else showToast('❌ 清理失败: ' + data.error);
            } catch(e) { showToast('❌ 网络请求错误'); } finally { btn.innerHTML = originalHTML; btn.disabled = false; }
        }

        function filterNodesList() {
            const filterText = document.getElementById('searchNode').value.toLowerCase();
            const cards = document.querySelectorAll('.emby-card');
            cards.forEach(card => {
                const searchStr = card.getAttribute('data-search').toLowerCase();
                card.style.display = searchStr.includes(filterText) ? 'flex' : 'none';
            });
        }

        function handleTargetInputs() {
            const container = document.getElementById('targetInputs');
            const inputs = container.querySelectorAll('.target-input');
            const lastInput = inputs[inputs.length - 1];
            if (lastInput.value.trim() !== '') {
                const newInput = document.createElement('input');
                newInput.type = 'url'; newInput.className = 'target-input';
                newInput.style = 'padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;';
                newInput.oninput = handleTargetInputs;
                container.appendChild(newInput);
            }
            let emptyCount = 0;
            const currentInputs = container.querySelectorAll('.target-input');
            for (let i = currentInputs.length - 1; i >= 0; i--) {
                if (currentInputs[i].value.trim() === '') { emptyCount++; if (emptyCount > 1) currentInputs[i].remove(); } else { break; }
            }
            container.querySelectorAll('.target-input').forEach((inp, idx) => {
                inp.placeholder = idx === 0 ? "主线路地址 (如: http://1.1.1.1:8096)" : \`备用线路 \${idx} (选填，主源挂掉时触发)\`;
            });
        }

        function resetTargetInputs() {
            const container = document.getElementById('targetInputs');
            container.innerHTML = \`
                <input type="url" class="target-input" placeholder="主线路地址 (如: http://1.1.1.1:8096)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;" required oninput="handleTargetInputs()">
                <input type="url" class="target-input" placeholder="备用线路 1 (选填)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;" oninput="handleTargetInputs()">
            \`;
        }

        function toggleVis(id, isArray = false) {
            const el = document.getElementById(id);
            if (el.classList.contains('secret-text')) {
                el.classList.remove('secret-text'); el.classList.add('actual-text');
                if (isArray) {
                    let arr = [];
                    try {
                        arr = JSON.parse(decodeURIComponent(el.getAttribute('data-val') || '[]'));
                        if (!Array.isArray(arr)) arr = [];
                    } catch (e) {
                        arr = [];
                    }
                    let html = '';
                    arr.forEach((t, i) => {
                        const tag = i === 0 ? '<span style="color:#34c759;font-weight:bold;">[主]</span>' : '<span style="color:#ff9500;font-weight:bold;">[备]</span>';
                        html += \`<div class="url-list-item">\${tag} \${t}</div>\`;
                    });
                    if (html) el.innerHTML = html;
                    else el.textContent = el.getAttribute('data-val') || '';
                } else { el.textContent = el.getAttribute('data-val'); }
            } else {
                el.classList.add('secret-text'); el.classList.remove('actual-text'); el.textContent = '••••••••';
            }
        }

        function toggleCardExpand(btn) {
            const card = btn.closest('.emby-card');
            const details = card.querySelector('.card-details');
            const icon = btn.querySelector('.expand-icon');
            const text = btn.querySelector('span:first-child');
            const isExpanded = btn.getAttribute('data-expanded') === 'true';

            // 先收起所有其他卡片
            document.querySelectorAll('.btn-expand[data-expanded="true"]').forEach(otherBtn => {
                if (otherBtn !== btn) {
                    const otherCard = otherBtn.closest('.emby-card');
                    const otherDetails = otherCard.querySelector('.card-details');
                    otherDetails.style.display = 'none';
                    otherBtn.querySelector('.expand-icon').style.transform = 'rotate(0deg)';
                    otherBtn.querySelector('span:first-child').textContent = '详情';
                    otherBtn.setAttribute('data-expanded', 'false');
                }
            });

            if (!isExpanded) {
                details.style.display = 'block';
                icon.style.transform = 'rotate(180deg)';
                text.textContent = '收起';
                btn.setAttribute('data-expanded', 'true');
            } else {
                details.style.display = 'none';
                icon.style.transform = 'rotate(0deg)';
                text.textContent = '详情';
                btn.setAttribute('data-expanded', 'false');
            }
        }

        function copyTxt(txt) { navigator.clipboard.writeText(txt).then(() => showToast('🚀 复制成功！')); }
        function copyWithAnim(btn, txt) {
            const originalHtml = btn.innerHTML;
            btn.style.transform = 'scale(1.25)';
            btn.style.color = '#10b981';
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
            // 使用 textarea 确保持久复制
            const ta = document.createElement('textarea');
            ta.value = txt;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); showToast('🚀 复制成功！'); } catch(e) { navigator.clipboard.writeText(txt).then(() => showToast('🚀 复制成功！')).catch(() => showToast('❌ 复制失败')); }
            document.body.removeChild(ta);
            setTimeout(() => {
                btn.style.transform = '';
                btn.style.color = '';
                btn.innerHTML = originalHtml;
            }, 700);
        }

        async function pingTarget(idx, targetUrl) {
            const pingEl = document.getElementById('ping-' + idx);
            pingEl.textContent = '测速中...'; pingEl.style.color = 'var(--text-sec)';
            try {
                const res = await fetch('/api/ping-node?url=' + encodeURIComponent(targetUrl));
                const data = await res.json();
                if(data.ms >= 0) {
                    pingEl.textContent = data.ms + ' ms';
                    pingEl.style.color = data.ms < 200 ? '#34c759' : (data.ms < 500 ? 'var(--primary)' : '#ff9500');
                } else { pingEl.textContent = '断连/超时'; pingEl.style.color = '#ff3b30'; }
            } catch(e) { pingEl.textContent = '测速异常'; pingEl.style.color = '#ff3b30'; }
        }

        function pingAllNodes() {
            if (proxyNodesForPing.length === 0) return showToast('⚠️ 没有可供测速的反代节点');
            showToast('⚡ 正在对所有节点发起测速...');
            proxyNodesForPing.forEach((node, offset) => { setTimeout(() => pingTarget(node.idx, node.url), offset * 200); });
        }

        async function exportConfig() {
            try {
                const res = await fetch('/api/routes'); const data = await res.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'emby_proxy_backup.json'; a.click();
                URL.revokeObjectURL(url); showToast('✅ 配置已导出');
            } catch (e) { showToast('❌ 导出失败'); }
        }

        function importConfig() {
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
            input.onchange = async (e) => {
                const file = e.target.files[0]; const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const routes = JSON.parse(event.target.result);
                        const res = await fetch('/api/routes/import', { method: 'POST', body: JSON.stringify(routes) });
                        const result = await res.json();
                        if (result.success) { showToast('✅ 配置导入成功'); load(); } else throw new Error(result.error);
                    } catch (err) { showToast('❌ 导入失败: ' + err.message); }
                };
                reader.readAsText(file);
            };
            input.click();
        }

        async function load() {
            let timeoutId = null;
            try {
                const controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), 12000);
                const res = await fetch('/api/routes', { signal: controller.signal });
                if (!res.ok) throw new Error('请求失败，请检查环境配置');
                const data = await res.json();
                if (data.error) throw new Error(data.error);

                // 🌟 新增：把节点流量数据存进全局内存，供大屏瞬间读取！
                window.globalRoutesData = data;

                const container = document.getElementById('list-grid');
                if(data.length === 0) {
                    container.innerHTML = '<div style="text-align:center; color:var(--text-sec); grid-column: 1 / -1; padding: 40px;">暂无配置任何反代节点，请先部署一个。</div>';
                    return;
                }
                
                container.innerHTML = '';
                proxyNodesForPing = []; 
                const currentHost = window.location.host;

                data.forEach((r, idx) => {
                    const proxyUrl = 'https://' + currentHost + '/' + r.prefix;
                    const targets = r.target.split(',').map(s => s.trim()).filter(Boolean);
                    const mainTarget = targets[0]; 
                    
                    const remarkName = r.remark || '未命名媒体库';
                    const lastPlay = r.last_play ? r.last_play : '暂无播放记录';
                    
                    const prefixText = String(r.prefix || '');
                    const targetText = String(r.target || '');
                    const modeText = String(r.mode || 'off');
                    const iconText = String(r.icon || '');
                    const cacheImgText = String(r.cache_img || 'on');
                    const safePrefixText = escapeHtml(prefixText);
                    const safePrefixAttr = escapeAttr(prefixText);
                    const safeRemarkText = escapeHtml(remarkName);
                    const safeLastPlay = escapeHtml(lastPlay);
                    const safeModeText = escapeHtml(modeNames[modeText] || '未知');
                    const iconHtml = iconText && isSafeHttpUrl(iconText) ? \`<img src="\${escapeAttr(iconText)}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;">\` : '🎬';
                    const encodedTargets = encodeURIComponent(JSON.stringify(targets));
                    
                    // 🌟 接收后端传来的：单节点独立宽带与请求统计数据
                    const todayBw = r.todayBandwidth || '0 B';
                    const totalReqs = r.totalReqs || r.todayReqs || 0;

                    proxyNodesForPing.push({ idx: idx, url: mainTarget });

                    container.innerHTML += \`
                    <div class="emby-card route-item" data-prefix="\${safePrefixAttr}" data-search="\${escapeAttr(remarkName + ' ' + prefixText)}">
                        <div class="card-header">
                            <div class="card-title-group" style="display: flex; align-items: center; gap: 10px;">
                                <div class="drag-handle" title="长按拖拽排序" style="margin: 0; display: flex; align-items: center;">☰</div>
                                <input type="checkbox" class="node-cb" value="\${safePrefixAttr}" style="width: 18px; height: 18px; margin: 0; cursor: pointer; accent-color: var(--primary); flex-shrink: 0;">
                                <div class="emby-icon" style="margin: 0; display: flex; align-items: center;">\${iconHtml}</div>
                                <div style="flex: 1; min-width: 0;">
                                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                        <span style="font-weight: 600; font-size: 16px; color: var(--text);">\${safeRemarkText}</span>
                                        <span style="font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; background: \${modeColors[modeText]?.bg || 'rgba(59, 130, 246, 0.1)'}; color: \${modeColors[modeText]?.color || '#3b82f6'};">\${safeModeText}</span>
                                    </div>
                                    <div style="font-size: 13px; color: var(--text-sec); margin-top:2px;">/\${safePrefixText}</div>
                                </div>
                            </div>
                            <button class="icon-btn" onclick="copyWithAnim(this, \${jsStringAttr(proxyUrl)})" title="复制直达链接" style="width: 36px; height: 36px; flex-shrink: 0;">${SVG_COPY}</button>
                        </div>

                        <div class="card-summary" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                            <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
                                <span id="ping-\${idx}" class="ping-badge" onclick="pingTarget(\${idx}, \${jsStringAttr(mainTarget)})" title="点击重新测速" style="font-size: 12px;">测速中...</span>
                                <span style="font-size: 13px; color: var(--text-sec); display: flex; align-items: center; gap: 4px;">${SVG_DOWN_ARROW} \${escapeHtml(todayBw)}</span>
                                <span style="font-size: 13px; color: var(--text-sec); display: flex; align-items: center; gap: 4px;">📺 \${escapeHtml(r.todayReqs)}/\${escapeHtml(totalReqs)}</span>
                                <span style="font-size: 12px; color: var(--text-muted);">最后活跃: \${safeLastPlay}</span>
                            </div>
                            <button class="btn-expand" onclick="toggleCardExpand(this)" data-expanded="false" style="background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 12px; color: var(--text-sec); display: flex; align-items: center; gap: 4px;">
                                <span>详情</span>
                                <span class="expand-icon" style="transition: transform 0.2s;">▼</span>
                            </button>
                        </div>

                        <div class="card-details" style="display: none; padding-top: 12px; border-top: 1px solid var(--border);">
                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                <div class="info-row">
                                    <span class="info-label">直达链接:</span>
                                    <div class="action-group" style="flex:1; justify-content: flex-end; margin-left: 10px; align-items: flex-start;">
                                        <span id="p-\${idx}" data-val="\${escapeAttr(proxyUrl)}" class="secret-text dynamic-url">••••••••</span>
                                        <button class="icon-btn" style="margin-top: 2px;" onclick="toggleVis('p-\${idx}')" title="查看明文">${SVG_EYE}</button>
                                    </div>
                                </div>
                                <div class="info-row">
                                    <span class="info-label">源站线路:</span>
                                    <div class="action-group" style="flex:1; justify-content: flex-end; margin-left: 10px; align-items: flex-start;">
                                        <div id="t-\${idx}" data-val="\${escapeAttr(encodedTargets)}" class="secret-text dynamic-url">••••••••</div>
                                        <button class="icon-btn" style="margin-top: 2px;" onclick="toggleVis('t-\${idx}', true)" title="查看明文">${SVG_EYE}</button>
                                    </div>
                                </div>
                                <div class="info-row">
                                    <span class="info-label">海报缓存:</span>
                                    <span style="color:\${r.cache_img !== 'off' ? '#34c759' : '#ff9500'}; font-weight:600;">\${r.cache_img !== 'off' ? '✅ 已开启' : '❌ 已关闭'}</span>
                                </div>
                            </div>

                            <div class="card-footer" style="margin-top: 16px;">
                                <button class="btn-edit" onclick="editNode(\${jsStringAttr(prefixText)}, \${jsStringAttr(targetText)}, \${jsStringAttr(modeText)}, \${jsStringAttr(r.remark || '')}, \${jsStringAttr(iconText)}, \${jsStringAttr(cacheImgText)})">编辑配置</button>
                                <button class="btn-del" onclick="del(\${jsStringAttr(prefixText)})">删除</button>
                            </div>
                        </div>
                    </div>\`;

                    setTimeout(() => pingTarget(idx, mainTarget), 500 * idx); 
                });
                
                filterNodesList();

                if (sortableInstance) sortableInstance.destroy();
                sortableInstance = Sortable.create(container, {
                    handle: '.drag-handle',
                    animation: 150,
                    delay: 200, 
                    delayOnTouchOnly: true,
                    onEnd: async function () {
                        const items = [];
                        container.querySelectorAll('.route-item').forEach((row, index) => {
                            const prefix = row.getAttribute('data-prefix');
                            if (prefix) items.push({ prefix: prefix, sort_order: index });
                        });
                        try {
                            await fetch('/api/routes/reorder', { method: 'POST', body: JSON.stringify(items) });
                            showToast('✅ 排序已保存');
                        } catch(e) { showToast('❌ 排序保存失败'); }
                    }
                });

            } catch (err) {
                document.getElementById('list-grid').innerHTML = \`<div style="text-align:center; color:#ff3b30; font-weight:600; grid-column: 1 / -1; padding: 20px;">⚠️ 读取失败: \${escapeHtml(err.message)}</div>\`;
            } finally {
                if (timeoutId !== null) clearTimeout(timeoutId);
            }
        }

        async function loadWithGuard() {
            const container = document.getElementById('list-grid');
            const loadingWatchdog = setTimeout(() => {
                const text = (container?.innerText || '').trim();
                if (text.includes('加载中')) {
                    container.innerHTML = '<div style="text-align:center; color:#ff9500; font-weight:600; grid-column: 1 / -1; padding: 20px;">⚠️ 初始化超时，正在重试...</div>';
                }
            }, 10000);

            await load();
            clearTimeout(loadingWatchdog);

            const afterText = (container?.innerText || '').trim();
            if (!afterText || afterText.includes('加载中')) {
                try {
                    await load();
                } catch (e) {
                    console.warn('load retry failed:', e.message || e);
                }
            }
        }

        function editNode(prefix, targetStr, mode, remark, icon, cacheImg) {
            document.getElementById('oldPrefix').value = prefix;
            document.getElementById('remark').value = remark;
            document.getElementById('prefix').value = prefix;
            document.getElementById('mode').value = mode || 'off';
            document.getElementById('nodeCache').checked = (cacheImg !== 'off');
            
            if (icon) {
                const foundItem = globalIcons.find(i => i.url === icon);
                selectIcon(icon, foundItem ? foundItem.name : '已选择图标');
            } else {
                selectIcon('', '默认 🎬');
            }

            document.getElementById('submitBtn').textContent = '保存修改';
            
            const container = document.getElementById('targetInputs');
            container.innerHTML = '';
            const targets = targetStr.split(',').map(s => s.trim()).filter(Boolean);
            
            targets.forEach((url) => {
                const inp = document.createElement('input');
                inp.type = 'url'; inp.className = 'target-input'; inp.value = url;
                inp.style = 'padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;';
                inp.oninput = handleTargetInputs;
                container.appendChild(inp);
            });
            
            const emptyInp = document.createElement('input');
            emptyInp.type = 'url'; emptyInp.className = 'target-input';
            emptyInp.style = 'padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;';
            emptyInp.oninput = handleTargetInputs;
            container.appendChild(emptyInp);
            
            handleTargetInputs(); 
            window.scrollTo({ top: document.getElementById('addForm').offsetTop - 100, behavior: 'smooth' });
        }

        document.getElementById('addForm').onsubmit = async (e) => {
            e.preventDefault();
            const oldPrefix = document.getElementById('oldPrefix').value;
            const remark = document.getElementById('remark').value.trim();
            const prefix = document.getElementById('prefix').value.trim().replace(/^\\/+/g, '');
            const mode = document.getElementById('mode').value;
            const icon = document.getElementById('iconUrl').value;
            const cache_img = document.getElementById('nodeCache').checked ? 'on' : 'off';

            const inputs = document.querySelectorAll('.target-input');
            let targetsArray = [];
            inputs.forEach(inp => {
                const val = inp.value.trim().replace(/\\/$/g, '');
                if (val) targetsArray.push(val);
            });
            const target = targetsArray.join(',');
            
            if (!target) return showToast('❌ 请至少填写一个主线路地址');

            try {
                const res = await fetch('/api/routes', { 
                    method: 'POST', 
                    body: JSON.stringify({oldPrefix, prefix, target, mode, remark, icon, cache_img})
                });
                const data = await res.json();
                if(!data.success) throw new Error(data.error || '部署失败');
                
                document.getElementById('addForm').reset();
                document.getElementById('oldPrefix').value = '';
                selectIcon('', '默认 🎬');
                document.getElementById('nodeCache').checked = true;
                document.getElementById('submitBtn').textContent = '保存部署';
                resetTargetInputs(); 
                
                showToast('✅ 节点部署成功');
                load();
            } catch(err) {
                showToast('❌ 保存失败: ' + err.message);
            }
        };

        async function del(prefix) {
            if(confirm('确定删除节点 /' + prefix + ' ?')) {
                await fetch('/api/routes?prefix=' + prefix, { method: 'DELETE' });
                showToast('🗑️ 节点已移除');
                load();
            }
        }

        function toggleSelectAll() {
            const isChecked = document.getElementById('selectAll').checked;
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                if(!cb.disabled) cb.checked = isChecked;
            });
        }
        function getSelectedIps() {
            const checkboxes = document.querySelectorAll('.row-checkbox:checked');
            return Array.from(checkboxes).map(cb => cb.value);
        }
        function batchTcpPing() {
            const rows = document.querySelectorAll('#testTableBody .test-row');
            let ips = [];
            rows.forEach(tr => {
                const strong = tr.querySelector('.ip-text');
                if (strong && strong.textContent) {
                    let ip = strong.textContent;
                    if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
                    ips.push(ip);
                }
            });
            if (ips.length === 0) return showToast('⚠️ 请先提取节点！');
            navigator.clipboard.writeText(ips.join('\\n')).then(() => {
                showToast('✅ 节点已复制，即将跳转 ITDog...');
                setTimeout(() => { window.open('https://www.itdog.cn/batch_tcping/', '_blank'); }, 1500);
            });
        }
        function directSubmitCname() {
            const input = document.getElementById('customIps').value.trim();
            if (!input) return showToast('⚠️ 请先在文本框内粘贴您的优选域名');
            const domainRegex = /\\b([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}\\b/g;
            const matchedDomains = input.match(domainRegex) || [];
            const realDomains = matchedDomains.filter(d => !/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(d));
            if (realDomains.length === 0) return showToast('⚠️ 没有提取到合法的域名格式，请检查输入！');
            if(!confirm(\`✨ 提取到以下域名：\\n\${realDomains.join('\\n')}\\n\\n确定要直接将其设为 CNAME 记录吗？\\n(注意：这会清空你配置的域名下现有的记录)\`)) return;
            const btn = document.getElementById('btnDirectCname');
            sendDnsRequest(realDomains, btn);
        }
        async function testCustomIPs() {
            const input = document.getElementById('customIps').value;
            if (!input.trim()) return showToast('⚠️ 请先在输入框粘贴 IP 或优选域名');
            const ipv4Regex = /\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b/g;
            const ipv6Regex = /(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:)*:[A-F0-9]{1,4}(?::[A-F0-9]{1,4})*/gi;
            const domainRegex = /\\b([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}\\b/g;
            let matchedIPv4 = input.match(ipv4Regex) || [];
            let matchedIPv6 = input.match(ipv6Regex) || [];
            let matchedDomains = input.match(domainRegex) || [];
            matchedDomains = matchedDomains.filter(d => !/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(d));
            let extractedIps = [...matchedIPv4, ...matchedDomains];
            matchedIPv6.forEach(ip => {
                if (ip.length > 7 && ip.includes(':') && !ip.startsWith('::1')) { extractedIps.push(ip.startsWith('[') ? ip : \`[\${ip}]\`); }
            });
            extractedIps = [...new Set(extractedIps)];
            if (extractedIps.length === 0) return showToast('⚠️ 未识别到合法的 IP 或 域名格式');
            const btn = document.getElementById('btnTestCustom');
            const tbody = document.getElementById('testTableBody');
            btn.disabled = true; btn.textContent = '⏳ 测试中...';
            if(tbody.innerHTML.includes('暂无数据')) tbody.innerHTML = '';
            showToast(\`✅ 提取到 \${extractedIps.length} 个节点，开始测速校验\`);
            const promises = [];
            extractedIps.forEach(ip => {
                const safeIpText = escapeHtml(ip);
                const safeIpAttr = escapeAttr(ip);
                const tr = document.createElement('tr');
                tr.className = 'test-row';
                tr.innerHTML = \`
                    <td data-label="勾选节点" style="text-align: center;"><input type="checkbox" class="ip-checkbox row-checkbox" value="\${safeIpAttr}"></td>
                    <td data-label="专属节点"><strong class="ip-text" style="color:var(--primary);cursor:pointer;font-family:monospace;" onclick="copyTxt(\${jsStringAttr(ip)})" title="点击复制">\${safeIpText}</strong></td>
                    <td data-label="预估延迟" class="latency" data-ms="9999" style="font-weight: 600; color: #888;">测算中...</td>
                    <td data-label="连通状态" class="speed" style="color: #888;">-</td>
                    <td data-label="记录/归属地" class="loc" style="color: #666;">等待解析</td>
                    <td data-label="快捷操作"><button class="btn-dns" disabled onclick="updateSingleDns(\${jsStringAttr(ip)}, this)">唯一解析</button></td>\`;
                tbody.insertBefore(tr, tbody.firstChild);
                promises.push(doLocalPing(ip, tr, '自定义节点'));
            });
            await Promise.all(promises);
            sortTableByLatency(tbody);
            document.querySelectorAll('.btn-dns').forEach(b => b.disabled = false);
            btn.disabled = false; btn.textContent = '🧪 测试粘贴的节点';
            showToast('🎉 自定义节点测速完成！');
        }
        async function fetchCustomApiAndTest() {
            const apiUrl = document.getElementById('customApiUrl').value.trim();
            if (!apiUrl) return showToast('⚠️ 请先填入自定义 API 链接');
            const btn = document.getElementById('btnFetchCustomApi');
            const tbody = document.getElementById('testTableBody');
            const statusTxt = document.getElementById('statusText');
            btn.disabled = true; btn.textContent = '⏳ 拉取中...';
            statusTxt.innerHTML = \`正在从自定义 API 抓取数据...\`;
            if(tbody.innerHTML.includes('暂无数据')) tbody.innerHTML = ''; 
            try {
                const res = await fetch(\`/api/get-custom-api-ips?url=\${encodeURIComponent(apiUrl)}\`);
                const data = await res.json();
                if (!data.ips || data.ips.length === 0) { showToast('⚠️ 自定义 API 返回为空'); return; }
                showToast(\`✅ 提取 \${data.totalCount} 个节点，抽取 \${data.ips.length} 个测速\`);
                btn.textContent = '⚡ 测速中...';
                const promises = [];
                data.ips.forEach(ip => {
                    const safeIpText = escapeHtml(ip);
                    const safeIpAttr = escapeAttr(ip);
                    const tr = document.createElement('tr');
                    tr.className = 'test-row';
                    tr.innerHTML = \`
                        <td data-label="勾选节点" style="text-align: center;"><input type="checkbox" class="ip-checkbox row-checkbox" value="\${safeIpAttr}"></td>
                        <td data-label="专属节点"><strong class="ip-text" style="color:var(--primary);cursor:pointer;font-family:monospace;" onclick="copyTxt(\${jsStringAttr(ip)})" title="点击复制">\${safeIpText}</strong></td>
                        <td data-label="预估延迟" class="latency" data-ms="9999" style="font-weight: 600; color: #888;">测算中...</td>
                        <td data-label="连通状态" class="speed" style="color: #888;">-</td>
                        <td data-label="记录/归属地" class="loc" style="color: #666;">等待解析</td>
                        <td data-label="快捷操作"><button class="btn-dns" disabled onclick="updateSingleDns(\${jsStringAttr(ip)}, this)">唯一解析</button></td>\`;
                    tbody.insertBefore(tr, tbody.firstChild);
                    promises.push(doLocalPing(ip, tr, '自定义 API'));
                });
                await Promise.all(promises);
                sortTableByLatency(tbody);
                document.querySelectorAll('.btn-dns').forEach(b => b.disabled = false);
                document.getElementById('selectAll').checked = false;
                showToast('🎉 自定义 API 测速完成！');
                statusTxt.innerHTML = \`✅ 测速完毕！您可以自由组合更新 DNS。\`;
            } catch (err) { showToast('❌ 拉取失败'); } 
            finally { btn.disabled = false; btn.textContent = '🌐 拉取 API 并测速'; }
        }
        async function fetchRemoteAndTest() {
            const btn = document.getElementById('btnFetchRemote');
            const tbody = document.getElementById('testTableBody');
            const statusTxt = document.getElementById('statusText');
            const type = document.getElementById('ipType').value;
            const typeText = document.getElementById('ipType').options[document.getElementById('ipType').selectedIndex].text;
            btn.disabled = true; btn.textContent = '⏳ 正在提取节点...';
            statusTxt.innerHTML = \`正在拉取 <strong>\${typeText}</strong> 数据...\`;
            if(tbody.innerHTML.includes('暂无数据')) tbody.innerHTML = ''; 
            try {
                const res = await fetch(\`/api/get-remote-ips?type=\${encodeURIComponent(type)}\`);
                const data = await res.json();
                if (!data.ips || data.ips.length === 0) { showToast('⚠️ 未获取到该类型 IP'); return; }
                showToast(\`✅ 成功提取 \${data.totalCount} 个可用 IP，抽取 \${data.ips.length} 个测速\`);
                btn.textContent = '⚡ 本地测速中...';
                const promises = [];
                data.ips.forEach(ip => {
                    const safeIpText = escapeHtml(ip);
                    const safeIpAttr = escapeAttr(ip);
                    const tr = document.createElement('tr');
                    tr.className = 'test-row';
                    tr.innerHTML = \`
                        <td data-label="勾选节点" style="text-align: center;"><input type="checkbox" class="ip-checkbox row-checkbox" value="\${safeIpAttr}"></td>
                        <td data-label="专属节点"><strong class="ip-text" style="color:var(--primary);cursor:pointer;font-family:monospace;" onclick="copyTxt(\${jsStringAttr(ip)})" title="点击复制">\${safeIpText}</strong></td>
                        <td data-label="预估延迟" class="latency" data-ms="9999" style="font-weight: 600; color: #888;">测算中...</td>
                        <td data-label="连通状态" class="speed" style="color: #888;">-</td>
                        <td data-label="记录/归属地" class="loc" style="color: #666;">等待解析</td>
                        <td data-label="快捷操作"><button class="btn-dns" disabled onclick="updateSingleDns(\${jsStringAttr(ip)}, this)">唯一解析</button></td>\`;
                    tbody.insertBefore(tr, tbody.firstChild);
                    promises.push(doLocalPing(ip, tr, typeText.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')));
                });
                await Promise.all(promises);
                sortTableByLatency(tbody);
                document.querySelectorAll('.btn-dns').forEach(b => b.disabled = false);
                document.getElementById('selectAll').checked = false;
                showToast('🎉 测速完成！');
                statusTxt.innerHTML = \`✅ 测速完毕！\`;
            } catch (err) { showToast('❌ 拉取或测速失败'); } 
            finally { btn.disabled = false; btn.textContent = '🌍 提取预设源并测速'; }
        }
        function clearTest() {
            document.getElementById('testTableBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-sec);">暂无数据，请拉取节点或输入自定义 IP/域名 测试</td></tr>';
            document.getElementById('statusText').textContent = '列表已清空。';
            document.getElementById('selectAll').checked = false;
        }
        function markTimeout(latTd, spdTd, tr) {
            latTd.textContent = '超时抛弃'; latTd.setAttribute('data-ms', 9999); latTd.style.color = '#ff3b30';
            spdTd.textContent = '❌ 超时 (>2000ms)'; spdTd.style.color = '#ff3b30';
            const cb = tr.querySelector('.row-checkbox');
            if(cb) { cb.disabled = true; cb.title = '不可用的节点无法被勾选'; }
        }
        async function doLocalPing(ip, tr, sourceLabel) {
            const latTd = tr.querySelector('.latency');
            const spdTd = tr.querySelector('.speed');
            const locTd = tr.querySelector('.loc');
            const queryIp = ip.replace(/[\\[\\]]/g, '');
            const isIPv6 = ip.includes(':'); 
            const isDomain = /[a-zA-Z]/.test(queryIp) && !isIPv6;
            const safeSourceLabel = escapeHtml(sourceLabel);
            if (isDomain) { locTd.innerHTML = \`<span class="badge" style="background:rgba(175,82,222,0.1);color:#af52de;margin-right:4px;">CNAME</span> \${safeSourceLabel} | 优选域名\`;
            } else {
                const recordLabel = isIPv6 ? '<span class="badge" style="background:rgba(50,173,230,0.1);color:#32ade6;margin-right:4px;">AAAA</span>' : '<span class="badge" style="background:rgba(0,113,227,0.1);color:#0071e3;margin-right:4px;">A记录</span>';
                fetch(\`https://api.ip.sb/geoip/\${encodeURIComponent(queryIp)}\`).then(res => res.json()).then(data => locTd.innerHTML = \`\${recordLabel} \${safeSourceLabel} | \${escapeHtml(data.country || '未知')}\`).catch(() => locTd.innerHTML = \`\${recordLabel} \${safeSourceLabel} | 解析失败\`);
            }
            const start = performance.now();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); 
            const processResult = () => {
                const rawLatency = Math.round(performance.now() - start);
                if (rawLatency > 2000) return markTimeout(latTd, spdTd, tr);
                let displayLatency = rawLatency;
                if (!isIPv6 && !isDomain) {
                    if (rawLatency >= 500) { displayLatency = rawLatency - 400; } 
                    else { const base = 40 + (rawLatency / 500) * 60; displayLatency = Math.floor(base) + Math.floor(Math.random() * 10); }
                }
                updateRowState(latTd, spdTd, displayLatency);
            };
            try { await fetch(\`https://\${ip}/cdn-cgi/trace\`, { mode: 'no-cors', signal: controller.signal }); clearTimeout(timeoutId); processResult();
            } catch (err) { clearTimeout(timeoutId); if (err.name === 'AbortError') markTimeout(latTd, spdTd, tr); else processResult(); }
        }
        function updateRowState(latTd, spdTd, latency) {
            latTd.textContent = latency + ' ms'; latTd.setAttribute('data-ms', latency);
            if (latency < 300) { latTd.style.color = '#34c759'; spdTd.textContent = '🚀 极佳'; spdTd.style.color = '#34c759'; } 
            else if (latency <= 500) { latTd.style.color = 'var(--primary)'; spdTd.textContent = '✅ 正常'; spdTd.style.color = 'var(--primary)'; } 
            else { latTd.style.color = '#ff9500'; spdTd.textContent = '⚠️ 较高'; spdTd.style.color = '#ff9500'; }
        }
        function sortTableByLatency(tbody) {
            const rows = Array.from(tbody.querySelectorAll('.test-row'));
            rows.sort((a, b) => {
                const msA = parseInt(a.querySelector('.latency').getAttribute('data-ms') || 9999);
                const msB = parseInt(b.querySelector('.latency').getAttribute('data-ms') || 9999);
                return msA - msB;
            });
            rows.forEach(row => tbody.appendChild(row));
        }
        async function sendDnsRequest(ips, btnElement) {
            const originalText = btnElement.textContent;
            btnElement.textContent = '🔄 更新 DNS 中...'; btnElement.disabled = true;
            try {
                const res = await fetch('/api/update-dns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ips }) });
                const data = await res.json();
                if(data.success) { showToast(data.message); btnElement.textContent = '✅ 更新成功'; loadDNS(); } 
                else { showToast('❌ 错误: ' + (data.error || '')); btnElement.textContent = originalText; }
            } catch(e) { showToast('❌ 网络异常，请重试'); btnElement.textContent = originalText; } 
            finally { setTimeout(() => { if(btnElement.textContent === '✅ 更新成功') btnElement.textContent = originalText; btnElement.disabled = false; }, 3000); }
        }
        function updateSingleDns(ip, btnElement) {
            if(!confirm(\`确定要将域名解析到：\\n\${ip} \\n警告：这会覆盖域名下的所有解析记录！\`)) return;
            sendDnsRequest([ip], btnElement);
        }
        function updateSelectedToDns() {
            const btn = document.getElementById('btnSelectedDns');
            const ips = getSelectedIps();
            if (ips.length === 0) return showToast('⚠️ 请先勾选您想使用的节点');
            if(!confirm(\`将应用勾选的 \${ips.length} 个节点：\\n\${ips.join('\\n')}\\n确定更新 DNS 记录吗？\`)) return;
            sendDnsRequest(ips, btn);
        }
        function updateTop3ToDns() {
            const btn = document.getElementById('btnTop3Dns');
            const rows = document.querySelectorAll('#testTableBody .test-row');
            let topIps = [];
            for(let i = 0; i < rows.length; i++) {
                const ms = parseInt(rows[i].querySelector('.latency').getAttribute('data-ms'));
                if(ms < 2000) topIps.push(rows[i].querySelector('.ip-text').textContent);
                if(topIps.length === 3) break;
            }
            if(topIps.length === 0) return showToast('⚠️ 没找到可用节点，请先测速');
            if(!confirm(\`将为您分发当前最快的 \${topIps.length} 个节点：\\n\${topIps.join('\\n')}\\n确定更新 DNS 记录吗？\`)) return;
            sendDnsRequest(topIps, btn);
        }
        async function loadDNS() {
            try {
                const res = await fetch('/api/get-dns'); const data = await res.json(); const container = document.getElementById('dnsStatus');
                if (data.success && data.result) {
                    const records = data.result.filter(r => r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME');
                    if (records.length === 0) container.innerHTML = '<span class="badge" style="background:rgba(255,149,0,0.1);color:#ff9500;">暂无解析记录</span>';
                    else container.innerHTML = records.map(r => \`<span class="badge" style="background:rgba(0,113,227,0.1);color:var(--primary);border:1px solid rgba(0,113,227,0.2);">\${escapeHtml(r.type)} | \${escapeHtml(r.content)}</span>\`).join('');
                } else container.innerHTML = \`<span class="badge" style="background:rgba(255,59,48,0.1);color:#ff3b30;">\${escapeHtml(data.error || '获取失败')}</span>\`;
            } catch (e) { document.getElementById('dnsStatus').innerHTML = '<span class="badge" style="background:rgba(255,59,48,0.1);color:#ff3b30;">网络异常</span>'; }
        }
        
        function logout() {
            document.cookie = "admin_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
            window.location.reload();
        }

        // 初始化加载
        loadIcons().then(() => {
            loadDNS();
        });

        // ==========================================
        // 🌟 新增：RTT 实时监测引擎 (每隔 3 秒探测一次)
        // ==========================================
        async function measureRTT() {
            const start = performance.now();
            try {
                // 加上时间戳强制绕过浏览器本地缓存
                await fetch('/__client_rtt__?t=' + Date.now(), { mode: 'no-cors', cache: 'no-store' });
                const rtt = Math.round(performance.now() - start);
                const rttEl = document.getElementById('rttValue');
                const dotEl = document.getElementById('rttDot');
                
                rttEl.textContent = rtt + ' ms';
                
                // 根据延迟改变呼吸灯颜色
                if (rtt < 80) {
                    dotEl.style.background = '#34c759'; dotEl.style.boxShadow = '0 0 8px #34c759';
                    rttEl.style.color = '#34c759';
                } else if (rtt < 200) {
                    dotEl.style.background = '#ff9500'; dotEl.style.boxShadow = '0 0 8px #ff9500';
                    rttEl.style.color = '#ff9500';
                } else {
                    dotEl.style.background = '#ff3b30'; dotEl.style.boxShadow = '0 0 8px #ff3b30';
                    rttEl.style.color = '#ff3b30';
                }
            } catch (e) {
                document.getElementById('rttValue').textContent = '断连';
                document.getElementById('rttDot').style.background = '#ff3b30';
            }
        }
        
        // 先立即执行一次，然后每 3 秒循环探测
        measureRTT();
        setInterval(measureRTT, 3000);

    // 🚀 新增：前端探针自动检测脚本
        async function fetchCfTrace() {
            // Cloudflare 机房代码 -> 国家代码映射
            const coloToCountry = {
                // 亚洲
                NRT:'jp', TYO:'jp', KIX:'jp', NGO:'jp', SEL:'kr', ICN:'kr', PUS:'kr',
                SIN:'sg', HKG:'hk', TPE:'tw', KUL:'my', BKK:'th', MNL:'ph',
                DEL:'in', BOM:'in', CCU:'in', MAA:'in', BLR:'in', HYD:'in',
                DXB:'ae', DUB:'ae', AUH:'ae', SHJ:'ae',
                JNB:'za', CPT:'za', LOS:'ng', KGL:'rw', DOH:'qa',
                // 大洋洲
                SYD:'au', MEL:'au', BNE:'au', PER:'au', AKL:'nz', WLG:'nz',
                // 欧洲
                LHR:'gb', MAN:'gb', LGW:'gb', STN:'gb', BHX:'gb', GLA:'gb',
                FRA:'de', MUC:'de', BER:'de', DTM:'de', HAM:'de',
                AMS:'nl', CDG:'fr', PAR:'fr', LYS:'fr', MRS:'fr',
                MAD:'es', BCN:'es', AGP:'es', VAL:'es',
                FCO:'it', ROM:'it', MIL:'it', NAP:'it', TRN:'it',
                ZRH:'ch', GVA:'ch', BSL:'ch',
                VIE:'at', WAR:'pl', PRG:'cz', CPH:'dk', STO:'se', ARN:'se',
                OSL:'no', HEL:'fi', DUB:'ie', LIS:'pt', OPO:'pt',
                ATH:'gr', IST:'tr', SAW:'tr',
                // 北美洲
                LAX:'us', SFO:'us', SEA:'us', PDX:'us', LAS:'us',
                ORD:'us', MSP:'us', ATL:'us', IAH:'us', BNA:'us',
                DFW:'us', DEN:'us', PHX:'us', IND:'us', OKC:'us',
                JFK:'us', NYC:'us', BOS:'us', IAD:'us', DCA:'us',
                MIA:'us', TPA:'us', MSY:'us', PHL:'us', CLT:'us',
                SJC:'us', SAT:'us', AUS:'us', SAN:'us', STL:'us',
                MCI:'us', OMA:'us', MEM:'us', JAX:'us', PIT:'us',
                CLE:'us', CMH:'us', RIC:'us', RDU:'us', ABQ:'us',
                SLC:'us', SMF:'us', FSD:'us', BUF:'us', ANC:'us',
                HNL:'us', BGR:'us', ORF:'us', TLH:'us',
                YYZ:'ca', YVR:'ca', YUL:'ca', YYC:'ca', YEG:'ca',
                YOW:'ca', YHZ:'ca', YWG:'ca', YXE:'ca', YQM:'ca',
                MEX:'mx', GDL:'mx', MTY:'mx', CUN:'mx',
                LIM:'pe', BOG:'co', MDE:'co', SCL:'cl', EZE:'ar',
                GYE:'ec', UIO:'ec', HAV:'cu', SDQ:'do', SJO:'cr',
                PTY:'pa', GRU:'br', BSB:'br', SSA:'br', FOR:'br', REC:'br',
                VCP:'br', GIG:'br', POA:'br', CWB:'br', MCO:'br',
                MVD:'uy',
                // 中国大陆
                PEK:'cn', PVG:'cn', CAN:'cn', SZX:'cn', CTU:'cn',
                NKG:'cn', XIY:'cn', HAK:'cn', SYX:'cn', WXN:'cn',
                NJN:'cn', TYN:'cn', TSN:'cn', CKG:'cn',
                NBO:'ke', KTM:'np', RGN:'mm', CMB:'lk', KHI:'pk', LHE:'pk', ISB:'pk'
            };

            try {
                const res = await fetch('/api/trace');
                const data = await res.json();
                if (data.success) {
                    // 访客入口 - 用 entryCountry (CN) 显示国旗
                    const entryFlag = "<i class='fi fi-" + data.entryCountry.toLowerCase() + "' style='display:inline-block;width:18px;height:14px;vertical-align:middle;margin-right:4px;border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,0.3);'></i>";
                    document.getElementById('trace-entry').innerHTML = entryFlag + data.entryCountry + ' ' + (data.entryCity || '') + ' (' + data.entryColo + ')';

                    // 落地机房 - 显示国旗
                    const egressElem = document.getElementById('trace-egress');
                    const cc = coloToCountry[data.egressColo] || 'un';
                    const egressFlag = "<i class='fi fi-" + cc + "' style='display:inline-block;width:18px;height:14px;vertical-align:middle;margin-right:4px;border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,0.3);'></i>";
                    egressElem.innerHTML = egressFlag + data.egressColo;

                    // 如果入口和落地不一致，显示高亮
                    if (data.entryColo !== data.egressColo && data.egressColo !== '探测中...' && data.egressColo !== '获取失败') {
                        egressElem.style.color = '#ff9500';
                        egressElem.innerHTML = egressFlag + data.egressColo + " <span style='font-size:12px;color:var(--text-muted);'>(智能放置/回源)</span>";
                    }
                }
            } catch(e) {
                document.getElementById('trace-entry').innerHTML = '获取超时';
                document.getElementById('trace-egress').innerHTML = '获取超时';
            }
        }
        
        // 当网页加载完成时，延迟0.5秒执行探针扫描（避免卡顿主页渲染）
        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(fetchCfTrace, 500);
            loadWithGuard(); // 节点列表在首页加载时就要获取（带超时兜底重试）
        });
    // 🚀 新增：全云厂商节点数据库 (包含 Cloudflare 支持的所有主要区域)
        var cfRegions = {
            aws: [
                { label: "🇭🇰 中国香港", value: "aws:ap-east-1" },
                { label: "🇯🇵 日本 (东京)", value: "aws:ap-northeast-1" },
                { label: "🇯🇵 日本 (大阪)", value: "aws:ap-northeast-3" },
                { label: "🇸🇬 新加坡", value: "aws:ap-southeast-1" },
                { label: "🇰🇷 韩国 (首尔)", value: "aws:ap-northeast-2" },
                { label: "🇺🇸 美国西部 (加州)", value: "aws:us-west-1" },
                { label: "🇺🇸 美国西部 (俄勒冈)", value: "aws:us-west-2" },
                { label: "🇺🇸 美国东部 (弗吉尼亚)", value: "aws:us-east-1" },
                { label: "🇦🇺 澳大利亚 (悉尼)", value: "aws:ap-southeast-2" },
                { label: "🇮🇳 印度 (孟买)", value: "aws:ap-south-1" },
                { label: "🇬🇧 英国 (伦敦)", value: "aws:eu-west-2" },
                { label: "🇩🇪 德国 (法兰克福)", value: "aws:eu-central-1" }
            ],
            gcp: [
                { label: "🇹🇼 中国台湾 (彰化)", value: "gcp:asia-east1" },
                { label: "🇭🇰 中国香港", value: "gcp:asia-east2" },
                { label: "🇯🇵 日本 (东京)", value: "gcp:asia-northeast1" },
                { label: "🇯🇵 日本 (大阪)", value: "gcp:asia-northeast2" },
                { label: "🇰🇷 韩国 (首尔)", value: "gcp:asia-northeast3" },
                { label: "🇸🇬 新加坡", value: "gcp:asia-southeast1" },
                { label: "🇺🇸 美国西部 (洛杉矶)", value: "gcp:us-west2" },
                { label: "🇺🇸 美国西部 (俄勒冈)", value: "gcp:us-west1" },
                { label: "🇺🇸 美国东部 (弗吉尼亚)", value: "gcp:us-east4" },
                { label: "🇦🇺 澳大利亚 (悉尼)", value: "gcp:australia-southeast1" },
                { label: "🇬🇧 英国 (伦敦)", value: "gcp:europe-west2" },
                { label: "🇩🇪 德国 (法兰克福)", value: "gcp:europe-west3" }
            ],
            azure: [
                { label: "🇭🇰 中国香港 (East Asia)", value: "azure:eastasia" },
                { label: "🇸🇬 新加坡 (Southeast Asia)", value: "azure:southeastasia" },
                { label: "🇯🇵 日本东部 (东京)", value: "azure:japaneast" },
                { label: "🇯🇵 日本西部 (大阪)", value: "azure:japanwest" },
                { label: "🇰🇷 韩国中部 (首尔)", value: "azure:koreacentral" },
                { label: "🇺🇸 美国西部 (West US)", value: "azure:westus" },
                { label: "🇺🇸 美国东部 (East US)", value: "azure:eastus" },
                { label: "🇬🇧 英国南部 (伦敦)", value: "azure:uksouth" },
                { label: "🇳🇱 西欧 (荷兰)", value: "azure:westeurope" }
            ]
        };

        // 🚀 新增：联动菜单处理逻辑
        function handleModeChange() {
            var mode = document.getElementById('cf-mode-select').value;
            var regionSelect = document.getElementById('cf-region-select');
            var customInput = document.getElementById('cf-custom-input');
            
            regionSelect.style.display = 'none';
            customInput.style.display = 'none';
            
            if (mode === 'aws' || mode === 'gcp' || mode === 'azure') {
                regionSelect.style.display = 'block';
                regionSelect.innerHTML = ''; 
                var regions = cfRegions[mode];
                regions.forEach(function(r) {
                    var opt = document.createElement('option');
                    opt.value = r.value;
                    opt.innerText = r.label;
                    regionSelect.appendChild(opt);
                });
            } else if (mode === 'custom') {
                customInput.style.display = 'block';
            }
        }

        // 🚀 新增：调用部署修改接口
        async function updatePlacement() {
            var statusElem = document.getElementById('place-status');
            var modeVal = document.getElementById('cf-mode-select').value;
            var placementPayload = {};
            
            if (modeVal === 'aws' || modeVal === 'gcp' || modeVal === 'azure') {
                var regionVal = document.getElementById('cf-region-select').value;
                placementPayload = { region: regionVal };
            } else if (modeVal === 'custom') {
                var customVal = document.getElementById('cf-custom-input').value;
                if (!customVal || customVal.trim() === '') {
                    statusElem.innerText = "❌ 请填写自定义区域代码（如 gcp:asia-east2）";
                    statusElem.style.color = "#ff3b30";
                    return;
                }
                placementPayload = { region: customVal.trim() };
            } else {
                placementPayload = JSON.parse(modeVal);
            }

            statusElem.innerText = "⏳ 正在提交请求，请稍候...";
            statusElem.style.color = "#ff9500";
            
            try {
                var res = await fetch('/api/placement', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ placement: placementPayload })
                });
                var data = await res.json();
                if (data.success) {
                    statusElem.innerText = "✅ " + data.msg;
                    statusElem.style.color = "#34c759";
                } else {
                    statusElem.innerText = "❌ " + data.msg;
                    statusElem.style.color = "#ff3b30";
                }
            } catch(e) {
                statusElem.innerText = "❌ 网络错误: " + e.message;
                statusElem.style.color = "#ff3b30";
            }
        }
    // 🚀 魔法功能：自动继承现有的模式选项 (增强稳定版)
        setTimeout(() => {
            const sourceSelect = document.getElementById('mode');
            const batchSelect = document.getElementById('batch-mode-select');
            if (sourceSelect && batchSelect) {
                batchSelect.innerHTML = sourceSelect.innerHTML;
            }
        }, 100); 

        // 🚀 全选 / 取消全选逻辑
        function toggleSelectAll(checkbox) {
            const checkboxes = document.querySelectorAll('.node-cb');
            checkboxes.forEach(cb => cb.checked = checkbox.checked);
        }

        // 🚀 并发批量修改模式逻辑
        async function batchUpdateModes() {
            const statusElem = document.getElementById('batch-status');
            const newMode = document.getElementById('batch-mode-select').value;

            const selectedPrefixes = Array.from(document.querySelectorAll('.node-cb:checked')).map(cb => cb.value);

            if (selectedPrefixes.length === 0) {
                statusElem.innerText = "⚠️ 请先打勾需要修改的节点！";
                statusElem.style.color = "#ff9500";
                return;
            }

            if (!newMode) {
                statusElem.innerText = "⚠️ 请先选择要修改的模式！";
                statusElem.style.color = "#ff9500";
                return;
            }

            if (!confirm("确定要将勾选的 " + selectedPrefixes.length + " 个节点修改吗？")) return;

            statusElem.innerText = "⏳ 正在修改节点...";
            statusElem.style.color = "var(--primary)";

            try {
                // 构建更新数据
                const updateData = { prefixes: selectedPrefixes, mode: newMode };

                // 使用批量更新 API
                const res = await fetch('/api/routes', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updateData)
                });

                if (!res.ok) throw new Error("批量修改失败");

                statusElem.innerText = "✅ 批量修改成功！";
                statusElem.style.color = "#34c759";
                setTimeout(() => location.reload(), 1000);

            } catch (e) {
                statusElem.innerText = "❌ 失败: " + e.message;
                statusElem.style.color = "#ff3b30";
            }
        }
    async function deployWorker() {
            const codeArea = document.getElementById('codeArea');
            const fileInput = document.getElementById('fileInput');
            let codeContent = codeArea.value;
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                codeContent = await file.text();
            }
            if (!codeContent.trim()) {
                alert('⚠️ 失败：请先粘贴代码，或者选择一个 .js 文件！');
                return;
            }
            if (!confirm('🚨 危险操作确认 🚨\\n\\n你即将强行覆盖当前 Worker 的代码。\\n如果新代码有错误，此面板将会瘫痪，只能去网页后台抢修！\\n\\n确定代码 100% 正确并覆盖吗？')) return;
            const btn = document.getElementById('deployBtn');
            const originalText = btn.innerText;
            btn.innerText = '⏳ 正在与 Cloudflare 通信并部署...';
            btn.disabled = true;
            btn.style.opacity = '0.7';
            try {
                const res = await fetch('/api/deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newCode: codeContent })
                });
                const data = await res.json();
                if (data.success) {
                    alert('🎉 成功！' + data.msg + '\\n\\n点击确定后页面将自动刷新。');
                    window.location.reload(); 
                } else {
                    alert('❌ 部署失败：\\n' + (data.error || '未知错误'));
                }
            } catch (e) {
                alert('🚨 异常：\\n' + e.message);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
        // ==========================================
        // 🟢 在线更新模块
        // ==========================================
        // 这里的变量会自动从代码最顶端的配置区读取注入
        const CURRENT_VERSION = "${CURRENT_VERSION}"; 
        const GITHUB_RAW_URL = "${GITHUB_RAW_URL}"; 
        
        let latestCode = ""; 

        function extractVersionFromCode(codeText) {
            if (typeof codeText !== 'string' || !codeText) return null;
            const versionCommentMatch = codeText.match(/^\\s*\\/\\/\\s*VERSION:\\s*([0-9]+(?:\\.[0-9]+)+)\\s*$/m);
            if (versionCommentMatch) return versionCommentMatch[1];
            const currentVersionMatch = codeText.match(/CURRENT_VERSION\\s*=\\s*['"]([0-9]+(?:\\.[0-9]+)+)['"]/);
            if (currentVersionMatch) return currentVersionMatch[1];
            return null;
        }

        async function checkForUpdates() {
            try {
                const res = await fetch(GITHUB_RAW_URL + '?t=' + new Date().getTime());
                if (!res.ok) return;
                latestCode = await res.text();
                const latestVersion = extractVersionFromCode(latestCode);

                if (latestVersion && latestVersion !== CURRENT_VERSION) {
                    document.getElementById('updateAlert').style.display = 'block';
                    document.getElementById('updateMsg').innerText = '当前版本: v' + CURRENT_VERSION + ' | 发现最新版本: v' + latestVersion + ' (Github)';
                }
            } catch (e) {
                console.log("检测更新失败:", e);
            }
        }

        async function doOnlineUpdate() {
            if (!confirm('🚀 确定要从 GitHub 拉取最新版本并覆盖当前节点吗？\\n\\n（这将会保留你的所有环境变量和数据库绑定）')) return;
            
            const btn = document.getElementById('onlineUpdateBtn');
            btn.innerText = '⏳ 正在拉取并部署...';
            btn.disabled = true;
            btn.style.opacity = '0.7';

            try {
                // 直接复用我们之前写好的防丢数据库高级 API
                const res = await fetch('/api/deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newCode: latestCode })
                });
                const data = await res.json();
                if (data.success) {
                    alert('🎉 在线更新成功！\\n\\n点击确定后页面将自动刷新，畅享新版本！');
                    window.location.reload(); 
                } else {
                    alert('❌ 更新失败：\\n' + (data.error || '未知错误'));
                }
            } catch (e) {
                alert('🚨 异常：\\n' + e.message);
            } finally {
                btn.innerText = '🚀 一键拉取并升级';
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }

        // 页面加载完成后自动在后台静默检测更新
        document.addEventListener('DOMContentLoaded', checkForUpdates);
    </script>
</body>
</html>
`;

// ==========================================
// 2. 后端 Worker 主逻辑处理区 (核心故障转移 + TG Bot播报 + 智能流量拉取)
// ==========================================

async function getCFTrafficBytes(env, type) {
    if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) return "缺少变量";
    try {
        const end = new Date();
        let graphqlQuery = {};

        if (type === 'today') {
            // 【今日流量】查询：从北京时间今日 00:00 算起，使用 AdaptiveGroups
            // 1. 获取北京时间并清零时分秒
            const beijingTime = new Date(end.getTime() + 8 * 3600000);
            beijingTime.setUTCHours(0, 0, 0, 0);
            // 2. 转回 UTC 供 API 查询
            const start = new Date(beijingTime.getTime() - 8 * 3600000);
            
            graphqlQuery = {
                query: `
                query {
                  viewer {
                    zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
                      httpRequestsAdaptiveGroups(
                        limit: 1,
                        filter: {
                          datetime_geq: "${start.toISOString()}",
                          datetime_leq: "${end.toISOString()}"
                        }
                      ) {
                        sum {
                          edgeResponseBytes
                        }
                      }
                    }
                  }
                }`
            };
        } else {
            // 【7天、30天】查询：传入数字代表天数，使用 1dGroups
            const start = new Date(end.getTime() - type * 24 * 3600000);
            const dateGeq = start.toISOString().split('T')[0];
            const dateLeq = end.toISOString().split('T')[0];
            graphqlQuery = {
                query: `
                query {
                  viewer {
                    zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
                      httpRequests1dGroups(
                        limit: 10000,
                        filter: {
                          date_geq: "${dateGeq}",
                          date_leq: "${dateLeq}"
                        }
                      ) {
                        sum {
                          bytes
                        }
                      }
                    }
                  }
                }`
            };
        }

        const cfRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${env.CF_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(graphqlQuery)
        });
        
        const cfData = await cfRes.json();
        
        if (cfData.errors && cfData.errors.length > 0) {
            return formatCloudflareApiError(cfData.errors, cfRes.status, '查询 Cloudflare Analytics');
        }
        
        const zones = cfData?.data?.viewer?.zones;
        let totalBytes = 0;

        if (zones && zones.length > 0) {
            if (type === 'today' && zones[0].httpRequestsAdaptiveGroups) {
                totalBytes = zones[0].httpRequestsAdaptiveGroups[0]?.sum?.edgeResponseBytes || 0;
            } else if (type !== 'today' && zones[0].httpRequests1dGroups) {
                // 将多天的 bytes 聚合累加
                zones[0].httpRequests1dGroups.forEach(g => { totalBytes += (g.sum.bytes || 0); });
            }
        }

        return totalBytes;
    } catch(e) {
        return "请求异常";
    }
}

async function getCachedCFTrafficBytes(env, type) {
    const key = `${env.CF_ZONE_ID || ''}:${type}`;
    const cached = getMemoryCache(CF_TOTAL_TRAFFIC_CACHE, key);
    if (typeof cached === 'number') return cached;

    const result = await getCFTrafficBytes(env, type);
    if (typeof result === 'number') {
        setMemoryCache(CF_TOTAL_TRAFFIC_CACHE, key, result, GRAPHQL_TRAFFIC_CACHE_TTL_MS);
    }
    return result;
}

// getCFTraffic 使用顶部工具区的 formatBytes 函数
async function getCFTraffic(env, type) {
    const result = await getCachedCFTrafficBytes(env, type);
    if (typeof result !== 'number') return result;
    return result === 0 ? '0 B' : formatBytes(result);
}

function clearRoutesCache(prefix = null) {
    if (prefix) {
        ROUTE_BY_PREFIX_CACHE.delete(prefix);
        return;
    }
    ROUTE_BY_PREFIX_CACHE.clear();
}

async function getCachedRouteByPrefix(env, prefix) {
    const cached = getMemoryCache(ROUTE_BY_PREFIX_CACHE, prefix);
    if (cached !== undefined) return cached;
    if (!env.DB) return null;

    const route = await env.DB.prepare(`SELECT target, mode, cache_img FROM routes WHERE prefix = ?`).bind(prefix).first();
    setMemoryCache(ROUTE_BY_PREFIX_CACHE, prefix, route || null, ROUTE_CACHE_TTL_MS);
    return route || null;
}

function setGeneralProxyEnabledCache(enabled) {
    return setMemoryCache(GENERAL_PROXY_ENABLED_CACHE, 'general_proxy_enabled', !!enabled, SETTINGS_CACHE_TTL_MS);
}

async function getGeneralProxyEnabledCached(env) {
    const cached = getMemoryCache(GENERAL_PROXY_ENABLED_CACHE, 'general_proxy_enabled');
    if (typeof cached === 'boolean') return cached;

    let enabled = ALLOW_GENERAL_PROXY;
    if (env.DB) {
        try {
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
            const result = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('general_proxy_enabled').first();
            if (result && result.value !== null) enabled = result.value === 'true';
        } catch(e) {
            console.error('D1读取通用反代状态失败，使用默认值:', e);
        }
    } else if (env.SETTINGS) {
        try {
            const kvValue = await env.SETTINGS.get('general_proxy_enabled');
            if (kvValue !== null) enabled = kvValue === 'true';
        } catch(e) {
            console.error('KV读取通用反代状态失败，使用默认值:', e);
        }
    }
    return setGeneralProxyEnabledCache(enabled);
}

function escapeTelegramHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

function truncateTelegramText(value, maxLength = 88) {
    const text = String(value ?? '');
    if (text.length <= maxLength) return text;
    return text.slice(0, Math.max(0, maxLength - 1)) + '…';
}

const TG_COLO_LOCATIONS = {
    SJC: { country: 'US', city: '圣何塞' },
    LAX: { country: 'US', city: '洛杉矶' },
    SFO: { country: 'US', city: '旧金山' },
    SEA: { country: 'US', city: '西雅图' },
    DFW: { country: 'US', city: '达拉斯' },
    ORD: { country: 'US', city: '芝加哥' },
    IAD: { country: 'US', city: '华盛顿' },
    JFK: { country: 'US', city: '纽约' },
    BOS: { country: 'US', city: '波士顿' },
    MIA: { country: 'US', city: '迈阿密' },
    NRT: { country: 'JP', city: '东京' },
    TYO: { country: 'JP', city: '东京' },
    KIX: { country: 'JP', city: '大阪' },
    NGO: { country: 'JP', city: '名古屋' },
    ICN: { country: 'KR', city: '首尔' },
    SEL: { country: 'KR', city: '首尔' },
    HKG: { country: 'HK', city: '香港' },
    TPE: { country: 'TW', city: '台北' },
    SIN: { country: 'SG', city: '新加坡' },
    FRA: { country: 'DE', city: '法兰克福' },
    MUC: { country: 'DE', city: '慕尼黑' },
    AMS: { country: 'NL', city: '阿姆斯特丹' },
    CDG: { country: 'FR', city: '巴黎' },
    PAR: { country: 'FR', city: '巴黎' },
    LHR: { country: 'GB', city: '伦敦' },
    MAD: { country: 'ES', city: '马德里' },
    SYD: { country: 'AU', city: '悉尼' },
    MEL: { country: 'AU', city: '墨尔本' },
    AKL: { country: 'NZ', city: '奥克兰' },
    YYZ: { country: 'CA', city: '多伦多' },
    YVR: { country: 'CA', city: '温哥华' },
    YUL: { country: 'CA', city: '蒙特利尔' },
    PEK: { country: 'CN', city: '北京' },
    PVG: { country: 'CN', city: '上海' },
    CAN: { country: 'CN', city: '广州' },
    SZX: { country: 'CN', city: '深圳' },
    CTU: { country: 'CN', city: '成都' },
    NKG: { country: 'CN', city: '南京' }
};

const TG_CITY_NAME_ZH = {
    taizhou: '泰州',
    nanjing: '南京',
    beijing: '北京',
    shanghai: '上海',
    guangzhou: '广州',
    shenzhen: '深圳',
    chengdu: '成都',
    hangzhou: '杭州',
    suzhou: '苏州',
    wuxi: '无锡',
    changzhou: '常州',
    nantong: '南通',
    yangzhou: '扬州',
    zhenjiang: '镇江',
    xuzhou: '徐州',
    yancheng: '盐城',
    huaian: '淮安',
    lianyungang: '连云港',
    suqian: '宿迁',
    kunshan: '昆山',
    wuhan: '武汉',
    xian: '西安',
    xi_an: '西安',
    zhengzhou: '郑州',
    changsha: '长沙',
    chongqing: '重庆',
    tianjin: '天津',
    qingdao: '青岛',
    jinan: '济南',
    ningbo: '宁波',
    xiamen: '厦门',
    fuzhou: '福州',
    dongguan: '东莞',
    foshan: '佛山',
    zhuhai: '珠海',
    tokyo: '东京',
    osaka: '大阪',
    seoul: '首尔',
    singapore: '新加坡',
    hongkong: '香港',
    taipei: '台北',
    bangkok: '曼谷',
    kualalumpur: '吉隆坡',
    dubai: '迪拜',
    frankfurt: '法兰克福',
    munich: '慕尼黑',
    amsterdam: '阿姆斯特丹',
    paris: '巴黎',
    london: '伦敦',
    madrid: '马德里',
    sydney: '悉尼',
    melbourne: '墨尔本',
    auckland: '奥克兰',
    toronto: '多伦多',
    vancouver: '温哥华',
    montreal: '蒙特利尔',
    newyork: '纽约',
    washington: '华盛顿',
    chicago: '芝加哥',
    dallas: '达拉斯',
    seattle: '西雅图',
    losangeles: '洛杉矶',
    sanfrancisco: '旧金山',
    sanjose: '圣何塞',
    boston: '波士顿',
    miami: '迈阿密'
};

function getCountryNameZh(countryCode) {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!code) return '未知';
    try {
        const displayNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
        return displayNames.of(code) || code;
    } catch (e) {
        const fallback = {
            CN: '中国',
            US: '美国',
            JP: '日本',
            KR: '韩国',
            HK: '中国香港',
            TW: '中国台湾',
            SG: '新加坡',
            DE: '德国',
            FR: '法国',
            GB: '英国',
            AU: '澳大利亚',
            CA: '加拿大'
        };
        return fallback[code] || code;
    }
}

function countryCodeToFlagEmoji(countryCode) {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '';
    return String.fromCodePoint(...code.split('').map(ch => 127397 + ch.charCodeAt(0)));
}

function translateCityNameZh(city) {
    const text = String(city || '').trim();
    if (!text) return '';
    if (/[\u4e00-\u9fff]/.test(text)) return text;
    const normalized = text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/['`]/g, '')
        .replace(/[\s-]+/g, '')
        .replace(/[^a-z]/g, '');
    return TG_CITY_NAME_ZH[normalized] || text;
}

function formatVisitorSource(ip, country, city) {
    const safeIp = String(ip || 'Unknown');
    const countryName = getCountryNameZh(country);
    const cityName = translateCityNameZh(city);
    const flag = countryCodeToFlagEmoji(country);
    const regionText = cityName ? `${countryName}-${cityName}` : countryName;
    return `${flag}${regionText} · ${safeIp}`;
}

function formatWorkerColoLabel(colo) {
    const key = String(colo || '').trim().toUpperCase();
    if (key === '获取失败') return '⚠️ 获取失败';
    const mapped = TG_COLO_LOCATIONS[key];
    if (mapped) {
        const flag = countryCodeToFlagEmoji(mapped.country);
        return `${flag}${getCountryNameZh(mapped.country)}-${mapped.city}`;
    }
    return key || '未知';
}

function formatMsStatus(ms) {
    if (!Number.isFinite(ms) || ms < 0) return { icon: '🔴', text: '超时' };
    if (ms < 200) return { icon: '🟢', text: `${ms}MS` };
    if (ms < 500) return { icon: '🔵', text: `${ms}MS` };
    if (ms < 1000) return { icon: '🟡', text: `${ms}MS` };
    return { icon: '🔴', text: `${ms}MS` };
}

async function probeWorkerColoStatus() {
    const controller = new AbortController();
    let timeoutId = null;
    const startedAt = Date.now();
    try {
        timeoutId = setTimeout(() => controller.abort(), 2500);
        const response = await fetch('https://1.1.1.1/cdn-cgi/trace', {
            headers: { 'User-Agent': 'Mozilla/5.0 (CF-Worker-Trace)' },
            signal: controller.signal
        });
        const traceText = await response.text();
        const match = traceText.match(/^colo=([A-Z]+)/m);
        const colo = match ? match[1] : '未知';
        return { colo, ms: Date.now() - startedAt };
    } catch (e) {
        return { colo: '获取失败', ms: -1 };
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function buildProxyNodeUrl(proxyOrigin, prefix) {
    const safeOrigin = String(proxyOrigin || '').replace(/\/+$/, '');
    const safePrefix = String(prefix || '').replace(/^\/+/, '');
    return safeOrigin && safePrefix ? `${safeOrigin}/${safePrefix}` : safePrefix;
}

function formatTelegramLatency(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
        return { icon: '🔴', text: '断连/超时' };
    }
    if (ms < 200) {
        return { icon: '🟢', text: `${ms}ms` };
    }
    if (ms < 500) {
        return { icon: '🔵', text: `${ms}ms` };
    }
    if (ms < 1000) {
        return { icon: '🟡', text: `${ms}ms` };
    }
    return { icon: '🔴', text: `${ms}ms` };
}

function parseStoredBeijingTimestamp(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || '0');
    return Date.UTC(year, month - 1, day, hour - 8, minute, second);
}

function formatRelativeLastPlay(lastPlay, now = Date.now()) {
    if (!lastPlay) return '🆕 从未播放';
    const playedAt = parseStoredBeijingTimestamp(lastPlay);
    if (!playedAt || Number.isNaN(playedAt)) return String(lastPlay);
    const diffMs = Math.max(0, now - playedAt);
    const totalMinutes = Math.floor(diffMs / 60000);
    if (totalMinutes <= 0) return '刚刚';
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}天${hours}小时${minutes}分钟前`;
    if (hours > 0) return `${hours}小时${minutes}分钟前`;
    return `${minutes}分钟前`;
}

function describeTrafficTrend(currentBytes, baselineBytes) {
    const current = Number(currentBytes) || 0;
    const baseline = Number(baselineBytes) || 0;
    if (baseline <= 0) return current > 0 ? '↑ 高于7日均值' : '→ 接近7日均值';
    const ratio = current / baseline;
    if (ratio >= 1.15) return '↑ 高于7日均值';
    if (ratio <= 0.85) return '↓ 低于7日均值';
    return '→ 接近7日均值';
}

async function probeNodeLatency(target, timeoutMs = 2000) {
    if (!target) return -1;
    const startedAt = Date.now();
    const controller = new AbortController();
    let timeoutId = null;
    try {
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        await fetch(target + '/', { method: 'HEAD', signal: controller.signal });
        return Date.now() - startedAt;
    } catch (e) {
        return -1;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

async function callTelegramApi(env, method, payload) {
    const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
        throw new Error(data?.description || `Telegram API ${method} failed`);
    }
    return data;
}

async function answerTgCallback(env, callbackQueryId, text = '') {
    if (!env.TG_BOT_TOKEN || !callbackQueryId) return;
    try {
        await callTelegramApi(env, 'answerCallbackQuery', text
            ? { callback_query_id: callbackQueryId, text }
            : { callback_query_id: callbackQueryId });
    } catch (e) {
        console.error('TG Callback Answer Error:', e);
    }
}

// TG 消息发送辅助函数
async function sendTgMessage(env, chatId, text, messageId = null, extraKeyboard = null) {
    try {
        let keyboard = extraKeyboard;
        if (!keyboard) {
            keyboard = [[{ text: '🔄 刷新数据', callback_data: 'refresh_stats' }]];
        }

        const payload = messageId
            ? { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
                reply_markup: JSON.stringify({ inline_keyboard: keyboard })}
            : { chat_id: chatId, text, parse_mode: 'HTML',
                reply_markup: JSON.stringify({ inline_keyboard: keyboard })};
        await callTelegramApi(env, messageId ? 'editMessageText' : 'sendMessage', payload);
    } catch (e) {
        console.error('TG Send Error:', e);
    }
}

// TG 消息问候语工具函数
function getGreeting(now = Date.now()) {
    const h = new Date(now + 8 * 3600000).getHours();
    if (h < 12) return '☀️ 早上好';
    if (h < 18) return '☕ 下午好';
    return '🌙 晚上好';
}

function buildTgNodeStatusMessage(routes, page, proxyOrigin, latencyByPrefix, now = Date.now()) {
    const pageSize = 5;
    const total = routes.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const start = (currentPage - 1) * pageSize;
    const pageItems = routes.slice(start, start + pageSize);

    const lines = pageItems.map((r, index) => {
        const serial = start + index + 1;
        const name = escapeTelegramHtml(r.remark || r.prefix);
        const proxyUrl = buildProxyNodeUrl(proxyOrigin, r.prefix || '');
        const latency = formatTelegramLatency(latencyByPrefix?.[r.prefix] ?? -1);
        const linkLabel = escapeTelegramHtml(String(r.prefix || '').replace(/^\/+/, '') || '-');
        const directLink = proxyUrl
            ? `<a href="${escapeTelegramHtml(proxyUrl)}">${linkLabel}</a>`
            : '-';
        const lastPlay = escapeTelegramHtml(formatRelativeLastPlay(r.last_play, now));
        return `│ ${serial}. ${name}\n│    直达: ${directLink}\n│    状态: ${latency.icon} ${latency.text}\n│    末播: ${lastPlay}`;
    });

    const navRow = [];
    if (currentPage > 1) {
        navRow.push({ text: '⬅️ 上一页', callback_data: `node_status:${currentPage - 1}` });
    }
    if (currentPage < totalPages) {
        navRow.push({ text: '下一页 ➡️', callback_data: `node_status:${currentPage + 1}` });
    }

    const keyboard = [];
    if (navRow.length) keyboard.push(navRow);
    keyboard.push([{ text: '🔙 返回统计', callback_data: 'back_to_stats' }]);

    const message =
        `<b>${getGreeting(now)}，节点状态如下</b>\n` +
        `━━━━━━━━━━━━━━━━\n\n` +
        `╭ 📊 节点列表 (${total}) ╮\n` +
        `│ 共 ${total} 个节点 · 当前第 ${currentPage}/${totalPages} 页\n` +
        `│ 每页 5 个\n` +
        lines.join('\n') + '\n' +
        `╰─────────────╯\n\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `⏱️ ${fmtTime(now)}`;

    return { message, keyboard, currentPage, totalPages };
}

// 节点状态播报
async function sendTgNodeStatus(env, chatId, messageId = null, page = 1, proxyOrigin = '') {
    try {
        if (!env.DB) {
            await sendTgMessage(env, chatId, '❌ 数据库未绑定');
            return;
        }

        const routes = await env.DB.prepare(`SELECT prefix, remark, target, mode, last_play FROM routes ORDER BY sort_order ASC, prefix ASC`).all();
        if (!routes?.results?.length) {
            await sendTgMessage(env, chatId, '📭 暂无配置节点');
            return;
        }

        const resolvedProxyOrigin = String(proxyOrigin || '').replace(/\/+$/, '') || (env.CF_DOMAIN ? `https://${env.CF_DOMAIN}` : '');
        const pageSize = 5;
        const totalPages = Math.max(1, Math.ceil(routes.results.length / pageSize));
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const start = (currentPage - 1) * pageSize;
        const pageItems = routes.results.slice(start, start + pageSize);
        const latencyEntries = await Promise.all(pageItems.map(async route => {
            const targets = String(route.target || '').split(',').map(s => s.trim()).filter(Boolean);
            const latency = await probeNodeLatency(targets[0] || '');
            return [route.prefix, latency];
        }));
        const latencyByPrefix = Object.fromEntries(latencyEntries);
        const { message, keyboard } = buildTgNodeStatusMessage(routes.results, currentPage, resolvedProxyOrigin, latencyByPrefix, Date.now());

        if (messageId) {
            await callTelegramApi(env, 'editMessageCaption', {
                chat_id: chatId,
                message_id: messageId,
                caption: message,
                parse_mode: 'HTML',
                reply_markup: JSON.stringify({ inline_keyboard: keyboard })
            });
        } else {
            await sendTgMessage(env, chatId, message, null, keyboard);
        }
    } catch (e) {
        console.error('TG NodeStatus Error:', e);
    }
}

// 访客详情播报
async function sendTgVisitorDetail(env, chatId, messageId = null) {
    try {
        if (!env.DB) {
            await sendTgMessage(env, chatId, '❌ 数据库未绑定');
            return;
        }

        // 使用全局 DATE_FILTER_CST（北京时间当天）
        const [todayQuery, weekQuery, topUasQuery, topPathsQuery] = await Promise.all([
            env.DB.prepare(`SELECT COUNT(*) as c FROM visitor_logs WHERE ${DATE_FILTER_CST}`).first(),
            env.DB.prepare(`SELECT COUNT(*) as c FROM visitor_logs WHERE timestamp >= datetime('now', '-7 days', '+8 hours')`).first(),
            env.DB.prepare(`SELECT ua, COUNT(*) as c FROM visitor_logs WHERE ${DATE_FILTER_CST} AND ua != 'Unknown' GROUP BY ua ORDER BY c DESC LIMIT 5`).all(),
            env.DB.prepare(`
                SELECT r.remark, COUNT(v.id) as c
                FROM visitor_logs v
                LEFT JOIN routes r ON v.prefix = r.prefix
                WHERE ${DATE_FILTER_CST.replace(/timestamp/g, 'v.timestamp')}
                GROUP BY v.prefix
                ORDER BY c DESC LIMIT 5
            `).all()
        ]);

        const today = todayQuery?.c ?? 0;
        const week = weekQuery?.c ?? 0;
        const avgDaily = Math.round(week / 7);

        // Top UA - 使用可选链简化判断
        const uaLines = topUasQuery?.results?.length > 0
            ? topUasQuery.results.map((r, i) => {
                const icon = r.ua?.toLowerCase().includes('emby') ? '📺' :
                             r.ua?.toLowerCase().includes('jellyfin') ? '🎬' :
                             r.ua?.toLowerCase().includes('chrome') ? '🌐' : '📱';
                const name = r.ua?.length > 30 ? r.ua.substring(0, 30) + '...' : r.ua;
                return `│ ${i + 1}. ${icon} ${name}   ${r.c}次`;
            }).join('\n')
            : '│ 暂无记录';

        // Top paths - 使用可选链简化判断
        const pathLines = topPathsQuery?.results?.length > 0
            ? topPathsQuery.results.map((r, i) => `│ ${i + 1}. ${r.remark || r.prefix}   ${r.c}次`).join('\n')
            : '│ 暂无记录';

        const now = Date.now();

        const msg =
            `${getGreeting()}，访客详情如下\n` +
            `━━━━━━━━━━━━━━━━\n\n` +
            `╭ 📈 访问概况 ╮\n` +
            `│ 今日访问     ${today} 次\n` +
            `│ 7天访问     ${week} 次\n` +
            `│ 日均访问     ${avgDaily} 次\n` +
            `╰─────────────╯\n\n` +
            `╭ 📱 Top 访问来源 ╮\n` +
            uaLines + '\n' +
            `╰─────────────╯\n\n` +
            `╭ 🚀 Top 访问节点 ╮\n` +
            pathLines + '\n' +
            `╰─────────────╯\n\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `⏱️ ${fmtTime(now)}`;

        const keyboard = [[{ text: '🔙 返回统计', callback_data: 'back_to_stats' }]];

        if (messageId) {
            await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/editMessageCaption`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_id: messageId,
                    caption: msg,
                    parse_mode: 'HTML',
                    reply_markup: JSON.stringify({ inline_keyboard: keyboard })
                })
            });
        } else {
            await sendTgMessage(env, chatId, msg, null, keyboard);
        }
    } catch (e) {
        console.error('TG VisitorDetail Error:', e);
    }
}

// 用于生成 TG 播报消息的核心工具函数 (单面板 + 流量之王统计版 + 客户端软件统计版)
async function sendTgStats(env, chatId, messageId = null) {
    try {
        // 使用 Promise.all 并行查询，提高性能
        const DATE_FILTER_YEST = `timestamp >= datetime('now', '-48 hours', '+8 hours') AND timestamp < datetime('now', '-24 hours', '+8 hours')`;

        const [totalQuery, yesterdayQuery, topRegionQuery, topNodeQuery, topClientQuery, workerColoStatus, routesQuery] = await Promise.all([
            env.DB.prepare(`SELECT COUNT(*) as count FROM visitor_logs WHERE ${DATE_FILTER_CST}`).first(),
            env.DB.prepare(`SELECT COUNT(*) as count FROM visitor_logs WHERE ${DATE_FILTER_YEST}`).first(),
            env.DB.prepare(`
                SELECT ip, country, COALESCE(city, '') as city, COUNT(*) as c
                FROM visitor_logs
                WHERE ${DATE_FILTER_CST}
                GROUP BY ip, country, city
                ORDER BY c DESC
                LIMIT 1
            `).first(),
            env.DB.prepare(`
                SELECT v.prefix, r.remark, COUNT(v.id) as c
                FROM visitor_logs v
                LEFT JOIN routes r ON v.prefix = r.prefix
                WHERE ${DATE_FILTER_CST.replace(/timestamp/g, 'v.timestamp')}
                GROUP BY v.prefix
                ORDER BY c DESC LIMIT 3
            `).all(),
            env.DB.prepare(`
                SELECT ua, COUNT(*) as c
                FROM visitor_logs
                WHERE ${DATE_FILTER_CST}
                AND ua != 'Unknown'
                AND ua IS NOT NULL
                GROUP BY ua
                ORDER BY c DESC LIMIT 5
            `).all(),
            probeWorkerColoStatus(),
            env.DB.prepare(`SELECT prefix, remark FROM routes ORDER BY sort_order ASC, prefix ASC`).all()
        ]);
        
        // 构建客户端统计消息（按观看次数排序）
        let clientStr = "暂无记录";
        if (topClientQuery?.results?.length > 0) {
            // 使用 Map 合并相同客户端名的统计，使用 Map.get() 的默认值简化逻辑
            const clientMap = new Map();
            topClientQuery.results.forEach(row => {
                const clientName = parseClientName(row.ua);
                if (clientName) clientMap.set(clientName, (clientMap.get(clientName) || 0) + row.c);
            });
            
            // 排序后最多显示5个，直接构建字符串
            clientStr = Array.from(clientMap.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([name, count], i) => {
                    const rankEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][i];
                    return `│ ${rankEmoji} ${getClientIcon(name)} ${name} · ${count}次`;
                }).join('\n');
        }
        
        // 获取多时间维度流量
        const [trafficTodayRaw, traffic7dRaw, traffic30dRaw] = await Promise.all([
            getCachedCFTrafficBytes(env, 'today'),
            getCachedCFTrafficBytes(env, 7),
            getCachedCFTrafficBytes(env, 30)
        ]);
        const trafficToday = typeof trafficTodayRaw === 'number' ? (trafficTodayRaw === 0 ? '0 B' : formatBytes(trafficTodayRaw)) : trafficTodayRaw;
        const traffic7d = typeof traffic7dRaw === 'number' ? (traffic7dRaw === 0 ? '0 B' : formatBytes(traffic7dRaw)) : traffic7dRaw;
        const traffic30d = typeof traffic30dRaw === 'number' ? (traffic30dRaw === 0 ? '0 B' : formatBytes(traffic30dRaw)) : traffic30dRaw;

        let bytesByRoute = new Map();
        if (env.CF_API_TOKEN && env.CF_ZONE_ID && env.DB) {
            try {
                const routes = routesQuery?.results || [];
                if (routes && routes.length > 0) {
                    const end = new Date();
                    const beijingTime = new Date(end.getTime() + 8 * 3600000);
                    beijingTime.setUTCHours(0, 0, 0, 0);
                    const start = new Date(beijingTime.getTime() - 8 * 3600000);
                    const endISO = end.toISOString();
                    const startISO = start.toISOString();

                    bytesByRoute = await queryTrafficByPrefixesCached(env, routes, startISO, endISO);
                }
            } catch (e) {
                bytesByRoute = new Map();
            }
        }

        // 使用可选链简化空值判断
        const todayCount = totalQuery?.count ?? 0;
        const yesterdayCount = yesterdayQuery?.count ?? 0;
        const trendStr = (() => {
            if (yesterdayCount === 0) return todayCount > 0 ? '📈 新高' : '➖ 暂无数据';
            const diff = todayCount - yesterdayCount;
            const pct = ((diff / yesterdayCount) * 100).toFixed(1);
            if (diff > 0) return `📈 +${pct}%`;
            if (diff < 0) return `📉 ${pct}%`;
            return '➖ 持平';
        })();
        const totalStr = `${todayCount}次 · ${trendStr}`;
        const regionStr = topRegionQuery
            ? `${escapeTelegramHtml(truncateTelegramText(formatVisitorSource(topRegionQuery.ip, topRegionQuery.country, topRegionQuery.city), 56))} · ${topRegionQuery.c}次`
            : '暂无记录';
        const workerColoStr = escapeTelegramHtml(formatWorkerColoLabel(workerColoStatus?.colo));
        const routes = routesQuery?.results || [];
        const nodeStr = topNodeQuery?.results?.length > 0
            ? topNodeQuery.results.map((r, i) => {
                const rank = ['🥇', '🥈', '🥉'][i];
                const name = truncateTelegramText(r.remark || '未命名节点', 18);
                const trafficText = formatBytes(bytesByRoute.get(r.prefix) || 0);
                return `│ ${rank} ${escapeTelegramHtml(name)} · ${r.c}次 · ${trafficText}`;
            }).join('\n')
            : '暂无记录';
        const avg7dBytes = typeof traffic7dRaw === 'number' ? traffic7dRaw / 7 : null;
        const avg30dBytes = typeof traffic30dRaw === 'number' ? traffic30dRaw / 30 : null;
        const todayTrafficTrend = (typeof trafficTodayRaw === 'number' && avg7dBytes !== null)
            ? describeTrafficTrend(trafficTodayRaw, avg7dBytes)
            : '→ 接近7日均值';
        const weekTrafficTrend = (avg7dBytes !== null && avg30dBytes !== null)
            ? (() => {
                const ratio = avg30dBytes > 0 ? avg7dBytes / avg30dBytes : 0;
                if (avg30dBytes <= 0) return '→ 接近30日均值';
                if (ratio >= 1.15) return '↑ 高于30日均值';
                if (ratio <= 0.85) return '↓ 低于30日均值';
                return '→ 接近30日均值';
            })()
            : '→ 接近30日均值';
        const trafficTodayLine = `${trafficToday} · ${todayTrafficTrend}`;
        const traffic7dLine = `${traffic7d} · ${weekTrafficTrend}`;
        const traffic30dLine = `${traffic30d} · → 长周期稳定`;

        const now = new Date();
        const greeting = getGreeting();

        const msg =
            `<b>${greeting}，运行数据已更新</b>\n` +
            `━━━━━━━━━━━━━━━━\n\n` +
            `╭ 📊 访问统计 ╮\n` +
            `│ 今日播放：${totalStr}\n` +
            `│ 热门访客：${regionStr}\n` +
            `╰─────────────╯\n\n` +
            `╭ 📡Worker 落地机房 ╮\n` +
            `│ ${workerColoStr}\n` +
            `╰─────────────╯\n\n` +
            `╭ 🚀 热门节点 Top3 ╮\n` +
            `${nodeStr}\n` +
            `╰─────────────╯\n\n` +
            `╭ 📱 客户端分布 Top5 ╮\n` +
            `${clientStr}\n` +
            `╰─────────────╯\n\n` +
            `╭ 🌐 流量消耗 ╮\n` +
            `│ 今日：${trafficTodayLine}\n` +
            `│ 7天：${traffic7dLine}\n` +
            `│ 30天：${traffic30dLine}\n` +
            `╰─────────────╯\n\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `⏱️ ${fmtTime(now)} 更新`;

        // 随机壁纸 URL（添加时间戳防止缓存）
        const TOP_IMAGE_URL = `https://t.mwm.moe/pc?t=${Date.now()}`;

        const replyMarkup = JSON.stringify({ inline_keyboard: [
            [{ text: '🔄 刷新数据', callback_data: 'refresh_stats' }, { text: '📊 节点状态', callback_data: 'node_status' }]
        ]});

        if (messageId) {
            // 有 messageId 时用 editMessageCaption（编辑带图片消息的 caption）
            await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/editMessageCaption`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_id: messageId,
                    caption: msg,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup
                })
            });
        } else {
            // 首次发送，用 sendPhoto 带随机壁纸
            await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    photo: TOP_IMAGE_URL,
                    caption: msg,
                    parse_mode: 'HTML',
                    reply_markup: replyMarkup
                })
            });
        }
    } catch (e) {
        console.error("TG Send Error:", e);
    }
}

export default {
    // 每天定时任务：发送 TG 统计 + 清理过期日志
    async scheduled(event, env, ctx) {
        // 发送 TG 统计
        if (env.TG_BOT_TOKEN && env.TG_CHAT_ID && env.DB) {
            ctx.waitUntil(sendTgStats(env, env.TG_CHAT_ID));
        }
        // 每天清理一次过期日志（避免每次请求都执行 DELETE）
        if (env.DB) {
            ctx.waitUntil((async () => {
                try {
                    await env.DB.exec(`DELETE FROM visitor_logs WHERE timestamp < datetime('now', '-7 days')`);
                    console.log('visitor_logs cleanup completed');
                } catch(e) {
                    console.error('visitor_logs cleanup failed:', e.message);
                }
            })());
        }
    },

    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        function getCookie(req, name) {
            const cookieString = req.headers.get("Cookie");
            if (!cookieString) return null;
            const match = cookieString.match(new RegExp('(^| )' + name + '=([^;]+)'));
            if (match) {
                try {
                    return decodeURIComponent(match[2]);
                } catch (e) {
                    return null;
                }
            }
            return null;
        }

        const EXPECTED_TOKEN = env.ADMIN_TOKEN;
        const isPublicEndpoint = request.method === "OPTIONS"
            || url.pathname === '/api/tg-webhook'
            || url.pathname === '/__client_rtt__';
        const isPanelOrApi = url.pathname === '/' || url.pathname.startsWith('/api/');

        if (!isPublicEndpoint) {
            if (!EXPECTED_TOKEN) return new Response("请在 Worker 变量中配置 ADMIN_TOKEN", { status: 500 });
            if (isPanelOrApi) {
                const providedToken = getCookie(request, 'admin_token');
                if (providedToken !== EXPECTED_TOKEN) {
                    if (url.pathname === '/') return new Response(LOGIN_UI, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
                    return new Response('Unauthorized', { status: 401 });
                }
            }
        }

        // ==========================================
        // 🚀 新增：全云厂商 Worker 放置区域接口
        // ==========================================
        if (url.pathname === '/api/placement' && request.method === 'POST') {
            try {
                const body = await request.json();
                const placementData = body.placement; 
                
                if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_WORKER_NAME) {
                    return new Response(JSON.stringify({ success: false, msg: '后台变量未配置全！请检查 CF_API_TOKEN, CF_ACCOUNT_ID, CF_WORKER_NAME' }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
                }
                
                const formData = new FormData();
                formData.append('settings', new Blob([JSON.stringify({ placement: placementData })], { type: 'application/json' }));

                const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${env.CF_WORKER_NAME}/settings`;
                const cfRes = await fetch(cfUrl, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` },
                    body: formData 
                });
                
                const cfData = await cfRes.json();
                if (cfData.success) {
                    return new Response(JSON.stringify({ success: true, msg: '部署区域修改成功！' }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
                } else {
                    return new Response(JSON.stringify({ success: false, msg: formatCloudflareApiError(cfData.errors, cfRes.status, '修改 Worker 放置地区') }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
                }
            } catch(e) {
                return new Response(JSON.stringify({ success: false, msg: e.message }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
            }
        }

        // ==========================================
        // 🚀 新增：CF 节点与落地机房探针接口
        // ==========================================
        if (url.pathname === '/api/trace') {
            const cf = request.cf || {};
            let egressColo = '探测中...';
            try {
                // 请求 CF 官方 trace 接口获取落地机房
                const traceRes = await fetch('https://1.1.1.1/cdn-cgi/trace', {
                    headers: { 'User-Agent': 'Mozilla/5.0 (CF-Worker-Trace)' }
                });
                const traceText = await traceRes.text();
                const match = traceText.match(/colo=([A-Z]+)/);
                if (match) egressColo = match[1];
            } catch(e) {
                egressColo = '获取失败';
            }

            return new Response(JSON.stringify({
                success: true,
                entryCountry: cf.country || '未知',
                entryCity: cf.city || '',
                entryColo: cf.colo || '未知',
                egressColo: egressColo
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        // ==========================================
        // 🚀 通用反代开关控制 API
        // ==========================================
        
        // 获取当前开关状态
        if (url.pathname === '/api/general-proxy-status' && request.method === 'GET') {
            try {
                const enabled = await getGeneralProxyEnabledCached(env);
                
                return new Response(JSON.stringify({
                    success: true,
                    enabled: enabled
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            } catch(e) {
                return new Response(JSON.stringify({
                    success: false,
                    error: e.message
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
        }

        // 切换开关状态
        if (url.pathname === '/api/general-proxy-toggle' && request.method === 'POST') {
            try {
                const body = await request.json();
                const enabled = body.enabled === true;
                
                // 优先保存到 D1 数据库（更可靠）
                if (env.DB) {
                    try {
                        await env.DB.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
                        await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('general_proxy_enabled', enabled.toString()).run();
                    } catch(e) {
                        console.error('D1保存失败:', e);
                        return new Response(JSON.stringify({
                            success: false,
                            error: '数据库保存失败: ' + e.message
                        }), {
                            status: 500,
                            headers: {
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*'
                            }
                        });
                    }
                }
                // 备选：保存到 KV（向后兼容）
                else if (env.SETTINGS) {
                    await env.SETTINGS.put('general_proxy_enabled', enabled.toString());
                }
                setGeneralProxyEnabledCache(enabled);
                
                return new Response(JSON.stringify({
                    success: true,
                    msg: enabled ? '✅ 通用反代功能已开启' : '🔒 通用反代功能已关闭'
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            } catch(e) {
                return new Response(JSON.stringify({
                    success: false,
                    error: e.message
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
        }

        // ==========================================
        // 🌟 新增：客户端 RTT 实时极速探针接口
        // 直接返回 204 无内容，且强制不缓存，确保每次都是真实的物理延迟
        // ==========================================
        if (url.pathname === '/__client_rtt__') {
            return new Response(null, {
                status: 204,
                headers: {
                    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        // Telegram Webhook 拦截
        if (url.pathname === '/api/tg-webhook' && request.method === 'POST') {
            try {
                const body = await request.json();
                const senderChatId = body.message?.chat?.id || body.callback_query?.message?.chat?.id;
                const isAuthorizedChat = env.TG_CHAT_ID && String(senderChatId) === String(env.TG_CHAT_ID);

                // 未授权的 Chat ID 直接忽略
                if (!isAuthorizedChat) {
                    console.log(`Unauthorized TG access attempt from chatId: ${senderChatId}`);
                    return new Response("OK");
                }

                // 处理命令
                if (body.message && body.message.text === '/stats') {
                    if (env.DB && env.TG_BOT_TOKEN) {
                        ctx.waitUntil(sendTgStats(env, body.message.chat.id));
                    }
                }
                // 处理按钮回调
                if (body.callback_query) {
                    const callbackData = body.callback_query.data;
                    const callbackQueryId = body.callback_query.id;
                    const chatId = body.callback_query.message.chat.id;
                    const messageId = body.callback_query.message.message_id;
                    ctx.waitUntil(answerTgCallback(env, callbackQueryId));
                    if (callbackData === 'refresh_stats' && env.DB && env.TG_BOT_TOKEN) {
                        ctx.waitUntil(sendTgStats(env, chatId, messageId));
                    } else if ((callbackData === 'node_status' || callbackData.startsWith('node_status:')) && env.DB && env.TG_BOT_TOKEN) {
                        const page = callbackData === 'node_status'
                            ? 1
                            : Math.max(1, parseInt(callbackData.split(':')[1], 10) || 1);
                        ctx.waitUntil(sendTgNodeStatus(env, chatId, messageId, page, url.origin));
                    } else if (callbackData === 'back_to_stats' && env.DB && env.TG_BOT_TOKEN) {
                        ctx.waitUntil(sendTgStats(env, chatId, messageId));
                    }
                }
                return new Response("OK");
            } catch(e) { return new Response("OK"); }
        }

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "*", "Access-Control-Max-Age": "86400" } });
        }

        if (url.pathname === '/') {
            return new Response(HTML_UI, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
        }

        // ==========================================
        // 2.3 数据大屏统计接口 (Analytics)
        // ==========================================
        if (url.pathname === '/api/analytics' && request.method === 'GET') {
            if (!env.DB) return Response.json({ success: false, error: '未绑定 D1 数据库' });
            try {
                // 并发获取 24小时、7天、30天流量 (通过全新 GraphQL API 规避限制)
                const [trafficToday, traffic7d, traffic30d] = await Promise.all([
                    getCFTraffic(env, 'today'),
                    getCFTraffic(env, 7),
                    getCFTraffic(env, 30)
                ]);

                // 使用 Promise.all 并行查询数据库，提升响应速度
                const [trend, locations, recents] = await Promise.all([
                    env.DB.prepare(`SELECT date(timestamp, '+8 hours') as date, COUNT(*) as count FROM visitor_logs WHERE ${DATE_FILTER_7D} GROUP BY date(timestamp, '+8 hours') ORDER BY date ASC`).all(),
                    env.DB.prepare(`SELECT country, COUNT(*) as count FROM visitor_logs WHERE ${DATE_FILTER_7D} GROUP BY country ORDER BY count DESC`).all(),
                    env.DB.prepare(`SELECT prefix, datetime(timestamp, '+8 hours') as timestamp, ip, country, COALESCE(city, '') as city, ua FROM visitor_logs ORDER BY timestamp DESC LIMIT 20`).all()
                ]);
                
                return Response.json({ 
                    success: true, 
                    trend: trend.results, 
                    locations: locations.results, 
                    recents: recents.results, 
                    trafficToday, traffic7d, traffic30d 
                });
            } catch(e) {
                return Response.json({ success: false, error: e.message });
            }
        }

        // ==========================================
        // 🟢 后端接口：执行代码覆盖更新 (纯JSON接口无损继承：变量、数据库、兼容性、放置地区)
        // ==========================================
        if (url.pathname === '/api/deploy' && request.method === 'POST') {
            const cfToken = env.CF_API_TOKEN;
            const accountId = env.CF_ACCOUNT_ID;
            const workerName = env.CF_WORKER_NAME;
            if (!cfToken || !accountId || !workerName) {
                return Response.json({ success: false, error: '缺少 CF_API_TOKEN, CF_ACCOUNT_ID 或 CF_WORKER_NAME 环境变量' });
            }
            try {
                const body = await request.json();
                if (!body.newCode) return Response.json({ success: false, error: '代码内容为空。' });

                // 1. 🚀 终极修复：调用纯 JSON 的 services 接口获取真实配置，绝对不再崩溃！
                const serviceRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${workerName}`, {
                    headers: { 'Authorization': `Bearer ${cfToken}` }
                });
                const serviceData = await serviceRes.json();
                if (!serviceData.success) {
                    throw new Error(formatCloudflareApiError(serviceData.errors, serviceRes.status, '读取 Worker 配置'));
                }
                
                let compDate = "2024-01-01"; // 依然保留兜底，但这次绝不会用到
                let compFlags = undefined;
                let placement = undefined;

                if (serviceData.success && serviceData.result) {
                    // 精准从 JSON 中提取你原本的配置
                    let scriptInfo = null;
                    if (serviceData.result.default_environment && serviceData.result.default_environment.script) {
                        scriptInfo = serviceData.result.default_environment.script;
                    } else if (serviceData.result.script) {
                        scriptInfo = serviceData.result.script;
                    }
                    
                    if (scriptInfo) {
                        if (scriptInfo.compatibility_date) compDate = scriptInfo.compatibility_date;
                        if (scriptInfo.compatibility_flags) compFlags = scriptInfo.compatibility_flags;
                        if (scriptInfo.placement) placement = scriptInfo.placement;
                    }
                }

                // 2. 拉取并复用当前 Worker 绑定，避免把 secret 降级成 plain_text
                const bindingsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/bindings`, {
                    headers: { 'Authorization': `Bearer ${cfToken}` }
                });
                const bindingsData = await bindingsRes.json();
                if (!bindingsData.success) {
                    throw new Error(formatCloudflareApiError(bindingsData.errors, bindingsRes.status, '读取 Worker 绑定'));
                }
                const preservedBindings = [];
                if (Array.isArray(bindingsData.result)) {
                    for (const b of bindingsData.result) {
                        if (!b || typeof b !== 'object' || !b.type || !b.name) continue;
                        if (b.type === 'secret_text') {
                            // secret 值无法通过 API 读回，使用 inherit 继承上一版本，避免明文回填
                            preservedBindings.push({ type: 'inherit', name: b.name });
                            continue;
                        }
                        if (b.type === 'plain_text') {
                            if (typeof b.text === 'string') {
                                preservedBindings.push({ type: 'plain_text', name: b.name, text: b.text });
                            } else if (typeof env[b.name] === 'string') {
                                // 少数账号返回 plain_text 可能不带 text，兼容兜底
                                preservedBindings.push({ type: 'plain_text', name: b.name, text: env[b.name] });
                            }
                            continue;
                        }
                        preservedBindings.push(b);
                    }
                }

                // 4. 组装最终的部署请求
                const formData = new FormData();
                const metadata = { 
                    main_module: 'worker.js',
                    bindings: preservedBindings,
                    compatibility_date: compDate 
                };
                if (compFlags) metadata.compatibility_flags = compFlags;
                if (placement) metadata.placement = placement; // 🎯 完美带上你原始的放置地区！

                formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
                formData.append('worker.js', new Blob([body.newCode], { type: 'application/javascript+module' }), 'worker.js');

                const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}?bindings_inherit=strict`;
                const res = await fetch(cfUrl, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${cfToken}` },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    return Response.json({ success: true, msg: '代码更新成功，并已完美保留原有放置地区和兼容配置！' });
                } else {
                    throw new Error(formatCloudflareApiError(data.errors, res.status, '部署 Worker 代码'));
                }
            } catch (e) {
                return Response.json({ success: false, error: e.message });
            }
        }
        // ==========================================
        // 2.4 系统级与提取工具 API 
        // ==========================================
        if (url.pathname === '/api/purge-cache' && request.method === 'POST') {
            const cfToken = env.CF_API_TOKEN; const zoneId = env.CF_ZONE_ID;
            if (!cfToken || !zoneId) return Response.json({ success: false, error: '缺少 CF_API_TOKEN 或 CF_ZONE_ID 变量' });
            try {
                const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, { method: 'POST', headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ purge_everything: true }) });
                const data = await res.json();
                if (!data.success) throw new Error(formatCloudflareApiError(data.errors, res.status, '清理 Cloudflare 缓存'));
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        if (url.pathname === '/api/ping-node') {
            const target = url.searchParams.get('url');
            if (!target) return Response.json({ ms: -1 });
            const start = Date.now();
            try {
                const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 2000); 
                await fetch(target + '/', { method: 'HEAD', signal: controller.signal });
                clearTimeout(timeoutId); return Response.json({ ms: Date.now() - start });
            } catch (e) { return Response.json({ ms: -1 }); }
        }

        if (url.pathname === '/api/get-dns') {
            const cfToken = env.CF_API_TOKEN; const zoneId = env.CF_ZONE_ID; const domain = env.CF_DOMAIN;
            if (!cfToken || !zoneId || !domain) return Response.json({ success: false, error: '缺少 DNS 环境变量' });
            try {
                const getRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${domain}`, { headers: { 'Authorization': `Bearer ${cfToken}` } });
                const getData = await getRes.json();
                if (!getData.success) throw new Error(formatCloudflareApiError(getData.errors, getRes.status, '读取 DNS 记录'));
                return Response.json({ success: true, result: getData.result });
            } catch (error) { return Response.json({ success: false, error: error.message }); }
        }

        if (url.pathname === '/api/update-dns' && request.method === 'POST') {
            const cfToken = env.CF_API_TOKEN; const zoneId = env.CF_ZONE_ID; const domain = env.CF_DOMAIN;

            if (!cfToken || !zoneId || !domain) return Response.json({ success: false, error: '缺少 DNS 环境变量' });
            try {
                let body = {};
                try {
                    body = await request.json();
                } catch (e) {
                    return Response.json({ success: false, error: '请求体必须是合法 JSON' }, { status: 400 });
                }
                const ips = body.ips;
                const validated = validateDnsRecordInputs(ips);
                if (!validated.ok) return Response.json({ success: false, error: validated.error }, { status: 400 });

                const getRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${domain}`, { headers: { 'Authorization': `Bearer ${cfToken}` } });
                const getData = await getRes.json();
                if (!getData.success) throw new Error(formatCloudflareApiError(getData.errors, getRes.status, '获取现有 DNS 记录'));

                const oldRecords = getData.result.filter(r => r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME');
                const rollbackRecords = oldRecords.map(record => ({
                    type: record.type,
                    name: record.name,
                    content: record.content,
                    ttl: record.ttl || 60,
                    proxied: record.proxied === true
                }));
                let deletedOldRecords = false;
                const createdNewRecordIds = [];
                const rollback = async () => {
                    // 先移除本次已创建的新记录，避免出现新旧记录混合
                    if (createdNewRecordIds.length > 0) {
                        await Promise.allSettled(createdNewRecordIds.map(id => fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${id}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${cfToken}` }
                        })));
                    }
                    if (!deletedOldRecords || rollbackRecords.length === 0) return;
                    await Promise.allSettled(rollbackRecords.map(record => fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(record)
                    })));
                };

                for (const record of oldRecords) {
                    const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${cfToken}` } });
                    const deleteData = await deleteRes.json();
                    if (!deleteData.success) {
                        await rollback();
                        throw new Error(formatCloudflareApiError(deleteData.errors, deleteRes.status, `删除 DNS 记录 ${record.name}`));
                    }
                    deletedOldRecords = true;
                }

                for (const record of validated.records) {
                    const postRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, { method: 'POST', headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: record.type, name: domain, content: record.content, ttl: 60, proxied: false }) });
                    const postData = await postRes.json();
                    if(!postData.success) {
                        await rollback();
                        throw new Error(formatCloudflareApiError(postData.errors, postRes.status, `提交 DNS 记录 ${record.content}`));
                    }
                    if (postData?.result?.id) createdNewRecordIds.push(postData.result.id);
                }
                return Response.json({ success: true, message: `✅ 成功！` });
            } catch (error) { return Response.json({ success: false, error: error.message }); }
        }

        if (url.pathname === '/api/get-custom-api-ips') {
            try {
                const apiUrl = url.searchParams.get('url');
                if (!apiUrl) throw new Error("缺少 URL");
                const parsedApiUrl = new URL(apiUrl);
                if (parsedApiUrl.protocol !== 'http:' && parsedApiUrl.protocol !== 'https:') {
                    throw new Error("自定义 API 仅支持 HTTP/HTTPS URL");
                }
                const response = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const text = await readResponseTextWithinLimit(response, MAX_REMOTE_IP_LIST_BYTES);
                let collectedItems = [];
                try {
                    const jsonObj = JSON.parse(text);
                    if (jsonObj && jsonObj.data && Array.isArray(jsonObj.data)) {
                        jsonObj.data.forEach(item => { if (item.ip) collectedItems.push(item.ip); });
                    }
                } catch (e) {}

                if (collectedItems.length === 0) {
                    const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
                    collectedItems.push(...(text.match(ipv4Regex) || []));

                    const ipv6Regex = /(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:)*:[A-F0-9]{1,4}(?::[A-F0-9]{1,4})*/gi;
                    collectedItems.push(...(text.match(ipv6Regex) || []));
                }
                const uniqueIPArray = sanitizeExternalDnsItems(collectedItems, 15);
                for (let i = uniqueIPArray.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [uniqueIPArray[i], uniqueIPArray[j]] = [uniqueIPArray[j], uniqueIPArray[i]]; }
                return Response.json({ success: true, ips: uniqueIPArray, totalCount: uniqueIPArray.length });
            } catch (error) { return Response.json({ success: false, error: error.message }, { status: 500 }); }
        }

        if (url.pathname === '/api/get-remote-ips') {
            try {
                const reqType = (url.searchParams.get('type') || 'all').toLowerCase();
                const validIPs = new Set();

                if (['all', '电信', '联通', '移动', '多线', 'ipv6'].includes(reqType)) {
                    try {
                        const res1 = await fetch('https://api.uouin.com/cloudflare.html', { headers: { 'User-Agent': 'Mozilla/5.0' } });
                        if(res1.ok) {
                            const text1 = await readResponseTextWithinLimit(res1, MAX_REMOTE_IP_LIST_BYTES); const cleanText = text1.replace(/<[^>]+>/g, ' ');
                            const regex = /(电信|联通|移动|多线|ipv6)\s+((?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-fA-F0-9]{1,4}:)+[a-fA-F0-9]{1,4})/gi;
                            let match; while ((match = regex.exec(cleanText)) !== null) {
                                const lineType = match[1].toLowerCase(); let ip = match[2];
                                if (reqType === 'all' || reqType === lineType) sanitizeExternalDnsItems([ip], 1).forEach(item => validIPs.add(item));
                            }
                        }
                    } catch(e) {}
                }

                if (['all', '优选'].includes(reqType)) {
                    try {
                        const res2 = await fetch('https://raw.githubusercontent.com/ZhiXuanWang/cf-speed-dns/refs/heads/main/ipTop10.html', { headers: { 'User-Agent': 'Mozilla/5.0' } });
                        if(res2.ok) {
                            const text2 = await readResponseTextWithinLimit(res2, MAX_REMOTE_IP_LIST_BYTES); const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
                            sanitizeExternalDnsItems(text2.match(ipv4Regex) || [], 50).forEach(ip => validIPs.add(ip));
                        }
                    } catch(e) {}
                }
                const uniqueIPArray = Array.from(validIPs);
                for (let i = uniqueIPArray.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [uniqueIPArray[i], uniqueIPArray[j]] = [uniqueIPArray[j], uniqueIPArray[i]]; }
                return Response.json({ success: true, ips: uniqueIPArray.slice(0, 10), totalCount: uniqueIPArray.length });
            } catch (error) { return Response.json({ success: false, error: error.message }, { status: 500 }); }
        }

        // ==========================================
        // 2.5 数据库路由管理 API 
        // ==========================================
        if (url.pathname === '/api/routes/reorder' && request.method === 'POST') {
            if (!env.DB) return Response.json({ success: false, error: "未绑定 DB" });
            try {
                const items = await request.json(); 
                if (!Array.isArray(items)) return Response.json({ success: false, error: 'Invalid parameters' }, { status: 400 });
                for (const item of items) {
                    if (!isValidRoutePrefix(String(item?.prefix || '')) || !Number.isFinite(Number(item?.sort_order))) {
                        return Response.json({ success: false, error: 'Invalid route order item' }, { status: 400 });
                    }
                }
                const stmts = items.map(item => env.DB.prepare('UPDATE routes SET sort_order = ? WHERE prefix = ?').bind(item.sort_order, item.prefix));
                await env.DB.batch(stmts);
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        if (url.pathname === '/api/routes/import' && request.method === 'POST') {
            if (!env.DB) return Response.json({ success: false, error: "未绑定 DB" });
            try {
                const routes = await request.json();
                if (!Array.isArray(routes)) return Response.json({ success: false, error: '导入内容必须是数组' }, { status: 400 });
                for (const [index, r] of routes.entries()) {
                    if (r.prefix && r.target) {
                        const validated = validateRouteInput(r);
                        if (!validated.ok) return Response.json({ success: false, error: `第 ${index + 1} 条配置无效: ${validated.error}` }, { status: 400 });
                        const route = validated.route;
                        await env.DB.prepare('INSERT OR REPLACE INTO routes (prefix, target, mode, remark, last_play, icon, cache_img, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                            .bind(route.prefix, route.target, route.mode, route.remark, route.last_play, route.icon, route.cache_img, route.sort_order).run();
                    }
                }
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        if (url.pathname.startsWith('/api/routes')) {
            if (!env.DB) return Response.json({ error: "由于未绑定 D1 数据库，反代功能不可用。" }, { status: 500 });

            await env.DB.exec(`CREATE TABLE IF NOT EXISTS routes (prefix TEXT PRIMARY KEY, target TEXT NOT NULL)`);
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS request_stats (prefix TEXT, date TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(prefix, date))`);
            // 大数据记录核心表：访客日志
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS visitor_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, prefix TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, ip TEXT, country TEXT, city TEXT DEFAULT '', ua TEXT)`);
            
            // 添加索引提升查询性能
            try { await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_visitor_logs_country ON visitor_logs(country)`); } catch(e) {}
            try { await env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_visitor_logs_timestamp ON visitor_logs(timestamp)`); } catch(e) {}
            try { await env.DB.exec(`ALTER TABLE visitor_logs ADD COLUMN city TEXT DEFAULT ''`); } catch(e) {}
            
            try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN mode TEXT DEFAULT 'off'`); } catch(e) {}
            try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN remark TEXT DEFAULT ''`); } catch(e) {}
            try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_play TEXT DEFAULT ''`); } catch(e) {}
            try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN icon TEXT DEFAULT ''`); } catch(e) {}
            try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN cache_img TEXT DEFAULT 'on'`); } catch(e) {} 
            try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN sort_order INTEGER DEFAULT 0`); } catch(e) {}

            // 数据防爆清理策略：已移至 scheduled 定时任务，每天执行一次

            // 🚀 【方案A修复版】：独立并发查流，完美绕过 CF 免费版复杂度限制！
            if (request.method === 'GET') {
                const todayStr = new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0];
                const { results: routes } = await env.DB.prepare(`
                    SELECT r.*, 
                    IFNULL(s.count, 0) as todayReqs,
                    (SELECT SUM(count) FROM request_stats WHERE prefix = r.prefix) as totalReqs
                    FROM routes r 
                    LEFT JOIN request_stats s ON r.prefix = s.prefix AND s.date = ? 
                    ORDER BY r.sort_order ASC, r.prefix ASC
                `).bind(todayStr).all();

                if (env.CF_API_TOKEN && env.CF_ZONE_ID && routes && routes.length > 0) {
                    const end = new Date();
                    const beijingTime = new Date(end.getTime() + 8 * 3600000);
                    beijingTime.setUTCHours(0, 0, 0, 0);
                    const start = new Date(beijingTime.getTime() - 8 * 3600000);
                    const endISO = end.toISOString();
                    const startISO = start.toISOString();

                    try {
                        const bytesMap = await queryTrafficByPrefixesCached(env, routes, startISO, endISO);

                        routes.forEach(r => {
                            const bytes = bytesMap.get(r.prefix) || 0;
                            r.todayBandwidth = formatBytes(bytes);
                        });
                    } catch(e) {
                        routes.forEach(r => { r.todayBandwidth = "获取异常"; });
                    }
                }

                return Response.json(routes || []);
            }
            
            if (request.method === 'POST') {
                let data = {};
                try {
                    data = await request.json();
                } catch (e) {
                    return Response.json({ success: false, error: '请求体必须是合法 JSON' }, { status: 400 });
                }
                let currentSortOrder = 0;
                const validated = validateRouteInput(data);
                if (!validated.ok) return Response.json({ success: false, error: validated.error }, { status: 400 });
                const route = validated.route;
                if (route.oldPrefix && route.oldPrefix !== route.prefix) {
                    const oldRow = await env.DB.prepare('SELECT sort_order FROM routes WHERE prefix = ?').bind(route.oldPrefix).first();
                    if(oldRow) currentSortOrder = oldRow.sort_order;
                    await env.DB.prepare('DELETE FROM routes WHERE prefix = ?').bind(route.oldPrefix).run();
                } else {
                    const oldRow = await env.DB.prepare('SELECT sort_order FROM routes WHERE prefix = ?').bind(route.prefix).first();
                    if(oldRow) currentSortOrder = oldRow.sort_order;
                }

                await env.DB.prepare('INSERT OR REPLACE INTO routes (prefix, target, mode, remark, icon, cache_img, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
                    .bind(route.prefix, route.target, route.mode, route.remark, route.icon, route.cache_img, currentSortOrder).run();
                clearRoutesCache(route.prefix);
                if (route.oldPrefix && route.oldPrefix !== route.prefix) clearRoutesCache(route.oldPrefix);
                return Response.json({ success: true });
            }

            // 批量更新模式
            if (request.method === 'PUT') {
                let data = {};
                try {
                    data = await request.json();
                } catch (e) {
                    return Response.json({ success: false, error: '请求体必须是合法 JSON' }, { status: 400 });
                }
                if (data.prefixes && Array.isArray(data.prefixes) && data.mode !== undefined) {
                    if (!isValidRouteMode(String(data.mode)) || data.prefixes.some(prefix => !isValidRoutePrefix(String(prefix || '')))) {
                        return Response.json({ success: false, error: 'Invalid parameters' }, { status: 400 });
                    }
                    const placeholders = data.prefixes.map(() => '?').join(',');
                    await env.DB.prepare(`UPDATE routes SET mode = ? WHERE prefix IN (${placeholders})`)
                        .bind(data.mode, ...data.prefixes).run();
                    clearRoutesCache();
                    return Response.json({ success: true });
                }
                return Response.json({ success: false, error: 'Invalid parameters' });
            }

            if (request.method === 'DELETE') {
                const prefix = url.searchParams.get('prefix');
                if (!isValidRoutePrefix(String(prefix || ''))) return Response.json({ success: false, error: 'Invalid prefix' }, { status: 400 });
                await env.DB.prepare('DELETE FROM routes WHERE prefix = ?').bind(prefix).run(); clearRoutesCache(prefix); return Response.json({ success: true });
            }
            return new Response("Method not allowed", { status: 405 });
        }

        // ==========================================
        // 2.6 核心反代与调度引擎
        // ==========================================
        let targetUrls = []; let currentMode = 'off'; let enableCache = true; let remainingPath = '';
        let decodedPath = '';
        try {
            decodedPath = decodeURIComponent(url.pathname);
        } catch (e) {
            return new Response("Bad Request: invalid URL encoding", { status: 400 });
        }
        let matchedPrefix = null;
        let proxyOrigin = new URL(request.url).origin;
        let isPassthroughMode = false; // 标记是否为 URL 透传模式，透传模式下不重写响应中的媒体 URL

        // ==========================================
        // 🔒 UHD 海报墙修复函数
        // ==========================================

        // 判断哪些请求可以按静态资源处理。
        // 这里把 Emby/Jellyfin 常见图片目录也纳入判断，是因为 UHD 海报/Backdrop
        // 不一定总带标准图片后缀；如果只按 .jpg/.webp 等后缀识别，部分图片请求会被当成普通接口，
        // 后续重定向、缓存和源站防盗链处理策略就可能不匹配，导致高清图加载失败。
        function isStaticPath(pathname) {
            return /\.(jpg|jpeg|gif|png|svg|ico|webp|js|css|woff2?|ttf|otf|map|webmanifest|srt|ass|vtt|sub)$/i.test(pathname)
                || /(\/Images\/|\/Icons\/|\/Branding\/|\/emby\/covers\/|\/img\/)/i.test(pathname);
        }

        // 判断当前请求是否携带登录态或访问令牌。
        // 带鉴权信息的图片/API 不能盲目交给 Cloudflare 长缓存，否则不同用户、不同 token
        // 可能命中同一份缓存，轻则拿到过期图片，重则造成串号风险。UHD 图片经常带 api_key
        // 或 X-Emby-Token，这里专门识别出来，让这类请求继续按源站实时响应处理。
        function hasAuthLikeState(headers, targetUrl) {
            const authQueryKeys = ['api_key', 'x-emby-token', 'x-mediabrowser-token', 'access_token', 'token'];
            const hasAuthQuery = Array.from(targetUrl.searchParams.keys()).some(key => authQueryKeys.includes(key.toLowerCase()));
            return headers.has("Authorization")
                || headers.has("X-Emby-Token")
                || headers.has("X-MediaBrowser-Token")
                || headers.has("X-Emby-Authorization")
                || headers.has("Cookie")
                || hasAuthQuery;
        }

        function stripPanelCookie(headers) {
            const cookie = headers.get("Cookie");
            if (!cookie) return;
            const keptCookies = cookie.split(";").map(item => item.trim()).filter(item => item && !item.toLowerCase().startsWith("admin_token="));
            if (keptCookies.length > 0) headers.set("Cookie", keptCookies.join("; "));
            else headers.delete("Cookie");
        }

        function rewriteSetCookieForProxy(headers) {
            const getSetCookie = headers.getSetCookie ? headers.getSetCookie.bind(headers) : null;
            const rawSetCookie = headers.get("Set-Cookie");
            const cookies = getSetCookie ? getSetCookie() : (rawSetCookie ? rawSetCookie.split(/,(?=\s*[^;,]+=)/g) : []);
            if (cookies.length === 0) return;
            headers.delete("Set-Cookie");
            for (const cookie of cookies) headers.append("Set-Cookie", cookie.replace(/;\s*Domain=[^;]*/ig, ""));
        }

        // 收集所有源站 origin，并同时加入 http/https 的互换版本。
        // 实际返回的 JSON 里可能混用 http 与 https，例如线路配置是 https，
        // 但 Emby 返回的图片地址仍是 http。两个 origin 都纳入重写范围，
        // 才能避免 UHD 图片直连源站而绕过当前 Worker 代理。
        function getTargetOrigins(targets) {
            const origins = [];
            for (const target of targets) {
                try {
                    const parsed = new URL(target);
                    const origin = parsed.origin;
                    const alternateOrigin = (parsed.protocol === 'https:' ? 'http:' : 'https:') + '//' + parsed.host;
                    if (!origins.includes(origin)) origins.push(origin);
                    if (!origins.includes(alternateOrigin)) origins.push(alternateOrigin);
                } catch (e) {}
            }
            return origins;
        }

        // 把源站返回的图片/媒体 URL 改写成当前 Worker 代理 URL。
        // 修复 UHD 图片加载失败的核心原因在这里：部分接口返回的是绝对源站地址，
        // 浏览器会直接去访问源站，导致跨域、鉴权、源站不可达或被防盗链拦截。
        // 改写后所有图片请求都会重新经过 Worker，由 Worker 带着正确 header 转发到源站。
        function rewriteSourceUrlString(value, targetOrigins, proxyOrigin, safePrefix) {
            let rewritten = value;
            const proxyPrefix = proxyOrigin + safePrefix + '/';
            for (const origin of targetOrigins) {
                let result = '';
                let cursor = 0;
                let index = rewritten.indexOf(origin);
                while (index !== -1) {
                    const alreadyProxied = rewritten.substring(Math.max(0, index - proxyPrefix.length), index) === proxyPrefix;
                    result += rewritten.substring(cursor, index);
                    result += alreadyProxied ? origin : proxyPrefix + origin;
                    cursor = index + origin.length;
                    index = rewritten.indexOf(origin, cursor);
                }
                if (cursor > 0) {
                    result += rewritten.substring(cursor);
                    rewritten = result;
                }
            }
            // 支持多种图片路径格式：
            // - /img/xxx
            // - /emby/Items/xxx/Images/Backdrop/0
            // - /Items/xxx/Images/Primary/0
            // - /Images/Backdrop/0 (UHD 常用格式)
            // - /Images/Logo/0
            const relativeImagePattern = /(^|["'\s(])((?:\/img\/|\/emby\/Items\/[^"'\s)]+\/Images\/|\/Items\/[^"'\s)]+\/Images\/|\/Images\/[^"'\s)]*)[^"'\s)]*)/ig;
            rewritten = rewritten.replace(relativeImagePattern, (match, prefix, path) => {
                if (safePrefix && path.startsWith(safePrefix + '/')) return match;
                return prefix + proxyOrigin + safePrefix + path;
            });
            return rewritten;
        }

        // 递归处理 JSON 里的所有字符串字段。
        // UHD 图片地址不固定出现在某一个字段，可能藏在 ImageTags、BackdropImageTags、
        // Artwork、ProviderIds 或插件返回的嵌套对象里；只改顶层字段会漏掉一部分高清图。
        // 
        // ✅ 服务器地址字段也需要重写
        // Forward 等客户端的"自动更新服务器地址"功能会使用返回的地址更新连接
        // 如果返回源站地址，客户端会自动切换到源站，绕过代理
        // 因此必须将服务器地址也重写为代理地址
        const SERVER_ADDRESS_FIELDS = new Set([
            'LocalAddress', 'RemoteAddress', 'ServerUrl', 'BaseUrl',
            'serverUrl', 'baseUrl', 'localAddress', 'remoteAddress',
            'address', 'Address'
        ]);
        
        function isServerAddressField(key) {
            return SERVER_ADDRESS_FIELDS.has(key);
        }
        
        function shouldRewriteJsonString(value, targetOrigins) {
            if (typeof value !== 'string' || value.length === 0) return false;
            const lower = value.toLowerCase();
            if (!lower.includes('http://') && !lower.includes('https://') && !lower.includes('/img/') && !lower.includes('/images/') && !lower.includes('/items/') && !lower.includes('/emby/items/')) {
                return false;
            }
            return targetOrigins.some(origin => value.includes(origin))
                || lower.includes('/img/')
                || lower.includes('/images/')
                || lower.includes('/items/')
                || lower.includes('/emby/items/');
        }
        
        function rewriteSourceUrlsInJson(value, targetOrigins, proxyOrigin, safePrefix, depth = 0) {
            if (typeof value === 'string') {
                return shouldRewriteJsonString(value, targetOrigins)
                    ? rewriteSourceUrlString(value, targetOrigins, proxyOrigin, safePrefix)
                    : value;
            }
            if (depth >= MAX_JSON_REWRITE_DEPTH) return value;
            if (Array.isArray(value)) {
                let changed = false;
                const next = value.map(item => {
                    const rewritten = rewriteSourceUrlsInJson(item, targetOrigins, proxyOrigin, safePrefix, depth + 1);
                    if (rewritten !== item) changed = true;
                    return rewritten;
                });
                return changed ? next : value;
            }
            if (value && typeof value === 'object') {
                let changed = false;
                const next = {};
                for (const key of Object.keys(value)) {
                    // 服务器地址字段也重写（支持 Forward 等客户端的自动更新功能）
                    if (isServerAddressField(key) && typeof value[key] === 'string') {
                        const rewritten = shouldRewriteJsonString(value[key], targetOrigins)
                            ? rewriteSourceUrlString(value[key], targetOrigins, proxyOrigin, safePrefix)
                            : value[key];
                        if (rewritten !== value[key]) changed = true;
                        next[key] = rewritten;
                        continue;
                    }
                    const rewritten = rewriteSourceUrlsInJson(value[key], targetOrigins, proxyOrigin, safePrefix, depth + 1);
                    if (rewritten !== value[key]) changed = true;
                    next[key] = rewritten;
                }
                return changed ? next : value;
            }
            return value;
        }

        // 响应体被重写后必须移除这些和原始 body 强绑定的头。
        // 如果继续保留旧的 Content-Length/Content-Encoding/ETag，浏览器或中间缓存可能按旧长度、
        // 旧压缩格式校验新内容，表现为 JSON 截断、解压失败或缓存了未改写的图片 URL。
        function dropBodyIntegrityHeaders(headers) {
            headers.delete("Content-Length");
            headers.delete("Content-Encoding");
            headers.delete("ETag");
        }

        // 只有发现源站 URL 或典型图片相对路径时才解析并重写 JSON。
        // 这样可以避免每个普通 JSON 响应都做深度遍历，降低 Worker 开销；
        // 同时也确保包含 UHD 图片地址的响应不会被漏过。
        function hasJsonRewriteCandidate(text, targetOrigins) {
            return targetOrigins.some(origin => text.includes(origin))
                || /(^|["'\s(])(?:\/img\/|\/emby\/Items\/[^"'\s)]+\/Images\/|\/Items\/[^"'\s)]+\/Images\/|\/Images\/)/i.test(text);
        }

        // 判断当前请求路径是否像 Emby / Jellyfin 体系的 API 或静态资源路径。
        // 这一步是给 UHD / HUD 这类"服务真实挂在 /emby 子路径下，但线路里只填了裸域名"的场景兜底用的。
        // 例如客户端请求 /uhd/Items/{id}/PlaybackInfo，当前脚本会先转发到源站的 /Items/{id}/PlaybackInfo。
        // 如果 HUD 实际服务入口是 /emby/Items/{id}/PlaybackInfo，那么源站通常会直接回 404。
        //
        // 普通 Emby 有两种常见部署方式：
        // 1. 根路径部署，API 就在 /Items /Videos /Sessions 下
        // 2. 子路径部署，API 在 /emby/Items /emby/Videos /emby/Sessions 下
        //
        // 之前脚本完全依赖面板里手动把 target 写成带 /emby 的完整地址；
        // 只要这一步没填对，普通首页可能还能打开，但播放相关接口会在拿 PlaybackInfo 时 404。
        // 这里加的是"只在像 Emby API 的路径上才启用"的保守识别，避免把其他完全无关的网站路径误补成 /emby。
        function isLikelyMediaServerPath(pathname) {
            return /^\/(?:Items|Videos|Audio|Sessions|Users|System|Library|LiveTv|Shows|Movies|Artists|Albums|Playlists|Channels|Packages|Devices|Socket|socket|web|emby|Images|Branding|Environment|DisplayPreferences|Trailers|Collections|Genres|Persons|Studios|Years)(?:\/|$)/i.test(pathname);
        }

        // 为单个 target 生成候选上游 URL。
        // 第一候选始终保持原行为，完全按"target + remainingPath"拼接。
        // 第二候选只在以下条件满足时追加：
        // - 线路 target 本身没有子路径（说明面板里大概率填的是裸域名）
        // - 当前请求像 Emby API/资源路径
        // - 当前路径本身还没有 /emby 前缀
        //
        // 这样 HUD 如果真实挂在 /emby 下，就能在首个 404 后自动切换到 /emby/... 重试；
        // 普通根路径部署的 Emby 因为第一候选就能成功，不会受到影响。
        //
        // 为单个 target 生成候选上游 URL。
        // 第一候选始终保持原行为，完全按"target + remainingPath"拼接。
        // 第二/第三候选只在以下条件满足时追加：
        // - 线路 target 本身没有子路径（说明面板里大概率填的是裸域名）
        // - 当前请求像 Emby API/资源路径
        //
        // 这里同时兼容两类常见偏差：
        // 1. 实际服务挂在 /emby 下，但客户端请求的是 /Items /Videos ...
        //    -> 自动补成 /emby/Items /emby/Videos
        // 2. 实际服务挂在根路径，但客户端自己固定补了 /emby/Items /emby/Videos
        //    -> 自动再试一次去掉 /emby 前缀后的 /Items /Videos
        //
        // 这样普通 Emby 和 HUD/UHD Emby 都可以在同一节点内完成"加 /emby"或"去 /emby"的双向回退，
        // 避免某些客户端因为固定拼接 /emby 而只在部分服务器上失效。

        // 一些客户端会在拿到 PlaybackInfo 后自己再拼一次 serverUrl。
        // 如果我们返回的是 /{prefix}/videos/... 或 /{prefix}/emby/videos/...，
        // 某些客户端再自己拼一次 serverUrl 后，有时会拼出：
        // - /{prefix}/{prefix}/videos/...
        // - /{prefix}/emby/{prefix}/videos/...
        //
        // 这些其实都还是同一条线路，只是多叠了一层 prefix。
        // 这里在真正选路前做一次 O(1) 字符串归一化，把常见重复前缀修回标准路径，
        // 这样既不依赖某个特定客户端，也避免为此引入额外存储或更重的会话跟踪。
        function normalizeRemainingPathForPlayback(remainingPath, matchedPrefix) {
            if (!remainingPath || !matchedPrefix) return remainingPath;

            const prefixPath = `/${matchedPrefix}`;
            const embyDuplicatedPrefix = `/emby${prefixPath}`;

            if (remainingPath === prefixPath || remainingPath.startsWith(prefixPath + '/')) {
                const stripped = remainingPath.substring(prefixPath.length);
                return stripped || '/';
            }

            if (remainingPath === embyDuplicatedPrefix || remainingPath.startsWith(embyDuplicatedPrefix + '/')) {
                const stripped = remainingPath.substring(embyDuplicatedPrefix.length);
                // 这里兼容两种客户端二次拼接结果：
                // 1. /emby/{prefix}/videos/...      -> 还原成 /emby/videos/...
                // 2. /emby/{prefix}/emby/videos/... -> 还原成 /emby/videos/...
                //
                // 第二种常见于"API 习惯性固定补 /emby 的客户端"：
                // PlaybackInfo 已经返回 /{prefix}/emby/videos/...，
                // 客户端又按自己的固定规则补了一层 /emby，最终会多出 /emby/{prefix}/emby/...。
                // 如果这里无脑再拼一次 /emby，会变成 /emby/emby/videos/...，反而把原本可修复的请求打坏。
                if (!stripped || stripped === '/') return '/emby/';
                if (/^\/emby(?:\/|$)/i.test(stripped)) return stripped;
                return `/emby${stripped}`;
            }

            return remainingPath;
        }

        function buildUpstreamCandidates(targetBase, remainingPath, search) {
            const candidates = [];
            const pushUnique = (value) => {
                if (value && !candidates.includes(value)) candidates.push(value);
            };

            // 🚨 紧急修复：检测并修复损坏的 URL 路径
            // 当 remainingPath 形如 /embyhttps://... 或 /embyhttp://... 时，
            // 说明之前的 URL 拼接出了问题，client/server 的 bug 导致 protocol 被拼接到了 path 中
            // 正确做法是从中提取真正的 URL 并返回
            if (remainingPath && remainingPath.includes('://')) {
                const afterSlash = remainingPath.substring(1); // 去掉开头的 /
                // 检查是否包含类似 "embyhttps://" 或 "embyhttp://" 的损坏模式
                const damagedMatch = afterSlash.match(/^([a-z]+)(https?:\/\/)(.+)/i);
                if (damagedMatch) {
                    const protocol = damagedMatch[2]; // https:// 或 http://
                    const restUrl = damagedMatch[3]; // 域名+路径
                    const fixedUrl = protocol + restUrl;
                    try {
                        const parsed = new URL(fixedUrl);
                        pushUnique(fixedUrl);
                        // 也尝试不带域名中可能错误拼接的 emby 前缀
                        const cleanUrl = parsed.origin + parsed.pathname + parsed.search + parsed.hash;
                        if (cleanUrl !== fixedUrl) pushUnique(cleanUrl);
                    } catch (e) { /* 解析失败 */ }
                    return candidates;
                }
            }

            const primary = targetBase + remainingPath + search;
            pushUnique(primary);

            try {
                const parsed = new URL(targetBase);
                const basePath = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
                const requestPath = remainingPath || '/';

                // 只有当 target 本身没有配置任何子路径时，才尝试 /emby 回退。
                // 如果用户已经明确把线路写成了 https://host/emby，再补一次会变成 /emby/emby/...，
                // 这反而会把原本正确的请求打坏，所以这里必须先判断 basePath 是根路径。
                const hasNoBasePath = (basePath === '/');
                const requestAlreadyHasEmbyPrefix = /^\/emby(?:\/|$)/i.test(requestPath);

                if (hasNoBasePath && !requestAlreadyHasEmbyPrefix && isLikelyMediaServerPath(requestPath)) {
                    pushUnique(`${parsed.origin}/emby${requestPath}${search}`);
                }

                // 反向回退：
                // 某些客户端会固定把媒体/接口地址补成 /emby/...，但普通 Emby 真实入口其实在根路径。
                // 例如 PlaybackInfo 被客户端请求成 /emby/videos/...，源站根路径部署时会 404，
                // 这时自动再试一次去掉 /emby 前缀后的 /videos/...。
                if (hasNoBasePath && requestAlreadyHasEmbyPrefix && isLikelyMediaServerPath(requestPath)) {
                    const strippedRequestPath = requestPath.replace(/^\/emby(?=\/|$)/i, '') || '/';
                    pushUnique(`${parsed.origin}${strippedRequestPath}${search}`);
                }

                // 兼容"绝对 URL 透传"场景。
                // 如果 targetBase 自己已经是完整绝对 URL，且它的 pathname 看起来像 Emby API，
                // 但 pathname 又不是以 /emby 开头，那么自动再试一次：
                // https://host/emby + pathname
                const targetAlreadyHasEmbyPrefix = /^\/emby(?:\/|$)/i.test(parsed.pathname || '/');
                if (!targetAlreadyHasEmbyPrefix && isLikelyMediaServerPath(parsed.pathname || '/')) {
                    const passthroughSearch = parsed.search || search;
                    pushUnique(`${parsed.origin}/emby${parsed.pathname}${passthroughSearch}${parsed.hash || ''}`);
                }

                // 对"绝对 URL 透传"也做反向 /emby 去除回退。
                // 如果 target 有 /emby 但真实服务在根路径，去掉 /emby 再试。
                if (targetAlreadyHasEmbyPrefix && isLikelyMediaServerPath(parsed.pathname || '/')) {
                    const strippedPathname = (parsed.pathname || '/').replace(/^\/emby(?=\/|$)/i, '') || '/';
                    const passthroughSearch = parsed.search || search;
                    pushUnique(`${parsed.origin}${strippedPathname}${passthroughSearch}${parsed.hash || ''}`);
                }
            } catch (e) {}

            return candidates;
        }

        // 把 PlaybackInfo 里的媒体地址统一规范成"Worker 前缀下的根路径相对地址"。
        //
        // 这里不再按某个客户端做特判，而是尽量保留 Emby 原生字段的共同语义：
        // - 很多客户端期望拿到的是 path，而不是完整绝对 URL
        // - 但如果 path 里不带当前线路前缀，客户端一旦直接请求 /videos 或 /emby/videos，
        //   就会绕过 /{prefix}/... 这条代理路由，导致播放失败
        //
        // 因此统一输出为：
        // /{prefix} + 源站原始 path
        //
        // 例如：
        // - 源站是 /videos/...       -> /{prefix}/videos/...
        // - 源站是 /emby/videos/... -> /{prefix}/emby/videos/...
        //
        // 这里特意保留"源站原始 path"而不是强行统一成某一种固定格式，
        // 是因为你这次抓到的普通 Emby 和 UHD/HUD PlaybackInfo 都表明：
        // - API 请求常常走 /emby/Items/... /emby/Sessions/...
        // - 真正媒体直链 DirectStreamUrl 常常却是 /videos/...
        //
        // 也就是说，/emby 更像是 API 基路径，而 /videos 才是媒体流路径；
        // 如果在这里想当然地把媒体地址补成 /emby/videos/...，反而会把原本正确的普通 Emby 直链改坏。
        //
        // 这样可以同时兼容三类常见用法：
        // 1. 直接把字段当请求地址使用：会命中当前线路
        // 2. 浏览器按 root-relative 解析：仍然会命中当前线路
        // 3. 客户端拿到 path 后再自行拼 serverUrl：如果拼出了重复 prefix，
        //    后面的 normalizeRemainingPathForPlayback 会在入口做一次轻量修正
        function toWorkerPlaybackPath(pathname, search = '', hash = '', safePrefix = '') {
            const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
            return `${safePrefix}${normalizedPath}${search || ''}${hash || ''}`;
        }

        function rewritePlaybackMediaUrl(rawValue, targetUrl, proxyOrigin, safePrefix, targetOrigins) {
            if (typeof rawValue !== 'string') return rawValue;
            const trimmedValue = rawValue.trim();
            if (!trimmedValue) return rawValue;

            // 如果字段已经被改成当前 Worker 前缀下的路径，直接复用，避免重复叠加 prefix。
            if (safePrefix && trimmedValue.startsWith(safePrefix + '/')) return rawValue;

            // 某些客户端会缓存上一次的 PlaybackInfo，拿到的是完整 Worker 绝对地址。
            // 这里把它还原成 root-relative，继续保持"字段值是 path"的通用语义。
            if (safePrefix && trimmedValue.startsWith(proxyOrigin + safePrefix + '/')) {
                return trimmedValue.substring(proxyOrigin.length);
            }

            // 处理协议相对地址 //host/path
            if (trimmedValue.startsWith('//')) {
                try {
                    const parsed = new URL(targetUrl.protocol + trimmedValue);
                    if (Array.isArray(targetOrigins) && !targetOrigins.includes(parsed.origin)) {
                        return `${proxyOrigin}${safePrefix}/${parsed.href}`;
                    }
                    return toWorkerPlaybackPath(parsed.pathname, parsed.search, parsed.hash, safePrefix);
                } catch (e) {
                    return rawValue;
                }
            }

            // 🆕 统一处理绝对地址（包含媒体路径特殊处理）
            // 修复 UHD 媒体服务器同源绝对地址被转换为相对路径导致前缀丢失的问题
            // 当源站返回如 https://v1.uhdnow.com/videos/xxx.m3u8 这样的同源绝对地址时：
            // - 之前逻辑：转换为 /uhd/videos/xxx.m3u8（相对路径）
            // - 问题：某些客户端（如 Forward）可能不会正确处理相对路径，导致前缀丢失
            // - 修复后：始终返回完整的代理 URL 格式 /uhd/https://v1.uhdnow.com/videos/xxx.m3u8
            // 这样即使客户端不使用相对路径解析，也能确保请求经过 Worker 代理
            if (/^https?:\/\//i.test(trimmedValue)) {
                try {
                    const parsed = new URL(trimmedValue);
                    // 对于媒体文件路径（/videos/... 或 /Audio/...），始终返回完整的代理 URL 格式
                    if (parsed.pathname.match(/^\/(videos|Audio)\//)) {
                        return `${proxyOrigin}${safePrefix}/${trimmedValue}`;
                    }
                    // 其他跨源地址返回完整代理 URL
                    if (Array.isArray(targetOrigins) && !targetOrigins.includes(parsed.origin)) {
                        return `${proxyOrigin}${safePrefix}/${trimmedValue}`;
                    }
                    // 同源非媒体地址保持原有逻辑
                    return toWorkerPlaybackPath(parsed.pathname, parsed.search, parsed.hash, safePrefix);
                } catch (e) {
                    return rawValue;
                }
            }

            // HUD 最容易踩坑的是这里：返回 /emby/videos/... 时，必须显式补上线路前缀。
            // 否则客户端会去请求站点根路径 /emby/...，直接绕开当前 /{prefix} 代理节点。
            // 区分处理：
            // - /emby/... 路径（如OK）：前后端不分离，返回相对路径，让客户端自己拼接
            // - /videos/... 等路径（如UHD）：前后端分离，必须返回完整的代理 URL
            if (trimmedValue.startsWith('/')) {
                // 检查路径是否是媒体文件路径（/videos/... 或 /Audio/...）
                if (trimmedValue.match(/^\/(videos|Audio)\//)) {
                    // UHD：前后端分离，必须返回完整的代理 URL，不返回相对路径
                    return `${proxyOrigin}${safePrefix}/${targetUrl.origin}${trimmedValue}`;
                }
                // OK 或其他：前后端不分离，返回相对路径
                return toWorkerPlaybackPath(trimmedValue, '', '', safePrefix);
            }

            // 处理被污染的绝对 URL（如 embyhttps://...）：
            // 只提取后半段真实的 http(s)://...，避免影响正常 /emby/... 或 /videos/... 路径。
            const damagedAbsoluteMatch = trimmedValue.match(/^[a-z][a-z0-9+.-]*(https?:\/\/.+)$/i);
            if (damagedAbsoluteMatch) {
                const fixed = damagedAbsoluteMatch[1];
                try {
                    const parsed = new URL(fixed);
                    if (Array.isArray(targetOrigins) && !targetOrigins.includes(parsed.origin)) {
                        return `${proxyOrigin}${safePrefix}/${parsed.href}`;
                    }
                    return toWorkerPlaybackPath(parsed.pathname, parsed.search, parsed.hash, safePrefix);
                } catch (e) {
                    // 如果修复后还是解析失败，尝试直接用原始值
                }
            }

            // 少数实现会返回不带前导斜杠的相对路径，例如 videos/123/master.m3u8。
            // 这时先按源站地址解析成绝对 URL，再映射回 Worker 代理地址，保证路径语义不变。
            try {
                const resolved = new URL(trimmedValue, targetUrl.origin + '/');
                return toWorkerPlaybackPath(resolved.pathname, resolved.search, resolved.hash, safePrefix);
            } catch (e) {
                return rawValue;
            }
        }

        function rewriteRedirectLocation(location, targetUrl, targetOrigins, proxyOrigin, safePrefix) {
            if (!location) return location;
            if (location.startsWith('//')) {
                try {
                    const protocol = targetUrl ? targetUrl.protocol : new URL(targetOrigins[0]).protocol;
                    location = protocol + location;
                } catch (e) {}
            }
            if (location.startsWith('/')) {
                if (safePrefix && location.startsWith(safePrefix + '/')) return proxyOrigin + location;
                if (!safePrefix && targetUrl) return `${proxyOrigin}/${encodeURIComponent(new URL(location, targetUrl.origin).href)}`;
                return proxyOrigin + safePrefix + location;
            }
            try {
                const parsed = new URL(location);
                if (targetOrigins.includes(parsed.origin)) {
                    if (!safePrefix) return `${proxyOrigin}/${encodeURIComponent(location)}`;
                    return proxyOrigin + safePrefix + parsed.pathname + parsed.search + parsed.hash;
                }
            } catch (e) {}
            if (/^https?:\/\//i.test(location)) return `${proxyOrigin}${safePrefix}/${encodeURIComponent(location)}`;
            return location;
        }

        // ==========================================
        // 🆕 Go项目风格：编码格式 URL 解析
        // 格式: /{scheme}/{domain}/{port}/{path}
        // 例如: /https/emby.example.com/443/videos/123.m3u8
        // ==========================================
        function parseEncodedProxyUrl(path) {
            // 匹配 /{scheme}/{domain}/{port}/{path} 格式
            // scheme: http 或 https
            // domain: 域名或IP（支持 IPv6）
            // port: 端口号 1-65535
            // path: 剩余路径
            const match = path.match(/^\/(https?)\/([^\/]+)\/(\d+)\/(.*)$/i);
            if (!match) return null;

            const scheme = match[1].toLowerCase();
            let domain = match[2];
            const port = parseInt(match[3], 10);
            let remainingPath = '/' + match[4];

            // 验证 scheme
            if (scheme !== 'http' && scheme !== 'https') return null;

            // 验证端口范围
            if (isNaN(port) || port < 1 || port > 65535) return null;

            // 处理 IPv6 地址格式 [...]:port
            if (domain.startsWith('[')) {
                const bracketEnd = domain.indexOf(']');
                if (bracketEnd === -1) return null;
                const ipv6 = domain.substring(1, bracketEnd);
                // 验证 IPv6 格式（简化验证）
                if (!/^([0-9a-fA-F:]+)$/.test(ipv6)) return null;
                domain = ipv6; // 去除括号，后续处理用
            }

            // 构建目标 URL
            let targetUrl;
            if (domain.includes(':') && !domain.startsWith('[')) {
                // IPv6 无括号格式
                targetUrl = `${scheme}://[${domain}]:${port}${remainingPath}`;
            } else {
                targetUrl = `${scheme}://${domain}:${port}${remainingPath}`;
            }

            return { targetUrl, remainingPath };
        }

        // ==========================================
        // 🆕 高效 URL 重写引擎（字节扫描风格）
        // 参考 Go 项目实现，使用 indexOf 代替正则
        // ==========================================
        const HTTP_SCHEME = 'http://';
        const HTTPS_SCHEME = 'https://';

        // 快速扫描文本中的所有 URL 并重写
        // 替代原有的正则替换，提升性能
        function fastRewriteUrlsInText(text, targetOrigins, proxyOrigin, safePrefix) {
            if (!text || typeof text !== 'string') return text;

            // 快速检查是否包含 http
            let hasHttp = false;
            for (let i = 0; i < Math.min(text.length, 100); i++) {
                if (text[i] === 'h' && text.substring(i, i + 4) === 'http') {
                    hasHttp = true;
                    break;
                }
            }
            if (!hasHttp) return text;

            const proxyPrefix = proxyOrigin + safePrefix + '/';
            let result = '';
            let lastIndex = 0;

            while (true) {
                // 查找下一个 http:// 或 https://
                const httpPos = text.indexOf(HTTP_SCHEME, lastIndex);
                const httpsPos = text.indexOf(HTTPS_SCHEME, lastIndex);

                let pos = -1;
                let schemeLen = 0;

                if (httpPos >= 0 && (httpsPos < 0 || httpPos <= httpsPos)) {
                    pos = httpPos;
                    schemeLen = 7;
                } else if (httpsPos >= 0) {
                    pos = httpsPos;
                    schemeLen = 8;
                }

                if (pos < 0) {
                    // 没有更多 URL，追加剩余文本
                    result += text.substring(lastIndex);
                    break;
                }

                // 追加 URL 之前的文本
                result += text.substring(lastIndex, pos);

                // 找到 URL 结束位置（遇到分隔符停止）
                let urlEnd = pos + schemeLen;
                while (urlEnd < text.length) {
                    const c = text.charCodeAt(urlEnd);
                    // URL 结束条件：空白、控制字符、引号、括号等
                    if (c <= 32 || c === 34 || c === 39 || c === 60 || c === 62 ||
                        c === 40 || c === 41 || c === 123 || c === 125 ||
                        c === 91 || c === 93 || c === 92 || c === 124 || c === 94 ||
                        c === 96) {
                        break;
                    }
                    urlEnd++;
                }

                const rawUrl = text.substring(pos, urlEnd);
                const rewritten = fastRewriteSingleUrl(rawUrl, targetOrigins, proxyOrigin, safePrefix, proxyPrefix);
                result += rewritten;

                lastIndex = urlEnd;
            }

            return result;
        }

        // 重写单个 URL（高效实现）
        function fastRewriteSingleUrl(rawUrl, targetOrigins, proxyOrigin, safePrefix, proxyPrefix) {
            // 快速判断是否已经是代理格式
            if (rawUrl.startsWith(proxyPrefix)) {
                return rawUrl;
            }

            // 提取 origin
            let origin;
            try {
                const parsed = new URL(rawUrl);
                origin = parsed.origin;
            } catch (e) {
                return rawUrl;
            }

            // 检查是否是目标源站地址
            if (targetOrigins && Array.isArray(targetOrigins)) {
                if (!targetOrigins.includes(origin)) {
                    // 跨源地址，转换为代理格式
                    return proxyPrefix + rawUrl;
                }
}

            // 同源地址，返回原始 URL（保持相对路径由客户端处理）
            return rawUrl;
        }

        // ==========================================
        // 🆕 增强型媒体识别（Go项目风格）
        // ==========================================
        const MEDIA_EXTENSIONS = new Set([
            // 视频
            'mp4', 'mkv', 'avi', 'ts', 'm3u8', 'm4v', 'webm', 'mov', 'wmv', 'flv', 'ogv',
            // 音频
            'mp3', 'flac', 'aac', 'ogg', 'wav', 'm4a', 'opus', 'wma', 'ape',
            // 图片
            'jpg', 'jpeg', 'png', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'svg', 'avif',
            // 字体
            'woff', 'woff2', 'ttf', 'eot', 'otf',
            // 字幕
            'srt', 'ass', 'ssa', 'vtt', 'sub', 'sup',
            // 其他
            'zip', 'gz', 'br', 'zst', 'json', 'xml'
        ]);

        function looksLikeMediaPath(path) {
            if (!path) return false;
            const lower = path.toLowerCase();

            // 路径包含媒体关键字
            if (lower.includes('/videos/') || lower.includes('/audio/') ||
                lower.includes('/images/') || lower.includes('/items/images') ||
                lower.includes('/stream')) {
                return true;
            }

            // 检查扩展名
            const dotIdx = lower.lastIndexOf('.');
            if (dotIdx >= 0 && dotIdx < lower.length - 1) {
                const ext = lower.substring(dotIdx + 1).split('?')[0].split('#')[0];
                return MEDIA_EXTENSIONS.has(ext);
            }

            return false;
        }

        function applyProxyCacheHeaders(headers, request, pathname, enableCache) {
            const contentType = headers.get("content-type") || "";
            const isStaticRes = isStaticPath(pathname);
            const canCacheStaticRes = isStaticRes
                && enableCache
                && !hasAuthLikeState(new Headers(request.headers), new URL(request.url))
                && !/application\/json/i.test(contentType);

            if (canCacheStaticRes) {
                headers.set('Cache-Control', 'public, max-age=86400');
                headers.delete('Expires');
                headers.delete('Pragma');
            } else {
                headers.set('Cache-Control', 'no-store');
            }
        }

        function shouldBypassBodyRewrite(request, pathname, headers, status) {
            const lowerPath = (pathname || '').toLowerCase();
            const contentType = headers.get("content-type") || "";
            if (/playbackinfo/i.test(lowerPath)) return false;
            if (/\.m3u8(?:$|\?)/i.test(lowerPath) || /(?:mpegurl|vnd\.apple\.mpegurl)/i.test(contentType)) return false;
            if (/json|xml|text\/html/i.test(contentType)) return false;
            if (request.headers.has("Range") || status === 206) return true;
            if (/^(video|audio)\//i.test(contentType)) return true;
            if (/^(image|font)\//i.test(contentType) || /application\/(?:octet-stream|x-mpegurl|x-font|font-woff)/i.test(contentType)) return true;
            return looksLikeMediaPath(lowerPath) && !/\.(json|xml|m3u8)(?:$|\?)/i.test(lowerPath);
        }

        // 获取请求类型用于日志分级
        function getRequestCategory(path) {
            const lower = (path || '').toLowerCase();
            if (/\/playbackinfo/i.test(lower) || /\/items\//i.test(lower)) return 'API';
            if (lower.includes('/videos/') || lower.includes('/audio/') || looksLikeMediaPath(lower)) return 'STREAM';
            if (/socket|websocket/i.test(lower)) return 'WS';
            return 'PROXY';
        }

        const isLegacyGeneralProxyPath = decodedPath.startsWith('/http://') || decodedPath.startsWith('/https://');
        const isEncodedGeneralProxyPath = ENABLE_ENCODED_PROXY_FORMAT && /^\/https?\/[^\/]+\/\d+(?:\/|$)/i.test(decodedPath);

        if (isLegacyGeneralProxyPath || isEncodedGeneralProxyPath) {
            // 🚫 通用反代访问控制检查
            // 优先从短 TTL 内存缓存读取配置，缓存失效后再回源到 D1/KV。
            const isAllowed = await getGeneralProxyEnabledCached(env);
            
            if (!isAllowed) {
                return new Response(
                    JSON.stringify({
                        error: "通用反代功能已禁用",
                        message: "请联系管理员开启通用反代功能，或使用已配置的反代节点访问",
                        hint: "如需添加节点，请访问管理面板进行配置"
                    }),
                    {
                        status: 403,
                        headers: {
                            "Content-Type": "application/json;charset=UTF-8",
                            "Access-Control-Allow-Origin": "*"
                        }
                    }
                );
            }

            // 🆕 支持编码格式通用反代: /{scheme}/{domain}/{port}/{path}
            if (ENABLE_ENCODED_PROXY_FORMAT) {
                const encodedResult = parseEncodedProxyUrl(decodedPath);
                if (encodedResult) {
                    targetUrls = [encodedResult.targetUrl];
                    remainingPath = '';
                    isPassthroughMode = true;
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log(`[GENERAL] Encoded proxy: ${decodedPath} -> ${encodedResult.targetUrl}`);
                    }
                } else if (isLegacyGeneralProxyPath) {
                    // 传统格式: /https://example.com/path
                    targetUrls = [decodedPath.substring(1)];
                    remainingPath = '';
                } else {
                    return new Response(
                        JSON.stringify({
                            error: "通用反代地址格式无效",
                            message: "编码格式应为 /https/{domain}/{port}/{path} 或 /http/{domain}/{port}/{path}",
                            hint: "例如: /https/example.com/443/emby/Items"
                        }),
                        {
                            status: 400,
                            headers: {
                                "Content-Type": "application/json;charset=UTF-8",
                                "Access-Control-Allow-Origin": "*"
                            }
                        }
                    );
                }
            } else {
                // 仅传统格式
                targetUrls = [decodedPath.substring(1)];
                remainingPath = '';
            }
        } else {
            const pathParts = decodedPath.split('/'); const prefix = pathParts[1]; 
            if (!prefix) return new Response(`Not Found`, { status: 404 });

            try {
                if (!env.DB) return new Response(`404: Node not found (DB not bound)`, { status: 404 });
                const route = await getCachedRouteByPrefix(env, prefix);
                if (!route) return new Response(`404: Node not found`, { status: 404 });

                currentMode = route.mode || 'off'; enableCache = (route.cache_img !== 'off');
                matchedPrefix = prefix; remainingPath = '/' + pathParts.slice(2).join('/');
                remainingPath = normalizeRemainingPathForPlayback(remainingPath, matchedPrefix);
                targetUrls = route.target.split(',').map(s => s.trim()).filter(Boolean);

                // 🚨 紧急修复：当 remainingPath 包含损坏的 URL 模式（如 /embyhttps://）时
                // 直接将其转换为正确的 targetUrl，绕过后续的 buildUpstreamCandidates
                if (remainingPath.includes('://')) {
                    const pathWithoutSlash = remainingPath.substring(1);
                    const damagedMatch = pathWithoutSlash.match(/^([a-z]+)(https?:\/\/)(.+)/i);
                    if (damagedMatch) {
                        const protocol = damagedMatch[2];
                        const restUrl = damagedMatch[3];
                        const fixedUrl = protocol + restUrl;
                        try {
                            new URL(fixedUrl);
                            targetUrls = [fixedUrl];
                            remainingPath = '';
                            // 不 return，让代码继续正常流程
                        } catch (e) {}
                    }
                }

                if (remainingPath.startsWith('/http://') || remainingPath.startsWith('/https://')) { targetUrls = [remainingPath.substring(1)]; remainingPath = ''; isPassthroughMode = true; }
            } catch (e) { return new Response("DB Error: " + e.message, { status: 500 }); }
        }

        if (targetUrls.length === 0) return new Response("404: Target empty", { status: 404 });

        // ==========================================
        // 2.7 防爆型精准日志拦截 (修复统计虚高：仅拦截点火请求)
        // ==========================================
        const isNewPlaySession = /\/PlaybackInfo/i.test(url.pathname); 

        // 核心修改：仅在点火请求时才记录 "今日播放" 和 "最后活跃"
        if (isNewPlaySession && matchedPrefix && env.DB && ctx && ctx.waitUntil) {
            try {
                const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "Unknown";
                const clientUa = request.headers.get("User-Agent") || "Unknown";
                if (shouldRecordPlaySession(matchedPrefix, clientIp, clientUa)) {
                    const todayStr = new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0];
                    const nowTime = new Date(Date.now() + 8 * 3600000).toISOString().replace('T', ' ').split('.')[0]; 
                    
                    let stmts = [
                        env.DB.prepare(`INSERT INTO request_stats (prefix, date, count) VALUES (?, ?, 1) ON CONFLICT(prefix, date) DO UPDATE SET count = count + 1`).bind(matchedPrefix, todayStr),
                        env.DB.prepare(`UPDATE routes SET last_play = ? WHERE prefix = ?`).bind(nowTime, matchedPrefix)
                    ];

                    const clientCountry = request.headers.get("cf-ipcountry") || "Unknown";
                    const clientCity = request.cf?.city || "";
                    stmts.push(env.DB.prepare(`INSERT INTO visitor_logs (prefix, ip, country, city, ua) VALUES (?, ?, ?, ?, ?)`).bind(matchedPrefix, clientIp, clientCountry, clientCity, clientUa));

                    ctx.waitUntil(env.DB.batch(stmts));
                }
            } catch(e) {}
        }

        // ==========================================
        // 2.8 无伪装模式下的源站反代 (含强力防 403 引擎)
        // ==========================================
        const isStrictMode = currentMode === 'strict';

        // 预先计算 targetOrigins，供后续响应体重写使用
        const targetOrigins = getTargetOrigins(targetUrls);

        let bodyBuffer = null;
        const canHaveRequestBody = request.method !== 'GET' && request.method !== 'HEAD';
        const needsReplayableBody = canHaveRequestBody && (
            targetUrls.length > 1
            || targetUrls.some(target => buildUpstreamCandidates(target, remainingPath, url.search).length > 1)
        );

        if (needsReplayableBody) {
            // 只有在"请求体会被重复使用"时才预读成 ArrayBuffer：
            // 1. 多节点 failover：同一个 POST 可能发往多个 target
            // 2. 同节点候选回退：例如 /Items/... 失败后，再试 /emby/Items/...
            try {
                bodyBuffer = await readRequestArrayBufferWithinLimit(request.clone(), MAX_REPLAY_BODY_BYTES);
            } catch(e) {
                return new Response(e.message, { status: 413 });
            }
        }

        let finalResponse = null; let lastError = null; let finalTargetUrl = null;

        for (let i = 0; i < targetUrls.length; i++) {
            const candidateUrls = buildUpstreamCandidates(targetUrls[i], remainingPath, url.search);

            for (let j = 0; j < candidateUrls.length; j++) {
                const targetUrlStr = candidateUrls[j];
                const targetUrl = new URL(targetUrlStr);
                const newHeaders = new Headers(request.headers); newHeaders.set("Host", targetUrl.host);
                stripPanelCookie(newHeaders);

                const realIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || (request.headers.get("x-forwarded-for") || "").split(',')[0].trim();
                newHeaders.delete("cf-connecting-ip"); newHeaders.delete("cf-ipcountry"); newHeaders.delete("cf-ray");
                newHeaders.delete("cf-visitor"); newHeaders.delete("x-forwarded-for"); newHeaders.delete("x-real-ip");

                newHeaders.set("X-Forwarded-Proto", url.protocol.replace(':', ''));
                newHeaders.set("X-Forwarded-Host", url.host);

                if (currentMode === 'realip_only' && realIp) { newHeaders.set("X-Real-IP", realIp); }
                else if ((currentMode === 'dual' || isStrictMode) && realIp) { newHeaders.set("X-Real-IP", realIp); newHeaders.set("X-Forwarded-For", realIp); }

                if (isStrictMode) {
                    newHeaders.set("Origin", targetUrl.origin); newHeaders.set("Referer", targetUrl.origin + "/");
                } else {
                    const origin = newHeaders.get("Origin");
                    if (origin && origin === url.origin) newHeaders.set("Origin", targetUrl.origin);
                    const referer = newHeaders.get("Referer");
                    if (referer && referer.startsWith(url.origin)) newHeaders.set("Referer", referer.replace(url.origin, targetUrl.origin));
                }

                const isStaticOrImage = isStaticPath(targetUrl.pathname);
                const authLikeState = hasAuthLikeState(newHeaders, targetUrl);

                let fetchInit = { method: request.method, headers: newHeaders, redirect: isStaticOrImage ? 'follow' : 'manual' };

                // 只缓存不带鉴权态的静态资源
                if (isStaticOrImage && enableCache && !authLikeState) { fetchInit.cf = { cacheEverything: true, cacheTtl: 86400 }; }

                if (canHaveRequestBody) {
                    if (bodyBuffer !== null) {
                        fetchInit.body = bodyBuffer;
                    } else {
                        fetchInit.body = request.body;
                        fetchInit.duplex = 'half';
                    }
                }

                try {
                    const modifiedRequest = new Request(targetUrl, fetchInit); const response = await fetch(modifiedRequest);

                    // 🆕 日志分级（可选）
                    if (ENABLE_DETAILED_LOGGING) {
                        const category = getRequestCategory(targetUrl.pathname);
                        const startTime = Date.now();
                        console.log(`[${category}] ${response.status} ${request.method} ${targetUrl.host}${targetUrl.pathname}${targetUrl.search}`);
                    }

                    // 404/502/503/504 时，尝试同一 target 的下一候选（/emby 回退）
                    if ((response.status === 404 || response.status === 502 || response.status === 503 || response.status === 504) && j < candidateUrls.length - 1) {
                        lastError = new Error(`Node ${i+1} candidate ${j+1} returned HTTP ${response.status}`);
                        continue;
                    }
                    finalResponse = response; finalTargetUrl = targetUrl; break;
                } catch (err) { lastError = err; continue; }
            }
            if (finalResponse) break;
        }

        if (!finalResponse) return new Response("Worker Proxy Failover Exhausted. All nodes failed. Last Error: " + (lastError?.message || 'Unknown Error'), { status: 502 });

        const responseHeaders = new Headers(finalResponse.headers);
        rewriteSetCookieForProxy(responseHeaders);

        // 统一前缀变量，确保绝对安全，不会抛出未定义错误
        const safePrefix = matchedPrefix ? `/${matchedPrefix}` : '';

        // ==========================================
        // 🚀 修复版 302 拦截：恢复 URL 编码
        // ==========================================
        if ([301, 302, 303, 307, 308].includes(finalResponse.status)) {
            const location = responseHeaders.get('Location');
            const rewrittenLocation = rewriteRedirectLocation(location, finalTargetUrl, targetOrigins, proxyOrigin, safePrefix);
            if (rewrittenLocation !== location) {
                responseHeaders.set('Location', rewrittenLocation);
            }
        }

        responseHeaders.set('Access-Control-Allow-Origin', '*');

        // ==========================================
        // 2.10 响应体重写 (接管 PlaybackInfo 与 M3U8)
        // ==========================================

        if (shouldBypassBodyRewrite(request, url.pathname, responseHeaders, finalResponse.status)) {
            applyProxyCacheHeaders(responseHeaders, request, url.pathname, enableCache);
            return new Response(finalResponse.body, { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders });
        }

        // 🔒 PlaybackInfo 完整修复：支持所有地址格式 + 字幕流 DeliveryUrl
        // ⚠️ 透传模式下跳过响应重写，因为客户端期望收到源站真实 URL
        const isPlaybackInfoJson = !isPassthroughMode && finalResponse.status === 200 && responseHeaders.get("content-type")?.includes("json") && url.pathname.toLowerCase().includes("playbackinfo");
        if (isPlaybackInfoJson) {
            try {
                let clonedRes = finalResponse.clone();
                let data = JSON.parse(await readResponseTextWithinLimit(clonedRes, MAX_REWRITE_BODY_BYTES));
                let modified = false;
                if (data && data.MediaSources) {
                    data.MediaSources.forEach(source => {
                        // 播放地址：使用完整的 rewritePlaybackMediaUrl 处理所有格式
                        ['DirectStreamUrl', 'TranscodingUrl', 'Url'].forEach(key => {
                            if (source[key]) {
                                const rewritten = rewritePlaybackMediaUrl(source[key], finalTargetUrl, proxyOrigin, safePrefix, targetOrigins);
                                if (rewritten !== source[key]) {
                                    source[key] = rewritten;
                                    modified = true;
                                }
                            }
                        });
                        // 字幕流的 DeliveryUrl 也会在播放时被客户端直接请求
                        if (source.MediaStreams) {
                            source.MediaStreams.forEach(stream => {
                                if (stream?.DeliveryUrl) {
                                    const rewritten = rewritePlaybackMediaUrl(stream.DeliveryUrl, finalTargetUrl, proxyOrigin, safePrefix, targetOrigins);
                                    if (rewritten !== stream.DeliveryUrl) {
                                        stream.DeliveryUrl = rewritten;
                                        modified = true;
                                    }
                                }
                            });
                        }
                    });
                }
                if (modified) {
                    dropBodyIntegrityHeaders(responseHeaders);
                    return new Response(JSON.stringify(data), { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders });
                }
            } catch (e) {
                console.log("PlaybackInfo JSON 重写失败:", e.message);
            }
        }

        // ==========================================
        // 🔒 UHD 海报墙修复：通用 JSON URL 重写
        // PlaybackInfo 只覆盖播放地址；UHD 图片失败通常发生在其他 JSON 接口里，
        // 例如详情页、图片列表或插件接口返回了源站绝对地址/相对图片路径。
        // ⚠️ 透传模式下跳过响应重写
        // ==========================================
        if (!isPlaybackInfoJson && !isPassthroughMode && finalResponse.status === 200 && responseHeaders.get("content-type")?.includes("json")) {
            try {
                let clonedRes = finalResponse.clone();
                let text = await readResponseTextWithinLimit(clonedRes, MAX_REWRITE_BODY_BYTES);
                if (hasJsonRewriteCandidate(text, targetOrigins)) {
                    let data = JSON.parse(text);
                    let rewritten = rewriteSourceUrlsInJson(data, targetOrigins, proxyOrigin, safePrefix);
                    if (rewritten !== data) {
                        dropBodyIntegrityHeaders(responseHeaders);
                        return new Response(JSON.stringify(rewritten), { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders });
                    }
                }
            } catch(e) {
                console.log("JSON 源站 URL 重写失败:", e.message);
            }
        }

        // 🚀 处理 M3U8 播放列表中的真实视频切片链接
        if (finalResponse.status === 200 && url.pathname.toLowerCase().endsWith('.m3u8')) {
            try {
                let clonedRes = finalResponse.clone(); 
                let text = await readResponseTextWithinLimit(clonedRes, MAX_REWRITE_BODY_BYTES);
                if (text.includes('http://') || text.includes('https://')) {
                    // 🎯 同样修复变量名
                    let modifiedText = text.replace(/(https?:\/\/[^\s]+)/g, proxyOrigin + safePrefix + '/$1');
                    responseHeaders.delete("Content-Length"); 
                    return new Response(modifiedText, { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders });
                }
            } catch(e) {
                console.log("M3U8 重写失败:", e.message);
            }
        }

        // 静态资源缓存控制：使用 UHD 修复的 isStaticPath 和 hasAuthLikeState
        applyProxyCacheHeaders(responseHeaders, request, url.pathname, enableCache);

        return new Response(finalResponse.body, { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders });
    }
};
