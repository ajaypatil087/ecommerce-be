import * as cdk from "aws-cdk-lib/core";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { InfraStack } from "../lib/infra-stack";

test("DynamoDB stream invokes the OpenSearch indexer", () => {
  const app = new cdk.App();
  const stack = new InfraStack(app, "TestInfraStack");
  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::DynamoDB::Table", {
    StreamSpecification: { StreamViewType: dynamodb.StreamViewType.NEW_IMAGE },
  });
  template.hasResourceProperties("AWS::DynamoDB::Table", {
    TableName: "products",
    KeySchema: [
      { AttributeName: "id", KeyType: "HASH" },
      { AttributeName: "category", KeyType: "RANGE" },
    ],
    StreamSpecification: { StreamViewType: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES },
    AttributeDefinitions: [
      { AttributeName: "id", AttributeType: "S" },
      { AttributeName: "category", AttributeType: "S" },
      { AttributeName: "name", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "name-category-index",
        KeySchema: [
          { AttributeName: "name", KeyType: "HASH" },
          { AttributeName: "category", KeyType: "RANGE" },
        ],
      },
    ],
  });
  template.hasResourceProperties("AWS::DynamoDB::Table", {
    TableName: "cart-order",
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
    ],
  });
  template.resourceCountIs("AWS::DynamoDB::Table", 3);
  template.resourceCountIs("AWS::Lambda::EventSourceMapping", 2);
  template.resourceCountIs("AWS::Logs::LogGroup", 2);
  template.hasResourceProperties("AWS::Logs::LogGroup", {
    LogGroupName: "/ecommerce/index-users",
    RetentionInDays: 30,
  });
  template.hasResourceProperties("AWS::Logs::LogGroup", {
    LogGroupName: "/ecommerce/index-products",
    RetentionInDays: 30,
  });
  template.hasResourceProperties("AWS::Lambda::Function", {
    LoggingConfig: {
      LogFormat: "JSON",
      ApplicationLogLevel: "INFO",
      SystemLogLevel: "INFO",
      LogGroup: Match.anyValue(),
    },
  });
  template.hasResourceProperties("AWS::Lambda::Function", {
    LoggingConfig: {
      LogFormat: "JSON",
      ApplicationLogLevel: "INFO",
      SystemLogLevel: "INFO",
      LogGroup: Match.anyValue(),
    },
  });
  template.resourceCountIs("AWS::SQS::Queue", 0);
});
