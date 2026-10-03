"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { UserApp } from "@/components/user/user-app";
import { AdminApp } from "@/components/admin/admin-app";
import { ADMIN_PORTAL_KEY, ADMIN_QUERY_PARAM } from "@/lib/constants";
import { Loader2 } from "lucide-react";

function PageContent() {
  const searchParams = useSearchParams();
  const portalValue = searchParams.get(ADMIN_QUERY_PARAM);

  // Hidden admin portal — only rendered when the exact secret query param
  // is present in the URL (e.g. https://domain/?portal=wan2-admin-secret).
  if (portalValue === ADMIN_PORTAL_KEY) {
    return <AdminApp adminKey={ADMIN_PORTAL_KEY} />;
  }

  // Default: the user-facing video generation studio.
  return <UserApp />;
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PageContent />
    </Suspense>
  );
}
