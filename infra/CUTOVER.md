# todo-backend revision cutover notes (NOT a CodeDeploy AppSpec)

> This file replaces the earlier `appspec.yaml`. That file used an invented
> `AWS::Lambda::WebFunctionEndpoint` / `TrafficShifting` / `TargetRevision`
> schema that is **not** the real CodeDeploy Lambda AppSpec and was consumed by
> nothing. It has been removed to avoid implying an operative deploy descriptor
> exists. See the "Why this is not a CodeDeploy AppSpec" section below.

## How the Web Function traffic cutover actually works

AWS Lambda Web Functions shift traffic **natively** through the endpoint's
`RevisionWeights` property on `AWS::Lambda::WebFunctionEndpoint` (one or two
revisions, each with an integer weight that sums to 100). There is no CodeDeploy
deployment, no CodeDeploy AppSpec, and no CodePipeline in the cutover path.

The cutover is a **manual CloudFormation update** to `app.yaml`:

1. Run the CodeBuild project. It builds, runs `prisma migrate deploy`, uploads
   the app `.zip` to the artifact bucket, and prints an `ArtifactObjectKey=...`
   line in its build log.
2. Copy that object key and pass it to the `app` stack as the
   `ArtifactObjectKey` parameter:

   ```bash
   aws cloudformation deploy \
     --stack-name todo-backend-app \
     --template-file infra/cloudformation/app.yaml \
     --parameter-overrides \
       NetworkStackName=todo-backend-network \
       DatabaseStackName=todo-backend-database \
       PipelineStackName=todo-backend-pipeline \
       ArtifactObjectKey=todo-backend/<sha>.zip \
     --capabilities CAPABILITY_IAM
   ```

   CloudFormation creates a new `AWS::Lambda::WebFunctionRevision` from that
   object and updates the endpoint's `RevisionWeights` to point at it.

> **S3-source builds.** The CodeBuild role can only read the pipeline stack's
> artifact bucket (`ArtifactBucketName` output), so upload the source zip there
> (it is versioned) under a prefix such as `src/`, read its `VersionId` with
> `aws s3api head-object`, and start the build with
> `--source-type-override S3 --source-location-override
> <ArtifactBucketName>/src/<name>.zip --source-version <VersionId>`. A zip in
> any other bucket fails with an access-denied error for `s3:GetObjectVersion`.
> For an S3 source `CODEBUILD_RESOLVED_SOURCE_VERSION` is empty, so the key
> printed in the log is
> `todo-backend/build-<build-number>-<epoch-seconds>.zip` instead of
> `todo-backend/<sha>.zip`. Always copy the key from the `ArtifactObjectKey=`
> log line and pass it as `ArtifactObjectKey`. The build fails rather than
> upload a key like `todo-backend/.zip`.

### Canary / blue-green (optional)

`RevisionWeights` accepts up to two revisions. To canary, deploy the new
revision at a partial weight (for example `90/10`) by editing the
`RevisionWeights` list in `app.yaml`, deploy, observe, then update to `100`
for the new revision. This is edited directly in the template; it is not driven
by a CodeDeploy deployment configuration.

## Why this is not a CodeDeploy AppSpec

The real CodeDeploy Lambda AppSpec (verified against the AWS CloudFormation /
CodeDeploy documentation) targets a classic `AWS::Lambda::Function` **alias**:

```yaml
# Illustrative shape of a REAL CodeDeploy Lambda AppSpec (we do NOT use this):
version: 0.0
Resources:
  - myFunction:
      Type: AWS::Lambda::Function
      Properties:
        Name: my-function
        Alias: live
        CurrentVersion: "1"
        TargetVersion: "2"
Hooks:
  - BeforeAllowTraffic: my-pre-traffic-hook
  - AfterAllowTraffic: my-post-traffic-hook
```

A CodeDeploy Lambda deployment group shifts an **alias** between two numbered
versions of a traditional `AWS::Lambda::Function`. A `WebFunctionEndpoint` has
no alias and no numbered versions; CodeDeploy cannot drive its `RevisionWeights`.
That is why there is no `AWS::CodeDeploy::DeploymentGroup` and no appspec here:
the native endpoint mechanism replaces both. See `infra/README.md` for the
honest accounting of what CodeBuild and the CodeDeploy application do and do not
automate.
