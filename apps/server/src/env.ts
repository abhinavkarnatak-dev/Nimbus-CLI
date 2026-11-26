import type { TokenOwner } from "./db/tokens.js";

export interface AppEnv {
  Variables: { auth: TokenOwner };
}
