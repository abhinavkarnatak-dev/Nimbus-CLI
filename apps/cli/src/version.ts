// Set from package.json when the CLI is built; "dev" when run from source
declare const __NIMBUS_VERSION__: string | undefined;

export const VERSION = typeof __NIMBUS_VERSION__ === "string" ? __NIMBUS_VERSION__ : "dev";
