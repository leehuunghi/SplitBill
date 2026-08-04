import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ChiaTeamView from './ChiaTeamView.jsx';
import ChiaTeamAdmin from './ChiaTeamAdmin.jsx';
import './index.css';

const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
const RootComponent =
  pathname === '/admin/chiateam' ? ChiaTeamAdmin : pathname === '/chiateam' ? ChiaTeamView : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
