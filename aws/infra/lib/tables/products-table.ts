import * as cdk from "aws-cdk-lib/core";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

export const createProductsTable = (scope: Construct): dynamodb.Table => {
  const table = new dynamodb.Table(scope, "ProductsTable", {
    tableName: process.env.PRODUCTS_TABLE || "products",
    partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
    sortKey: { name: "category", type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    removalPolicy: cdk.RemovalPolicy.DESTROY, // Suitable for local development only.
  });

  table.addGlobalSecondaryIndex({
    indexName: "name-category-index",
    partitionKey: { name: "name", type: dynamodb.AttributeType.STRING },
    sortKey: { name: "category", type: dynamodb.AttributeType.STRING },
  });

  return table;
};
