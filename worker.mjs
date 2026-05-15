const STATE_COOKIE = "decap_oauth_state";
const STATE_MAX_AGE = 600;
const ADMIN_DEFAULT_ID = "admin";
const ADMIN_DEFAULT_PASSWORD = "1q2w3e4r!Q";

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

function unauthorizedResponse() {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="Thai Bam Admin", charset="UTF-8"',
      "cache-control": "no-store",
    },
  });
}

function isAdminAuthorized(request, env) {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.startsWith("Basic ")) return false;

  let decoded = "";
  try {
    decoded = atob(authorization.slice(6).trim());
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) return false;

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  const validId = env.ADMIN_LOGIN_ID || ADMIN_DEFAULT_ID;
  const validPassword = env.ADMIN_LOGIN_PASSWORD || ADMIN_DEFAULT_PASSWORD;

  return username === validId && password === validPassword;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      if (!isAdminAuthorized(request, env)) {
        return unauthorizedResponse();
      }
    }

    if (url.pathname === "/oauth") {
      const clientId = env.GITHUB_OAUTH_CLIENT_ID;
      if (!clientId) {
        return oauthError("Missing GITHUB_OAUTH_CLIENT_ID runtime secret.");
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
        return oauthError("GitHub OAuth App(repo scope)로 로그인해 주세요. GitHub App 토큰으로는 저장 권한이 부족할 수 있습니다.");
      }

      const content = {
        token: payload.access_token,
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
        </script>`
      );
    }

    return env.ASSETS.fetch(request);
  },
};
