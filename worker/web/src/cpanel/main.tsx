import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Cpanel from './Cpanel';
import './cpanel.css';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<Cpanel />
	</StrictMode>,
);
