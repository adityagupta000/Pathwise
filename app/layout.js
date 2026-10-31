import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata = {
  title: "PathWise — AI Government Workflow Planner",
  description:
    "Turn multiple confusing government notices into one clear action plan. PathWise finds dependencies between documents so you know exactly what to do first.",
};

/** Separate viewport export (Next.js 16 requirement — do not put in metadata). */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
