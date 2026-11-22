import { z } from "zod";

/** One definition of a global account: system admin, or the admin role. */
export function isGlobalUser(user: { role: string; isSystemAdmin?: boolean } | undefined): boolean {
  return user?.isSystemAdmin === true || user?.role === "admin";
}

export const ESTABLISHMENTS = ["Bison Den", "Trailblazer Café"] as const;
export const GLOBAL_ESTABLISHMENT = "Global";

export const establishmentSchema = z.enum(ESTABLISHMENTS);

export const UNITS = [
  "grams",
  "kilograms",
  "milliliters",
  "liters",
  "units",
  "oz",
  "cups",
  "bowls",
  "tablespoons",
  "pieces",
] as const;

export const unitSchema = z.enum(UNITS);

export const ROLE_RANK: Record<string, number> = {
  admin: 5,
  manager: 4,
  supervisor: 3,
  lead: 2,
  employee: 1,
};

export function hasLowerRank(actorRole: string, targetRole: string): boolean {
  const actorRank = ROLE_RANK[actorRole];
  const targetRank = ROLE_RANK[targetRole];
  if (actorRank === undefined || targetRank === undefined) return false;
  return targetRank < actorRank;
}

export function canAccessEstablishment(
  user: { role: string; isSystemAdmin?: boolean; establishment: string },
  establishment: string,
): boolean {
  return isGlobalUser(user) || user.establishment === establishment;
}

/** Convert a recipe amount into the inventory item's unit. Undefined means the units are incompatible. */
export function convertQuantity(quantity: number, fromUnit: string, toUnit: string): number | undefined {
  const from = unitBase(fromUnit);
  const to = unitBase(toUnit);
  if (!from || !to || from.base !== to.base) return undefined;
  return (quantity * from.factor) / to.factor;
}

function unitBase(unit: string): { base: string; factor: number } | undefined {
  switch (unit.trim().toLowerCase()) {
    case "g":
    case "gram":
    case "grams":
      return { base: "g", factor: 1 };
    case "kg":
    case "kilogram":
    case "kilograms":
      return { base: "g", factor: 1000 };
    case "oz":
      return { base: "g", factor: 28.3495 };
    case "ml":
    case "milliliter":
    case "milliliters":
      return { base: "ml", factor: 1 };
    case "l":
    case "liter":
    case "liters":
      return { base: "ml", factor: 1000 };
    case "cup":
    case "cups":
      return { base: "ml", factor: 240 };
    case "tablespoon":
    case "tablespoons":
      return { base: "ml", factor: 15 };
    case "piece":
    case "pieces":
    case "unit":
    case "units":
    case "bowl":
    case "bowls":
      return { base: "piece", factor: 1 };
    default:
      return undefined;
  }
}
