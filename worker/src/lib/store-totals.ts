// Store totals shared by the cpanel (/admin/stores) and the owner app (/owner/app-fee).

/** Done jobs of `table` at store st.id in the range (two binds: from, to). */
const doneAt = (table: string, status: string) =>
  `FROM ${table} WHERE store_id = st.id AND status = '${status}' AND date(updated_at, '+8 hours') BETWEEN ? AND ?`;

/**
 * Stores (as `s`) with what they brought in during a Manila date range, counting delivered pickups and completed drop offs:
 * service_fee (the app's cut of delivery fees), sales (pickup items + drop off laundry fees) and app_fee (the store's
 * fee_type: 1 flat fee_flat, 2 fee_percentage of sales, rounded up to a whole peso). Bind `storeRange`.
 */
export const STORE_TOTALS = `(
  SELECT t.*,
    CASE WHEN t.fee_type = 2 THEN ((CAST(ROUND(t.sales * t.fee_percentage / 100.0) AS INTEGER) + 99) / 100) * 100 ELSE t.fee_flat END AS app_fee
  FROM (
    SELECT st.id, st.name, st.type, st.address, st.group_id, st.store_logo, st.owner_id,
      ow.name AS owner_name, ow.email AS owner_email, st.fee_type, st.fee_flat, st.fee_percentage,
      (SELECT COALESCE(SUM(service_fee), 0) ${doneAt('transactions_pickup', 'delivered')}) +
        (SELECT COALESCE(SUM(service_fee), 0) ${doneAt('transactions_dropoff', 'completed')}) AS service_fee,
      (SELECT COALESCE(SUM(items_total), 0) ${doneAt('transactions_pickup', 'delivered')}) +
        (SELECT COALESCE(SUM(laundry_fee), 0) ${doneAt('transactions_dropoff', 'completed')}) AS sales,
      (SELECT COUNT(*) FROM transactions_pickup WHERE store_id = st.id) AS order_count,
      (SELECT COUNT(*) FROM transactions_dropoff WHERE store_id = st.id) AS dropoff_count
    FROM stores st LEFT JOIN users ow ON ow.id = st.owner_id
  ) t
) s`;
export const storeRange = ([from, to]: readonly [string, string]) => [from, to, from, to, from, to, from, to];

