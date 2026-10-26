
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { AuthProvider } from "./contexts/AuthProvider";
import ProtectedRoute from "./routes/ProtectedRoute";

import ChatRealtimeProvider from
  "./features/realtime/ChatRealtimeProvider";

import LoginPage from "./features/auth/pages/LoginPage";
import RegisterPage from "./features/auth/pages/RegisterPage";

import MessengerPage from
  "./features/conversations/pages/MessengerPage";

import ProfilePage from "./features/users/pages/ProfilePage";
import UserSearchPage from "./features/users/pages/UserSearchPage";

import FriendsPage from "./features/friends/pages/FriendsPage";

import MessengerLayout from "./layouts/MessengerLayout";

// =====================================================
// APPLICATION ROUTES
// =====================================================

function AppRoutes() {
  return (
    <Routes>
      {/* ROOT */}
      <Route
        path="/"
        element={
          <Navigate to="/messenger" replace />
        }
      />

      {/* PUBLIC */}
      <Route
        path="/login"
        element={<LoginPage />}
      />

      <Route
        path="/register"
        element={<RegisterPage />}
      />

      {/* PROTECTED */}
      <Route element={<ProtectedRoute />}>
        {/* SHARED MESSENGER SIDEBAR */}
        <Route element={<MessengerLayout />}>
          {/* CONVERSATION LIST */}
          <Route
            path="/messenger"
            element={<MessengerPage />}
          />

          {/* CONVERSATION DETAILS */}
          <Route
            path="/messenger/:conversationId"
            element={<MessengerPage />}
          />

          {/* PROFILE */}
          <Route
            path="/profile"
            element={<ProfilePage />}
          />

          {/* SEARCH USERS */}
          <Route
            path="/users/search"
            element={<UserSearchPage />}
          />

          {/* FRIENDS */}
          <Route
            path="/friends"
            element={<FriendsPage />}
          />
        </Route>
      </Route>

      {/* FALLBACK */}
      <Route
        path="*"
        element={
          <Navigate to="/messenger" replace />
        }
      />
    </Routes>
  );
}

// =====================================================
// APPLICATION
// =====================================================

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ChatRealtimeProvider>
          <AppRoutes />
        </ChatRealtimeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
