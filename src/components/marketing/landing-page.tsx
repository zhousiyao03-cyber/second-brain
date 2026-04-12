"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Zap,
  BookOpen,
  Search,
  BarChart3,
  Clock,
  PenTool,
  Brain,
  FolderOpen,
} from "lucide-react";

const features = [
  {
    icon: PenTool,
    title: "Capture",
    description:
      "A block editor that rivals Notion. Code blocks, Mermaid diagrams, Excalidraw, tables, callouts, image galleries. Turn raw AI output into structured, lasting documents.",
  },
  {
    icon: Brain,
    title: "Ask AI",
    description:
      "Chat with your entire knowledge base using your own Claude subscription. Hybrid RAG with semantic + keyword search, neighboring paragraph expansion, and source citations.",
  },
  {
    icon: BookOpen,
    title: "Learn",
    description:
      "Pick a topic and AI generates outlines, surfaces gaps in your understanding, and creates review questions. Not just storage \u2014 comprehension.",
  },
  {
    icon: BarChart3,
    title: "Track",
    description:
      'See your "conversion rate" \u2014 how much of your monthly token spend actually turned into permanent knowledge.',
  },
  {
    icon: Clock,
    title: "Focus",
    description:
      "Automatic time tracking across your apps, sessionized into focus data so you can see where your hours actually go.",
  },
  {
    icon: FolderOpen,
    title: "Projects",
    description:
      "Organized notes per open-source project you\u2019re studying or contributing to. Portfolio tracking with integrated news feeds.",
  },
];

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
      {/* Nav */}
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
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Your subscription should{" "}
          <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
            compound
          </span>
          ,
          <br />
          not evaporate.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-stone-400">
          You&apos;re already paying for Claude. Every token you spend should become
          something permanent &mdash; a note, a connection, a piece of understanding
          you can still search and build on six months from now.
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
            I&apos;ve spent thousands on Claude this year. The conversations were
            brilliant &mdash; and completely disposable. Every insight just vanished
            into chat history. Meanwhile my Notion stayed empty. Tokens{" "}
            <span className="text-red-400">consumed</span>, never{" "}
            <span className="text-cyan-300">converted</span>.
          </p>
        </div>
      </section>

      {/* Core concept */}
      <section className="mx-auto max-w-3xl px-6 py-8 text-center">
        <div className="flex items-center justify-center gap-3 text-sm font-semibold uppercase tracking-wider text-stone-500">
          <Zap className="h-4 w-4 text-cyan-400" />
          Token &rarr; Knowledge
        </div>
        <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-stone-400">
          Knosi bridges your existing Claude subscription through a local daemon &mdash;
          no extra API costs. Your Claude Code sessions feed directly into Knosi,
          and a usage tracker syncs token consumption in real time.
        </p>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h2 className="mb-10 text-center text-sm font-semibold uppercase tracking-wider text-stone-500">
          What&apos;s inside
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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

      {/* Self-hosted callout */}
      <section className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-xl border border-stone-800 bg-stone-900/30 p-6 text-center">
          <p className="text-sm leading-relaxed text-stone-400">
            Self-hosted. Your data never leaves your machine.
            <br />
            <span className="text-stone-500">
              Still a work in progress &mdash; but the core is working, and I use it every day.
            </span>
          </p>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="mx-auto max-w-3xl px-6 pt-16 pb-24 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Make every token count.
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
        Knosi
      </footer>
    </div>
  );
}
