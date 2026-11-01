import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { useApi } from './useList';
import { VEHICLE_LABEL } from './vehicles';

type Driver = { id: number; name: string; email: string; phone: string; vehicle_type: number | null; notes: string; group_id: string };
type Form = Omit<Driver, 'id'>;

/** Drivers tab "#" cell: opens the driver's info to edit; `onSaved` reloads the list. */
export function DriverEditCell({ id, onSaved, onAuthError }: { id: number; onSaved: () => void; onAuthError: (e: unknown) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button className="cp-link" onClick={() => setOpen(true)} title="Edit driver">
				<b>{id}</b>
			</button>
			{open && (
				<DriverEditModal
					id={id}
					onClose={() => setOpen(false)}
					onSaved={() => {
						setOpen(false);
						onSaved();
					}}
					onAuthError={onAuthError}
				/>
			)}
		</>
	);
}

function DriverEditModal({ id, onClose, onSaved, onAuthError }: { id: number; onClose: () => void; onSaved: () => void; onAuthError: (e: unknown) => void }) {
	const { data, error } = useApi<{ driver: Driver }>(`/admin/drivers/${id}`, {}, onAuthError);
	const groups = useApi<{ groups: string[] }>('/admin/groups', {}, onAuthError).data?.groups;
	const [form, setForm] = useState<Form | null>(null);
	const [saving, setSaving] = useState(false);
	const [msg, setMsg] = useState('');

	useEffect(() => {
		if (data) setForm({ ...data.driver });
	}, [data]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const set = <K extends keyof Form>(key: K, value: Form[K]) => form && setForm({ ...form, [key]: value });

	const save = async (e: FormEvent) => {
		e.preventDefault();
		if (!form) return;
		setSaving(true);
		setMsg('');
		try {
			await api(`/admin/drivers/${id}`, { body: form });
			onSaved();
		} catch (err) {
			setMsg(err instanceof Error ? err.message : 'Save failed');
			onAuthError(err);
		} finally {
			setSaving(false);
		}
	};

	// Keep the driver's current area listed even if its rates were removed.
	const areas = form && groups ? (groups.includes(form.group_id) ? groups : [form.group_id, ...groups]) : form ? [form.group_id] : [];

	return (
		<div className="cp-modal-backdrop" onClick={onClose}>
			<div className="cp-modal" role="dialog" aria-modal="true" aria-label={`Edit driver #${id}`} onClick={(e) => e.stopPropagation()}>
				<div className="cp-modal-head">
					<h3>
						Edit driver #{id}
						{data && <small className="cp-sub">{data.driver.name}</small>}
					</h3>
					<button className="cp-btn-ghost cp-btn-xs" onClick={onClose} aria-label="Close">
						✕
					</button>
				</div>
				{error && <p className="cp-error">{error}</p>}
				{!form && !error && <p className="cp-muted">Loading…</p>}
				{form && (
					<form className="cp-fee-form" onSubmit={save}>
						<label className="cp-field">
							Name
							<input value={form.name} onChange={(e) => set('name', e.target.value)} required maxLength={100} />
						</label>
						<label className="cp-field">
							Email
							<input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
						</label>
						<label className="cp-field">
							Phone
							<input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} required minLength={7} maxLength={30} />
						</label>
						<label className="cp-field">
							Vehicle
							<select value={form.vehicle_type ?? ''} onChange={(e) => set('vehicle_type', e.target.value === '' ? null : Number(e.target.value))}>
								<option value="">Not set</option>
								{Object.entries(VEHICLE_LABEL).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</label>
						<label className="cp-field">
							Area
							<select value={form.group_id} onChange={(e) => set('group_id', e.target.value)}>
								{areas.map((g) => (
									<option key={g} value={g}>
										{g}
									</option>
								))}
							</select>
						</label>
						<label className="cp-field">
							Notes
							<input value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={200} />
						</label>
						<div className="cp-rate-actions">
							<span className="cp-muted cp-grow">The area changes only while the driver is offline and not on a job.</span>
							{msg && <span className="cp-error-inline">{msg}</span>}
							<button type="button" className="cp-btn-ghost" disabled={saving} onClick={onClose}>
								Cancel
							</button>
							<button type="submit" className="cp-btn cp-btn-sm" disabled={saving}>
								{saving ? 'Saving…' : 'Save'}
							</button>
						</div>
					</form>
				)}
			</div>
		</div>
	);
}
