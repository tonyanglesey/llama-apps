import { customAlphabet } from "nanoid";

// Stripe-style prefixed ids to match the lla.ma convention (proj_, dpl_, dom_).
const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 14);

export const newId = (prefix: string): string => `${prefix}_${nano()}`;
