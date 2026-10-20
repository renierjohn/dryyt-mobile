import Header from './components/Header';
import Hero from './components/Hero';
import Services from './components/Services';
import Why from './components/Why';
import HowItWorks from './components/HowItWorks';
import Partners from './components/Partners';
import Tracker from './components/Tracker';
import Faq from './components/Faq';
import Footer from './components/Footer';

export default function App() {
	return (
		<>
			<Header />
			<main>
				<Hero />
				<Services />
				<Why />
				<HowItWorks />
				<Tracker />
				<Partners />
				<Faq />
			</main>
			<Footer />
		</>
	);
}
