import { ThemeProvider } from './context/ThemeContext';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    <ThemeProvider>
      <Dashboard />
    </ThemeProvider>
  );
}
