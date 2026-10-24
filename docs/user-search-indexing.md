# DynamoDB Streams to OpenSearch: step-by-step

The API only writes users to DynamoDB. DynamoDB Streams records each table change and invokes the indexer Lambda asynchronously:

1. The API validates the request, hashes the password, and saves the user in DynamoDB.
2. DynamoDB emits a `NEW_IMAGE` stream record; no separate SQS publish call is needed.
3. The stream event source invokes the Lambda. It indexes INSERT/MODIFY records into the OpenSearch `users` index, using the user ID as the document ID, and removes documents for DynamoDB REMOVE records.
4. The Lambda excludes plaintext passwords and password hashes from OpenSearch. Failed records are retried; after the configured retries, they are discarded from this stream consumer, so monitor Lambda errors and the DynamoDB stream iterator age.

## 1. Start the local services

Start your Docker Desktop services and confirm that DynamoDB/LocalStack and OpenSearch are healthy and reachable. The API's `AWS_ENDPOINT_URL` is used for local AWS SDK calls. The API process and Lambda may need different OpenSearch addresses: `OPENSEARCH_API_ENDPOINT` is used by the API (use `http://localhost:9200` when OpenSearch's container port 9200 is published to the Mac), while `OPENSEARCH_ENDPOINT` is used by the Lambda and must be reachable **from the Lambda runtime**. In a shared Docker network this is normally the OpenSearch service name and port, such as `http://opensearch:9200`; use the actual service name and port from your compose configuration. Docker service names do not normally resolve from a process running directly on macOS.

If the OpenSearch container requires a username/password, TLS, or other authentication, configure the Lambda client accordingly before using it. This example assumes a locally reachable OpenSearch endpoint without authentication. For an AWS-managed OpenSearch domain, provide `OPENSEARCH_AWS_REGION` and `OPENSEARCH_DOMAIN_ARN` when synthesizing/deploying so the Lambda uses SigV4 and receives HTTP permissions. Do not expose an AWS domain publicly to make local development easier.

## 2. Deploy the CDK stack

From `aws/infra`, synthesize first and inspect the generated template:

```sh
npm run build
npx cdk synth
```

Then deploy to the same AWS environment as your API, or use the LocalStack-compatible CDK deploy command/configuration for your Docker environment:

```sh
npx cdk deploy
```

The stack enables a `NEW_IMAGE` DynamoDB stream on `users` and connects it directly to the indexer Lambda. There is no SQS queue or queue URL to configure. For local Floci, make sure Lambda runtime containers can launch and join the same Docker network as OpenSearch. Ensure CDK is configured to deploy to Floci, not to a real AWS account. Plain `npx cdk deploy` without an emulator endpoint deploys to the AWS environment configured by your AWS CLI.

The API still needs `AWS_ENDPOINT_URL` to write to Floci, but it no longer needs `USER_CREATED_QUEUE_URL`. The Lambda subscribes directly to the table stream and indexes only new changes; existing table records are not automatically backfilled. Use the project seed script again or add a one-time backfill process if records already exist. Local Floci credentials are for development only; AWS deployments should use the normal IAM role/credential chain.

## 3. Create a user and follow the stream

Send a valid request to the route registered by your users router. For example, assuming it is mounted at `/api/user`:

```sh
curl -i -X POST http://localhost:8080/api/user \
  -H 'content-type: application/json' \
  -d '{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.test","password":"use-a-local-test-password","phoneNumber":"+15551234567","username":"adalovelace","zipcode":"12345"}'
```

A successful response is `201 Created`. The API writes the user once; the DynamoDB stream independently drives indexing. Search is eventually consistent, so the document may not appear immediately.

## 5. Verify the document

After the Lambda processes the stream record, query the local OpenSearch endpoint, for example:

```sh
curl 'http://localhost:9200/users/_search?q=email:ada@example.test&pretty'
```

The API returns before indexing completes, so allow a short delay and retry the search. Confirm that the indexed document contains the user profile fields and does not contain `password` or `passwordHash`.

## 6. Troubleshoot retries and dead letters

- Check the Lambda logs for OpenSearch connection, endpoint, permissions, or stream-image errors.
- Confirm the Lambda can resolve/reach the OpenSearch hostname from its runtime network.
- Check the DynamoDB stream is enabled with `NEW_IMAGE`, the Lambda event source mapping is enabled, and the stream iterator age is not growing.
- DynamoDB Streams retains records for 24 hours. If the Lambda remains unavailable longer, records expire; use a reconciliation/backfill job to index existing users.
- Make sure the OpenSearch index is named `users` and that the endpoint includes the scheme (`http://` or `https://`).
