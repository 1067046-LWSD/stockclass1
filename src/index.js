import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0d0d0f', color: '#eeeef2', fontFamily: 'monospace', padding: 32,
        }}>
          <div style={{ maxWidth: 640 }}>
            <div style={{ color: '#ff3b5c', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
              App crashed — check the console for details
            </div>
            <pre style={{
              background: 'rgba(255,59,92,0.08)', border: '1px solid rgba(255,59,92,0.2)',
              borderRadius: 8, padding: 16, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>{String(this.state.error)}</pre>
            <button onClick={() => window.location.reload()} style={{
              marginTop: 16, padding: '8px 20px', background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
              cursor: 'pointer', color: '#eeeef2', fontSize: 13,
            }}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

reportWebVitals();
