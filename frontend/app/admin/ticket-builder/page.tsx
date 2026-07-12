import { Suspense } from "react";
import TicketBuilderClient from "./ticket-builder-client";

export default function AdminTicketBuilderPage() {
  return (
    <Suspense fallback={null}>
      <TicketBuilderClient />
    </Suspense>
  );
}
