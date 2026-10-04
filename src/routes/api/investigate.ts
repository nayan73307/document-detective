import { createFileRoute } from "@tanstack/react-router";
import { handleInvestigate } from "@/lib/investigate.server";

export const Route = createFileRoute("/api/investigate")({
  server: { handlers: { POST: ({ request }) => handleInvestigate(request) } },
});
