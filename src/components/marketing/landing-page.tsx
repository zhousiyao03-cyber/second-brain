"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  PenTool,
  Brain,
  Server,
  Bookmark,
  Search,
  Layers,
  RotateCw,
  Zap,
  Code2,
  Lightbulb,
  GraduationCap,
  Rocket,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { faqs, GITHUB_URL } from "./landing-data";

/* ─── data ──────────────────────────────────────────────── */

const navLinks = [
  { label: "Product", href: "#features" },
  { label: "How it works", href: "#workflow" },
  { label: "Self-host", href: "#selfhost" },
];

const valueCards = [
  {
    icon: Bookmark,
    title: "Save what matters",
    description:
      "Turn high-value Claude and ChatGPT outputs into structured notes instead of letting them disappear into old sessions.",
  },
  {
    icon: Search,
    title: "Ask AI on top of your own knowledge",
    description:
      "Search your notes with hybrid retrieval and continue asking questions grounded in your own corpus.",
  },
  {
    icon: Server,
    title: "Own your stack",
    description:
      "Self-host locally or deploy your own instance. Keep your data, workflows, and knowledge under your control.",
  },
];

const workflowSteps = [
  {
    step: "01",
    title: "Capture",
    description:
      "Take a useful AI answer, idea, debugging path, research thread, or project plan.",
  },
  {
    step: "02",
    title: "Structure",
    description:
      "Refine it in a rich block editor with headings, code blocks, diagrams, callouts, tables, and links.",
  },
  {
    step: "03",
    title: "Index",
    description:
      "Store it in your own knowledge base with keyword + semantic retrieval.",
  },
  {
    step: "04",
    title: "Reuse",
    description:
      "Come back later and ask follow-up questions against what you\u2019ve already learned.",
  },
];

const featureModules = [
  {
    icon: PenTool,
    title: "AI-native knowledge capture",
    description:
      "Save ideas from Claude and ChatGPT into notes you can organize, edit, and revisit.",
  },
  {
    icon: Layers,
    title: "Powerful block editor",
    description:
      "Write in a Notion-like editor with code blocks, Mermaid diagrams, Excalidraw, tables, callouts, toggles, and structured content blocks.",
  },
  {
    icon: Brain,
    title: "Hybrid Ask AI",
    description:
      "Search with semantic retrieval + keyword recall, then ask grounded questions with source-aware answers.",
  },
  {
    icon: Zap,
    title: "Claude Code Daemon",
    description:
      "Route AI features through your existing Claude Pro or Max subscription instead of burning extra API credits.",
  },
  {
    icon: Server,
    title: "Self-hostable",
    description:
      "Use the hosted version at knosi.xyz, or run your own instance with Docker, k3s, or any cloud VM. Your notes and workflows stay in your control.",
  },
  {
    icon: RotateCw,
    title: "Built for long-term memory",
    description:
      "Don\u2019t just save documents. Build a knowledge system that gets more useful the more you use AI.",
  },
];

const audienceGroups = [
  {
    icon: Code2,
    title: "Developers",
    description:
      "Save debugging sessions, architecture ideas, implementation plans, and research notes.",
  },
  {
    icon: Lightbulb,
    title: "AI builders",
    description:
      "Turn experiments, prompts, comparisons, and model workflows into structured knowledge.",
  },
  {
    icon: GraduationCap,
    title: "Learners",
    description:
      "Keep study notes, outlines, blind spots, and follow-up questions in one searchable place.",
  },
  {
    icon: Rocket,
    title: "Independent makers",
    description:
      "Preserve product thinking, strategy notes, and execution context instead of scattering them across chats and docs.",
  },
];

/* ─── component ─────────────────────────────────────────── */

export function LandingPage() {
  useEffect(() => {
    const body = document.body;
    const prev = body.style.backgroundColor;
    body.style.backgroundColor = "#0c0a09";
    return () => {
      body.style.backgroundColor = prev;
    };
  }, []);

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      {/* ── Nav ─────────────────────────────────────────── */}
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <Image
            src="/knosi-logo.png"
            alt="Knosi"
            width={32}
            height={32}
            className="rounded-lg"
            unoptimized
          />
          <span className="text-sm font-semibold tracking-tight">Knosi</span>
        </div>

        <div className="hidden items-center gap-6 sm:flex">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-stone-400 transition-colors hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={GITHUB_URL}
            className="hidden rounded-lg border border-stone-700 px-3.5 py-1.5 text-sm font-medium text-stone-300 transition-colors hover:border-stone-500 hover:text-white sm:inline-flex"
          >
            GitHub
          </Link>
          <Link
            href="/login"
            className="hidden rounded-lg border border-stone-700 px-3.5 py-1.5 text-sm font-medium text-stone-300 transition-colors hover:border-stone-500 hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-white px-3.5 py-1.5 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-200"
          >
            Sign up
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pt-24 pb-12 text-center">
        <p className="mb-4 text-sm font-medium tracking-wider text-cyan-400 uppercase">
          AI-native &middot; Built for developers &middot; Self-hostable
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Turn AI conversations into
          <br />
          knowledge you{" "}
          <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
            actually own
          </span>
          .
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-stone-400">
          Knosi helps developers save Claude and ChatGPT outputs into a
          searchable, reusable second brain. Organize ideas in a powerful editor,
          ask AI across your own corpus, and keep the value of your AI workflow
          instead of losing it in old sessions.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition-colors hover:bg-stone-200"
          >
            Get started &mdash; free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href={GITHUB_URL}
            className="rounded-lg border border-stone-700 px-5 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-stone-500 hover:text-white"
          >
            View on GitHub
          </Link>
        </div>
        <p className="mt-6 text-sm text-stone-500">
          Free to use on knosi.xyz. Open source and self-hostable if you want to
          run your own.
        </p>
      </section>

      {/* ── Product shots ───────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="overflow-hidden rounded-2xl border border-stone-800 bg-stone-900/40 shadow-2xl shadow-black/50">
          <Image
            src="/screenshots/home.png"
            alt="Knosi Home dashboard — today's focus, 30-day heatmap, and recent notes"
            width={2560}
            height={1440}
            className="w-full"
            priority
          />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          <figure className="overflow-hidden rounded-xl border border-stone-800 bg-stone-900/40">
            <Image
              src="/screenshots/notes.png"
              alt="Knosi Notes — folder tree with Engineering, Product, Reading, and Prompts collections"
              width={2560}
              height={1440}
              className="w-full"
            />
            <figcaption className="px-4 py-3 text-sm text-stone-400">
              <span className="font-medium text-stone-200">Notes.</span>{" "}
              Folder-organised knowledge base with full-text search and wiki-links.
            </figcaption>
          </figure>
          <figure className="overflow-hidden rounded-xl border border-stone-800 bg-stone-900/40">
            <Image
              src="/screenshots/editor.png"
              alt="Knosi editor — Tiptap note with Mermaid pipeline diagram, code block, and callout"
              width={2560}
              height={1440}
              className="w-full"
            />
            <figcaption className="px-4 py-3 text-sm text-stone-400">
              <span className="font-medium text-stone-200">Editor.</span>{" "}
              Rich blocks: Mermaid, code, callouts, tables, and Excalidraw.
            </figcaption>
          </figure>
          <figure className="overflow-hidden rounded-xl border border-stone-800 bg-stone-900/40">
            <Image
              src="/screenshots/ask-ai.png"
              alt="Knosi Ask AI — daily AI assistant scoped to your own corpus"
              width={2560}
              height={1440}
              className="w-full"
            />
            <figcaption className="px-4 py-3 text-sm text-stone-400">
              <span className="font-medium text-stone-200">Ask AI.</span>{" "}
              Hybrid RAG over your notes, routed through your Claude subscription.
            </figcaption>
          </figure>
          <figure className="overflow-hidden rounded-xl border border-stone-800 bg-stone-900/40">
            <Image
              src="/screenshots/projects.png"
              alt="Knosi Projects — Open Source discover tab with trending GitHub repos"
              width={2560}
              height={1440}
              className="w-full"
            />
            <figcaption className="px-4 py-3 text-sm text-stone-400">
              <span className="font-medium text-stone-200">Projects.</span>{" "}
              Analyse any GitHub repo and track OSS reading alongside your notes.
            </figcaption>
          </figure>
          <figure className="overflow-hidden rounded-xl border border-stone-800 bg-stone-900/40">
            <Image
              src="/screenshots/focus.png"
              alt="Knosi Focus — 30-day focus heatmap, streak, daily totals, and activity breakdown"
              width={2560}
              height={1440}
              className="w-full"
            />
            <figcaption className="px-4 py-3 text-sm text-stone-400">
              <span className="font-medium text-stone-200">Focus.</span>{" "}
              Auto-captured deep-work sessions from your desktop.
            </figcaption>
          </figure>
          <figure className="overflow-hidden rounded-xl border border-stone-800 bg-stone-900/40">
            <Image
              src="/screenshots/portfolio.png"
              alt="Knosi Portfolio — holdings with AI position analysis and concentration diagnostics"
              width={2560}
              height={1440}
              className="w-full"
            />
            <figcaption className="px-4 py-3 text-sm text-stone-400">
              <span className="font-medium text-stone-200">Portfolio.</span>{" "}
              Live prices with AI-driven concentration and P&amp;L diagnostics.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Social proof / positioning ──────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pb-20 text-center">
        <div className="rounded-xl border border-stone-800 bg-stone-900/30 px-6 py-4">
          <p className="text-sm leading-relaxed text-stone-400">
            Built for developers who think with AI.
            <br />
            <span className="text-stone-500">
              Capture insights from Claude. Turn them into notes. Search them
              later. Ask AI on top of what you already know.
            </span>
          </p>
        </div>
      </section>

      {/* ── Problem ─────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-stone-500">
          The problem
        </h2>
        <div className="mt-8 rounded-2xl border border-stone-800 bg-stone-900/50 p-8 sm:p-10">
          <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Your best AI insights are trapped in old chats.
          </h3>
          <div className="mt-6 space-y-4 text-base leading-relaxed text-stone-400">
            <p>
              Claude and ChatGPT are great at helping you think, debug, plan,
              and learn. But the moment the session is over, most of that value
              disappears.
            </p>
            <p>
              Important ideas get buried in long threads. Good answers are hard
              to find again. And the more you rely on AI, the more knowledge you
              create without actually keeping it.
            </p>
            <p className="text-stone-200">
              Knosi closes that loop.
              <br />
              It turns AI outputs into notes, knowledge, and reusable context
              that{" "}
              <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent font-semibold">
                compounds over time
              </span>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ── 3-Value Cards ───────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="mb-10 text-center text-2xl font-bold tracking-tight sm:text-3xl">
          A second brain built for the AI workflow
        </h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {valueCards.map((c) => (
            <div
              key={c.title}
              className="rounded-xl border border-stone-800 bg-stone-900/40 p-6"
            >
              <c.icon
                className="mb-3 h-5 w-5 text-cyan-400"
                strokeWidth={1.8}
              />
              <h3 className="text-base font-semibold text-stone-100">
                {c.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {c.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Workflow ────────────────────────────────────── */}
      <section id="workflow" className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-stone-500">
          How it works
        </h2>
        <h3 className="mt-4 text-center text-2xl font-bold tracking-tight sm:text-3xl">
          From AI chat to permanent knowledge
        </h3>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {workflowSteps.map((s) => (
            <div key={s.step} className="relative">
              <span className="text-3xl font-bold text-stone-800">{s.step}</span>
              <h4 className="mt-2 text-base font-semibold text-stone-100">
                {s.title}
              </h4>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {s.description}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-12 text-center text-sm italic text-stone-500">
          AI becomes much more valuable when its output stops being disposable.
        </p>
      </section>

      {/* ── Why Knosi ───────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Why Knosi exists
        </h2>
        <div className="mt-8 space-y-4 text-base leading-relaxed text-stone-400">
          <p>
            Notion is great for writing. Obsidian is great for personal
            knowledge management.
          </p>
          <p>
            But neither starts from the workflow many developers now use every
            day:{" "}
            <span className="font-medium text-stone-200">
              thinking with AI.
            </span>
          </p>
          <p>
            Knosi is built around that reality first. It helps you preserve the
            useful parts of AI conversations, turn them into reusable knowledge,
            and keep that knowledge alive long after the original chat is gone.
          </p>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="mb-10 text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Everything you need to make AI outputs reusable
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featureModules.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-stone-800 bg-stone-900/40 p-6"
            >
              <f.icon
                className="mb-3 h-5 w-5 text-cyan-400"
                strokeWidth={1.8}
              />
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

      {/* ── Claude subscription differentiation ─────────── */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-2xl border border-stone-800 bg-stone-900/50 p-8 sm:p-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Reuse the subscription you already pay for
          </h2>
          <p className="mt-6 text-base leading-relaxed text-stone-400">
            Most AI knowledge tools make you pay twice: once for your chat
            subscription, and again for API usage.
          </p>
          <p className="mt-4 text-base leading-relaxed text-stone-400">
            Knosi can route AI features through your local Claude setup, so your
            second brain works with the tools you already use. That means lower
            cost, less friction, and a much more natural workflow for
            Claude-heavy users.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {["Claude-friendly", "Lower marginal AI cost", "Better fit for heavy users"].map(
              (tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-cyan-800/50 bg-cyan-950/30 px-3 py-1 text-xs font-medium text-cyan-300"
                >
                  {tag}
                </span>
              )
            )}
          </div>
        </div>
      </section>

      {/* ── Audience ────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="mb-10 text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Made for people whose thinking already runs through AI
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {audienceGroups.map((g) => (
            <div
              key={g.title}
              className="flex gap-4 rounded-xl border border-stone-800 bg-stone-900/40 p-6"
            >
              <g.icon
                className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400"
                strokeWidth={1.8}
              />
              <div>
                <h3 className="text-base font-semibold text-stone-100">
                  {g.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-400">
                  {g.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Self-host ───────────────────────────────────── */}
      <section id="selfhost" className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Own your knowledge layer
        </h2>
        <div className="mt-8 space-y-4 text-center text-base leading-relaxed text-stone-400">
          <p>
            The hosted version at knosi.xyz is free for most use. If you want
            full control, run your own instance.
          </p>
          <p>
            Knosi runs anywhere Node.js and SQLite run &mdash; Docker, k3s, a
            single VPS, or your laptop.
            <br />
            Keep your notes, data, and AI workflow in an environment you control.
          </p>
          <p className="text-stone-500">
            You should not have to hand over your long-term knowledge just to
            keep using AI effectively.
          </p>
        </div>
        <div className="mt-8 text-center">
          <Link
            href={GITHUB_URL}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-400 transition-colors hover:text-cyan-300"
          >
            Read the setup docs
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="mb-10 text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Frequently asked questions
        </h2>
        <div className="space-y-6">
          {faqs.map((f) => (
            <div key={f.q} className="border-b border-stone-800 pb-6">
              <h3 className="text-base font-semibold text-stone-100">{f.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">
                {f.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pt-16 pb-24 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          AI helps you think.
          <br />
          Knosi helps you keep the thinking.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-stone-400">
          The value of AI is not just in the conversation. It&apos;s in the
          ideas, decisions, plans, and explanations you want to keep using
          later. Knosi turns those moments into a second brain you actually own.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition-colors hover:bg-stone-200"
          >
            Get started &mdash; free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href={GITHUB_URL}
            className="rounded-lg border border-stone-700 px-5 py-2.5 text-sm font-semibold text-stone-300 transition-colors hover:border-stone-500 hover:text-white"
          >
            View on GitHub
          </Link>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="border-t border-stone-800 py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Image
              src="/knosi-logo.png"
              alt="Knosi"
              width={24}
              height={24}
              className="rounded-md"
              unoptimized
            />
            <span className="text-xs text-stone-500">
              The knowledge layer for your AI workflow.
            </span>
          </div>
          <div className="flex items-center gap-5 text-xs text-stone-500">
            <Link
              href={GITHUB_URL}
              className="transition-colors hover:text-stone-300"
            >
              GitHub
            </Link>
            <Link href="#features" className="transition-colors hover:text-stone-300">
              Product
            </Link>
            <Link href="#selfhost" className="transition-colors hover:text-stone-300">
              Self-host
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
