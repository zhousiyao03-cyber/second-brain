"use client";

import Link from "next/link";
import { BrainCircuit, Zap, BookOpen, Search, BarChart3 } from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Token \u2192 Knowledge",
    description:
      "Every AI conversation becomes a permanent note. Your $20/mo subscription stops evaporating.",
  },
  {
    icon: BookOpen,
    title: "Learning Notebooks",
    description:
      "AI-generated outlines, blind-spot analysis, and review questions. Not just storage \u2014 comprehension.",
  },
  {
    icon: Search,
    title: "Hybrid RAG Search",
    description:
      "Semantic + keyword search across all your notes. Ask questions, get answers with source citations.",
  },
  {
    icon: BarChart3,
    title: "Token Usage Dashboard",
    description:
      'Track how much of your Claude subscription actually becomes knowledge. See your "conversion rate."',
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* Nav */}
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-stone-900">
            <BrainCircuit className="h-4 w-4" strokeWidth={2} />
          </div>
          <span className="text-sm font-semibold tracking-tight">Knosi</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-white px-3.5 py-1.5 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-200"
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pt-24 pb-20 text-center">
        <div className="mb-6 inline-block rounded-full border border-stone-800 px-3 py-1 text-xs text-stone-400">
          Open source &middot; AGPL-3.0
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Your Claude Max runs out.
          <br />
          <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
            Your notes don&apos;t.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-stone-400">
          Turn every valuable AI conversation into a knowledge base you own
          forever. Self-hosted, open-source.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition-colors hover:bg-stone-200"
          >
            Try the live demo
          </Link>
          <Link
            href="https://github.com/zhousiyao03-cyber/knosi"
            className="rounded-lg border border-stone-700 px-5 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-stone-500 hover:text-white"
          >
            Star on GitHub
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-2xl border border-stone-800 bg-stone-900/50 p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-500">
            The problem
          </h2>
          <p className="mt-4 text-xl font-medium leading-relaxed text-stone-200">
            You pay $20&ndash;200/month for Claude. Every brilliant insight, every
            solved problem, every learning moment &mdash; gone the moment you close
            the tab. Your tokens are{" "}
            <span className="text-red-400">consumed</span>, not{" "}
            <span className="text-cyan-300">converted</span>.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="mb-10 text-center text-sm font-semibold uppercase tracking-wider text-stone-500">
          The solution
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-stone-800 bg-stone-900/40 p-6"
            >
              <f.icon className="mb-3 h-5 w-5 text-cyan-400" strokeWidth={1.8} />
              <h3 className="text-base font-semibold text-stone-100">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Tech Stack */}
      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-stone-500">
          Built with
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-stone-500">
          {[
            "Next.js 16",
            "React 19",
            "Tailwind CSS v4",
            "tRPC v11",
            "SQLite / Turso",
            "Drizzle ORM",
            "Vercel AI SDK",
            "Tiptap v3",
          ].map((t) => (
            <span
              key={t}
              className="rounded-md border border-stone-800 px-2.5 py-1"
            >
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* Footer CTA */}
      <section className="mx-auto max-w-3xl px-6 pt-16 pb-24 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Stop losing your best thinking.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-stone-400">
          Every Claude conversation is an investment. Knosi makes sure it compounds.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition-colors hover:bg-stone-200"
          >
            Get started
          </Link>
          <Link
            href="https://github.com/zhousiyao03-cyber/knosi"
            className="rounded-lg border border-stone-700 px-5 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-stone-500 hover:text-white"
          >
            View source
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-800 py-8 text-center text-xs text-stone-600">
        Knosi &middot; AGPL-3.0
      </footer>
    </div>
  );
}
