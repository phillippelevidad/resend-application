# Installed versions

The surfaces whose installed version an implementer reads before coding against them
([pp-general → Check the installed version, not memory](../SKILL.md#check-the-installed-version-not-memory)).
Only ADR-fixed majors are written here; the lockfile is the version truth.

| Surface | Installed | Read this first |
| --- | --- | --- |
| Node.js 24 | `engines` in root `package.json` | [TypeScript in Node](https://nodejs.org/docs/latest-v24.x/api/typescript.html) |
| TypeScript | see lockfile | [npm](https://www.npmjs.com/package/typescript) |
| Zod 4 | see lockfile | [npm](https://www.npmjs.com/package/zod) |
| Drizzle ORM, drizzle-kit, `pg` | see lockfile | [drizzle-orm](https://www.npmjs.com/package/drizzle-orm) · [pg](https://www.npmjs.com/package/pg) |
| Hono, `@hono/zod-openapi`, `@hono/aws-lambda`, `@hono/node-server` | see lockfile | [Hono on Lambda](https://hono.dev/docs/getting-started/aws-lambda) · [zod-openapi](https://raw.githubusercontent.com/honojs/middleware/main/packages/zod-openapi/README.md) |
| `commander` 15 and `@commander-js/extra-typings` 15 (O-13, ADR-019) | see lockfile | [npm](https://www.npmjs.com/package/commander) |
| `@modelcontextprotocol/server` v2 | see lockfile | [repo](https://github.com/modelcontextprotocol/typescript-sdk) |
| `openapi-typescript`, `openapi-fetch` | see lockfile | [npm](https://www.npmjs.com/package/openapi-fetch) |
| Winston | see lockfile | [npm](https://www.npmjs.com/package/winston) |
| Vitest, fast-check, Testcontainers | see lockfile | [vitest](https://www.npmjs.com/package/vitest) · [fast-check](https://www.npmjs.com/package/fast-check) · [testcontainers](https://www.npmjs.com/package/testcontainers) |
| Biome | see lockfile | [lint rules](https://biomejs.dev/linter/rules/) |
| AWS CDK v2 | see lockfile | [aws-cdk-lib](https://www.npmjs.com/package/aws-cdk-lib) |
| `resend` | see lockfile | [Resend docs](https://resend.com/docs/llms.txt) |
