import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { McpActivityProvider } from './hooks/use-mcp-activity';
import './styles/index.css';

const root = document.querySelector('#root');
if (!root) throw new Error('React admin root is missing');

createRoot(root).render(
  <StrictMode>
    <McpActivityProvider>
      <App />
    </McpActivityProvider>
  </StrictMode>,
);
