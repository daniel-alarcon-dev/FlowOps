// npm runs scripts with cmd.exe on Windows, which rejects a POSIX
// `NODE_ENV=production` prefix. Set production mode before the server
// loads so dotenv does not keep a development value from .env.
// `npm start` also passes `--import @sentry/node/import` so Express is
// instrumented before this file loads the API. Keep that flag if you
// launch this file without the npm script.
process.env.NODE_ENV = "production";

await import("../api/index.ts");
