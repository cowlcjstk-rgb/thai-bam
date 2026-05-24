const STATE_COOKIE = "decap_oauth_state";
const STATE_MAX_AGE = 600;
const ADMIN_DEFAULT_ID = "admin";
const ADMIN_DEFAULT_PASSWORD = "1q2w3e4r!Q";
const ADMIN_SESSION_COOKIE = "thai_bam_admin_session";
const ADMIN_SESSION_TTL = 60 * 60 * 12;
const ADMIN_ENTRY_QUERY_KEY = "admin_auth";
const ADMIN_ENTRY_QUERY_VALUE = "1";
const CMS_GITHUB_TOKEN_ENV_KEYS = ["GITHUB_CMS_TOKEN", "GITHUB_PAT", "GITHUB_ACCESS_TOKEN"];
const CMS_STAGING_BRANCH = "cms-staging";
const CMS_PRODUCTION_BRANCH = "main";
const CMS_REPO_FALLBACK = "cowlcjstk-rgb/thai-bam";
const VENUES_FOLDER = "src/content/venues";

function html(body, status = 200, headers = {}) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OAuth</title></head><body>${body}</body></html>`,
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

function getCmsRepo(env) {
  const raw = String(env.CMS_GITHUB_REPO || CMS_REPO_FALLBACK).trim();
  const [owner, repo] = raw.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function githubRequest(path, token, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function encodeGithubPath(path) {
  return String(path || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function applyCmsChanges(env) {
  const token = getCmsGithubToken(env);
  if (!token) {
    return { ok: false, status: 500, message: "CMS GitHub token missing." };
  }
  const repo = getCmsRepo(env);
  if (!repo) {
    return { ok: false, status: 500, message: "CMS repo setting invalid." };
  }

  const mergeResult = await githubRequest(`/repos/${repo.owner}/${repo.repo}/merges`, token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      base: CMS_PRODUCTION_BRANCH,
      head: CMS_STAGING_BRANCH,
      commit_message: `cms(apply): merge ${CMS_STAGING_BRANCH} into ${CMS_PRODUCTION_BRANCH} (${new Date().toISOString()})`,
    }),
  });

  if (mergeResult.res.status === 201 || mergeResult.res.status === 204) {
    return {
      ok: true,
      status: 200,
      message: "변경 적용 완료. 배포가 곧 시작됩니다.",
      sha: mergeResult.data?.sha || "",
    };
  }

  if (mergeResult.res.status === 409) {
    return { ok: false, status: 409, message: "병합 충돌이 있어 적용할 수 없습니다. 개발자 확인이 필요합니다." };
  }

  if (mergeResult.res.status === 404) {
    return { ok: false, status: 404, message: "staging 브랜치를 찾지 못했습니다. 먼저 관리자에서 글 저장을 한 번 진행해 주세요." };
  }

  const message = mergeResult.data?.message || "변경 적용 요청 실패";
  return { ok: false, status: mergeResult.res.status || 500, message };
}

function mapCollectionFromPath(path) {
  if (path.startsWith("src/content/venues/")) return "venues";
  if (path.startsWith("src/content/banners/")) return "banners";
  if (path.startsWith("src/content/home/")) return "home";
  return "other";
}

function extractVenueSlugFromPath(path) {
  const match = path.match(/^src\/content\/venues\/(.+)\.md$/);
  return match ? match[1] : "";
}

async function getPendingChanges(env) {
  const token = getCmsGithubToken(env);
  if (!token) return { ok: false, status: 500, message: "CMS GitHub token missing." };
  const repo = getCmsRepo(env);
  if (!repo) return { ok: false, status: 500, message: "CMS repo setting invalid." };

  const compare = await githubRequest(
    `/repos/${repo.owner}/${repo.repo}/compare/${CMS_PRODUCTION_BRANCH}...${CMS_STAGING_BRANCH}`,
    token
  );

  if (!compare.res.ok) {
    if (compare.res.status === 404) {
      return { ok: true, status: 200, aheadBy: 0, totalFiles: 0, items: [] };
    }
    return { ok: false, status: compare.res.status || 500, message: compare.data?.message || "비교 조회 실패" };
  }

  const items = (compare.data?.files || []).map((file) => {
    const collection = mapCollectionFromPath(file.filename || "");
    return {
      path: file.filename,
      status: file.status,
      collection,
      venueSlug: collection === "venues" ? extractVenueSlugFromPath(file.filename) : "",
    };
  });

  return {
    ok: true,
    status: 200,
    aheadBy: compare.data?.ahead_by || 0,
    totalFiles: items.length,
    items,
  };
}

function sanitizeSlugs(input) {
  if (!Array.isArray(input)) return [];
  const uniq = new Set();
  for (const raw of input) {
    const slug = String(raw || "").trim();
    if (!slug) continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) continue;
    uniq.add(slug);
  }
  return Array.from(uniq);
}

async function deleteVenueBySlug(repo, token, slug) {
  const path = `${VENUES_FOLDER}/${slug}.md`;
  const encodedPath = encodeGithubPath(path);
  const lookup = await githubRequest(`/repos/${repo.owner}/${repo.repo}/contents/${encodedPath}?ref=${CMS_STAGING_BRANCH}`, token);
  if (lookup.res.status === 404) return { slug, ok: false, reason: "not_found" };
  if (!lookup.res.ok || !lookup.data?.sha) return { slug, ok: false, reason: "lookup_failed" };

  const del = await githubRequest(`/repos/${repo.owner}/${repo.repo}/contents/${encodedPath}`, token, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: `cms(delete-bulk): venues ${slug}`,
      sha: lookup.data.sha,
      branch: CMS_STAGING_BRANCH,
    }),
  });

  if (del.res.status === 200) return { slug, ok: true };
  return { slug, ok: false, reason: del.data?.message || "delete_failed" };
}

async function bulkDeleteVenues(env, slugs) {
  const token = getCmsGithubToken(env);
  if (!token) return { ok: false, status: 500, message: "CMS GitHub token missing." };
  const repo = getCmsRepo(env);
  if (!repo) return { ok: false, status: 500, message: "CMS repo setting invalid." };

  const targets = sanitizeSlugs(slugs).slice(0, 200);
  if (targets.length === 0) {
    return { ok: false, status: 400, message: "삭제할 업체 slug가 없습니다." };
  }

  const results = [];
  for (const slug of targets) {
    results.push(await deleteVenueBySlug(repo, token, slug));
  }

  const deleted = results.filter((entry) => entry.ok).map((entry) => entry.slug);
  const failed = results.filter((entry) => !entry.ok);

  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? 200 : 207,
    message: failed.length === 0 ? `업체 ${deleted.length}건 삭제 완료` : `삭제 완료 ${deleted.length}건 / 실패 ${failed.length}건`,
    deleted,
    failed,
  };
}

function decodeGithubContent(base64) {
  try {
    const normalized = String(base64 || "").replace(/\n/g, "");
    return atob(normalized);
  } catch {
    return "";
  }
}

function extractFrontmatterValue(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return "";
  return String(match[1] || "").trim().replace(/^['"]|['"]$/g, "");
}

async function listAllVenues(env) {
  const token = getCmsGithubToken(env);
  if (!token) return { ok: false, status: 500, message: "CMS GitHub token missing." };
  const repo = getCmsRepo(env);
  if (!repo) return { ok: false, status: 500, message: "CMS repo setting invalid." };

  const listRes = await githubRequest(
    `/repos/${repo.owner}/${repo.repo}/contents/${encodeGithubPath(VENUES_FOLDER)}?ref=${CMS_STAGING_BRANCH}`,
    token
  );

  if (!listRes.res.ok || !Array.isArray(listRes.data)) {
    return { ok: false, status: listRes.res.status || 500, message: listRes.data?.message || "업체 목록 조회 실패" };
  }

  const files = listRes.data
    .filter((item) => item?.type === "file" && String(item.name || "").endsWith(".md"))
    .map((item) => ({ path: item.path, slug: String(item.name).replace(/\.md$/, "") }));

  const items = [];
  for (const file of files) {
    const detail = await githubRequest(
      `/repos/${repo.owner}/${repo.repo}/contents/${encodeGithubPath(file.path)}?ref=${CMS_STAGING_BRANCH}`,
      token
    );
    if (!detail.res.ok) {
      items.push({ slug: file.slug, title: file.slug, area: "", category: "" });
      continue;
    }
    const content = decodeGithubContent(detail.data?.content || "");
    items.push({
      slug: file.slug,
      title: extractFrontmatterValue(content, "title") || file.slug,
      area: extractFrontmatterValue(content, "area"),
      category: extractFrontmatterValue(content, "category"),
    });
  }

  items.sort((a, b) => a.slug.localeCompare(b.slug));
  return { ok: true, status: 200, total: items.length, items };
}

function oauthSuccessScript(url, token) {
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

export default {
  async fetch(request, env) {
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

        return loginPage(url, "?꾩씠???먮뒗 鍮꾨?踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎.");
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

    if (url.pathname === "/admin/apply-changes") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ ok: false, message: "Method Not Allowed" }), {
          status: 405,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }

      const sessionValid = await isAdminSessionValid(request, env);
      if (!sessionValid) {
        return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }

      const result = await applyCmsChanges(env);
      return new Response(JSON.stringify(result), {
        status: result.status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/admin/pending-changes") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ ok: false, message: "Method Not Allowed" }), {
          status: 405,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
      const sessionValid = await isAdminSessionValid(request, env);
      if (!sessionValid) {
        return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
      const result = await getPendingChanges(env);
      return new Response(JSON.stringify(result), {
        status: result.status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/admin/bulk-delete-venues") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ ok: false, message: "Method Not Allowed" }), {
          status: 405,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
      const sessionValid = await isAdminSessionValid(request, env);
      if (!sessionValid) {
        return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
      const body = await request.json().catch(() => ({}));
      const result = await bulkDeleteVenues(env, body?.slugs || []);
      return new Response(JSON.stringify(result), {
        status: result.status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/admin/venues-list") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ ok: false, message: "Method Not Allowed" }), {
          status: 405,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
      const sessionValid = await isAdminSessionValid(request, env);
      if (!sessionValid) {
        return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
      const result = await listAllVenues(env);
      return new Response(JSON.stringify(result), {
        status: result.status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/oauth") {
      const directToken = getCmsGithubToken(env);
      if (directToken) {
        return oauthSuccessScript(url, directToken);
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
        return oauthError("Missing GitHub OAuth secrets on Worker runtime.");
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

      const scopes = String(payload.scope || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      if (!scopes.includes("repo")) {
        return oauthError("Please login via GitHub OAuth App with repo scope. GitHub App token may not have write permission.");
      }

      return oauthSuccessScript(url, payload.access_token);
    }

    return env.ASSETS.fetch(request);
  },
};
