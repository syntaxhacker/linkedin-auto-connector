# Privacy Policy — Job Radar for LinkedIn

## Default behavior (Jev mode OFF)
Everything runs locally in your browser. No browsing data, post content, or
settings leave your machine. Preferences sync only via `chrome.storage.sync`
to your own Google account (standard Chrome sync).

## Jev mode (opt-in AI categorization)
When you enable **Jev mode** and paste an API key:

- **What is sent**: the text of unseen LinkedIn feed posts (up to 500
  characters each, batched up to 20 per request) is POSTed over HTTPS to
  your active provider — by default `https://api.typesafe.ai/v1/systemone`
  (TypeSafe/Jev decisions API), or your own OpenAI-compatible endpoint if
  you switch providers — along with your category definitions derived from
  your include/exclude keywords and prompt. No names, profiles, logins, or
  cookies are sent — only post body text and the classification instructions.
- **When**: only while Jev mode is ON, only on LinkedIn feed/search pages,
  and only for posts not yet categorized (each post is sent once per
  session). Requests are performed by the extension's background service
  worker (`LLM_FETCH` relay — extension process, so no browser CORS
  preflight) and never from page code. Egress to a custom (non-default) host
  requires that origin's host permission, enforced by the background worker.
  Caps and throttle are implemented but currently unenforced (unlimited
  mode); the automatic pause on auth/rate-limit errors stays active.
- **API key storage**: keys (one per provider) are kept in memory and in
  `chrome.storage.local` on your machine only. They are never synced to
  your Google account, never rendered back into the page, never logged, and
  never sent anywhere except as the `Authorization: Bearer` header to your
  configured endpoint.
- **Third-party processing**: the active provider processes the sent text to
  return a category + confidence per post. Review their policy before
  enabling (Jev: https://typesafe.ai).

Turn Jev mode OFF (or RESET the extension) to stop all network calls to the
classification API. Removing the key from the panel clears it from local
storage.

Note: the manifest requests `optional_host_permissions: ["https://*/*"]` so
a custom OpenAI-compatible endpoint on any host can be permitted. Egress is
enforced in the background worker (`chrome.permissions.contains` before any
relayed POST); until the origin is granted (chrome://extensions → this
extension → Site access), classification reports "host permission not
granted". The Jev default (`api.typesafe.ai`) is covered by the static
`host_permissions` and needs no extra grant.
