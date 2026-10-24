import z from "zod";

export enum ProductCategory {
  Electronics = "Electronics",
  Clothing = "Clothing",
  Home = "Home",
  Beauty = "Beauty",
  Sports = "Sports",
  Books = "Books",
  Toys = "Toys",
  Automotive = "Automotive",
  Health = "Health",
  Grocery = "Grocery",
}

const productSchema = z.object({
  name: z.string().trim().min(1, { message: "Product name is required" }),
  brand: z.string().trim().min(1, { message: "Product brand is required" }),
  description: z.string().trim().min(1, { message: "Product description is required" }),
  price: z.number().positive({ message: "Product price must be a positive number" }),
  stock: z.number().int().nonnegative({ message: "Product stock must be a non-negative integer" }),
  tags: z.array(z.string().trim()).optional(),
  category: z.enum(ProductCategory, { message: "Invalid product category" }),
  status: z.enum(["active", "inactive"], { message: "Invalid product status" }).optional(),
});

export default productSchema;
