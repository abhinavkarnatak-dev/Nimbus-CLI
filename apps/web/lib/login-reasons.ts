export interface LoginFailure {
  title: string;
  body: string;
  command?: string;
}

// Same reason codes the server sends after a failed login
export const LOGIN_FAILURES: Record<string, LoginFailure> = {
  access_denied: {
    title: "Login cancelled",
    body: "Nothing changed. Run the login again when you are ready.",
    command: "nimbus login",
  },
  not_invited: {
    title: "Nimbus is invite only for now",
    body: "If you have an invite code, log in with it.",
    command: "nimbus login --code <your code>",
  },
  invalid_code: {
    title: "That invite code did not work",
    body: "It may be mistyped, used up or expired. Check the code, or ask for a new one.",
    command: "nimbus login --code <your code>",
  },
  email_not_verified: {
    title: "Your Google email is not verified",
    body: "Verify it in your Google account, then log in again.",
    command: "nimbus login",
  },
  account_blocked: {
    title: "This account is blocked",
    body: "If you think this is a mistake, tell us.",
  },
  google_failed: {
    title: "Google login failed",
    body: "Google did not finish the login. Try again.",
    command: "nimbus login",
  },
};

export const UNKNOWN_FAILURE: LoginFailure = {
  title: "Login failed",
  body: "Something went wrong on the way back from Google. Try again.",
  command: "nimbus login",
};

export function failureFor(reason: string | null): LoginFailure {
  return (reason && LOGIN_FAILURES[reason]) || UNKNOWN_FAILURE;
}
