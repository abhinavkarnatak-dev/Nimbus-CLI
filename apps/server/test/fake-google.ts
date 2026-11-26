import type { GoogleAuth } from "../src/auth/google.js";
import type { GoogleProfile } from "../src/db/users.js";

// Stand-in for Google: any code returns the profile set on it
export function fakeGoogle(profile?: Partial<GoogleProfile>) {
  const state = {
    profile: {
      sub: "google-sub-1",
      email: "Person@Gmail.com",
      emailVerified: true,
      name: "Person",
      ...profile,
    } as GoogleProfile,
    fail: false,
    verifiers: [] as string[],
  };
  const google: GoogleAuth = {
    authorizationUrl(googleState, verifier) {
      state.verifiers.push(verifier);
      const url = new URL("https://accounts.google.test/o/oauth2/auth");
      url.searchParams.set("state", googleState);
      return url;
    },
    async profileFromCode() {
      if (state.fail) throw new Error("bad code");
      return state.profile;
    },
  };
  return { google, state };
}
