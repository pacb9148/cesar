"use client";

import { useRouter } from "next/navigation";

export default function BotonSalir() {
  const router = useRouter();
  return (
    <button
      className="btn btn-sec"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      Salir
    </button>
  );
}
