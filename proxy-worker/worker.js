const SHARE_ORIGIN = "https://www.terabox.com";
const APP_ID = "250528";

const OUTBOUND_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

const PASS_THROUGH_API_PARAMS = new Set([
  "by",
  "channel",
  "clienttype",
  "dir",
  "dplogid",
  "jsToken",
  "num",
  "order",
  "page",
  "pwd",
  "root",
  "shorturl",
  "site_referer",
  "web",
]);

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405, {
        Allow: "GET, OPTIONS",
      });
    }

    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "resolve";
    const cookies = {
      ...loadCookies(env),
      ...parseCookieHeader(request.headers.get("Cookie")),
    };

    try {
      if (mode === "page") {
        return await pageMode(url.searchParams, cookies);
      }

      if (mode === "api") {
        return await apiMode(url.searchParams, cookies);
      }

      if (mode === "resolve") {
        return await resolveMode(url.searchParams, cookies);
      }

      if (mode === "stream") {
        return await streamMode(request, url.searchParams, cookies);
      }

      if (mode === "segment") {
        return await segmentMode(url.searchParams, cookies);
      }

      return jsonResponse(
        {
          error: "Invalid mode",
          allowed: ["resolve", "page", "api", "stream", "segment"],
          provided: mode,
        },
        400,
      );
    } catch (error) {
      console.error("Proxy Worker error", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : String(error) },
        Number.isInteger(error.status) ? error.status : 500,
      );
    }
  },
};

async function pageMode(params, cookies) {
  const surl = getRequiredSurl(params);
  const page = await fetchSharePage(surl, cookies);
  return withCors(
    new Response(page.html, {
      status: page.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
  );
}

async function apiMode(params, cookies) {
  const jsToken = params.get("jsToken");
  const shorturl = normalizeSurl(params.get("shorturl") || params.get("surl"));
  if (!jsToken || !shorturl) {
    return jsonResponse(
      { error: "Missing required parameters: jsToken and shorturl" },
      400,
    );
  }

  const apiParams = createApiParams(params);
  apiParams.set("jsToken", jsToken);
  apiParams.set("shorturl", shorturl);

  const data = await fetchShareApi(apiParams, cookies);
  return jsonResponse(data);
}

async function resolveMode(params, cookies) {
  const { data } = await resolveShare(params, cookies);
  if (params.get("raw") === "1") {
    return jsonResponse({ source: "live", upstream: data });
  }
  return jsonResponse({ source: "live", data });
}

async function streamMode(request, params, cookies) {
  const { data } = await resolveShare(params, cookies);
  const playlistUrl = findPlaylistUrl(data, params.get("type"));
  if (!playlistUrl) {
    return jsonResponse(
      {
        error: "No HLS playlist URL found in upstream response",
        errno: data.errno ?? -1,
      },
      404,
    );
  }

  const response = await fetch(playlistUrl, {
    headers: outboundHeaders(cookies, { Referer: SHARE_ORIGIN }),
  });
  if (!response.ok) {
    return jsonResponse(
      { error: `Playlist request failed: ${response.status}` },
      response.status,
    );
  }

  const playlist = await response.text();
  const rewritten = rewritePlaylist(playlist, playlistUrl, request.url);
  return withCors(
    new Response(rewritten, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
  );
}

async function segmentMode(params, cookies) {
  const target = params.get("url");
  if (!target) {
    return jsonResponse({ error: "Missing required parameter: url" }, 400);
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return jsonResponse({ error: "Invalid segment URL" }, 400);
  }

  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    return jsonResponse({ error: "Unsupported segment URL protocol" }, 400);
  }

  const response = await fetch(targetUrl.toString(), {
    headers: outboundHeaders(cookies, { Referer: SHARE_ORIGIN }),
  });

  return withCors(
    new Response(response.body, {
      status: response.status,
      headers: filteredHeaders(response.headers),
    }),
  );
}

async function resolveShare(params, cookies) {
  const surl = getRequiredSurl(params);
  const page = await fetchSharePage(surl, cookies);
  if (page.status < 200 || page.status >= 400) {
    throw new Error(`Share page request failed: ${page.status}`);
  }

  const tokens = extractTokens(page.html);
  if (!tokens.jsToken) {
    return {
      data: {
        error: "Could not extract jsToken from share page",
        errno: -1,
      },
      tokens,
    };
  }

  const apiParams = createApiParams(params);
  apiParams.set("jsToken", tokens.jsToken);
  apiParams.set("shorturl", surl);
  if (tokens.dplogid && !apiParams.has("dplogid")) {
    apiParams.set("dplogid", tokens.dplogid);
  }

  const data = await fetchShareApi(apiParams, cookies, page.url);
  if (data && typeof data === "object") {
    data.jsToken ||= tokens.jsToken;
    data.dplogid ||= tokens.dplogid;
  }

  return { data, tokens };
}

async function fetchSharePage(surl, cookies) {
  const pageUrl = new URL(`/s/1${normalizeSurl(surl)}`, SHARE_ORIGIN);
  const response = await fetch(pageUrl.toString(), {
    headers: outboundHeaders(cookies, { Referer: SHARE_ORIGIN }),
    redirect: "follow",
  });

  return {
    html: await response.text(),
    status: response.status,
    url: response.url,
  };
}

async function fetchShareApi(params, cookies, referer = SHARE_ORIGIN) {
  const apiUrl = new URL("/share/list", SHARE_ORIGIN);
  for (const [key, value] of params.entries()) {
    apiUrl.searchParams.set(key, value);
  }

  const response = await fetch(apiUrl.toString(), {
    headers: outboundHeaders(cookies, { Referer: referer }),
  });

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: "Upstream API did not return JSON",
      status: response.status,
      body: text.slice(0, 500),
      errno: -1,
    };
  }
}

function createApiParams(input) {
  const params = new URLSearchParams({
    app_id: APP_ID,
    web: "1",
    channel: "dubox",
    clienttype: "0",
    page: "1",
    num: "100",
    by: "name",
    order: "asc",
    site_referer: "",
  });

  for (const [key, value] of input.entries()) {
    if (PASS_THROUGH_API_PARAMS.has(key)) {
      params.set(key, value);
    }
  }

  if (params.has("dir") && !params.has("root")) {
    params.set("root", "0");
  } else if (!params.has("root")) {
    params.set("root", "1");
  }

  return params;
}

function extractTokens(html) {
  const decoded = safeDecodeURIComponent(html);
  const candidates = [html, decoded];
  const jsPatterns = [
    /"jsToken"\s*:\s*"([^"]+)"/i,
    /jsToken\s*[:=]\s*["']([^"']+)["']/i,
    /jsToken%22%3A%22([^%"]+)/i,
  ];
  const logPatterns = [
    /"dplogid"\s*:\s*"([^"]+)"/i,
    /dplogid\s*[:=]\s*["']([^"']+)["']/i,
    /dp-logid=([^&"'<>]+)/i,
  ];

  return {
    jsToken: firstMatch(candidates, jsPatterns),
    dplogid: firstMatch(candidates, logPatterns),
  };
}

function firstMatch(candidates, patterns) {
  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (match?.[1]) {
        return cleanupToken(match[1]);
      }
    }
  }
  return "";
}

function cleanupToken(value) {
  return value
    .replaceAll("\\/", "/")
    .replaceAll("\\u002F", "/")
    .replaceAll("&quot;", "")
    .trim();
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function findPlaylistUrl(data, requestedType) {
  const strings = [];
  collectStrings(data, strings);

  if (requestedType) {
    const typed = strings.find(
      (value) => value.includes(".m3u8") && value.includes(requestedType),
    );
    if (typed) {
      return typed;
    }
  }

  return strings.find((value) => value.includes(".m3u8")) || "";
}

function collectStrings(value, output) {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    output.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, output);
    }
  }
}

function rewritePlaylist(playlist, playlistUrl, requestUrl) {
  const base = new URL(playlistUrl);
  const self = new URL(requestUrl);

  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line;
      }

      const segmentUrl = new URL(trimmed, base).toString();
      const proxyUrl = new URL(self.origin + self.pathname);
      proxyUrl.searchParams.set("mode", "segment");
      proxyUrl.searchParams.set("url", segmentUrl);
      return proxyUrl.toString();
    })
    .join("\n");
}

function getRequiredSurl(params) {
  const surl = normalizeSurl(params.get("surl") || params.get("shorturl"));
  if (!surl) {
    throw httpError("Missing required parameter: surl", 400);
  }
  return surl;
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeSurl(value) {
  const raw = String(value || "").trim();
  return raw.startsWith("1") ? raw.slice(1) : raw;
}

function outboundHeaders(cookies, extra = {}) {
  const headers = new Headers({ ...OUTBOUND_HEADERS, ...extra });
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
    return { ndus: raw.trim() };
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

function filteredHeaders(headers) {
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
