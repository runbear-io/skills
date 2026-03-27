# Slack Token Rotation

How OAuth token rotation works and how this bot handles it.

## How It Works

With token rotation enabled, Slack issues short-lived access tokens (~12 hours) alongside a refresh token. When the access token expires, you exchange the refresh token for a new pair.

```
refresh_token (long-lived) → oauth.v2.access → new access_token + new refresh_token
```

**Important**: Each refresh token is single-use. After exchanging it, the old refresh token is invalidated and a new one is returned.

## Token Flow

```
1. Initial OAuth install → access_token + refresh_token
2. Bot uses access_token for API calls
3. Before expiry (5 min buffer) → exchange refresh_token
4. Receive new access_token + new refresh_token
5. Store both, discard old ones
6. Repeat from step 2
```

## API Call

```
POST https://slack.com/api/oauth.v2.access
  client_id=...
  client_secret=...
  grant_type=refresh_token
  refresh_token=xoxe-1-...
```

Response:
```json
{
  "ok": true,
  "access_token": "xoxb-...",
  "refresh_token": "xoxe-1-...",
  "token_type": "bot",
  "expires_in": 43200,
  "team": { "id": "T...", "name": "..." },
  "bot_user_id": "U..."
}
```

## How This Bot Handles It

The `TokenManager` class (`token-manager.js`) handles rotation:

- Stores tokens in `.slack-tokens.json` (gitignored)
- Checks expiry before each API call with a 5-minute buffer
- Automatically refreshes and persists the new token pair
- Supports multiple teams (keyed by team ID)

## Common Issues

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid_refresh_token` | Token already used or revoked | Reinstall the app to get a new token |
| `token_rotation_not_enabled` | App doesn't have rotation on | Enable in OAuth & Permissions settings |
| `invalid_client_id` | Wrong client ID/secret | Check Basic Information in app settings |
