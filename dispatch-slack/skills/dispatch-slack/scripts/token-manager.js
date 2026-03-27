const { WebClient } = require("@slack/web-api");
const fs = require("fs");
const path = require("path");

const TOKEN_FILE = path.join(__dirname, "../.slack-tokens.json");

class TokenManager {
  constructor({ clientId, clientSecret }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokens = this._loadTokens();
  }

  _loadTokens() {
    try {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    } catch {
      return {};
    }
  }

  _saveTokens() {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(this.tokens, null, 2));
  }

  // Store tokens from initial OAuth or refresh
  setTokens(teamId, { accessToken, refreshToken, expiresAt }) {
    this.tokens[teamId] = { accessToken, refreshToken, expiresAt };
    this._saveTokens();
  }

  // Initialize from a refresh token (no existing access token)
  async initFromRefreshToken(refreshToken) {
    const client = new WebClient();
    const result = await client.oauth.v2.access({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const teamId = result.team.id;
    const expiresAt = Date.now() + result.expires_in * 1000;

    this.setTokens(teamId, {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt,
    });

    console.log(`Tokens initialized for team ${teamId}`);
    return { teamId, accessToken: result.access_token };
  }

  // Get a valid access token, refreshing if expired
  async getAccessToken(teamId) {
    const entry = this.tokens[teamId];
    if (!entry) {
      throw new Error(`No tokens stored for team ${teamId}`);
    }

    // Refresh if token expires within 5 minutes
    if (Date.now() > entry.expiresAt - 5 * 60 * 1000) {
      console.log(`Refreshing token for team ${teamId}`);
      const client = new WebClient();
      const result = await client.oauth.v2.access({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: entry.refreshToken,
      });

      this.setTokens(teamId, {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: Date.now() + result.expires_in * 1000,
      });

      return result.access_token;
    }

    return entry.accessToken;
  }

  getStoredTeamIds() {
    return Object.keys(this.tokens);
  }
}

module.exports = { TokenManager };
