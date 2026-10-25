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

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to="/messenger" replace />}
      />

      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/register"
        element={<RegisterPage />}
      />

      <Route element={<ProtectedRoute />}>
        <Route
          path="/messenger"
          element={<MessengerPage />}
        />

        <Route
          path="/profile"
          element={<ProfilePage />}
        />
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