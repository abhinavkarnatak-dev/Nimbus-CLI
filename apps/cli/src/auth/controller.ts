import type { SwitchableModelClient } from "./client.js";
import type { CredentialStore, Credentials } from "./credentials.js";

export interface AuthState {
  loggedIn: boolean;
  email: string | null;
  // Where the token came from
  source: "env" | "saved" | null;
}

export interface LoginRequest {
  onUrl: (url: string) => void;
  signal: AbortSignal;
  inviteCode?: string;
}

export interface Account {
  email: string;
  spentMicroUsd: number;
  quotaMicroUsd: number;
}

export interface AuthControllerOptions {
  serverUrl: string;
  store: CredentialStore;
  client: SwitchableModelClient;
  envToken?: string;
  login: (request: LoginRequest) => Promise<Credentials>;
  fetchFn?: typeof fetch;
}

// Login state for server mode: env token first, then the saved one
export class AuthController {
  readonly #options: AuthControllerOptions;
  #token: string | null = null;
  #email: string | null = null;
  #source: AuthState["source"] = null;

  constructor(options: AuthControllerOptions) {
    this.#options = options;
    const saved = options.envToken ? null : options.store.load();
    if (options.envToken) this.#use(options.envToken, null, "env");
    else if (saved) this.#use(saved.token, saved.email, "saved");
  }

  get state(): AuthState {
    return { loggedIn: this.#token !== null, email: this.#email, source: this.#source };
  }

  #use(token: string | null, email: string | null, source: AuthState["source"]): void {
    this.#token = token;
    this.#email = token ? email : null;
    this.#source = token ? source : null;
    this.#options.client.setToken(token);
  }

  // Email for a token that came from the environment
  async refreshEmail(): Promise<string | null> {
    if (!this.#token || this.#email) return this.#email;
    const res = await (this.#options.fetchFn ?? fetch)(`${this.#options.serverUrl}/v1/me`, {
      headers: { authorization: `Bearer ${this.#token}` },
    }).catch(() => null);
    if (res?.ok) this.#email = ((await res.json()) as { email: string }).email;
    return this.#email;
  }

  // Trial credit as the server sees it
  async account(): Promise<Account | null> {
    if (!this.#token) return null;
    const res = await (this.#options.fetchFn ?? fetch)(`${this.#options.serverUrl}/v1/me`, {
      headers: { authorization: `Bearer ${this.#token}` },
    }).catch(() => null);
    return res?.ok ? ((await res.json()) as Account) : null;
  }

  async login(request: LoginRequest): Promise<string> {
    const credentials = await this.#options.login(request);
    this.#options.store.save(credentials);
    this.#use(credentials.token, credentials.email, "saved");
    return credentials.email;
  }

  // Revoke on the server when we can, always forget locally
  async logout(): Promise<void> {
    if (this.#token) {
      await (this.#options.fetchFn ?? fetch)(`${this.#options.serverUrl}/v1/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.#token}` },
      }).catch(() => null);
    }
    this.forget();
  }

  // Token was refused by the server
  forget(): void {
    this.#options.store.clear();
    this.#use(null, null, null);
  }
}
