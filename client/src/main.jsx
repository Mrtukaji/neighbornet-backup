import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AdminApp from "./AdminApp.jsx";
import AuthApp from "./AuthApp.jsx";
import "./index.css";
import "leaflet/dist/leaflet.css";

// Simple component to handle email verification redirect
function VerifyEmail() {
  useEffect(() => {
    // Redirect to auth page with token
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) {
      window.location.href = `/auth?token=${token}`;
    } else {
      window.location.href = '/auth';
    }
  }, []);
  return <div>Redirecting...</div>;
}

// Simple component to handle password reset redirect
function ResetPassword() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) {
      window.location.href = `/auth?reset_token=${token}`;
    } else {
      window.location.href = '/auth';
    }
  }, []);
  return <div>Redirecting...</div>;
}

const path = window.location.pathname;

let Screen = App;

if (path.startsWith("/admin")) {
  Screen = AdminApp;
} else if (path.startsWith("/auth")) {
  Screen = AuthApp;
} else if (path === "/verify-email") {
  Screen = VerifyEmail;
} else if (path === "/reset-password") {
  Screen = ResetPassword;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Screen />
  </StrictMode>
);