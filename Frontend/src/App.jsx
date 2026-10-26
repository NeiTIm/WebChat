import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import { AuthProvider } from "./contexts/AuthProvider";
import ProtectedRoute from "./routes/ProtectedRoute";

import LoginPage from "./features/auth/pages/LoginPage";
import RegisterPage from "./features/auth/pages/RegisterPage";

import MessengerPage from "./features/conversations/MessengerPage";

import ProfilePage from "./features/users/pages/ProfilePage";
import UserSearchPage from "./features/users/pages/UserSearchPage";

import FriendsPage from "./features/friends/pages/FriendsPage";

import MessengerLayout from "./layouts/MessengerLayout";

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to="/messenger" replace />}
      />

      <Route
        path="/login"
        element={<LoginPage />}
      />

      <Route
        path="/register"
        element={<RegisterPage />}
      />

      {/* Chỉ người đã đăng nhập được truy cập */}
      <Route element={<ProtectedRoute />}>
        {/* Sidebar dùng chung cho toàn bộ các trang */}
        <Route element={<MessengerLayout />}>
          <Route
            path="/messenger"
            element={<MessengerPage />}
          />

          <Route
            path="/profile"
            element={<ProfilePage />}
          />

          <Route
            path="/users/search"
            element={<UserSearchPage />}
          />

          <Route
            path="/friends"
            element={<FriendsPage />}
          />
        </Route>
      </Route>

      <Route
        path="*"
        element={<Navigate to="/messenger" replace />}
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}