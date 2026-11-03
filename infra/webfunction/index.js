// AWS Lambda Web Function entrypoint for the Next.js standalone server.
//
// WHY THIS FILE EXISTS
// --------------------
// The AWS Lambda Web Function Node.js runtime does NOT run a package.json
// `start` script and does NOT run `next start`. By contract it loads the file
// named `index.js` at the ROOT of the deployment package (or the file named by
// the AWS_LAMBDA_NODEJS_ENTRYPOINT env var). A deployed backend that relied on
// `next start` / a `start` script returned HTTP 502 with the runtime log:
//   "Runtime.ImportCodeError: could not load customer code: Cannot find module
//    '/var/task/index.js' ... The entrypoint must be 'index.js' at the root of
//    the deployment package, or the AWS_LAMBDA_NODEJS_ENTRYPOINT environment
//    variable must point to your entry file".
//
// See (official AWS docs):
//   - https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html
//   - https://docs.aws.amazon.com/lambda/latest/dg/web-functions-create.html
//   - https://aws.amazon.com/blogs/compute/exploring-aws-lambda-web-functions-for-building-web-applications/
//
// LISTEN ADDRESS
// --------------
// The runtime tells the server where to listen via the env var
// AWS_LAMBDA_HTTP_ENDPOINT, formatted as "host:port" (for example
// "0.0.0.0:8080"). This is NOT the `PORT` variable. We parse that endpoint and
// translate it into the HOSTNAME / PORT env vars that Next.js's standalone
// `server.js` reads at require time (confirmed against
// node_modules/next/dist/docs/.../output.md: "If your project needs to listen
// to a specific port or hostname, you can define PORT or HOSTNAME environment
// variables before running server.js").
//
// PACKAGING
// ---------
// `next build` (with `output: 'standalone'`) emits `.next/standalone/server.js`
// (CommonJS). infra/buildspec.yml copies THIS file to
// `.next/standalone/index.js` before zipping the CONTENTS of `.next/standalone`
// at the archive root, so `index.js` sits next to `server.js` at /var/task.
// This file is CommonJS because the standalone `server.js` is CommonJS and the
// backend package.json has no `"type": "module"`.

'use strict'

// The endpoint is "host:port". IPv6 hosts can contain ':' (e.g. "[::1]:8080"),
// so split on the LAST ':' to separate the port from the host.
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT || '0.0.0.0:8080'
const lastColon = endpoint.lastIndexOf(':')
const host = lastColon === -1 ? endpoint : endpoint.slice(0, lastColon)
const port = lastColon === -1 ? '8080' : endpoint.slice(lastColon + 1)

// Next's standalone server.js reads process.env.HOSTNAME and process.env.PORT
// synchronously at require time, so these MUST be set before the require below.
process.env.HOSTNAME = host
process.env.PORT = port

// Boot the Next.js standalone server. `server.js` is at the same archive root
// as this file (both land in /var/task after unzip).
require('./server.js')
