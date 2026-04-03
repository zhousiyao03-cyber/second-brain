import dynamic from "next/dynamic";

const FocusPageClient = dynamic(() =>
  import("@/components/focus/focus-page-client").then(
    (m) => m.FocusPageClient
  )
);

export default function FocusPage() {
  return <FocusPageClient />;
}
