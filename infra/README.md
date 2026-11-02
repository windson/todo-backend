# todo-backend AWS Infrastructure (CloudFormation + CodeBuild/CodeDeploy)

Infrastructure-as-Code to host the Next.js 16 **todo-backend** API as an **AWS
Lambda Web Function** (a new capability), backed by **Aurora PostgreSQL
Serverless v2**, with all secrets in **AWS Secrets Manager** and a
**CodeBuild + CodeDeploy** delivery pipeline.

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
                                            `next start` on PORT 8080)
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

   CI/CD:   GitHub ─▶ CodeBuild (npm ci → prisma generate → next build →
            prisma migrate deploy → zip → s3 cp) ─▶ S3 artifact bucket
            ─▶ CodeDeploy (Lambda) / WebFunctionEndpoint RevisionWeights cutover
```

## Templates

| File | Stack | Contents |
|------|-------|----------|
| `cloudformation/network.yaml`  | network  | VPC, 2 private subnets (2 AZs), route table, VPC flow logs, Aurora SG + Web Function connector SG (ingress 5432 from connector only) |
| `cloudformation/database.yaml` | database | Customer-managed KMS key, Aurora PostgreSQL Serverless v2 cluster (`StorageEncrypted`, RDS-managed master secret), `db.serverless` instance, enhanced monitoring, DB subnet group, Secrets Manager secrets for `JWT_SECRET` and `REMINDER_DISPATCH_SECRET` |
| `cloudformation/app.yaml`      | app      | `AWS::Lambda::WebFunction` + `WebFunctionRevision` + `WebFunctionEndpoint`, `AWS::Lambda::NetworkConnector` (VPC egress to Aurora), least-privilege execution role, connector operator role |
| `cloudformation/pipeline.yaml` | pipeline | S3 artifact bucket (SSE-KMS, public access blocked, TLS-only, access-logged) + access-log bucket, CodeBuild project, CodeDeploy application (ComputePlatform `Lambda`), least-privilege CodeBuild/CodeDeploy roles |
| `buildspec.yml`  | (CodeBuild) | Build + migrate + package + upload steps |
| `appspec.yaml`   | (CodeDeploy) | Revision/endpoint cutover descriptor |

## Deploy order

Stacks use cross-stack `Export`/`ImportValue`, so deploy them in order:

1. **network** → exports `PrivateSubnetIds`, `AuroraSgId`, `WebFunctionConnectorSgId`
2. **database** (pass `NetworkStackName`) → exports `ClusterEndpoint`, `ClusterPort`, `DatabaseName`, `MasterUserSecretArn`, `JwtSecretArn`, `ReminderDispatchSecretArn`, `DataKmsKeyArn`
3. **pipeline** (pass `DatabaseStackName`) → exports `ArtifactBucketName`
4. Run the **CodeBuild** project → produces the app `.zip` in the artifact bucket and runs `prisma migrate deploy`
5. **app** (pass `NetworkStackName`, `DatabaseStackName`, `PipelineStackName`, and the `ArtifactObjectKey` emitted by the build) → creates/updates the Web Function revision and shifts endpoint traffic to it

Example (requires a real account/credentials; not run here):

```bash
aws cloudformation deploy --stack-name todo-backend-network  --template-file infra/cloudformation/network.yaml  --capabilities CAPABILITY_IAM
aws cloudformation deploy --stack-name todo-backend-database --template-file infra/cloudformation/database.yaml --parameter-overrides NetworkStackName=todo-backend-network --capabilities CAPABILITY_IAM
aws cloudformation deploy --stack-name todo-backend-pipeline --template-file infra/cloudformation/pipeline.yaml --parameter-overrides DatabaseStackName=todo-backend-database --capabilities CAPABILITY_IAM
aws codebuild start-build --project-name todo-backend-pipeline-build
aws cloudformation deploy --stack-name todo-backend-app --template-file infra/cloudformation/app.yaml \
  --parameter-overrides NetworkStackName=todo-backend-network DatabaseStackName=todo-backend-database PipelineStackName=todo-backend-pipeline ArtifactObjectKey=todo-backend/<sha>.zip \
  --capabilities CAPABILITY_IAM
```

## Parameters

- **network.yaml**: `VpcCidr` (default `10.42.0.0/16`), `PrivateSubnet1Cidr`, `PrivateSubnet2Cidr`.
- **database.yaml**: `NetworkStackName`, `DatabaseName` (`tododb`), `MasterUsername` (`todoadmin`), `EngineVersion` (`16.6`, PostgreSQL 16 line, matching `docker-compose` `postgres:16`), `MinCapacity` (`0.5`), `MaxCapacity` (`4`).
- **app.yaml**: `NetworkStackName`, `DatabaseStackName`, `PipelineStackName`, `ArtifactObjectKey`, `Runtime` (`nodejs24.x`), `FunctionName` (`todo-backend-api`), `Port` (`8080`), `TimeoutSeconds` (`30`).
- **pipeline.yaml**: `DatabaseStackName`, `SourceRepositoryUrl`, `SourceBranch` (`feat/aws-iac-cicd`).

## The Web Function server process

The Web Function runs the standard `next start` HTTP server (see `package.json`
`start` script). Next.js reads `PORT` from the environment; the revision sets
`PORT=8080`, so **no change to `next.config.ts` was required** and none was made
(per `AGENTS.md`, Next.js runtime/build config is left untouched). `NODE_ENV` is
set to `production`, which makes the app enforce a real `JWT_SECRET` (it throws
if unset in production) rather than the dev default.

## Environment and secret wiring

No secret value appears in any template. Secrets are injected into the Web
Function revision `EnvironmentVariables` via `resolve:secretsmanager` dynamic
references, and CodeBuild reads only the one secret it needs for migration:

| Variable | Source | How it reaches the runtime |
|----------|--------|----------------------------|
| `DATABASE_URL` | RDS-managed master secret (`username`/`password` keys) + exported cluster endpoint/port/db name | Assembled with `resolve:secretsmanager` inside `app.yaml`; `sslmode=require` |
| `JWT_SECRET` | `AWS::SecretsManager::Secret` (`GenerateSecretString`) | `resolve:secretsmanager` dynamic reference |
| `REMINDER_DISPATCH_SECRET` | `AWS::SecretsManager::Secret` (`GenerateSecretString`) | `resolve:secretsmanager` dynamic reference |
| `PORT`, `NODE_ENV` | literal (`8080`, `production`) | plain revision env vars |

The Aurora **master password is generated and stored by RDS**
(`ManageMasterUserPassword: true`), encrypted with the stack's customer-managed
KMS key. `DATABASE_URL` is assembled at deploy time from that secret plus the
exported cluster host/port/database name; it is never stored in plaintext.

## CodeBuild + CodeDeploy flow

- **CodeBuild** (`buildspec.yml`): `npm ci` → `npx prisma generate` →
  `npm run build` (`next build`) → assemble `DATABASE_URL` from the Aurora
  secret → `npx prisma migrate deploy` → `zip` the app → `aws s3 cp` to the
  artifact bucket → emit `artifact.json` with the `ArtifactObjectKey`.
- **CodeDeploy** (`AWS::CodeDeploy::Application`, `ComputePlatform: Lambda`) is
  provisioned as the deployment controller. **Honest note:** Lambda Web
  Functions shift traffic *natively* through the endpoint's `RevisionWeights`
  (one or two revisions with weights) rather than through classic CodeDeploy
  Lambda *alias* deployment groups, which target a traditional
  `AWS::Lambda::Function`. The cutover is therefore expressed by updating
  `RevisionWeights` on `AWS::Lambda::WebFunctionEndpoint` in `app.yaml`; the
  CodeDeploy application is wired in as the delivery controller and the
  `appspec.yaml` documents the revision cutover contract.

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

## CI/CD pipeline safety

`buildspec.yml` and `appspec.yaml` **never dump the full environment**: there is
no `printenv`, bare `env`, `set -x`/`set +x`, `process.env`, or `os.environ`
dump anywhere. Each step references only the specific variables it needs, and
the Aurora secret is read only at the migrate step and never echoed. The
CodeBuild project declares only `ARTIFACT_BUCKET`, `AURORA_SECRET_ARN`,
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
`appspec.yaml` are plain config (not CloudFormation) and were reviewed manually.

### Cited AWS documentation

- AWS::Lambda::WebFunction — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunction.md>
- AWS::Lambda::WebFunctionRevision — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionrevision.md>
- AWS::Lambda::WebFunctionRevision ServiceConfig — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-webfunctionrevision-serviceconfig.md>
- AWS::Lambda::WebFunctionEndpoint — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionendpoint.md>
- AWS::Lambda::NetworkConnector — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-networkconnector.md>
- AWS::Lambda::NetworkConnector VpcEgressConfiguration — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-lambda-networkconnector-vpcegressconfiguration.md>
- AWS::RDS::DBCluster — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.md>
- AWS::RDS::DBCluster ServerlessV2ScalingConfiguration — <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-rds-dbcluster-serverlessv2scalingconfiguration.md>

### cfn-lint results (error_count driven to 0)

| Template | Errors | Warnings | Info |
|----------|:------:|:--------:|:----:|
| network.yaml  | 0 | 0 | 0 |
| database.yaml | 0 | 0 | 0 |
| app.yaml      | 0 | 0 | 0 |
| pipeline.yaml | 0 | 0 | 0 |

No `ignore_checks` were needed. Notably, cfn-lint **does** have schemas for the
new `AWS::Lambda::WebFunction*` and `AWS::Lambda::NetworkConnector` types: it
caught two genuinely-required `VpcEgressConfiguration` properties
(`NetworkProtocol`, `AssociatedComputeResourceTypes`), which were added. No
unknown-resource-type finding was emitted, so no suppression was required.

### cfn-guard results (findings addressed or justified)

cfn-guard runs the bundled `aws-security` rule set. Findings addressed by
changing the templates:

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
  target region (the `16.6` default may need adjusting to an offered 16.x).
