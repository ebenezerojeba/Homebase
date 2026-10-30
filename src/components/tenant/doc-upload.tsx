"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileUpload } from "@/components/ui/file-upload";

export function TenantDocUpload({ tenancyId }: { tenancyId: string }) {
  const router = useRouter();
  const [key, setKey] = useState(0);
  return (
    <FileUpload
      key={key}
      kind="tenancy_document"
      tenancyId={tenancyId}
      max={1}
      label="Share a document with your landlord"
      hint="PDF or photo · up to 10 MB · don't upload ID documents"
      onChange={(f) => {
        if (f.length) {
          setKey((k) => k + 1);
          router.refresh();
        }
      }}
    />
  );
}
