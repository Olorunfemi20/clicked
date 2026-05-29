"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type AuthContextType = {
  token: string | null;
  setToken: (token: string | null) => void;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType>({
  token: null,
  setToken: () => {},
  isLoading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load token from localStorage
    const stored = localStorage.getItem("auth_token");
    const envToken = process.env.NEXT_PUBLIC_AUTH_TOKEN;
    setToken(stored || envToken || null);
    setIsLoading(false);
  }, []);

  const updateToken = (newToken: string | null) => {
    if (newToken) {
      localStorage.setItem("auth_token", newToken);
    } else {
      localStorage.removeItem("auth_token");
    }
    setToken(newToken);
  };

  return (
    <AuthContext.Provider value={{ token, setToken: updateToken, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
