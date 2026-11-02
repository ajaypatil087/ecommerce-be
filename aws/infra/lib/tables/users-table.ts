import * as cdk from "aws-cdk-lib/core";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

export const createUsersTable = (scope: Construct): dynamodb.Table => {
  const removalPolicy = process.env.DEPLOY_API_TO_ECS === "true" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
  const table = new dynamodb.Table(scope, "usersTable", {
    tableName: process.env.DYNAMODB_USERS_TABLE || "users",
    partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    stream: dynamodb.StreamViewType.NEW_IMAGE,
    removalPolicy,
  });

  table.addGlobalSecondaryIndex({
    indexName: "email-index",
    partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
  });

  return table;
};
