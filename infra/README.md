# todo-backend AWS Infrastructure (CloudFormation + CodeBuild/CodeDeploy)

Infrastructure-as-Code to host the Next.js 16 **todo-backend** API as an **AWS
Lambda Web Function** (a new capability), backed by **Aurora PostgreSQL
Serverless v2**, with all secrets in **AWS Secrets Manager** and
**CodeBuild + CodeDeploy** delivery building blocks.

> **This is a set of correctly-wired delivery building blocks, not an automated
> end-to-end pipeline.** There is no `AWS::CodePipeline` and no CodeDeploy
> `DeploymentGroup`. CodeBuild genuinely builds, migrates, packages, and uploads
> the artifact; the cutover to the new Web Function revision is then a **manual**
> `cloudformation deploy` of the `app` stack (the build prints the artifact key
> for an operator to pass by hand). Lambda Web Functions shift traffic natively
> via the endpoint's `RevisionWeights`, so classic CodeDeploy cannot drive the
> cutover; the `AWS::CodeDeploy::Application` is kept as a placeholder primitive
> for a future classic `AWS::Lambda::Function` alias path. See
> [`CUTOVER.md`](./CUTOVER.md) and "CodeBuild + CodeDeploy flow" below. These
> words are chosen deliberately so nothing here implies automation that does not
> exist.

> **No live deploy was performed.** These templates were authored and validated
> statically with cfn-lint and cfn-guard through the AWS IaC MCP. There is no
> AWS account, Docker daemon, or live PostgreSQL in the authoring sandbox, so
> the application build, container packaging, and `prisma migrate deploy` all
> run in CodeBuild at deploy time, not here. Lambda Web Functions is a **new**
> capability; validate the resource types against your account's region before
> deploying.

## Architecture

```
                         HTTPS
   client ───────────────────────────────▶  Lambda Web Function Endpoint
   (browser / frontend)                      (AuthType: ApplicationManaged,
                                              EndpointType: HomeRegion)
                                                     │  RevisionWeights
                                                     ▼
                                           WebFunctionRevision
                                           (code .zip from S3,
                                            Runtime nodejs24.x,
                                            index.js boots Next standalone
                                            server.js on AWS_LAMBDA_HTTP_ENDPOINT)
                                                     │
                      EgressNetworkConnectorArn      │  env via resolve:secretsmanager
                                                     ▼
                                      Lambda NetworkConnector (ENIs)
                                                     │  :5432 (private subnets)
                                                     ▼
                                      Aurora PostgreSQL Serverless v2
                                      (StorageEncrypted, 2 private subnets/2 AZ)

   Secrets Manager:  RDS-managed master secret · JWT_SECRET · REMINDER_DISPATCH_SECRET
   (all encrypted with a customer-managed KMS key)

   Delivery:  GitHub ─▶ CodeBuild (npm ci → prisma generate → next build →
              prisma migrate deploy → zip → s3 cp; prints ArtifactObjectKey)
              ─▶ S3 artifact bucket
              ┄┄ manual `cloudformation deploy` of the app stack ┄┄▶
              WebFunctionEndpoint RevisionWeights cutover (no CodePipeline,
              no CodeDeploy DeploymentGroup; see CUTOVER.md)
```

## Templates

| File | Stack | Contents |
|------|-------|----------|
| `cloudformation/network.yaml`  | network  | VPC, 2 private subnets (2 AZs), route table, VPC flow logs, Aurora SG + Web Function connector SG (ingress 5432 from connector only) |
| `cloudformation/database.yaml` | database | Customer-managed KMS key, Aurora PostgreSQL Serverless v2 cluster (`StorageEncrypted`, RDS-managed master secret), `db.serverless` instance, enhanced monitoring, DB subnet group, Secrets Manager secrets for `JWT_SECRET` and `REMINDER_DISPATCH_SECRET` |
| `cloudformation/app.yaml`      | app      | `AWS::Lambda::WebFunction` + `WebFunctionRevision` + `WebFunctionEndpoint`, `AWS::Lambda::NetworkConnector` (VPC egress to Aurora), least-privilege execution role, connector operator role |
| `cloudformation/pipeline.yaml` | pipeline | S3 artifact bucket (SSE-KMS, public access blocked, TLS-only, access-logged) + access-log bucket, CodeBuild project, CodeDeploy application (ComputePlatform `Lambda`), least-privilege CodeBuild/CodeDeploy roles |
| `buildspec.yml`  | (CodeBuild) | Build + migrate + package + upload steps; prints `ArtifactObjectKey` (no `artifacts:` block, because the project is `NO_ARTIFACTS`) |
| `CUTOVER.md`     | (docs) | Plain-language revision cutover notes. **Replaces the old `appspec.yaml`**, which used an invented non-CodeDeploy schema and was consumed by nothing |

## Deploy order

Stacks use cross-stack `Export`/`ImportValue`, so deploy them in order:

1. **network** → exports `PrivateSubnetIds`, `AuroraSgId`, `WebFunctionConnectorSgId`
2. **database** (pass `NetworkStackName`) → exports `ClusterEndpoint`, `ClusterPort`, `DatabaseName`, `MasterUserSecretArn`, `JwtSecretArn`, `ReminderDispatchSecretArn`, `DataKmsKeyArn`
3. **pipeline** (pass `DatabaseStackName`) → exports `ArtifactBucketName`
4. Run the **CodeBuild** project → builds the app, runs `prisma migrate deploy`,
   uploads the `.zip` to the artifact bucket, and prints an
   `ArtifactObjectKey=...` line to the build log (the build has no `artifacts:`
   output; see "CodeBuild + CodeDeploy flow").
5. **app** (pass `NetworkStackName`, `DatabaseStackName`, `PipelineStackName`,
   and the `ArtifactObjectKey` copied from the build log) → creates a new Web
   Function revision and shifts endpoint traffic to it. **This step is a manual
   `cloudformation deploy`; nothing automates build → cutover.**

Example (requires a real account/credentials; not run here):

```bash
aws cloudformation deploy --stack-name todo-backend-network  --template-file infra/cloudformation/network.yaml  --capabilities CAPABILITY_IAM
aws cloudformation deploy --stack-name todo-backend-database --template-file infra/cloudformation/database.yaml --parameter-overrides NetworkStackName=todo-backend-network --capabilities CAPABILITY_IAM
aws cloudformation deploy --stack-name todo-backend-pipeline --template-file infra/cloudformation/pipeline.yaml --parameter-overrides DatabaseStackName=todo-backend-database --capabilities CAPABILITY_IAM
# Build, then copy the "ArtifactObjectKey=..." value from the build log:
aws codebuild start-build --project-name todo-backend-pipeline-build
# Manual handoff: pass that key into the app stack (there is no CodePipeline):
aws cloudformation deploy --stack-name todo-backend-app --template-file infra/cloudformation/app.yaml \
  --parameter-overrides NetworkStackName=todo-backend-network DatabaseStackName=todo-backend-database PipelineStackName=todo-backend-pipeline ArtifactObjectKey=todo-backend/<sha>.zip \
  --capabilities CAPABILITY_IAM
```

See [`CUTOVER.md`](./CUTOVER.md) for the full cutover (and optional canary) steps.

## Parameters

- **network.yaml**: `VpcCidr` (default `10.42.0.0/16`), `PrivateSubnet1Cidr`, `PrivateSubnet2Cidr`.
- **database.yaml**: `NetworkStackName`, `DatabaseName` (`tododb`), `MasterUsername` (`todoadmin`), `EngineVersion` (default `16.6`, PostgreSQL 16 line, matching `docker-compose` `postgres:16` — **confirm it is offered in your region first**, see "Aurora engine version" below), `MinCapacity` (`0.5`), `MaxCapacity` (`4`).
- **app.yaml**: `NetworkStackName`, `DatabaseStackName`, `PipelineStackName`, `ArtifactObjectKey`, `Runtime` (`nodejs24.x`), `FunctionName` (`todo-backend-api`), `Port` (`8080`), `TimeoutSeconds` (`30`), `CorsAllowedOrigins` (default empty; comma separated SPA origins, see "Cross-origin SPA" below).
- **pipeline.yaml**: `DatabaseStackName`, `SourceRepositoryUrl`, `SourceBranch` (`feat/aws-iac-cicd`).

## The Web Function server process

The AWS Lambda Web Function **Node.js runtime loads `index.js` at the root of
the deployment package** by default (or the file named by the
`AWS_LAMBDA_NODEJS_ENTRYPOINT` env var). It does **not** run a `package.json`
`start` script and does **not** run `next start`. It also provides the listen
address as `AWS_LAMBDA_HTTP_ENDPOINT` (`host:port`, e.g. `0.0.0.0:8080`), **not**
as `PORT`. This is grounded in the official AWS docs:

- <https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.html>
- <https://docs.aws.amazon.com/lambda/latest/dg/web-functions-create.html>
- <https://aws.amazon.com/blogs/compute/exploring-aws-lambda-web-functions-for-building-web-applications/>

> An earlier revision of this stack assumed the runtime ran `next start` and
> read `PORT`. That assumption was wrong: the live deploy returned HTTP 502 with
> the runtime log `Runtime.ImportCodeError: could not load customer code: Cannot
> find module '/var/task/index.js' ... The entrypoint must be 'index.js' at the
> root of the deployment package, or the AWS_LAMBDA_NODEJS_ENTRYPOINT
> environment variable must point to your entry file`.

**How this repo conforms.** `next.config.ts` sets `output: 'standalone'`, so
`next build` emits `.next/standalone/server.js` (CommonJS). That minimal server
reads `process.env.HOSTNAME` and `process.env.PORT` **at require time** (per
`node_modules/next/dist/docs/.../output.md`: "define `PORT` or `HOSTNAME`
environment variables before running `server.js`"). We commit a tiny entry file
[`infra/webfunction/index.js`](./webfunction/index.js) that:

1. reads `AWS_LAMBDA_HTTP_ENDPOINT` (splitting on the **last** `:` into host and
   port; fallback `0.0.0.0:8080`),
2. sets `process.env.HOSTNAME` and `process.env.PORT` from it, then
3. `require('./server.js')` to boot the Next.js standalone server.

`infra/buildspec.yml` copies that file to `.next/standalone/index.js` (next to
`server.js`) before zipping the **contents** of `.next/standalone` at the
archive root, and asserts `index.js` is present before uploading. The runtime
then loads `index.js` at `/var/task/index.js`.

The `package.json` `start` script (`node server.js`) is kept for **local** use
only and is irrelevant to the Web Function runtime, which loads `index.js`
directly. `NODE_ENV` is set to `production`, which makes the app enforce a real
`JWT_SECRET` (it throws if unset in production) rather than the dev default.
Per `AGENTS.md`, Next.js runtime/build config is otherwise left untouched.

## Environment and secret wiring

No secret value appears in any template. Secrets are injected into the Web
Function revision `EnvironmentVariables` via `resolve:secretsmanager` dynamic
references, and CodeBuild reads only the one secret it needs for migration:

| Variable | Source | How it reaches the runtime |
|----------|--------|----------------------------|
| `DB_HOST` | exported cluster endpoint (`Fn::ImportValue`) | plain revision env var |
| `DB_PORT` | exported cluster port (`Fn::ImportValue`) | plain revision env var |
| `DB_NAME` | exported database name (`Fn::ImportValue`) | plain revision env var |
| `DB_USER` | RDS-managed master secret (`username` key) | `resolve:secretsmanager` dynamic reference inside `app.yaml` |
| `DB_PASSWORD` | RDS-managed master secret (`password` key) | `resolve:secretsmanager` dynamic reference inside `app.yaml` |
| `DB_SSL` | literal (`require`) | plain revision env var; enables TLS to Aurora |
| `JWT_SECRET` | `AWS::SecretsManager::Secret` (`GenerateSecretString`) | `resolve:secretsmanager` dynamic reference |
| `REMINDER_DISPATCH_SECRET` | `AWS::SecretsManager::Secret` (`GenerateSecretString`) | `resolve:secretsmanager` dynamic reference |
| `NODE_ENV` | literal (`production`) | plain revision env var |
| `PORT` | literal (`8080`) | plain revision env var, **secondary fallback only** - the runtime sets `AWS_LAMBDA_HTTP_ENDPOINT` (`host:port`) and `index.js` uses that as the listen address |

**Why discrete DB params instead of a single `DATABASE_URL`.** The Aurora
**master password is generated and stored by RDS** (`ManageMasterUserPassword:
true`), encrypted with the stack's customer-managed KMS key. RDS-generated
passwords routinely contain URL-unsafe characters (e.g. `! # $ ( - [ _`).
Assembling a `postgresql://user:password@host/db` URL from such a password
breaks WHATWG URL parsing in the `pg` driver (the live symptom was an
`Invalid URL` error on the first query), and `resolve:secretsmanager` cannot
URL-encode the injected value. Passing the connection as discrete parameters
lets `pg` receive the password as a literal, so no URL encoding is ever needed.
`lib/prisma.ts` builds the adapter from these discrete vars in production and
falls back to a single `DATABASE_URL` for local docker-compose development.

The password is still **never stored in plaintext** in the template: both
`DB_USER` and `DB_PASSWORD` are injected at deploy time from the RDS-managed
master secret via `resolve:secretsmanager`.

### Cross-origin SPA (CORS + session cookie)

When the frontend is served from a different origin than the API (for example
two separate Lambda Web Function endpoints), pass that origin in the app stack's
`CorsAllowedOrigins` parameter (comma separated, no trailing slash). It is
exposed to the app as `CORS_ALLOWED_ORIGINS`, which:

- adds the origin to the credentialed CORS allow-list in `proxy.ts` (with
  `Vary: Origin`), and
- switches the httpOnly session cookie to `SameSite=None; Secure` in production
  so the browser sends it on cross-site XHR/fetch requests.

Leave it empty for same-origin deployments; the cookie then stays
`SameSite=Lax`.

### Seeding the live database without leaking passwords

`prisma/seed.ts` supports `SEED_MODE=idempotent` with the user passwords taken
from `SEED_PASSWORD_*` environment variables. When running it as a one-off
CodeBuild build inside the VPC, **never** pass those passwords as `PLAINTEXT`
environment overrides (they are stored in the build record). Store them in
Secrets Manager (or SSM Parameter Store SecureString) and reference them with
`environmentVariablesOverride` entries of type `SECRETS_MANAGER` (or
`PARAMETER_STORE`); CodeBuild resolves the value at runtime and masks it in the
logs. The CodeBuild role needs `secretsmanager:GetSecretValue` on that secret.

## CodeBuild + CodeDeploy flow

**What is automated, and what is not.** CodeBuild does real work; the handoff to
the running endpoint is manual. There is **no `AWS::CodePipeline`** and **no
`AWS::CodeDeploy::DeploymentGroup`**, so "pipeline" would overstate it — these
are delivery building blocks with a manual cutover.

- **CodeBuild** (`buildspec.yml`): `npm ci` → `npx prisma generate` →
  `npm run build` (`next build`) → assemble `DATABASE_URL` from the Aurora
  secret → `npx prisma migrate deploy` → `zip` the app → `aws s3 cp` the `.zip`
  to the artifact bucket → **print** an `ArtifactObjectKey=...` line to the
  build log.

  The buildspec has **no `artifacts:` block**. The CodeBuild project sets
  `Artifacts: NO_ARTIFACTS` (confirmed valid values are
  `CODEPIPELINE | S3 | NO_ARTIFACTS`), and because there is no CodePipeline or
  S3-output wiring consuming a CodeBuild artifact, an `artifacts:` block would
  be silently discarded by CodeBuild and would falsely imply an automated
  artifact handoff. The `.zip` is published by the explicit `aws s3 cp`; the
  object key an operator needs is surfaced on the printed `ArtifactObjectKey=`
  line (never any secret). The earlier dead `artifacts:` block was removed.

- **CodeDeploy** (`AWS::CodeDeploy::Application`, `ComputePlatform: Lambda`) is a
  **placeholder primitive, not an active deployment controller.** It has no
  deployment group and nothing invokes a CodeDeploy deployment. Lambda Web
  Functions shift traffic *natively* through the endpoint's `RevisionWeights`
  (one or two revisions with weights); classic CodeDeploy Lambda deployment
  groups operate on the **alias** of a traditional `AWS::Lambda::Function` and
  cannot drive a `WebFunctionEndpoint`. The actual cutover is a manual
  `cloudformation deploy` of the `app` stack that updates `RevisionWeights` (see
  [`CUTOVER.md`](./CUTOVER.md)). The application is retained so a future classic
  `AWS::Lambda::Function` alias path can attach a real deployment group without
  re-plumbing, and to satisfy the "use CodeDeploy" requirement explicitly and
  transparently rather than nominally.

  The former `appspec.yaml` was **removed**. It used an invented
  `AWS::Lambda::WebFunctionEndpoint` / `TrafficShifting` / `TargetRevision`
  schema that is **not** the real CodeDeploy Lambda AppSpec (which targets
  `AWS::Lambda::Function` with `Name`/`Alias`/`CurrentVersion`/`TargetVersion`
  plus a `hooks:` section) and was consumed by nothing. Its content now lives as
  plain cutover notes in [`CUTOVER.md`](./CUTOVER.md), with the real AppSpec
  shape shown for contrast.

## Secret rotation

Automatic rotation is configured for **none** of the three secrets, which is an
intentional, documented choice for this launch:

- **Aurora master secret** — RDS-managed (`ManageMasterUserPassword: true`).
  Secrets Manager supports a built-in rotation strategy for RDS credentials; it
  is not enabled here but can be added later with an
  `AWS::SecretsManager::RotationSchedule` + `HostedRotationLambda` against the
  managed secret, which requires VPC access to the cluster.
- **`JWT_SECRET` and `REMINDER_DISPATCH_SECRET`** — these are application
  signing/shared secrets, not database credentials, so there is no managed
  `HostedRotationLambda` strategy for them. Rotating `JWT_SECRET` safely needs a
  dual-key grace window in the app so in-flight tokens stay valid, i.e. an
  application-level change. Rotation of both is therefore **deferred to a
  follow-up** and is not wired here. This is acceptable for launch because both
  are long, randomly `GenerateSecretString`-generated values encrypted under the
  customer-managed KMS key and reachable only via least-privilege
  `secretsmanager:GetSecretValue` on the specific ARNs.

## Aurora engine version

`EngineVersion` defaults to `16.6` (PostgreSQL 16 line, matching
`docker-compose` `postgres:16`). The exact offered patch version **varies by
region and changes over time**, so `16.6` may not be offered in a given region.
Before deploying, confirm an offered value and override the parameter if needed:

```bash
aws rds describe-db-engine-versions --engine aurora-postgresql \
  --query "DBEngineVersions[?starts_with(EngineVersion,'16.')].EngineVersion"
```

Pass the chosen value with `--parameter-overrides EngineVersion=<offered-16.x>`.

### Prisma migrate and the populated-database `userId` backfill caveat

`buildspec.yml` runs `npx prisma migrate deploy` against Aurora. Per the
**production deployment checklist in the repo root `README.md`**: multi-tenancy
adds a **non-nullable `userId`** to `Todo`, `Category`, and `Tag`. On a fresh
database this just works. Against a database that **already contains rows**, an
unedited generated migration that adds a non-nullable `userId` will **fail**.
Author an explicit backfill migration that (1) adds the column as nullable,
(2) backfills existing rows with a real owner id, then (3) sets `NOT NULL` and
the foreign key, before letting `migrate deploy` run it in the pipeline. Do not
run the generated migration unchanged against existing data.

## Delivery safety

`buildspec.yml` and `CUTOVER.md` **never dump the full environment**: there is
no `printenv`, bare `env`, `set -x`/`set +x`, `process.env`, or `os.environ`
dump anywhere. Each step references only the specific variables it needs, and
the Aurora secret is read only at the migrate step and never echoed. The one
value the build prints for the operator is the non-secret `ArtifactObjectKey`.
The CodeBuild project declares only `ARTIFACT_BUCKET`, `AURORA_SECRET_ARN`,
`DB_HOST`, `DB_PORT`, and `DB_NAME`.

## Prerequisites

- An AWS account and credentials with permission to create the resources above.
- A region where Lambda Web Functions, `AWS::Lambda::NetworkConnector`, and
  Aurora PostgreSQL Serverless v2 are available.
- A GitHub source connection for CodeBuild to clone the repo.
- `CAPABILITY_IAM` when deploying (the stacks create IAM roles).

## Validation

Every CloudFormation template was validated through the AWS IaC MCP:
cfn-lint (`validate_cloudformation_template`) and cfn-guard
(`check_cloudformation_template_compliance`). The `buildspec.yml` and
`CUTOVER.md` are plain config/docs (not CloudFormation) and were reviewed
manually. The counts below were **re-validated after the review follow-up**
(dead `artifacts:` block removed; `appspec.yaml` removed; honesty/consistency
docs updated). Only `database.yaml` and `pipeline.yaml` changed templates; all
four were re-linted to confirm `error_count` stayed at 0.

### Cited AWS documentation

- AWS::Lambda::WebFunction — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunction.md>
- AWS::Lambda::WebFunctionRevision — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionrevision.md>
- AWS::Lambda::WebFunctionRevision ServiceConfig — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-webfunctionrevision-serviceconfig.md>
- AWS::Lambda::WebFunctionEndpoint — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionendpoint.md>
- AWS::Lambda::NetworkConnector — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-networkconnector.md>
- AWS::Lambda::NetworkConnector VpcEgressConfiguration — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-networkconnector-vpcegressconfiguration.md>
- AWS::RDS::DBCluster — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.md>
- AWS::RDS::DBCluster ServerlessV2ScalingConfiguration — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-rds-dbcluster-serverlessv2scalingconfiguration.md>
- AWS::CodeBuild::Project Artifacts (Type allowed values `CODEPIPELINE | S3 | NO_ARTIFACTS`) — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-codebuild-project-artifacts.md>
- CodeDeploy Lambda AppSpec / blue-green hook syntax (the real `AWS::Lambda::Function` alias schema, used to explain why the invented appspec was removed) — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-updatepolicy.md>
- AWS::SecretsManager::RotationSchedule (rotation deferred; reference for the future follow-up) — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-rotationschedule.md>

### cfn-lint results (error_count driven to 0)

Re-validated via `validate_cloudformation_template` after the review follow-up:

| Template | Errors | Warnings | Info | Changed in follow-up? |
|----------|:------:|:--------:|:----:|:---------------------:|
| network.yaml  | 0 | 0 | 0 | no |
| database.yaml | 0 | 0 | 0 | yes (EngineVersion desc + rotation comments) |
| app.yaml      | 0 | 0 | 0 | no |
| pipeline.yaml | 0 | 0 | 0 | yes (honest Description + CodeDeploy note) |

No `ignore_checks` were needed. Notably, cfn-lint **does** have schemas for the
new `AWS::Lambda::WebFunction*` and `AWS::Lambda::NetworkConnector` types: it
caught two genuinely-required `VpcEgressConfiguration` properties
(`NetworkProtocol`, `AssociatedComputeResourceTypes`), which were added. No
unknown-resource-type finding was emitted, so no suppression was required.

### cfn-guard results (findings addressed or justified)

cfn-guard runs the bundled `aws-security` rule set. Re-run via
`check_cloudformation_template_compliance` after the review follow-up: the
finding set is **unchanged** by the follow-up edits (which were docs/comment and
`Description`/parameter-description text only). For the record, the raw re-run
counts were: `database.yaml` 11 findings (the Aurora cluster-vs-instance and
managed-secret rules below), `pipeline.yaml` 7 findings (the S3 access-log
bucket rules + inline-policy check below). All are addressed or justified.

Findings addressed by changing the templates:

- **RDS_ENHANCED_MONITORING_ENABLED** — added `MonitoringInterval: 60` + an
  Enhanced Monitoring role to the Aurora instance.
- **RDS_AUTOMATIC_MINOR_VERSION_UPGRADE_ENABLED** — set
  `AutoMinorVersionUpgrade: true` on the instance.
- **S3_BUCKET_LOGGING_ENABLED** — added an access-log bucket and
  `LoggingConfiguration` on the artifact bucket.

Findings reviewed and **justified** (left as-is):

| Rule | Template | Justification |
|------|----------|---------------|
| `IAM_NO_INLINE_POLICY_CHECK` | network, database, app, pipeline | Inline policies are intentional: each role's permissions are scoped to the exact resources it needs (least privilege). Replacing them with broad AWS-managed policies would be less secure. |
| `IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE` | app | The connector operator role uses `Resource: "*"` only for `ec2:CreateNetworkInterface`/`Describe*`/`DeleteNetworkInterface`. These EC2 networking actions do not support resource-level scoping; this matches the AWS-managed `AWSLambdaVPCAccessExecutionRole` pattern required for VPC connectivity. |
| `RDS_MASTER_USER_NAME_USES_SECURE_PARAMETER`, `RDS_MASTER_USER_PASSWORD_USES_SECURE_PARAMETER`, `RDS_CLUSTER_MASTER_USER_PASSWORD_USES_SECURE_PARAMETER` | database | We use `ManageMasterUserPassword: true`, so RDS generates and stores the master password in Secrets Manager (encrypted with a CMK). This is strictly stronger than a NoEcho template parameter; the rule predates the managed-secret pattern. No password is ever in the template. |
| `RDS_MULTI_AZ_SUPPORT` | database | The `MultiAZ` instance property does not apply to Aurora; Aurora achieves AZ resilience at the cluster level (the DB subnet group spans two AZs). |
| `RDS_STORAGE_ENCRYPTED`, `RDS_INSTANCE_LOGGING_ENABLED`, `DB_INSTANCE_BACKUP_ENABLED`, `RDS_INSTANCE_DELETION_PROTECTION_ENABLED` | database | These rules inspect `AWS::RDS::DBInstance`, but for Aurora these are **cluster-level** settings and are all configured on `AWS::RDS::DBCluster`: `StorageEncrypted: true` (+ CMK), `EnableCloudwatchLogsExports: [postgresql]`, `BackupRetentionPeriod: 7`, `DeletionProtection: true`. Aurora instances inherit them. |
| `S3_BUCKET_DEFAULT_LOCK_ENABLED` | pipeline | Object Lock (WORM) is inappropriate for a transient, versioned build-artifact bucket whose old versions expire after 30 days. |
| `S3_BUCKET_REPLICATION_ENABLED` | pipeline | Cross-region replication is unnecessary for rebuildable build artifacts; it would add cost and complexity with no durability benefit for this use case. |
| `S3_BUCKET_NO_PUBLIC_RW_ACL` | pipeline | ACLs are disabled entirely (`OwnershipControls: BucketOwnerEnforced`) and all four `PublicAccessBlockConfiguration` settings are `true`; there is no public ACL. |
| `S3_BUCKET_SSL_REQUESTS_ONLY` | pipeline | A bucket policy **denies** all requests where `aws:SecureTransport` is `false` (see `ArtifactBucketPolicy`/`AccessLogBucketPolicy`); TLS-only is enforced. |

## What still requires a live AWS account

- Actually deploying the stacks, running CodeBuild, applying `prisma migrate
  deploy`, and performing the endpoint revision cutover.
- Confirming region availability of Lambda Web Functions / NetworkConnector.
- Setting up the CodeBuild GitHub source connection.
- Confirming the exact Aurora PostgreSQL `EngineVersion` string available in the
  target region (the `16.6` default may need adjusting to an offered 16.x; see
  "Aurora engine version" for the `describe-db-engine-versions` query).
- Enabling secret rotation for `JWT_SECRET` / `REMINDER_DISPATCH_SECRET` (and,
  if desired, the Aurora master secret) — deferred by design; see
  "Secret rotation".
