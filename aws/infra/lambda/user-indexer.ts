import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

const endpoint = process.env.OPENSEARCH_ENDPOINT;
const indexName = process.env.OPENSEARCH_INDEX ?? "users";

if (!endpoint) {
  throw new Error("OPENSEARCH_ENDPOINT is required");
}

const client = new Client({
  node: endpoint,
  ...(process.env.OPENSEARCH_AWS_REGION
    ? AwsSigv4Signer({
        region: process.env.OPENSEARCH_AWS_REGION,
        service: "es",
        getCredentials: async () => {
          const { defaultProvider } = await import("@aws-sdk/credential-provider-node");
          return defaultProvider()();
        },
      })
    : {}),
});

export const handler = async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
  const batchItemFailures: DynamoDBBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    const sequenceNumber = record.dynamodb?.SequenceNumber;

    if (!sequenceNumber || !record.eventName) continue;

    try {
      switch (record.eventName) {
        case "INSERT":
        case "MODIFY": {
          const image = record.dynamodb?.NewImage;
          if (!image) throw new Error(`DynamoDB ${record.eventName} record is missing its new image`);

          const user = unmarshall(image as Record<string, AttributeValue>);
          if (typeof user.id !== "string") throw new Error("DynamoDB stream record is missing the user id");

          // INSERT creates a search document; MODIFY replaces it by the same ID.
          // Never put password material, including hashes, into the search index.
          const { password: _password, passwordHash: _passwordHash, ...searchableUser } = user;
          await client.index({
            index: indexName,
            id: searchableUser.id,
            body: searchableUser,
          });
          break;
        }

        case "REMOVE": {
          const keys = record.dynamodb?.Keys;
          if (!keys) throw new Error("DynamoDB remove record is missing its key");
          const key = unmarshall(keys as Record<string, AttributeValue>);
          if (typeof key.id !== "string") throw new Error("DynamoDB remove record is missing the user id");
          await client.delete({ index: indexName, id: key.id }, { ignore: [404] });
          break;
        }

        default:
          console.warn(`Ignoring unsupported DynamoDB stream event: ${record.eventName}`);
      }
    } catch (error) {
      console.error(`Failed to process DynamoDB stream record ${sequenceNumber}:`, error);
      batchItemFailures.push({ itemIdentifier: sequenceNumber });
    }
  }

  return { batchItemFailures };
};
