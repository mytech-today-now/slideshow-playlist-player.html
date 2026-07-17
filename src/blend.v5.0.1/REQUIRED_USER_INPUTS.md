| Placeholder | Used In | Format | Example | Required (Dev/Prod) |
| --- | --- | --- | --- | --- |
| `<SUPABASE_URL>` | `supabase-config.js`, auth/storage API calls | HTTPS origin | `https://lqpmmviiloztbanshfxy.supabase.co` | Yes / Yes |
| `<SUPABASE_ANON_KEY>` | `supabase-auth.js`, `storage-url-resolver.js` request headers | JWT string | `eyJhbGciOiJI...` | Yes / Yes |
| `<SUPABASE_STORAGE_BUCKET>` | Runtime config and deployment docs | Supabase storage endpoint URL | `https://lqpmmviiloztbanshfxy.storage.supabase.co/storage/v1/s3` | Yes / Yes |
| `<SUPABASE_CDN_BASE_URL>` | Public URL generation fallback chain | CDN base URL | `https://api.cloudflare.com/client/v4/accounts/<account_id>/d1/database` | Optional / Recommended |
| `<SUPABASE_AUTH_REDIRECT_URL>` | Auth redirect/session completion | Absolute HTTPS URL | `https://mytech.today/tools/player/v/index.html` | Optional / Yes |
| `<SIGNED_URL_TTL_SECONDS>` | Private object signed URL TTL | Integer seconds | `1209600` | Optional / Yes |
| `<MEDIA_METADATA_SOURCE>` | Metadata strategy selection | Enum (`"browser"`) | `"browser"` | Optional / Optional |
