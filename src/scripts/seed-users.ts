import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDbClient, USERS_TABLE } from "../db/dynamoDB";

const USER_COUNT = 100;
const BATCH_SIZE = 25;
const firstNames = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Skyler"];
const lastNames = ["Parker", "Reed", "Hayes", "Brooks", "Foster", "Bennett", "Coleman", "Price", "Ward", "Rivera"];

const randomItem = (items: string[]) => items[Math.floor(Math.random() * items.length)]!;

const main = async () => {
  if (!USERS_TABLE) {
    throw new Error("USERS_TABLE must be set in the environment before seeding.");
  }

  const users = await Promise.all(
    Array.from({ length: USER_COUNT }, async () => {
      const id = randomUUID();
      const firstName = randomItem(firstNames);
      const lastName = randomItem(lastNames);
      const username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${id.slice(0, 8)}`;
      const password = randomUUID();

      return {
        id,
        firstName,
        lastName,
        email: `${username}@example.test`,
        username,
        phoneNumber: `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`,
        zipcode: String(Math.floor(10_000 + Math.random() * 90_000)),
        passwordHash: await bcrypt.hash(password, 10),
        createdAt: new Date().toISOString(),
      };
    }),
  );

  for (let offset = 0; offset < users.length; offset += BATCH_SIZE) {
    const batch = users.slice(offset, offset + BATCH_SIZE);
    let pending = batch.map((Item) => ({ PutRequest: { Item } }));
    let attempts = 0;

    while (pending.length > 0 && attempts < 5) {
      const result = await dynamoDbClient.send(
        new BatchWriteCommand({
          RequestItems: { [USERS_TABLE]: pending },
        }),
      );
      pending = (result.UnprocessedItems?.[USERS_TABLE] ?? []) as typeof pending;
      attempts += 1;
    }

    if (pending.length > 0) {
      throw new Error(`DynamoDB left ${pending.length} writes unprocessed after retries.`);
    }

    console.log(`Seeded ${Math.min(offset + batch.length, users.length)}/${users.length} users.`);
  }

  console.log(`Successfully seeded ${users.length} users into table "${USERS_TABLE}".`);
};

main().catch((error: unknown) => {
  console.error("User seeding failed:", error);
  process.exitCode = 1;
});
