// Test-only entry point: mounts the same <App /> that app/page.tsx renders.
import { createRoot } from 'react-dom/client';
import App from '../../components/App';

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
