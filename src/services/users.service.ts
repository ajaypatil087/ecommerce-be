import { Client } from "@opensearch-project/opensearch";
import { AwsSigv4Signer } from "@opensearch-project/opensearch/aws";
import type { Request, Response } from "express";
import userSchema from "../dto/userSchema";
import { dynamoDbClient, USERS_TABLE } from "../db/dynamoDB";
import { PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import bcrypt from "bcryptjs";
import { getAuthenticatedUserId } from "../util/common";
import logger from "../util/logger";

type SearchCursor = { sort: Array<string | number | boolean> };

let searchClient: Client | undefined;

const getOpenSearchClient = () => {
  if (searchClient) return searchClient;

  const endpoint = process.env.OPENSEARCH_API_ENDPOINT ?? process.env.OPENSEARCH_ENDPOINT;
  if (!endpoint) throw new Error("OPENSEARCH_ENDPOINT is not configured");

  searchClient = new Client({
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

  return searchClient;
};

const ensureUsersIndex = async (client: Client, index: string) => {
  const existingIndex = await client.indices.exists({ index });
  if (existingIndex.body) return;

  try {
    await client.indices.create({
      index,
      body: {
        mappings: {
          properties: {
            id: { type: "text", fields: { keyword: { type: "keyword" } } },
          },
        },
      },
    });
  } catch (error) {
    const indexAfterCreate = await client.indices.exists({ index });
    if (!indexAfterCreate.body) throw error;
  }
};

const parseSearchCursor = (value: string): SearchCursor | undefined => {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return undefined;

    const sort = (decoded as { sort?: unknown }).sort;
    if (
      !Array.isArray(sort) ||
      !sort.every((part) => typeof part === "string" || typeof part === "number" || typeof part === "boolean")
    ) {
      return undefined;
    }

    return { sort };
  } catch {
    return undefined;
  }
};

export const searchUsers = async (req: Request, res: Response) => {
  const rawQuery = req.query.q;
  const rawLimit = req.query.limit;
  const rawCursor = req.query.cursor;

  if (rawQuery !== undefined && typeof rawQuery !== "string") {
    return res.status(400).json({ error: "q must be a single string" });
  }

  const limit = rawLimit === undefined ? 10 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: "limit must be an integer between 1 and 100" });
  }

  if (rawCursor !== undefined && typeof rawCursor !== "string") {
    return res.status(400).json({ error: "cursor must be a single string" });
  }

  const cursor = rawCursor ? parseSearchCursor(rawCursor) : undefined;
  if (rawCursor && !cursor) {
    return res.status(400).json({ error: "Invalid search cursor" });
  }

  try {
    const client = getOpenSearchClient();
    const index = process.env.OPENSEARCH_INDEX ?? "users";
    await ensureUsersIndex(client, index);

    const searchResponse = await client.search({
      index,
      body: {
        size: limit + 1,
        ...(cursor ? { search_after: cursor.sort } : {}),
        sort: [{ "id.keyword": { order: "asc" } }],
        track_total_hits: true,
        _source: { excludes: ["password", "passwordHash"] },
        query: rawQuery?.trim()
          ? {
              multi_match: {
                query: rawQuery.trim(),
                fields: ["firstName^2", "lastName^2", "email^3", "username^2", "phoneNumber", "zipcode"],
                type: "best_fields",
                operator: "and",
              },
            }
          : { match_all: {} },
      },
    });

    const hits = searchResponse.body.hits.hits;
    const pageHits = hits.slice(0, limit);
    const hasMore = hits.length > limit;
    const lastHit = pageHits.at(-1);
    const nextCursor =
      hasMore && lastHit?.sort ? Buffer.from(JSON.stringify({ sort: lastHit.sort })).toString("base64url") : null;
    const total = searchResponse.body.hits.total;

    return res.status(200).json({
      results: pageHits.map((hit) => hit._source),
      pagination: {
        limit,
        total: typeof total === "number" ? total : (total?.value ?? 0),
        nextCursor,
        hasMore,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "OpenSearch user query failed");
    return res.status(502).json({ error: "Search service is unavailable" });
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 10 : Number(rawLimit);
    const rawCursor = req.query.cursor;

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: "limit must be an integer between 1 and 100" });
    }

    if (rawCursor !== undefined && typeof rawCursor !== "string") {
      return res.status(400).json({ error: "cursor must be a single string" });
    }

    let exclusiveStartKey: { id: string } | undefined;
    if (rawCursor) {
      try {
        const decoded: unknown = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8"));
        if (
          !decoded ||
          typeof decoded !== "object" ||
          Array.isArray(decoded) ||
          typeof (decoded as { id?: unknown }).id !== "string"
        ) {
          return res.status(400).json({ error: "Invalid pagination cursor" });
        }
        exclusiveStartKey = decoded as { id: string };
      } catch {
        return res.status(400).json({ error: "Invalid pagination cursor" });
      }
    }

    const result = await dynamoDbClient.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const users = (result.Items ?? []).map(({ passwordHash: _passwordHash, ...user }) => user);
    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url")
      : null;

    return res.status(200).json({
      users,
      pagination: { limit, nextCursor, hasMore: nextCursor !== null },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to fetch users");
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const createUser = async (req: Request, res: Response) => {
  const body = userSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.flatten().fieldErrors });
  }
  const { password, ...profile } = body.data;

  try {
    const existingUser = await dynamoDbClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: "email-index",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": profile.email,
        },
        Limit: 1,
      }),
    );

    if (existingUser.Items && existingUser.Items.length > 0) {
      return res.status(409).json({ error: "User with this email already exists" });
    }
    const user = {
      id: crypto.randomUUID(),
      ...profile,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: new Date().toISOString(),
    };
    await dynamoDbClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: user,
        ConditionExpression: "attribute_not_exists(id)", // Ensure no overwrite
      }),
    );
    logger.info({ userId: user.id }, "User created");
    const { passwordHash, ...userWithoutPassword } = user;
    return res.status(201).json({ user: userWithoutPassword });
  } catch (error) {
    logger.error({ err: error }, "Failed to create user");
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await dynamoDbClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: {
          ":id": id,
        },
        Limit: 1,
      }),
    );
    if (!user.Items || user.Items.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const { passwordHash, ...userWithoutPassword } = user.Items[0];
    return res.status(200).json({ user: userWithoutPassword });
  } catch (error) {
    logger.error({ err: error }, "Failed to fetch user");
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const mySelf = async (req: Request, res: Response) => {
  try {
    const id = getAuthenticatedUserId(req);
    const user = await dynamoDbClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        KeyConditionExpression: "id = :id",
        ExpressionAttributeValues: {
          ":id": id,
        },
        Limit: 1,
      }),
    );
    if (!user.Items || user.Items.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const { passwordHash, ...userWithoutPassword } = user.Items[0];
    return res.status(200).json({ user: userWithoutPassword });
  } catch (error) {
    logger.error({ err: error }, "Failed to fetch user");
    return res.status(500).json({ error: "Internal server error" });
  }
};
