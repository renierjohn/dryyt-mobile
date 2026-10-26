import type { IconName } from '@/components/icon';

/** Vehicle codes, same as worker/src/lib/fees.ts VEHICLE_CATEGORIES (rates.category, driver_data.vehicle_type, bookings' vehicle_type). */
export const VEHICLE_TYPES = [
  { code: 1, label: 'Bicycle', icon: { ios: 'bicycle', android: 'pedal_bike', web: 'pedal_bike' } },
  { code: 2, label: 'Motorcycle', icon: { ios: 'motorcycle', android: 'two_wheeler', web: 'two_wheeler' } },
  // SF Symbols has no tricycle: the scooter is closest.
  { code: 3, label: 'Tricycle', icon: { ios: 'scooter', android: 'electric_rickshaw', web: 'electric_rickshaw' } },
  { code: 4, label: 'Car (lightweight)', icon: { ios: 'car.side', android: 'directions_car', web: 'directions_car' } },
] as const satisfies readonly { code: number; label: string; icon: IconName }[];

export const vehicleLabel = (code: number | null | undefined) => VEHICLE_TYPES.find((v) => v.code === code)?.label ?? 'Not set';
/** The vehicle's icon; a car for an unknown code. */
export const vehicleIcon = (code: number | null | undefined): IconName => VEHICLE_TYPES.find((v) => v.code === code)?.icon ?? VEHICLE_TYPES[3].icon;
