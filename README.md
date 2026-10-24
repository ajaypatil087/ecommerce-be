# e-commerce-be

E-commerce backend API (Express + TypeScript) for users, products, carts, and orders. Local development uses [Floci](https://floci.io/floci/getting-started/quick-start/) as an AWS emulator on port `4566`, plus OpenSearch for search.

The API writes to DynamoDB in Floci. DynamoDB Streams invoke indexer Lambdas that write into OpenSearch. The Node process runs on your machine; Floci and OpenSearch run in Docker.

This repository lives in the `e-commerce-be` directory. In these steps, “Floci” always means the local AWS emulator, not this API.

## Prerequisites

- Node.js 22 or later
- npm
- Docker Desktop (or another Docker Engine with Compose v2)
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- Enough RAM for OpenSearch (the compose file sets a 512 MB Java heap)

Confirm Docker is running before you start the stack.

## 1. Start Floci and OpenSearch

From the `e-commerce-be` repository root:

```sh
docker compose up -d
```

This starts:

| Service     | Image                              | Host ports | Purpose |
|-------------|------------------------------------|------------|---------|
| `floci`     | `floci/floci:latest`               | `4566`     | Local DynamoDB, Lambda, CloudFormation, S3, and related AWS APIs |
| `opensearch`| `opensearchproject/opensearch:2`   | `9200`     | Search indexes for users and products |

Floci mounts the Docker socket so it can launch Lambda runtime containers on the shared `floci-net` network. Lambdas use the OpenSearch service name `http://opensearch:9200`; that hostname does not resolve from macOS, only from containers on that network.

Wait until both services respond:

```sh
curl -s http://localhost:4566/_floci/health
curl -s http://localhost:9200/_cluster/health?pretty
```

OpenSearch can take a minute on first start. Retry until the cluster health call succeeds.

For a persistent Floci volume, extra edge ports, and an OpenSearch healthcheck, use `local-stack.compose.yml` instead:

```sh
docker compose -f local-stack.compose.yml up -d
```

## 2. Create the API environment file

`.env` is gitignored. Create one in the repository root:

```sh
cat > .env << 'EOF'
JWT_SECRET=replace-with-a-local-secret

AWS_ENDPOINT_URL=http://localhost:4566
OPENSEARCH_ENDPOINT=http://opensearch:9200
OPENSEARCH_API_ENDPOINT=http://localhost:9200
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
USERS_TABLE=users
PRODUCTS_TABLE=products
CART_ORDERS_TABLE=cart-order
EOF
```

What each value is for:

- `AWS_ENDPOINT_URL` — AWS SDK calls from the API go to Floci, not real AWS.
- `OPENSEARCH_API_ENDPOINT` — the API on your machine talks to OpenSearch on `localhost:9200`.
- `OPENSEARCH_ENDPOINT` — indexer Lambdas talk to OpenSearch by Docker service name. CDK reads this from `.env` when you deploy.
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — dummy Floci credentials. Any non-empty values work. Do not use real AWS keys.
- Table names must match the CDK stack (`users`, `products`, `cart-order`).

Do not set `OPENSEARCH_AWS_REGION` for this local OpenSearch container (security plugin is disabled). That variable is only for an AWS-managed domain.

## 3. Install dependencies

```sh
npm install
cd aws/infra && npm install && cd ../..
```

## 4. Point the AWS CLI and CDK at Floci

Export these in the same shell you use for bootstrap and deploy. Without them, `cdk` talks to a real AWS account.

```sh
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_ENDPOINT_URL_S3=http://s3.localhost.floci.io:4566
export AWS_DEFAULT_REGION=us-east-1
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export CDK_DEFAULT_ACCOUNT=000000000000
export CDK_DEFAULT_REGION=us-east-1
```

`AWS_ENDPOINT_URL_S3` is required for CDK CLI 2.1000+, which uploads assets with virtual-hosted S3 URLs. `s3.localhost.floci.io` resolves locally to loopback.

Smoke-test Floci before deploying:

```sh
aws dynamodb list-tables --endpoint-url "$AWS_ENDPOINT_URL"
```

You should get a JSON table list (often empty on a fresh stack), not an AWS login or region error.

## 5. Bootstrap and deploy the CDK stack to Floci

The stack in `aws/infra` creates:

- DynamoDB tables `users`, `products`, and `cart-order`
- DynamoDB Streams on users and products
- `IndexUsersFunction` and `IndexProductsFunction` Lambdas that index into OpenSearch

```sh
cd aws/infra
npm run bootstrap
npx cdk deploy --require-approval never
cd ../..
```

`npm run bootstrap` runs `cdk bootstrap aws://000000000000/us-east-1`, the dummy account Floci uses.

Confirm the tables exist:

```sh
aws dynamodb list-tables --endpoint-url http://localhost:4566
```

You should see `users`, `products`, and `cart-order`.

If you already deployed and only changed Lambda or table code, run `npx cdk deploy --require-approval never` again from `aws/infra` with the same Floci exports.

## 6. Start the API

From the `e-commerce-be` repository root:

```sh
npm run dev
```

The server listens on **port 8080** by default (`PORT` overrides this). Nodemon reloads on changes under `src/`.

Health check:

```sh
curl -s http://localhost:8080/health
```

Expected: `{"status":"ok"}`.

Production-style run (no reload):

```sh
npm run build
npm start
```

Typecheck without emitting files:

```sh
npm run typecheck
```

## 7. Smoke-test the local stack

Create a user (this writes DynamoDB; the stream Lambda should index OpenSearch):

```sh
curl -i -X POST http://localhost:8080/api/user \
  -H 'content-type: application/json' \
  -d '{"firstName":"Ada","lastName":"Lovelace","email":"ada@example.test","password":"local-test-password","phoneNumber":"+15551234567","username":"adalovelace","zipcode":"12345"}'
```

A successful create is `201 Created`. Sign in:

```sh
curl -s -X POST http://localhost:8080/api/auth \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.test","password":"local-test-password"}'
```

Search users through the API (uses `OPENSEARCH_API_ENDPOINT`):

```sh
curl -s 'http://localhost:8080/api/user/search?q=ada'
```

Or query OpenSearch directly after a short delay:

```sh
curl -s 'http://localhost:9200/users/_search?q=email:ada@example.test&pretty'
```

Create a product, then search:

```sh
curl -s -X POST http://localhost:8080/api/product \
  -H 'content-type: application/json' \
  -d '{"name":"Trail Bottle","brand":"TrailCo","description":"Reusable bottle","price":19.99,"stock":10,"category":"Sports","status":"active"}'

curl -s 'http://localhost:8080/api/product/search?q=bottle'
```

Cart and order routes under `/api/cart` and `/api/order` require `Authorization: Bearer <token>` from `/api/auth`.

## 8. Optional: seed users

After the `users` table exists:

```sh
npm run seed:users
```

This inserts 100 synthetic users into DynamoDB. Stream indexers only see **new** writes; they do not backfill rows that existed before the Lambda mapping was attached. Seed (or create users) after a successful CDK deploy.

## 9. Stop local services

```sh
docker compose down
```

If you started the persistent file:

```sh
docker compose -f local-stack.compose.yml down
```

Add `-v` only if you want to delete the named volumes and wipe Floci/OpenSearch data.

## Troubleshooting

- **`cdk deploy` hits real AWS.** The Floci `AWS_*` exports are missing in that shell. Re-export them, then bootstrap/deploy again. Do not run CDK against your default AWS profile for this app.
- **Tables missing / `Cart storage is not configured`.** CDK did not deploy, or `.env` table names do not match the stack.
- **Lambda never indexes OpenSearch.** Confirm Floci has the Docker socket, OpenSearch is on the same compose network, and `OPENSEARCH_ENDPOINT=http://opensearch:9200` was present in `.env` at deploy time. Check Lambda logs through Floci. Search is eventually consistent; wait a few seconds and retry.
- **API can search but Lambda cannot (or the reverse).** Use `localhost:9200` only from the host process. Use `http://opensearch:9200` only from Lambda containers.
- **OpenSearch not ready.** Wait for `curl http://localhost:9200/_cluster/health` to succeed before creating users or products.
- **Port already in use.** Another process is bound to `4566`, `9200`, or `8080`. Stop it or change `PORT` for the API.

Indexer pipeline details: [docs/user-search-indexing.md](docs/user-search-indexing.md).
