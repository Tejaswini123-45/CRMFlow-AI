/**
 * Frontend Entry Point
 * Phase 1 Placeholder - will be expanded in Phase 6+
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/index.css';

function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          CRM Ingestion Engine
        </h1>
        <p className="text-lg text-gray-700 mb-2">
          Phase 1: Project Setup & Scaffolding complete
        </p>
        <p className="text-gray-600">
          Frontend structure ready for Phase 6 implementation
        </p>
        <div className="mt-8 p-6 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Tech Stack
          </h2>
          <ul className="list-disc list-inside text-gray-600 space-y-1">
            <li>React 18</li>
            <li>Vite</li>
            <li>Tailwind CSS</li>
            <li>JavaScript (ES Modules)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
