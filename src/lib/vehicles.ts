/** Vehicle codes, same as worker/src/lib/fees.ts VEHICLE_CATEGORIES (rates.category, driver_data.vehicle_type). */
export const VEHICLE_TYPES = [
  { code: 1, label: 'Bicycle' },
  { code: 2, label: 'Motorcycle' },
  { code: 3, label: 'Tricycle' },
  { code: 4, label: 'Car (lightweight)' },
] as const;

export const vehicleLabel = (code: number | null | undefined) => VEHICLE_TYPES.find((v) => v.code === code)?.label ?? 'Not set';
