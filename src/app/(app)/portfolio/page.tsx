import { Metadata } from "next";
import { PortfolioClient } from "./_client";

export const metadata: Metadata = {
  title: "Portfolio",
};

export default function PortfolioPage() {
  return <PortfolioClient />;
}
