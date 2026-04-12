import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
import { verifyCliToken } from "@/server/ai/cli-auth";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token || !(await verifyCliToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    taskId: string;
    totalText?: string;
    structuredResult?: string;
    error?: string;
  };

  if (!body.taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const now = new Date();

  if (body.error) {
    await db
      .update(chatTasks)
      .set({ status: "failed", error: body.error, completedAt: now })
      .where(eq(chatTasks.id, body.taskId));
  } else {
    await db
      .update(chatTasks)
      .set({
        status: "completed",
        totalText: body.totalText ?? "",
        structuredResult: body.structuredResult ?? null,
        completedAt: now,
      })
      .where(eq(chatTasks.id, body.taskId));
  }

  return NextResponse.json({ status: "ok" });
}
