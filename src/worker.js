const ALLOWED_HOSTS = new Set([
  "terabox.app",
  "www.terabox.app",
  "teraboxshare.com",
  "www.teraboxshare.com",
  "terabox.com",
  "www.terabox.com",
  "1024terabox.com",
  "www.1024terabox.com",
  "teraboxlink.com",
  "terasharefile.com",
  "terafileshare.com",
  "terasharelink.com",
]);

const PROXY_MODE_RESOLVE = "resolve";
const PROXY_MODE_PAGE = "page";
const PROXY_MODE_API = "api";
const PROXY_MODE_STREAM = "stream";
const PROXY_MODE_SEGMENT = "segment";
const VALID_PROXY_MODES = new Set([
  PROXY_MODE_RESOLVE,
  PROXY_MODE_PAGE,
  PROXY_MODE_API,
  PROXY_MODE_STREAM,
  PROXY_MODE_SEGMENT,
]);

const OUTBOUND_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

const responseCache = new Map();
const rateHits = new Map();

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    try {
      if (path === "/") {
        return jsonResponse(apiInfo());
      }

      if (path === "/health") {
        return jsonResponse(healthInfo());
      }

      if (path === "/help") {
        return jsonResponse(helpInfo());
      }

      if (path === "/v1") {
        return jsonResponse(v1Info());
      }

      if (path === "/v1/health") {
        return jsonResponse(healthInfo());
      }

      if (path === "/v1/echo") {
        return jsonResponse(v1Echo(request, url));
      }

      if (path === "/api" || path === "/api2") {
        if (request.method !== "GET") {
          return jsonResponse(
            { status: "error", message: "Method not allowed" },
            405,
            { Allow: "GET, OPTIONS" },
          );
        }

        const limited = checkRateLimit(request, env);
        if (limited) {
          return limited;
        }

        if (path === "/api") {
          return await apiHandler(request, env);
        }
        return await api2Handler(request, env);
      }

      return jsonResponse(
        {
          status: "error",
          message: "Not found",
          endpoints: ["/", "/health", "/api", "/api2", "/help", "/v1"],
        },
        404,
      );
    } catch (error) {
      console.error("Worker error", error);
      return jsonResponse(
        {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  },
};

async function apiHandler(request, env) {
  const start = Date.now();
  const requestUrl = new URL(request.url);
  const mode = requestUrl.searchParams.get("mode");
  const shareUrl = requestUrl.searchParams.get("url");

  if (mode) {
    if (!VALID_PROXY_MODES.has(mode)) {
      return jsonResponse(
        {
          error: "Invalid mode",
          allowed: Array.from(VALID_PROXY_MODES),
          provided: mode,
        },
        400,
      );
    }

    const validationError = validateProxyMode(mode, requestUrl.searchParams);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }

    const params = new URLSearchParams();
    params.set("mode", mode);
    for (const [key, value] of requestUrl.searchParams.entries()) {
      if (key !== "mode") {
        params.append(key, value);
      }
    }

    let cookies = parseCookieHeader(request.headers.get("Cookie"));
    if (Object.keys(cookies).length === 0) {
      cookies = loadCookies(env);
    }

    return await proxyRequest(env, params, cookies);
  }

  if (!shareUrl) {
    return jsonResponse(
      {
        status: "error",
        message: "Missing required parameter: url or mode",
        examples: {
          file_listing: "/api?url=https://teraboxshare.com/s/...",
          proxy_resolve: "/api?mode=resolve&surl=abc123",
          proxy_stream: "/api?mode=stream&surl=abc123",
        },
      },
      400,
    );
  }

  if (!isValidShareUrl(shareUrl)) {
    return jsonResponse(
      {
        status: "error",
        message: "Invalid TeraBox share URL",
        example: "/api?url=https://teraboxshare.com/s/XXXXXXXX",
      },
      400,
    );
  }

  const password = requestUrl.searchParams.get("pwd") || "";
  const cached = cacheGet(shareUrl, password, env);
  if (cached !== null) {
    const formattedFiles = cached.map(formatFileInfo);
    return jsonResponse({
      status: "success",
      url: shareUrl,
      files: formattedFiles,
      total_files: formattedFiles.length,
      response_time: formatResponseTime((Date.now() - start) / 1000),
      cached: true,
      timestamp: nowIso(),
    });
  }

  const linkData = await fetchDownloadLink(shareUrl, password, env);
  if (linkData && !Array.isArray(linkData) && linkData.error) {
    return jsonResponse(
      {
        status: "error",
        url: shareUrl,
        error: linkData.error,
        errno: linkData.errno,
        message: linkData.message || "",
        requires_password: linkData.requires_password || false,
      },
      linkData.requires_password ? 400 : 500,
    );
  }

  if (Array.isArray(linkData) && linkData.length > 0) {
    cachePut(shareUrl, linkData, password, env);
    const formattedFiles = linkData.map(formatFileInfo);
    return jsonResponse({
      status: "success",
      url: shareUrl,
      files: formattedFiles,
      total_files: formattedFiles.length,
      response_time: formatResponseTime((Date.now() - start) / 1000),
      timestamp: nowIso(),
    });
  }

  return jsonResponse(
    { status: "error", message: "No files found", url: shareUrl },
    404,
  );
}

async function api2Handler(request, env) {
  const start = Date.now();
  const requestUrl = new URL(request.url);
  const shareUrl = requestUrl.searchParams.get("url");

  if (!shareUrl) {
    return jsonResponse(
      {
        status: "error",
        message: "Missing required parameter: url",
        example: "/api2?url=https://teraboxshare.com/s/...",
      },
      400,
    );
  }

  if (!isValidShareUrl(shareUrl)) {
    return jsonResponse(
      {
        status: "error",
        message: "Invalid TeraBox share URL",
        example: "/api2?url=https://teraboxshare.com/s/XXXXXXXX",
      },
      400,
    );
  }

  const password = requestUrl.searchParams.get("pwd") || "";
  const linkData = await fetchDirectLinks(shareUrl, password, env);
  if (linkData && !Array.isArray(linkData) && linkData.error) {
    return jsonResponse(
      {
        status: "error",
        url: shareUrl,
        error: linkData.error,
        errno: linkData.errno,
      },
      500,
    );
  }

  if (Array.isArray(linkData) && linkData.length > 0) {
    const formattedFiles = normalizeApi2Items(linkData);
    return jsonResponse({
      status: "success",
      url: shareUrl,
      files: formattedFiles,
      total_files: formattedFiles.length,
      response_time: formatResponseTime((Date.now() - start) / 1000),
      timestamp: nowIso(),
    });
  }

  return jsonResponse(
    { status: "error", message: "No files found", url: shareUrl },
    404,
  );
}

async function fetchDownloadLink(shareUrl, password, env) {
  try {
    const surl = extractSurl(shareUrl);
    if (!surl) {
      return { error: "Invalid URL format", errno: -1 };
    }

    const params = new URLSearchParams({
      mode: PROXY_MODE_RESOLVE,
      surl,
      raw: "1",
    });
    if (password) {
      params.set("pwd", password);
    }

    const proxyUrl = buildProxyUrl(env, params);
    const response = await fetch(proxyUrl, {
      headers: outboundHeaders(loadCookies(env)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Proxy returned ${response.status}: ${errorText}`);
      return {
        error: `Proxy error: ${response.status}`,
        errno: -1,
        details: errorText.slice(0, 200),
      };
    }

    const responseData = await response.json();
    if (responseData.error) {
      const errorMessage = responseData.error || "Unknown error";
      if (
        errorMessage.includes("jsToken") ||
        errorMessage.toLowerCase().includes("cookie")
      ) {
        return {
          error: errorMessage,
          errno: -1,
          message:
            "Failed to extract authentication tokens. Cookies may be required for this share.",
        };
      }
      return { error: errorMessage, errno: -1 };
    }

    let apiResponse = responseData.upstream || responseData.data || responseData;
    const errno = Number(apiResponse.errno ?? -1);

    if (errno === 400141) {
      return {
        error: "Verification required",
        errno: 400141,
        message: "This link requires password or captcha verification",
        surl,
        requires_password: true,
      };
    }

    if (errno !== 0) {
      return { error: apiResponse.errmsg || "Unknown error", errno };
    }

    if (!Array.isArray(apiResponse.list)) {
      return { error: "No files found in response", errno: -1 };
    }

    let files = apiResponse.list;
    if (files.length > 0 && String(files[0]?.isdir) === "1") {
      const jsToken = apiResponse.jsToken;
      const logId = apiResponse.dplogid;
      if (!jsToken) {
        return files;
      }

      const dirParams = new URLSearchParams({
        mode: PROXY_MODE_API,
        jsToken,
        shorturl: surl,
        dir: files[0].path,
        order: "asc",
        by: "name",
      });
      if (logId) {
        dirParams.set("dplogid", logId);
      }
      if (password) {
        dirParams.set("pwd", password);
      }

      const dirResponse = await fetch(buildProxyUrl(env, dirParams), {
        headers: outboundHeaders(loadCookies(env)),
      });
      if (!dirResponse.ok) {
        return files;
      }

      let dirData = await dirResponse.json();
      if (dirData.data) {
        dirData = dirData.data;
      }

      if (Array.isArray(dirData.list) && Number(dirData.errno) === 0) {
        files = dirData.list;
      }
    }

    return files;
  } catch (error) {
    console.error("Unexpected fetchDownloadLink error", error);
    return {
      error: error instanceof Error ? error.message : String(error),
      errno: -1,
    };
  }
}

async function fetchDirectLinks(shareUrl, password, env) {
  try {
    const files = await fetchDownloadLink(shareUrl, password, env);
    if (files && !Array.isArray(files) && files.error) {
      return files;
    }

    const results = [];
    for (const item of files || []) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const dlink = item.dlink || "";
      let directLink = null;
      if (dlink) {
        try {
          const response = await fetch(dlink, {
            method: "HEAD",
            redirect: "manual",
            headers: outboundHeaders(loadCookies(env)),
          });
          directLink = response.headers.get("Location");
        } catch (error) {
          console.error("Error getting direct link", error);
        }
      }

      results.push({
        filename: item.server_filename || "Unknown",
        size: getFormattedSize(item.size || 0),
        size_bytes: item.size || 0,
        link: dlink,
        direct_link: directLink,
        thumbnail: item.thumbs?.url3 || "",
      });
    }

    return results;
  } catch (error) {
    console.error("fetchDirectLinks error", error);
    return {
      error: error instanceof Error ? error.message : String(error),
      errno: -1,
    };
  }
}

async function proxyRequest(env, params, cookies) {
  try {
    const response = await fetch(buildProxyUrl(env, params), {
      headers: outboundHeaders(cookies),
    });

    const contentType = response.headers.get("Content-Type") || "application/json";
    const content = await response.arrayBuffer();

    if (!response.ok) {
      const text = new TextDecoder().decode(content);
      try {
        const details = JSON.parse(text);
        return jsonResponse(
          {
            error: details.error || "Proxy request failed",
            status_code: response.status,
            details,
          },
          response.status,
        );
      } catch {
        return jsonResponse(
          {
            error: `Proxy returned status ${response.status}`,
            status_code: response.status,
            details: text.slice(0, 500),
          },
          response.status,
        );
      }
    }

    return withCors(
      new Response(content, {
        status: response.status,
        headers: filteredProxyHeaders(response.headers, contentType),
      }),
    );
  } catch (error) {
    console.error("Proxy request error", error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
        status_code: 500,
      },
      500,
    );
  }
}

function validateProxyMode(mode, params) {
  if (mode === PROXY_MODE_RESOLVE && !params.has("surl")) {
    return "Missing required parameter: surl";
  }
  if (mode === PROXY_MODE_PAGE && !params.has("surl")) {
    return "Missing required parameter: surl";
  }
  if (
    mode === PROXY_MODE_API &&
    (!params.has("jsToken") || !params.has("shorturl"))
  ) {
    return "Missing required parameters: jsToken and shorturl";
  }
  if (mode === PROXY_MODE_STREAM && !params.has("surl")) {
    return "Missing required parameter: surl";
  }
  if (mode === PROXY_MODE_SEGMENT && !params.has("url")) {
    return "Missing required parameter: url";
  }
  return null;
}

function buildProxyUrl(env, params) {
  const base = (env.PROXY_BASE_URL || "").trim();
  if (!base) {
    throw new Error("PROXY_BASE_URL is not configured");
  }
  const proxyUrl = new URL(base);
  for (const [key, value] of params.entries()) {
    proxyUrl.searchParams.append(key, value);
  }
  return proxyUrl.toString();
}

function outboundHeaders(cookies) {
  const headers = new Headers(OUTBOUND_HEADERS);
  const cookieHeader = serializeCookies(cookies);
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }
  return headers;
}

function loadCookies(env) {
  const raw = env.COOKIE_JSON || env.TERABOX_COOKIES_JSON || "";
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)]),
      );
    }
  } catch {
    const token = raw.trim();
    if (token) {
      return { ndus: token };
    }
  }

  return {};
}

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key && rest.length > 0) {
      cookies[key] = rest.join("=");
    }
  }
  return cookies;
}

function serializeCookies(cookies) {
  return Object.entries(cookies || {})
    .filter(([key, value]) => key && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function isValidShareUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
      return false;
    }
    return parsed.pathname.includes("/s/") || parsed.searchParams.has("surl");
  } catch {
    return false;
  }
}

function extractSurl(shareUrl) {
  try {
    const parsed = new URL(shareUrl);
    let surl = parsed.searchParams.get("surl") || "";
    if (!surl && parsed.pathname.includes("/s/")) {
      surl = parsed.pathname.split("/s/")[1].split("/")[0].split("?")[0];
    }
    if (surl.startsWith("1")) {
      surl = surl.slice(1);
    }
    return surl;
  } catch {
    return "";
  }
}

function formatFileInfo(fileData) {
  const thumbnails = {};
  if (fileData.thumbs && typeof fileData.thumbs === "object") {
    for (const [key, value] of Object.entries(fileData.thumbs)) {
      if (value) {
        thumbnails[extractThumbnailDimensions(value)] = value;
      }
    }
  }

  return {
    filename: fileData.server_filename || "Unknown",
    size: getFormattedSize(fileData.size || 0),
    size_bytes: fileData.size || 0,
    download_link: fileData.dlink || "",
    is_directory: String(fileData.isdir) === "1",
    thumbnails,
    path: fileData.path || "",
    fs_id: fileData.fs_id || "",
  };
}

function normalizeApi2Items(items) {
  const output = [];
  for (const item of items || []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const filename = item.filename || item.server_filename || "Unknown";
    const size =
      typeof item.size === "string" ? item.size : getFormattedSize(item.size || 0);
    const sizeBytes = item.size_bytes || item.size || 0;
    const download =
      item.direct_link ||
      item.download_link ||
      item.link ||
      item.dlink ||
      "";
    const thumbnail = item.thumbnail || item.thumbs?.url3 || "";
    const thumbnails = thumbnail ? { original: thumbnail } : {};

    const formatted = {
      filename,
      size,
      size_bytes: sizeBytes,
      download_link: download,
      is_directory: item.is_directory || false,
      thumbnails,
      path: item.path || "",
      fs_id: item.fs_id || "",
    };
    if (item.direct_link) {
      formatted.direct_link = item.direct_link;
    }
    output.push(formatted);
  }
  return output;
}

function extractThumbnailDimensions(value) {
  try {
    const parsed = new URL(value);
    const size = parsed.searchParams.get("size") || "";
    if (size) {
      const parts = size.replace("c", "").split("_u");
      if (parts.length === 2) {
        return `${parts[0]}x${parts[1]}`;
      }
    }
  } catch {
    // Keep the fallback below for malformed thumbnail URLs.
  }
  return "original";
}

function getFormattedSize(sizeBytes) {
  const bytes = Number.parseInt(sizeBytes, 10);
  if (Number.isNaN(bytes)) {
    return "Unknown";
  }

  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes.toFixed(2)} bytes`;
}

function cacheKey(shareUrl, password) {
  return `${shareUrl}|${password}`;
}

function cacheGet(shareUrl, password, env) {
  const key = cacheKey(shareUrl, password);
  const entry = responseCache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }

  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.data;
}

function cachePut(shareUrl, data, password, env) {
  const maxSize = getIntegerEnv(env, "CACHE_MAX_SIZE", 500);
  const ttlSeconds = getIntegerEnv(env, "CACHE_TTL", 60);
  if (ttlSeconds <= 0 || maxSize <= 0) {
    return;
  }

  responseCache.set(cacheKey(shareUrl, password), {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  while (responseCache.size > maxSize) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
}

function checkRateLimit(request, env) {
  const maxRequests = getIntegerEnv(env, "RATE_LIMIT", 0);
  const windowSeconds = getIntegerEnv(env, "RATE_WINDOW", 60);
  if (maxRequests <= 0 || windowSeconds <= 0) {
    return null;
  }

  const ip = getClientIp(request);
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;
  const hits = (rateHits.get(ip) || []).filter((timestamp) => timestamp > cutoff);

  if (hits.length >= maxRequests) {
    const retryAfter = Math.floor(windowSeconds - (now - hits[0]) / 1000) + 1;
    rateHits.set(ip, hits);
    return jsonResponse(
      {
        status: "error",
        message: "Rate limit exceeded",
        retry_after: retryAfter,
        limit: `${maxRequests} requests per ${windowSeconds}s`,
      },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  hits.push(now);
  rateHits.set(ip, hits);
  return null;
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown"
  );
}

function getIntegerEnv(env, key, fallback) {
  const value = Number.parseInt(env[key], 10);
  return Number.isFinite(value) ? value : fallback;
}

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function formatResponseTime(seconds) {
  if (seconds >= 60) {
    return `${round(seconds / 60, 2)}m`;
  }
  return `${round(seconds, 3)}s`;
}

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function filteredProxyHeaders(headers, fallbackContentType) {
  const output = new Headers();
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (
      [
        "connection",
        "content-length",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
      ].includes(lower)
    ) {
      continue;
    }
    output.set(key, value);
  }
  if (!output.has("Content-Type")) {
    output.set("Content-Type", fallbackContentType);
  }
  return output;
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...extraHeaders,
      },
    }),
  );
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function nowIso() {
  return new Date().toISOString();
}

function apiInfo() {
  return {
    name: "TeraBox API",
    version: "2.0",
    status: "operational",
    runtime: "cloudflare-workers",
    endpoints: {
      "/": "API information",
      "/api":
        "Unified endpoint - file listing and proxy modes (resolve, page, api, stream, segment)",
      "/api2": "Fetch files with direct download links",
      "/help": "Detailed usage instructions",
      "/health": "Health check",
      "/v1": "Versioned metadata namespace",
    },
    timestamp: nowIso(),
  };
}

function healthInfo() {
  return { status: "healthy", timestamp: nowIso() };
}

function v1Info() {
  return {
    name: "TeraBox API",
    namespace: "/v1",
    version: "1.0",
    status: "operational",
    endpoints: {
      "/v1": "This metadata",
      "/v1/health": "Health check for v1",
      "/v1/echo": "Echo query parameters and selected headers",
    },
    timestamp: nowIso(),
  };
}

function v1Echo(request, url) {
  const headersWhitelist = new Set([
    "user-agent",
    "x-forwarded-for",
    "x-real-ip",
    "cf-connecting-ip",
    "x-request-id",
  ]);
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    if (headersWhitelist.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }

  return {
    args: Object.fromEntries(url.searchParams.entries()),
    headers,
    timestamp: nowIso(),
  };
}

function helpInfo() {
  return {
    "TeraBox API Documentation": {
      version: "2.0",
      description: "Extract file information from TeraBox share links",
      Endpoints: {
        "/api": {
          method: "GET",
          description: "Unified endpoint - file information and proxy modes",
          usage_patterns: {
            file_listing: {
              description: "Traditional file listing (backward compatible)",
              parameters: {
                url: "Required - TeraBox share link",
                pwd: "Optional - Password for protected links",
              },
              example: "/api?url=https://teraboxshare.com/s/1ABC...",
            },
            proxy_modes: {
              description: "Direct proxy access with multiple modes",
              modes: {
                resolve: {
                  description:
                    "Auto extract jsToken + fetch share API (recommended)",
                  parameters: { surl: "Required - Short URL ID" },
                  example: "/api?mode=resolve&surl=abc123",
                },
                page: {
                  description: "Proxy raw share HTML page",
                  parameters: { surl: "Required - Short URL ID" },
                  example: "/api?mode=page&surl=abc123",
                },
                api: {
                  description:
                    "Manual share API proxy (when jsToken is known)",
                  parameters: {
                    jsToken: "Required - JavaScript token",
                    shorturl: "Required - Short URL ID",
                    root: "Optional - Default: 1",
                    dplogid: "Optional - Log ID",
                  },
                  example:
                    "/api?mode=api&jsToken=XYZ&shorturl=abc123",
                },
                stream: {
                  description:
                    "Fetch and rewrite M3U8 playlist for HLS streaming",
                  parameters: {
                    surl: "Required - Short URL ID",
                    type: "Optional - Stream quality (default: M3U8_AUTO_360)",
                  },
                  example:
                    "/api?mode=stream&surl=abc123&type=M3U8_AUTO_360",
                },
                segment: {
                  description: "Proxy media segments (.ts, .m4s)",
                  parameters: { url: "Required - Encoded segment URL" },
                  example: "/api?mode=segment&url=ENCODED_URL",
                },
              },
              notes: [
                "Cookies are forwarded from client request if provided",
                "Use mode=resolve for most use cases",
                "Stream and segment modes enable HLS video playback",
              ],
            },
          },
        },
        "/api2": {
          method: "GET",
          description: "Fetch files with direct download links",
          parameters: {
            url: "Required - TeraBox share link",
            pwd: "Optional - Password for protected links",
          },
          example: "/api2?url=https://teraboxshare.com/s/1ABC...",
        },
      },
      "Error Codes": {
        0: "Success",
        "-1": "General error",
        400141: "Verification required (password/captcha)",
      },
      "Response Format": {
        success: {
          status: "success",
          url: "The requested URL",
          files: "Array of file objects",
          total_files: "Number of files",
          response_time: "Request processing time",
          timestamp: "ISO timestamp",
        },
        error: {
          status: "error",
          message: "Error description",
          errno: "Error code",
        },
      },
      Notes: [
        "Cookies must be updated regularly (they expire)",
        "Links requiring passwords need pwd parameter",
        "Some links may require captcha verification",
        "Rate limiting may apply",
      ],
    },
  };
}
