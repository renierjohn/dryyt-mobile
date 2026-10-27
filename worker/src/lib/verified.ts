import { fail } from './http';

/** SQL: the driver `userId` column's account is verified (driver_data.status = 1). */
export const verifiedDriverSql = (userId: string) => `EXISTS (SELECT 1 FROM driver_data WHERE user_id = ${userId} AND status = 1)`;

/** Unverified drivers can't go online or take jobs. */
export const UNVERIFIED = 'Get verified before taking jobs: add your photos, license plate and vehicle in Profile.';

export async function isVerifiedDriver(db: D1Database, userId: number) {
  return Boolean(await db.prepare('SELECT 1 FROM driver_data WHERE user_id = ? AND status = 1').bind(userId).first());
}

export async function requireVerifiedDriver(db: D1Database, userId: number) {
  if (!(await isVerifiedDriver(db, userId))) fail(403, UNVERIFIED);
}
