// app/auth-success/page.tsx
"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function AuthSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");

    if (token) {
      // 1. Store the token exactly like your normal login does
      localStorage.setItem("token", token);
      
      // 2. Redirect to dashboard
      router.push("/dashboard/assessment/new");
    } else {
      // If no token, send back to login
      router.push("/login?error=Authentication failed");
    }
  }, [router, searchParams]);

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Completing login...</p>
      </div>
    </div>
  );
}

export default function AuthSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Completing login...</p>
          </div>
        </div>
      }
    >
      <AuthSuccessContent />
    </Suspense>
  );
}