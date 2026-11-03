import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained production server under `.next/standalone` via
  // Next.js Output File Tracing. The tracer copies only the files each route
  // actually needs (plus a minimal `server.js`), so the deployable package is
  // a small fraction of the full `node_modules`. This keeps the AWS Lambda Web
  // Function artifact well under the 512 MB UNCOMPRESSED code-size limit
  // (the previous "zip the whole node_modules" approach produced ~1 GB and was
  // rejected at CreateWebFunctionRevision).
  //
  // Verified against the Next.js 16 docs shipped in this repo:
  //   node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md
  //   node_modules/next/dist/docs/01-app/01-getting-started/17-deploying.md
  // The standalone server is started with `node server.js` (NOT `next start`),
  // and `public` + `.next/static` must be copied alongside it at package time
  // (handled in infra/buildspec.yml).
  output: "standalone",

  // The Prisma client is generated at build time into node_modules/.prisma and
  // node_modules/@prisma and is loaded dynamically by @prisma/client. The
  // @vercel/nft tracer that produces `.next/standalone` can miss the generated
  // client / query-engine files because they are resolved at runtime rather
  // than statically imported. Force them into every server trace so the
  // standalone bundle can talk to Aurora via the @prisma/adapter-pg driver
  // adapter. Patterns are resolved from the project root (narrow, no repo-root
  // `**/*`) per the output-tracing docs.
  outputFileTracingIncludes: {
    "/**/*": [
      // Generated Prisma client + the WASM query compiler used by the driver
      // adapter (Prisma 7 `prisma-client-js` provider resolves these at runtime).
      "./node_modules/.prisma/client/**/*",
      "./node_modules/@prisma/client/**/*",
      // The pg driver adapter and the underlying node-postgres driver that
      // lib/prisma.ts wires up (new PrismaPg(process.env.DATABASE_URL)). The
      // bundler currently inlines the adapter into the server chunk, but force
      // it (and `pg`) into the trace so the package stays correct regardless of
      // future bundling changes.
      "./node_modules/@prisma/adapter-pg/**/*",
      "./node_modules/pg/**/*",
    ],
  },
};

export default nextConfig;
