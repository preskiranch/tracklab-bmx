# TrackLab web address

The existing Render service `srv-d92ufvcvikkc73b6872g` serves both
`https://tracklabbmx.com` and `https://tracklab-bmx.onrender.com` from the same deployment.
Keep the Render subdomain enabled: existing native builds and integrations use it.
Do not add or redirect `tracklabsbmx.com`; it is held unused at the owner's request.

Network Solutions DNS for tracklabbmx.com:
- A `@`: `216.24.57.1`, TTL 15 minutes.
- CNAME `www`: `tracklab-bmx.onrender.com`, TTL 15 minutes.

Render manages HTTPS and redirects www.tracklabbmx.com to tracklabbmx.com.
Both purchased domains have auto-renew disabled and expire September 8, 2027.

When verifying a deployment, check /api/health on both the custom and Render
addresses. Web API requests are relative to the current origin; retain the native
service origin and existing universal-link host until a separately verified iOS migration.
