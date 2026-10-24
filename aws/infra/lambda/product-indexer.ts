import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

const endpoint = process.env.OPENSEARCH_ENDPOINT;
const indexName = process.env.OPENSEARCH_INDEX ?? "products";

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
      if (record.eventName === "REMOVE") {
        const keys = record.dynamodb?.Keys;
        if (!keys) throw new Error("Product remove record is missing its key");
        const key = unmarshall(keys as Record<string, AttributeValue>);
        if (typeof key.id !== "string") throw new Error("Product remove record is missing its id");
        await client.delete({ index: indexName, id: key.id }, { ignore: [404] });
        continue;
      }

      if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") continue;
      const image = record.dynamodb?.NewImage;
      if (!image) throw new Error(`Product ${record.eventName} record is missing its new image`);

      const product = unmarshall(image as Record<string, AttributeValue>);
      if (typeof product.id !== "string") throw new Error("Product stream record is missing its id");

      await client.index({
        index: indexName,
        id: product.id,
        body: product,
      });
    } catch (error) {
      console.error(`Failed to process product stream record ${sequenceNumber}:`, error);
      batchItemFailures.push({ itemIdentifier: sequenceNumber });
    }
  }

  return { batchItemFailures };
};
