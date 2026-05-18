const STATE_COOKIE = "decap_oauth_state";
const STATE_MAX_AGE = 600;
const ADMIN_DEFAULT_ID = "admin";
const ADMIN_DEFAULT_PASSWORD = "1q2w3e4r!Q";
const ADMIN_SESSION_COOKIE = "thai_bam_admin_session";
const ADMIN_SESSION_TTL = 60 * 60 * 12;
const ADMIN_ENTRY_QUERY_KEY = "admin_auth";
const ADMIN_ENTRY_QUERY_VALUE = "1";
const CMS_GITHUB_TOKEN_ENV_KEYS = ["GITHUB_CMS_TOKEN", "GITHUB_PAT", "GITHUB_ACCESS_TOKEN"];

function html(body, status = 200, headers = {}) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title></head><body>${body}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        ...headers,
      },
    }
  );
}

function parseCookie(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const chunk of cookieHeader.split(";")) {
    const [rawKey, ...rest] = chunk.trim().split("=");
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

function oauthError(message) {
  const safe = JSON.stringify({ error: message });
  return html(
    `<script>
      if (window.opener) {
        window.opener.postMessage(${safe}, window.location.origin);
      }
      document.body.innerText = ${JSON.stringify(message)};
      setTimeout(() => window.close(), 200);
    </script>`,
    400
  );
}

function getAdminCredentials(env) {
  return {
    id: env.ADMIN_LOGIN_ID || ADMIN_DEFAULT_ID,
    password: env.ADMIN_LOGIN_PASSWORD || ADMIN_DEFAULT_PASSWORD,
  };
}

function getAdminSessionSecret(env) {
  return env.ADMIN_SESSION_SECRET || `${getAdminCredentials(env).id}:${getAdminCredentials(env).password}:thai-bam-admin`;
}

function toBase64UrlFromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64UrlToBytes(value) {
  let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toBase64UrlFromText(value) {
  return toBase64UrlFromBytes(new TextEncoder().encode(value));
}

function fromBase64UrlToText(value) {
  return new TextDecoder().decode(fromBase64UrlToBytes(value));
}

async function signString(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64UrlFromBytes(new Uint8Array(signature));
}

async function createAdminSessionToken(env) {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL,
  };
  const encodedPayload = toBase64UrlFromText(JSON.stringify(payload));
  const signature = await signString(encodedPayload, getAdminSessionSecret(env));
  return `${encodedPayload}.${signature}`;
}

async function isAdminSessionValid(request, env) {
  const sessionToken = parseCookie(request.headers.get("cookie"))[ADMIN_SESSION_COOKIE];
  if (!sessionToken) return false;

  const [encodedPayload, signature] = sessionToken.split(".");
  if (!encodedPayload || !signature) return false;

  const expected = await signString(encodedPayload, getAdminSessionSecret(env));
  if (signature !== expected) return false;

  try {
    const payload = JSON.parse(fromBase64UrlToText(encodedPayload));
    if (!payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

function sanitizeNextPath(value) {
  if (!value) return "/admin/";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "/admin/";
}

function isAdminEntryPath(pathname) {
  return pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/index.html";
}

function isProtectedPath(pathname) {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/oauth" || pathname.startsWith("/oauth/");
}

function getCmsGithubToken(env) {
  for (const key of CMS_GITHUB_TOKEN_ENV_KEYS) {
    const value = env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function oauthSuccessScript(token) {
  const content = {
    token,
    provider: "github",
  };
  const message = `authorization:github:success:${JSON.stringify(content)}`;
  return html(
    `<script>
      if (window.opener) {
        window.opener.postMessage("authorizing:github", window.location.origin);
        window.opener.postMessage(${JSON.stringify(message)}, window.location.origin);
      }
      window.close();
    </script>`,
    200,
    {
      "set-cookie": `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      "cache-control": "no-store",
    }
  );
}

function loginPage(url, errorMessage = "") {
  const nextPath = sanitizeNextPath(url.searchParams.get("next"));
  return html(
    `<style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090f;color:#f5f7ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
      .wrap{width:min(420px,92vw);padding:26px;border:1px solid #2a3145;border-radius:14px;background:#101522}
      h1{margin:0 0 10px;font-size:1.25rem}
      p{margin:0 0 16px;color:#b8c2d9;line-height:1.5}
      label{display:block;margin:0 0 6px;font-size:.9rem;color:#dbe4f8}
      input{width:100%;min-height:42px;border:1px solid #33425e;border-radius:10px;background:#0c1120;color:#f5f7ff;padding:0 12px;margin:0 0 12px}
      button{width:100%;min-height:44px;border:0;border-radius:10px;background:#ff34ae;color:#fff;font-weight:700;cursor:pointer}
      .err{margin:0 0 12px;padding:9px 10px;border:1px solid #8d2b4d;border-radius:10px;background:#3a1120;color:#ffd5e3}
    </style>
    <div class="wrap">
      <h1>관리자 로그인</h1>
      <p>관리자 페이지 접근 전, 아이디와 비밀번호를 입력해 주세요.</p>
      ${errorMessage ? `<div class="err">${errorMessage}</div>` : ""}
      <form method="post" action="/admin-login?next=${encodeURIComponent(nextPath)}">
        <label for="admin-id">ID</label>
        <input id="admin-id" name="id" autocomplete="username" required />
        <label for="admin-password">Password</label>
        <input id="admin-password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">로그인</button>
      </form>
    </div>`
  );
}

function redirectToLogin(url) {
  const next = sanitizeNextPath(`${url.pathname}${url.search}`);
  return new Response(null, {
    status: 302,
    headers: {
      location: `/admin-login?next=${encodeURIComponent(next)}`,
      "cache-control": "no-store",
    },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (isAdminEntryPath(url.pathname) && request.method === "GET" && url.searchParams.get(ADMIN_ENTRY_QUERY_KEY) !== ADMIN_ENTRY_QUERY_VALUE) {
    return loginPage(url);
  }

  if (url.pathname === "/admin-login") {
    if (request.method === "GET") {
      return loginPage(url);
    }

    if (request.method === "POST") {
      const formData = await request.formData().catch(() => null);
      const id = String(formData?.get("id") || "");
      const password = String(formData?.get("password") || "");
      const valid = getAdminCredentials(env);

      if (id === valid.id && password === valid.password) {
        const token = await createAdminSessionToken(env);
        const nextPath = sanitizeNextPath(url.searchParams.get("next"));
        const nextUrl = new URL(nextPath, url.origin);
        if (isAdminEntryPath(nextUrl.pathname)) {
          nextUrl.searchParams.set(ADMIN_ENTRY_QUERY_KEY, ADMIN_ENTRY_QUERY_VALUE);
        }
        const location = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
        return new Response(null, {
          status: 302,
          headers: {
            location,
            "set-cookie": `${ADMIN_SESSION_COOKIE}=${token}; Path=/; Max-Age=${ADMIN_SESSION_TTL}; HttpOnly; Secure; SameSite=Lax`,
            "cache-control": "no-store",
          },
        });
      }

      return loginPage(url, "아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    return new Response("Method Not Allowed", { status: 405 });
  }

  if (url.pathname === "/admin-logout") {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/admin-login",
        "set-cookie": `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
        "cache-control": "no-store",
      },
    });
  }

  if (isProtectedPath(url.pathname)) {
    const sessionValid = await isAdminSessionValid(request, env);
    if (!sessionValid) {
      if (isAdminEntryPath(url.pathname) && request.method === "GET") {
        return loginPage(url);
      }
      return redirectToLogin(url);
    }

    if (isAdminEntryPath(url.pathname) && url.searchParams.get(ADMIN_ENTRY_QUERY_KEY) !== ADMIN_ENTRY_QUERY_VALUE) {
      return loginPage(url);
    }
  }

  if (url.pathname === "/oauth") {
    const directToken = getCmsGithubToken(env);
    if (directToken) {
      return oauthSuccessScript(directToken);
    }

    const clientId = env.GITHUB_OAUTH_CLIENT_ID;
    if (!clientId) {
      return oauthError("Missing OAuth config. Set GITHUB_OAUTH_CLIENT_ID or use GITHUB_CMS_TOKEN.");
    }

    const state = crypto.randomUUID().replace(/-/g, "");
    const redirectUri = `${url.origin}/oauth/callback`;
    const gh = new URL("https://github.com/login/oauth/authorize");
    gh.searchParams.set("client_id", clientId);
    gh.searchParams.set("redirect_uri", redirectUri);
    gh.searchParams.set("scope", "repo");
    gh.searchParams.set("state", state);
    gh.searchParams.set("allow_signup", "false");

    return new Response(null, {
      status: 302,
      headers: {
        location: gh.toString(),
        "set-cookie": `${STATE_COOKIE}=${state}; Path=/; Max-Age=${STATE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  if (url.pathname === "/oauth/callback") {
    const clientId = env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return oauthError("Missing GitHub OAuth secrets on runtime.");
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return oauthError("Missing OAuth code/state.");
    }

    const cookieState = parseCookie(request.headers.get("cookie"))[STATE_COOKIE];
    if (!cookieState || cookieState !== state) {
      return oauthError("Invalid OAuth state.");
    }

    const redirectUri = `${url.origin}/oauth/callback`;
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "thai-bam-decap-oauth",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        state,
      }),
    });

    const payload = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !payload.access_token) {
      const message = payload.error_description || payload.error || "Failed to exchange OAuth token.";
      return oauthError(message);
    }

    return oauthSuccessScript(payload.access_token);
  }

  return next();
}
