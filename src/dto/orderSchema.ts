import z from "zod";

const orderSchema = z.object({
  paymentMethod: z.enum(["CREDIT_CARD", "UPI", "DEBIT_CARD", "CASH_ON_DELIVERY"]),
  address: z.object({
    adressLine1: z.string(),
    addressLine2: z.string().optional(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
});

export default orderSchema;
