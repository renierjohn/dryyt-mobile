/** Today's date in Manila as YYYY-MM-DD. */
export const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** YYYY-MM-DD moved by whole months, kept to the month's last day (Jan 31 + 1 → Feb 28, Mar 31 − 1 → Feb 28). */
export function addMonths(d: string, months: number) {
	const [y, m, dd] = d.split('-').map(Number);
	const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
	return new Date(Date.UTC(y, m - 1 + months, Math.min(dd, last))).toISOString().slice(0, 10);
}

/** Where every date range filter starts: this month (Manila), from its 1st through its last day. */
export const defaultRange = () => {
	const [y, m] = today().split('-').map(Number);
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
	const month = `${y}-${String(m).padStart(2, '0')}`;
	return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};
