import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import Footer from '../components/Footer';
import Header from '../components/Header';
import '../styles.css';

// TODO: replace with the real support/privacy inbox before publishing.
export const CONTACT_EMAIL = 'support@dryyt.com';
export const UPDATED = 'October 20, 2026';

export type Section = { id: string; title: string; body: ReactNode };

function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: Section[] }) {
	return (
		<>
			<Header />
			<main>
				<section className="legal-hero">
					<div className="container">
						<h1>{title}</h1>
						<p>Last updated: {UPDATED}</p>
					</div>
				</section>
				<article className="container legal">
					<p>{intro}</p>
					<nav className="legal-toc" style={{ marginTop: 24 }}>
						<strong>Contents</strong>
						<ol>
							{sections.map((s) => (
								<li key={s.id}>
									<a href={`#${s.id}`}>{s.title}</a>
								</li>
							))}
						</ol>
					</nav>
					{sections.map((s, i) => (
						<section key={s.id} id={s.id}>
							<h2>
								{i + 1}. {s.title}
							</h2>
							{s.body}
						</section>
					))}
				</article>
			</main>
			<Footer />
		</>
	);
}

export function renderLegal(props: { title: string; intro: string; sections: Section[] }) {
	createRoot(document.getElementById('root')!).render(
		<StrictMode>
			<LegalPage {...props} />
		</StrictMode>,
	);
}
