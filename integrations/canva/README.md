# Canva OAuth on Cloudflare Workers

The Worker exchanges OAuth codes and refresh tokens with Canva. Presenter sends design searches and downloads directly to Canva. There is no database. The existing local broker remains available for development.

## Deploy on Workers Free

1. Sign in to your Cloudflare account. From the repository root run:

   ```powershell
   npx wrangler login
   npx wrangler deploy --config integrations/canva/wrangler.toml
   ```

2. Copy the HTTPS Worker origin from the deploy output. In Canva Developer Portal, add that origin followed by `/oauth/redirect` under **Outside Canva → Redirect URLs**. Keep `design:meta:read` and `design:content:read` enabled. The browser callback forwards the authorization code to Presenter on this computer. The loopback URL can remain registered for local development.
3. Set the following Worker configuration. Wrangler prompts for each value.

   ```powershell
   npx wrangler secret put CANVA_CLIENT_ID --config integrations/canva/wrangler.toml
   npx wrangler secret put CANVA_CLIENT_SECRET --config integrations/canva/wrangler.toml
   npx wrangler secret put CANVA_REDIRECT_URI --config integrations/canva/wrangler.toml
   ```

   Set `CANVA_REDIRECT_URI` to the exact HTTPS callback registered in Canva. Store the Client Secret only in Cloudflare or in the separate local broker environment for development.

## Verify and configure release builds

For a local test, set `WPA_CANVA_CLIENT_ID` and `WPA_CANVA_BROKER_URL` in the terminal before `npm run dev`. Use the HTTPS origin for the broker URL, without a path. Open **Presentations → Canva** and test sign-in, search, import, then close and reopen Presenter to verify session restoration. Session restoration uses Electron's OS-backed credential encryption.

For packaged releases, set the GitHub repository **Actions variables** `CANVA_CLIENT_ID` and `CANVA_BROKER_URL` to the same public values. Both are included in the Electron main bundle at build time. Users can then open the packaged Presenter app and sign in from the Canva panel. Public availability also depends on the Canva integration's access and review status.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Canva authentication](https://www.canva.dev/docs/apps/rest-apis/authentication/).
