// npm runs scripts with cmd.exe on Windows, which rejects a POSIX
// `NODE_ENV=production` prefix. Set production mode before the server
// loads so dotenv does not keep a development value from .env.
process.env.NODE_ENV = "production";

await import("../api/index.ts");
