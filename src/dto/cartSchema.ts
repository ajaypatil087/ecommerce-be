import z from "zod";

const cartSchema = z.object({
  products: z.array(
    z.object({
      productId: z.string().trim().min(1, { message: "Product ID is required" }),
      quantity: z.number().int().positive({ message: "Quantity must be a positive integer" }),
    }),
  ),
});

export default cartSchema;
