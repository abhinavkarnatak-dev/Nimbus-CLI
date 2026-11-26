import { decodeIdToken, Google } from "arctic";
import type { GoogleProfile } from "../db/users.js";

export interface GoogleAuth {
  authorizationUrl(state: string, verifier: string): URL;
  profileFromCode(code: string, verifier: string): Promise<GoogleProfile>;
}

interface IdTokenClaims {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

// Real Google login through arctic
export function googleAuth(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): GoogleAuth {
  const google = new Google(clientId, clientSecret, redirectUri);
  return {
    authorizationUrl(state, verifier) {
      const url = google.createAuthorizationURL(state, verifier, ["openid", "email", "profile"]);
      url.searchParams.set("prompt", "select_account");
      return url;
    },
    async profileFromCode(code, verifier) {
      const tokens = await google.validateAuthorizationCode(code, verifier);
      // Came straight from Google over TLS, so decoding without a signature check is fine
      const claims = decodeIdToken(tokens.idToken()) as IdTokenClaims;
      if (!claims.sub || !claims.email) throw new Error("Google did not return an email.");
      return {
        sub: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
        name: claims.name,
      };
    },
  };
}
